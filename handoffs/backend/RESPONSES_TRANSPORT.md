# Responses HTTP transport — disabled implementation candidate

**Not an activated provider, worker, or live-evidence report.** This branch adds only a
transport, synthetic tests, and this handoff. No credential was read, no account endpoint
was queried, and no model/count/retrieve/cancel request was sent to a provider.

The slice began without a live grant. During implementation the user separately granted
the Sol slice with a **$20 cumulative model-spend ceiling**, preserving the four-generation
request limit, per-request limits, scenarios, and no-retry policy. The parent owns that
record at `handoffs/backend/INTAKE_LIVE_GRANT.json` in its integration worktree. That grant
does **not** activate this candidate: product project/secure credential access and worker
integration/review gates remain pending. This delegated slice remains **no-inference**.
There is intentionally no aggregate-dollar-cap constant in the transport.

## Surface and exact HTTP APIs

No OpenAI SDK dependency; uses the existing pinned HTTPX 0.28.1 and Pydantic 2.11.5.
Production origin is fixed to `https://api.openai.com`, prefix `/v1/`:

| Operation | Endpoint / behavior |
|---|---|
| `build_tool_selection(...)` | Pure builder; no HTTP |
| `build_final(...)` | Pure builder; no HTTP |
| `count(request)` | `POST /v1/responses/input_tokens` once |
| `create(request, count=..., permit=..., on_accepted=...)` | `POST /v1/responses` once |
| `retrieve(response_id, request=...)` | `GET /v1/responses/{response_id}` once, no body/query |
| `cancel(response_id, request=...)` | Explicit `POST /v1/responses/{response_id}/cancel` once |
| `parse_response(document, request, provenance)` | Pure parser; no repair or execution |

Production construction requires `enabled=True` and a credential injected directly by
an already-authorized consumer. Neither import nor construction sends anything. The
default is disabled. No environment, secret manager, account, provider selection, CLI,
proxy discovery, or application wiring is added. `close()` releases the HTTPX client.

HTTPX uses `HTTPTransport(retries=0, trust_env=False)`, `follow_redirects=False`, TLS
verification defaults, 5-second connect and 30-second read/write/pool timeouts. These are
**bounded per-phase/inactivity timeouts, not a total wall-clock execution deadline**;
the worker must enforce its own overall deadline and bounded observation schedule.
There is no retry, sleep, poll loop, resume, fallback, repair generation, or model loop.

## Fixed request policy and histories

Every generation request fixes:

- model `gpt-6.1-sol`, reasoning `{"effort":"medium"}`, tier `default`;
- `max_output_tokens=8192` (visible **plus** reasoning output);
- `background=true`, `store=true`, `stream=false`, `truncation="disabled"`;
- `parallel_tool_calls=false`, `include=["reasoning.encrypted_content"]`.

The initial selection request exposes exactly one **function**,
`read_scoped_context`, with the consumer's exact frozen schema, `strict=true`, and a
forced named `tool_choice`. No hosted tools, shell, MCP, freeform custom tools, writes,
subagents, compaction, or automatic tool executor exists. This name alone grants nothing:
the worker's scoped broker must independently authorize the typed arguments against
frozen source grants and versions. Consumer schemas should enumerate permitted IDs
where possible. The transport does not turn a source ID or instruction into authority.

The consumer supplies exact approved skill instructions in `instructions` and frozen
source context as a user message. Neither is rewritten or implicitly loaded from a file.

`build_final` requires a matching successful selection receipt and combines:

1. the entire original input;
2. **all** initial output items, including reasoning, message phase, and function call;
3. the consumer/broker-supplied `function_call_output` bound to the exact call ID.

It supplies the consumer's exact approved final instructions, disables tools, and uses
`text.format={type:"json_schema", name:"workagent_artifact", strict:true, schema:...}`.
No `previous_response_id`, `conversation`, prompt reference, item-reference-only history,
server compaction, media/files, or hidden history extension is accepted. Encrypted
reasoning is explicitly requested; a reasoning item without its encrypted content is
rejected rather than relying on an ID-only continuation. No extra generation is sent to
obtain missing content.

