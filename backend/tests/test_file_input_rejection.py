"""Restricted disposable PG, native file adapter, scripted HTTP only."""
from copy import deepcopy
from hashlib import sha256
from unittest.mock import patch
import pytest
import psycopg
from test_domain import context
from test_gateway_target_rejection import prepare as target_fixture, material
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_local_rejection_settlement import journal
from test_runtime import expire
from workagent.capabilities import registry, policy
from workagent.capabilities.models import CapabilityPin
from workagent.errors import DomainError
from workagent.db import Database
from workagent.responses_ledger import Ledger
from workagent.provider_attempts import ReceiptCapability
from workagent.service import WorkerCapability


def prepare(ctx):
    original = policy.install
    def install(db, grant, **kwargs):
        d = registry.adapters()['files.propose_patch'].descriptor
        grant = grant.model_copy(update={'capabilities':grant.capabilities + [CapabilityPin(
            id=d.id, version=d.version, schema_sha256=d.schema_sha256, implementation_sha256=d.implementation_sha256)],
            'effects':list(set(grant.effects + ['draft']))})
        return original(db, grant, **kwargs)
    with patch.object(policy, 'install', install):
        cv, q, grant, saved, _, _ = target_fixture(ctx)
    content = saved.current_revision.body.content + '\nNew submitted text é.\n'
    bad = dict(kind='files_propose_patch', ref=dict(workspace_file_id=saved.id,
        version_id=saved.current_revision_id, sha256=saved.current_revision.body.content_sha256),
        content=content, sha256=saved.current_revision.body.content_sha256, reason='Propose a reviewable change')
    good = {**bad, 'sha256':sha256(content.encode()).hexdigest()}
    return cv, q, grant, saved, bad, good


