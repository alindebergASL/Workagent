"""Prepared phase5, restricted disposable PG and cold worker jail; loopback only."""
from test_final_resume import (context, Wire, snapshot, events_by_key, wait_natural_expiry,
    REPO, inventory, jail, digest, stage_execution_source, canonical, registry,
    sha256, json, subprocess, time, urlsplit, Path, GeneralWorker, Ledger,
    ReceiptCapability, WorkerCapability, contract, DomainError, Database)
from unittest.mock import patch
from dataclasses import replace
from copy import deepcopy
import pytest
from test_file_input_rejection import prepare as target_prepare, immutable_tool_rows
from test_gateway_target_rejection import material
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_runtime import expire
from workagent.responses_worker import ResponsesWorker
from workagent.models import ProviderGrant
from workagent.capabilities.models import ToolGrantV1
from workagent.file_input_rejection import install_no_effect

OUT=REPO/'.local/batch3/b35c/file-patch-recovery/selection-progress-repair-118'

def cold(ctx,root,q,grant,tool,wire,mode='normal'):
    s,p,ws,_,_=ctx
    source=REPO/'backend/workagent';expected=sha256(canonical(inventory(source)).encode()).hexdigest()
    product=stage_execution_source(root,source,expected)
    inputs=root/'inputs';inputs.mkdir(exist_ok=True);(inputs/'prompt.txt').write_text('Synthetic local fixture only.')
    with s.db.transaction() as c:
        rc=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
    files={'/worker.py':REPO/'evaluation/selection_resume_probe.py','/study_worker.py':REPO/'evaluation/study_worker.py',
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
    argv=jail(inputs,root/'worker-state'/'state',product)
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



def prepare(ctx,root,monkeypatch):
    import test_gateway_target_rejection as target
    s,p,ws,_,admin=ctx
    original=target.activate
    def activate(*a,**kw):
        kw['max_steps']=8
        return original(*a,**kw)
    with patch.object(target,'activate',activate):
        cv,q,tool,saved,bad,good=target_prepare(ctx)
    # Use the exact established target/legacy fixture DTO, without a second grant.
    from test_general_responses import target as target_ref
    from test_local_rejection_settlement import readiness_document
    legacy=dict(kind='publish_artifact',target=target_ref(saved).model_dump(),body=readiness_document())
    fake=AlphaProvider([{'kind':'discover_capabilities'},legacy,
        {'kind':'files_read_range','ref':bad['ref'],'offset':0,'limit':8192},bad,good,
        {'kind':'reply','text':'A new proposal awaits human review.'}])
    wire=Wire(fake,root)
    w=worker(ctx,fake,root/'worker-state')
    import workagent.file_input_rejection as rejection
    with patch.object(rejection,'retain',lambda *a:None):
        with pytest.raises(DomainError) as err:finish_safe_visits(ctx,w,q.run.id)
        assert err.value.code.value=='action_unresolved'
    state=w.phases.state.load(ws,q.run.id)
    receipt=ReceiptCapability(**state['receipt'])
    with s.db.transaction() as c:
        ta=c.execute("SELECT * FROM tool_attempts WHERE run_id=%s AND call_id='selection_4'",(q.run.id,)).fetchone()
        rc=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
        grant=ProviderGrant.model_validate(c.execute('SELECT data FROM provider_grants WHERE id=%s',(rc['grant_id'],)).fetchone()['data'])
        tool=ToolGrantV1.model_validate_json(json.dumps(c.execute('SELECT data FROM tool_grants WHERE id=%s',(tool.id,)).fetchone()['data']))
    unknown=immutable_tool_rows(ctx,ta['id'])
    install_no_effect(Database(admin),ta['id'],receipt.attempt_id,'selection_4')
    step=ResponsesWorker._step
    def stop(self,ledger,request,*a):
        if request.phase=='selection_5':raise InterruptedError('prepared fifth')
        return step(self,ledger,request,*a)
    expire(ctx,q.run.id)
    with patch.object(ResponsesWorker,'_step',stop),pytest.raises(InterruptedError,match='prepared fifth'):
        finish_safe_visits(ctx,w,q.run.id)
    before=snapshot(ctx,q.run.id)
    assert len(before['steps'])==5
    assert not any(e['phase']=='selection_5' for e in before['events'])
    assert events_by_key(before)['selection_4','file_input_rejection']['feedback']['effect']=='historical_unknown_resolved_no_effect'
    assert immutable_tool_rows(ctx,ta['id'])==unknown
    return q,grant,tool,w,wire,before,ta['id'],unknown,saved


def test_cold_prepared_fifth_exact_bytes_no_restage(context,monkeypatch):
    root=OUT/('cold-'+context[2]);root.mkdir()
    q,grant,tool,w,wire,before,tid,unknown,human=prepare(context,root,monkeypatch)
    try:
        wait_natural_expiry(context,q)
        receipt,trace=cold(context,root,q,grant,tool,wire,'before_reservation')
        assert receipt['state']=='interrupted' and not wire.calls
        assert snapshot(context,q.run.id)==before
        handoff=next(x for x in trace if x.get('handoff'))
        assert handoff['allowed'] and handoff['allowance']==105
        assert handoff['lease_remaining']>108
        wait_natural_expiry(context,q)
        receipt,trace=cold(context,root,q,grant,tool,wire,'after_identity')
        deferred_count=False
        if receipt['state']=='running':
            # The unchanged 105s check may defer create after a successful count.
            # Retain that count, wait for natural expiry, and resume exact bytes.
            counted=snapshot(context,q.run.id);count_events=events_by_key(counted)
            assert ('selection_5','count_result') in count_events
            assert ('selection_5','dispatch') not in count_events
            assert len(wire.calls)==1 and wire.calls[0]['path'].endswith('/input_tokens')
            deferred_count=True
            wait_natural_expiry(context,q)
            receipt,trace=cold(context,root,q,grant,tool,wire,'after_identity')
        assert receipt['state']=='interrupted'
        dispatch=next(x for x in trace if x.get('operation')=='dispatch' and x.get('handoff'))
        assert dispatch['allowed'] and dispatch['allowance']==105
        assert dispatch['lease_remaining']>108
        mid=snapshot(context,q.run.id);events=events_by_key(mid)
        assert ('selection_5','identity') in events and ('selection_5','result') not in events
        wait_natural_expiry(context,q)
        receipt,trace=cold(context,root,q,grant,tool,wire)
        deferred_reads=0
        while receipt['state']=='running' and deferred_reads<2:
            # Host/DB contention can consume a read window too. A deferral is
            # safe only if it retained the identity without issuing ANY GET.
            assert len(wire.calls)==2 and snapshot(context,q.run.id)==mid
            deferred_reads+=1
            wait_natural_expiry(context,q)
            receipt,trace=cold(context,root,q,grant,tool,wire)
        assert receipt['state']=='interrupted'
        after=snapshot(context,q.run.id)
        assert after['steps']==before['steps'] and all(e in after['events'] for e in before['events'])
        request=next(r for r in before['steps'] if r['phase']=='selection_5')
        assert [x['sha256'] for x in wire.calls if x['path']=='/v1/responses']==[request['request_sha256']]
        assert len(wire.calls)==3 and wire.calls[-1]['method']=='GET'
        assert wire.calls[-1]['path']=='/v1/responses/'+events['selection_5','identity']['response_id']
        assert sum(x['kind']=='count_send' for x in after['events'])==5
        assert sum(x['kind']=='dispatch' and x['phase']=='selection_5' for x in after['events'])==1
        assert immutable_tool_rows(context,tid)==unknown
        assert len(after['tools'])==len(before['tools'])+1
        s,p,ws,_,_=context
        assert s.get_artifact(p,ws,human.id).current_revision==human.current_revision
        assert len(s.proposals(p,ws,human.id).items)==1
        (root/'proof.json').write_text(json.dumps(dict(status='PASS',handoff=handoff,
            natural_expiry_restarts=3+int(deferred_count)+deferred_reads,deferred_reads=deferred_reads,count_then_deferred_create=deferred_count,dispatch_handoff=dispatch,counts=1,creates=1,exact_gets=1,unknown_preserved=True,prepared_bytes_preserved=True),indent=2))
    finally:wire.close()


def test_prepared_prefix_denials_and_resolution_revalidated(context,monkeypatch):
    from contextlib import contextmanager
    from types import SimpleNamespace
    from workagent.responses_transport import TransportError
    s,p,ws,_,admin=context
    root=OUT/('denials-'+ws);root.mkdir()
    q,grant,tool,w,wire,before,tid,unknown,human=prepare(context,root,monkeypatch)
    try:
        saved=w.phases.state.load(ws,q.run.id)
        cap=WorkerCapability(**saved['worker']);ledger=Ledger(s,ReceiptCapability(**saved['receipt']))
        with s.db.transaction() as c:
            rc=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
        _,schema=contract(grant.responses)
        validate=lambda:w._prepared_selection(ledger,cap,rc,schema)
        assert validate()[1]==5
        original_events=Ledger._events;original_snapshot=Ledger.snapshot
        transaction=s.db.transaction
        cases=('missing_phase','missing_result','result_hash','count_hash','identity','binding','terminal','request_bytes','projection','resolution')
        for damage in cases:
            def corrupt_events(self,c,phase):
                events=deepcopy(original_events(self,c,phase))
                if phase=='selection_3':
                    if damage=='missing_result':events.pop('result')
                    if damage=='result_hash':events['result']['request_sha256']='0'*64
                    if damage=='count_hash':events['count_result']['count_sha256']='0'*64
                    if damage=='identity':events['identity']['response_id']='resp_wrong'
                    if damage=='binding':events['tool_result']['binding']['selection_response_id']='resp_wrong'
                    if damage=='terminal':events['tool_result']['terminal_outcome']='answered'
                return events
            @contextmanager
            def corrupted_transaction(*a,**kw):
                with transaction(*a,**kw) as conn:
                    class Connection:
                        def execute(self,sql,*args,**kwargs):
                            cursor=conn.execute(sql,*args,**kwargs)
                            if damage=='missing_phase' and 'SELECT phase FROM responses_steps' in sql:
                                rows=[r for r in cursor.fetchall() if r['phase']!='selection_2']
                                return SimpleNamespace(fetchall=lambda:rows)
                            if damage=='request_bytes' and 'SELECT * FROM responses_steps' in sql:
                                rows=deepcopy(cursor.fetchall())
                                for row in rows:
                                    if row['phase']=='selection_5':
                                        body=json.loads(row['request_bytes']);body['input'][0]['content']='{}'
                                        row['request_bytes']=canonical(body)
                                return SimpleNamespace(fetchall=lambda:rows)
                            if damage=='resolution' and 'SELECT file_input_rejection_expected(' in sql:
                                return SimpleNamespace(fetchone=lambda:{'data':None})
                            return cursor
                        def __getattr__(self,key):return getattr(conn,key)
                    yield Connection()
            import workagent.adaptive as adaptive
            retained=adaptive.retained
            def corrupt_retained(*a,**kw):
                rows=retained(*a,**kw)
                if damage=='projection':rows[-1]['feedback']['generated_text']['sha256']='0'*64
                return rows
            with monkeypatch.context() as m:
                m.setattr(Ledger,'_events',corrupt_events)
                m.setattr(s.db,'transaction',corrupted_transaction)
                m.setattr(adaptive,'retained',corrupt_retained)
                with pytest.raises((DomainError,TransportError)):validate()
        assert validate()[0].body==next(r['request_bytes'] for r in before['steps'] if r['phase']=='selection_5').encode()
        with pytest.raises(DomainError):w._prepared_selection(ledger,replace(cap,fence=cap.fence+1),rc,schema)
        with pytest.raises(DomainError):w._prepared_selection(ledger,replace(cap,run_id='different-run'),rc,schema)
        assert snapshot(context,q.run.id)==before and not wire.calls
        assert immutable_tool_rows(context,tid)==unknown
        # Both current grant denials are permanent on fresh disposable fixtures.
        with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(tool.id,))
        with pytest.raises(DomainError):validate()
        assert snapshot(context,q.run.id)==before and not wire.calls
        (root/'proof.json').write_text(json.dumps(dict(status='PASS',denials=list(cases)+['stale_fence','cross_run','tool_revoked'],unknown_preserved=True),indent=2))
    finally:wire.close()


