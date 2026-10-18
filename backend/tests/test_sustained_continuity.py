"""Sustained preparation through the real worker, synthetic HTTP and fresh PG.

No paid model, retained DB or live service writes. The same canonical dispatcher
and receipt ledger drive both initial work and later responsibility wakes.
"""
from datetime import timedelta
from unittest.mock import patch

import pytest
from test_domain import context, cmd
from test_conversations import conversation, post
from test_general_alpha_runtime import AlphaProvider, activate as legacy_activate, calculate
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_responsibilities import delegate, product
from test_responsibility_execution import edit, dispatch, admitted
from test_runtime import expire
from workagent.composition import CONTINUITY_POLICY, CONTINUITY_DECISION_SCHEMA
from workagent.models import now
from workagent.responsibility_models import ActivateResponsibility, ResponsibilityDependency, ResponsibilityNextAction, UpdateResponsibility
from workagent.service import Service


def activate(ctx,cv,**kw):
    with patch('test_general_alpha_runtime.POLICY',CONTINUITY_POLICY), patch('test_general_alpha_runtime.DECISION_SCHEMA',CONTINUITY_DECISION_SCHEMA):
        return legacy_activate(ctx,cv,continuity_version='sustained-v1',**kw)


def draft(title='Prepared brief'):
    return {'kind':'publish_artifact','target':None,'body':{'title':title,
        'blocks':[{'block_id':'summary','kind':'paragraph','text':'Prepared a useful reversible next step. Draft, not accepted or goal verification.','checked':None}]}}


def advance(ctx):
    b=ctx['responsibility']
    obs=ctx['adaptive']['observations']
    return {'kind':'advance_responsibility','expected_work_version':b['work_version'],
        'plan':{'current_outcome':'Prepared a brief and a second checklist. No external outcome claimed.',
            'next_action':{'kind':'continue_work','description':'Check the bound inputs later and improve the next preparation step.'},
            'dependencies':[{'kind':d['kind'],'object_id':d['object_id'],'expected_version':d['observed_version']} for d in b['observations']],
            'wait':{'kind':'check_in','reason':'Revisit the readiness plan at the scheduled check-in.'},
            'next_check_in_at':(now()+timedelta(hours=1)).isoformat()},
        'evidence':[{'phase':o['phase'],'operation_hash':o['binding']['operation_hash']} for o in obs if o['status']=='observed']}


def setup(ctx,**caps):
    s,p,ws,_,_=ctx
    cv=conversation(ctx)
    art,_=product(ctx,cv)
    a=delegate(ctx,cv,'Maintain a useful readiness plan')
    g=activate(ctx,cv,max_steps=5,**caps)
    life=s.activate_responsibility(p,ws,a.id,cmd(ActivateResponsibility,
        expected_work_version=a.work_version,current_outcome='Saved checklist exists.',
        next_action=ResponsibilityNextAction(kind='continue_work',description='Prepare useful brief and checklist from the scoped material.'),
        dependencies=[ResponsibilityDependency(kind='artifact_revision',object_id=art.id,expected_version=art.current_revision_id)]))
    return cv,art,a,g,life


def test_multiple_useful_actions_publish_all_and_explain_once(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,cv,max_steps=4)
    q=post(context,cv,'Prepare a brief, then a separate checklist, and explain the result.')
    fake=AlphaProvider([draft('Brief'),draft('Checklist'),{'kind':'reply','text':'Prepared both the brief and checklist. They are editable drafts, not verified external outcomes.'}])
    w=worker(context,fake,tmp_path)
    assert finish_safe_visits(context,w,q.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.artifact_ids)==2
    assert len(detail.messages[-1].result.results)==3
    assert [x.outcome for x in detail.turns[-1].adaptive.steps]==['continue','continue','answered']
    assert all(not x.verification.satisfied for x in detail.turns[-1].adaptive.steps)
    before=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==before
    assert s.get_conversation(p,ws,cv.id).artifact_ids==detail.artifact_ids


