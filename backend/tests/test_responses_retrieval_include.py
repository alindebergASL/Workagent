"""GET include is per request, not inherited from background POST creation."""
import json
import httpx
from test_responses_transport import harness, no_network, selection, response, final_request


def test_retrieve_requests_continuation_ciphertext_without_new_generation(harness):
    def get(request):
        assert request.method=='GET'
        assert request.url.path=='/v1/responses/resp_SYNTHETIC'
        doc=response()
        if request.url.params.get_list('include[]')!=['reasoning.encrypted_content']:
            doc['output'][0].pop('encrypted_content')
        return httpx.Response(200,json=doc)
    transport,calls=harness(get)
    result=transport.retrieve('resp_SYNTHETIC',request=selection())
    assert result.state=='function_call' and result.issue is None
    assert len(calls)==1 and calls[0].content==b''
    assert json.loads(result.output_items)[0]['encrypted_content']=='SYNTHETIC-NOT-PROVIDER-REASONING'


def test_final_retrieval_and_cancellation_do_not_request_continuation(harness):
    transport,calls=harness()
    transport.retrieve('resp_SYNTHETIC',request=final_request())
    transport.cancel('resp_SYNTHETIC',request=selection())
    assert not calls[0].url.query and not calls[1].url.query
    assert [r.method for r in calls]==['GET','POST']
