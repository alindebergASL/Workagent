# Backend / integration status

## Active scope
- Hermes coordinates backend and integration on `hermes/s0-s1-backend`.
- Existing separate Claude Code instance owns frontend; no duplicate frontend writer.
- Repository was empty with no remote frontend note at startup. Public visibility explicitly accepted by Andrew after startup. Only implementation/synthetic examples will be published; original packet stays outside application/repository.
- No default-branch merge or public app deployment authorized.

## Baseline underway
Hermes owns `backend/` (Python/FastAPI, Pydantic canonical domain schemas and services, PostgreSQL/psycopg), `contracts/` (exported OpenAPI 3.1, generated TypeScript client/types and examples), `agent/`, `fixtures/actor/`, `scripts/`, backend tests and `handoffs/backend/`.

Frontend owner: please use `web/` with its own package manifest/lockfile. Root orchestration is Hermes-owned. No root npm workspace is needed initially. If already choosing another layout, record it in your status note; no existing frontend work will be overwritten.

Contract version `workagent/v1` is being implemented, not yet available. First checkpoint includes schemas, migrations, OpenAPI/client generation, stateful mock, authorized local identity, creation/progress/ready/save/stale-proposal/safe-error examples and real PostgreSQL behavioral tests. Exact domain errors retained, including `not_found_or_not_authorized`, `version_conflict` and `command_conflict`.

## Next integration
As soon as creation -> one ready artifact -> human save works, adopt the generated client and connect actual UI/API. Do not wait for runtime/bundle completion. Then extend conflict review and persisted restart. Poll assignment/run state; reconnect never creates another assignment/run automatically.

## Operating boundary
Local app uses synthetic actor-visible source records only, separate from evaluator events/oracles. Fixture computation is explicitly not a live model/runtime claim. Paid product-runtime route stays closed pending a supplied secret reference and bounded grant. No new metered development calls, Google actions, MCP/OAuth rollout, S2–S5 features, or deployment.

## Tool verification
GitHub access verified; Node v22.22.2, npm 12.0.2, pnpm 11.22.0; PostgreSQL 16 main online locally. Codex CLI 0.160.0 reports ChatGPT login; Claude Code 2.1.287 installed. Coordinator runs configured `gpt-6-astra` via `openai-codex`; product model identifiers/support are not inferred from development access.

## Evidence
Original v0.3 archive extracted outside application paths; mandatory guidelines, exact acceptance focus and Step 4 contracts/runtime/files read. No behavior or review PASS claimed at this checkpoint.
