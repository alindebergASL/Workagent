# Cloud/B3 reconciliation — bounded integration handoff

Task `t_481afd69`; parent `307c184d1fcffa244165bf727631fa5ccbf6f878`; merge parent **`dff9dc068b4227018612f7a99866e7f565130fa0`**. The containing merge commit and exact published/CI head are recorded by Git and the task/GitHub checkpoint, not an impossible self-reference here.

## What changed

- Exact-diff reviewed, clean merge of pinned Cloud work, preserving accepted B3 gateway/shared-files/exports/computation. Cloud had already merged Batch2 at57f244b.36 Cloud-changed web paths:34 match the pin exactly; proxy route and conversation page are the clean three-way merges with B3. No wholesale tree replacement, reset, duplicate frontend implementation or superseded prep module restoration.
- `scripts/workagent.py` readiness now discovers `/api/domain/v1/session` and supplies its validated opaque scope to `/api/domain/v1/workspaces`. Public HTML, malformed session, empty workspace set, denial or upstream failure never proves readiness. Scope is rediscovered each attempt. No bearer is exported or fence weakened.
- Same root cause fixed in adaptive/flexible/native readiness and direct root-verifier requests. Loopback port arguments on the general verifier isolate tests from installed3000/8000. Controlled general/flexible verifiers explicitly enable the existing fixture mode; ordinary runtime defaults remain unchanged.
- Exactly reported note selectors in `verify_general_integration.py`, `verify_adaptive_product.mjs`, `verify_adaptive_milestone.mjs`, `finish_adaptive_milestone.mjs` now use `notes_controls.mjs`: wait for NotesList, write/read exact per-note arrays, no trim/split. Other old general-model/companion note selectors were observed but are outside this reported selector repair; those broader scripts are **not claimed fully runnable** by their scope-header repair alone.
- Existing B3 `playwright.b30b.config.ts` and `test/workspace-files-races.test.ts` failed Prettier. A bounded local **Claude Opus5.5** owner formatted only these two isolated copies. Parent inspected the diff and proved equivalent parsed TypeScript AST (ignoring redundant parentheses); no product-source logic changed. See `format-equivalence.json`. Tool-reported list cost0.3276132USD, separate from product accounting, not a verified bill. Astra performed integration and one independent material review. No Fable or product-model invocation.

## Actual verification

One heavy job at a time on private EC2, isolated candidate under `/home/ubuntu/workagent/proofs/cloud-reconcile-t481afd69/candidate`. Fresh restricted fixture databases only; no installed migrations/maintenance. Local disk97%; remote5% after tests. Source SHA256 readback matched the52 reviewed paths, and final source manifest additionally binds the two format-only files.

| Command / scope | Result |
|---|---|
| `backend/.venv/bin/python -m pytest backend/tests/test_launcher.py backend/tests/test_launcher_readiness.py -q` |21PASS, exit0 (local and isolated remote) |
| `pnpm exec next build --webpack` | optimized real-domain production build, exit0 |
| `pnpm typecheck`; `pnpm lint` | both exit0 |
| `pnpm exec vitest run test/stream-proxy-start.test.ts test/export-download-proxy.test.ts test/cell-authors.test.ts test/work-state.test.ts test/files-contract.test.ts test/workspace-files-races.test.ts` |58PASS, exit0 |
| `backend/.venv/bin/python scripts/verify_general_integration.py --env ../fixture-3.env --output ../evidence/general-3 --web-port 13210 --api-port 18210` | exit0: real browser/API/PG controlled consumer, product journeys at desktop/390/320, exact i64 retry, unavailable consumer, all-process restart and saved note/output readback |
| `node scripts/verify_notes_controls.mjs ../evidence/general-3/products/result.json ../evidence/notes-controls.json` (owned stack runner) | exit0: delayed list arrival, multiline/trailing-space/array boundaries, empty draft retained and save refused, valid array saved/reloaded/API readback,390px no document overflow/page errors |
| `node web/scripts/products-review-regressions.mjs` |49 focused DOM regressions PASS, exit0; explicit fixture transport, not real server/provider |
| `pnpm format:check`; `pnpm exec vitest run test/workspace-files-races.test.ts` after owner format fix | exit0;9PASS exit0 |
| `git diff --check` | exit0 |

