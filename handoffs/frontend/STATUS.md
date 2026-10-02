# Frontend status (Claude Code stream)

Updated: 2026-10-02 (UTC). Owner: Claude Code frontend stream. Hermes owns integration and the combined S1 report.

## Where the work is

- Branch: `claude/workagent-frontend-kyg51x` (the mission-designated branch; `feat/s1-frontend` was not used), based on `hermes/s0-s1-backend` @ `3f1b17b60ac035514862d9ecf39127d324ba10b7`.
- Commit: `092e0098359fbdd5a4f9384d7e86b15503ba9640` (implementation + evidence). PR #2 against `hermes/s0-s1-backend`: https://github.com/alindebergASL/Workagent/pull/2
- Repository state at start: empty remote. Hermes pushed `hermes/s0-s1-backend` (now GitHub's default) and `hermes/s0-s1-build` while the first frontend pass was in progress; the frontend was then rebased onto that bootstrap and moved to `web/` as the backend note (issue #1) asked. Nothing of Hermes's was changed.

## Owned paths

- `web/**` (all frontend code, tests, demo runner; own `package.json` and `pnpm-lock.yaml`, no root workspace)
- `handoffs/frontend/**`
- `.github/workflows/frontend.yml` (frontend-only CI, path-scoped to `web/**` and `fixtures/actor/**`; move or fold into root orchestration as you prefer)

## Shared files touched

None at the root. The mock reads Hermes's canonical actor input `fixtures/actor/solo-v0.1/initial_records.json` (sha256 da744323…) read-only; no frontend copy of fixture data exists. Root `.gitignore` already covers `node_modules`, `test-results` and `playwright-report`; `web/.gitignore` adds `.next`, `.workagent-mock` and tsbuildinfo.

## Contract dependency

- Shared contract: **pending**. No OpenAPI, generated client, semantic mock or service was on the remote.
- The UI consumes a provisional adapter, `web/src/lib/client/api.ts`, over provisional types in `web/src/lib/contract/types.ts` (schema label `frontend-provisional-0.1`). Both mirror Step 4 `CONTRACTS.md` names and semantics and are meant to be replaced by the generated client, not kept.
- Routes and the error envelope the UI relies on are listed in `web/README.md`. The UI needs, per read: object id, current revision/version, observed time, permitted source refs; per conflict: `current_revision_id`, the current revision body and the retained proposal.
- Provisional assumptions to confirm or correct: (1) identity via an `x-workagent-principal` header until the real session boundary exists; (2) `GET …/artifacts/{id}/history` returns revisions and proposals together; (3) `POST …/proposals/{id}/accept|decline` are explicit human decisions carrying `expected_current_revision_id`; (4) an assignment read includes artifact refs, activity and a recommendation summary; (5) one personal workspace per principal, selected client-side from `GET /workspaces`.

## Requested from Hermes

1. When `contracts/` lands: the OpenAPI export, generated client and stateful mock locations, the generation command and the `workagent/v1` hash to pin.
2. Service start command (compose) and an authorized local test identity for the private pilot workspace; no secrets in Git.
3. Confirmation of the route shapes above or the canonical replacements. Changes are welcome; the adapter is isolated to one module.

## Next integration step

Point `NEXT_PUBLIC_WORKAGENT_API_BASE` at the real API, replace `api.ts` with the generated client, and run `web/e2e/journey.spec.ts` against it. The first three journeys to connect are: create assignment → open artifact → human save (CAS). Then stale proposal, then restart/reopen with retained volumes.
