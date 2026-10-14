"""Negative, atomicity and exact-receipt regressions for local recording."""
from dataclasses import replace
import json
import httpx
import psycopg
import pytest
from pydantic import ValidationError
from test_domain import context, cmd, raises
from test_responsibility_action import record
from test_general_alpha_runtime import launch, AlphaProvider, activate
from test_general_responses import worker, totals
from test_conversations import conversation, post
from test_runtime import expire
from workagent.composition import AlphaDecision, RecordResponsibility
from workagent.models import CancelConversation, DelegateConversation, PostMessage, HumanSave
from workagent.provider_attempts import ReceiptCapability, revoke_grant
from workagent.service import WorkerCapability, encoded
from workagent.db import Database
from workagent.errors import DomainError


def saved_handles(w,ws,rid):
    saved=w.phases.state.load(ws,rid)
    return WorkerCapability(**saved['worker']),ReceiptCapability(**saved['receipt'])


def pause_before_stage(context,tmp_path,decisions=None,**kwargs):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,decisions or [record,{'kind':'reply','text':'Tracked locally.'}],**kwargs)
    original=s.stage_general_product
    def crash(*args,**kw): raise RuntimeError('receipt retained before mutation')
    s.stage_general_product=crash
    with pytest.raises(RuntimeError): w.work(p,ws,q.run.id)
    s.stage_general_product=original
    cap,receipt=saved_handles(w,ws,q.run.id)
    return cv,g,q,fake,w,cap,receipt


def test_atomic_rollback_no_orphan_and_receipt_replay(context,tmp_path,monkeypatch):
    from workagent.responses_ledger import Ledger
    s,p,ws,_,_=context
    cv,g,q,fake,w,cap,receipt=pause_before_stage(context,tmp_path)
    original=Ledger.event
    def fail(self,c,phase,kind,data):
        if kind=='tool_result': raise RuntimeError('fail after activation, before journaling')
        return original(self,c,phase,kind,data)
    with monkeypatch.context() as m:
        m.setattr(Ledger,'event',fail)
        with pytest.raises(RuntimeError): s.stage_general_product(cap,receipt)
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.assignment_ids==[]
    assert detail.conversation.work_version==2
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM outbox WHERE workspace_id=%s AND operation IN ('activate_responsibility','delegate_conversation','responsibility_wake')",(ws,)).fetchone()['n']==0
    first=s.stage_general_product(cap,receipt)
    assert first==s.stage_general_product(cap,receipt)
    assert len(s.get_conversation(p,ws,cv.id).assignment_ids)==1
    assert totals(s,g)['request_counts']['dispatch']==1
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'


@pytest.mark.parametrize('bad',['actor','workspace','closed','revoked','cas'])
def test_current_authority_fences_before_mutation(context,tmp_path,bad):
    s,p,ws,_,admin=context
    cv,g,q,fake,w,cap,receipt=pause_before_stage(context,tmp_path)
    baseline=[]
    if bad=='actor': cap=replace(cap,principal_id='someone-else')
    elif bad=='workspace': cap=replace(cap,workspace_id='somewhere-else')
    elif bad=='closed':
        current=s.get_conversation(p,ws,cv.id).conversation
        s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=current.work_version))
    elif bad=='revoked': revoke_grant(Database(admin),g.id)
    else:
        current=s.get_conversation(p,ws,cv.id).conversation
        a=s.delegate_conversation(p,ws,cv.id,cmd(DelegateConversation,expected_work_version=current.work_version,
            goal='A separate human delegation',completion_criteria=['Human verifies']))
        baseline=[a.id]
    with pytest.raises(DomainError): s.stage_general_product(cap,receipt)
    assert s.get_conversation(p,ws,cv.id).assignment_ids==baseline
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM assignments WHERE workspace_id=%s AND responsibility_recording IS NOT NULL',(ws,)).fetchone()['n']==0


@pytest.mark.parametrize('field,value',[('owner_id','elsewhere'),('principal_id','elsewhere'),
    ('workspace_id','elsewhere'),('grant_id','elsewhere'),('state','completed'),('acceptance','accepted'),('completion',True)])
def test_model_cannot_supply_authority(field,value):
    decision=record(); decision[field]=value
    with pytest.raises(ValidationError): RecordResponsibility.model_validate(decision,strict=True)