`FrozenSchema.freeze(supplied_schema, PydanticModel)` requires exact canonical equality
with `model_json_schema()`, a root object, closed objects (`additionalProperties=false`),
and every property required. It snapshots bytes and does not mutate/normalize the
consumer schema. Validation is strict and rejects malformed JSON, duplicate keys,
non-JSON constants, missing required fields, extra properties, and wrong argument types.
Use closed required-field DTOs with explicit nullable fields where needed. This module
**does not change the canonical domain `Body` model** or claim existing domain schemas
with defaulted fields can be sent unchanged as strict provider schemas.

## Count/create alignment and immutable ledger material

`PreparedRequest.body` is the exact canonical UTF-8 JSON bytes sent by `create`; its
`sha256` hashes those exact bytes. The body contains caller-supplied `RequestMetadata`
(`request_id`, `attempt_id`, `step_id`) as provider metadata. Metadata and receipt objects
are immutable; request/schema/output bytes are omitted from their default reprs.

Before counting, the entire generation payload is validated against fixed controls,
phase, history, and frozen schema. `count_body()` projects exactly the documented count
fields used by this candidate: model, input, instructions, tools, tool_choice,
parallel_tool_calls, reasoning, text when present, and truncation. It includes the complete
final history, tool output, and final response schema. Create-only fields (background,
store, stream, include, max_output_tokens, service_tier, metadata) are **not invented as
count API parameters**. They are still validated locally and bound by the generation hash.

The official count result has only `object="response.input_tokens"` and `input_tokens`;
it **does not echo the model or payload hash**. We validate the outgoing model/full request,
then bind its hashes, metadata, origin, and count locally. We do not claim the provider
returned a verified model field. Counts must be real nonnegative integers, not booleans,
and at most 20,000. `create` requires the same transport's receipt for the exact request
and rejects changed instructions/schema/policy. Count requests never generate output.

Persist both request bytes/hash and count bytes/hash under the immutable step ledger's
normal source-data protections. Do not put full histories or source data in generic logs.
The in-memory count issuer is intentionally not a restart/replay authorization mechanism.

## REQUIRED consumer authority and durable step ledger

`DispatchPermit` is a typed **trusted-consumer assertion**, not cryptographic proof and
not evidence that a DB transaction actually happened. It has no defaults: the consumer
must supply matching metadata, request hash/count, exact model/tier, input reservation
rate `"2.5"`, output reservation rate `"10"`, a grant ID, and explicit true flags for
`durable_predispatch_committed` and `aggregate_budget_reserved`. It is revalidated before
sending even if constructed with an unchecked Pydantic API.

The input rate is the model page's conservative **cache-write reservation rate** per
million tokens, not its $2 ordinary-input rate; output reservation uses $10 per million.
These are reservation pins, **not actual billed cost** or cache-discount calculations.
Regional premiums, pricing changes, and aggregate spend reconciliation belong to the
consumer. Rates cannot silently change in a permit. No billing claim is inferred from
HTTP headers or provider message text.

Before minting each permit the future worker/database MUST:

1. Validate the live grant, product project/credential binding, approved model/tier/rates,
   instructions and schema hashes, reviewed consumer hash, run/attempt/step ownership,
   source scope/versions, lease/fence, cancellation, and grant expiry.
2. Persist the immutable exact request and count materials, and reserve the maximum
   output including reasoning plus conservatively priced input.
3. Atomically enforce the grant-wide ceiling: **at most four generation requests**, at
   most 20,000 input/8,192 output each, cumulative input/output ceilings 80,000/32,768,
   and the separately recorded dollar ceiling. Count/read/cancel operations need their
   own bounded schedule; none authorize an additional generation request.
4. Commit a single-winner durable predispatch transition BEFORE calling `create` once.
   Neither retry a lost winning return nor reissue a prepared/dispatched orphan.
5. Pass an `on_accepted(Acceptance)` callback that immediately durably stores the response
   ID against that same step. This callback runs before model/tier/status/output/usage
   validation, including incomplete and malformed responses with a valid ID.

There is a thread-safe per-instance duplicate `(attempt_id, step_id)` guard. It is only a
local defense and is **not** durable or an aggregate budget ledger; another instance must
not be used to evade the DB transition. No token or dollar aggregate cap is claimed here.
The existing one-attempt-per-run checkpoint at the branch base is insufficient for this
two-generation-per-run flow; additive per-step ledger integration is still required.

