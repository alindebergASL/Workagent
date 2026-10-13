"""Desired-behavior regressions: real restricted disposable PG, mock HTTP only."""
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest

from test_domain import context, cmd
from test_responsibility_execution import setup, edit, activate, admitted, dispatch, answer
from test_responsibilities import product, delegate, conversation
from test_general_alpha_runtime import AlphaProvider
from test_runtime import expire
from workagent.responsibility_models import (ActivateResponsibility, UpdateResponsibility,
    ResponsibilityNextAction, ResponsibilityDependency, ResponsibilityWait)
from workagent.models import HumanSave
from workagent.service import Principal, Service


def second_responsibility(context):
    s,p,ws,_,_=context
    cv,art1,a1,_,_=setup(context,grant=False)
    art2,_=product(context,cv)
    a2=delegate(context,cv,'Independent second responsibility')
    g=activate(context,cv)
    s.activate_responsibility(p,ws,a2.id,cmd(ActivateResponsibility,
        expected_work_version=a2.work_version,current_outcome='Waiting for the second dependency',
        next_action=ResponsibilityNextAction(kind='await_event',description='Wait for a change'),
        dependencies=[ResponsibilityDependency(kind='artifact_revision',object_id=art2.id,expected_version=art2.current_revision_id)],
        wait=ResponsibilityWait(kind='dependency_change',reason='Not yet changed')))
    return cv,art1,a1,art2,a2,g


def concurrent_advance(s,ws,g):
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _:Service(s.db).advance_responsibilities(ws,g.id),range(4)))


@pytest.mark.parametrize('revoke_before_retry',[False,True])
def test_busy_after_tool_result_keeps_same_wake_and_retries_once(context,tmp_path,revoke_before_retry):
    s,p,ws,_,_=context
    cv,art1,a1,art2,a2,g=second_responsibility(context)
    edit(context,art1)
    s.advance_responsibilities(ws,g.id)
    rid=admitted(s,ws)[0]['run_id']
    d,fake,w=dispatch(context,tmp_path,g)
    observed=[]
    def while_busy(name):
        if name!='after_tool_result': return
        edit(context,art2,'Second dependency now needs review')
        before=s.get_responsibility(p,ws,a2.id)
        concurrent_advance(s,ws,g)
        state=s.get_responsibility(p,ws,a2.id)
        observed.append((before,state))
    w.phases.hook=while_busy
    assert w.work(p,ws,rid).state=='ready'
    assert s.get_provider_attempt(p,ws,rid).state=='reconciled'
    assert len(observed)==1
    before,pending=observed[0]
    assert pending.lifecycle.state=='active'
    assert pending.lifecycle.execution_status=='not_admitted'
    assert pending.lifecycle.wake_id==before.lifecycle.wake_id
    assert pending.assignment.work_version==before.assignment.work_version
    calls=list(fake.calls)
    if revoke_before_retry:
        from workagent.db import Database
        from workagent.provider_attempts import revoke_grant
        revoke_grant(Database(context[4]),g.id)
        concurrent_advance(s,ws,g)
        state=s.get_responsibility(p,ws,a2.id)
        assert state.lifecycle.blocker=='grant_required'
        assert state.lifecycle.run_id is None
        assert len(admitted(s,ws))==1 and fake.calls==calls
        return
    concurrent_advance(s,ws,g)
    for _ in range(3): Service(s.db).advance_responsibilities(ws,g.id)
    state=s.get_responsibility(p,ws,a2.id)
    assert state.lifecycle.execution_status=='queued'
    assert state.lifecycle.wake_id==pending.lifecycle.wake_id
    assert state.assignment.work_version==pending.assignment.work_version
    assert len(admitted(s,ws))==2 and fake.calls==calls
    d,fake2,w=dispatch(context,tmp_path,g)
    assert w.work(p,ws,state.lifecycle.run_id).state=='ready'
    concurrent_advance(s,ws,g)
    assert len(admitted(s,ws))==2
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM outbox WHERE workspace_id=%s AND id=%s AND consumed_at IS NOT NULL",
            (ws,pending.lifecycle.wake_id)).fetchone()['n']==1


@pytest.mark.parametrize('phase',['selection','final'])
def test_unknown_attempt_holds_other_wake_without_resend(context,tmp_path,phase):
    s,p,ws,_,_=context
    cv,art1,a1,art2,a2,g=second_responsibility(context)
    edit(context,art1)
    fake=AlphaProvider([answer],lose_phase=phase)
    d,_,_=dispatch(context,tmp_path,g,fake)
    d.once()
    first=admitted(s,ws)[0]
    attempt=s.get_provider_attempt(p,ws,first['run_id'])
    edit(context,art2)
    wake=s.get_responsibility(p,ws,a2.id).lifecycle.wake_id
    calls=list(fake.calls)
    expire(context,first['run_id'])
    for _ in range(3):
        concurrent_advance(s,ws,g)
        d,_,_=dispatch(context,tmp_path,g,fake)
        d.once()
    life=s.get_responsibility(p,ws,a2.id).lifecycle
    assert life.wake_id==wake and life.run_id is None
    assert 'explicit resolution' in life.current_outcome
    assert len(admitted(s,ws))==1 and fake.calls==calls
    assert s.get_provider_attempt(p,ws,first['run_id']).id==attempt.id