def test_mismatch_pre_dispatch_restart_new_selection(context, tmp_path):
    s,p,ws,_,_=context
    cv,q,g,saved,bad,good=prepare(context)
    fake=AlphaProvider([bad,good,{'kind':'reply','text':'A new authorized proposal awaits human review.'}])
    before=material(context)
    def hook(name):
        if name=='after_file_input_rejection':raise InterruptedError('retained input rejection')
    with pytest.raises(InterruptedError,match='retained input rejection'):
        finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    events=journal(s,ws,q.run.id); rejection=events['selection','file_input_rejection']
    assert rejection['feedback']['generated_text']['sha256']==good['sha256']
    assert rejection['feedback']['generated_text']['content']==bad['content']
    assert ('selection','tool_result') not in events
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchone()
    assert material(context)==before
    expire(context,q.run.id)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    assert s.get_artifact(p,ws,saved.id).current_revision==saved.current_revision
    assert len(s.proposals(p,ws,saved.id).items)==1
    assert journal(s,ws,q.run.id)['selection','file_input_rejection']==rejection
    with s.db.transaction() as c:
        calls=c.execute('SELECT call_id FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchall()
    assert calls==[{'call_id':'selection_2'}]
    after=material(context); sent=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==sent and material(context)==after


def historical(ctx, tmp_path, monkeypatch, *, after_commit=False):
    from dataclasses import replace
    import workagent.file_input_rejection as rejection
    s,p,ws,_,_=ctx
    cv,q,g,saved,bad,good=prepare(ctx)
    fake=AlphaProvider([good if after_commit else bad,good,{'kind':'reply','text':'New proposal awaits review.'}])
    w=worker(ctx,fake,tmp_path)
    before=material(ctx)
    with monkeypatch.context() as m:
        # Exercise the unchanged historical broker/adapter path, not a fabricated
        # owner-inserted unknown receipt. Pins remain those of the exact source.
        m.setattr(rejection,'retain',lambda *args:None)
        if after_commit:
            adapters=registry.adapters(); original=adapters['files.propose_patch']
            def lost_ack(*args):
                original.invoke_fenced(*args)
                raise RuntimeError('test-only lost acknowledgement after commit')
            adapters['files.propose_patch']=replace(original,invoke_fenced=lost_ack)
            m.setattr(registry,'adapters',lambda:adapters)
        with pytest.raises(DomainError) as err:
            finish_safe_visits(ctx,w,q.run.id)
        assert err.value.code.value=='action_unresolved'
    state=w.phases.state.load(ws,q.run.id)
    cap=WorkerCapability(**state['worker']); receipt=ReceiptCapability(**state['receipt'])
    ledger=Ledger(s,receipt); request,events=ledger.snapshot('selection',cap)
    with s.db.transaction() as c:
        attempt=c.execute('SELECT * FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchone()
        obs=c.execute("SELECT data FROM tool_attempt_events WHERE attempt_id=%s AND kind='observation'",(attempt['id'],)).fetchone()['data']
    assert obs['status']=='outcome_unknown' and obs['output'] is None
    assert ('selection','tool_result') not in journal(s,ws,q.run.id)
    if not after_commit:assert material(ctx)==before
    return cv,q,g,saved,bad,good,fake,w,cap,ledger,request,attempt


def immutable_tool_rows(ctx, tid):
    with ctx[0].db.transaction() as c:
        return {name:c.execute(f'SELECT to_jsonb(t) AS data FROM {name} t WHERE '+
            ('id=%s' if name=='tool_attempts' else 'attempt_id=%s')+' ORDER BY to_jsonb(t)::text',(tid,)).fetchall()
            for name in ['tool_attempts','tool_attempt_events','tool_cost_entries']}


def test_historical_exact_resolution_preserves_unknown_cost_restart(context,tmp_path,monkeypatch):
    from workagent.file_input_rejection import install_no_effect, tools_unresolved
    from workagent.capabilities.broker import CapabilityBroker
    s,p,ws,_,admin=context
    cv,q,g,saved,bad,good,fake,w,cap,ledger,request,attempt=historical(context,tmp_path,monkeypatch)
    before=immutable_tool_rows(context,attempt['id']); material_before=material(context)
    calls=list(fake.calls)
    with s.db.transaction() as c:assert tools_unresolved(c,ws,q.run.id)
    resolution=install_no_effect(Database(admin),attempt['id'],ledger.receipt.attempt_id,'selection')
    assert install_no_effect(Database(admin),attempt['id'],ledger.receipt.attempt_id,'selection')==resolution
    for statement in ['UPDATE file_input_no_effect_resolutions SET data=data WHERE tool_attempt_id=%s',
                      'DELETE FROM file_input_no_effect_resolutions WHERE tool_attempt_id=%s']:
        with pytest.raises(psycopg.Error),Database(admin).transaction() as c:
            c.execute(statement,(attempt['id'],))
    assert immutable_tool_rows(context,attempt['id'])==before and material(context)==material_before
    original=CapabilityBroker.call
    def no_old_call(self,call):
        assert call.call_id!='selection','historical call replayed'
        return original(self,call)
    monkeypatch.setattr(CapabilityBroker,'call',no_old_call)
    def hook(name):
        if name=='after_file_input_rejection':raise InterruptedError('resolved rejection retained')
    expire(context,q.run.id)
    with pytest.raises(InterruptedError):finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    assert fake.calls==calls
    rejected=journal(s,ws,q.run.id)['selection','file_input_rejection']
    assert rejected['feedback']['effect']=='historical_unknown_resolved_no_effect'
    assert rejected['resolution_sha256']
    assert material(context)==material_before
    expire(context,q.run.id)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    assert immutable_tool_rows(context,attempt['id'])==before
    assert s.get_artifact(p,ws,saved.id).current_revision==saved.current_revision
    assert len(s.proposals(p,ws,saved.id).items)==1
    assert install_no_effect(Database(admin),attempt['id'],ledger.receipt.attempt_id,'selection')==resolution
    with s.db.transaction() as c:
        assert not tools_unresolved(c,ws,q.run.id)
        cps=c.execute('SELECT data FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchall()
        assert cps and all(cp['data']['waiting']!='unknown' for cp in cps)
    after=material(context); calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==calls and material(context)==after


def test_historical_forged_resolution_and_material_denied(context,tmp_path,monkeypatch):
    from types import SimpleNamespace
    from workagent.file_input_rejection import install_no_effect
    from workagent.service import encoded
    s,p,ws,_,admin=context
    cv,q,g,saved,bad,good,fake,w,cap,ledger,request,attempt=historical(context,tmp_path,monkeypatch)
    before=immutable_tool_rows(context,attempt['id'])
    with s.db.transaction() as c:
        proof=c.execute('SELECT file_input_no_effect_evidence(%s,%s,%s) AS data',
            (attempt['id'],ledger.receipt.attempt_id,'selection')).fetchone()['data']
    assert proof is not None
    for key in ['provider_attempt_id','phase','call_sha256','descriptor_sha256','dispatch_sha256',
                'observation_sha256','costs_sha256','result_event_id','result_sha256','request_sha256','response_id']:
        forged={**proof,key:'forged'}
        with pytest.raises(psycopg.Error),Database(admin).transaction() as c:
            c.execute('INSERT INTO file_input_no_effect_resolutions VALUES (%s,%s)',(attempt['id'],encoded(forged)))
    forged=deepcopy(proof);forged['source_proof']['implementation_sha256']='0'*64
    with pytest.raises(psycopg.Error),Database(admin).transaction() as c:
        c.execute('INSERT INTO file_input_no_effect_resolutions VALUES (%s,%s)',(attempt['id'],encoded(forged)))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        install_no_effect(s.db,attempt['id'],ledger.receipt.attempt_id,'selection')
    # Deliberately add material attributed to this synthetic run: absence can no
    # longer be attested even though the old mismatched call remains immutable.
    with s.db.transaction() as c:
        actor,run,scope=s._check_capability(c,cap)
        s._propose_file_patch(c,actor,ws,saved.id,SimpleNamespace(base_version_id=saved.current_revision_id,
            base_sha256=bad['ref']['sha256'],content=good['content'],sha256=good['sha256'],reason='Ambiguity fixture',
            expected_work_version=scope.work_version,producer_run_id=run.id))
    with pytest.raises(psycopg.Error):install_no_effect(Database(admin),attempt['id'],ledger.receipt.attempt_id,'selection')
    assert immutable_tool_rows(context,attempt['id'])==before


def test_after_commit_unknown_not_resolvable_no_resend_checkpoint(context,tmp_path,monkeypatch):
    from workagent.file_input_rejection import install_no_effect, tools_unresolved
    from workagent.run_checkpoints import record
    from workagent.general_responses import completed_steps_are_settled, has_unresolved_attempt
    s,p,ws,_,admin=context
    cv,q,g,saved,bad,good,fake,w,cap,ledger,request,attempt=historical(context,tmp_path,monkeypatch,after_commit=True)
    before=immutable_tool_rows(context,attempt['id']); material_before=material(context); calls=list(fake.calls)
    assert len(s.proposals(p,ws,saved.id).items)==1
    with pytest.raises(DomainError):install_no_effect(Database(admin),attempt['id'],ledger.receipt.attempt_id,'selection')
    with s.db.transaction() as c:
        assert tools_unresolved(c,ws,q.run.id)
        assert not completed_steps_are_settled(c,ledger.receipt.attempt_id)
        assert has_unresolved_attempt(c,ws,cv.id,allow_completed_steps=True)
        _,run,scope=s._check_capability(c,cap)
        cp=record(s,c,run,scope,'selection','stop')
        assert cp.data.waiting=='unknown' and cp.data.next_safe_action=='reconcile'
    from workagent.models import new_id
    from workagent.service import encoded,digest
    safe=cp.data.model_dump(mode='json');safe.update(waiting='none',next_safe_action='resume_phase')
    with pytest.raises(psycopg.errors.RaiseException,match='unresolved tool effects'),s.db.transaction() as c:
        c.execute('INSERT INTO run_checkpoints(workspace_id,checkpoint_id,run_id,conversation_id,assignment_id,phase,'
            'checkpoint_kind,created_at,checkpoint_hash,data) '
            'SELECT workspace_id,%s,run_id,conversation_id,assignment_id,phase,checkpoint_kind,created_at,%s,%s '
            'FROM run_checkpoints WHERE checkpoint_id=%s',(new_id(),digest(safe),encoded(safe),cp.checkpoint_id))
    expire(context,q.run.id)
    with pytest.raises(DomainError):finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert fake.calls==calls and material(context)==material_before
    assert immutable_tool_rows(context,attempt['id'])==before


@pytest.mark.parametrize('change',['tool_revoke','provider_revoke','stale','cross_context','human_revision'])
def test_current_authority_before_rejection(context,tmp_path,monkeypatch,change):
    from workagent.file_input_rejection import retain
    from test_domain import context as disposable_context
    s,p,ws,_,admin=context
    cv,q,g,saved,bad,good=prepare(context)
    fake=AlphaProvider([bad]); w=worker(context,fake,tmp_path)
    original=Ledger.event; captured={}
    def event(self,c,phase,kind,data):
        if kind=='file_input_rejection':
            captured['proof']=data
            raise InterruptedError('before rejection retention')
        return original(self,c,phase,kind,data)
    with monkeypatch.context() as m:
        m.setattr(Ledger,'event',event)
        with pytest.raises(InterruptedError):finish_safe_visits(context,w,q.run.id)
    state=w.phases.state.load(ws,q.run.id)
    cap=WorkerCapability(**state['worker']); ledger=Ledger(s,ReceiptCapability(**state['receipt']))
    request,_=ledger.snapshot('selection',cap)
    if change=='stale':
        expire(context,q.run.id)
        fresh=s._claim_run(p,ws,q.run.id,responses_receipt=ledger.receipt)
        assert fresh.fence>cap.fence
    elif change=='cross_context':
        other=disposable_context.__wrapped__(); _,other_q,*_=prepare(other)
        cap=other[0].claim_run(other[1],other[2],other_q.run.id)
    elif change=='human_revision':
        from test_domain import cmd
        from workagent.workspace_file_models import EditWorkspaceFile
        current=s.get_conversation(p,ws,cv.id).conversation
        content=saved.current_revision.body.content+'\nA newer human edit.\n'
        s.edit_workspace_file(p,ws,saved.id,cmd(EditWorkspaceFile,
            expected_work_version=current.work_version,base_version_id=saved.current_revision_id,
            base_sha256=bad['ref']['sha256'],content=content,sha256=sha256(content.encode()).hexdigest()))
    else:
        with Database(admin).transaction() as c:
            if change=='tool_revoke':c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
            else:c.execute('UPDATE provider_grants SET active=false WHERE id=(SELECT grant_id FROM provider_attempts WHERE id=%s)',(ledger.receipt.attempt_id,))
    before=material(context); calls=list(fake.calls)
    with pytest.raises((DomainError,psycopg.Error)):retain(ledger,request,cap)
    if change!='cross_context':
        with pytest.raises(psycopg.Error),s.db.transaction() as c:
            ledger.event(c,'selection','file_input_rejection',captured['proof'])
    assert ('selection','file_input_rejection') not in journal(s,ws,q.run.id)
    assert material(context)==before and fake.calls==calls


def test_base_hash_strict_no_rejection_or_tool_dispatch(context,tmp_path):
    s,p,ws,_,_=context
    cv,q,g,saved,bad,good=prepare(context)
    bad=deepcopy(bad);bad['ref']['sha256']='0'*64
    before=material(context); fake=AlphaProvider([bad])
    with pytest.raises(DomainError):finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert material(context)==before
    assert ('selection','file_input_rejection') not in journal(s,ws,q.run.id)
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchone()


def test_phase_limit_partial_and_new_human_admission(context,tmp_path):
    from test_conversations import post
    from test_general_responses import target
    from workagent.general_responses import completed_steps_are_settled
    s,p,ws,_,_=context
    cv,q,g,saved,bad,good=prepare(context);fake=AlphaProvider([bad]*4)
    before=material(context)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='partial'
    events=journal(s,ws,q.run.id)
    assert events['selection_4','file_input_rejection']['terminal_outcome']=='step_limit'
    assert ('final','dispatch') not in events
    assert material(context)==before
    with s.db.transaction() as c:
        aid=c.execute('SELECT id FROM provider_attempts WHERE run_id=%s',(q.run.id,)).fetchone()['id']
        assert completed_steps_are_settled(c,aid)
        cp=c.execute("SELECT data FROM run_checkpoints WHERE run_id=%s AND checkpoint_kind='settlement'",(q.run.id,)).fetchone()['data']
        assert cp['waiting']=='none'
    detail=s.get_conversation(p,ws,cv.id)
    follow=post(context,detail.conversation,'Please review the original file again.',target=target(saved))
    assert follow.run.id!=q.run.id and follow.run.state=='queued'
    assert material(context)==before


def test_create_semantic_hash_rejection_preserves_malformed_result(context,tmp_path):
    from test_gateway_rejection_feedback import prepare as untargeted
    from test_workspace_files_pg import text
    s,p,ws,_,_=context
    cv,q,g=untargeted(context)
    source=text('NEW draft bytes: é\r\n').model_dump()
    good={'kind':'files_create_draft','source':source}
    bad=deepcopy(good);bad['source']['sha256']='0'*64
    def next_choice(ctx):
        observed=ctx['adaptive']['observations'][-1]
        assert observed['kind']=='file_input_rejection' and observed['status']=='rejected_no_effect'
        assert observed['feedback']['generated_text']['content']==source['content']
        assert observed['feedback']['generated_text']['sha256']==source['sha256']
        return good
    fake=AlphaProvider([bad,next_choice,{'kind':'reply','text':'A separately selected draft is retained.'}])
    def hook(name):
        if name=='after_file_input_rejection':raise InterruptedError('new semantic feedback retained')
    with pytest.raises(InterruptedError):finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    before=journal(s,ws,q.run.id)
    assert not s.get_conversation(p,ws,cv.id).artifact_ids
    expire(context,q.run.id)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    events=journal(s,ws,q.run.id)
    assert all(events[k]==v for k,v in before.items())
    assert events['selection','result']['state']=='malformed'
    assert events['selection','result']['issue']=='schema_validation_failed'
    assert ('selection','selection_rejection') not in events
    assert events['selection','file_input_rejection']['feedback']['generated_text']['sha256']==source['sha256']
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==1
    with s.db.transaction() as c:
        assert c.execute('SELECT call_id FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchall()==[{'call_id':'selection_2'}]


def test_new_module_bound_in_consumer_hash(monkeypatch):
    from pathlib import Path
    from workagent.general_responses import consumer_hash
    before=consumer_hash(); original=Path.read_bytes
    def changed(path):
        data=original(path)
        return data+b'\n# validation fixture\n' if path.name=='file_input_rejection.py' else data
    monkeypatch.setattr(Path,'read_bytes',changed)
    assert consumer_hash()!=before


def test_prepared_final_revalidates_file_rejection_without_replay(context,tmp_path):
    s,p,ws,_,_=context
    cv,q,g,saved,bad,good=prepare(context)
    fake=AlphaProvider([bad,good,{'kind':'reply','text':'A reviewable proposal exists.'}])
    def hook(name):
        if name=='after_count' and ('final','count_result') in journal(s,ws,q.run.id):
            raise InterruptedError('counted final')
    with pytest.raises(InterruptedError):
        finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    before=journal(s,ws,q.run.id); before_material=material(context); calls=list(fake.calls)
    expire(context,q.run.id)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    after=journal(s,ws,q.run.id)
    assert all(after[k]==v for k,v in before.items())
    assert len(fake.calls)==len(calls)+1
    assert material(context)==before_material
    assert len(s.proposals(p,ws,saved.id).items)==1


def test_file_rejection_forgery_denied(context,tmp_path,monkeypatch):
    s,p,ws,_,_=context
    cv,q,g,saved,bad,good=prepare(context);fake=AlphaProvider([bad]);w=worker(context,fake,tmp_path)
    original=Ledger.event; captured={}
    def event(self,c,phase,kind,data):
        if kind=='file_input_rejection':
            captured.update(ledger=self,data=deepcopy(data));raise InterruptedError('before retention')
        return original(self,c,phase,kind,data)
    with monkeypatch.context() as m:
        m.setattr(Ledger,'event',event)
        with pytest.raises(InterruptedError):finish_safe_visits(context,w,q.run.id)
    ledger=captured['ledger'];proof=captured['data']; before=material(context)
    mutations=[('worker_fence',0),('attempt_id','other'),('phase','selection_2'),('result_event_id','other'),
        ('result_sha256','0'*64),('request_sha256','0'*64),('response_id','other'),('decision_sha256','0'*64),
        ('resolution_sha256','0'*64),('terminal_outcome','completed'),('body',{'forged':'material'})]
    variants=[{**proof,key:value} for key,value in mutations]
    for key,value in [('content',bad['content']+'\n'),('sha256',bad['sha256']),('utf8_bytes',1)]:
        d=deepcopy(proof);d['feedback']['generated_text'][key]=value;variants.append(d)
    for d in variants:
        with pytest.raises(psycopg.Error),s.db.transaction() as c:ledger.event(c,'selection','file_input_rejection',d)
    assert ('selection','file_input_rejection') not in journal(s,ws,q.run.id)
    assert material(context)==before


@pytest.mark.parametrize('change',['revoked','stale','cross_context'])
def test_historical_resolution_does_not_grant_current_authority(context,tmp_path,monkeypatch,change):
    from workagent.file_input_rejection import install_no_effect, retain
    from test_domain import context as disposable_context
    s,p,ws,_,admin=context
    cv,q,g,saved,bad,good,fake,w,cap,ledger,request,attempt=historical(context,tmp_path,monkeypatch)
    install_no_effect(Database(admin),attempt['id'],ledger.receipt.attempt_id,'selection')
    before=immutable_tool_rows(context,attempt['id']); calls=list(fake.calls); before_material=material(context)
    if change=='revoked':
        with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
    elif change=='stale':
        expire(context,q.run.id)
        fresh=s._claim_run(p,ws,q.run.id,responses_receipt=ledger.receipt)
        assert fresh.fence>cap.fence
    else:
        other=disposable_context.__wrapped__();_,other_q,*_=prepare(other)
        cap=other[0].claim_run(other[1],other[2],other_q.run.id)
    with pytest.raises((DomainError,psycopg.Error)):retain(ledger,request,cap)
    assert ('selection','file_input_rejection') not in journal(s,ws,q.run.id)
    assert fake.calls==calls and immutable_tool_rows(context,attempt['id'])==before
    assert material(context)==before_material


def test_non_hash_schema_failure_stays_strict(context,tmp_path):
    from test_gateway_rejection_feedback import prepare as untargeted
    from test_workspace_files_pg import text
    s,p,ws,_,_=context;cv,q,g=untargeted(context)
    bad={'kind':'files_create_draft','source':{**text('new content').model_dump(),'sha256':'not-a-hash'}}
    fake=AlphaProvider([bad,{'kind':'reply','text':'The malformed choice was not executed.'}])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    events=journal(s,ws,q.run.id)
    assert ('selection','selection_rejection') in events
    assert ('selection','file_input_rejection') not in events
    assert not s.get_conversation(p,ws,cv.id).artifact_ids


def test_historical_resolution_phase_limit_then_new_human_admission(context,tmp_path,monkeypatch):
    from test_conversations import post
    from test_general_responses import target
    from workagent.file_input_rejection import install_no_effect
    from workagent.general_responses import has_unresolved_attempt
    s,p,ws,_,admin=context
    cv,q,g,saved,bad,good,fake,w,cap,ledger,request,attempt=historical(context,tmp_path,monkeypatch)
    before=immutable_tool_rows(context,attempt['id']); material_before=material(context)
    install_no_effect(Database(admin),attempt['id'],ledger.receipt.attempt_id,'selection')
    with s.db.transaction() as c:
        # Owner proof alone is not a consumption/current-authority exception.
        assert has_unresolved_attempt(c,ws,cv.id,allow_completed_steps=True)
    fake.decisions=[bad]*4
    expire(context,q.run.id)
    result=finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='partial' and result.stop_reason=='step_limit'
    assert result.unresolved and 'goal is incomplete' in result.unresolved[0]
    events=journal(s,ws,q.run.id)
    assert events['selection','file_input_rejection']['resolution_sha256']
    assert events['selection_4','file_input_rejection']['terminal_outcome']=='step_limit'
    assert ('final','dispatch') not in events
    assert immutable_tool_rows(context,attempt['id'])==before and material(context)==material_before
    with s.db.transaction() as c:
        assert not has_unresolved_attempt(c,ws,cv.id,allow_completed_steps=True)
    detail=s.get_conversation(p,ws,cv.id)
    next_turn=post(context,detail.conversation,'Review this unchanged file with a new action.',target=target(saved))
    assert next_turn.run.id!=q.run.id and next_turn.run.state=='queued'
    assert material(context)==material_before


def test_source_proof_exact_descriptor_and_transaction_sources(context):
    from pathlib import Path
    from workagent.service import digest
    with context[0].db.transaction() as c:
        proof=c.execute('SELECT file_input_source_proof() AS p').fetchone()['p']
    descriptor=registry.adapters()['files.propose_patch'].descriptor
    assert proof['descriptor_sha256']==digest(descriptor)
    assert proof['implementation_sha256']==descriptor.implementation_sha256==digest(proof['implementation_sources'])
    package=Path(__file__).resolve().parents[1]/'workagent'
    for name,expected in {**proof['implementation_sources'],**proof['support_sources']}.items():
        assert sha256((package/name).read_bytes()).hexdigest()==expected,name


def test_historical_076_rejection_keeps_original_classification_on_restart(context,tmp_path,monkeypatch):
    from test_gateway_rejection_feedback import prepare as untargeted
    from test_selection_rejection import BAD,good
    import workagent.file_input_rejection as file_rejection
    s,p,ws,_,_=context;cv,q,g=untargeted(context)
    fake=AlphaProvider([BAD,good,{'kind':'reply','text':'A new authorized draft is retained.'}])
    def hook(name):
        if name=='after_selection_rejection':raise InterruptedError('historical 076 receipt')
    with monkeypatch.context() as m:
        m.setattr(file_rejection,'retain',lambda *args:None)
        with pytest.raises(InterruptedError):finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    before=journal(s,ws,q.run.id)
    assert ('selection','selection_rejection') in before
    expire(context,q.run.id)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    after=journal(s,ws,q.run.id)
    assert all(after[k]==v for k,v in before.items())
    assert ('selection','file_input_rejection') not in after
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==1
    with s.db.transaction() as c:
        assert c.execute('SELECT call_id FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchall()==[{'call_id':'selection_2'}]


class GoalProvider(AlphaProvider):
    """Script complete envelopes; inspect real serialized next-request context."""
    def __init__(self,decisions,envelope):
        super().__init__(decisions)
        self.envelope=envelope;self.requests=[]

    def handle(self,request):
        import json
        import httpx
        response=super().handle(request)
        if request.method!='POST' or request.url.path.endswith('input_tokens'):
            return response
        body=json.loads(request.content);self.requests.append(body)
        phase=body['metadata']['step_id']
        if phase=='final':return response
        doc=response.json();call=doc['output'][0]
        value=json.loads(call['arguments'])
        value.update(self.envelope(phase,json.loads(body['input'][0]['content'])))
        call['arguments']=json.dumps(value)
        self.responses[doc['id']]=doc
        return httpx.Response(200,json=doc)


BOUND_118={'goal':'Preserve café Δ-118 and propose the exact reviewable edit.',
    'success_criteria':[{'kind':'wasm_return','arguments':[17,-3],'expected':'14'},
                        {'kind':'csv_totals','expected_sum':'118.25','mismatch_count':2}]}


def pause_rejected_next_request(ctx,q,fake,path):
    """Restart after rejection, then retain the actual counted second request."""
    import json
    s,p,ws,_,_=ctx
    def rejected(name):
        if name=='after_file_input_rejection':raise InterruptedError('retained rejection')
    with pytest.raises(InterruptedError,match='retained rejection'):
        finish_safe_visits(ctx,worker(ctx,fake,path,hook=rejected),q.run.id)
    before=journal(s,ws,q.run.id)
    expire(ctx,q.run.id)
    def counted(name):
        if name=='after_count' and ('selection_2','count_result') in journal(s,ws,q.run.id):
            raise InterruptedError('next request counted')
    with pytest.raises(InterruptedError,match='next request counted'):
        finish_safe_visits(ctx,worker(ctx,fake,path,hook=counted),q.run.id)
    with s.db.transaction() as c:
        body=c.execute("SELECT s.request_bytes FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id "
            "WHERE a.run_id=%s AND s.phase='selection_2'",(q.run.id,)).fetchone()['request_bytes']
    after=journal(s,ws,q.run.id)
    assert all(after[k]==v for k,v in before.items())
    assert ('selection_2','dispatch') not in after
    return json.loads(body),after


@pytest.mark.parametrize('change_criteria',[False,True])
def test_rejected_patch_next_request_preserves_bound_goal_on_restart(context,tmp_path,change_criteria):
    import json
    s,p,ws,_,_=context;cv,q,g,saved,bad,good=prepare(context)
    def envelope(phase,ctx):
        if phase=='selection':return deepcopy(BOUND_118)
        # Subsequent envelopes use only the values actually offered in this
        # request, not AlphaProvider's fixed default goal and empty criteria.
        first=ctx['adaptive']['observations'][0]
        value={k:deepcopy(first[k]) for k in BOUND_118}
        if change_criteria:value['success_criteria'][0]['expected']='15'
        return value
    fake=GoalProvider([bad,good,{'kind':'reply','text':'A new proposal awaits human review.'}],envelope)
    before_material=material(context)
    body,before=pause_rejected_next_request(context,q,fake,tmp_path)
    observed=json.loads(body['input'][0]['content'])['adaptive']['observations'][0]
    assert observed['kind']=='file_input_rejection'
    assert {k:observed[k] for k in BOUND_118}==BOUND_118
    assert before['selection','result']['state']=='function_call'
    assert material(context)==before_material
    expire(context,q.run.id)
    if change_criteria:
        with pytest.raises(DomainError) as err:
            finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
        assert err.value.code.value=='source_changed'
        with s.db.transaction() as c:
            assert not c.execute('SELECT 1 FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchone()
        assert material(context)==before_material
        calls=list(fake.calls);expire(context,q.run.id)
        with pytest.raises(DomainError) as err:
            finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
        assert err.value.code.value=='source_changed' and fake.calls==calls
    else:
        assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
        assert s.get_artifact(p,ws,saved.id).current_revision==saved.current_revision
        assert len(s.proposals(p,ws,saved.id).items)==1
        with s.db.transaction() as c:
            assert c.execute('SELECT call_id FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchall()==[{'call_id':'selection_2'}]
        calls=list(fake.calls);after_material=material(context)
        assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
        assert fake.calls==calls and material(context)==after_material
    assert [r for r in fake.requests if r['metadata']['step_id']=='selection_2']==[body]
    after=journal(s,ws,q.run.id)
    assert all(after[k]==v for k,v in before.items())


def test_malformed_create_rejection_does_not_establish_goal(context,tmp_path):
    import json
    from test_gateway_rejection_feedback import prepare as untargeted
    from test_workspace_files_pg import text
    s,p,ws,_,_=context;cv,q,g=untargeted(context)
    good={'kind':'files_create_draft','source':text('New independently selected draft.').model_dump()}
    bad=deepcopy(good);bad['source']['sha256']='0'*64
    new_bound={**deepcopy(BOUND_118),'goal':'A new valid goal after the malformed create.'}
    def envelope(phase,ctx):
        if phase=='selection':return deepcopy(BOUND_118)
        if phase=='selection_2':
            first=ctx['adaptive']['observations'][0]
            assert not any(k in first for k in BOUND_118)
            return deepcopy(new_bound)
        retained=ctx['adaptive']['observations'][-1]
        return {k:deepcopy(retained[k]) for k in BOUND_118}
    fake=GoalProvider([bad,good,{'kind':'reply','text':'A new draft is retained.'}],envelope)
    body,before=pause_rejected_next_request(context,q,fake,tmp_path)
    observed=json.loads(body['input'][0]['content'])['adaptive']['observations'][0]
    assert observed['kind']=='file_input_rejection' and not any(k in observed for k in BOUND_118)
    assert before['selection','result']['state']=='malformed'
    assert before['selection','result']['value'] is None
    assert not s.get_conversation(p,ws,cv.id).artifact_ids
    expire(context,q.run.id)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    after=journal(s,ws,q.run.id)
    assert all(after[k]==v for k,v in before.items())
    assert {k:after['selection_2','result']['value'][k] for k in BOUND_118}==new_bound
    assert [r for r in fake.requests if r['metadata']['step_id']=='selection_2']==[body]
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==1
