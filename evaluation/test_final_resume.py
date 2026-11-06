"""Restricted-PG six-selection retained-final proof, real cold jail + loopback HTTP.

No live databases, provider credentials, study funding, or lease-policy changes.
"""
from contextlib import contextmanager
from dataclasses import replace
from hashlib import sha256
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit
import httpx
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend/tests'))
from test_domain import context
from test_conversations import conversation,post
from test_general_alpha_runtime import activate,AlphaProvider
from test_memory_full_tools import config
from test_run_output_workflow import install_workflow
from test_selection_rejection import BAD,TEXT
from test_workspace_files_pg import text
from test_adaptive_execution import finish_safe_visits
from test_runtime import expire
from workagent.adaptive import contract
from workagent.capabilities import registry,policy
from workagent.capabilities.models import CapabilityPin
from workagent.db import Database
from workagent.errors import DomainError
from workagent.general_worker import GeneralWorker
from workagent.responses_transport import ResponsesTransport
from workagent.responses_ledger import Ledger
from workagent.provider_attempts import ReceiptCapability
from workagent.service import WorkerCapability
from network_harness import REPO,inventory,jail,digest
from study_application import stage_execution_source
from study_controller import canonical

OUT=REPO/'.local/batch3/b35c/final-resume'


def snapshot(ctx,rid):
    s,p,ws,_,_=ctx
    with s.db.transaction() as c:
        steps=c.execute('SELECT * FROM responses_steps WHERE attempt_id IN (SELECT id FROM provider_attempts WHERE run_id=%s) ORDER BY phase',(rid,)).fetchall()
        events=c.execute('SELECT e.* FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.created_at,e.id',(rid,)).fetchall()
        tools=c.execute('SELECT * FROM tool_attempts WHERE run_id=%s ORDER BY id',(rid,)).fetchall()
        exports=c.execute('SELECT * FROM artifact_exports WHERE workspace_id=%s ORDER BY id',(ws,)).fetchall()
        files=c.execute('SELECT * FROM workspace_files WHERE workspace_id=%s ORDER BY id',(ws,)).fetchall()
    return dict(steps=steps,events=events,tools=tools,exports=exports,files=files)


def events_by_key(snap):return {(e['phase'],e['kind']):e['data'] for e in snap['events'] if e['kind']!='read'}


class Wire:
    def __init__(self,fake,root,port=0):
        self.fake=fake;self.calls=[];self.lose=False;owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*a):pass
            def do_GET(self):self.handle_wire()
            def do_POST(self):self.handle_wire()
            def handle_wire(self):
                raw=self.rfile.read(int(self.headers.get('Content-Length',0)))
                value=json.loads(raw) if raw else {};phase=value.get('metadata',{}).get('step_id')
                row=dict(method=self.command,path=self.path,phase=phase,sha256=sha256(raw).hexdigest())
                owner.calls.append(row)
                with (root/'http.jsonl').open('a') as f:f.write(json.dumps(row)+'\n')
                response=owner.fake.handle(httpx.Request(self.command,owner.origin+self.path,content=raw))
                if owner.lose and self.path=='/v1/responses' and phase=='final':
                    self.close_connection=True;return
                body=response.content;self.send_response(response.status_code)
                self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)))
                self.end_headers();self.wfile.write(body)
        self.server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
        self.origin='http://127.0.0.1:'+str(self.server.server_port)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def close(self):self.server.shutdown();self.server.server_close();self.thread.join()