def test_aggregate_dependencies_rejected_atomically_and_corrected_context_recovers(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,_,_=setup(context,grant=False)
    other,_=product(context,cv)
    g=activate(context,cv)
    life=s.get_responsibility(p,ws,a.id)
    s.update_responsibility(p,ws,a.id,cmd(UpdateResponsibility,
        expected_work_version=life.assignment.work_version,current_outcome='Review both bounded dependencies',
        next_action=ResponsibilityNextAction(kind='continue_work',description='Review changes'),
        dependencies=[ResponsibilityDependency(kind='artifact_revision',object_id=x.id,expected_version=x.current_revision_id) for x in (art,other)],
        wait=ResponsibilityWait(kind='dependency_change',reason='Await change')))
    for item in (art,other):
        body=item.current_revision.body.model_copy(deep=True)
        body.notes=['x'*10000 for _ in range(14)]
        s.human_save(p,ws,item.id,cmd(HumanSave,expected_current_revision_id=item.current_revision_id,body=body))
    d,fake,w=dispatch(context,tmp_path,g)
    d.once()
    assert admitted(s,ws)==[]
    blocked=s.get_responsibility(p,ws,a.id)
    assert blocked.lifecycle.execution_status=='blocked'
    assert 'context' in blocked.lifecycle.current_outcome.lower()
    assert 'bound' in blocked.lifecycle.current_outcome.lower()
    assert 'plan' in blocked.lifecycle.current_outcome.lower()
    for _ in range(3): Service(s.db).advance_responsibilities(ws,g.id)
    assert s.get_responsibility(p,ws,a.id).model_dump()==blocked.model_dump()
    assert not fake.calls
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM runs WHERE workspace_id=%s AND data->>'state'='queued'",(ws,)).fetchone()['n']==0
        assert c.execute("SELECT count(*) n FROM conversation_messages WHERE workspace_id=%s AND author_kind='system'",(ws,)).fetchone()['n']==0
        assert c.execute('SELECT consumed_at FROM outbox WHERE workspace_id=%s AND id=%s',
            (ws,blocked.lifecycle.wake_id)).fetchone()['consumed_at'] is None
    # Human material corrections, not silent truncation or discarded obligations.
    edits=[edit(context,item,'Corrected bounded dependency '+str(i)) for i,item in enumerate((art,other))]
    captured=[]
    def check_context(ctx):
        captured.append(ctx)
        assert len(ctx['dependencies'])==2
        assert {d['binding']['observed_version'] for d in ctx['dependencies']}=={x.current_revision_id for x in edits}
        assert {d['content']['notes'][0] for d in ctx['dependencies']}=={'Corrected bounded dependency 0','Corrected bounded dependency 1'}
        return answer(ctx)
    d,fake,w=dispatch(context,tmp_path,g,AlphaProvider([check_context]))
    d.once()
    if fake.failures: raise fake.failures[0]
    assert len(admitted(s,ws))==1 and admitted(s,ws)[0]['data']['state']=='ready'
    assert captured


def test_two_conversation_grant_cannot_redirect_system_request(context,monkeypatch):
    import test_general_alpha_runtime as alpha
    s,p,ws,_,_=context
    cv,art,a,_,_=setup(context,grant=False)
    other=conversation(context)
    original_configure=alpha.configure_grant
    def install_two(db,grant):
        b=grant.responses.model_copy(update={'conversation_ids':[cv.id,other.id]})
        return original_configure(db,grant.model_copy(update={'responses':b}))
    with monkeypatch.context() as m:
        m.setattr(alpha,'configure_grant',install_two)
        g=alpha.activate(context,cv)
    edit(context,art)
    detail=s.reconcile_responsibility(Principal(p.id,'worker'),ws,a.id)
    cap=s.claim_responsibility_wake(Principal(p.id,'worker'),ws,a.id,detail.assignment.work_version)
    append=s._append_message
    def wrong_request(c,workspace,message):
        assert message.author_kind=='system'
        append(c,workspace,message.model_copy(update={'conversation_id':other.id,'sequence':1}))
    with monkeypatch.context() as m:
        m.setattr(s,'_append_message',wrong_request)
        with pytest.raises(psycopg.errors.ForeignKeyViolation,match='message_exact_run_conversation'):
            s.continue_responsibility(cap,g.id)
    assert admitted(s,ws)==[]
    assert not s.get_conversation(p,ws,other.id).messages
    # Same valid capability remains usable after the denied atomic transaction.
    run=Service(s.db).continue_responsibility(cap,g.id)
    assert run.id in [r.id for r in s.get_conversation(p,ws,cv.id).runs]
    assert not s.get_conversation(p,ws,other.id).messages
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM conversation_messages m JOIN runs r ON r.workspace_id=m.workspace_id AND r.id=m.run_id WHERE m.workspace_id=%s AND m.conversation_id<>r.conversation_id',(ws,)).fetchone()


def test_admission_and_worker_use_identical_full_context(context,monkeypatch):
    from workagent.service import canonical
    from workagent.conversations import profile
    s,p,ws,_,_=context
    cv,art,a,g,_=setup(context)
    edit(context,art)
    materialize=s._materialize_general_context
    captured=[]
    def capture(*args):
        result=materialize(*args)
        captured.append(result[0])
        return result
    monkeypatch.setattr(s,'_materialize_general_context',capture)
    s.advance_responsibilities(ws,g.id)
    assert len(captured)==1  # Admission, before any claim or HTTP.
    row=admitted(s,ws)[0]
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,row['run_id'])).fetchone()
    cap=Service(s.db).claim_run(p,ws,row['run_id'])
    worker_context=Service(s.db).conversation_worker_context(cap)
    assert canonical(captured[0])==canonical(worker_context)
    assert len(canonical(worker_context).encode())<=profile(row['data']['profile'])['max_context_bytes']
    assert len(worker_context['dependencies'])==1
