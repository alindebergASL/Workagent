"""Offline actual worker branches and exact receipt predicate; zero I/O."""
from types import SimpleNamespace as N
from unittest.mock import MagicMock,patch
from copy import deepcopy
import pytest
from workagent.general_worker import GeneralWorker
from workagent.general_responses import terminal_failure_bound


@pytest.mark.parametrize('boundary',['selection','new_final','prepared_final'])
@pytest.mark.parametrize('state',['incomplete','failed','cancelled','refused','malformed','queued','in_progress',None,'completed'])
def test_actual_adaptive_terminal_or_pending(boundary,state):
    run=N(id='probe',state='running');s=MagicMock();s.get_run.side_effect=lambda *a:run
    w=GeneralWorker.__new__(GeneralWorker);w.service=s;w.phases=MagicMock()
    request=N(phase='selection');w._prepared_selection=MagicMock(return_value=(request,1,None))
    w._prepared_final=MagicMock(return_value=(request,'selection') if boundary=='prepared_final' else None)
    w._terminal_readback=MagicMock(side_effect=lambda p,ws,r:r)
    result=N(state=state,issue='invalid_output') if state else None
    if boundary=='new_final':w.phases._step.side_effect=[N(state='function_call'),result]
    else:w.phases._step.return_value=result
    ledger=MagicMock();ledger.snapshot.return_value=(None,None)
    def stop(*a):run.state='partial';return run
    def complete(*a):run.state='ready'
    s.complete_general_product.side_effect=complete
    with patch('workagent.models.ProviderGrant.model_validate',return_value=N(responses={})),patch('workagent.adaptive.contract',return_value=('',None)),patch('workagent.file_input_rejection.retain',return_value=None),patch('workagent.adaptive.stage_product',return_value={'terminal_outcome':'stop'}),patch('workagent.acceptance_checks.for_model',return_value={}),patch('workagent.general_worker.final_tool_output',return_value='{}'),patch('workagent.responses_transport.build_final',return_value=request),patch('workagent.request_packing.check_final'),patch('workagent.general_responses.stop_terminal_response',side_effect=stop) as stopped:
        actual=w._adaptive_work(None,None,run,None,N(attempt_id='a'),ledger,{},dict(grant_id='g',responses={'max_steps':8}),None,resume_final=boundary=='prepared_final')
    terminal=state in ('incomplete','failed','cancelled','refused','malformed')
    assert actual.state==('partial' if terminal else 'ready' if state=='completed' and boundary!='selection' else 'running')
    assert stopped.call_count==int(terminal)
    assert s.complete_general_product.call_count==int(state=='completed' and boundary!='selection')


def bound_fixture(state='incomplete'):
    step=dict(request_sha256='a'*64,count_sha256='b'*64,metadata={'request_id':'r','attempt_id':'a','step_id':'selection'})
    common=dict(request_sha256=step['request_sha256'],metadata=step['metadata'])
    events=dict(count_send={},count_result=dict(common,count_sha256=step['count_sha256']),dispatch={},
        identity=dict(common,response_id='resp_x'),result=dict(common,response_id='resp_x',state=state,usage=None))
    return step,events


def test_terminal_identity_is_not_usage_or_goal_success():
    s,e=bound_fixture();assert terminal_failure_bound(s,e)
    for key in ('count_send','count_result','dispatch','identity','result'):
        changed=deepcopy(e);del changed[key];assert not terminal_failure_bound(s,changed)
    for key in ('result','identity','count_result'):
        for field in ('request_sha256','metadata'):
            changed=deepcopy(e);changed[key][field]='forged';assert not terminal_failure_bound(s,changed)
    for state in ('queued','in_progress','function_call','completed'):
        s,e=bound_fixture(state);assert not terminal_failure_bound(s,e)


def test_future_collector_keeps_explanatory_partial_but_denies_unknown():
    from post_freeze_packets import require_observed
    from workagent.errors import DomainError
    s,e=bound_fixture();require_observed(s,e)
    unknown=deepcopy(e);del unknown['result']
    with pytest.raises(DomainError):require_observed(s,unknown)
    count=deepcopy(e);del count['count_result']
    with pytest.raises(DomainError):require_observed(s,count)


@pytest.mark.parametrize('denial',[None,'revoked','unknown','existing_attempt'])
def test_targeted_invalid_create_exact_retain_branch(denial):
    from workagent import file_input_rejection as F
    from workagent.errors import DomainError
    from test_workspace_files_pg import text
    s=MagicMock();c=s.db.transaction.return_value.__enter__.return_value
    run=N(workspace_id='w',id='r');scope=N(work_version=1)
    s._check_capability.return_value=(None,run,scope)
    decision=dict(kind='files_create_draft',source=text('Exact new bytes').model_dump(mode='json'))
    ledger=MagicMock(service=s,receipt=N(attempt_id='a'));ledger._auth.return_value=(run,None,None);ledger._events.return_value={}
    request=N(phase='selection')
    def execute(sql,*_):
        row={'data':{'state':'malformed','issue':'schema_validation_failed'}} if "kind='result'" in sql else ({'exists':1} if denial=='existing_attempt' and 'FROM tool_attempts' in sql else None)
        return N(fetchone=lambda:row)
    c.execute.side_effect=execute
    with patch.object(F,'candidate',return_value=(decision,decision)),patch('workagent.general_responses.check_pins'),patch('workagent.capabilities.file_adapters.scope_targets',return_value=[]),patch('workagent.capabilities.policy.require_run_tools',side_effect=DomainError('not_found_or_not_authorized') if denial=='revoked' else None),patch.object(F,'tools_unresolved',return_value=denial=='unknown'),patch('workagent.capabilities.policy.authorize') as authorize:
        if denial:
            with pytest.raises(DomainError):F.retain(ledger,request,None)
        else:assert F.retain(ledger,request,None) is None
    authorize.assert_not_called();ledger.event.assert_not_called()
