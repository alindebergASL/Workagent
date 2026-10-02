# S0/S1 acceptance — local-mode candidate

Application/code candidate: `d937957521e1acdcffcac5d3ba3e70609f6cff98`.
Canonical focus: supplied `build/S0_S1_FOCUS.json`; original documents and historical
fixtures remain unchanged outside application serving paths. Actor import is the
canonical scenario v0.1 source, not a later evaluation copy.

## Overall result
**Usable local portion demonstrated; full S0/S1 qualification is NOT complete.**
The application, API and PostgreSQL are real. Analysis/revision computation is an
explicit deterministic fixture adapter. No fixture output is counted as a live model,
selected hosted runtime, live skill ablation, customer acceptance or external effect.
Independent recheck **PASS** at the code candidate above: all six findings closed;
46 Python tests, 10 frontend tests, 9 candidate browser fault cases and 5 additional
reviewer-authored browser cases were exercised independently. Reports are in `review/`.
This does not grant merge, deployment or full milestone acceptance. Owner usefulness
judgment is still pending.

## Exact acceptance cases

### A01 — Useful private work
- **Fixture / integrated application: PASS.** Canonical SG-F2/F3/F7 selection creates
  a private plan and reusable checklist; derived unique-case union is **4/8 = 50%**.
  Arbitrary-input and missing-data tests prevent a hardcoded result/false percentage.
  The plan preserves the protected note, cites observed source IDs/versions, labels
  no time-saved data and no causal evidence, and proposes one bounded next action.
- Sources are inspectable. After source drift, the UI labels current content separately
  from observed versions; historical bytes are explicitly unavailable, not substituted.
- **Owner usefulness: pending. Live general-purpose analysis: not observed.**
- Evidence: `evidence/02-assignment-ready.png`, `evidence/09-supporting-sources.png`,
  `evidence/samples/`, `backend/tests/test_calculation.py`.

### A02 — Independent work and artifact revisions
- **Integrated application / PostgreSQL: PASS.** Independent revision identities,
  optimistic saves, command replay, authorization before replay, immutable bodies and
  source/work/artifact boundaries exercised. Actual API/web process restart retains the
  same assignment, human revision, checked state and body hash; no second assignment
  is created by reconnect.
- Queued → ready and ready → revision-generating → proposal UI progression is exercised;
  the latter now completes without reload. Partial input persists explicit partial work.
- Evidence: `evidence/demo.json`, `state.json`, `restart.json`, `07-reopened-desktop.png`,
  `08-reopened-mobile.png`, `fault-regressions/results.json`; domain/runtime tests.

### A03 — Preserve a human edit
- **Integrated application / browser: PASS.** The canonical Wednesday protected-note
  amendment is made through the real editor while old-base work is held. Human revision
  2 remains current; stale proposal bytes are separately retained; acceptance against
  a refreshed current ID still returns `version_conflict`. Keep-current preserves history.
- Restored stale drafts cannot silently rebase. Explicit continuation still rechecks CAS.
  Loss before save, after saved-body commit and after dismissal commit retains the whole
  resolution intent and produces only one human revision.
- Evidence: `saved-artifact.json`, `stale-proposal.json`, `04-stale-proposal-desktop.png`,
  `05-stale-proposal-mobile.png`, `06-retained-history.png`, fault-regression results.

### A07 — Inspect a created task separately
- **Local domain/API/PostgreSQL: PASS.** Creation receipt is unresolved. A separate
  matching `get_task` produces a durable inspection ID and verified-created result.
  Missing, mismatched and unauthorized reads do not become verified effects.
- This is a local application task record, not Google or another external system.
- Evidence: `evidence/task-readback.json`, `state.json`, domain tests.

### A16 — Load only approved, relevant agent capabilities
- **Application adapter / fixture: PASS.** Approved manifests, exact registry/file
  hashes, selective skill/resource loading, scoped tool intersections and immutable
  run/context observations are exercised. Customer instructions remain untrusted data;
  source filenames, metadata and skill text cannot grant tools, budget or permissions.
- Version 0.1.1 is unavailable through the previous registry until explicitly approved;
  activation affects future runs, existing 0.1.0 pins remain unchanged, and rollback
  reproduces prior approved instruction/source inputs without undoing access revocation.
- **Selected live runtime skill behavior, actual enabled/disabled model ablation,
  observed model outcome/latency/cost differences: NOT OBSERVED.** No native filesystem
  skill compatibility or provider sandbox has been claimed.
- Evidence: `evidence/runtime-readback.json`, `backend/tests/test_bundle_versions.py`,
  `backend/tests/test_runtime.py`, `runtime/tests/test_bundles.py`.

### A17 — Recover one selected runtime without stale authority
- **Fixture application recovery: PASS.** Outbox admission, exclusive leases, fencing,
  scoped dispatch and commit checks, stable completion, post-commit ACK reconciliation,
  worker crash/reclaim and cancellation/revocation refusals exercised with PostgreSQL
  and real worker subprocesses. Mutation/audit/outbox rollback is tested.
- **Managed runtime session/turn binding, dropped-stream resume, selected-runtime
  wait/resume, configuration/session replacement and actual compaction: NOT OBSERVED.**
  No live runtime has been selected; managed-first qualification has not failed, so an
  SDK/Responses contingency has not been selected either. S4 long-duration scope is not
  silently added to this slice.
- Evidence: runtime/domain tests, `backend/RUNTIME_VERIFICATION.md`,
  `docs/RUNTIME_STATUS.md`, `evidence/runtime-readback.json`.

## Test modes and limitations
- **46** Python backend/runtime/bundle/calculation tests passed, no skips. Stateful cases
  use actual PostgreSQL 16 and a non-owner runtime role; pure bundle/math cases are unit tests.
- **10** frontend unit tests; type/lint/format and production build passed.
- Canonical contract export, generated declaration drift and contracts TypeScript passed.
- **9** targeted real-browser/API/PostgreSQL fault cases passed; a separate disposable DB
  contains evaluator-controlled failures. Actual successful replies are dropped for loss
  scenarios; successful provider/HTTP results are never fabricated.
- Existing Starlette/AnyIO deprecation warning is non-failing and recorded.
- Local synthetic single-user identity only; no production OAuth/tenancy/RLS/raw SQL client
  promise. No S3 adapter or distributed object-store transaction claim; artifact bytes are
  immutable PostgreSQL JSONB in the same transaction as their metadata.

## Remaining qualification inputs
An approved product project/API secret **reference**, verified provider support and an
explicit bounded spend/data/retention grant are required for the live checks above.
Development CLI login/model cache is not product entitlement. Secret values do not belong
in chat, Git or this handoff. Owner usefulness feedback is independent of these grants.
