# Focused independent recheck — PASS

**Reviewed:** `d937957521e1acdcffcac5d3ba3e70609f6cff98`  
**Baseline:** `e74079123afc2ff392b38b31586736edc0617da1`

All six initial material findings are closed; no new material regression was reproduced in the bounded fix scope.

| Finding | Independent result |
|---|---|
| R1 stale restored draft | Original stored base retained; ordinary Save disabled; explicit continuation required; later CAS conflict preserves third human edit. Explicit resolved save also succeeds. |
| R2 ambiguous command retry | Lost real 202 produces one revision run and identical retry payload, even after a human save. Accept/dismiss also retain IDs and expected revisions after real post-commit response loss plus failed readback. |
| R3 polling | Ready → generating → proposed/review completes on the mounted page without navigation/reload. |
| R4 resolution retry | Before-save, after-save-commit and after-dismiss-commit failures retain the whole operation; one human revision and dismissed proposal result. Partial-save readback remains explicitly incomplete; completed resolution can reconcile read-only. |
| R5 replay under source drift | Identical receipt replays; changed intent conflicts; new stale admission fails; revoked access denies replay. SQL confirms one durable command/effect set. |
| R6 source provenance | Current @review-v2 bytes and observed @1 dependencies are separately labeled; visible warning disclaims unavailable historical bytes and latest-content evidence attribution. |

## Executed evidence
- `pytest.log`: **46 passed**, no skips; one existing deprecation warning.
- `frontend-check-rerun.log`: typecheck, lint, format, **10 tests passed**.
- `contracts-check.log`: full canonical export/drift/TypeScript check passed.
- `build.log`: production webpack build passed.
- `candidate/.local/evidence/fault-regressions/results.json`: **9/9 real fault cases passed**.
- `additional-results.json`: **5/5 reviewer-authored browser cases passed**, including post-commit decision retry and intervening human edit.
- `source-http-results.json`: reviewer-authored real HTTP/PG replay, freshness and revocation matrix passed.
- `verification.json`: exact SHA, **182 hash-matching tracked files**, clean checkout, and restored canonical synthetic source verified.

Used a fresh reviewer-owned PostgreSQL database and ports 8113/3113. Servers stopped and port closure verified. Database and mode-0600 env retained for reproduction. No candidate implementation, parent saved database, or parent evidence changed.

Harness issues, not candidate findings: pnpm rejected external dependency symlinks; underlying npm scripts passed. One supplemental test initially raced an in-flight request; correcting its wait reproduced the intended fault boundary and passed. Both initial failure logs are preserved.

**Limits:** focused local-mode recheck only. No live A16/A17/provider qualification or owner-usefulness acceptance; these remain outstanding. Full root demo orchestration was inspected, not rerun. See `recheck.json` for exact paths and finding-level evidence.
