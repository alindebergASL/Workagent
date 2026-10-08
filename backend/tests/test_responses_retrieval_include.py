"""Persisted background responses use original reasoning items, not ciphertext GET."""
import json
import httpx
import pytest
from test_responses_transport import harness, no_network, selection, response, schema, Artifact, meta
from workagent.responses_transport import build_final, _output_shape, TransportError


def test_retrieve_stored_reasoning_and_replay_complete_original_item(harness):
    def get(request):
        assert request.method=='GET' and not request.url.query
        assert request.url.path=='/v1/responses/resp_SYNTHETIC'
        doc=response();doc['output'][0].pop('encrypted_content')
        return httpx.Response(200,json=doc)
    transport,calls=harness(get);request=selection()
    result=transport.retrieve('resp_SYNTHETIC',request=request)
    assert result.state=='function_call' and result.issue is None
    assert len(calls)==1 and calls[0].content==b''
    original={'type':'reasoning','id':'rs_SYNTHETIC','summary':[]}
    assert json.loads(result.output_items)[0]==original
    final=build_final(selection_request=request,selection=result,tool_output='{"observed":true}',
        instructions='Explain actual observation.',artifact_schema=schema(Artifact),metadata=meta('final'))
    assert json.loads(final.count_body())['input'][1]==original


def test_missing_ciphertext_is_not_stateless_continuation():
    reasoning={'type':'reasoning','id':'rs_SYNTHETIC','summary':[]}
    with pytest.raises(TransportError,match='invalid_reasoning_item'):_output_shape([reasoning])
    assert _output_shape([reasoning],stored=True)==[]
    for invalid in ({**reasoning,'id':''},{**reasoning,'id':None},{**reasoning,'encrypted_content':''},{**reasoning,'encrypted_content':123}):
        with pytest.raises(TransportError,match='invalid_reasoning_item'):_output_shape([invalid],stored=True)


def test_bare_item_references_are_still_forbidden():
    with pytest.raises(TransportError,match='unsupported_output_item'):
        _output_shape([{'type':'item_reference','id':'rs_SYNTHETIC'}],stored=True)