def test_unoffered_dependency_denied_through_worker(context,tmp_path):
    s,p,ws,_,_=context
    decision=record(); decision['plan']['dependencies']=[{'kind':'source_version','object_id':'external-mailbox','expected_version':'invented'}]
    cv,g,q,fake,w=launch(context,tmp_path,[decision])
    raises('not_found_or_not_authorized',lambda:w.work(p,ws,q.run.id))
    assert s.get_conversation(p,ws,cv.id).assignment_ids==[]


def test_final_count_failure_retains_success_not_a_published_artifact(context,tmp_path):
    s,p,ws,_,_=context
    class FailedFinalCount(AlphaProvider):
        def handle(self,request):
            body=json.loads(request.content) if request.content else {}
            if request.url.path.endswith('/input_tokens') and body.get('tool_choice')=='none':
                self.calls.append(('POST',request.url.path))
                return httpx.Response(500,json={'error':{'message':'synthetic count failure'}})
            return super().handle(request)
    cv=conversation(context); activate(context,cv)
    q=post(context,cv,'Keep track locally; wait for a person to update this conversation.')
    fake=FailedFinalCount([record,{'kind':'reply','text':'Locally retained.'}]); w=worker(context,fake,tmp_path)
    assert w.work(p,ws,q.run.id).state=='running'
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.assignment_ids)==1 and not detail.artifact_ids
    turn=detail.turns[0]
    assert turn.responsibility_recording.assignment_id==detail.assignment_ids[0]
    assert 'recording succeeded and is retained' in turn.reason and 'explanation is unfinished' in turn.reason
    assert turn.explanation is None and not turn.retained_local_result.published
    before=list(fake.calls); expire(context,q.run.id)
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert fake.calls==before
    assert s.get_conversation(p,ws,cv.id).assignment_ids==detail.assignment_ids


def test_recorded_dependency_and_local_message_reconcile_existing_lifecycle(context,tmp_path):
    from test_responsibilities import product, edit
    s,p,ws,_,_=context
    cv=conversation(context); artifact,_=product(context,cv)
    cv=s.get_conversation(p,ws,cv.id).conversation
    activate(context,cv)
    q=post(context,cv,'Track the local preparation and wait for a human update.')
    def dependency(ctx):
        d=record(); d['plan']['dependencies']=ctx['responsibility_offer']['dependencies']
        d['plan']['wait']={'kind':'dependency_change','reason':'Review a saved change.'}
        return d
    fake=AlphaProvider([dependency,{'kind':'reply','text':'Local ownership retained.'}])
    w=worker(context,fake,tmp_path)
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id); aid=detail.assignment_ids[0]
    before=s.get_responsibility(p,ws,aid)
    saved=edit(context,artifact,'Human-authored constraint survives; review this change.')
    after=s.get_responsibility(p,ws,aid)
    assert after.lifecycle.review_required and after.assignment.work_version>before.assignment.work_version
    assert next(d for d in after.lifecycle.observations if d.object_id==artifact.id).observed_version==saved.current_revision_id
    assert after.lifecycle.outcome_status=='needs_review'
    post(context,s.get_conversation(p,ws,cv.id).conversation,'Human update: waiting for another decision.')
    current=s.get_responsibility(p,ws,aid)
    assert current.lifecycle.conversation_work_version==s.get_conversation(p,ws,cv.id).conversation.work_version
    assert s.get_conversation(p,ws,cv.id).assignment_ids==[aid]
    assert s.get_artifact(p,ws,artifact.id).current_revision.body.notes==saved.current_revision.body.notes


def test_system_continuation_cannot_recursively_record(context,tmp_path):
    from test_responsibility_execution import setup, edit, admitted
    s,p,ws,_,_=context
    cv,art,a,g,life=setup(context)
    edit(context,art)
    s.advance_responsibilities(ws,g.id)
    rows=admitted(s,ws); assert len(rows)==1
    fake=AlphaProvider([record]); w=worker(context,fake,tmp_path)
    raises('not_found_or_not_authorized',lambda:w.work(p,ws,rows[0]['run_id']))
    assert s.get_conversation(p,ws,cv.id).assignment_ids==[a.id]


