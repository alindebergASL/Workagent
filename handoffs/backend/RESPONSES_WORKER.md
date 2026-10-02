# Bounded Responses product worker — consumer handoff

This addendum supersedes the **unimplemented consumer** statement in the older
`INTAKE_CONTRACT.md` for `openai-responses-v1` only. The legacy
`openai-agents-v1` checkpoint is retained for compatibility; it is not renamed,
not used by this worker, and not an Agents SDK integration.

## Implemented path

An operator-installed, immutable `ProviderGrant` makes normal app admission pin
`openai-responses-v1`. `responses_dispatcher` consumes the existing durable
`run_dispatches`/outbox responsibility; it does not import model artifacts.
`ResponsesWorker` claims the existing fenced run, loads reviewed bundle
instructions, and owns exactly two immutable steps under one run attempt:

1. **selection**: only permitted source IDs/versions/titles and the revision flag
   accompany the instructions. The model must request `read_scoped_context`.
2. **final**: the actual `Broker`, under the current worker capability and pinned
   scope-tool contract, supplies selected source content, goal/instruction and
   the frozen human base body in a function-call result. The final model result
   is a strict `NextAction` DTO, mapped to a domain `Body`.

The initial body contains next action, missing information, a specific judgment,
source/version basis, and a fixed **task not performed** statement. A revision
preserves every base block (including protected notes and ordinary human edits)
and appends inspectable proposed advice. `complete_run` publishes the initial
artifact or immutable revision proposal. Only the existing human-domain
`accept_proposal` can approve the exact base version. The verifier reads stored
publication, proposal and revision records back; neither model text nor a
transport success establishes an outcome/safety pass. No task is created or
external business action performed.

## Durable authority and costs

Migrations **006 and 007** are additive. They preserve migrations 001–005,
reviewed bundles, fixtures and archived registry files. The prior current
registry pin `5b4ec700d49b2b2debe28efc5230543b861763a37207b73c84f7e61de9019f10`
is recovered by an exact digest-checked additive schema projection, avoiding a
new archived snapshot. The separate Responses scope-tool registry is exported
and pinned independently.

- One grant permits one initial run and one revision of that same assignment.
- Exact request bytes, SHA-256, count-projection bytes/hash and correlation
  metadata are immutable per `selection`/`final` step.
- Append-only PostgreSQL events serialize on the workspace lock across
  processes. Unique phase/event keys provide a single committed predispatch
  winner **before HTTP**. The in-memory transport issuer is not authority.
- Cumulative ceilings: **4 generation, 4 count, 40 read, 4 explicit cancel**;
  **80,000 reserved input / 32,768 reserved output tokens**, including reasoning;
  **USD 20**. No automatic grant creation, reset, generation retry or fallback.
- Each generation conservatively retains **20,000 input + 8,192 output** at the
  pinned rates **USD 2.5 / 10 per million**, i.e. **USD 0.13192**. Four reservations
  total **USD 0.52768**; the higher monetary grant does not expand token/call
  limits. Reservations remain held even on successful responses.
- Reported usage, reserved cost, conservatively calculated cost and billed cost
  are distinct. Missing/ambiguous usage yields a null calculated total and an
  explicit unknown-step count; billed cost remains null, never invented.
- A dispatched step with no response ID is permanently ambiguous and cannot
  resend. A known ID permits only bounded read-only recovery. Correlation and
  retrieved-ID mismatches reject the output. Count-response loss never recounts;
  a durably received count can be rehydrated after a safely-unsent restart with
  no extra count request.
- The run's private receipt capability is fsynced to owner-only local files
  (0700 directory, 0600 regular files, no direct symlinks) **before any count or
  generation HTTP**. Keep this state directory on restart. Losing it fails
  closed; there is no operator receipt-import recovery shortcut.
- Retaining an already-arrived receipt is write-only and can survive revocation.
  Every subsequent source read, count, generation, poll and publication requires
  current authority. Authority is rechecked after reservation and immediately
  before network dispatch. Revocation cannot retract an already-dispatched HTTP
  operation, but cannot authorize its continuation.
- A sweep is finite, at most two queued responsibilities. Worker dispatch/poll
  start decisions have a monotonic deadline (90s default, at most 110s) and each
  transport operation retains its fixed HTTP timeouts. An already-in-flight
  operation may finish after the scheduling deadline; no new operation starts
  after it. Poll count is additionally bounded by the grant's durable 40 reads.

