"""Human waits are durable decisions, not implicit continuation permission.

Real disposable PostgreSQL + production dispatcher; provider decisions controlled.
No NLP relevance heuristic or benchmark-specific production branching.
"""
from datetime import timedelta
import pytest
from test_domain import context, cmd
from test_responsibility_execution import setup, edit, dispatch, admitted
from test_responsibilities import events
from workagent.models import PostMessage, now
from workagent.responsibility_models import (UpdateResponsibility, ControlResponsibility,
    ResponsibilityWait, ResponsibilityNextAction, ResponsibilityDependency)
from workagent.service import Service, Principal


def waiting(ctx, *, due=False):
    s,p,ws,_,_=ctx
    cv,art,a,g,_=setup(ctx)
    current=s.get_responsibility(p,ws,a.id)
    action=ResponsibilityNextAction(kind='request_decision',description='Wait until the person confirms the accessible venue.')
    life=s.update_responsibility(p,ws,a.id,cmd(UpdateResponsibility,
        expected_work_version=current.assignment.work_version,
        current_outcome='Venue decision remains unresolved.', next_action=action,
        dependencies=[ResponsibilityDependency(kind='artifact_revision',object_id=art.id,expected_version=art.current_revision_id)],
        wait=ResponsibilityWait(kind='person',reason='A human decision is required; do not infer it from other work.'),
        next_check_in_at=now()+timedelta(hours=1) if due else None))
    return cv,art,a,g,life


@pytest.mark.parametrize('change',['conversation','dependency','check_in'])
def test_changes_do_not_turn_person_wait_into_provider_permission(context,tmp_path,change,monkeypatch):
    s,p,ws,_,_=context
    cv,art,a,g,before=waiting(context,due=change=='check_in')
    if change=='conversation':
        current=s.get_conversation(p,ws,cv.id).conversation
        s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=current.work_version,
            text='Separately, what is the difference between a goal and a milestone?'))
    elif change=='dependency':
        edit(context,art,'A human corrected the capacity; the venue decision is still pending.')
    else:
        due=before.lifecycle.next_check_in_at+timedelta(seconds=1)
        monkeypatch.setattr('workagent.responsibilities.now',lambda:due)
        s.reconcile_due_responsibilities(Principal(p.id,'worker'),ws)
    # Restart/catch-up must not interpret general chat or evidence as a decision.
    fresh=Service(s.db)
    after=fresh.reconcile_responsibility(p,ws,a.id)
    assert after.lifecycle.state=='waiting_person'
    assert after.lifecycle.wait==before.lifecycle.wait
    assert after.lifecycle.next_action==before.lifecycle.next_action
    assert after.lifecycle.current_outcome==before.lifecycle.current_outcome
    assert not after.local_review_eligible and not after.provider_execution_queued
    assert after.lifecycle.wake_id is None
    if change=='conversation':
        assert not after.lifecycle.review_required
    else:
        assert after.lifecycle.review_required
    fresh.advance_responsibilities(ws,g.id)
    assert admitted(fresh,ws)==[]
    assert events(fresh,ws,a.id)==[]


def test_human_release_then_dependency_work_can_resume_once(context,tmp_path):
    s,p,ws,_,_=context
    cv,art,a,g,before=waiting(context)
    changed=edit(context,art,'Human correction: accessible room confirmed; use this constraint.')
    held=s.get_responsibility(p,ws,a.id)
    assert held.lifecycle.state=='waiting_person'
    release=s.update_responsibility(p,ws,a.id,cmd(UpdateResponsibility,
        expected_work_version=held.assignment.work_version,
        current_outcome='The person confirmed the room, not the whole objective.',
        next_action=ResponsibilityNextAction(kind='continue_work',description='Prepare a revision using the confirmed constraint.'),
        dependencies=[ResponsibilityDependency(kind='artifact_revision',object_id=art.id,expected_version=changed.current_revision_id)],
        wait=None))
    assert release.lifecycle.state=='active'
    d,fake,w=dispatch(context,tmp_path,g)
    d.once()
    if fake.failures: raise fake.failures[0]
    assert len(admitted(s,ws))==1
    assert admitted(s,ws)[0]['data']['state']=='ready'
    calls=list(fake.calls)
    # Controlled execution did useful local reasoning, but cannot claim objective completion.
    settled=Service(s.db).get_responsibility(p,ws,a.id)
    assert settled.lifecycle.outcome_status=='needs_review'
    assert 'Human correction' in s.get_conversation(p,ws,cv.id).messages[-1].text
    d.once()
    assert fake.calls==calls and len(admitted(s,ws))==1


def test_pause_resume_does_not_clear_pending_human_decision(context):
    s,p,ws,_,_=context
    cv,art,a,g,before=waiting(context)
    paused=s.control_responsibility(p,ws,a.id,cmd(ControlResponsibility,
        expected_work_version=before.assignment.work_version,operation='pause'))
    edit(context,art,'Changed while paused; the decision remains human-owned.')
    current=s.get_responsibility(p,ws,a.id)
    resumed=s.control_responsibility(p,ws,a.id,cmd(ControlResponsibility,
        expected_work_version=current.assignment.work_version,operation='resume'))
    assert resumed.lifecycle.state=='waiting_person'
    assert resumed.lifecycle.wait==before.lifecycle.wait
    assert resumed.lifecycle.next_action==before.lifecycle.next_action
    s.advance_responsibilities(ws,g.id)
    assert admitted(s,ws)==[]