def prepare(ctx,root,wire,*,six=True,limits=None):
    s,p,ws,_,_=ctx;cv=conversation(ctx)
    instructions,schema=contract(SimpleNamespace(**config('off')['responses']))
    with patch('test_general_alpha_runtime.POLICY',instructions),patch('test_general_alpha_runtime.DECISION_SCHEMA',schema):
        grant=activate(ctx,cv,continuity_version='sustained-v1',max_steps=8,memory_recall='off',**(limits or {}))
    q=post(ctx,cv,'Create exactly one draft and one export, then reply.')
    install=policy.install
    def scoped(db,g,**kw):
        extra=[registry.adapters()[n].descriptor for n in ('capabilities.discover_legacy','context.read')]
        g=g.model_copy(update={'capabilities':g.capabilities+[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in extra]})
        return install(db,g,**kw)
    with patch.object(policy,'install',scoped):tool=install_workflow(ctx,cv,q,grant)
    from workagent.capabilities.models import ToolGrantV1
    with s.db.transaction() as c:
        tool=ToolGrantV1.model_validate_json(json.dumps(c.execute('SELECT data FROM tool_grants WHERE id=%s',(tool.id,)).fetchone()['data']))
    counts=0
    def hook(name):
        nonlocal counts
        if name=='after_count':
            counts+=1
            if counts==(7 if six else 2):raise InterruptedError('counted final')
    transport=ResponsesTransport.synthetic(httpx.MockTransport(wire.fake.handle),origin=wire.origin)
    # Preparation uses existing immediate in-process fixture policy. The actual
    # cold worker below retains the production 95-second HTTP timeout sum.
    transport._client.timeout=httpx.Timeout(.1)
    worker=GeneralWorker(s,transport=transport,state=root/'worker-state',enable_responses=True,hook=hook)
    with pytest.raises(InterruptedError):finish_safe_visits(ctx,worker,q.run.id)
    transport.close()
    before=snapshot(ctx,q.run.id);events=events_by_key(before)
    assert ('final','count_result') in events and ('final','dispatch') not in events
    assert len(before['steps'])==(7 if six else 2)
    if six:
        assert events['selection_3','result']['state']=='malformed'
        assert ('selection_3','tool_result') not in events
        assert events['selection_3','selection_rejection']['terminal_outcome']=='continue'
        assert len(before['exports'])==len(before['files'])==1
        assert [r['capability_id'] for r in before['tools']].count('files.create_draft')==1
        assert [r['capability_id'] for r in before['tools']].count('artifacts.export')==1
    return cv,q,grant,tool,worker,before


def cold(ctx,root,q,grant,tool,wire,mode='normal'):
    s,p,ws,_,_=ctx
    source=REPO/'backend/workagent';expected=sha256(canonical(inventory(source)).encode()).hexdigest()
    product=stage_execution_source(root,source,expected)
    inputs=root/'inputs';inputs.mkdir(exist_ok=True);(inputs/'prompt.txt').write_text('Synthetic local fixture only.')
    with s.db.transaction() as c:
        rc=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
    files={'/worker.py':REPO/'evaluation/final_resume_probe.py','/study_worker.py':REPO/'evaluation/study_worker.py',
           '/network_worker.py':REPO/'evaluation/network_worker.py','/study_transport.py':REPO/'evaluation/study_transport.py'}
    execution={name:digest(path) for name,path in files.items()}
    execution['/usr/bin/python3']=digest(Path('/usr/bin/python3').resolve())
    cfg=dict(transport='controlled_http',controlled_origin=wire.origin,dsn=str(s.db.dsn),workspace=ws,principal=p.id,
        run_id=q.run.id,grant_id=grant.id,grant=grant.model_dump(mode='json'),tool_grant=tool.model_dump(mode='json'),
        descriptors={pin.id:registry.adapters()[pin.id].descriptor.model_dump(mode='json') for pin in tool.capabilities},
        run_configuration=rc,source_manifest=inventory(product),input_files=inventory(inputs),
        dependencies=inventory(REPO/'backend/.venv/lib/python3.12/site-packages'),execution_files=execution,
        allowed_tcp_ports=[urlsplit(s.db.dsn).port or 5432,wire.server.server_port],forbidden_listener_port=1,
        probe_mode=mode)
    argv=jail(inputs,root/'worker-state',product)
    argv[argv.index(str(REPO/'evaluation/network_worker.py'))]=str(files['/worker.py'])
    at=argv.index('--');argv[at:at]=[arg for name,path in files.items() if name!='/worker.py' for arg in ('--ro-bind',str(path),name)]
    start=time.monotonic();result=subprocess.run(argv,input=json.dumps(cfg),text=True,capture_output=True,timeout=240)
    label=str(len(list(root.glob('cold-*.stdout'))))+'-'+mode
    (root/f'cold-{label}.stdout').write_text(result.stdout);(root/f'cold-{label}.stderr').write_text(result.stderr)
    assert result.returncode==0, 'cold worker failed; see '+str(root/f'cold-{label}.stderr')
    receipt=json.loads(result.stdout)
    trace=json.loads(result.stderr.splitlines()[-1])['probe_trace']
    (root/f'cold-{label}.timing.json').write_text(json.dumps(dict(wall_seconds=time.monotonic()-start,trace=trace),indent=2))
    return receipt,trace


