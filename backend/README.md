# Workagent domain baseline (fixture mode only)

This is the first usable private-work **domain/API contract**, not a live agent,
Google integration, OAuth server, or S0/S1 product acceptance claim. All persisted
state and bodies live in PostgreSQL; there is no in-memory pretend database.

## Run from a fresh checkout

Python 3.12 and PostgreSQL 16 were exercised. Node 22 is used for contract generation.
From the repository root:

```sh
uv venv --python /usr/bin/python3 backend/.venv
uv pip sync --python backend/.venv/bin/python backend/requirements.lock
cd backend
.venv/bin/python dev_db.py --env-file .local.env
. ./.local.env
.venv/bin/python -m workagent.fixture seed \
  --records ../fixtures/actor/solo-v0.1/initial_records.json
.venv/bin/python -m workagent
```

`dev_db.py` requires `sudo -n -u postgres psql`. It **only creates a randomly named
new `workagent_test_*` database and two new roles**. It neither adopts nor resets
existing databases; it refuses an existing env file. It generates private random
credentials, writes a mode-0600 ignored env file, and never prints credentials.
Keep that file out of source control, browser bundles, chat and logs. The server
binds **127.0.0.1:8000** with proxy-header trust disabled. Do not override the bind,
put this fixture identity behind a public proxy, or treat its bearer as production
auth. The bearer is a human app credential; never give it to a model/worker.

Required environment: `DATABASE_URL` (non-owner runtime role),
`LOCAL_TEST_MODE=true`, `LOCAL_BEARER_TOKEN` (32+ characters), optional
`LOCAL_PRINCIPAL_ID` (default `local-human`). `MIGRATION_DATABASE_URL` is only for
provisioning/tests; the API never reads it. For a local frontend, set an exact
`FRONTEND_ORIGIN=http://127.0.0.1:5173` (or localhost and the actual port).
No wildcard origin or cookie auth is enabled. No default demo bearer exists.

### PostgreSQL roles and migration protocol

`workagent.db.migrate(owner_dsn)` applies ordered, checksummed migrations in one
transaction under an advisory lock. The journal must be an exact known prefix;
unknown/mutated migrations fail. Never run migrations with the API role.
For a separately provisioned database, use a dedicated migration owner and a
LOGIN runtime role that is neither table/database owner, superuser nor BYPASSRLS.
Revoke public schema CREATE, grant runtime schema USAGE, table SELECT, INSERT on
`assignments, assignment_sources, artifacts, revisions, proposals, tasks,
task_inspections, commands, audit, outbox, runs, run_configurations, run_contexts,
run_dispatches`, and UPDATE only on
`assignments, artifacts, proposals, outbox, runs, run_dispatches, runtime_configuration` plus the authority tables for
row-lock permission. Grant USAGE on `run_dispatches_cursor_seq`. Runtime has SELECT
only on `bundle_activations`; activation requires the migration/table-owner identity.
**Migrations 002 and 003 must be installed:** PostgreSQL requires
UPDATE privilege even for `SELECT FOR SHARE`; its owner-only triggers prevent
runtime updates to workspace/membership/source/access records. No runtime DELETE,
TRUNCATE, DDL or function ownership. `dev_db.py` is executable provisioning evidence
for these grants. Startup rejects owners, superusers and BYPASSRLS roles.

Authorization is in the canonical service, not RLS. The runtime process and its DB
credential are trusted; do not give that credential to model-generated code.
This is not a tenant-isolating SQL gateway for untrusted SQL clients.

Provisioning/revocation is currently administrative, not a product route. In one
owner transaction, first lock/update the workspace and increment
`access_generation`, then update the relevant membership/source/access records.
This lock order matches the domain service. A source version/content observation
is an external input update; it is never incremented by artifact/work progress.

## HTTP/frontend contract

- Schema: `contracts/openapi.json`, generated from FastAPI/Pydantic v2, OpenAPI 3.1.
- Auth: `Authorization: Bearer <private local credential>` on every domain route.
- Queries require `X-Schema-Version: workagent/v1` and bounded `X-Request-Id`.
- Mutation bodies require `schema_version`, `request_id`, `command_id`; unknown
  fields are rejected, strings/arrays/versions are bounded. JSON body ceiling 256KB.
- API root `/v1/workspaces`; all child IDs are workspace scoped. Workspace/source/
  assignment lists, assignment get/create/control, run get, artifact current/history/
  proposals/save/request-revision, proposal accept/dismiss, task create/get are
  in OpenAPI with stable operation IDs and typed errors.
- All lists use `limit` 1–100 (default 25), opaque ID `cursor`, `next_cursor` or null.
  Ordering is stable lexical ID, not creation order. History carries independent
  `revision_number`; sort loaded history by that number for a timeline. Pagination
  is not a snapshot under concurrent insertion; refresh from the first page.