## Results and unknown outcomes

Normalized states: queued, in_progress, function_call, completed, refused, incomplete,
failed, cancelled, malformed. Only a valid completed single named tool call returns typed
arguments. Only a valid completed final JSON artifact returns the final DTO. Refusals and
incomplete output are never repaired or promoted into artifacts. Unsupported output/tool
items and model/tier drift fail closed while retaining the known ID.

`Usage` exposes input, output, total, cached-input, and reasoning tokens. All are strict
nonnegative integers with consistent totals/subtotals and per-request bounds. Reasoning
is already included in output: **never add it twice**. Missing terminal usage is malformed;
missing usage on queued/in-progress/failed/incomplete/cancelled results is unknown, not zero.
Malformed or over-limit usage must keep the reservation unresolved, not release it.

Create network failures (including connection errors), HTTP failures, and undecodable
successful responses are conservatively unknown; none are classified as safely unsent.
A malformed response with no valid ID also requires unknown-outcome handling. An accepted
ID is saved before payload parsing, and a persistence callback failure raises a sanitized
error carrying that ID. A missing ID/callback failure never permits replacement generation.
Known IDs permit only consumer-authorized, bounded read-only reconciliation; each retrieve
is exactly one GET. Cancellation is separate and explicit. A retrieval failure says only
`observation_unavailable` and cannot clear an earlier dispatched/unknown state.

Errors retain only fixed codes, a sanitized response ID when available, HTTP status, and
an unknown-outcome flag. No credential, raw header, provider body, or network exception
message/context is copied into transport exceptions. Parsed values/history remain source
content, not audit evidence, and must not be indiscriminately logged.

## Verification and remaining gates

Synthetic tests use ONLY HTTPX MockTransport (no HTTP server/socket); every test forbids
socket connects. Synthetic origins are `https://synthetic.invalid` or an explicitly
labeled `http://127.0.0.1:<port>` mock route. They cannot be labeled the official origin.
Count, acceptance, and parsed receipts carry `mode="synthetic"` and the exact local origin.
A constructor-only test checks production settings with a mocked transport and sends
nothing. No mock is provider/account/model quality/latency/parity evidence.

Executed from `backend/` with the isolated review interpreter:

```
/home/ubuntu/.hermes/cache/scratch/intake-review-venv/bin/python -m pytest tests/test_responses_transport.py -q
# 130 passed
/home/ubuntu/.hermes/cache/scratch/intake-review-venv/bin/python -m py_compile workagent/responses_transport.py tests/test_responses_transport.py
# exit 0
```

Remaining integration/API gates:

- Add the durable immutable per-step reservation/predispatch/acceptance/result ledger and
  worker mapping; no database or service changes were made here.
- Supply reviewed strict wire DTOs and explicit mapping back to canonical Body/proposal
  validation, approval checks, and outcome verification. This module does not commit an
  artifact or proposal and does not bypass the source broker.
- Product project, secure consumer-injected credential, and model/account entitlement are
  not verified. No live count/create/retrieve/cancel evidence exists in this slice.
- Official docs support the fields used, but exact account acceptance of the selected
  model/schema/background/encrypted-reasoning combination remains untested. The validator
  enforces closed/required schemas, not the provider's entire JSON Schema subset. Schema
  rejection is terminal for that attempt, not license to weaken it or retry.
- Exact model echo, `service_tier="default"`, and encrypted reasoning are intentionally
  fail-closed. An absent field or unreviewed snapshot alias is not silently normalized.
  The count endpoint's lack of model/hash echo is a documented limitation, not fabricated
  evidence. Actual usage/billing and worker-wide deadlines still require reconciliation.

## Official contract references consulted

- [Create a response](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Count input tokens](https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count)
- [Background responses, retrieval and cancellation](https://developers.openai.com/api/docs/guides/background)
- [Function calling and full reasoning/tool continuation](https://developers.openai.com/api/docs/guides/function-calling)
- [GPT-6.1 Sol capabilities and reservation pricing](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