`live_provider_receipt` is possible only on the concrete official Responses
transport path with matching grant/project/reference and durable two-phase
receipts. No model field can choose that origin. Synthetic evidence is always
`synthetic_provider_receipt`.

## Commands (from repository `backend/`)

Use the existing review interpreter when `backend/.venv` is absent:

```bash
PY=/home/ubuntu/.hermes/cache/scratch/intake-review-venv/bin/python
source ../.local/intake-checkpoint-v3.env
# Upgrade the existing disposable DB with its owner; never use the runtime role.
"$PY" -c 'import os; from workagent.db import migrate; migrate(os.environ["MIGRATION_DATABASE_URL"])'

# Maintained executable journey: REAL domain/worker/broker/PostgreSQL,
# explicit HTTPX simulation, ZERO provider inference/account requests.
"$PY" -m workagent.responses_journey --state-dir ../.local/responses-synthetic-state

# Full backend + bundle runtime + transport + clean/005-prefix migration/ACL gates.
"$PY" -m pytest tests ../runtime/tests -q --tb=short
"$PY" export_contracts.py --check
"$PY" -m compileall -q workagent tests ../runtime
git diff --check
```

The journey creates a **new synthetic workspace/grant** in a disposable test DB,
uses ordinary admission, runs the actual dispatcher, makes synthetic human edits,
requests a revision, approves through the human-domain exact-version command,
and verifies restart/readback. It is never a live budget-reset command. Fault
journeys (unknown ID, accepted ID, count loss/reuse, revoke, postcommit loss,
concurrency, bounds, false completion) are maintained in
`tests/test_responses_worker.py` and use the same worker.

### Live command: deliberately blocked until product access exists

```bash
"$PY" -m workagent.responses_dispatcher \
  --authority-record ../handoffs/backend/INTAKE_LIVE_GRANT.json \
  --workspace PRODUCT_WORKSPACE --grant-id intake-live-01 \
  --state-dir ../.local/responses-live-state --once
```

The current unchanged authority record has no product project or key reference.
The command exits **2**, before DB/key/count access, with
`product_project_and_secure_key_reference_missing`.

After the parent/operator closes review and access gates, the operator must
explicitly install one `ProviderGrant` using the same command with
`--install-grant /restrictive/local/operator-grant.json` instead of `--once`.
That JSON is the strict `ProviderGrant` schema, with `id=intake-live-01`, exact
workspace/principal, `profile=openai-responses-v1`, `model=gpt-6.1-sol`, expiry,
`max_runs=2`, `max_received_output_tokens=16384`, `consumer_sha256` from
`responses_worker.consumer_hash()`, and a `responses` binding containing:

- real `project_id` and `file:/absolute/owner-only/key-file` reference matching
  the authorized record (the reference, never the secret, goes in the grant);
- `transport_mode=official_api`;
- `instructions_sha256=instruction_hash(active_configuration)`;
- `schema_sha256=sha256(FINAL_SCHEMA.material)`;
- `scope_tool_sha256=digest(scope_registry())`;
- the fixed limits from `ResponsesBinding` (no expansion).

`--once` never installs or renews a grant. Normal app admission after installation
creates the configured run. The official constructor requires explicit project
and secure-reference binding and transmits `OpenAI-Project` on count/create/read/
cancel requests. The local key loader accepts only the explicitly pinned,
owner-owned 0600 regular file and rejects symlink paths. No credential discovery,
provider health call or fallback precedes dispatch.

## Provider documentation pins and remaining gates

The provider contract remains the reviewed source set in
[`RESPONSES_TRANSPORT.md`](RESPONSES_TRANSPORT.md): official Responses create,
retrieve, cancel, token-count, structured-output, function-calling, reasoning and
background documentation, with the existing fixed Sol parameters. The integration
adds documented project headers and metadata correlation; it does not invent
provider idempotency or exactly-once guarantees.

**Implementation is exercised with explicit synthetic transport, not live
provider execution.** Remaining gates are an independent review of the exact
integrated SHA, real product project/key access, account/model/schema
compatibility and bounded live execution by the parent, and frontend/browser
integration by its owner. No deployment, default-branch merge or push is implied.
