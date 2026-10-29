# B2.3 backend work snapshots and durable events

This lane starts at `c75fb58` on `hermes/b2-durable-events`. It implements the
parent-frozen `.local/b23-contract.md` backend surface. No web, TUI, operator
client, installed service, provider route, grant, historical migration, commit or
push is part of this increment. This is not full Batch 2 acceptance.

## HTTP contract

All endpoints use the existing bearer and request/schema headers and `no-store`.
The authenticated principal is the configured principal ID, never a token hash.
All conversation reads require active workspace membership, conversation ownership
and current selected-source access. Event object references get additional current
dependency checks before emission. A conversation is required; there is no
whole-workspace subscription or hidden-record count.

| Endpoint | Result |
| --- | --- |
| `GET /v1/identity` | `{principal_id}` |
| `GET /v1/workspaces/{ws}/work-snapshot?conversation_id=ID` | `workagent/work-v1` current snapshot and scoped watermark |
| `GET /v1/workspaces/{ws}/events?conversation_id=ID&after=TOKEN&limit=100` | Authorized events, next cursor, authorized lookahead, explicit reset |
| `GET /v1/workspaces/{ws}/events/stream?conversation_id=ID&after=TOKEN&limit=100` | Authenticated fetch SSE; `Last-Event-ID` fallback |
| `GET /v1/workspaces/{ws}/attention?conversation_id=ID` | Unseen material facts; optional `after`/`limit` pagination |
| `POST /v1/workspaces/{ws}/attention/seen` | Normal command envelope plus `{conversation_id,cursor}` |

Models are in `backend/workagent/work_event_models.py`; generated OpenAPI and
`contracts/work-events-fixtures.json` are the integration contracts. Events
invalidate canonical reads; consumers must not apply them as domain mutations.
The fixtures include exact cursors, frames, comments, duplicate/out-of-order
delivery and chunk-size vectors. Client parsing/reducer implementation remains
with the parent/client owners.

Snapshot execution describes the current admitted run only. Admission chronology
is retained separately from mutable `observed_at`; existing runs use their initial
message time when available. UUIDs only break timestamp/sequence ties. The
classifier reuses `execution_status.classify` and the full adaptive readback for
partial runs. It does not omit budget/work-blocked semantics to make reads faster.
Unknown provider outcomes dominate cancellation/active claims. A ready run becomes
`idle`, never objective completion. `admission` describes canonical admission;
`worker_live` and `worker_observed_at` describe separately observed worker liveness.

Saved artifacts expose current revision IDs/hashes/titles/kinds without bodies.
Pending review exposes freshness, same-current-base latest status, and structural
removal counts using the existing removal comparator. Current source versions also
participate in proposal freshness. Acceptance remains the canonical command path.
Responsibility states/actions/check-in times come from the existing lifecycle.
Historical outcome prose is explicitly separate. Its timestamp records when that
text was durably changed; a human edit or heartbeat does not renew it. Existing
outcomes without trustworthy observation time retain a null timestamp.

## Storage, producer coverage and locks

`047_work_events.sql` is additive. The normal checksum/prefix migration runner
handles repeated application without reexecuting SQL. Existing workspaces get one
random baseline marker and zero fabricated history events. A deferred workspace
trigger allocates the baseline for new workspaces. GET never initializes state.

| Canonical producer table | Captured transition |
| --- | --- |
| conversations | Material conversation state/version/title changes |
| conversation_messages | Immutable admitted/published messages |
| runs | Material state/progress/result changes, excluding lease/fence/timestamp churn |
| assignments | Assignment and responsibility lifecycle changes, excluding lease/fence/timestamp churn |
| artifacts / revisions | Current saved pointer and immutable revision creation |
| proposals | Creation/review/status changes |
| provider_attempts | Legacy and general provider admission/identity/result state |
| responses_steps / responses_events | Prepared requests and material receipt transitions, including trusted `cancelled_unapplied` |
| run_dispatches | Failure classification and acknowledgement changes, excluding heartbeat/check timestamps |
| audit | Existing domain audit seams with resolvable conversation ownership |

These are deferred constraint triggers on actual canonical tables, not unused
service helpers. Existing outbox, command, receipt guards and accounting are
unchanged. Repeated read/cancel reservations are not work events. Identical
material state is suppressed per source row; composite revision/request keys
respect their real database primary keys. No receipt payload, source content,
body, title or reasoning is copied into the event log.

Canonical domain/workspace locks precede the event-head lock. At deferred trigger
time, ownership resolution uses ordinary MVCC reads; producers acquire only
projection/head locks, not new domain update locks. The transactionally locked
workspace head allocates positions, so commit cannot expose B's later prefix while
A's earlier allocation remains uncommitted. Rollback rolls back both allocation
and log records. Consumers never receive these numeric workspace positions.
Constraint forcing by the trusted runtime is not a general mid-transaction API:
normal canonical producers leave the triggers deferred through transaction end.
The trigger-populated projection tables deliberately have no foreign keys back to
domain rows: implicit FK key-share locks after acquiring the head would violate
that order. Trusted source triggers establish ownership; runtime cannot insert
projection records directly. Seen-state commands retain their normal conversation
FK under the already-held command workspace lock.

The capture function is security-definer with fixed search path and checks exact
public relation, trigger name, operation, timing and level. PUBLIC cannot execute
it. Runtime receives SELECT on head/log/projections and only INSERT/UPDATE on seen
state. Fresh provisioning and existing-role migration grants implement this split.
The trusted service/runtime is still the authentication boundary; this does not
claim database RLS isolation from a compromised runtime credential.

