"""Adversarial adaptive guards on actual PostgreSQL, never a live provider."""
from decimal import Decimal
import pytest
import psycopg
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_adaptive_execution import activate, AdaptiveProvider, setup
from test_general_responses import worker
from test_general_products import wasmop
from test_runtime import expire
from workagent.models import HumanSave,new_id

from workagent.message_models import ExactTarget
from workagent.general_worker import GeneralWorker,ControlledTransport

from workagent.responses_ledger import summary
from workagent.service import encoded
from workagent.provider_attempts import revoke_grant
from workagent.db import Database


def test_plausible_wrong_output_changes_next_action(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,wrong_first=True)
    assert w.work(p,ws,q.run.id).state=='partial'
    turn=s.get_conversation(p,ws,cv.id).turns[0]
    first,second=turn.adaptive.steps
    assert first.status=='observed' and first.verification.checks[0].actual=='7'
    assert not first.verification.model_tests_passed
    assert second.verification.model_tests_passed
    assert fake.contexts[1]['adaptive']['observations'][0]['output']['value']==7
    assert turn.retained_local_result.published


def test_invented_passing_criteria_save_artifact_not_goal_completion(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,invented=True)
    run=w.work(p,ws,q.run.id)
    detail=s.get_conversation(p,ws,cv.id); turn=detail.turns[0]
    assert run.state=='partial' and run.unresolved
    assert turn.adaptive.outcome=='needs_validation'
    assert not turn.adaptive.steps[0].verification.satisfied
    assert turn.adaptive.steps[0].verification.model_tests_passed
    assert turn.retained_local_result.published and turn.retained_local_result.output.value=='7'
    assert len(detail.artifact_ids)==2
    assert 'requested goal still needs independent validation' in detail.messages[-1].text
    assert 'Completed and independently verified.' not in detail.messages[-1].text
    with s.db.transaction() as c:
        receipt=c.execute("SELECT e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s AND e.phase='final' AND e.kind='result'",(ws,q.run.id)).fetchone()
    assert receipt['data']['value']['text']=='Completed and independently verified.'


@pytest.mark.parametrize('phase',['selection','selection_2','final'])
def test_unknown_response_restart_cannot_regenerate_or_publish(context,tmp_path,phase):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,lose_phase=phase)
    assert w.work(p,ws,q.run.id).state=='running'
    before=list(fake.calls)
    expire(context,q.run.id)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='running'
    assert fake.calls==before
    detail=s.get_conversation(p,ws,cv.id)
    assert not detail.artifact_ids
    assert len(detail.messages)==1
    assert detail.turns[0].provider_observation=='outcome_unknown'
    with s.db.transaction() as c:
        ledger=summary(c,g.id,shared=True)
    assert ledger['unknown_usage_steps']==1
    assert Decimal(ledger['reserved_cost_usd'])>0
    revoke_grant(Database(context[4]),g.id)
    successor=activate(context,conversation(context))
    with s.db.transaction() as c:
        assert summary(c,successor.id,shared=True)==ledger
    raises('action_unresolved',lambda:post(context,detail.conversation,'retry'))


@pytest.mark.parametrize('fault',['after_tool_result','before_publication'])
def test_stale_human_edit_blocks_pending_generation_or_publication(context,tmp_path,fault):
    s,p,ws,_,_=context
    cv=conversation(context)
    seed=post(context,cv,'Create',operation=wasmop())
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,seed.run.id)
    cv=s.get_conversation(p,ws,cv.id).conversation
    tool=next(s.get_artifact(p,ws,a) for a in s.get_conversation(p,ws,cv.id).artifact_ids
              if s.get_artifact(p,ws,a).current_revision.body.kind=='tool')
    base=tool.current_revision
    activate(context,cv)
    target=ExactTarget(artifact_id=tool.id,revision_id=base.id,body_hash=base.body_hash)
    q=post(context,cv,'Revise calculator',target=target)
    fake=AdaptiveProvider(); w=worker(context,fake,tmp_path)
    def crash(name):
        if name==fault: raise RuntimeError('crash')
    w.phases.hook=crash
    with pytest.raises(RuntimeError): w.work(p,ws,q.run.id)
    human=base.body.model_copy(update={'notes':['Human material instruction; preserve this.']})
    saved=s.human_save(p,ws,tool.id,cmd(HumanSave,expected_current_revision_id=base.id,body=human))
    before=list(fake.calls)
    expire(context,q.run.id)
    raises('version_conflict',lambda:worker(context,fake,tmp_path).work(p,ws,q.run.id))
    assert fake.calls==before
    assert s.get_artifact(p,ws,tool.id).current_revision_id==saved.current_revision_id
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM product_observations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['n']==0


