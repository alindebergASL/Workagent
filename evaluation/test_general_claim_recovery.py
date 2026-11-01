"""Populated claim180 recovery; disposable PG + serial cold jail + loopback only."""
from dataclasses import asdict
from datetime import timedelta
from hashlib import sha256
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import httpx
import pytest
from test_timing_recovery import context,AcknowledgedProvider,diagnostic_prompt
from test_final_resume import Wire,snapshot,events_by_key,wait_natural_expiry
from test_gateway_target_rejection import material
from test_file_input_rejection import immutable_tool_rows,GoalProvider
from test_workspace_files_pg import make
from test_general_responses import target
from test_conversations import post
from test_general_alpha_runtime import activate
from test_adaptive_execution import finish_safe_visits
from test_memory_full_tools import config
from workagent.adaptive import contract
from workagent.models import now,new_id
from workagent.capabilities import registry,policy
from workagent.capabilities.models import ToolGrantV1,CapabilityPin,InputRef
from workagent.db import Database
from workagent.general_worker import GeneralWorker
from workagent.responses_transport import ResponsesTransport
from workagent.responses_ledger import Ledger
from workagent.provider_attempts import ReceiptCapability
from workagent.service import WorkerCapability
from workagent.errors import DomainError
from diagnose_timing_recovery import cold,capture,save,REPO

OUT=REPO/'.local/batch3/b35c/timing-recovery/implementation-01'


def authorize(ctx,cv,q,grant,human):
    _,p,ws,_,admin=ctx
    ds=[registry.adapters()[n].descriptor for n in
        ('context.read','capabilities.discover_legacy','files.read_range','files.propose_patch')]
    ref=InputRef(kind='workspace_file',id=human.id,version=human.current_revision_id,
        sha256=human.current_revision.body.content_sha256)
    tool=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,
            implementation_sha256=d.implementation_sha256) for d in ds],resource_selectors=[ref],
        effects=['read','draft','local_compute'],privacy_classes=['workspace_private'],egress='none',
        expires_at=now()+timedelta(hours=2),access_generation=q.run.access_generation,
        budget_account_id=new_id(),allow_run_outputs=True)
    policy.install(Database(admin),tool,limits={'local_compute':20},provider_grant_id=grant.id)


def local_worker(ctx,fake,state,*,origin='http://127.0.0.1:1',hook=None):
    transport=ResponsesTransport.synthetic(httpx.MockTransport(fake.handle),origin=origin)
    transport._client.timeout=httpx.Timeout(.1)  # only immediate preparation
    return GeneralWorker(ctx[0],transport=transport,state=state,enable_responses=True,hook=hook)