## Cursors, access, attention and streaming

A cursor contains a random event/baseline UUID, access generation and HMAC. The
signature binds workspace, principal, conversation, generation and schema using
a purpose-separated key derived from server `settings.local_bearer`. No numeric
log offset is encoded. Length, shape and signature/scope are checked before any
cursor metadata is returned. Malformed/tampered/foreign-scope tokens are denied.
A valid token with old generation, unknown retained identity or a position below
the fixture-controlled retention floor requests a snapshot reset. There is no
retention/deletion job in this increment.

Authorization filters precede `LIMIT limit+1`; hidden rows consume neither visible
page slots nor `has_more` counts. Event-related revisions/proposals/assignments,
run bindings and product observations are checked. Artifact visibility deliberately
requires access to historical revision dependencies too, so an old revision event
cannot disclose references through a newly accessible current body. This is
conservative: revoked historical dependencies can hide the entire artifact until
access returns. No unauthorized event is silently converted to a visible one.

Snapshot and watermark use one repeatable-read transaction, including current
dependency visibility. Metadata/review reads are batched. Adaptive partial-run
classification retains its existing additional reads. PostgreSQL's 15-second
statement timeout bounds database statements; metadata list size and partial-run
cost are not advertised as constant latency. The PG cost test records query count,
SQL time, total time and response bytes for a defined source-free fixture.

SSE sends `work.changed` with an `id` equal to that event's exact scoped cursor.
It polls every two seconds while idle, emits heartbeat comments on a nominal
15-second cadence and reauthorizes every batch, including empty batches. Generation
or retention reset emits `snapshot.required`; revoked scope emits the same control
with `access_changed` and ends the stream. No database connection/transaction is
held across yields, polling sleeps or disconnect checks. Native asyncio thread
handoff keeps synchronous PostgreSQL work off the event loop. No bearer is placed
in a URL. Polling uses the same page implementation.

Attention derives body-free facts from selected durable source events (revision,
pending-proposal, responsibility and cancelled-unapplied transitions). It does
not duplicate artifact-pointer/audit events into extra facts. Event UUIDs are the
durable dedupe identity; no separate task ledger or external notification exists.
Seen state is keyed by workspace/principal/conversation and advances monotonically
under the existing command transaction. Current authorization precedes exact
command replay. Replaying an old command returns its original receipt without
regressing stored seen state. Seeing is not acceptance or dismissal.

## Validation and parent handoff

Final offline evidence: 15 new cursor/classification/framing/stream tests and eight
existing classification/heartbeat cases pass (23 total; seven DB cases deliberately
excluded from that offline selection). Python compilation, contract export/check
and `git diff --check` pass. The 17 new real-PG cases collect successfully; collection
is not execution evidence. Existing schemas and paths are unchanged in the
generated OpenAPI; only the six new endpoints and their DTOs are added.

Offline commands (from the lane root):

```sh
PYTHONPATH=backend backend/.venv/bin/python -m pytest -q backend/tests/test_work_events_unit.py
PYTHONPATH=backend backend/.venv/bin/python -m pytest -q backend/tests/test_execution_status.py -k 'test_status_categories or test_heartbeat_no_secrets_stale_wrong_workspace_and_dead_pid'
PYTHONPATH=backend backend/.venv/bin/python backend/export_contracts.py
PYTHONPATH=backend backend/.venv/bin/python backend/export_contracts.py --check
backend/.venv/bin/python -m py_compile backend/workagent/work_cursors.py backend/workagent/work_event_models.py backend/workagent/work_events.py backend/workagent/work_snapshot.py backend/workagent/work_event_api.py backend/workagent/work_event_fixtures.py backend/workagent/api.py backend/dev_db.py backend/export_contracts.py backend/tests/test_work_events_unit.py backend/tests/test_work_events_pg.py backend/tests/test_work_events_migration.py
git diff --check
```

Real PostgreSQL suites are authored and collected, **not run in this lane**. The
parent must provision its separate fresh disposable DB and run these with the
existing restricted-role `DATABASE_URL` and owner `MIGRATION_DATABASE_URL` fixtures:

```sh
PYTHONPATH=backend backend/.venv/bin/python -m pytest -q \
  backend/tests/test_work_events_pg.py backend/tests/test_work_events_migration.py \
  backend/tests/test_cancelled_response_receipts.py backend/tests/test_cancelled_response_observation.py \
  backend/tests/test_proposal_review_pg.py backend/tests/test_execution_status.py \
  --junitxml=/tmp/b23-backend-pg.xml
```

The new PG tests exercise restricted-role commit ordering/rollback, migration
preservation/reapply, producer inventory/privileges, snapshot concurrency,
authorization/lookahead/retention, exact seen replay, current chronology,
historical observation separation, acceptance readback, source revocation during
streaming, real HTTP envelopes and synthetic trusted late receipts. They require
real PostgreSQL and do not skip or substitute mocked storage when it is absent.

During offline development, Starlette's AnyIO thread handoff and asyncio's executor
shutdown hung in minimal probes in this sandbox. The SSE adapter now uses native
asyncio handoff; its revocation test passes with an explicit bounded test event
loop. No shared environment/package was changed. HTTP/PG behavior still needs the
parent's actual execution. Local TypeScript generator dependencies are absent;
parent must regenerate/check `contracts/src/schema.d.ts` with its existing tooling.
Client parser/reducer, mounted subscriptions, cache revocation behavior and actual
desktop/phone acceptance remain parent/Claude work (B2.2 integration and later
B2.4/2.5 are outside this lane).
