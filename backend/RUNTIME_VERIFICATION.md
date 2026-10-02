# Fixture runtime verification

## Result and scope

Application-owned **fixture** runtime; no hosted SDK, model/provider calls, provider
credentials or live fallback. Managed-first product-runtime selection remains pending
an approved project/API grant. Do not interpret this as live-runtime verification.
Approved `agent/v0.1.0` and `runtime/bundles.py` remain unchanged.

Implemented:
- Durable queue acceptance writes a `run_dispatches` admission cursor tied to the
  original transactional outbox event and run. Each sweep keyset-pages a high-water
  snapshot. `Service.claim_run` remains the only lease/fence/reclaim owner; delivery
  does not create a new run or own attempts/retries.
- Pure local fixture compute may be recomputed after an expired lease. Completion
  transaction publishes artifacts/proposals once. Post-commit terminal readback
  acknowledges the admission/outbox. Crash after completion is ACK-only recovery.
  This **does not** authorize replay of hosted sessions or unknown remote effects.
- Immutable run configuration pins activation, approved bundle manifest, approval
  registry, fixture adapter bytes, generated tool hash, source dependencies and a
  one-`fixture_completion` budget. Usage counts committed fixture completions, not
  tokens or money. Live usage/cost and live ablation are `not_observed`.
- Assembly occurs after claim mutation in the claim transaction and is revalidated
  before local compute. Selected skill/resource/source hashes and final context
  digest persist; source bodies do not enter broad context/audit records. Initial
  uses `analyze-intake` plus its one reference; revision uses `resume-work` and the
  accepted base. `prepare-contribution` is not loaded. Per-tool/commit checks enforce
  current authority, generation, fence, lease, budget, source versions/content hashes
  and pinned bundle/tool configuration.
- `Broker` offers only the generated four typed tools, scoped to the capability's
  assignment, never human save/accept, task creation, activation, shell or arbitrary
  source lookup. Trusted fixture publication still uses the fenced domain service.
- Owner-only administrative CLI activation/rollback appends immutable audit rows
  independently of run pins. Rollback affects future admissions, not current pins
  or revoked source grants. Migration 003 seeds the reviewed default. Only 0.1.0 is
  approved; enabled/disabled skill configuration comparison is an **adapter test**,
  not a live model ablation or proof involving a second approved bundle version.

## Reproduce (own disposable PostgreSQL 16 database)

From repository root:

```sh
uv venv --python /usr/bin/python3 backend/.venv
uv pip sync --python backend/.venv/bin/python backend/requirements.lock
cd backend
.venv/bin/python dev_db.py --env-file .runtime.env
. ./.runtime.env
PYTHONPATH=..:. .venv/bin/python -m pytest -q tests ../runtime/tests
.venv/bin/python -m workagent.dispatcher --once --workspace verification-empty
.venv/bin/python -m workagent.runtime_config --activate 0.1.0 --disable-skills
.venv/bin/python -m workagent.runtime_config --rollback approved-default-0.1.0
cd ../contracts
npm ci --ignore-scripts
npm run generate
npm run check
```

`dev_db.py` refuses to overwrite an existing env/database. The ignored `.runtime.env`
is chmod 600 and contains this worktree's isolated owner and non-owner runtime DSNs.
For ongoing local work run `python -m workagent.dispatcher` under a supervisor; the
loop's default interval is one second. `--workspace ID` confines local scenarios.
`workagent.fixture.work_once(service, principal, workspace, run_id)` remains supported;
`run_fixture` is an alias. No parent call-site change is required.

Existing databases: apply migration 003 with the migration identity and add the new
explicit grants listed in README/dev_db.py (including identity-sequence USAGE).
Pre-003 runs lack approved configuration/admission pins and deliberately cannot be
silently repinned or auto-dispatched. Historical saved artifacts remain readable;
explicitly pause/resume queued legacy work to admit a new pinned run. The fresh
provisioner is the exercised setup path; legacy migration/backfill is not claimed.

## Actual execution

- PostgreSQL **16.15**, Python **3.12.3**, pinned lock installed with uv **0.11.32**.
- Initial baseline + bundle loader: `27 passed, 1 warning in 21.23s`.
- Combined final functional suite: `42 passed, 1 warning in 49.50s` — baseline 17,
  bundle loader 10, runtime 15. No skipped or fabricated tests.
- Real child-process exit code 73 after claim and after completion-before-ACK;
  separate scheduler subprocess recovers. Concurrent duplicate dispatchers publish
  exactly two initial artifacts, one completion unit; expired handlers fail.
- Running-loop test admits later queued work; restarted revision worker preserves a
  concurrently human-saved checklist/current revision and creates only one proposal.
- Negative tests cover other-assignment artifact/task IDs, missing/forbidden tools,
  revoked/current generation, source body drift, prompt-injection-like source data,
  budget exhaustion, tampered approval registry/product file, immutable tables and
  activation denied to runtime. Rollback leaves revoked access revoked.
- Real CLI activation and rollback returned read-back activation records; empty
  dispatcher sweep returned `{"completed":0,"reconciled":0,"deferred":0,"denied":0}`.
- Migration journal reapplication and non-owner role check both passed.
- `npm run check`: canonical exports match, generated TypeScript matches OpenAPI,
  `tsc --noEmit` passes. npm install reported zero vulnerabilities.
- The warning is Starlette's existing AnyIO BlockingPortal deprecation. The first
  combined test invocation lacked repository-root PYTHONPATH and failed collection;
  the documented invocation corrects this. Independent reviewer delegation was
  disallowed for this bounded task; parent integration/review remains required.

## Requested compatible contract additions

- Authorized `GET /v1/workspaces/{workspace_id}/sources/{source_id}` → `SourceDetail`
  (Source metadata plus content object). Revoked and absent IDs have identical safe
  404 envelopes. Source list still omits content.
- `Block.checked: bool | None = None`, valid only on checklist blocks. Saved true/false
  survives immutable revision storage/reopen. Regenerated tool schema changes only
  because this shared Block is included; the four tool names/authority do not change.
- Fixture equal case IDs deduplicate; conflicting duplicate IDs are excluded and
  marked partial. Protected notes and unknowns remain. It is not a generalized
  candidate-change/current-plan analyst; revision computation remains transparent
  deterministic fixture behavior, not simulated model reasoning.

SHA-256:

```text
OpenAPI:       4170548e5bd4b415342e799108d1014ed677d6cd06b437fffe9d1b103aa4845e
Tool registry: 2adb7311d13fdc420278f48b35b8432a107046cfce9ed77c21c882fe5a559aa2
TypeScript:    e88bba5479e86396465614f5230e155e5e0ae1befcd5260692e416f7e81e7ef5
Bundle:        0509e977d65949c5bf7e531f43086c090671fc23f8d61c7b201603ad43d7d5e3
```

## Operational limits

Authorization is application-mediated and tested under a non-owner SQL role, not
RLS or a sandbox for arbitrary in-process Python. The model must receive only the
Broker interface, never service/DB objects. Broad raw SQL is not a worker tool.
Non-scheduling outbox events remain available for their future consumer; dispatcher
ACKs run admission and corresponding claim/completion events only. Paused, revoked
or pin-drifted admissions remain pending/denied until explicit user/operator action;
the queue does not invent retries. Unexpected process/DB failures require supervisor
restart; durable runs retain recovery authority. No telemetry sink, hosted session,
remote action, billing measurement, live token budget or production readiness is
claimed. No frontend, root scripts/manifests or live-provider integrations changed.