def prepare(ctx,root):
    s,p,ws,_,_=ctx
    original,pending=capture()
    first=json.loads(json.loads(original['steps'][0]['request_bytes'])['input'][0]['content'])
    cv,file,_=make(ctx,first['target_body']['body']['content'])
    human=s.get_artifact(p,ws,file.workspace_file_id)
    instructions,schema=contract(SimpleNamespace(**config('off')['responses']))
    # Fixture helper constants only; no claim/authority primitive is replaced.
    with patch('test_general_alpha_runtime.POLICY',instructions),patch('test_general_alpha_runtime.DECISION_SCHEMA',schema):
        grant=activate(ctx,cv,continuity_version='sustained-v1',max_steps=8,memory_recall='off')
    ref=dict(workspace_file_id=human.id,version_id=human.current_revision_id,
        sha256=human.current_revision.body.content_sha256)
    read=dict(kind='files_read_range',ref=ref,offset=0,limit=8192)
    changed=human.current_revision.body.content+'\nSynthetic prior proposal; never human accepted.\n'
    proposal=dict(kind='files_propose_patch',ref=ref,content=changed,
        sha256=sha256(changed.encode()).hexdigest(),reason='Retain a proposed edit for human review')
    prior=post(ctx,cv,'Read this exact human file and propose one edit; do not accept it.',target=target(human))
    authorize(ctx,cv,prior,grant,human)
    fake_prior=GoalProvider([read,proposal,dict(kind='reply',text='A proposal awaits human review.')],
        lambda *a:dict(goal='Retain a reviewable proposal',success_criteria=[]))
    wprior=local_worker(ctx,fake_prior,root/'prior-state')
    try:assert finish_safe_visits(ctx,wprior,prior.run.id).state=='ready'
    finally:wprior.transport.close()
    assert len(s.proposals(p,ws,human.id).items)==1
    assert s.get_artifact(p,ws,human.id).current_revision==human.current_revision
    cv=s.get_conversation(p,ws,cv.id).conversation
    q=post(ctx,cv,diagnostic_prompt(first),target=target(human))
    authorize(ctx,cv,q,grant,human)
    results={e['phase']:e['data'] for e in original['events'] if e['kind']=='tool_result'}
    goal={key:results['selection'][key] for key in ('goal','success_criteria')}
    fake=AcknowledgedProvider([results['selection']['decision'],results['selection_2']['decision'],read,
        dict(kind='reply',text='Prior proposal and protected human file are retained.')],lambda *a:goal)
    wire=Wire(fake,root);counts=0
    def hook(name):
        nonlocal counts
        if name=='after_count':
            counts+=1
            if counts==3:raise InterruptedError('counted third')
    w=local_worker(ctx,fake,root/'state',origin=wire.origin,hook=hook)
    try:
        with pytest.raises(InterruptedError,match='counted third'):finish_safe_visits(ctx,w,q.run.id)
    except BaseException:
        wire.close();raise
    finally:w.transport.close()
    before=snapshot(ctx,q.run.id)
    assert len(before['steps'])==3
    assert set(k for phase,k in events_by_key(before) if phase=='selection_3')=={'count_send','count_result'}
    with s.db.transaction() as c:
        tids=[r['id'] for r in c.execute('SELECT id FROM tool_attempts WHERE workspace_id=%s ORDER BY id',(ws,)).fetchall()]
    native={tid:immutable_tool_rows(ctx,tid) for tid in tids}
    save(root/'FIXTURE.json',dict(prior_run=prior.run.id,current_run=q.run.id,prior_proposals=1,
        original_request_sha256=pending['request_sha256'],original_request_bytes=len(pending['request_bytes'].encode()),
        prepared_sha256=before['steps'][-1]['request_sha256'],prepared_bytes=len(before['steps'][-1]['request_bytes'].encode()),
        differences=['Fresh scoped synthetic authority; no copied funding.',
            'Real prior native read/patch/reply/final history and current two settled read/discovery selections.',
            'One unaccepted proposal; no original exports/unknown-resolution, fresh identities and timestamps.']))
    return q,grant,human,wire,before,native


def visit(ctx,root,q,wire,label,*,fault='none'):
    wait_natural_expiry(ctx,q)
    child=root/label;child.mkdir()
    s,p,ws,_,_=ctx
    return cold(s,p.id,ws,q.run.id,child,root/'state',mode='synthetic',origin=wire.origin,
        execution='controlled_recovery',fault=fault)


def unchanged_native(ctx,native):
    assert all(immutable_tool_rows(ctx,tid)==rows for tid,rows in native.items())


