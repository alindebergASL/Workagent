# Batch2 recovery4 — exact-source integrated verification

**Bounded card complete; Batch2 is NOT complete.** Task `t_77ca6df4`; existing successor `t_5f6349b3` owns terminal/API continuity journeys. No commit, push, default merge, installation or production replacement. Intentional uncommitted B2 integration is preserved.

## Candidate and correction

- Workspace `/home/ubuntu/workagent-continuation-20261026`, branch `hermes/b2-conversational-client`, HEAD `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d` throughout.
- Frozen final source: [`final-source-manifest.json`](evidence/batch2-recovery4/final-source-manifest.json), **599 backend/contracts/web/fixture files**, including intended untracked files. SHA256 `d01dd0dba881baac359e2f58007ab07671e135237f237f7143f09dccba8caeda`.
- Wider candidate: [`final-candidate-manifest.json`](evidence/batch2-recovery4/final-candidate-manifest.json),1,528 files, SHA256 `e26404cbd25b2f31372ec084f724c9985fea62a9659bd4b394050ad8ad3cddaf`. New recovery4 evidence and this later handoff are not test inputs.
- Every final gate verified unchanged source before/after execution. Subsequent source-hash/readback check also passed. HEAD alone is not the candidate identity.
- Started byte-identical to recovery3; backend/contracts also matched recovery2. Corrected only **three files**, captured in [`scoped-correction.diff`](evidence/batch2-recovery4/scoped-correction.diff) and [`scoped-correction-manifest.json`](evidence/batch2-recovery4/scoped-correction-manifest.json), SHA256 `2f136336c8388566f08639926839f7e392369660aa99a018b3b4122fb37508d5`:
  - `backend/workagent/conversations.py`: load retained-result schemas only when an actual managed grant exists. Controlled provider-free CLI admission no longer imports provider transport through the new retained-results dependency. Managed standing/sustained bounds are unchanged.
  - `backend/tests/test_general_responses_journey.py`: new eight-request reservations correctly expect400000 input tokens, not historical160000.
  - `backend/tests/test_general_responses_gates.py`: revoked-before-send reservation remains50000, not historical20000. All no-I/O/retry/accounting assertions retained.
- The50k policy already existed in HEAD. No authority, grant, model, reservation policy or production limit changed. Legacy fixed-budget preservation tests pass.
- **Independent narrow Astra review PASS**, model `gpt-6-astra` via `openai-codex`: [`review-correction.md`](evidence/batch2-recovery4/review-correction.md). All three reviewed hashes verified against final source. Prior unaffected TUI/events/checkpoint/document/web reviews and original limitations retained in [`review-reuse.json`](evidence/batch2-recovery4/review-reuse.json). No Claude/web edits on this card.

## Final executed gates

All rows below use the same final source. Commands/elapsed times in [`final-results.json`](evidence/batch2-recovery4/final-results.json), exact selected backend paths in [`final-test-selection.json`](evidence/batch2-recovery4/final-test-selection.json), parsed/deduplicated totals in [`verified-totals.json`](evidence/batch2-recovery4/verified-totals.json).

| Gate | Result | Exit |
|---|---:|---:|
| Focused four prior failing cases plus legacy-budget regressions |9 passed|0|
| Full integrated operator/TUI/documents/events/checkpoints/leases/process-restart campaign,34 files |411 passed|0|
| Full affected conversation/journey/gates/fixed-budget files plus response admission/recovery/settled-handoff,7 files |97 passed|0|
| Canonical Python/OpenAPI/generated TypeScript/alpha schema drift and contracts TypeScript |PASS|0|
| Frontend TypeScript |PASS|0|
| Full frontend Vitest, one worker |470 passed|0|
| ESLint, zero warnings |PASS|0|
| Prettier check |PASS|0|
| Production Next.js webpack build, including framework TypeScript |PASS|0|
| `git diff --check` |PASS|0|

**508 distinct backend tests +470 frontend tests =978 distinct passing tests**, zero failures/errors/skips. The9 focused rechecks overlap the final backend suites and are not added twice. This is a41-file integrated backend selection, **not the entire backend suite**. Web source remains unchanged from predecessor but was rerun against this integrated candidate.

Actual final launcher from repository root: `source .local/recovery4/test.env && backend/.venv/bin/python .local/recovery4/run_final.py`. This archival runner deliberately refuses to overwrite logs; use new evidence paths for a future run. No dependency install or shared node_modules mutation. Contracts use their own existing locked tree; web uses existing shared dependencies and `npm run build -- --webpack`, never pnpm auto-install.

Build ID **`YJ02QDB9HRC2aV6tLomA3`**, `NEXT_PUBLIC_WORKAGENT_API_BASE=/api/domain`, `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1`, telemetry disabled. **Built, not served/browser-verified by this card.**