def test_current_context_and_provider_revocation(context,monkeypatch):
    from test_domain import cmd
    from workagent.workspace_file_models import EditWorkspaceFile
    s,p,ws,_,admin=context
    root=OUT/('context-'+ws);root.mkdir()
    q,grant,tool,w,wire,before,tid,unknown,human=prepare(context,root,monkeypatch)
    try:
        saved=w.phases.state.load(ws,q.run.id)
        cap=WorkerCapability(**saved['worker']);ledger=Ledger(s,ReceiptCapability(**saved['receipt']))
        with s.db.transaction() as c:rc=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
        _,schema=contract(grant.responses)
        cv=s.get_conversation(p,ws,q.run.conversation_id).conversation
        content=human.current_revision.body.content+'\nA newer synthetic human edit.\n'
        s.edit_workspace_file(p,ws,human.id,cmd(EditWorkspaceFile,
            expected_work_version=cv.work_version,base_version_id=human.current_revision_id,
            base_sha256=human.current_revision.body.content_sha256,content=content,sha256=sha256(content.encode()).hexdigest()))
        unchanged=snapshot(context,q.run.id)
        with pytest.raises(DomainError):w._prepared_selection(ledger,cap,rc,schema)
        assert snapshot(context,q.run.id)==unchanged and not wire.calls
        with Database(admin).transaction() as c:c.execute('UPDATE provider_grants SET active=false WHERE id=%s',(grant.id,))
        with pytest.raises(DomainError):w.work(p,ws,q.run.id)
        assert snapshot(context,q.run.id)==unchanged and not wire.calls
        assert immutable_tool_rows(context,tid)==unknown
    finally:wire.close()


