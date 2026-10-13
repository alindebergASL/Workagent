"""Controlled Responses HTTP through the production worker, restricted fresh PG.

Fixture prose is not a claim about live model quality. No provider/network calls.
"""
import json
from dataclasses import replace

import httpx
import psycopg
import pytest
from pydantic import ValidationError

from test_domain import context, cmd
from test_responsibilities import conversation, delegate, product
from test_general_alpha_runtime import AlphaProvider as SequenceProvider
from test_general_responses import worker, totals
from test_runtime import expire
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import (PostMessage, HumanSave, ControlAssignment, ConversationMessage,
                              Run, now, new_id)
from workagent.provider_attempts import revoke_grant
from workagent.responsibility_models import (ActivateResponsibility, ResponsibilityDependency,
    ResponsibilityNextAction, ResponsibilityWait, ControlResponsibility)
from workagent.responses_dispatcher import ResponsesDispatcher
from workagent.service import Service, Principal, encoded


def activate(ctx,cv,*,max_runs=10):
    from hashlib import sha256
    from workagent.models import ProviderGrant, GeneralAlphaResponsesBinding
    from workagent.general_responses import consumer_hash, AUTHORIZATION_HASH
    from workagent.composition import POLICY, DECISION_SCHEMA
    from workagent.general_schema import EXPLANATION_SCHEMA
    from workagent.provider_attempts import configure_grant
    s,p,ws,_,admin=ctx
    return configure_grant(Database(admin),ProviderGrant(id=new_id(),workspace_id=ws,principal_id=p.id,
        profile='general-responses-v1',model='gpt-6.1-sol',consumer_sha256=consumer_hash(),expires_at=None,
        max_runs=max_runs,max_received_output_tokens=16384,responses=GeneralAlphaResponsesBinding(
            runtime_extension='general-alpha-v1',project_id='proj_'+ws,
            secret_reference='file:/synthetic/not-a-key',transport_mode='synthetic',
            instructions_sha256=sha256(POLICY.encode()).hexdigest(),schema_sha256=sha256(EXPLANATION_SCHEMA.material).hexdigest(),
            scope_tool_sha256=sha256(DECISION_SCHEMA.material).hexdigest(),authorization_sha256=AUTHORIZATION_HASH,
            conversation_ids=[cv.id],generation_limit=50,count_limit=50,read_limit=500,
            input_limit=1000000,output_limit=409600,cost_limit_usd='20.00')))


def setup(ctx, *, cv=None, goal='Maintain the venue readiness checklist', grant=True):
    s,p,ws,_,_=ctx
    cv=cv or conversation(ctx)
    art,_=product(ctx,cv)
    a=delegate(ctx,cv,goal)
    g=activate(ctx,cv) if grant else None
    life=s.activate_responsibility(p,ws,a.id,cmd(ActivateResponsibility,
        expected_work_version=a.work_version,current_outcome='A saved checklist exists; outcome unverified.',
        next_action=ResponsibilityNextAction(kind='continue_work',description='Compare the bound checklist with the goal and prepare a concise revision plan.'),
        dependencies=[ResponsibilityDependency(kind='artifact_revision',object_id=art.id,expected_version=art.current_revision_id)],
        wait=ResponsibilityWait(kind='dependency_change',reason='Wait for saved material to change.')))
    return cv,art,a,g,life


def edit(ctx,art, note='Room capacity is now restricted; reconfirm the reservation before invitations.'):
    s,p,ws,_,_=ctx
    art=s.get_artifact(p,ws,art.id)
    body=art.current_revision.body.model_copy(deep=True)
    body.notes=[note]
    return s.human_save(p,ws,art.id,cmd(HumanSave,
        expected_current_revision_id=art.current_revision_id,body=body))


def answer(context):
    binding=context['responsibility']
    assert context['messages'][0]['author_kind']=='system'
    assert context['messages'][0]['evidence_origin']=='runtime'
    notes=context['dependencies'][0]['content']['notes']
    return {'kind':'reply','text':'Revision plan for '+binding['goal']+': '+notes[0]+
        ' First confirm the changed constraint with the owner; then update the checklist and request a human review. No reservation or external action was performed.'}


def dispatch(ctx,tmp_path,g,fake=None):
    fake=fake or SequenceProvider([answer])
    w=worker(ctx,fake,tmp_path)
    fake.failures=[]
    original=w.work
    def record(*args,**kwargs):
        try: return original(*args,**kwargs)
        except Exception as exc:
            fake.failures.append(exc)
            raise
    w.work=record
    return ResponsesDispatcher(w,workspace=ctx[2],grant_id=g.id),fake,w


