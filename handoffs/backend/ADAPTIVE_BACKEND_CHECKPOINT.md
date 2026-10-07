# Adaptive backend checkpoint

This candidate preserves the interrupted backend work and corrects publication truthfulness. No provider calls, web edits, accepted bundle edits, old migration edits, or writes to protected databases were performed by the backend owner.

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

## Minimal independent-verification path (not implemented)

Always `needs_validation` is honest but not the M3 completion destination. Add an explicit immutable, task-scoped verification specification from a trusted source (for example user-confirmed input/output examples, or a separately authorized deterministic reference checker). Bind it to the original message/target hashes; keep expected answers hidden from generation; record held-out execution against the exact retained code/revision and checker identity. Only that independent receipt may promote requested-goal status. Do not infer expected results from model-proposed tests, hardcode prompt phrases to fixture answers, or prescribe a repair sequence. An evaluator used only in a demonstration is evidence, not runtime verification authority.
