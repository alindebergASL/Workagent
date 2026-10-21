"""A scheduled check-in is a not-before boundary, not overridden by edits."""
import time
from datetime import timedelta
import pytest
from test_domain import context,cmd
from test_responsibility_execution import setup,edit,dispatch,admitted
from workagent.models import now
from workagent.responsibility_models import ResponsibilityLifecycle,ResponsibilityNextAction,ResponsibilityWait,ResponsibilityPlan,UpdateResponsibility,ResponsibilityDependency
from workagent.service import Service


@pytest.mark.parametrize('implicit_wait',[False,True])
@pytest.mark.parametrize('review_required',[False,True])
def test_future_check_in_keeps_changed_work_waiting(review_required,implicit_wait):
    life=ResponsibilityLifecycle(current_outcome='Draft awaiting the agreed check-in.',
        next_action=ResponsibilityNextAction(kind='continue_work',description='Read the latest edits at the agreed check-in.'),
        wait=None if implicit_wait else ResponsibilityWait(kind='check_in',reason='One check-in, not before the agreed time.'),
        next_check_in_at=now()+timedelta(minutes=5),conversation_work_version=1,
        review_required=review_required,check_in_due=False)
    Service._responsibility_state(life)
    assert life.state=='waiting_event'
    life.check_in_due=True
    Service._responsibility_state(life)
    assert life.state=='active'


@pytest.mark.parametrize('implicit_wait',[False,True])
def test_edit_and_dispatcher_restart_do_not_run_before_check_in(context,tmp_path,implicit_wait):
    s,p,ws,_,_=context
    cv,art,a,g,_=setup(context)
    detail=s.get_responsibility(p,ws,a.id)
    plan=detail.lifecycle.model_dump(include=set(ResponsibilityPlan.model_fields))
    due=now()+timedelta(seconds=30)
    plan.update(wait=None if implicit_wait else ResponsibilityWait(kind='check_in',reason='One timed review.'),next_check_in_at=due)
    s.update_responsibility(p,ws,a.id,cmd(UpdateResponsibility,expected_work_version=detail.assignment.work_version,**plan))
    changed=edit(context,art,'Use printed copies rather than emailed links.')
    d,fake,w=dispatch(context,tmp_path,g)
    d.once()
    state=s.get_responsibility(p,ws,a.id)
    assert now()<due, 'Fixture must inspect the pre-deadline interval'
    assert state.lifecycle.state=='waiting_event' and not state.lifecycle.check_in_due
    assert any(o.changed for o in state.lifecycle.observations)
    assert fake.calls==[] and admitted(s,ws)==[]
    # A fresh dispatcher still waits; process restart is not permission to act early.
    resumed,_,_=dispatch(context,tmp_path,g,fake)
    resumed.once();assert fake.calls==[] and admitted(s,ws)==[]
    time.sleep(max(0,(due-now()).total_seconds())+.1)
    for _ in range(5):
        resumed.once()
        if s.get_responsibility(p,ws,a.id).lifecycle.execution_status=='settled':break
    assert len(admitted(s,ws))==1
    assert s.get_responsibility(p,ws,a.id).lifecycle.execution_status=='settled'
    assert s.get_artifact(p,ws,art.id).current_revision_id==changed.current_revision_id
    if fake.failures:raise fake.failures[0]


@pytest.mark.parametrize('kind,review_required,expected',[
    ('person',True,'waiting_person'),
    ('dependency_change',True,'active'),
    ('dependency_change',False,'waiting_event'),
])
def test_explicit_event_wait_keeps_its_semantics(kind,review_required,expected):
    life=ResponsibilityLifecycle(current_outcome='Wait for the explicitly chosen event.',
        next_action=ResponsibilityNextAction(kind='review_dependency',description='Review a permitted event.'),
        dependencies=[ResponsibilityDependency(kind='source_version',object_id='source',expected_version='version')],
        wait=ResponsibilityWait(kind=kind,reason='An explicit event, not an implicit timed action.'),
        next_check_in_at=now()+timedelta(minutes=5),conversation_work_version=1,
        review_required=review_required,check_in_due=False)
    Service._responsibility_state(life)
    assert life.state==expected
