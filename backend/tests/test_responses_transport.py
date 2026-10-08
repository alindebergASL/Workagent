"""Synthetic HTTPX evidence only: no provider/account/credential access."""
import json
import socket
from dataclasses import replace
from hashlib import sha256
import traceback
from typing import Literal

import httpx
import pytest
from pydantic import BaseModel, ConfigDict

from workagent.responses_transport import (
    FrozenSchema, RequestMetadata, build_tool_selection, MODEL, READ_TOOL,
    DispatchPermit, ResponsesTransport, TransportError, build_final, parse_response,
    Provenance, COUNT_FIELDS, OFFICIAL_ORIGIN,
)


class ReadArgs(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    source_id: Literal['approved-source']


class Artifact(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    title: str


def schema(model):
    return FrozenSchema.freeze(model.model_json_schema(), model)


def meta(step='select'):
    return RequestMetadata(request_id='request-1', attempt_id='attempt-1', step_id=step)


def selection():
    return build_tool_selection(instructions='Exact approved skill instructions.',
        source_context='Untrusted source context supplied by the consumer.',
        read_schema=schema(ReadArgs), metadata=meta())


def test_builder_has_only_fixed_controls_and_frozen_schema():
    request = selection()
    payload = json.loads(request.body)
    assert payload['model'] == MODEL
    assert payload['max_output_tokens'] == 8192
    assert payload['reasoning'] == {'effort': 'medium'}
    assert payload['service_tier'] == 'default'
    assert payload['background'] is True and payload['store'] is True
    assert payload['include'] == ['reasoning.encrypted_content']
    assert payload['stream'] is False and payload['truncation'] == 'disabled'
    assert payload['parallel_tool_calls'] is False
    assert payload['tools'] == [{'type': 'function', 'name': READ_TOOL,
        'description': 'Read only the consumer-approved frozen source scope.',
        'strict': True, 'parameters': ReadArgs.model_json_schema()}]
    assert payload['tool_choice'] == {'type': 'function', 'name': READ_TOOL}
    assert not {'conversation', 'previous_response_id', 'context_management'} & payload.keys()


SYNTHETIC = Provenance('synthetic', 'https://synthetic.invalid')


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('Sockets are forbidden: synthetic evidence only')
    monkeypatch.setattr(socket.socket, 'connect', forbidden)


def response(status='completed', **changes):
    return {'id': 'resp_SYNTHETIC', 'object': 'response', 'model': MODEL,
        'service_tier': 'default', 'status': status, 'error': None,
        'usage': {'input_tokens': 100, 'output_tokens': 30, 'total_tokens': 130,
                  'input_tokens_details': {'cached_tokens': 12},
                  'output_tokens_details': {'reasoning_tokens': 20}},
        'output': [{'type': 'reasoning', 'id': 'rs_SYNTHETIC', 'summary': [],
                    'encrypted_content': 'SYNTHETIC-NOT-PROVIDER-REASONING'},
                   {'type': 'function_call', 'id': 'fc_SYNTHETIC', 'call_id': 'call_SYNTHETIC',
                    'status': 'completed', 'name': READ_TOOL,
                    'arguments': '{"source_id":"approved-source"}'}], **changes}


def permit(request, count, **changes):
    return DispatchPermit(**{'metadata': request.metadata, 'request_sha256': request.sha256,
        'input_tokens': count.input_tokens, 'model': MODEL, 'service_tier': 'default',
        'input_reservation_usd_per_million': '2.5', 'output_reservation_usd_per_million': '10',
        'durable_predispatch_committed': True, 'aggregate_budget_reserved': True,
        'live_grant_id': 'SYNTHETIC-NOT-A-LIVE-GRANT', **changes})


@pytest.fixture
def harness():
    clients = []
    def make(handler=None, origin='https://synthetic.invalid'):
        calls = []
        def handle(request):
            calls.append(request)
            if handler:
                return handler(request)
            if request.url.path.endswith('/input_tokens'):
                return httpx.Response(200, json={'object': 'response.input_tokens', 'input_tokens': 20000})
            return httpx.Response(200, json=response())
        client = ResponsesTransport.synthetic(httpx.MockTransport(handle), origin=origin)
        clients.append(client)
        return client, calls
    yield make
    for client in clients:
        client.close()


def final_request():
    first = selection()
    parsed = parse_response(response(), first, SYNTHETIC)
    return build_final(selection_request=first, selection=parsed, tool_output='{"trusted_broker":"data"}',
        instructions='Exact final approved skill instructions.', artifact_schema=schema(Artifact),
        metadata=meta('final'))


def test_count_projection_and_exact_generation_bytes(harness):
    transport, calls = harness()
    first = selection()
    count = transport.count(first)
    persisted = []
    result = transport.create(first, count=count, permit=permit(first, count), on_accepted=persisted.append)
    assert result.state == 'function_call'
    assert result.value == ReadArgs(source_id='approved-source')
    assert len(calls) == 2
    create_payload = json.loads(calls[1].content)
    assert json.loads(calls[0].content) == {k: v for k, v in create_payload.items() if k in COUNT_FIELDS}
    assert calls[1].content == first.body
    assert first.sha256 == sha256(calls[1].content).hexdigest()
    assert count.count_sha256 == sha256(calls[0].content).hexdigest()
    assert count.input_tokens == 20000
    assert persisted[0].response_id == 'resp_SYNTHETIC'
    assert persisted[0].request_sha256 == first.sha256
    assert result.provenance == SYNTHETIC and count.provenance == SYNTHETIC
    assert result.usage.output_tokens == 30 and result.usage.reasoning_tokens == 20
    assert result.usage.total_tokens == 130 and result.usage.cached_input_tokens == 12
    assert all('authorization' not in call.headers for call in calls)


def test_complete_final_history_and_schema_count_alignment(harness):
    request = final_request()
    payload = json.loads(request.body)
    assert payload['input'] == json.loads(selection().body)['input'] + response()['output'] + [
        {'type': 'function_call_output', 'call_id': 'call_SYNTHETIC', 'output': '{"trusted_broker":"data"}'}]
    assert payload['instructions'] == 'Exact final approved skill instructions.'
    assert payload['text']['format'] == {'type': 'json_schema', 'name': 'workagent_artifact',
        'strict': True, 'schema': Artifact.model_json_schema()}
    assert payload['tools'] == [] and payload['tool_choice'] == 'none'
    transport, calls = harness()
    transport.count(request)
    counted = json.loads(calls[0].content)
    for key in ('input', 'instructions', 'text', 'tools', 'reasoning', 'model', 'tool_choice'):
        assert counted[key] == payload[key]
    assert {'background', 'store', 'max_output_tokens', 'service_tier', 'metadata', 'stream', 'include'}.isdisjoint(counted)


@pytest.mark.parametrize('changes', [
    {'model': 'gpt-6-astra'}, {'service_tier': 'auto'}, {'service_tier': 'priority'},
    {'max_output_tokens': 8193}, {'max_output_tokens': 4096}, {'max_output_tokens': True},
    {'reasoning': {'effort': 'high'}}, {'background': False}, {'store': False},
    {'stream': True}, {'truncation': 'auto'}, {'parallel_tool_calls': True},
    {'previous_response_id': 'resp_OLD'}, {'conversation': 'conv_OLD'},
    {'context_management': [{'type': 'compaction'}]}, {'tools': [{'type': 'web_search'}]},
    {'tool_choice': 'auto'}, {'input': [{'type': 'item_reference', 'id': 'msg_OLD'}]},
])
def test_reject_changed_payload_before_count_network(harness, changes):
    transport, calls = harness()
    request = selection()
    body = {**json.loads(request.body), **changes}
    request = replace(request, body=json.dumps(body).encode())
    with pytest.raises(TransportError):
        transport.count(request)
    assert calls == []


@pytest.mark.parametrize('tokens', [20001, -1, True, '100', 1.0, None])
def test_bad_or_excessive_count_never_creates(harness, tokens):
    transport, calls = harness(lambda _: httpx.Response(200, json={
        'object': 'response.input_tokens', 'input_tokens': tokens}))
    with pytest.raises(TransportError, match='invalid_or_excessive_input_count'):
        transport.count(selection())
    assert [call.url.path for call in calls] == ['/v1/responses/input_tokens']


@pytest.mark.parametrize('body', [{}, {'object': 'response', 'input_tokens': 1}, [], None])
def test_malformed_count(harness, body):
    transport, calls = harness(lambda _: httpx.Response(200, content=json.dumps(body)))
    with pytest.raises(TransportError):
        transport.count(selection())
    assert len(calls) == 1


@pytest.mark.parametrize('changes', [
    {'model': 'gpt-6-astra'}, {'service_tier': 'priority'},
    {'input_reservation_usd_per_million': '2'}, {'output_reservation_usd_per_million': '1'},
    {'durable_predispatch_committed': False}, {'aggregate_budget_reserved': False},
    {'input_tokens': 19999}, {'request_sha256': '0' * 64}, {'metadata': meta('other')},
])
def test_unchecked_wrong_permit_rejected(harness, changes):
    transport, calls = harness()
    request = selection()
    count = transport.count(request)
    bad = permit(request, count).model_copy(update=changes)
    with pytest.raises(TransportError, match='consumer_permit_required'):
        transport.create(request, count=count, permit=bad, on_accepted=lambda _: None)
    assert len(calls) == 1


def test_count_cannot_be_reused_for_modified_instruction_or_transport(harness):
    transport, calls = harness()
    other, _ = harness()
    request = selection()
    count = transport.count(request)
    payload = json.loads(request.body)
    payload['instructions'] += ' modified'
    modified = replace(request, body=json.dumps(payload).encode())
    for candidate, req in [(transport, modified), (other, request)]:
        with pytest.raises(TransportError, match='invalid_count_receipt'):
            candidate.create(req, count=count, permit=permit(req, count), on_accepted=lambda _: None)
    assert len(calls) == 1


def test_frozen_schema_not_mutated_and_mismatch_rejected():
    supplied = ReadArgs.model_json_schema()
    frozen = FrozenSchema.freeze(supplied, ReadArgs)
    supplied['properties']['source_id']['const'] = 'outside-scope'
    assert json.loads(frozen.material) == ReadArgs.model_json_schema()
    with pytest.raises(TransportError, match='schema_validator_mismatch'):
        FrozenSchema.freeze(supplied, ReadArgs)


@pytest.mark.parametrize('kind', ['open', 'default'])
def test_reject_non_strict_schema(kind):
    class Open(BaseModel):
        title: str
    class Default(BaseModel):
        model_config = ConfigDict(extra='forbid')
        title: str = 'default'
    with pytest.raises(TransportError, match='schema_not_closed_required'):
        schema(Open if kind == 'open' else Default)


@pytest.mark.parametrize('arguments', [
    'not json', '```json\n{}\n```', '{}', '{"source_id":"outside-scope"}',
    '{"source_id":1}', '{"source_id":"approved-source","command":"write"}',
    '{"source_id":"approved-source","source_id":"outside-scope"}',
])
def test_invalid_structured_tool_arguments_never_actionable(arguments):
    doc = response()
    doc['output'][1]['arguments'] = arguments
    result = parse_response(doc, selection(), SYNTHETIC)
    assert result.state == 'malformed' and result.value is None
    assert result.response_id == 'resp_SYNTHETIC'


@pytest.mark.parametrize('mutation', ['other_tool', 'multiple', 'incomplete_item', 'hosted', 'programmatic'])
def test_invalid_tool_results(mutation):
    doc = response()
    if mutation == 'other_tool':
        doc['output'][1]['name'] = 'shell'
    elif mutation == 'multiple':
        doc['output'].append(dict(doc['output'][1]))
    elif mutation == 'incomplete_item':
        doc['output'][1]['status'] = 'incomplete'
    elif mutation == 'hosted':
        doc['output'].append({'type': 'web_search_call'})
    else:
        doc['output'][1]['caller'] = {'type': 'program', 'caller_id': 'call_program'}
    assert parse_response(doc, selection(), SYNTHETIC).state == 'malformed'


@pytest.mark.parametrize('status', ['queued', 'in_progress', 'incomplete', 'failed', 'cancelled'])
def test_noncompleted_states_never_parse_partial_content(status):
    result = parse_response(response(status, usage=None, output=[{'broken': 'partial'}]), selection(), SYNTHETIC)
    assert result.state == status and result.value is None
    assert result.response_id == 'resp_SYNTHETIC' and result.usage is None


def message(part):
    return {'type': 'message', 'id': 'msg_SYNTHETIC', 'status': 'completed',
            'role': 'assistant', 'content': [part]}


def test_final_typed_output_and_refusal():
    request = final_request()
    doc = response(output=[message({'type': 'output_text', 'text': '{"title":"Artifact"}'})])
    parsed = parse_response(doc, request, SYNTHETIC)
    assert parsed.state == 'completed' and parsed.value == Artifact(title='Artifact')
    doc['output'] = [message({'type': 'refusal', 'refusal': 'SYNTHETIC refusal'})]
    refused = parse_response(doc, request, SYNTHETIC)
    assert refused.state == 'refused' and refused.value is None


@pytest.mark.parametrize('text', ['{}', '{"title":4}', '{"title":"ok","extra":1}',
                                   '{"title":"one","title":"two"}', 'NaN', 'null'])
def test_malformed_final_output(text):
    doc = response(output=[message({'type': 'output_text', 'text': text})])
    assert parse_response(doc, final_request(), SYNTHETIC).state == 'malformed'


@pytest.mark.parametrize('changes', [
    {'model': 'gpt-6.1-sol-unreviewed-snapshot'}, {'service_tier': 'priority'},
    {'service_tier': None}, {'status': 'new_status'}, {'object': 'other'}, {'usage': None},
    {'output': None}, {'output': [None]}, {'error': {'message': 'not accepted'}},
])
def test_malformed_response_contract(changes):
    parsed = parse_response(response(**changes), selection(), SYNTHETIC)
    assert parsed.state == 'malformed' and parsed.response_id == 'resp_SYNTHETIC'


@pytest.mark.parametrize('changes', [
    {'input_tokens': 20001}, {'output_tokens': 8193}, {'input_tokens': True},
    {'output_tokens': '30'}, {'total_tokens': 999},
    {'input_tokens_details': {'cached_tokens': 101}},
    {'output_tokens_details': {'reasoning_tokens': 31}},
    {'output_tokens_details': {}},
])
def test_normalized_usage_rejects_invalid_or_over_cap(changes):
    doc = response()
    doc['usage'].update(changes)
    parsed = parse_response(doc, selection(), SYNTHETIC)
    assert parsed.state == 'malformed' and parsed.issue == 'invalid_usage'


@pytest.mark.parametrize('error_type', [httpx.ReadTimeout, httpx.ConnectError, httpx.WriteError])
def test_network_unknown_no_auto_resend_and_no_exception_secret(harness, error_type):
    secret = 'SYNTHETIC_SECRET_MUST_NOT_LEAK'
    def handle(request):
        if request.url.path.endswith('/input_tokens'):
            return httpx.Response(200, json={'object': 'response.input_tokens', 'input_tokens': 100})
        raise error_type(secret, request=request)
    transport, calls = harness(handle)
    request = selection()
    count = transport.count(request)
    with pytest.raises(TransportError) as caught:
        transport.create(request, count=count, permit=permit(request, count), on_accepted=lambda _: None)
    assert caught.value.outcome_unknown and caught.value.code == 'network_outcome_unknown'
    assert caught.value.__context__ is None
    assert secret not in ''.join(traceback.format_exception(caught.value))
    with pytest.raises(TransportError, match='already_dispatched'):
        transport.create(request, count=count, permit=permit(request, count), on_accepted=lambda _: None)
    assert len(calls) == 2


@pytest.mark.parametrize('status', [302, 400, 401, 429, 500, 503])
def test_http_errors_never_retry_follow_redirect_or_expose_raw_evidence(harness, status):
    def handle(request):
        if request.url.path.endswith('/input_tokens'):
            return httpx.Response(200, json={'object': 'response.input_tokens', 'input_tokens': 100})
        return httpx.Response(status, headers={'Location': 'https://attacker.invalid',
            'x-secret': 'SYNTHETIC_SECRET'}, text='SYNTHETIC_SECRET')
    transport, calls = harness(handle)
    request = selection()
    count = transport.count(request)
    with pytest.raises(TransportError) as caught:
        transport.create(request, count=count, permit=permit(request, count), on_accepted=lambda _: None)
    assert caught.value.http_status == status and caught.value.outcome_unknown
    assert 'SYNTHETIC_SECRET' not in repr(caught.value.__dict__)
    assert len(calls) == 2


@pytest.mark.parametrize('doc', [response('queued', usage=None), response('incomplete'),
                                response(model='wrong'), response(output=[None])])
def test_acceptance_persisted_before_output_validation(harness, monkeypatch, doc):
    import workagent.responses_transport as module
    events = []
    original = module.parse_response
    def parse(*args, **kwargs):
        assert events == ['resp_SYNTHETIC']
        return original(*args, **kwargs)
    monkeypatch.setattr(module, 'parse_response', parse)
    def handle(request):
        if request.url.path.endswith('/input_tokens'):
            return httpx.Response(200, json={'object': 'response.input_tokens', 'input_tokens': 100})
        return httpx.Response(200, json=doc)
    transport, _ = harness(handle)
    request = selection()
    count = transport.count(request)
    result = transport.create(request, count=count, permit=permit(request, count),
                              on_accepted=lambda accepted: events.append(accepted.response_id))
    assert result.response_id == 'resp_SYNTHETIC'


def test_persistence_failure_retains_id_and_never_retries(harness):
    transport, calls = harness()
    request = selection()
    count = transport.count(request)
    def fail(_):
        raise RuntimeError('SYNTHETIC_SECRET')
    with pytest.raises(TransportError) as caught:
        transport.create(request, count=count, permit=permit(request, count), on_accepted=fail)
    assert caught.value.response_id == 'resp_SYNTHETIC' and caught.value.outcome_unknown
    assert caught.value.__context__ is None
    assert len(calls) == 2


@pytest.mark.parametrize('raw', ['not JSON', '{"id":"resp_a","id":"resp_b"}', 'null'])
def test_bad_json_create_stays_unknown(harness, raw):
    def handle(request):
        if request.url.path.endswith('/input_tokens'):
            return httpx.Response(200, json={'object': 'response.input_tokens', 'input_tokens': 100})
        return httpx.Response(200, text=raw)
    transport, calls = harness(handle)
    request = selection()
    count = transport.count(request)
    with pytest.raises(TransportError) as caught:
        transport.create(request, count=count, permit=permit(request, count), on_accepted=lambda _: None)
    assert caught.value.outcome_unknown and len(calls) == 2


def test_retrieve_is_one_readonly_get_cancel_is_explicit(harness):
    transport, calls = harness(origin='http://127.0.0.1:8123')
    request = selection()
    result = transport.retrieve('resp_SYNTHETIC', request=request)
    assert result.provenance == Provenance('synthetic', 'http://127.0.0.1:8123')
    assert len(calls) == 1 and calls[0].method == 'GET'
    assert calls[0].url.path == '/v1/responses/resp_SYNTHETIC'
    assert calls[0].content == b'' and calls[0].url.query == b''
    transport.cancel('resp_SYNTHETIC', request=request)
    assert len(calls) == 2 and calls[1].method == 'POST'
    assert calls[1].url.path == '/v1/responses/resp_SYNTHETIC/cancel'
    assert calls[1].content == b''


@pytest.mark.parametrize('rid', ['resp_x/../responses', 'https://attacker.invalid', 'resp_x?stream=true', ''])
def test_retrieve_response_id_injection_rejected(harness, rid):
    transport, calls = harness()
    with pytest.raises(TransportError, match='invalid_response_id'):
        transport.retrieve(rid, request=selection())
    assert not calls


def test_retrieve_response_identity_must_match(harness):
    transport, _ = harness()
    with pytest.raises(TransportError, match='response_identity_mismatch'):
        transport.retrieve('resp_OTHER', request=selection())


def test_retrieve_failure_never_creates_or_claims_unsent(harness):
    def fail(request):
        raise httpx.ReadTimeout('SYNTHETIC', request=request)
    transport, calls = harness(fail)
    with pytest.raises(TransportError, match='observation_unavailable'):
        transport.retrieve('resp_SYNTHETIC', request=selection())
    assert [call.method for call in calls] == ['GET']


@pytest.mark.parametrize('origin', [OFFICIAL_ORIGIN, 'https://attacker.invalid',
                                    'http://localhost:8080', 'http://127.0.0.1:8080/path'])
def test_synthetic_origin_cannot_claim_official_or_remote(harness, origin):
    with pytest.raises(TransportError, match='invalid_synthetic_origin'):
        harness(origin=origin)


def test_production_is_disabled_without_optin_and_has_fixed_transport(monkeypatch):
    with pytest.raises(TransportError, match='transport_disabled'):
        ResponsesTransport(credential='SYNTHETIC-NOT-A-KEY')
    captured = {}
    # Inspect constructor configuration only; no sockets and no credential lookup.
    def http_transport(**kwargs):
        captured['transport'] = kwargs
        return httpx.MockTransport(lambda _: pytest.fail('NO LIVE REQUEST AUTHORIZED'))
    monkeypatch.setattr(httpx, 'HTTPTransport', http_transport)
    client = ResponsesTransport(credential='SYNTHETIC-NOT-A-KEY', project_id='proj_SYNTHETIC', credential_reference='file:/synthetic/no-key', enabled=True)
    assert client.provenance == Provenance('official_api', OFFICIAL_ORIGIN)
    assert captured['transport'] == {'retries': 0, 'trust_env': False}
    assert str(client._client.base_url) == OFFICIAL_ORIGIN + '/v1/'
    assert client._client.follow_redirects is False
    assert client._client.timeout.connect == 5 and client._client.timeout.read == 30
    client.close()


def test_transport_project_header_and_restart_count(harness,monkeypatch):
    with pytest.raises(TransportError,match='explicit_project_required'):
        ResponsesTransport(credential='synthetic',enabled=True)
    with pytest.raises(TransportError,match='secure_key_reference_required'):
        ResponsesTransport(credential='synthetic',project_id='proj_SYNTHETIC',enabled=True)
    seen=[]
    def factory(**kwargs):
        return httpx.MockTransport(lambda request: (seen.append(request) or httpx.Response(200,json={'object':'response.input_tokens','input_tokens':42})))
    monkeypatch.setattr(httpx,'HTTPTransport',factory)
    t=ResponsesTransport(credential='synthetic',project_id='proj_SYNTHETIC',credential_reference='file:/synthetic/key',enabled=True)
    t.count(selection())
    assert seen[0].headers['OpenAI-Project']=='proj_SYNTHETIC'
    t.close()
    t1,_=harness(); t2,calls=harness(); request=selection()
    original=t1.count(request)
    restored=t2.restore_count(request,input_tokens=original.input_tokens,count_sha256=original.count_sha256,provenance=original.provenance)
    t2.create(request,count=restored,permit=permit(request,restored),on_accepted=lambda _:None)
    assert len(calls)==1 and calls[0].url.path=='/v1/responses'


@pytest.mark.parametrize('metadata',[None,{}, {'request_id':'wrong','attempt_id':'attempt-1','step_id':'select'}])
def test_strict_transport_correlation_rejected(metadata):
    result=parse_response(response(metadata=metadata),selection(),SYNTHETIC,require_correlation=True)
    assert result.state=='malformed' and result.issue=='response_correlation_mismatch'


@pytest.mark.parametrize('doc', [None, [], '', 1, True, {}])
def test_nonobject_or_missing_response_is_malformed(doc):
    parsed = parse_response(doc, selection(), SYNTHETIC)
    assert parsed.state == 'malformed' and parsed.response_id is None


def test_stored_reasoning_preserves_id_but_stateless_needs_ciphertext():
    doc = response()
    del doc['output'][0]['encrypted_content']
    request=selection()
    parsed = parse_response(doc, request, SYNTHETIC)
    assert parsed.state=='function_call'
    assert json.loads(parsed.output_items)==doc['output']
    payload=json.loads(request.body);payload['store']=False
    parsed=parse_response(doc,replace(request,body=json.dumps(payload).encode()),SYNTHETIC)
    assert parsed.state == 'malformed' and parsed.issue == 'invalid_request_policy'
    from workagent.responses_transport import _output_shape
    with pytest.raises(TransportError, match='invalid_reasoning_item'):
        _output_shape(doc['output'], stored=False)


@pytest.mark.parametrize('changes', [
    {'model': 'wrong-model'}, {'background': False}, {'parallel_tool_calls': True},
    {'metadata': {}}, {'previous_response_id': 'resp_OTHER'},
])
def test_stored_reasoning_parser_validates_entire_originating_request(changes):
    doc = response()
    del doc['output'][0]['encrypted_content']
    request = selection()
    payload = {**json.loads(request.body), **changes}
    assert payload['store'] is True
    parsed = parse_response(doc, replace(request, body=json.dumps(payload).encode()), SYNTHETIC)
    assert parsed.state == 'malformed'
    assert parsed.issue == 'invalid_request_policy'
    assert parsed.value is None and parsed.output_items == b'[]'


@pytest.mark.parametrize('change', ['wrong_request', 'incomplete', 'refused'])
def test_final_requires_matching_successful_selection(change):
    initial = selection()
    parsed = parse_response(response(), initial, SYNTHETIC)
    if change == 'wrong_request':
        parsed = replace(parsed, request_sha256='0' * 64)
    else:
        parsed = replace(parsed, state=change)
    with pytest.raises(TransportError, match='invalid_continuation'):
        build_final(selection_request=initial, selection=parsed, tool_output='read result',
            instructions='approved', artifact_schema=schema(Artifact), metadata=meta('final'))


@pytest.mark.parametrize('change', ['drop_initial', 'drop_call', 'wrong_call_id', 'reference'])
def test_final_history_tampering_rejected_before_network(harness, change):
    transport, calls = harness()
    request = final_request()
    payload = json.loads(request.body)
    if change == 'drop_initial':
        payload['input'].pop(0)
    elif change == 'drop_call':
        payload['input'].pop(-2)
    elif change == 'wrong_call_id':
        payload['input'][-1]['call_id'] = 'unrelated'
    else:
        payload['input'][1] = {'type': 'item_reference', 'id': 'rs_SYNTHETIC'}
    with pytest.raises(TransportError):
        transport.count(replace(request, body=json.dumps(payload).encode()))
    assert calls == []


def test_boundary_usage_does_not_double_count_reasoning():
    doc = response()
    doc['usage'] = {'input_tokens': 20000, 'output_tokens': 8192, 'total_tokens': 28192,
        'input_tokens_details': {'cached_tokens': 20000},
        'output_tokens_details': {'reasoning_tokens': 8192}}
    parsed = parse_response(doc, selection(), SYNTHETIC)
    assert parsed.state == 'function_call' and parsed.usage.total_tokens == 28192


def test_synthetic_rejects_nonmock_transport():
    with pytest.raises(TransportError, match='synthetic_mock_required'):
        ResponsesTransport.synthetic(object())