def test_sql_cannot_omit_or_forge_effect_receipt(context,tmp_path,monkeypatch):
    from workagent.responses_ledger import Ledger
    s,p,ws,_,_=context
    cv,g,q,fake,w,cap,receipt=pause_before_stage(context,tmp_path)
    original=Ledger.event
    for fault in ('omit','forge','missing_outcome','missing_reason'):
        def bad(self,c,phase,kind,data):
            if kind=='tool_result':
                if fault=='omit': return
                if fault=='forge': data={**data,'mutation_result':{**data['mutation_result'],'owner_id':'intruder'}}
                elif fault=='missing_outcome': data={k:v for k,v in data.items() if k!='terminal_outcome'}
                else: data={k:v for k,v in data.items() if k!='reason'}
            return original(self,c,phase,kind,data)
        with monkeypatch.context() as m:
            m.setattr(Ledger,'event',bad)
            with pytest.raises(psycopg.Error,match='(atomic responsibility|exact receipt-bound|retained local ownership)'):
                s.stage_general_product(cap,receipt)
        assert s.get_conversation(p,ws,cv.id).assignment_ids==[]


def test_exact_target_is_rechecked_after_recording_and_lost_ack(context,tmp_path):
    from test_responsibilities import product, edit
    from test_general_responses import target
    s,p,ws,_,_=context
    cv=conversation(context); artifact,_=product(context,cv)
    activate(context,s.get_conversation(p,ws,cv.id).conversation)
    q=post(context,s.get_conversation(p,ws,cv.id).conversation,
        'Track this local handoff.',target=target(artifact))
    fake=AlphaProvider([record,{'kind':'reply','text':'Recorded locally.'}]); w=worker(context,fake,tmp_path)
    def interrupt(name):
        if name=='after_tool_result': raise RuntimeError('lost ACK')
    w.phases.hook=interrupt
    with pytest.raises(RuntimeError): w.work(p,ws,q.run.id)
    cap,receipt=saved_handles(w,ws,q.run.id)
    first=s.stage_general_product(cap,receipt)
    saved=edit(context,artifact,'A human edits the exact saved target after recording.')
    with pytest.raises(DomainError): s.stage_general_product(cap,receipt)
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.assignment_ids==[first['mutation_result']['assignment_id']]
    assert s.get_artifact(p,ws,artifact.id).current_revision_id==saved.current_revision_id


def test_cross_conversation_local_dependency_is_not_offered(context,tmp_path):
    from test_responsibilities import product
    s,p,ws,_,_=context
    other=conversation(context); artifact,_=product(context,other)
    decision=record()
    decision['plan']['dependencies']=[{'kind':'artifact_revision','object_id':artifact.id,
        'expected_version':artifact.current_revision_id}]
    cv,g,q,fake,w=launch(context,tmp_path,[decision])
    raises('not_found_or_not_authorized',lambda:w.work(p,ws,q.run.id))
    assert s.get_conversation(p,ws,cv.id).assignment_ids==[]


def test_concurrent_exact_receipt_replay_commits_once(context,tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    s,p,ws,_,_=context
    cv,g,q,fake,w,cap,receipt=pause_before_stage(context,tmp_path)
    with ThreadPoolExecutor(max_workers=3) as pool:
        values=list(pool.map(lambda _:s.stage_general_product(cap,receipt),range(3)))
    assert all(value==values[0] for value in values)
    assert s.get_conversation(p,ws,cv.id).assignment_ids==[values[0]['mutation_result']['assignment_id']]
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM responses_events WHERE attempt_id=%s AND kind='tool_result'",(receipt.attempt_id,)).fetchone()['n']==1


@pytest.mark.parametrize('bad',['dependency_wait','check_in','duplicate','state','external_kind'])
def test_existing_plan_constraints_remain_closed(bad):
    decision=record(); plan=decision['plan']
    if bad=='dependency_wait': plan['wait']['kind']='dependency_change'
    elif bad=='check_in': plan['wait']['kind']='check_in'
    elif bad=='state': plan['state']='completed'
    elif bad=='external_kind': plan['dependencies']=[{'kind':'mailbox','object_id':'mail','expected_version':'1'}]
    else:
        dep={'kind':'source_version','object_id':'source','expected_version':'1'}
        plan['dependencies']=[dep,dep]
    with pytest.raises(ValidationError): RecordResponsibility.model_validate(decision,strict=True)