- Poll `get_run`/`get_assignment` while queued/running (e.g. one-second interval;
  back off or stop on errors). `202` means durable queue acceptance, **not readiness**.
  Read `assignment.artifact_ids`, then `get_artifact.current_revision_id` and
  `current_revision`. An optional historical `revision_id` populates
  `requested_revision` while `current_revision` stays current. All history rechecks
  current scope. `Cache-Control: no-store` prevents private response caching.
- Save sends the exact `expected_current_revision_id`. A human save only advances
  that artifact's revision, not work/source versions. `request_revision` additionally
  checks `expected_work_version`; its durable run will create a separate proposal.
- Accept sends proposal ID + exact current revision. The current pointer must also
  match the proposal's immutable base. Supplying a newer ID cannot silently rebase
  an old proposal. Both bodies survive conflict. Keep-current/dismiss records status
  without deleting proposal bytes. To resolve, request a **new** proposal against
  the refreshed current base and recheck on acceptance.
- Task creation is `201` with `verification: unresolved`. A separate `get_task`
  records an inspection. Only `expected_version` AND `expected_desired_result`
  matching the persisted task yields `verified_created`. Missing/mismatched evidence
  stays unresolved; a missing/inaccessible task remains 404. Inspection is a separate
  readback of the internal task store, not proof of an external provider task.
- Reopening a URL re-reads durable state; no browser memory is the authority.

Errors have `code`, safe `message`, `request_id`, `next_action`, `details`. 401 is
invalid/missing auth; protected absent/inaccessible both use indistinguishable
404 `not_found_or_not_authorized`; 409 covers version/command conflicts and the
remaining domain preconditions (source availability/change, decision, budget,
connection, unresolved action); 422 covers malformed schemas and unsupported
operations. Adapter/storage failures use a sanitized 500 `internal_error` envelope.
Decision/connection codes are vocabulary for later adapters, not
claims that external effects exist. Never use generic write-retry middleware to
reinterpret `action_unresolved` as permission to submit another effect.

### Idempotency and transactions

Command keys are **principal + workspace + command_id**. Canonical JSON uses
sorted object keys, compact separators, UTF-8, ordered arrays and validated model
serialization. Payload includes schema version, operation and path arguments;
`request_id` and the separately scoped `command_id` are excluded from its hash.
No Unicode normalization or array sorting silently changes intent. Identical payload
returns the exact recorded result **after current authorization checks**; a different
payload is `command_conflict`. Failed commands roll back and are not cached.

Workspace row locks intentionally serialize all writes, replay, run claims and
commits; shared locks protect reads. This coarse baseline trades throughput for
simple auditable concurrency. Immutable revisions/body hashes/current pointer,
command result, audit and outbox commit in one PostgreSQL transaction. There is
**no S3/distributed-store protocol**: body JSONB itself is the authoritative immutable
content, so rollback preserves old bytes and needs no orphan object cleanup.
Database triggers reject revision/command/audit/inspection changes and reject
proposal-body changes (status/accepted pointer only may advance). Composite foreign
keys and unique revision sequences enforce workspace/artifact relationships.

### Tables actually used

`workspaces`, `memberships`, `sources`, `source_access`, `assignments`,
`assignment_sources`, `artifacts`, `revisions`, `proposals`, `tasks`,
`task_inspections`, `commands`, `audit`, `outbox`, `runs`, `bundle_activations`,
`runtime_configuration`, `run_configurations`, `run_contexts`, `run_dispatches`,
plus `schema_migrations`.
Artifact revisions use their own sequence under lock; assignment work versions
are independent; source versions are read-only to runtime. Outbox has a pending
index and consumed timestamps. Runs persist profile/bundle/tool hashes, principal,
source scope through the immutable assignment selection, generation, fence, lease,
cursor, budget allocation/usage, control/stop state and nullable provider refs.
No unused grants/actions/provider-observation tables are fabricated. Those and
production identity, streaming/event delivery, real effects and generalized
assignment criteria editing remain future work.

## Deterministic fixture worker and parent integration seam

After creating an assignment, use the returned workspace/run IDs:

```sh
.venv/bin/python -m workagent.fixture work \
  --workspace local-workspace --run <returned-run-id>
```

This explicit one-run seam remains supported (`work_once` and the compatible
`run_fixture` alias). The application-owned fixture scheduler also runs continuously:

```sh
.venv/bin/python -m workagent.dispatcher --once  # one bounded queue sweep
.venv/bin/python -m workagent.dispatcher         # repeat every second
```

