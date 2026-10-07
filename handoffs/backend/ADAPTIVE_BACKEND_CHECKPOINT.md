# Adaptive backend checkpoint

This candidate preserves the interrupted backend work and corrects publication truthfulness. Initial backend correction used no provider calls, web edits, accepted bundle edits, old migration edits, or writes to protected databases. The subsequently authorized direct-GLM review is recorded separately below; it is not a Workagent model-generation checkpoint.

## Contract and behavior

- Adaptive policy `adaptive-local-v1` uses the existing GeneralWorker/Responses ledger, up to four selection observations plus final explanation. Rejected operations and safe diagnostics enter the next selection context. Exact first goal/criteria and human-input provenance cannot silently change.
- Passing model-proposed tests is **not** requested-goal verification. `verification.satisfied=false`, `model_tests_passed=true`, `requested_goal_status=needs_validation`. The observed artifact/file can now be saved as useful work, with run state `partial`, trusted user-visible limitation text, and `retained_local_result.published=true` based on actual observation records. Revisions still become proposals; human acceptance is unchanged.
- Model `complete`/success prose cannot promote an unverified requested goal. Provider prose is retained in immutable receipts; adaptive terminal conversation text comes from the trusted observation reason, checked by SQL message and attempt reconciliation guards.
- Shared $20 worst-case reservations include prior grants with the same authorization or project and survive successor grants, runs, failures and restarts. Known usage is reported separately, not silently refunded. Legacy pins and recovery profiles are retained.
- Budget exhaustion durably stops with retained observations; uncertain provider sends never authorize replacement generations.

## Verified at initial commit

- Fresh disposable DB `workagent_test_ef88cafd15a5`, environment `.local/adaptive-backend-checkpoint.env`. Provisioned through unchanged `backend/dev_db.py`; migration012 applied normally with its journal. Earlier disposable candidates are left intact after migration changes, not patched.
- `PYTHONPATH=backend .venv/bin/python -m pytest -q backend/tests/test_adaptive_execution.py`: **9 passed** against that nonowner runtime.
- `PYTHONPATH=backend .venv/bin/python backend/run_adaptive_pure.py`: **13 passed**, DB/socket connections forbidden.
- Canonical contract export/check, `node contracts/check-drift.mjs`, and `contracts/node_modules/.bin/tsc --noEmit -p contracts/tsconfig.json`: passed. Local environment uses root `.venv`, not the absent `backend/.venv` expected by npm wrapper scripts.
- `git diff --check`: passed. Full DB regression suite and independent parent review remain pending at this initial checkpoint. No live usefulness or UI proof is claimed.

## Follow-up verification and correction

- Exhaustion through **151 actual synthetic generation reservations** across seven successive grants proved the shared guard: `$19.919920` retained, with the next `$0.131920` reservation rejected independently by SQL and application checks. No charges were fabricated, deleted or reset. Revoked grants remained in the shared total. The last useful Wasm body/output survived without publication or a final provider generation.
- This exposed a real bug in the preserved budget-stop implementation: it tried to mark a dispatched attempt `failed`, conflicting with the existing `protect_receipt_retention` guard. Fixed the application, not the guard: budget stopping now preserves attempt state/receipts unchanged and durably marks only the run `partial`/`budget_limit`. A fast dedicated regression also checks that a sent attempt is never abandoned.
- Additional real-DB regressions cover executable wrong output changing the next action, invented passing criteria and lying final prose never completing the requested goal, unknown sends at each phase surviving restart without regeneration/publication, unknown liabilities surviving successor grants, and stale human edits blocking continuation and publication.
- Full-suite fixture project IDs are now unique per independent workspace, while explicit shared-budget regressions deliberately share them. A fixed synthetic project across unrelated tests legitimately exhausted the new cumulative ledger; this was test isolation, not justification to reset reservations.
- Migration upgrade expectations now include012, preserving previous checksum rows/records/minimal ACLs. Snapshot-isolation rejection assertions match the shared-budget guard's message.

### Final execution evidence

All commands below ran from the repository root after sourcing `.local/adaptive-backend-checkpoint.env`, with `PYTHONPATH=backend` and `.venv/bin/python`:

