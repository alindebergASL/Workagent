"""Independent human checks: actual bounded execution, no DB/provider calls."""
import copy
import json
from types import SimpleNamespace
import pytest
from pydantic import TypeAdapter, ValidationError
from workagent.acceptance_checks import AcceptanceSpec, evaluate, for_model
from workagent.adaptive import continuation_context

MULTIPLY='(module (func (export "total") (param i64 i64) (result i64) local.get 0 local.get 1 i64.mul))'
CONSTANT='(module (func (export "total") (param i64 i64) (result i64) i64.const 7))'
SPEC={'kind':'wasm_cases','entrypoint':'total','cases':[{'arguments':[11,123457],'expected':'1358027'}]}


def spec(value=None):
    return TypeAdapter(AcceptanceSpec).validate_python(value or SPEC,strict=True)


def staged(code=MULTIPLY):
    return {'status':'observed','body':{'code':code},'binding':{'operation_hash':'a'*64}}


@pytest.mark.parametrize('change',[
    {'cases':[]}, {'cases':SPEC['cases']*9}, {'entrypoint':'bad-name'},
    {'cases':[{'arguments':[True],'expected':'1'}]},
    {'cases':[{'arguments':[1000000001],'expected':'1'}]},
    {'cases':[{'arguments':[0]*9,'expected':'1'}]},
    {'cases':[{'arguments':[],'expected':'9223372036854775808'}]},
    {'cases':[{'arguments':[],'expected':'-9223372036854775809'}]},
    {'cases':[{'arguments':[],'expected':7}]},
    {'cases':[{'arguments':[],'expected':'01'}]},
    {'authority':'model'},
])
def test_closed_bounded_human_spec(change):
    with pytest.raises(ValidationError): spec({**SPEC,**change})


@pytest.mark.parametrize('expected',['-9223372036854775808','9223372036854775807','0'])
def test_exact_i64_boundaries(expected):
    assert spec({**SPEC,'cases':[{'arguments':[],'expected':expected}]}).cases[0].expected==expected


def test_checks_execute_saved_code_with_independent_arguments():
    result=evaluate(spec(),SimpleNamespace(kind='run_wasm',entrypoint='total'),staged())
    assert result['passed'] and result['scope']=='supplied_checks_only'
    assert result['checks'][0]['actual']=='1358027'
    assert result['spec']==SPEC
    assert result['body_sha256'] and result['spec_sha256']


@pytest.mark.parametrize('change',[{'entrypoint':'other'},{'kind':'reconcile_csv'}])
def test_wrong_export_or_operation_cannot_pass(change):
    operation=SimpleNamespace(**{'kind':'run_wasm','entrypoint':'total',**change})
    assert not evaluate(spec(),operation,staged())['passed']


def test_wrong_but_executable_constant_fails():
    result=evaluate(spec(),SimpleNamespace(kind='run_wasm',entrypoint='total'),staged(CONSTANT))
    assert not result['passed'] and result['checks'][0]['actual']=='7'


@pytest.mark.parametrize('status',['rejected','reply'])
def test_no_execution_never_passes(status):
    result=evaluate(spec(),None,{'status':status,'body':None})
    assert not result['passed'] and len(result['checks'])==1
    assert result['body_sha256'] is None


def test_trap_is_bounded_and_safe():
    code='(module (func (export "total") (param i64 i64) (result i64) unreachable))'
    result=evaluate(spec(),SimpleNamespace(kind='run_wasm',entrypoint='total'),staged(code))
    assert not result['passed'] and result['checks'][0]['actual']=='bounded acceptance check rejected'


def test_csv_totals_use_actual_retained_observation():
    from workagent.local_operations import reconcile_csv
    criteria=spec({'kind':'csv_totals','expected_sum':'3.00','mismatch_count':1})
    result=evaluate(criteria,SimpleNamespace(kind='reconcile_csv'),{'status':'observed',
        'body':{'kind':'table'},'output':reconcile_csv('id,quantity,unit_price,reported_total\na,2,1.50,2.00\n')})
    assert result['passed']
    criteria.mismatch_count=0
    assert not evaluate(criteria,SimpleNamespace(kind='reconcile_csv'),{'status':'observed',
        'body':{'kind':'table'},'output':reconcile_csv('id,quantity,unit_price,reported_total\na,2,1.50,2.00\n')})['passed']


def test_redaction_removes_expected_spec_hash_and_request_hash_without_mutation():
    evidence=evaluate(spec(),SimpleNamespace(kind='run_wasm',entrypoint='total'),staged(CONSTANT))
    original={**staged(CONSTANT),'verification':{'satisfied':False,'request':{'message_sha256':'secret_request_hash'},
        'acceptance':evidence,'checks':[]}}
    saved=copy.deepcopy(original)
    redacted=for_model(original)
    assert original==saved
    assert redacted['verification']['acceptance']=={'provided':True,'scope':'supplied_checks_only',
        'passed':False,'check_count':1,'failed_count':1}
    payload=json.dumps(redacted)
    for secret in ('1358027','123457',evidence['spec_sha256'],'secret_request_hash'):
        assert secret not in payload
    context=continuation_context({'messages':[]},[original],4)
    assert context['adaptive']['observations']==[redacted]


def test_legacy_without_checks_has_identical_provider_payload():
    original={'status':'observed','verification':{'satisfied':False,'checks':[]}}
    assert for_model(original)==original


def test_absent_checks_preserve_legacy_command_and_request_hashes():
    from workagent.models import PostMessage,ConversationMessage
    from workagent.adaptive import request_provenance
    from workagent.service import digest
    command=PostMessage(schema_version='workagent/v1',request_id='request',command_id='command',expected_work_version=1,text='Multiply')
    message=ConversationMessage(id='message',conversation_id='conversation',run_id='run',sequence=1,
        author_id='human',author_kind='human',text='Multiply',evidence_origin='human')
    assert 'acceptance_checks' not in command.model_dump(mode='json')
    assert 'acceptance_checks' not in message.model_dump(mode='json')
    assert request_provenance(message)['message_sha256']==digest(message)
    with pytest.raises(ValidationError):
        ConversationMessage.model_validate({**message.model_dump(),'author_kind':'assistant','acceptance_checks':SPEC})


def test_model_decision_cannot_mint_human_acceptance_checks():
    from workagent.adaptive import AdaptiveDecision
    value={'goal':'Multiply','success_criteria':[],'decision':{'kind':'stop','outcome':'blocked','text':'No work'}}
    with pytest.raises(ValidationError): AdaptiveDecision.model_validate({**value,'acceptance_checks':SPEC})
    with pytest.raises(ValidationError): AdaptiveDecision.model_validate({**value,'decision':{**value['decision'],'acceptance_checks':SPEC}})
