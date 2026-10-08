"""Regression coverage for independently found milestone review defects."""
from types import SimpleNamespace
import pytest
from test_domain import context
from test_bounded_verifier_pure import case, GOAL
from workagent.bounded_verifier import recognize
from workagent.responses_dispatcher import general_dispatch_status

@pytest.mark.parametrize('outcome',['blocked','waiting_for_user','step_limit','budget_limit'])
def test_partial_operator_status_preserves_actual_reason(outcome):
    observed=SimpleNamespace(provider_observation='received',retained_local_result=None,
        adaptive=SimpleNamespace(outcome=outcome))
    assert general_dispatch_status(SimpleNamespace(state='partial'),observed)==outcome

@pytest.mark.parametrize('goal',[GOAL, 'Build a reusable team-selection calculator for choosing k people from n candidates, for all integers 0 <= k <= n <= 60. Start with 60 candidates and 30 people. Keep my notes.'])
@pytest.mark.parametrize('separator',[' ', '\t', '\n', '\r', '\f', '\v', '\u00a0', '\u2028', '\u001c', '\u3000'])
def test_both_goal_languages_share_exact_whitespace(context,goal,separator):
    from workagent.service import encoded
    s,*_=context
    message,_,_,_=case(text=goal.replace(' ',separator,1))
    spec=recognize(message)
    with s.db.transaction() as c:
        actual=c.execute('SELECT coalesce(bounded_csv_spec(%s),bounded_team_spec(%s)) AS spec',
            (encoded(message),encoded(message))).fetchone()['spec']
    assert actual==(spec.model_dump(mode='json') if spec else None)


def test_stop_cannot_inherit_preceding_passing_result(monkeypatch):
    from workagent.adaptive import AdaptiveDecision, stage_metadata
    message, operation, staged, _ = case()
    from workagent.bounded_verifier import evaluate
    assert evaluate(message,operation,staged)['passed']
    decision=AdaptiveDecision.model_validate({'goal':'Reconcile CSV','success_criteria':[],
        'decision':{'kind':'stop','outcome':'complete','text':'I claim completion'}})
    monkeypatch.setattr('workagent.adaptive.retained',lambda *_:[])
    ledger=SimpleNamespace(receipt=SimpleNamespace(attempt_id='attempt'))
    # resolve_selection maps every Stop/Reply to operation=None and a reply payload.
    reply={'status':'reply','body':None,'file':None,'output':None,'binding':{'operation_hash':None,'base_hash':None}}
    result=stage_metadata(None,ledger,'selection',decision,None,reply,4,message)
    assert not result['verification']['satisfied']
    assert result['terminal_outcome']=='blocked'


def test_responses_worker_once_only_selects_its_own_profile():
    from contextlib import contextmanager
    from workagent.general_worker import GeneralWorker
    captured=[]
    class DB:
        @contextmanager
        def transaction(self): yield self
        def execute(self,sql,params):
            captured.append(params)
            return SimpleNamespace(fetchall=lambda:[])
    w=object.__new__(GeneralWorker)
    w.service=SimpleNamespace(db=DB())
    w.phases=object()  # The concrete ResponsesWorker is truthy; no __bool__ override.
    assert w.once(workspace='workspace')=={'completed':0,'deferred':0,'denied':0}
    assert captured[0][:3]==('general-responses-v1',)*3