def test_unknown_fifth_dispatch_never_resent(context,monkeypatch):
    root=OUT/('unknown-'+context[2]);root.mkdir()
    q,grant,tool,w,wire,before,tid,unknown,human=prepare(context,root,monkeypatch)
    try:
        wire.fake.lose_phase='selection_5'
        wait_natural_expiry(context,q)
        receipt,trace=cold(context,root,q,grant,tool,wire)
        assert receipt['state']=='running'
        mid=snapshot(context,q.run.id);events=events_by_key(mid)
        if ('selection_5','dispatch') not in events:
            assert ('selection_5','count_result') in events
            wait_natural_expiry(context,q)
            receipt,trace=cold(context,root,q,grant,tool,wire)
            assert receipt['state']=='running'
            mid=snapshot(context,q.run.id);events=events_by_key(mid)
        assert ('selection_5','dispatch') in events and ('selection_5','identity') not in events
        calls=list(wire.calls)
        assert len(calls)==2
        wait_natural_expiry(context,q)
        receipt,trace=cold(context,root,q,grant,tool,wire)
        assert receipt['state']=='running' and wire.calls==calls
        assert snapshot(context,q.run.id)==mid and immutable_tool_rows(context,tid)==unknown
    finally:wire.close()


def test_settled_fifth_then_ordinary_new_selection_and_final(context,monkeypatch):
    root=OUT/('ordinary-'+context[2]);root.mkdir()
    q,grant,tool,w,wire,before,tid,unknown,human=prepare(context,root,monkeypatch)
    try:
        expire(context,q.run.id)  # safe fixture setup: fifth has no HTTP reservation
        def stop_after_tool(name):
            if name=='after_tool_result':raise InterruptedError('settled fifth')
        with patch.object(w.phases,'_hook',stop_after_tool),pytest.raises(InterruptedError,match='settled fifth'):
            finish_safe_visits(context,w,q.run.id)
        settled=snapshot(context,q.run.id)
        assert ('selection_5','tool_result') in events_by_key(settled) and len(settled['steps'])==5
        expire(context,q.run.id)  # every provider send/result and tool effect is settled
        assert finish_safe_visits(context,worker(context,wire.fake,root/'worker-state'),q.run.id).state=='ready' 
        after=snapshot(context,q.run.id);events=events_by_key(after)
        assert all(row in after['steps'] for row in before['steps']) and len(after['steps'])==7
        assert all(e in after['events'] for e in before['events'])
        assert immutable_tool_rows(context,tid)==unknown
        assert sum(e['kind']=='count_send' for e in after['events'])==7
        assert sum(e['kind']=='dispatch' for e in after['events'])==7
        assert events['selection_6','result']['value']['decision']['kind']=='reply'
        assert events['final','result']['state']=='completed'
        s,p,ws,_,_=context
        assert s.get_artifact(p,ws,human.id).current_revision==human.current_revision
        assert len(s.proposals(p,ws,human.id).items)==1
        assert len(after['tools'])==len(before['tools'])+1
        calls=list(wire.fake.calls)
        assert worker(context,wire.fake,root/'worker-state').work(p,ws,q.run.id).state=='ready'
        assert snapshot(context,q.run.id)==after and wire.fake.calls==calls
    finally:wire.close()


def test_provider_revocation_before_prepared_selection(context,monkeypatch):
    s,p,ws,_,admin=context
    root=OUT/('provider-revoked-'+ws);root.mkdir()
    q,grant,tool,w,wire,before,tid,unknown,human=prepare(context,root,monkeypatch)
    try:
        saved=w.phases.state.load(ws,q.run.id)
        cap=WorkerCapability(**saved['worker']);ledger=Ledger(s,ReceiptCapability(**saved['receipt']))
        with s.db.transaction() as c:rc=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
        _,schema=contract(grant.responses)
        assert w._prepared_selection(ledger,cap,rc,schema)[1]==5
        with Database(admin).transaction() as c:c.execute('UPDATE provider_grants SET active=false WHERE id=%s',(grant.id,))
        with pytest.raises(DomainError):w._prepared_selection(ledger,cap,rc,schema)
        with pytest.raises(DomainError):w.work(p,ws,q.run.id)
        assert snapshot(context,q.run.id)==before and not wire.calls
        assert immutable_tool_rows(context,tid)==unknown
    finally:wire.close()