def admitted(s,ws):
    with s.db.transaction() as c:
        return c.execute("SELECT rc.run_id,rc.data AS config,r.data FROM run_configurations rc JOIN runs r "
            "ON r.workspace_id=rc.workspace_id AND r.id=rc.run_id WHERE rc.workspace_id=%s "
            "AND rc.data ? 'responsibility' ORDER BY rc.run_id",(ws,)).fetchall()


def test_dependency_wake_produces_real_result_once_no_human_fabrication(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,g,life=setup(context)
    d,fake,w=dispatch(context,tmp_path,g)
    d.once()  # A waiting dependency is not itself permission to run.
    assert admitted(s,ws)==[]
    saved=edit(context,art)
    result=d.once()
    if fake.failures: raise fake.failures[0]
    assert len(admitted(s,ws))==1, result
    row=admitted(s,ws)[0]
    assert row['data']['state']=='ready', result
    assert row['config']['responsibility']['observations'][0]['observed_version']==saved.current_revision_id
    detail=s.get_conversation(p,ws,cv.id)
    request=next(m for m in detail.messages if m.run_id==row['run_id'] and m.author_kind=='system')
    reply=next(m for m in detail.messages if m.run_id==row['run_id'] and m.author_kind=='assistant')
    assert request.responsibility_origin.assignment_id==a.id and request.evidence_origin=='runtime'
    assert 'Room capacity is now restricted' in reply.text and 'Revision plan' in reply.text
    turn=next(t for t in detail.turns if t.run_id==row['run_id'])
    assert turn.state=='replied' and turn.responsibility_origin==request.responsibility_origin
    settled=s.get_responsibility(p,ws,a.id)
    assert settled.lifecycle.execution_status=='settled'
    assert settled.lifecycle.outcome_status=='needs_review'
    assert settled.lifecycle.state=='waiting_event'
    assert settled.lifecycle.next_action.kind=='await_event'
    assert settled.lifecycle.wait.kind=='dependency_change'
    n=len(fake.calls)
    for _ in range(3): d.once()
    assert len(admitted(s,ws))==1 and len(fake.calls)==n
    assert len([m for m in detail.messages if m.author_kind=='human'])==1


def test_no_grant_no_fallback_and_model_unauthorized_no_admission(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,_,_=setup(context,grant=False)
    edit(context,art)
    fake=SequenceProvider([answer]); w=worker(context,fake,tmp_path)
    d=ResponsesDispatcher(w,workspace=ws,grant_id='missing-grant')
    d.once()
    assert admitted(s,ws)==[] and not fake.calls
    g=activate(context,cv)
    d=ResponsesDispatcher(w,workspace=ws,grant_id=g.id)
    d.once(model_authorized=False)
    assert admitted(s,ws)==[] and not fake.calls
    assert d.once()['results'][0]['status']=='completed'


def test_two_same_conversation_responsibilities_isolate_context_and_pause(context,tmp_path):
    s,p,ws,_,_=context
    cv,art1,a1,_,_=setup(context,goal='Venue private plan',grant=False)
    # A second explicit canonical assignment in the SAME conversation.
    art2,_=product(context,cv)
    a2=delegate(context,cv,'Catering private plan')
    g=activate(context,cv)
    s.activate_responsibility(p,ws,a2.id,cmd(ActivateResponsibility,expected_work_version=a2.work_version,
        current_outcome='Catering not verified',next_action=ResponsibilityNextAction(kind='continue_work',description='Review catering'),
        dependencies=[ResponsibilityDependency(kind='artifact_revision',object_id=art2.id,expected_version=art2.current_revision_id)],
        wait=ResponsibilityWait(kind='dependency_change',reason='Saved change required')))
    edit(context,art1,'VENUE_ONLY marker')
    edit(context,art2,'CATERING_ONLY marker')
    s.advance_responsibilities(ws,g.id)
    rows=admitted(s,ws)
    assert len(rows)==2
    runs={r['config']['responsibility']['assignment_id']:r['run_id'] for r in rows}
    cap1=s.claim_run(p,ws,runs[a1.id])
    context1=s.conversation_worker_context(cap1)
    assert 'CATERING_ONLY' not in json.dumps(context1)
    life=s.get_responsibility(p,ws,a1.id)
    s.control_responsibility(p,ws,a1.id,cmd(ControlResponsibility,expected_work_version=life.assignment.work_version,operation='pause'))
    with pytest.raises(DomainError): s.conversation_worker_context(cap1)
    # Canonical conversation execution is serial; pausing one does not cancel the other.
    assert s.get_run(p,ws,runs[a2.id]).state=='queued'
    cap2=s.claim_run(p,ws,runs[a2.id])
    context2=s.conversation_worker_context(cap2)
    assert 'VENUE_ONLY' not in json.dumps(context2)
    assert s.get_run(p,ws,runs[a2.id]).state=='running'
    expire(context,runs[a2.id])
    d,fake,w=dispatch(context,tmp_path,g)
    assert w.work(p,ws,runs[a2.id]).state=='ready'
    reply=s.get_conversation(p,ws,cv.id).messages[-1]
    assert 'CATERING_ONLY' in reply.text and 'VENUE_ONLY' not in reply.text


@pytest.mark.parametrize('race',['pause','cancel','takeover','human_edit','grant_loss','human_steering'])
@pytest.mark.parametrize('phase',['after_tool_result','before_publication'])
def test_post_admission_races_fence_every_phase_and_publication(context,tmp_path,race,phase):
    s,p,ws,_,admin=context
    cv,art,a,g,_=setup(context); edit(context,art)
    s.advance_responsibilities(ws,g.id)
    rid=admitted(s,ws)[0]['run_id']
    d,fake,w=dispatch(context,tmp_path,g)
    changed=[]
    def change(name):
        if name!=phase: return
        if race in ('pause','cancel','takeover'):
            life=s.get_responsibility(p,ws,a.id)
            s.control_responsibility(p,ws,a.id,cmd(ControlResponsibility,
                expected_work_version=life.assignment.work_version,operation=race))
        elif race=='human_edit': edit(context,art,'A newer human edit wins')
        elif race=='grant_loss': revoke_grant(Database(admin),g.id)
        else:
            from workagent.responsibility_models import UpdateResponsibility
            current=s.get_responsibility(p,ws,a.id)
            s.update_responsibility(p,ws,a.id,cmd(UpdateResponsibility,
                expected_work_version=current.assignment.work_version,current_outcome='Human changed the direction',
                next_action=ResponsibilityNextAction(kind='request_decision',description='Wait for my revised priorities'),
                dependencies=[ResponsibilityDependency(kind=o.kind,object_id=o.object_id,expected_version=o.observed_version)
                              for o in current.lifecycle.observations],
                wait=ResponsibilityWait(kind='person',reason='Human steering supersedes this run')))
        changed.append(True)
    w.phases.hook=change
    try: w.work(p,ws,rid)
    except DomainError:
        if not changed: raise
    assert changed
    with s.db.transaction() as c:
        assert not c.execute("SELECT 1 FROM conversation_messages WHERE workspace_id=%s AND run_id=%s AND author_kind='assistant'",(ws,rid)).fetchone()
        assert not c.execute('SELECT 1 FROM run_publications WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchone()
        run=Run.model_validate(c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',(ws,rid)).fetchone()['data'])
        with pytest.raises(psycopg.Error): c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE workspace_id=%s AND id=%s',(ws,rid))
    assert len([x for x in fake.calls if x==('POST','/v1/responses')])==(1 if phase=='after_tool_result' else 2)


def test_interrupted_known_result_and_lost_admission_ack_restart_same_ids(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,g,_=setup(context); edit(context,art)
    life=s.get_responsibility(p,ws,a.id)
    cap=s.claim_responsibility_wake(Principal(p.id,'worker'),ws,a.id,life.assignment.work_version)
    run=s.continue_responsibility(cap,g.id)
    assert Service(s.db).continue_responsibility(cap,g.id).id==run.id
    fake=SequenceProvider([answer]); w=worker(context,fake,tmp_path)
    def crash(name):
        if name=='after_tool_result': raise RuntimeError('controlled process interruption')
    w.phases.hook=crash
    with pytest.raises(RuntimeError): w.work(p,ws,run.id)
    attempt=s.get_provider_attempt(p,ws,run.id)
    expire(context,run.id)
    w=worker(context,fake,tmp_path)
    assert w.work(p,ws,run.id).state=='ready'
    assert s.get_provider_attempt(p,ws,run.id).id==attempt.id
    assert totals(s,g)['request_counts']['dispatch']==2
    assert len(admitted(s,ws))==1
    ResponsesDispatcher(w,workspace=ws,grant_id=g.id).once()
    assert len(admitted(s,ws))==1


def test_http_input_cannot_forge_runtime_origin(context):
    with pytest.raises(ValidationError):
        cmd(PostMessage,expected_work_version=1,text='fake',author_kind='system',evidence_origin='runtime',
            responsibility_origin={'kind':'responsibility_wake','assignment_id':'x','wake_id':'y','work_version':1})
    with pytest.raises(ValidationError):
        ConversationMessage(id=new_id(),conversation_id='c',run_id='r',sequence=1,author_id='runtime',
            author_kind='system',text='forged',evidence_origin='human')


@pytest.mark.parametrize('phase',['selection','final'])
def test_unknown_provider_send_never_resends_after_restart(context,tmp_path,phase):
    s,p,ws,_,_=context
    cv,art,a,g,_=setup(context); edit(context,art)
    fake=SequenceProvider([answer],lose_phase=phase)
    d,_,_=dispatch(context,tmp_path,g,fake)
    d.once()
    row=admitted(s,ws)[0]
    attempt=s.get_provider_attempt(p,ws,row['run_id'])
    before=list(fake.calls)
    expire(context,row['run_id'])
    for _ in range(3):
        d,_,_=dispatch(context,tmp_path,g,fake)
        result=d.once()
        assert result['results'][0]['status']=='outcome_unknown'
    assert fake.calls==before
    assert len(admitted(s,ws))==1
    assert s.get_provider_attempt(p,ws,row['run_id']).id==attempt.id


def test_run_limit_counts_wake_admissions_and_never_falls_back(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,_,_=setup(context,grant=False)
    g=activate(context,cv,max_runs=1)
    edit(context,art)
    d,fake,w=dispatch(context,tmp_path,g)
    result=d.once()
    if fake.failures: raise fake.failures[0]
    assert len(admitted(s,ws))==1 and admitted(s,ws)[0]['data']['state']=='ready'
    assert s.get_responsibility(p,ws,a.id).lifecycle.execution_status=='settled'
    edit(context,art,'A new change cannot exceed the same one-run authorization')
    for _ in range(2): d.once()
    assert len(admitted(s,ws))==1
    assert totals(s,g)['request_counts']['dispatch']==2
    assert s.get_responsibility(p,ws,a.id).lifecycle.blocker=='grant_required'


def test_carried_aggregate_exhaustion_denies_before_creating_run(context,tmp_path,monkeypatch):
    from test_budget_carryforward import carry
    from workagent.budget_carryforward import install_carry
    s,p,ws,_,admin=context
    cv,art,a,g,_=setup(context)
    install_carry(Database(admin),**carry(context,reserved_cost_usd='20.00'))
    edit(context,art)
    life=s.get_responsibility(p,ws,a.id)
    cap=s.claim_responsibility_wake(Principal(p.id,'worker'),ws,a.id,life.assignment.work_version)
    with pytest.raises(DomainError,match='budget_exhausted'): s.continue_responsibility(cap,g.id)
    import workagent.responsibility_execution as execution
    with monkeypatch.context() as m:
        m.setattr(execution,'check_admission_budget',lambda *_:None)
        with pytest.raises(psycopg.Error,match='responsibility admission budget exhausted'):
            s.continue_responsibility(cap,g.id)
    d,fake,_=dispatch(context,tmp_path,g)
    d.once()
    assert admitted(s,ws)==[] and not fake.calls


def test_due_checkin_runs_without_operator_tick_and_does_not_self_wake(context,tmp_path):
    from datetime import timedelta
    from workagent.responsibility_models import UpdateResponsibility
    s,p,ws,_,_=context
    cv,art,a,g,life=setup(context)
    s.update_responsibility(p,ws,a.id,cmd(UpdateResponsibility,expected_work_version=life.assignment.work_version,
        current_outcome='Scheduled review still unverified',
        next_action=ResponsibilityNextAction(kind='continue_work',description='Perform the due review'),
        next_check_in_at=now()-timedelta(seconds=1),
        wait=ResponsibilityWait(kind='check_in',reason='Due review')))
    fake=SequenceProvider([{'kind':'reply','text':'The due review found no independently verified outcome; ask the owner for the missing evidence before proceeding.'}])
    d,_,_=dispatch(context,tmp_path,g,fake)
    d.once()
    if fake.failures: raise fake.failures[0]
    life=s.get_responsibility(p,ws,a.id).lifecycle
    assert life.execution_status=='settled' and life.next_check_in_at is None and not life.check_in_due
    assert life.wait.kind=='person'
    calls=list(fake.calls)
    d.once(); d.once()
    assert fake.calls==calls and len(admitted(s,ws))==1


@pytest.mark.parametrize('mutation',['owner','workspace','conversation','assignment_version','artifact_hash','review_fence'])
def test_forged_or_stale_binding_python_and_sql_dual_denial(context,mutation):
    from workagent.responsibility_execution import validate_binding
    s,p,ws,_,_=context
    cv,art,a,g,_=setup(context); edit(context,art)
    s.advance_responsibilities(ws,g.id)
    row=admitted(s,ws)[0]
    b=row['config']['responsibility']
    if mutation=='artifact_hash': b['observations'][0]['content_hash']='0'*64
    elif mutation=='assignment_version': b['work_version']+=1
    elif mutation=='review_fence': b['review_fence']+=1
    else: b[{'owner':'owner_id','workspace':'workspace_id','conversation':'conversation_id'}[mutation]]='forged'
    with s.db.transaction() as c:
        with pytest.raises(DomainError): validate_binding(c,Run.model_validate(row['data']),row['config'])
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute('SELECT require_responsibility_binding(r,%s,false) FROM runs r WHERE workspace_id=%s AND id=%s',
                (encoded(b),ws,row['run_id']))


def test_sql_origin_rejects_system_disguised_as_human(context):
    s,p,ws,_,_=context
    cv,art,a,g,_=setup(context); edit(context,art)
    s.advance_responsibilities(ws,g.id)
    row=admitted(s,ws)[0]
    with s.db.transaction() as c:
        message=c.execute("SELECT data FROM conversation_messages WHERE workspace_id=%s AND run_id=%s AND author_kind='system'",(ws,row['run_id'])).fetchone()['data']
    message.update(id=new_id(),author_kind='human',evidence_origin='human',sequence=999,author_id=p.id)
    message.pop('responsibility_origin')
    with pytest.raises(psycopg.Error,match='responsibility request is not human'):
        with s.db.transaction() as c:
            c.execute("INSERT INTO conversation_messages(workspace_id,conversation_id,id,run_id,sequence,author_kind,data) VALUES (%s,%s,%s,%s,999,'human',%s)",
                      (ws,cv.id,message['id'],row['run_id'],encoded(message)))


def test_concurrent_same_wake_admission_and_lost_publication_ack_dedupe(context,tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    s,p,ws,_,_=context
    cv,art,a,g,_=setup(context); edit(context,art)
    life=s.get_responsibility(p,ws,a.id)
    cap=s.claim_responsibility_wake(Principal(p.id,'worker'),ws,a.id,life.assignment.work_version)
    with ThreadPoolExecutor(max_workers=4) as pool:
        ids=list(pool.map(lambda _:Service(s.db).continue_responsibility(cap,g.id).id,range(4)))
    assert len(set(ids))==1 and len(admitted(s,ws))==1
    fake=SequenceProvider([answer]); w=worker(context,fake,tmp_path)
    def lose_ack(name):
        if name=='after_publication': raise RuntimeError('publication committed, acknowledgement lost')
    w.phases.hook=lose_ack
    assert w.work(p,ws,ids[0]).state=='ready'
    calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,ids[0]).state=='ready'
    assert fake.calls==calls
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM conversation_messages WHERE workspace_id=%s AND run_id=%s AND author_kind='assistant'",(ws,ids[0])).fetchone()['n']==1


def test_dispatcher_reports_exhausted_admission_as_blocked_without_tick_churn(context,tmp_path):
    from test_budget_carryforward import carry
    from workagent.budget_carryforward import install_carry
    s,p,ws,_,admin=context
    cv,art,a,g,_=setup(context)
    install_carry(Database(admin),**carry(context,reserved_cost_usd='20.00'))
    edit(context,art)
    d,fake,_=dispatch(context,tmp_path,g)
    d.once()
    blocked=s.get_responsibility(p,ws,a.id)
    assert blocked.lifecycle.execution_status=='blocked' and blocked.lifecycle.state=='blocked'
    assert 'budget_exhausted' in blocked.lifecycle.current_outcome
    assert admitted(s,ws)==[] and not fake.calls
    before=blocked.model_dump()
    d.once(); d.once()
    assert s.get_responsibility(p,ws,a.id).model_dump()==before