Independent **PASS**: `independent-review.md` binds52 material paths via `review-source.json`, with reviewer reruns19 readiness,32 focused web and6 proxy-scope tests. Do not sum overlapping reruns as distinct tests. The two later formatting-only test/config paths are separately proven equivalent and retested; they are not silently presented as part of the earlier exact-byte review. No reviewed material source changed afterward. Remote and final manifest checks bind test receipts to source; the initial archive manifest is historical and predates final verifier corrections.

Cloud's529/unit and other earlier suites remain **reported/reused, not our full-suite reruns**. Prior B3 computation evidence is unchanged; no new computation confinement proof or live-model usefulness claim. The four adaptive scripts were syntax-checked and their shared notes helper was exercised, not rerun as paid journeys.

## Retained failures and qualification

- Initial remote build failed because shared dependencies triggered pnpm's incompatible-symlink refusal. Replaced only the candidate's owned symlink with an isolated frozen-lockfile install; installed dependencies untouched.
- First actual general run reached A14-authenticated readiness, then refused controlled messages because current API requires explicit fixture mode. Fixed only controlled verifiers.
- Second run reached tool publication but stopped because reused remote environment lacked pinned Wasmtime49.0.0. Created an isolated venv from `requirements.lock` + hashed `requirements-local-tools.txt`; no host fallback or installed-environment mutation. Third fresh fixture run passed.
- Initial extra notes probe tried to save an empty note; existing validation correctly refused it. Corrected the probe to assert refusal and exact retained draft, then save a valid exact array. It passes without weakening validation.
- Initial format check failed on the two preexisting B3 test/config files; final format and focused race tests pass after the owner-only correction.

All failed logs are retained alongside successful receipts. No fabricated output or broad-green inference.

## Contract answers and Cloud handoff

See `CONTRACTS.md` for file/line citations and proposed schema. **No backend contract implementation in this card.**

1. There is no `current_outcome_at`. Existing `historical_observation` pairs current lifecycle prose with its last text-change recording time from migration047, legacy NULL preserved. It is not snapshot freshness, execution/verification time, author proof, or immutable revision basis. Later migrations through057 do not change this. Separate outcome evidence/dependency versions exist, but cannot be relabelled as this prose's frozen basis.
2. Cloud's newer88bf984 pairing uses available semantics, but “Agent's latest recorded note” overstates provenance: owner and runtime can also write it. Prefer “Latest recorded note”; failed snapshot versus knownNULL should remain distinguishable. These newer Cloud commits88bf984/4f75f5d were inspected for the answer, **not merged**. No unilateral Cloud UI edit.
3. Conversation preview is stored latest-message text truncated to240. Trusted `Execution status:` comes from publication policy; historical messages remain immutable. Retained `TurnState.explanation` already exists with authority/attempt/final-phase/publication bindings. Proposed additive `Conversation.preview` projects exact latest message/run, text source and typed outcome/reason; preserve stored fallback and visible limitations, never regex-strip or borrow an earlier result. This projection and atomically captured note provenance remain proposed/deferred, not exposed fields today.

Primary Cloud owner should consume the existing observation correctly and coordinate any future additive projection with Hermes. This card does not initiate broad UI redesign or a backend migration.

## Runtime and continuation

Owned13210/18210 stack stopped in `finally` after every attempt; final socket/process/session readback is `runtime-final.json`. Remote installed API/web PIDs906/907 remained unchanged after boot; services and idle timer active. Bounded EC2 lease released after verification. Original local runtimes untouched. Synthetic fixture DBs and failures retained; no destructive cleanup, installed-data maintenance, default merge, public deployment or paid product call.

**Graph correction:** B3.1a completion did not directly release memory: this integration task was inserted as another parent of existing `t_b7f7aa98`. Completing this handoff releases that existing B3.1b typed-memory successor. Preserve both parent handoffs, primary Claude ownership, and later Cloud commits before any next shared-file feature integration. Batch3 and the broader mission remain unfinished. No new task graph or budget increase.