Use `--workspace ID` for a scoped local test. Both paths claim existing durable runs,
assemble the approved product bundle, and read only selected current source rows.
There is no provider loop. Missing owner **OR** missing
next action is computed from arbitrary valid boolean rows; no expected count is
hardcoded. Identical case IDs are counted once; conflicting duplicate IDs are
excluded and mark the output partial. It generates a useful private plan/checklist, preserves every supplied
`protected_note` literally, records selected source dependencies/observed times,
and retains unknowns. No usable/malformed rows yield partial work, not invented
confidence. Revision fixture work appends the requested instruction for review;
it is not an LLM simulation. There are no provider imports, API-key reads or
mock-as-live fallback, and no evaluator/future-event loading.

Trusted-process API (import from `workagent.service` with `backend` on PYTHONPATH):

```python
service = Service(Database(database_url))
cap = service.claim_run(Principal(principal_id), workspace_id, run_id)
run, assignment, selected_sources, base_revision = service.worker_inputs(cap)
# Compute bounded Body instances using only these selected current inputs.
service.complete_run(cap, bodies, unresolved, command=stable_command)
```

`WorkerCapability` fixes workspace, run, principal, dispatch fence and a secret
lease token (only its hash is stored). Commit rechecks membership, sources/version,
access generation, lease/fence, control state and budget. An expired handler cannot
publish. Completion never accepts over an existing human revision; revision runs
store proposals even when current moved. Supply a stable `Command` for completion
replay; a completion without a command can be inspected but cannot be repeated.
The fixture adapter supplies a deterministic per-run completion command. A worker
capability cannot human-save or accept; those canonical commands require a human
principal and are never in the model tool registry.

`workagent.tool_registry.registry()` and `contracts/tool-registry.json` expose the
reviewed typed names `get_assignment`, `get_artifact`, `get_task`,
`propose_artifact_revision`. The last has an implemented
`Service.propose_artifact_revision(cap, ProposeArtifactRevisionInput)` seam that
requires the run's exact artifact/base/dependencies and stable command ID. The
implemented `workagent.broker.Broker(service, cap)` binds query tools to the exact
assignment and validates the lease on **every** invocation; do not pass a free-form
Principal into model tools. Tool schema annotations are not grants. No generic
execute/approval route exists. `Run.bundle_hash` now identifies the approved product
manifest, not the fixture Python file. The immutable run configuration separately
pins fixture adapter bytes, approval registry, tool registry, sources and budget.
Dispatch and commit reject pin drift. `runtime/bundles.py` provides application-owned
context assembly, not native hosted filesystem loading.

### Trusted local activation and rollback

Only the migration identity can change the active configuration, never the worker
or a model tool/API. Migration 003 seeds approved version 0.1.0.

```sh
.venv/bin/python -m workagent.runtime_config --activate 0.1.0
# Adapter-only enabled/disabled comparison (not live ablation):
.venv/bin/python -m workagent.runtime_config --activate 0.1.0 --disable-skills
.venv/bin/python -m workagent.runtime_config --rollback approved-default-0.1.0
```

CLI output is a read-back immutable activation record. Rollback targets a prior
activation ID and only affects future runs; it cannot restore source grants.
Approval registry bytes are pinned in application code. Adding an approved version
requires a reviewed deployment, not editing a customer source or calling a tool.
See `RUNTIME_VERIFICATION.md` for ownership, recovery evidence and limitations.

### Compatible source/editor additions

`GET /v1/workspaces/{workspace_id}/sources/{source_id}` returns typed `SourceDetail`
(metadata plus `content` object), rechecking current source access. Missing and
unauthorized return the same 404 envelope. Source listing still excludes bodies.
`Block.checked` is nullable/optional and is accepted only for `kind: checklist`;
true/false state persists in immutable revisions and survives reopening.

## Contract generation, scenario mock, tests

```sh
cd contracts
npm ci --ignore-scripts
npm run generate
npm run check
cd ../backend
. ./.local.env
.venv/bin/python -m pytest -q
```

`npm run check` compares Python-generated OpenAPI/examples/tool schemas, regenerates
TypeScript in memory for drift detection, and typechecks the typed `openapi-fetch`
client. Separate package-lock and exact generator versions are committed.
`contracts/examples.json` contains **illustrative schema examples**, not fabricated
execution results: queued/progress/ready, human save, stale proposal, denied lookup,
command conflict, partial and reopened saved work. The PostgreSQL-backed API above
is the stateful frontend scenario/mock service; isolate its database from other
work. Run the fixture scheduler while polling to advance queued work.

Tests require real `DATABASE_URL` AND a migration owner URL to seed independent
random workspaces. Missing PostgreSQL configuration fails; it is never skipped as
PASS. Tests do not truncate/reset databases. They exercise concurrency/replay,
readback, stale proposals, source revocation, fence/lease/generation, partial work,
atomic rollback, runtime role/immutability guards and HTTP schemas. A real loopback
Uvicorn subprocess and separate fixture-worker subprocess are exercised; the API
process is terminated/restarted and saved human text is read back unchanged. This
is local application restart evidence, not live provider or long-duration wait
acceptance. See `VERIFICATION.md` for the observed commands/results.
