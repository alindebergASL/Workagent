"""Synthetic receipt -> production worker -> restricted PostgreSQL; no live effects."""
import pytest
from test_domain import context, cmd, raises
from test_general_alpha_runtime import launch, AlphaProvider, activate
from test_general_responses import worker, totals
from test_conversations import conversation, post
from test_runtime import expire
from test_adaptive_execution import finish_safe_visits
from workagent.models import CancelConversation
from workagent.errors import DomainError
from workagent.responsibility_models import ControlResponsibility


def record(ctx=None):
    return {'kind':'record_responsibility','goal':'Keep the local handoff current',
        'completion_criteria':['A human verifies the handoff outcome'],
        'plan':{'current_outcome':'Waiting for a human update; nothing sent externally.',
            'next_action':{'kind':'await_event','description':'Review a local human update.'},
            'wait':{'kind':'person','reason':'The other person has not replied.'},
            'next_check_in_at':None,'dependencies':[]}}


def test_recorded_local_ownership_and_plain_reply(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[record,{'kind':'reply','text':'I am tracking this locally.'}])
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.assignment_ids)==1 and not detail.artifact_ids
    responsibility=s.get_responsibility(p,ws,detail.assignment_ids[0])
    assert responsibility.assignment.owner_id==p.id
    assert responsibility.lifecycle.state=='waiting_person'
    assert responsibility.lifecycle.next_check_in_at is None
    assert responsibility.lifecycle.outcome_status=='unverified'
    assert not responsibility.assignment.run_ids
    assert detail.turns[0].adaptive.steps[0].mutation_result.assignment_id==responsibility.assignment.id
    assert detail.turns[0].adaptive.steps[0].capability_result is None
    assert detail.turns[0].responsibility_recording.assignment_id==responsibility.assignment.id
    assert 'Local responsibility recorded' in detail.messages[-1].text
    assert 'not monitored' in detail.messages[-1].text
    assert not detail.turns[0].retained_local_result.published
    assert totals(s,g)['request_counts']['dispatch']==3
    before=list(fake.calls)
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert fake.calls==before
    assert s.list_assignments(p,ws).items[0].id==responsibility.assignment.id


def test_simple_answer_has_no_responsibility(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[{'kind':'reply','text':'A short answer.'}])
    assert w.work(p,ws,q.run.id).state=='ready'
    assert s.get_conversation(p,ws,cv.id).assignment_ids==[]


@pytest.mark.parametrize('fault',['after_tool_result','before_publication'])
def test_restart_and_repeated_selection_one_effect(context,tmp_path,fault):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[record,record,{'kind':'reply','text':'Kept locally.'}])
    fired=[]
    def crash(name):
        if name==fault and not fired:
            fired.append(name)
            raise RuntimeError('lost local acknowledgment')
    w.phases.hook=crash
    # Publication can be on a later bounded lease visit under host load. Reach
    # the actual fault seam without replaying any unmatched provider I/O.
    with pytest.raises(RuntimeError): finish_safe_visits(context,w,q.run.id)
    first=s.get_conversation(p,ws,cv.id).assignment_ids
    assert len(first)==1
    expire(context,q.run.id)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.assignment_ids==first
    assert detail.turns[0].adaptive.steps[0].mutation_result==detail.turns[0].adaptive.steps[1].mutation_result


def test_conflicting_repeated_selection_denied(context,tmp_path):
    s,p,ws,_,_=context
    changed=record(); changed['goal']='A different responsibility'
    cv,g,q,fake,w=launch(context,tmp_path,[record,changed])
    raises('command_conflict',lambda:w.work(p,ws,q.run.id))
    assert len(s.get_conversation(p,ws,cv.id).assignment_ids)==1


@pytest.mark.parametrize('control',['pause','cancel'])
def test_human_control_fences_recording_replay(context,tmp_path,control):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[record,record])
    def alter(name):
        if name=='after_tool_result':
            aid=s.get_conversation(p,ws,cv.id).assignment_ids[0]
            a=s.get_responsibility(p,ws,aid)
            s.control_responsibility(p,ws,aid,cmd(ControlResponsibility,
                expected_work_version=a.assignment.work_version,operation=control))
    w.phases.hook=alter
    with pytest.raises(DomainError): w.work(p,ws,q.run.id)
    assert len(s.get_conversation(p,ws,cv.id).assignment_ids)==1
