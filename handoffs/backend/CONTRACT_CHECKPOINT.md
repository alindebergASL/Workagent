# Usable contract checkpoint — workagent/v1

Integrated branch: `hermes/s0-s1-build`, baseline commit `ee5ff02` (domain original `a67f6ab9241011cb2bfc7b39b4a236221eb7a53e`), frontend merge checkpoint `a4bf5e07f5c80d878a827a57db5dfb2613e89bc5`.
Frontend branch `claude/workagent-frontend-kyg51x` at `26bac774a253115a4fc5f10b2e57d40ea46c58b1` is preserved and merged into the feature branch, not the default branch.

## Canonical deliverables
- Typed domain: `backend/workagent/models.py`, `service.py`, `errors.py`.
- PostgreSQL migrations: `backend/migrations/001_initial.sql`, `002_authority_guard.sql`.
- OpenAPI 3.1: `contracts/openapi.json`, SHA-256 `ec1001e8bd2bd13d7da8cd0978dc945b7daee247d4116c9458770f7e9745cb4e`.
- Generated client: `contracts/src/client.ts`, `schema.d.ts`; lockfile in `contracts/`.
- Examples: `contracts/examples.json` (illustrative, schema validated; not claimed execution evidence).
- Model registry: `contracts/tool-registry.json`; human-save and acceptance excluded.
- Stateful scenario service: actual FastAPI domain API backed by isolated PostgreSQL, advanced by explicit fixture-worker command. The older frontend JSON mock remains separate historical evidence.

## Reproduce / local identity
```sh
uv venv --python /usr/bin/python3 backend/.venv
uv pip sync --python backend/.venv/bin/python --require-hashes backend/requirements.lock
cd backend
.venv/bin/python dev_db.py --env-file .local.env
. ./.local.env
.venv/bin/python -m workagent.fixture seed --records ../fixtures/actor/solo-v0.1/initial_records.json
.venv/bin/python -m workagent
# In another shell with that environment:
.venv/bin/python -m workagent.fixture work --workspace local-workspace --run <returned-run-id>
```
The provisioning script creates a fresh database, migration/runtime roles and random secret bearer in an ignored mode-0600 env file. `local-human` / `local-workspace` is the authorized synthetic identity. Do not place the bearer in NEXT_PUBLIC variables, committed files or browser bundles. Binding is loopback only; no public deployment.

Generation: `cd contracts && npm ci --ignore-scripts && npm run generate && npm run check`.
Domain checks: with env sourced, `PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q` from root.

## Implemented and independently executed by coordinator
Coordinator repeated all **17 PostgreSQL tests** in a separate fresh database: PASS, no skips; one dependency deprecation warning. Contract drift and TypeScript compilation PASS. These include real API-process restart preserving human-saved state, but not browser integration or live model-runtime acceptance.
Implemented authorization/replay, exact command conflicts, immutable body storage, independent revisions, transactional mutation/audit/outbox, stale proposal preservation and exact-base acceptance, fenced fixture work, source/generation/pin checks, independent matching task readback.

## Adapter alignment / immediate integration ownership
Hermes is taking **integration-only ownership of `web/src/lib/client/api.ts` and a local server-side API proxy**, using generated types/client; existing frontend owner retains layout/interaction code. Do not concurrently replace this adapter. No new frontend implementation session has been launched.

Canonical API is `/v1/workspaces/...`, bearer auth (not `x-workagent-principal`). Read headers: `X-Schema-Version: workagent/v1`, `X-Request-Id`. Mutation body includes `schema_version`, `request_id`, `command_id`.
History and proposals have separate routes. Assignment read lists artifact IDs; adapter composes current artifacts/source detail. Domain errors are an unwrapped `code/message/request_id/next_action/details` object; UI adapter translates presentation. Acceptance checks the exact immutable proposal base, not merely a refreshed current ID. Conflict details need a fresh authorized artifact/proposal read for comparison.

Next proof is creation → ready artifact → human save against real UI/API/PostgreSQL, then stale review and restart. Scheduler/bundle activation and provider broker are being integrated separately without changing this public contract. Live runtime/provider access and spend grant remain unavailable; no fixture fallback will count as live.