def test_populated_counted_third_cold_recovery(context):
    root=OUT/('populated-'+context[2]);root.mkdir()
    q,grant,human,wire,before,native=prepare(context,root)
    try:
        human_before=material(context)
        report=visit(context,root,q,wire,'before-reservation',fault='before_reservation')
        assert report['returncode']==0 and snapshot(context,q.run.id)==before and not wire.calls
        handoff=next(e for e in report['trace']['events'] if e['event']=='reservation_ready_callback')
        assert handoff['allowed'] and handoff['lease_remaining']>105
        # One new claim after natural expiry. Stop after the real committed
        # identity; recovery must GET that identity, never recreate selection3.
        report=visit(context,root,q,wire,'after-identity',fault='after_identity')
        assert report['returncode']==0
        mid=snapshot(context,q.run.id);events=events_by_key(mid)
        assert ('selection_3','identity') in events and ('selection_3','result') not in events
        rid=events['selection_3','identity']['response_id']
        assert len(wire.calls)==1 and wire.calls[0]['path']=='/v1/responses'
        # Normal bounded visits. A deadline deferral is retained, with every
        # preceding immutable row and exact prepared request checked each time.
        previous=mid
        for index in range(4):
            report=visit(context,root,q,wire,'continue-'+str(index))
            assert report['returncode']==0
            current=snapshot(context,q.run.id)
            assert all(row in current['steps'] for row in previous['steps'])
            assert all(row in current['events'] for row in previous['events'])
            unchanged_native(context,native)
            previous=current
            if context[0].get_run(context[1],context[2],q.run.id).state=='ready':break
        else:pytest.fail('four bounded natural-expiry visits did not complete; traces retained')
        after=snapshot(context,q.run.id);events=events_by_key(after)
        assert all(row in after['steps'] for row in before['steps'])
        for phase in ('selection_3','selection_4','final'):
            for kind in ('count_send','count_result','dispatch','identity','result'):
                assert sum(e['phase']==phase and e['kind']==kind for e in after['events'])==1
        assert sum(e['phase']=='selection_3' and e['kind']=='count_send' for e in after['events'])==1
        assert sum(e['phase']=='selection_3' and e['kind']=='dispatch' for e in after['events'])==1
        assert sum(e['phase']=='selection_3' and e['kind']=='identity' for e in after['events'])==1
        assert sum(e['phase']=='selection_3' and e['kind']=='result' for e in after['events'])==1
        assert [c['sha256'] for c in wire.calls if c['path']=='/v1/responses' and c['phase']=='selection_3']==[
            next(r['request_sha256'] for r in before['steps'] if r['phase']=='selection_3')]
        assert sum(c['method']=='GET' and c['path']=='/v1/responses/'+rid for c in wire.calls)==1
        assert events['selection_4','tool_result']['terminal_outcome']=='answered'
        assert ('final','result') in events
        assert material(context)==human_before
        assert context[0].get_artifact(context[1],context[2],human.id).current_revision==human.current_revision
        assert len(after['tools'])==len(before['tools'])+1
        save(root/'PROOF.json',dict(status='PASS',handoff=handoff,handoff_headroom_seconds=handoff['lease_remaining']-105,
            wire=wire.calls,prior_native_rows_preserved=True,
            counts=1,creates=1,identities=1,exact_gets=1,result=1,final_ready=True,original_authority=False))
    finally:wire.close()


def test_populated_committed_unknown_no_resend(context):
    root=OUT/('unknown-'+context[2]);root.mkdir()
    q,grant,human,wire,before,native=prepare(context,root)
    try:
        report=visit(context,root,q,wire,'committed',fault='after_dispatch')
        assert report['returncode']==0 and not wire.calls
        mid=snapshot(context,q.run.id);events=events_by_key(mid)
        assert ('selection_3','dispatch') in events and ('selection_3','identity') not in events
        report=visit(context,root,q,wire,'restart')
        assert report['returncode']==0 and snapshot(context,q.run.id)==mid and not wire.calls
        unchanged_native(context,native)
        save(root/'PROOF.json',dict(status='PASS',committed_unknown_preserved=True,wire_calls=0,no_resend=True))
    finally:wire.close()


@pytest.mark.parametrize('denial',['revoke','fence','budget'])
def test_post_reservation_authority_denies_http(context,denial):
    root=OUT/(denial+'-'+context[2]);root.mkdir()
    q,grant,human,wire,before,native=prepare(context,root)
    s,p,ws,_,admin=context
    try:
        def change(name):
            if name!='after_predispatch':return
            # Ordinary postcommit hook changes ONLY disposable current authority.
            # No reservation refund, receipt rewrite or grant reactivation.
            with Database(admin).transaction() as c:
                if denial=='revoke':c.execute('UPDATE provider_grants SET active=false WHERE id=%s',(grant.id,))
                elif denial=='fence':c.execute("UPDATE runs SET data=jsonb_set(data,'{fence}',to_jsonb((data->>'fence')::int+1)) WHERE workspace_id=%s AND id=%s",(ws,q.run.id))
                else:c.execute("UPDATE runs SET data=jsonb_set(data,'{used_units}',data->'budget_units') WHERE workspace_id=%s AND id=%s",(ws,q.run.id))
        # Same product claim/reserve/postcommit gate; local mock callback records
        # actual sends separately from the cold transport proof above.
        sent=len(wire.fake.calls)
        w=local_worker(context,wire.fake,root/'state',origin=wire.origin,hook=change)
        try:
            try:w.work(p,ws,q.run.id)
            except DomainError:pass
        finally:w.transport.close()
        after=snapshot(context,q.run.id);events=events_by_key(after)
        assert ('selection_3','dispatch') in events and ('selection_3','identity') not in events
        assert len(wire.fake.calls)==sent and not wire.calls
        assert all(e in after['events'] for e in before['events'])
        unchanged_native(context,native)
        save(root/'PROOF.json',dict(status='PASS',denial=denial,committed_dispatch_retained=True,provider_sends=0))
    finally:wire.close()
