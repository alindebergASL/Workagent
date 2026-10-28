# Batch 2 recovery 1 — narrow operator/TUI gate complete

Card `t_66f1277f`; successor `t_1ff7a54e` owns the separate parser CPU/wall-limit campaign. **Batch 2 remains incomplete.** No web changes, publication, installation or default-branch merge.

## Exact candidate and scope

Workspace `/home/ubuntu/workagent-continuation-20261026`, branch `hermes/b2-conversational-client`, HEAD unchanged at `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d`. Existing intentional B22–B25 changes and untracked dependencies remain intact. No scoped commit: committing tracked operator changes alone would omit their intentional untracked TUI/model dependencies; publication belongs to the later card.

Evidence directory: [`evidence/batch2-recovery1/`](evidence/batch2-recovery1/). `final-source-manifest.json` hashes all 1,426 candidate files before evidence-document creation; every hash was rechecked after the final test run with **zero mismatches**. `baseline-manifest.json` identifies the entry source. `final-scoped-changes.json` gives before/after hashes for exactly these ten source/test paths:

- `backend/workagent/operator_client.py`
- `backend/workagent/operator_journal.py`
- `backend/workagent/tui/app.py`
- `backend/workagent/tui/continuity.py`
- `backend/tests/test_operator_client.py`
- `backend/tests/test_tui_b22_corrections.py`
- `backend/tests/test_tui_composer.py`
- `backend/tests/test_tui_http_pg.py`
- `backend/tests/test_tui_recovery_controls.py` (new)
- `backend/tests/test_tui_recovery_http_pg.py` (new)

No other production/test source changed in this card. The handoff and evidence directory are additional documentation-only files. `git diff --check` passes; index is empty. One writer: entry process inspection found only this card's owner/worker plus the known old uvicorn, not a separate implementation lane.

## Eight reproduced failures: classification and repair

The original complete suite reproduced **160 passed / 8 failed**, exit 1 (`baseline.log/xml`); previous `.local/tui-integrated-final.*` was not overwritten.

All eight were stale test inputs/fixtures:

1. `test_no_write_retry_or_secret_error` supplied a body without the now-required exact `request_id`, failing before transport. Supply the full command envelope; keep one-attempt and secret-redaction assertions unchanged.
2. Four parametrized independent ancillary-read tests did not implement the new canonical endpoints. Supply validated snapshot/event/attention DTOs, bounded empty continuity lists and the canonical artifact, while retaining independent failure/timeline/catalog assertions.
3. Pending-follow restart used the same old fake; canonical fixture support restores the existing restart/readback/edit-preservation test unchanged.
4. Redirect-label test supplied workspace execution only. Supply the selected conversation's canonical execution and keep the different-run/no-redirect and own-run/redirect assertions.
5. ASGI exact text-attachment replay lacked the explicit synthetic Responses admission grant. Activate only the disposable conversation; no dispatcher or provider runs. Keep exact attachment/text, original-file deletion, POST-only/no hidden CAS read, single-message and stale-CAS assertions.

Focused rerun: **8 passed**, exit 0 (`eight-green.log/xml`). No production behavior was loosened for these eight fixes.

## Independent review and bounded production corrections

Reviewer model: **gpt-6-astra via openai-codex**, initial risk-focused review then one narrow correction rereview. Reports `review-initial.md` and `review-final.md` are preserved verbatim; unchanged legacy B22 evidence `.local/b22-rereview.md` and unaffected initial format-4 coverage are reused.

Initial review found two real production defects:

- **R1:** STOP racing normal completion received a definitive pre-effect `409 action_unresolved`, but the journal treated it as unknown forever. Add endpoint/status-specific recognition for STOP only. Also address the explicitly requested analogous audit: document upload's pre-effect `422 validation_error` is recoverable. Exact envelope/header request-ID matching, durable evidence validation, and first-dispatch-only semantics remain; rejection after any earlier unknown POST cannot settle ambiguity. Explicit abandonment preserves history, documents and human text, then requires deliberate refresh.
- **R2:** Diagnostic `stale`/`blocked` hid STOP for a genuinely running run. Enable STOP from the canonical exact run ID joined to the authorized conversation's raw queued/running lifecycle. Terminal/nonmatching runs and denied reads remain disabled; backend ownership/CAS/fencing and schemas are unchanged.