def fake_six():
    def export(ctx):return dict(kind='artifacts_export',input_ref=next(r for r in ctx['run_output_refs'] if r['kind']=='workspace_file'),format='txt')
    return AlphaProvider([{'kind':'discover_capabilities'},{'kind':'read_context','section':'messages'},BAD,
        {'kind':'files_create_draft','source':text(TEXT).model_dump()},export,{'kind':'reply','text':'Draft and export retained.'}])


def test_six_selection_cold_before_reservation_identity_and_exact_recovery(context):
    root=OUT/('six-'+context[2]);root.mkdir();wire=Wire(fake_six(),root)
    try:
        cv,q,grant,tool,w,before=prepare(context,root,wire)
        exercise_six(context,root,q,grant,tool,wire,before)
    finally:wire.close()


def exercise_six(context,root,q,grant,tool,wire,before):
    expire(context,q.run.id)
    receipt,trace=cold(context,root,q,grant,tool,wire,'before_reservation')
    assert receipt['state']=='interrupted' and not wire.calls
    assert snapshot(context,q.run.id)==before
    handoff=next(r for r in trace if r.get('handoff'))
    assert handoff['allowed'] and handoff['allowance']==105
    finish_six(context,root,q,grant,tool,wire,before)
    assert handoff['lease_remaining']>108, 'additional 3-second cold headroom target missed; mechanism evidence retained'


def finish_six(context,root,q,grant,tool,wire,before):
    expire(context,q.run.id)
    receipt,trace=cold(context,root,q,grant,tool,wire,'after_identity')
    assert receipt['state']=='interrupted'
    mid=snapshot(context,q.run.id);events=events_by_key(mid)
    assert ('final','identity') in events and ('final','result') not in events
    assert wire.calls==[dict(method='POST',path='/v1/responses',phase='final',sha256=sha256(next(r for r in before['steps'] if r['phase']=='final')['request_bytes'].encode()).hexdigest())]
    wait_natural_expiry(context,q)
    receipt,trace=cold(context,root,q,grant,tool,wire)
    assert receipt['state']=='ready'
    after=snapshot(context,q.run.id)
    assert after['steps']==before['steps'] and all(e in after['events'] for e in before['events'])
    assert all(after[k]==before[k] for k in ('tools','exports','files'))
    assert len(wire.calls)==2 and wire.calls[-1]['method']=='GET'
    assert wire.calls[-1]['path']=='/v1/responses/'+events['final','identity']['response_id']
    assert sum(e['kind']=='count_send' for e in after['events'])==7
    assert sum(e['kind']=='dispatch' and e['phase']=='final' for e in after['events'])==1
    (root/'proof.json').write_text(json.dumps(dict(status='PASS',selections=6,rejections=1,drafts=1,exports=1,final_creates=1,final_counts=1,exact_gets=1,history_preserved=True),indent=2))

