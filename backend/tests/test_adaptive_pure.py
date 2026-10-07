"""Pure regressions: no database fixtures, services, provider or network calls."""
from types import SimpleNamespace
import pytest
from workagent.adaptive import AdaptiveDecision, verify, decision
from workagent.errors import DomainError
from workagent.local_operations import reconcile_csv

CONSTANT='(module (func (export "total") (param i64 i64) (result i64) i64.const 7))'
MULTIPLY='(module (func (export "total") (param i64 i64) (result i64) local.get 0 local.get 1 i64.mul))'


def value(code=CONSTANT, expected='7'):
    return AdaptiveDecision.model_validate({'goal':'Unrelated constant', 'success_criteria':[
        {'kind':'wasm_return','arguments':[3,1250],'expected':expected}], 'decision':{
        'kind':'run_wasm','target':None,'code':code,'entrypoint':'total','arguments':[3,1250],
        'input_form':[{'name':'quantity','label':'Quantity'},{'name':'price','label':'Price'}]}})


def test_model_supplied_constant_is_not_requested_goal_verification():
    v=value()
    result=verify(v,v.decision,{'status':'observed','body':{'code':CONSTANT}})
    assert result['checks'][0]['passed'] is True
    assert result['satisfied'] is False


def test_csv_verification_uses_actual_discrepancy_list():
    output=reconcile_csv('id,quantity,unit_price,reported_total\na,2,1.50,2.00\n')
    v=AdaptiveDecision.model_validate({'goal':'Reconcile', 'success_criteria':[
        {'kind':'csv_totals','expected_sum':'3.00','mismatch_count':1}],
        'decision':{'kind':'stop','outcome':'blocked','text':'fixture'}})
    result=verify(v,SimpleNamespace(kind='reconcile_csv'),{'status':'observed','output':output})
    assert result['checks'][0]['passed'] is True
    assert result['satisfied'] is False


@pytest.mark.parametrize('change',[{'goal':'Weakened'}, {'success_criteria':[]}])
def test_continuation_cannot_weaken_first_proposal(change):
    first=value().model_dump(); later={**first,**change}
    ledger=SimpleNamespace(_events=lambda c,phase:{'result':{'state':'function_call','value':first if phase=='selection' else later}})
    with pytest.raises(DomainError,match='source_changed'):
        decision(None,ledger,'selection_2')


def test_plausible_executable_wrong_result_fails_model_tests():
    v=value(expected='3750')
    result=verify(v,v.decision,{'status':'observed','body':{'code':CONSTANT}})
    assert result['checks'][0]['actual']=='7'
    assert not result['model_tests_passed'] and not result['satisfied']


@pytest.mark.parametrize('status',['rejected','reply'])
def test_failed_or_missing_tool_result_cannot_pass(status):
    v=value()
    result=verify(v,v.decision,{'status':status,'body':None})
    assert not result['satisfied'] and not result['model_tests_passed']
    assert result['checks']==[]


def test_empty_criteria_cannot_pass():
    v=value().model_copy(update={'success_criteria':[]})
    result=verify(v,v.decision,{'status':'observed','body':{'code':CONSTANT}})
    assert not result['model_tests_passed'] and not result['satisfied']


def test_verification_runs_other_arguments_not_selected_demo():
    v=value(MULTIPLY,'3750')
    v.success_criteria.append(type(v.success_criteria[0])(kind='wasm_return',arguments=[2,1500],expected='3000'))
    result=verify(v,v.decision,{'status':'observed','body':{'code':MULTIPLY}})
    assert [x['actual'] for x in result['checks']]==['3750','3000']
    assert result['model_tests_passed'] and not result['satisfied']


def test_safe_trap_diagnostic_is_actionable_without_engine_exception_text():
    from workagent.adaptive import rejection_diagnostic
    from workagent.wasm_tool import run_wasm_tool,ToolRejected
    code='(module (func (export "total") (result i64) unreachable))'
    with pytest.raises(ToolRejected) as exc:
        run_wasm_tool(code,'total',[])
    diagnostic=rejection_diagnostic(exc.value)
    assert diagnostic['code']=='wasm_unreachable'
    assert 'unreachable instruction' in diagnostic['detail']
    for unsafe in (ValueError('SECRET/path'),ToolRejected('SECRET/path')):
        assert 'SECRET' not in str(rejection_diagnostic(unsafe))


def test_model_success_claim_stops_blocked(monkeypatch):
    import workagent.adaptive as adaptive
    monkeypatch.setattr(adaptive,'retained',lambda *_:[])
    monkeypatch.setattr(adaptive,'request_provenance',lambda _: {'message_id':'immutable'})
    v=AdaptiveDecision.model_validate({'goal':'Claim','success_criteria':[],
        'decision':{'kind':'stop','outcome':'complete','text':'I succeeded.'}})
    staged={'status':'reply'}
    result=adaptive.stage_metadata(None,SimpleNamespace(receipt=SimpleNamespace(attempt_id='attempt')),
                                   'selection',v,None,staged,4,None)
    assert result['terminal_outcome']=='blocked'
    assert 'unsupported' in staged['reason'] and 'I succeeded.' not in staged['reason']


def test_changed_human_provenance_cannot_stage_continuation(monkeypatch):
    import workagent.adaptive as adaptive
    monkeypatch.setattr(adaptive,'retained',lambda *_:[{'verification':{'request':{'message_id':'old'}}}])
    monkeypatch.setattr(adaptive,'request_provenance',lambda _: {'message_id':'new'})
    with pytest.raises(DomainError,match='source_changed'):
        adaptive.stage_metadata(None,SimpleNamespace(receipt=SimpleNamespace(attempt_id='attempt')),
                                'selection_2',value(),value().decision,{'status':'rejected'},4,None)


def test_budget_summary_keeps_unknown_and_known_worst_case_reservations():
    from workagent.responses_ledger import summary
    class Connection:
        def execute(self,sql,args):
            assert 'responses_budget_grants' in sql
            return SimpleNamespace(fetchall=lambda:[
                {'kind':'dispatch','data':{'reserved_input_tokens':20000,'reserved_output_tokens':8192,'reserved_cost_usd':'0.131920'}},
                {'kind':'dispatch','data':{'reserved_input_tokens':20000,'reserved_output_tokens':8192,'reserved_cost_usd':'0.131920'}},
                {'kind':'result','data':{'usage':{'input_tokens':100,'output_tokens':10}}}])
    result=summary(Connection(),'grant',shared=True)
    assert result['reserved_cost_usd']=='0.263840'
    assert result['unknown_usage_steps']==1 and result['billed_cost_usd'] is None
    assert result['conservatively_calculated_cost_usd'] is None