New deterministic regressions first produced **8 passed / 3 failed**, exit 1 (`review-red`), then the recovery + existing continuity subset produced **34 passed**, exit 0 (`review-first`). Negative cases retain unknown state for wrong/missing request identity, wrong status and prior ambiguous dispatch.

Correction rereview found **no remaining material production defect** in R1/R2/document handling or the eight fixture repairs. Its verdict was HOLD solely for a new real-HTTP test fixture that omitted the persisted frozen document-delivery lifecycle. Parent applied the exact requested test-only correction, preserving all assertions and production guards; only `test_tui_recovery_http_pg.py` changed after that review. `test-source-manifest.json` identifies the reviewed source, `final-source-manifest.json` the test-corrected source. The reviewer did not issue a subsequent all-green verdict; the final clearance of this fixture finding is parent verification, not a fabricated independent PASS.

## Executed final gate

From workspace root, using the existing pinned backend environment:

```bash
source .local/integrated.env
export PYTHONPATH="$PWD/backend"
backend/.venv/bin/python -m pytest -q backend/tests/test_operator*.py backend/tests/test_tui*.py \
  --junitxml=.local/recovery1/final-green.xml > .local/recovery1/final-green.log 2>&1
```

**Exit 0; 183 passed, 0 failures, 0 errors, 0 skipped; 107.759 seconds.** This is the complete current operator/TUI glob suite, not just the eight repairs. Copied `final-green.log/xml` is the final evidence. A Starlette/AnyIO deprecation warning is non-failing.

Real HTTP/restricted PostgreSQL cases within that run prove:

- ASGI attachment lost ACK: exact command/text/bytes, original removed, one message and stale CAS refused.
- Actual ephemeral loopback server: attachment lost ACK, reconstructed client/session, exact replay and one admitted run.
- STOP/completion race: actual matched rejection, restart, explicit abandonment, deliberate current read and successful fresh human message.
- Running run with no worker and running run with dispatch blocker: STOP remains available; lost ACK and exact replay cancel once; work version/fence advance once; old lease cannot publish and a fresh service cannot claim the stopped run.
- Actual confined parser rejects a non-Office ZIP uploaded as DOCX before storing a document; restart/abandon preserves exact staged original/text and requires refresh.

`database-proof.json` records non-secret database/role fingerprints, disposable `workagent_test_*` identity class, non-superuser/non-bypass-RLS runtime, and installed event/checkpoint/queue/document tables. Each `test_domain.context` seeds a fresh synthetic workspace. Loopback fixtures create the app from current imported source on a new ephemeral port and shut it down afterward; they **do not use old PID 2688430/port 18963**. No migrations, database maintenance or paid provider calls occurred.

Intermediate evidence remains separately retained: `http-pg-first` exit 1 (4 pass/2 new-test diagnostic-text mismatches, corrected to assert retained envelope codes rather than weakening redacted UI text); `final-operator-tui` exit 1 (182 pass/1 missing delivery lifecycle fixture), followed by `final-green` above. No RED log was replaced with GREEN.

## Successor boundaries

- Proceed with existing card `t_1ff7a54e` only after this card completes; do not run a concurrent writer. It owns CPU-vs-wall confinement proof and the complete document campaign. This card's real parser mismatch check does **not** settle that remaining CPU guard result.
- Later cards still owe web build/type correction through Claude ownership, integrated current-source campaign, browser/PTY/cross-client journeys, all A01–A35/P1–P8 rows and publication. No whole-batch acceptance is asserted here.
- Old uvicorn PID 2688430 remains untouched/stale. Verify its identity before any task-owned restart. No model worker was launched. Disk remains about 15 GB free; no dependency changes or cleanup.
- No product spending or model/authority switch. Developer reviewer sessions are separate from the cumulative product budget. `.local/*.env` remains private and uncommitted; copied evidence was scanned against the actual DSNs/bearer value without printing them.