def test_budget_stop_never_abandons_a_sent_attempt(context,tmp_path,monkeypatch):
    from workagent.responses_ledger import Ledger
    from workagent.errors import DomainError
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,first_good=True)
    original=Ledger.reserve_operation
    def exhausted(ledger,request,kind,cap):
        if request.phase=='final' and kind=='dispatch':
            raise DomainError('budget_exhausted')
        return original(ledger,request,kind,cap)
    monkeypatch.setattr(Ledger,'reserve_operation',exhausted)
    run=w.work(p,ws,q.run.id)
    assert run.state=='partial' and run.stop_reason=='budget_limit'
    with s.db.transaction() as c:
        attempt=c.execute('SELECT data,abandonment_reason FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()
    assert attempt['data']['state']=='dispatched' and attempt['abandonment_reason'] is None
    turn=s.get_conversation(p,ws,cv.id).turns[0]
    assert turn.retained_local_result.output.value=='3750' and not turn.retained_local_result.published
    assert len(fake.responses)==1


def test_shared_budget_successor_grants_stop_preserving_local_work(context,tmp_path):
    s,p,ws,_,_=context
    project='proj_budget_'+ws
    # 150 genuine synthetic generation reservations across six grants and
    # thirty runs; no direct ledger fabrication, deleted charges, or cap resets.
    for _ in range(6):
        cv=conversation(context); g=activate(context,cv,project_id=project)
        for _ in range(5):
            q=post(context,cv,'Exercise bounded failure')
            assert worker(context,AdaptiveProvider(always_bad=True),tmp_path).work(p,ws,q.run.id).state=='partial'
            cv=s.get_conversation(p,ws,cv.id).conversation
        revoke_grant(Database(context[4]),g.id)
    cv=conversation(context); successor=activate(context,cv,project_id=project)
    q=post(context,cv,'Save useful local result before exhaustion')
    fake=AdaptiveProvider(first_good=True)
    w=worker(context,fake,tmp_path)
    sql_denials=[]
    def check_sql_guard(name):
        if name!='after_count': return
        with s.db.transaction() as c:
            pending=c.execute("SELECT st.attempt_id FROM responses_steps st JOIN provider_attempts a ON a.id=st.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s AND st.phase='final'",(ws,q.run.id)).fetchone()
        if not pending: return
        # Exercise the SQL guard independently of the application's check.
        # The insert must roll back; no ledger reset or fixture fabrication.
        with pytest.raises(psycopg.errors.RaiseException,match='shared cumulative project budget exhausted'):
            with s.db.transaction() as c:
                c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,'final','dispatch',%s)",
                          (new_id(),pending['attempt_id'],encoded({'reserved_input_tokens':20000,
                           'reserved_output_tokens':8192,'reserved_cost_usd':'0.131920','billed_cost_usd':None})))
        sql_denials.append(True)
    w.phases.hook=check_sql_guard
    run=w.work(p,ws,q.run.id)
    assert sql_denials==[True]
    assert run.state=='partial' and run.stop_reason=='budget_limit'
    detail=s.get_conversation(p,ws,cv.id); turn=detail.turns[0]
    assert turn.adaptive.outcome=='budget_limit'
    assert turn.retained_local_result.body and turn.retained_local_result.output.value=='3750'
    assert not turn.retained_local_result.published and not detail.artifact_ids
    before=list(fake.calls)
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert fake.calls==before
    with s.db.transaction() as c:
        ledger=summary(c,successor.id,shared=True)
        older=summary(c,g.id,shared=True)
    assert ledger==older
    assert ledger['request_counts']['dispatch']==151
    assert Decimal(ledger['reserved_cost_usd'])==Decimal('0.131920')*151
    assert Decimal(ledger['reserved_cost_usd'])+Decimal('0.131920')>20
    raises('action_unresolved',lambda:post(context,detail.conversation,'No refill'))