## Real database, confinement and restart proof

Canonical `backend/dev_db.py` created a new disposable `workagent_test_*` database; private mode0600 credentials only at `.local/recovery4/test.env`. Runtime is neither owner/superuser nor BYPASSRLS; runtime-role check passed. All49 migration checksums match source exactly. Identity fingerprints, full migration checksums and feature-table presence: [`database-proof.json`](evidence/batch2-recovery4/database-proof.json). Each test seeds a fresh synthetic workspace; migration-prefix tests create their own additional disposable DBs. Nothing adopts/resets production state.

Environment: existing `backend/.venv` and parser `backend/.venv-docs`, actual bubblewrap0.9.0/prlimit, system Python3.12.3; dependency versions and existing symlink targets captured in [`environment-proof.json`](evidence/batch2-recovery4/environment-proof.json).

Final measured properties in [`final-behavioral-properties.json`](evidence/batch2-recovery4/final-behavioral-properties.json):
- CPU confinement: live5-second CPU limit,4.500959931 observed CPU seconds, exit137,13.093586258 wall seconds.60-second test-only wall guard; production limits unchanged.
- Wall confinement:5.009559904 seconds at5-second test wall guard,4 observed processes,0 live survivors.
- Real current-source API subprocess stopped/restarted; all3 original document formats and exact commands/cursor survived,22.674347822 seconds. Not an in-process mock restart.
- Snapshot measurement:10 queries,0.039946040 SQL seconds,0.091155891 total seconds,3379 bytes. This is one recorded synthetic measurement, not a production performance SLA.

HTTP/CLI/restricted-PG and Textual Pilot tests are real engineering evidence; provider transports are explicitly synthetic/controlled. Runner whitelists environment and excludes provider credentials. **Zero product-provider calls/spend; installed model authority and cumulative$100 ceiling unchanged.** No live billing balance claimed or paid trajectory attempted.

## Preserved red evidence and scope limit

Original `backend-core.log/xml` passed411 before correction; it is historical, not substituted for final proof. The exploratory30-file shared-runtime run was gracefully interrupted to diagnose four concrete failures within the existing runtime budget: **128 passed,4 failed, exit2**. All four failures are corrected and pass in final affected suites.

The interrupted XML contains an anonymous incomplete testcase. Original `results.json` naively reports129passes/133cases for that run; **that is not valid**. The pytest summary and suite attributes establish132 completed cases(128+4). Original log/XML/results are intentionally preserved, with explicit correction in `checkpoint-correction.md`; no red was overwritten. That broader30-file campaign was not completed, and its unexecuted cases are not claimed green. Final required integrated selection is explicit above; no full-backend/full-batch claim.

## Successor runtime instructions and remaining obligations

1. Verify the final source manifest before using this evidence; any later modification needs affected exact-source retesting. Do not copy stale lane trees. Existing registered worktree remains the serial owner.
2. Source private environment, never print it. For user journeys seed a fresh synthetic workspace/fixture using current canonical helpers; managed synthetic grants must bind current `consumer_hash`, not pre-correction grants. Existing test DB contains many test workspaces, not one declared journey fixture. Hash/record the successor's fixture, schema and runtime identity.
3. **Old PID2688430/API18963 still serves stale source and was never used as proof.** No task-owned test/build/writer remains. Start a separately identified current-source loopback API/production frontend for journeys; inspect process ownership before stopping/restarting anything. No provider worker is running from this card.
4. Frontend runtime proxy requires `LOCAL_TEST_MODE=true`, private `LOCAL_BEARER_TOKEN`, exact loopback `WORKAGENT_BACKEND_URL` and matching `WORKAGENT_WEB_ORIGIN`. Preserve the build's real `/api/domain` base. Do not put bearer/DSNs in browser bundles or reports.
5. Existing successor `t_5f6349b3` owns terminal/API continuity: actual PTY80x24/120x40, attachment/replay/STOP/queue/checkpoint/consent and exact same durable work. Subsequent browser lane owes actual IndexedDB/localStorage close/reopen, unknown upload recovery, scope switching and late settlement, cross-client continuity, desktop1440/phone390/narrow320, and review/usefulness against approved designs. Unit/Pilot/controller tests do not replace those journeys.
6. Full A01–A35/P1–P8 acceptance, truthful live/longitudinal authority constraints, verified feature-branch publication and existing Batch3 chain remain downstream. No new spending/private access/external business effects/default merge/production replacement/DB maintenance authorization. Read cumulative ledger before any paid evaluation; report unavailable evidence rather than fabricate success.

Final credential scan clean; source/review hashes match; private environment0600. Disk15.26GiB free at final check. No cleanup, dependency installation, concurrent writer or parent-reserved-tree modification by this card. Evidence archive accompanies this handoff; all previous red evidence remains intact.