1. `-m pytest -q backend/tests --ignore=backend/tests/test_adaptive_guards.py --junitxml=.local/adaptive-full-verified.xml` executed all499 then-existing tests:492 passed;7 failed only stale migration-name/error-message assertions. Those assertions were corrected.
2. `-m pytest -q backend/tests/test_general_products_upgrade.py backend/tests/test_general_responses_gates.py backend/tests/test_general_responses_isolation.py --junitxml=.local/adaptive-upgrade-isolation.xml`: **26 passed**, including all seven corrected full-suite failures.
3. `-m pytest -q backend/tests/test_adaptive_execution.py backend/tests/test_adaptive_pure.py --junitxml=.local/adaptive-core-final.xml`: **22 passed** on final runtime code.
4. `-m pytest -q backend/tests/test_adaptive_guards.py --junitxml=.local/adaptive-guards-final.xml`: **9 passed**, including real shared-budget exhaustion and independent SQL denial.
5. Final collection and programmatic JUnit-ID reconciliation: **508 unique current tests,508 latest passing results, no missing tests or unresolved failures**. This is full coverage across the suite and targeted reruns, **not a claimed clean single-invocation full-suite rerun**. Earlier interrupted/failing logs remain private diagnostic history.
6. Fresh DB readback: `workagent_test_ef88cafd15a5`, **12 exact migration checksums**, nonowner runtime. No SQL function replacement outside migrations and no old migration history changes.
7. Canonical contract regeneration/check, generated TypeScript drift check, `tsc --noEmit`, offline13-test socket/DB-forbidden run, and `git diff --check` passed. The only pytest warning is the existing Starlette/AnyIO deprecation.

Runtime consumer hashing changes with the budget-stop correction; bind any new adaptive grant to the **final commit's** `consumer_hash()`, not the earlier checkpoint. Live provider behavior, held-out goal correctness, UI experience and independent parent review remain separate/unverified here.

## Resumed verification — clean full suite and direct GLM review

Runtime candidate: `84717547f7429517ba774a78b9542fc4e59f4ff3`.

- Created a new disposable DB through unchanged `backend/dev_db.py`: `workagent_test_f341f708e86b`, environment `.local/adaptive-resume-clean.env`. Readback confirmed all12 migration checksums match and the runtime is nonowner. Earlier databases were not reset or adopted.
- `. .local/adaptive-resume-clean.env && PYTHONPATH=backend .venv/bin/python -m pytest -q backend/tests --junitxml=.local/adaptive-resume-clean.xml`: **508 passed, zero failures/errors/skips in one clean invocation**. The sole warning is the existing Starlette/AnyIO deprecation. This supersedes the earlier caveat about coverage being assembled across reruns.
- Canonical Python export check, generated TypeScript drift check, TypeScript typecheck, and diff hygiene passed again. No runtime or contract code changed during this resumed verification.
- Per Andrew's explicit model-routing instruction, the independent review used the direct Z.AI endpoint `https://api.z.ai/api/anthropic/v1/messages`, with requested and returned model `glm-5.3`, HTTP200, and no OpenRouter fallback. The first bounded response was truncated and was **not** approval. A focused follow-up completed with `stop_reason=end_turn`, verdict `pass`, and no concrete findings. Scope was adaptive verification/publication, receipt preservation, and shared-budget SQL; omitted modules and unexecuted checks were explicitly limitations. Deterministic tests, not the reviewer verdict, establish execution evidence.
- Private receipts: `.local/adaptive-glm53-review.json` (incomplete), `.local/adaptive-glm53-review-followup.json` (completed). These are Hermes development-review calls, not Workagent turns or charges against its separate retained authorization ledger. No live Workagent generation, frontend edit, default merge, or deployment was performed.

The user-level Hermes configuration now routes GLM fallback, review-panel, compression and title-generation slots through direct `zai-coding-plan`/`glm-5.3`. The obsolete GLM5.2/OpenRouter route was removed; the main `openai-codex` model was left unchanged. Those profile changes are outside this repository.

## Minimal independent-verification path (not implemented)

Always `needs_validation` is honest but not the M3 completion destination. Add an explicit immutable, task-scoped verification specification from a trusted source (for example user-confirmed input/output examples, or a separately authorized deterministic reference checker). Bind it to the original message/target hashes; keep expected answers hidden from generation; record held-out execution against the exact retained code/revision and checker identity. Only that independent receipt may promote requested-goal status. Do not infer expected results from model-proposed tests, hardcode prompt phrases to fixture answers, or prescribe a repair sequence. An evaluator used only in a demonstration is evidence, not runtime verification authority.
