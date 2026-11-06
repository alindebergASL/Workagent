# B2.4 backend isolated-lane handoff

Implementation is present and uncommitted. Runtime integration and restricted
PostgreSQL acceptance are **pending parent execution/review**, not claimed passed.
No other checkout, web/TUI source, installed grant, old migration, provider, product
service, commit or push was changed/called. Shared `backend/.venv` was read only.

## Delivered

- `048_run_checkpoints.sql`: append-only exact stage/publication/settlement/stop
  boundaries, normalized unique predecessor→successor links, immutable queue
  intents with guarded transitions, and bounded trusted retained-read receipts.
  Apply **after sibling047**; this lane intentionally does not supply047.
- `checkpoint_models.py`, `run_checkpoints.py`: strict reference/hash DTOs and
  actual transaction hooks in Products and responsibility settlement. Frozen
  canonical request/result hashes, fence/generation/versions, original intent,
  pending proposal references, explicit waiting and next-safe-action state.
- `run_successors.py`: dispatcher admission on the same canonical responsibility
  wake, plan, dependencies, grant and cumulative ledger; explicit standalone
  continue. Unique predecessor, exact checkpoint/hash, current access/revisions,
  current human intent, runtime compatibility, settled liabilities and budget
  rechecks. Failed current responsibility admission parks the canonical lifecycle.
  Repeated slices without new retained material park; no budget reset.
- `conversation_intents.py`: exact-run stop leaves conversation open; queued
  PostMessage bytes/attachments/target and original command are retained without
  admitting a run. Atomic FIFO drain/cancel, bounded fair scans, holds on drift,
  revocation or unknown outcome. Queue admissions preserve their original human
  generation; newer queue messages additionally fence older continuation intent.
- `retained_results.py`: additive `SustainedDecision` and `read_result`, strict
  source references only, same-conversation/principal/current target/dependency
  checks, credential/reasoning field redaction, canonical UTF-8 paging (8 KiB,
  32 KiB aggregate, eight receipts). Receipt replay is exact; absent bodies are
  unavailable, never refetched. GeneralWorker consumes pages through the normal
  selection/stage/observation loop. Historical validators remain byte-identical.

The new sustained behavior requires **newly authorized selection schema bytes**:
`responses.continuity_version == sustained-v1` and `scope_tool_sha256` equal to
`sha256(retained_results.SCHEMA.material)`. `schema_sha256` remains the existing
final-explanation schema hash. No existing grant is repinned or activated.

Backend OpenAPI and additive checkpoint/queue/sustained JSON schemas are exported
in `contracts/`. The web owner/parent should regenerate its client at integration;
no web or TUI source was edited. `dev_db.py` only adds runtime privileges for the
new tables when a parent provisions a **new disposable** database; migration048
mirrors those new-table privileges for existing runtime roles. Provider authority
and existing table privileges are unchanged.

## Interfaces

All paths are below `/v1/workspaces/{workspace_id}/conversations/{conversation_id}`.
Commands use ordinary `schema_version`, `request_id`, `command_id` replay semantics.

| Path | Method | Input/result |
| --- | --- | --- |
| `/stop` | POST | `expected_work_version`, exact `run_id`; canonical Run |
| `/continue` | POST | `expected_work_version`, `checkpoint_id`, `checkpoint_hash`; canonical Run |
| `/checkpoints` | GET | Authorized latest 100 immutable checkpoints |
| `/queued-messages` | POST | Exact existing PostMessage; server QueuedMessage |
| `/queued-messages` | GET | Authorized queue page; optional `after` position |
| `/queued-messages/{queued_message_id}/cancel` | POST | `expected_queue_version`; exact retained queue result |

New audit/outbox operations for sibling event integration:
`stop_conversation_run`, `queue_message`, `cancel_queued_message`,
`queued_message_admitted`, `queued_message_held`, `run_successor_admitted`,
`responsibility_successor_blocked`. All are written in the mutation transaction.
The existing `post_message`/`responsibility_run_queued` dispatch path admits runs.

## Verification actually performed