def test_followthrough_schedules_checkin_and_restart_not_human_review(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,g,initial=setup(context)
    fake=AlphaProvider([draft('Readiness brief'),draft('Readiness checklist'),advance,
                       {'kind':'reply','text':'Retained two preparation artifacts. I will check in later; no edits were accepted.'}])
    d,fake,w=dispatch(context,tmp_path,g,fake)
    d.once()
    if fake.failures: raise fake.failures[0]
    rows=admitted(s,ws)
    assert len(rows)==1
    assert finish_safe_visits(context,w,rows[0]['run_id']).state=='ready'
    state=s.get_responsibility(p,ws,a.id)
    assert state.assignment.work_version==initial.assignment.work_version+1
    assert state.lifecycle.state=='waiting_event'
    assert state.lifecycle.wait.kind=='check_in'
    assert state.lifecycle.next_action.kind=='continue_work'
    assert not state.lifecycle.review_required
    assert state.lifecycle.outcome_status=='evidenced_preparation'
    assert len(state.lifecycle.outcome_evidence['evidence'])==2
    calls=list(fake.calls)
    # New Service/dispatcher rehydrates the durable check-in; no extra effects now.
    fresh=(Service(s.db),*context[1:])
    d2,_,_=dispatch(fresh,tmp_path,g,fake)
    d2.once()
    assert fake.calls==calls and len(admitted(s,ws))==1
    # Exercise due scheduling without modifying persisted state or sleeping.
    future=state.lifecycle.next_check_in_at+timedelta(seconds=1)
    later=AlphaProvider([{'kind':'reply','text':'Checked the next scheduled preparation step; a decision is now needed.'}])
    d3,later,_=dispatch(fresh,tmp_path,g,later)
    with patch('workagent.responsibilities.now',return_value=future):
        d3.once()
    if later.failures: raise later.failures[0]
    assert len(admitted(s,ws))==2
    d3.once()
    assert len(admitted(s,ws))==2


def test_legacy_publication_still_stops_after_first_artifact(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); legacy_activate(context,cv)
    q=post(context,cv,'Prepare a brief.')
    fake=AlphaProvider([draft()])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='partial'
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==1


class Interrupted(BaseException):
    pass


def test_restart_after_plan_staged_applies_once_without_duplicate_preparation(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,g,initial=setup(context)
    fake=AlphaProvider([draft('Brief'),draft('Checklist'),advance,{'kind':'reply','text':'Prepared both; check-in scheduled.'}])
    d,fake,w=dispatch(context,tmp_path,g,fake)
    def interrupt(name):
        if name=='before_publication': raise Interrupted()
    w.phases.hook=interrupt
    with pytest.raises(Interrupted):
        # Admission is local; drive the same run until the crash point.
        d.once()
        finish_safe_visits(context,w,admitted(s,ws)[0]['run_id'])
    rid=admitted(s,ws)[0]['run_id']
    state=s.get_responsibility(p,ws,a.id)
    assert state.assignment.work_version==initial.assignment.work_version
    assert state.lifecycle.outcome_evidence is None
    before=list(fake.calls)
    expire(context,rid)
    fresh=(Service(s.db),*context[1:])
    restarted=worker(fresh,fake,tmp_path)
    assert finish_safe_visits(fresh,restarted,rid).state=='ready'
    assert fake.calls==before  # exact final receipt was already durable
    state=s.get_responsibility(p,ws,a.id)
    assert state.assignment.work_version==initial.assignment.work_version+1
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==4
    restarted.work(p,ws,rid)
    assert s.get_responsibility(p,ws,a.id).assignment.work_version==state.assignment.work_version
    assert fake.calls==before


def test_human_plan_change_rejects_staged_followthrough(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,g,initial=setup(context)
    fake=AlphaProvider([draft(),advance,{'kind':'reply','text':'Prepared draft and next step.'}])
    d,fake,w=dispatch(context,tmp_path,g,fake)
    def interrupt(name):
        if name=='before_publication': raise Interrupted()
    w.phases.hook=interrupt
    with pytest.raises(Interrupted):
        d.once()
        finish_safe_visits(context,w,admitted(s,ws)[0]['run_id'])
    rid=admitted(s,ws)[0]['run_id']
    current=s.get_responsibility(p,ws,a.id)
    changed=s.update_responsibility(p,ws,a.id,cmd(UpdateResponsibility,
        expected_work_version=current.assignment.work_version,
        current_outcome='Human redirected this plan. Keep this exactly.',
        next_action={'kind':'request_decision','description':'Wait for my explicit scope decision.'},
        dependencies=current.lifecycle.dependencies,
        wait={'kind':'person','reason':'I will supply the decision.'}))
    before=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,rid).state=='cancelled'
    observed=s.get_responsibility(p,ws,a.id)
    assert observed.assignment.work_version==changed.assignment.work_version
    assert observed.lifecycle.current_outcome=='Human redirected this plan. Keep this exactly.'
    assert observed.lifecycle.outcome_evidence is None
    assert observed.lifecycle.state=='waiting_person'
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==2
    assert fake.calls==before


def test_proposals_remain_unaccepted_across_multiple_actions(context,tmp_path):
    s,p,ws,_,_=context
    from test_flexible_work import publish
    cv,_,art=publish(context,draft()['body'])
    from workagent.models import HumanSave
    body=art.current_revision.body.model_dump(mode='json')
    body['blocks'].append({'block_id':'human','kind':'protected_note','text':'Keep my actual saved contribution.','checked':None})
    art=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
    activate(context,cv,max_steps=4)
    from test_general_responses import target
    original=art.current_revision
    def revision(ctx):
        body=original.body.model_dump(mode='json')
        body['title']='Prepared proposed revision; human must accept.'
        return {'kind':'publish_artifact','target':target(art).model_dump(mode='json'),'body':body}
    cv=s.get_conversation(p,ws,cv.id).conversation
    q=post(context,cv,'Prepare proposed revisions. Do not accept them.',target=target(art))
    fake=AlphaProvider([revision,revision,{'kind':'reply','text':'Two separate proposals are retained; your saved revision has not changed.'}])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    results=detail.messages[-1].result.results[1:]
    assert len(results)==2 and len({r.proposal_id for r in results})==2
    assert s.get_artifact(p,ws,art.id).current_revision_id==original.id
    with s.db.transaction() as c:
        proposals=c.execute('SELECT data FROM proposals WHERE workspace_id=%s AND artifact_id=%s',(ws,art.id)).fetchall()
    assert all(p['data']['status']=='pending' for p in proposals)


def test_unknown_effect_never_applies_staged_plan(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,g,initial=setup(context)
    fake=AlphaProvider([draft(),advance,{'kind':'reply','text':'Prepared.'}],lose_phase='selection_3')
    d,fake,w=dispatch(context,tmp_path,g,fake)
    d.once()
    if fake.failures: raise fake.failures[0]
    rid=admitted(s,ws)[0]['run_id']
    finish_safe_visits(context,w,rid,stop_when=lambda:len(fake.responses)>=3)
    before=list(fake.calls)
    worker(context,fake,tmp_path).work(p,ws,rid)
    assert fake.calls==before
    state=s.get_responsibility(p,ws,a.id)
    assert state.assignment.work_version==initial.assignment.work_version
    assert state.lifecycle.outcome_evidence is None
    assert state.lifecycle.run_id==rid


def test_budget_stop_retains_evidence_without_advancing_plan(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,g,initial=setup(context,generation_limit=2)
    fake=AlphaProvider([draft(),advance,{'kind':'reply','text':'Not sent after the budget bound.'}])
    d,fake,w=dispatch(context,tmp_path,g,fake)
    d.once()
    if fake.failures: raise fake.failures[0]
    rid=admitted(s,ws)[0]['run_id']
    result=finish_safe_visits(context,w,rid)
    assert result.state=='partial' and result.stop_reason=='budget_limit'
    state=s.get_responsibility(p,ws,a.id)
    assert state.assignment.work_version==initial.assignment.work_version
    assert state.lifecycle.outcome_evidence is None
    assert state.lifecycle.execution_status=='blocked'
    with s.db.transaction() as c:
        retained=c.execute("SELECT e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id "
            "WHERE a.workspace_id=%s AND a.run_id=%s AND e.kind='tool_result' ORDER BY e.phase",(ws,rid)).fetchall()
    assert retained[0]['data']['body']['title']=='Prepared brief'
    assert retained[1]['data']['followthrough_result']['status']=='staged_until_settlement'
    before=list(fake.calls)
    dispatch(context,tmp_path,g,fake)[0].once()
    assert fake.calls==before and len(admitted(s,ws))==1
