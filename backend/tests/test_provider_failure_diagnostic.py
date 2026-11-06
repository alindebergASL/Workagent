"""Pure parser/immutable serialization controls; no HTTP/DB/provider."""
import json
import socket
import pytest
from test_responses_transport import selection,response,SYNTHETIC,schema,Artifact,meta
from workagent.responses_transport import parse_response,build_final
from workagent.selection_rejection import serialized_result
from workagent.responses_ledger import restore_result

@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr(socket.socket,'connect',lambda *a,**k:pytest.fail('no network'))

def parsed(error,**kw):
    r=selection()
    return r,parse_response(response(status='failed',usage=None,error=error,**kw),r,SYNTHETIC)

def test_failed_retained_restored_with_bounded_labels():
    r,result=parsed(dict(code='server_error',type='server_error',param='input',message='secret raw text'))
    stored=serialized_result(result);restored=restore_result(stored,r)
    assert restored.state=='failed' and restored.usage is restored.value is None
    assert restored.issue=='provider_failure:{"code":"server_error","param":"input","type":"server_error"}'
    assert len(restored.issue)<=256 and 'secret' not in json.dumps(stored)
    assert stored['request_sha256']==r.sha256 and stored['metadata']==r.metadata.model_dump()
    assert stored['response_id']=='resp_SYNTHETIC' and stored['output_items']=='[]'
    assert 'rejection_diagnostic' not in stored

@pytest.mark.parametrize('error',[None,{},'secret',{'message':'sk-secret'},
    {'code':'sk-secret'},{'type':'arbitrary_label'},{'code':'server_error','param':'input.secret'},
    {'code':['server_error']},{'param':'x'*10000},{'code':'server_error\nsecret'}])
def test_unavailable_never_retains_arbitrary_values(error):
    _,result=parsed(error)
    assert result.issue=='provider_failure:diagnostic_unavailable'
    assert result.state=='failed' and result.usage is None

@pytest.mark.parametrize('changes',[{'metadata':{'wrong':'scope'}},{'model':'other'},
    {'service_tier':'priority'},{'object':'error'},{'id':'not-response'}])
def test_invalid_envelope_never_trusts_provider_labels(changes):
    r=selection();result=parse_response(response(status='failed',usage=None,error={'code':'server_error'},**changes),r,SYNTHETIC)
    assert result.state=='malformed' and not result.issue.startswith('provider_failure:')

def test_failure_usage_and_old_result_semantics():
    r=selection();result=parse_response(response(status='failed',error={'code':'rate_limit_exceeded'}),r,SYNTHETIC)
    assert result.usage.input_tokens==100
    old=serialized_result(result);old['issue']=None
    assert restore_result(old,r).state=='failed' and restore_result(old,r).issue is None
    bad=parse_response(response(status='failed',usage={'bad':'usage'},error={'code':'server_error'}),r,SYNTHETIC)
    assert bad.state=='malformed' and bad.issue=='invalid_usage'

def test_ordinary_function_call_completed_and_pending_unchanged():
    r=selection();got=parse_response(response(),r,SYNTHETIC)
    assert got.state=='function_call' and got.value.source_id=='approved-source' and got.issue is None
    final=build_final(instructions='final',selection_request=r,selection=got,tool_output='x',artifact_schema=schema(Artifact),metadata=meta('final'))
    doc=response(output=[{'type':'message','id':'msg_test','role':'assistant','status':'completed','content':[{'type':'output_text','text':'{"title":"ok"}','annotations':[]}]}])
    result=parse_response(doc,final,SYNTHETIC)
    assert result.state=='completed' and result.value.title=='ok' and result.issue is None
    for state in ('queued','in_progress','incomplete','cancelled'):
        assert parse_response(response(status=state,error={'code':'server_error'}),r,SYNTHETIC).issue is None