From `backend/`, with DATABASE_URL and MIGRATION_DATABASE_URL explicitly unset:

- 182 tests passed: `test_b24_checkpoints.py`, `test_responses_transport.py`,
  `test_responses_retrieval_include.py`, `test_request_packing.py`.
- Earlier overlapping transport/retrieval + selected dispatcher resilience group:
  153 passed. These counts overlap and must **not** be added.
- New offline tests cover frozen historical schema bytes, exact new-schema opt-in,
  a real prepared request, forbidden authority/body fields, UTF-8 boundaries,
  trusted-read replay/caps, credential field redaction, API shapes and material
  progress comparison.
- Final focused rerun: 26 passed (new offline tests plus four selected dispatcher resilience cases).
- `compileall`, `git diff --check`, and `export_contracts.py --check` passed.
- 23 PostgreSQL cases were **collected only**, not executed. Initial local invocations
  used an incorrect test working directory / nonexistent test filename; corrected
  runs above passed. No database fixtures executed in this lane.

## Parent next executable step

Integrate sibling047 then048, provision a new disposable DB with the updated
provisioner, and run with the restricted runtime role:

```sh
cd backend
.venv/bin/python -m pytest -q tests/test_b24_runtime_pg.py \
  tests/test_sustained_continuity.py tests/test_responsibility_execution.py \
  tests/test_responsibility_person_wait.py tests/test_dispatcher_resilience.py \
  tests/test_responses_leases.py tests/test_responses_recovery.py \
  tests/test_cancelled_response_observation.py tests/test_cancelled_response_receipts.py \
  tests/test_settled_turn_recovery.py tests/test_evidence_continuity_guards.py
.venv/bin/python export_contracts.py --check
```

The new PG campaign covers exact stop/replay, stale-run preservation, FIFO without
queue-time dispatch, newer steer/revision holds, cancel/admit races, stage/publish/
settle restarts, successor lost ACK/concurrency, original intent and unchanged
shared accounting, hash/generation/principal/revision rejection, unchanged-wake
responsibility continuation, actual worker retained-page consumption, stale lease/
revocation/cross-conversation denial, unknown-send zero extra dispatch, more than
eight total steps across bounded executions, and repeated-material parking.
Known-ID GET-only/cancelled late-receipt behavior reuses the existing fault suites;
its authority and retention machinery was not replaced.

## Honest limitations / review focus

- Migration048 has not been parsed/applied by PostgreSQL here. SQL trigger ordering,
  exact historical-guard substitutions, rollback/immutability and concurrent
  restricted-role behavior need the parent's real migration and test run.
- New PG tests are acceptance probes, **not passing evidence**. Independent review
  and the real runtime/desktop/phone journey remain parent work.
- SQL successor admission conservatively requires every conversation attempt to
  be reconciled/failed. Canonical Python also recognizes certain fully observed
  cancelled histories as settled; those exceptional histories can be refused by
  SQL until explicitly reconciled. No unknown liability is bypassed.
- Read discovery is bounded (12 references from 24 recent checkpoints); exact
  retained references already known to the caller can still be read under current
  authorization. It is not a transcript search or remote refetch feature.
- Automatic queue draining is attached to the managed Responses dispatcher and
  requires its installed grant; controlled-only fixture conversations do not gain
  an autonomous queue consumer. A queued local-operation request that cannot use
  that admission path is held, never silently converted into model work.
- There is no direct source/attachment range-read API in this slice: read_result
  pages safe **already retained tool evidence** and checkpoints, as frozen. A body
  omitted by the original tool receipt remains unavailable.
- STOP does not erase or settle a provider request. Existing known-ID observation
  authority remains authoritative, including its narrower cancelled-run scope;
  unknown sends remain held. No new cancellation HTTP request is introduced.
- Budget/grant denial parks automatic responsibility successors; recovering that
  plan uses existing explicit responsibility controls. No authority is renewed.
- Generated API schemas are included; frontend client regeneration and sibling
  event-specific projections/attention mapping are left to parent integration.

No successor agent is running. Parent owns independent review and integration.