def wait_natural_expiry(context,q):
    # Never rewrite a lease after unknown I/O or identity retention.
    from workagent.models import now
    run=context[0].get_run(context[1],context[2],q.run.id)
    delay=max(0,(run.lease_expires_at-now()).total_seconds()+.1)
    while delay>0:
        time.sleep(min(delay,10))
        delay=max(0,(run.lease_expires_at-now()).total_seconds()+.1)


def test_prepared_final_denials_and_unknown_dispatch_no_blind_resend(context,monkeypatch):
    root=OUT/('unknown-'+context[2]);root.mkdir()
    fake=AlphaProvider([{'kind':'reply','text':'Synthetic final only.'}]);wire=Wire(fake,root)
    try:
        cv,q,grant,tool,w,before=prepare(context,root,wire,six=False)
        saved=w.phases.state.load(context[2],q.run.id)
        ledger=Ledger(context[0],ReceiptCapability(**saved['receipt']));cap=WorkerCapability(**saved['worker'])
        with context[0].db.transaction() as c:
            rc=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(context[2],q.run.id)).fetchone()['data']
        _,schema=contract(grant.responses)
        with pytest.raises(DomainError):w._prepared_final(ledger,replace(cap,fence=cap.fence+1),rc,schema)
        # Corrupt only in-memory observations after loading real immutable rows.
        # Each mismatch must be rejected before the unchanged phase driver sees it.
        from copy import deepcopy
        from dataclasses import replace as dc_replace
        original=Ledger.snapshot
        original_events=Ledger._events
        assert w._prepared_final(ledger,cap,rc,schema)[0].phase=='final'
        for damage in ('request_hash','metadata','binding','terminal','missing_result','final_history'):
            def corrupt_events(self,c,phase):
                events=deepcopy(original_events(self,c,phase))
                if phase=='selection':
                    if damage=='request_hash':events['result']['request_sha256']='0'*64
                    if damage=='metadata':events['result']['metadata']['step_id']='selection_2'
                    if damage=='binding':events['tool_result']['binding']['selection_response_id']='resp_wrong'
                    if damage=='terminal':events['tool_result']['terminal_outcome']='continue'
                    if damage=='missing_result':events.pop('result')
                return events
            def corrupt(self,phase,authority):
                request,events=original(self,phase,authority)
                if phase=='final' and damage=='final_history':
                    body=json.loads(request.body);body['input'][-1]['output']='{}'
                    request=dc_replace(request,body=canonical(body).encode())
                return request,events
            with monkeypatch.context() as m:
                m.setattr(Ledger,'snapshot',corrupt)
                m.setattr(Ledger,'_events',corrupt_events)
                with pytest.raises(DomainError):w._prepared_final(ledger,cap,rc,schema)
        assert w._prepared_final(ledger,cap,rc,schema)[0].phase=='final'
        assert snapshot(context,q.run.id)==before and not wire.calls
        expire(context,q.run.id);wire.lose=True
        receipt,trace=cold(context,root,q,grant,tool,wire)
        assert receipt['state']=='running' and len(wire.calls)==1
        unknown=snapshot(context,q.run.id);events=events_by_key(unknown)
        assert ('final','dispatch') in events and ('final','identity') not in events and ('final','result') not in events
        # Same still-current capability is sufficient to demonstrate no blind
        # resend in a new cold process; no lease rewrite or funding manipulation.
        receipt,trace=cold(context,root,q,grant,tool,wire)
        assert receipt['state']=='running' and len(wire.calls)==1
        assert snapshot(context,q.run.id)==unknown
        wait_natural_expiry(context,q)
        receipt,trace=cold(context,root,q,grant,tool,wire)
        assert receipt['state']=='running' and len(wire.calls)==1
        assert any(r['event']=='claim' for r in trace)
        assert snapshot(context,q.run.id)==unknown
        assert unknown['steps']==before['steps'] and all(e in unknown['events'] for e in before['events'])
        (root/'proof.json').write_text(json.dumps(dict(status='PASS',stale_fence_denied=True,history_corruptions_denied=6,unknown_dispatches=1,identities=0,blind_resends=0,final_recounts=0),indent=2))
    finally:wire.close()


