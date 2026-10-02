"""Disabled integration candidate: explicit Responses HTTP operations, not a worker.

No environment/credential discovery, import-time I/O, execution loop, tool execution,
retry or recovery policy. A consumer's durable dispatch permit is REQUIRED; this
module is not an aggregate budget authority. See handoffs/backend/RESPONSES_TRANSPORT.md.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
import re
from threading import Lock
from typing import Callable, Literal, TypedDict

import httpx
from pydantic import BaseModel, ConfigDict, Field

MODEL = 'gpt-6.1-sol'
READ_TOOL = 'read_scoped_context'
OFFICIAL_ORIGIN = 'https://api.openai.com'
MAX_INPUT_TOKENS = 20_000
MAX_OUTPUT_TOKENS = 8192
# These are reservation rates, NOT a claim about actual billed/cache-discount cost.
INPUT_RESERVATION_RATE = '2.5'
OUTPUT_RESERVATION_RATE = '10'
COUNT_FIELDS = frozenset({'model', 'input', 'instructions', 'tools', 'tool_choice',
                          'parallel_tool_calls', 'reasoning', 'text', 'truncation'})
_FIXED = {'model': MODEL, 'reasoning': {'effort': 'medium'}, 'service_tier': 'default',
          'max_output_tokens': MAX_OUTPUT_TOKENS, 'background': True, 'store': True,
          'include': ['reasoning.encrypted_content'],
          'stream': False, 'parallel_tool_calls': False, 'truncation': 'disabled'}


class TransportError(Exception):
    """Only fixed codes and sanitized IDs; never a provider body/header/exception."""
    def __init__(self, code: str, *, outcome_unknown: bool = False,
                 response_id: str | None = None, http_status: int | None = None):
        super().__init__(code)
        self.code = code
        self.outcome_unknown = outcome_unknown
        self.response_id = response_id
        self.http_status = http_status


def _canonical(value: object) -> bytes:
    try:
        result = json.dumps(value, sort_keys=True, separators=(',', ':'),
                            ensure_ascii=False, allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, UnicodeError):
        result = None
    if result is None:
        raise TransportError('invalid_json')
    return result


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate key')
        result[key] = value
    return result


def _json(value: str | bytes):
    try:
        result = json.loads(value, object_pairs_hook=_unique_object,
                            parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError, UnicodeError, RecursionError):
        result = None
    if result is None:
        raise TransportError('invalid_json')
    return result


class RequestMetadata(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, frozen=True)
    request_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')
    attempt_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')
    step_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')


class DispatchPermit(BaseModel):
    """Trusted consumer assertion, minted ONLY after durable reservation/dispatch.

    Not a cryptographic capability or a replacement for DB single-winner fencing.
    No defaults: the caller must explicitly assert each policy value.
    """
    model_config = ConfigDict(extra='forbid', strict=True, frozen=True)
    metadata: RequestMetadata
    request_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    input_tokens: int = Field(ge=0, le=MAX_INPUT_TOKENS)
    model: Literal['gpt-6.1-sol']
    service_tier: Literal['default']
    input_reservation_usd_per_million: Literal['2.5']
    output_reservation_usd_per_million: Literal['10']
    durable_predispatch_committed: bool
    aggregate_budget_reserved: bool
    live_grant_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')


@dataclass(frozen=True)
class FrozenSchema:
    """An exact supplied schema and its matching trusted Pydantic validator.

    Use a closed DTO with every property required (nullable where appropriate).
    This intentionally does not rewrite domain models or silently repair schemas.
    """
    material: bytes = field(repr=False)
    model: type[BaseModel] = field(repr=False)

    @classmethod
    def freeze(cls, supplied: dict, model: type[BaseModel]) -> FrozenSchema:
        material = _canonical(supplied)
        if material != _canonical(model.model_json_schema()):
            raise TransportError('schema_validator_mismatch')
        def closed(node):
            if isinstance(node, dict):
                if node.get('type') == 'object':
                    if (node.get('additionalProperties') is not False or
                            set(node.get('required', [])) != set(node.get('properties', {}))):
                        raise TransportError('schema_not_closed_required')
                for child in node.values():
                    closed(child)
            elif isinstance(node, list):
                for child in node:
                    closed(child)
        closed(supplied)
        if supplied.get('type') != 'object':
            raise TransportError('schema_root_not_object')
        return cls(material, model)

    def validate(self, text: str) -> BaseModel:
        value = _json(text)  # Reject duplicate keys/non-JSON constants before Pydantic.
        valid = None
        try:
            if self.material == _canonical(self.model.model_json_schema()):
                valid = self.model.model_validate(value, strict=True)
        except Exception:
            pass  # Consumer validators are trusted code, but their errors are not evidence.
        if valid is None:
            raise TransportError('schema_validation_failed')
        return valid


@dataclass(frozen=True)
class PreparedRequest:
    body: bytes = field(repr=False)
    metadata: RequestMetadata
    phase: Literal['selection', 'final']
    schema: FrozenSchema = field(repr=False)

    @property
    def sha256(self) -> str:
        return sha256(self.body).hexdigest()

    def count_body(self) -> bytes:
        payload = _validate_request(self)
        # Only documented count endpoint fields; never send create-only controls.
        return _canonical({key: value for key, value in payload.items() if key in COUNT_FIELDS})


def _tool(schema: FrozenSchema) -> dict:
    return {'type': 'function', 'name': READ_TOOL,
            'description': 'Read only the consumer-approved frozen source scope.',
            'strict': True, 'parameters': _json(schema.material)}


def _build(*, instructions, history, schema, metadata, phase):
    if not isinstance(instructions, str) or not instructions:
        raise TransportError('missing_approved_instructions')
    payload = {**_FIXED, 'instructions': instructions, 'input': history,
               'metadata': metadata.model_dump()}
    if phase == 'selection':
        payload.update(tools=[_tool(schema)], tool_choice={'type': 'function', 'name': READ_TOOL})
    else:
        payload.update(tools=[], tool_choice='none', text={'format': {
            'type': 'json_schema', 'name': 'workagent_artifact', 'strict': True,
            'schema': _json(schema.material)}})
    request = PreparedRequest(_canonical(payload), metadata, phase, schema)
    _validate_request(request)
    return request


def build_tool_selection(*, instructions: str, source_context: str,
                         read_schema: FrozenSchema, metadata: RequestMetadata) -> PreparedRequest:
    """The sole named tool; the consumer/broker, NEVER the model, grants scope."""
    if not isinstance(source_context, str):
        raise TransportError('invalid_source_context')
    return _build(instructions=instructions, history=[{'role': 'user', 'content': source_context}],
                  schema=read_schema, metadata=metadata, phase='selection')


def build_final(*, selection_request: PreparedRequest, selection: ParsedResponse,
                tool_output: str, instructions: str, artifact_schema: FrozenSchema,
                metadata: RequestMetadata) -> PreparedRequest:
    """Explicit complete history: initial input + ALL output + scoped tool result.

    The consumer must verify frozen source versions and broker scope before supplying
    tool_output. The transport neither executes a tool nor authenticates its result.
    """
    initial = _validate_request(selection_request)
    if (selection_request.phase != 'selection' or selection.state != 'function_call' or
            selection.request_sha256 != selection_request.sha256 or not selection.call_id or
            not isinstance(tool_output, str)):
        raise TransportError('invalid_continuation')
    history = initial['input'] + _json(selection.output_items) + [
        {'type': 'function_call_output', 'call_id': selection.call_id, 'output': tool_output}]
    return _build(instructions=instructions, history=history, schema=artifact_schema,
                  metadata=metadata, phase='final')


def _validate_request(request: PreparedRequest) -> dict:
    payload = _json(request.body)
    allowed = set(_FIXED) | {'instructions', 'input', 'metadata', 'tools', 'tool_choice'}
    if request.phase == 'final':
        allowed.add('text')
    elif request.phase != 'selection':
        raise TransportError('invalid_request_policy')
    if (not isinstance(payload, dict) or set(payload) != allowed or
            any(_canonical(payload.get(k)) != _canonical(v) for k, v in _FIXED.items()) or
            payload.get('metadata') != request.metadata.model_dump() or
            not isinstance(payload.get('instructions'), str) or not payload['instructions']):
        raise TransportError('invalid_request_policy')
    FrozenSchema.freeze(_json(request.schema.material), request.schema.model)
    if request.phase == 'selection':
        valid = (_canonical(payload['tools']) == _canonical([_tool(request.schema)]) and
                 payload['tool_choice'] == {'type': 'function', 'name': READ_TOOL})
    else:
        valid = (payload['tools'] == [] and payload['tool_choice'] == 'none' and
                 _canonical(payload['text']) == _canonical({'format': {'type': 'json_schema',
                     'name': 'workagent_artifact', 'strict': True,
                     'schema': _json(request.schema.material)}}))
    history = payload['input']
    if not valid or not isinstance(history, list) or not history:
        raise TransportError('invalid_request_policy')
    # Do not accept implicit item references, hosted tools, files, images or hidden
    # server-side expansion. This candidate has exactly one initial source message.
    first = history[0]
    if (not isinstance(first, dict) or set(first) != {'role', 'content'} or
            first['role'] != 'user' or not isinstance(first['content'], str)):
        raise TransportError('invalid_history')
    if request.phase == 'selection' and len(history) != 1:
        raise TransportError('invalid_history')
    if request.phase == 'final':
        if len(history) < 3:
            raise TransportError('invalid_history')
        calls = _output_shape(history[1:-1])
        last = history[-1]
        if (len(calls) != 1 or not isinstance(last, dict) or
                set(last) != {'type', 'call_id', 'output'} or
                last['type'] != 'function_call_output' or
                last['call_id'] != calls[0]['call_id'] or not isinstance(last['output'], str)):
            raise TransportError('invalid_history')
    return payload


@dataclass(frozen=True)
class Provenance:
    mode: Literal['official_api', 'synthetic']
    origin: str
    # Synthetic mode NEVER constitutes provider/model/account evidence.


@dataclass(frozen=True)
class TokenCount:
    request_sha256: str
    count_sha256: str
    input_tokens: int
    metadata: RequestMetadata
    provenance: Provenance
    _issuer: object = field(repr=False, compare=False)


@dataclass(frozen=True)
class Acceptance:
    response_id: str
    request_sha256: str
    metadata: RequestMetadata
    provenance: Provenance


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    output_tokens: int  # Includes reasoning; NEVER add reasoning again.
    total_tokens: int
    cached_input_tokens: int
    reasoning_tokens: int


@dataclass(frozen=True)
class ParsedResponse:
    response_id: str | None
    request_sha256: str
    metadata: RequestMetadata
    provenance: Provenance
    state: Literal['queued', 'in_progress', 'function_call', 'completed', 'refused',
                   'incomplete', 'failed', 'cancelled', 'malformed']
    usage: Usage | None = None
    value: BaseModel | None = field(default=None, repr=False)
    call_id: str | None = None
    output_items: bytes = field(default=b'[]', repr=False)
    issue: str | None = None


class _ResponseIdentity(TypedDict):
    response_id: str | None
    request_sha256: str
    metadata: RequestMetadata
    provenance: Provenance


def _response_id(value) -> str | None:
    return value if isinstance(value, str) and re.fullmatch(r'resp_[A-Za-z0-9_-]{1,200}', value) else None


def _integer(value):
    if type(value) is not int or value < 0:
        raise TransportError('invalid_usage')
    return value


def _usage(value) -> Usage | None:
    if value is None:
        return None
    try:
        result = Usage(_integer(value['input_tokens']), _integer(value['output_tokens']),
                       _integer(value['total_tokens']),
                       _integer(value['input_tokens_details']['cached_tokens']),
                       _integer(value['output_tokens_details']['reasoning_tokens']))
    except (KeyError, TypeError):
        raise TransportError('invalid_usage') from None
    if (result.input_tokens > MAX_INPUT_TOKENS or result.output_tokens > MAX_OUTPUT_TOKENS or
            result.total_tokens != result.input_tokens + result.output_tokens or
            result.cached_input_tokens > result.input_tokens or result.reasoning_tokens > result.output_tokens):
        raise TransportError('invalid_usage')
    return result


def _output_shape(output, *, continuation=True) -> list[dict]:
    """Closed supported output item types; preserve complete JSON for continuation."""
    if not isinstance(output, list):
        raise TransportError('invalid_output')
    calls = []
    for item in output:
        if not isinstance(item, dict):
            raise TransportError('invalid_output')
        kind = item.get('type')
        if item.get('status', 'completed') != 'completed':
            raise TransportError('unfinished_output_item')
        if kind == 'function_call':
            if (item.get('name') != READ_TOOL or not isinstance(item.get('arguments'), str) or
                    not isinstance(item.get('call_id'), str) or
                    not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', item['call_id']) or
                    item.get('namespace') is not None or
                    item.get('caller', {'type': 'direct'}) != {'type': 'direct'}):
                raise TransportError('invalid_function_call')
            calls.append(item)
        elif kind == 'reasoning':
            encrypted = item.get('encrypted_content')
            if (not isinstance(item.get('id'), str) or not isinstance(item.get('summary'), list) or
                    (continuation and (not isinstance(encrypted, str) or not encrypted)) or
                    (encrypted is not None and (not isinstance(encrypted, str) or not encrypted))):
                raise TransportError('invalid_reasoning_item')
        elif kind == 'message':
            if item.get('role') != 'assistant' or not isinstance(item.get('content'), list):
                raise TransportError('invalid_message')
            for part in item['content']:
                if not isinstance(part, dict) or part.get('type') not in ('output_text', 'refusal'):
                    raise TransportError('invalid_message')
                key = 'text' if part['type'] == 'output_text' else 'refusal'
                if not isinstance(part.get(key), str):
                    raise TransportError('invalid_message')
        else:
            raise TransportError('unsupported_output_item')
    return calls


def parse_response(document: object, request: PreparedRequest, provenance: Provenance, *, require_correlation=False) -> ParsedResponse:
    """Pure parsing: never executes calls, repairs JSON, retries or resumes a model."""
    rid = _response_id(document.get('id')) if isinstance(document, dict) else None
    base: _ResponseIdentity = {'response_id': rid, 'request_sha256': request.sha256,
                               'metadata': request.metadata, 'provenance': provenance}
    usage = None
    try:
        if (not isinstance(document, dict) or not rid or
                document.get('object') != 'response' or document.get('model') != MODEL or
                document.get('service_tier') != 'default'):
            raise TransportError('response_contract_mismatch')
        if (require_correlation or 'metadata' in document) and document.get('metadata')!=request.metadata.model_dump():
            raise TransportError('response_correlation_mismatch')
        usage = _usage(document.get('usage'))
        state = document.get('status')
        if state in ('queued', 'in_progress', 'incomplete', 'failed', 'cancelled'):
            return ParsedResponse(**base, state=state, usage=usage)
        if state != 'completed' or usage is None or document.get('error') is not None:
            raise TransportError('invalid_terminal_response')
        output = document.get('output')
        if not isinstance(output, list):
            raise TransportError('invalid_output')
        # Final output is never replayed to a model. Retrieve need not include
        # encrypted_content; selection still requires complete continuation state.
        calls = _output_shape(output, continuation=request.phase == 'selection')
        parts = [part for item in output if item['type'] == 'message' for part in item['content']]
        if any(part['type'] == 'refusal' for part in parts):
            return ParsedResponse(**base, state='refused', usage=usage)
        if request.phase == 'selection':
            if len(calls) != 1:
                raise TransportError('expected_single_scoped_call')
            value = request.schema.validate(calls[0]['arguments'])
            return ParsedResponse(**base, state='function_call', usage=usage, value=value,
                                  call_id=calls[0]['call_id'], output_items=_canonical(output))
        if calls or len(parts) != 1 or parts[0]['type'] != 'output_text':
            raise TransportError('expected_structured_output')
        value = request.schema.validate(parts[0]['text'])
        return ParsedResponse(**base, state='completed', usage=usage, value=value)
    except TransportError as error:
        return ParsedResponse(**base, state='malformed', usage=usage, issue=error.code)


@dataclass(frozen=True)
class _ConstructionBinding:
    provenance: Provenance
    project_id: str | None
    credential_reference: str | None


# Pin exact client construction types, including when tests instrument factories.
_OFFICIAL_HTTP_TRANSPORT = httpx.HTTPTransport
_SYNTHETIC_HTTP_TRANSPORT = httpx.MockTransport


class ResponsesTransport:
    """Explicit one-operation HTTP boundary. Close when finished.

    Production construction requires opt-in and an injected credential. Synthetic
    construction permits ONLY HTTPX MockTransport and labels every result as such.
    No aggregate counter, scheduler, broker, CLI, database or provider activation.
    """
    def __init__(self, *, credential: str, project_id: str | None = None, credential_reference: str | None = None, enabled: bool = False):
        if enabled is not True:
            raise TransportError('transport_disabled')
        if not isinstance(credential, str) or not re.fullmatch(r'[!-~]+', credential):
            raise TransportError('invalid_injected_credential')
        if not isinstance(project_id,str) or not re.fullmatch(r'proj_[A-Za-z0-9_-]{1,100}',project_id):
            raise TransportError('explicit_project_required')
        if not isinstance(credential_reference,str) or not re.fullmatch(r'file:/[A-Za-z0-9_./-]{1,400}',credential_reference):
            raise TransportError('secure_key_reference_required')
        self._initialize(OFFICIAL_ORIGIN, 'official_api',
                         httpx.HTTPTransport(retries=0, trust_env=False),
                         {'Authorization': 'Bearer ' + credential, 'OpenAI-Project': project_id},
                         project_id=project_id, credential_reference=credential_reference)
        self.require_correlation=True

    @classmethod
    def synthetic(cls, transport: httpx.MockTransport, *, origin: str = 'https://synthetic.invalid'):
        if type(transport) is not httpx.MockTransport:
            raise TransportError('synthetic_mock_required')
        if not (origin == 'https://synthetic.invalid' or
                re.fullmatch(r'http://127\.0\.0\.1:[0-9]{1,5}', origin)):
            raise TransportError('invalid_synthetic_origin')
        result = cls.__new__(cls)
        result._initialize(origin, 'synthetic', transport, {})
        return result

    @property
    def provenance(self):
        return self._binding.provenance

    @property
    def project_id(self):
        return self._binding.project_id

    @property
    def credential_reference(self):
        return self._binding.credential_reference

    def matches_binding(self, mode, project_id, credential_reference):
        """Validate construction/client mode, not caller-supplied public labels.

        Supported-interface integrity only; not a sandbox against arbitrary Python
        code mutating private state or replacing implementation methods.
        """
        b = self._binding
        if (type(self) is not ResponsesTransport or b.provenance.mode != mode or
                str(self._client.base_url) != b.provenance.origin + '/v1/'):
            return False
        if mode == 'synthetic':
            return (type(self._client._transport) is _SYNTHETIC_HTTP_TRANSPORT and
                    b.project_id is None and b.credential_reference is None)
        return (mode == 'official_api' and b.provenance.origin == OFFICIAL_ORIGIN and
                type(self._client._transport) is _OFFICIAL_HTTP_TRANSPORT and
                b.project_id == project_id and b.credential_reference == credential_reference and
                self._client.headers.get('OpenAI-Project') == project_id)

    def _initialize(self, origin, mode, transport, headers, *, project_id=None, credential_reference=None):
        self._binding = _ConstructionBinding(Provenance(mode, origin), project_id, credential_reference)
        self.require_correlation=False
        self._issuer = object()
        self._sent = set()
        self._lock = Lock()
        self._client = httpx.Client(base_url=origin + '/v1/', transport=transport,
            timeout=httpx.Timeout(30.0, connect=5.0), follow_redirects=False, trust_env=False,
            headers={**headers, 'Content-Type': 'application/json'})

    def close(self):
        self._client.close()

    def _send(self, method: str, path: str, body: bytes | None, *, mutating: bool):
        error = None
        try:
            response = self._client.request(method, path, content=body)
        except Exception:
            error = TransportError('network_outcome_unknown' if mutating else 'observation_unavailable',
                                   outcome_unknown=mutating)
        if error is not None:
            raise error  # Outside except: do not retain a secret-bearing exception context.
        if not 200 <= response.status_code < 300:
            raise TransportError('http_error', outcome_unknown=mutating, http_status=response.status_code)
        try:
            document = _json(response.content)
        except TransportError:
            error = TransportError('malformed_response', outcome_unknown=mutating)
        if error is not None:
            raise error
        return document

    def count(self, request: PreparedRequest) -> TokenCount:
        body = request.count_body()  # Validates model AND entire generation payload.
        data = self._send('POST', 'responses/input_tokens', body, mutating=False)
        if (not isinstance(data, dict) or data.get('object') != 'response.input_tokens' or
                type(data.get('input_tokens')) is not int or not 0 <= data['input_tokens'] <= MAX_INPUT_TOKENS):
            raise TransportError('invalid_or_excessive_input_count')
        # The official count response does NOT echo model. Bind our exact sent
        # payload locally; never invent a provider-verified model response field.
        return TokenCount(request.sha256, sha256(body).hexdigest(), data['input_tokens'],
                          request.metadata, self.provenance, self._issuer)

    def create(self, request: PreparedRequest, *, count: TokenCount, permit: DispatchPermit,
               on_accepted: Callable[[Acceptance], None]) -> ParsedResponse:
        body = request.count_body()
        if (count._issuer is not self._issuer or count.request_sha256 != request.sha256 or
                count.count_sha256 != sha256(body).hexdigest() or count.metadata != request.metadata or
                count.provenance != self.provenance or type(count.input_tokens) is not int or
                not 0 <= count.input_tokens <= MAX_INPUT_TOKENS or not callable(on_accepted)):
            raise TransportError('invalid_count_receipt')
        # Revalidate even if a caller used Pydantic's unchecked model_construct.
        valid_permit = None
        try:
            valid_permit = DispatchPermit.model_validate(permit.model_dump())
        except Exception:
            pass
        if (valid_permit is None or valid_permit.metadata != request.metadata or
                valid_permit.request_sha256 != request.sha256 or valid_permit.input_tokens != count.input_tokens or
                valid_permit.durable_predispatch_committed is not True or
                valid_permit.aggregate_budget_reserved is not True):
            raise TransportError('consumer_permit_required')
        key = (request.metadata.attempt_id, request.metadata.step_id)
        with self._lock:
            if key in self._sent:
                raise TransportError('already_dispatched', outcome_unknown=True)
            self._sent.add(key)  # Local defense only; never removed on failure.
        data = self._send('POST', 'responses', request.body, mutating=True)
        rid = _response_id(data.get('id')) if isinstance(data, dict) else None
        if not rid:
            # A 2xx without a usable identity is still an incurred/ambiguous send,
            # not a terminal result that can satisfy identity-bound persistence.
            raise TransportError('missing_or_invalid_response_id', outcome_unknown=True)
        if rid:
            failed = False
            try:
                on_accepted(Acceptance(rid, request.sha256, request.metadata, self.provenance))
            except Exception:
                failed = True
            if failed:
                raise TransportError('acceptance_persistence_failed', outcome_unknown=True, response_id=rid)
        return parse_response(data, request, self.provenance, require_correlation=self.require_correlation)

    def restore_count(self, request: PreparedRequest, *, input_tokens: int,
                      count_sha256: str, provenance: Provenance) -> TokenCount:
        """Consumer-only rehydration of an authenticated immutable DB count.

        Not budget authority. create still needs a durable single-winner permit.
        """
        if (type(input_tokens) is not int or not 0<=input_tokens<=MAX_INPUT_TOKENS or
                count_sha256!=sha256(request.count_body()).hexdigest() or provenance!=self.provenance):
            raise TransportError('invalid_count_receipt')
        return TokenCount(request.sha256,count_sha256,input_tokens,request.metadata,provenance,self._issuer)

    def retrieve(self, response_id: str, *, request: PreparedRequest) -> ParsedResponse:
        """ONE read-only GET. Scheduling, ownership checks and poll limits are external."""
        return self._observe('GET', response_id, request, cancel=False)

    def cancel(self, response_id: str, *, request: PreparedRequest) -> ParsedResponse:
        """ONE explicit cancellation; not automatic recovery or a generation retry."""
        return self._observe('POST', response_id, request, cancel=True)

    def _observe(self, method, response_id, request, *, cancel):
        _validate_request(request)
        if not _response_id(response_id):
            raise TransportError('invalid_response_id')
        path = 'responses/' + response_id + ('/cancel' if cancel else '')
        data = self._send(method, path, None, mutating=cancel)
        if not isinstance(data, dict) or data.get('id') != response_id:
            raise TransportError('response_identity_mismatch', outcome_unknown=cancel, response_id=response_id)
        return parse_response(data, request, self.provenance, require_correlation=self.require_correlation)