@pytest.mark.parametrize('handoff,boundary',[(False,100),(True,105)])
@pytest.mark.parametrize('offset,expected',[(-.001,False),(0,False),(.001,True)])
def test_unchanged_http_boundaries(tmp_path,monkeypatch,handoff,boundary,offset,expected):
    from datetime import timedelta
    import workagent.responses_worker as module
    from workagent.models import now
    origin=now()
    transport=ResponsesTransport.synthetic(httpx.MockTransport(lambda _:pytest.fail('no HTTP')))
    driver=module.ResponsesWorker(None,transport,tmp_path)
    assert sum(transport._client.timeout.as_dict().values())==95
    monkeypatch.setattr(module,'now',lambda:origin)
    assert driver._http_window(SimpleNamespace(lease_expires_at=origin+timedelta(seconds=boundary+offset)),
        time.monotonic()+120,handoff=handoff) is expected
    transport.close()


def test_counted_final_budget_denied_by_current_shared_reservations(context):
    import psycopg
    from test_alpha_budget import prepared,count,reserve,DISPATCH
    root=OUT/('budget-'+context[2]);root.mkdir()
    fake=AlphaProvider([{'kind':'reply','text':'Synthetic budget fixture.'}]);wire=Wire(fake,root)
    try:
        cv,q,grant,tool,w,before=prepare(context,root,wire,six=False,limits={'generation_limit':2})
        peer=context_fixture_for_peer()
        _,peer_fake,peer_step=prepared(peer,root/'peer',project=grant.responses.project_id)
        count(peer_step,peer_fake);reserve(peer_step,'dispatch')
        # A distinct disposable grant legitimately consumes the last shared
        # generation after final counting. No cap/funding mutation or carry copy.
        saved=w.phases.state.load(context[2],q.run.id)
        ledger=Ledger(context[0],ReceiptCapability(**saved['receipt']));cap=WorkerCapability(**saved['worker'])
        request,_=ledger.snapshot('final',cap)
        with pytest.raises(DomainError,match='budget_exhausted'):
            ledger.reserve_operation(request,'dispatch',cap)
        with pytest.raises(psycopg.Error),context[0].db.transaction() as c:
            ledger.event(c,'final','dispatch',DISPATCH)
        assert snapshot(context,q.run.id)==before and not wire.calls
        result=w.work(context[1],context[2],q.run.id)
        assert result.state=='partial'
        after=snapshot(context,q.run.id)
        assert after==before and ('final','dispatch') not in events_by_key(after)
        (root/'proof.json').write_text(json.dumps(dict(status='PASS',counted_final_preserved=True,
            python_and_sql_budget_denied=True,final_sends=0,unknown_peer_retained=True),indent=2))
    finally:wire.close()


def context_fixture_for_peer():
    return context.__wrapped__()


@pytest.mark.parametrize('kind',['provider','tool'])
def test_prepared_final_revocation_is_permanent_and_denies_io(context,kind):
    root=OUT/(kind+'-revoke-'+context[2]);root.mkdir()
    fake=AlphaProvider([{'kind':'reply','text':'Synthetic revocation fixture.'}]);wire=Wire(fake,root)
    try:
        cv,q,grant,tool,w,before=prepare(context,root,wire,six=False)
        table,identity=('provider_grants',grant.id) if kind=='provider' else ('tool_grants',tool.id)
        with Database(context[4]).transaction() as c:c.execute('UPDATE '+table+' SET active=false WHERE id=%s',(identity,))
        with pytest.raises(DomainError):w.work(context[1],context[2],q.run.id)
        assert snapshot(context,q.run.id)==before and not wire.calls
        (root/'proof.json').write_text(json.dumps(dict(status='PASS',revoked=kind,io_calls=0,history_preserved=True),indent=2))
    finally:wire.close()
