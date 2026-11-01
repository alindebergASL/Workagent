# P1/P2 corrective handoff

Candidate fix only; original REVIEW.md HOLD remains for parent/reviewer closure. No PG, real provider, original-store, funding, publication, contract, STATUS, frozen/predecessor-file or cohort mutation performed. No agents, commit or push. Development model GPT-6 Astra/high; development-tool costs remain outside the product ledger, unreconciled. Prior17 PG +11 packing +41 offline results remain pre-correction evidence, not final-source proof.

## P1: actual parser termination boundary

`general_responses.terminal_response_failure` now recognizes malformed results only for nine explicit issue codes reached by the current parser after envelope/correlation, valid usage and `completed` status: invalid_output, unfinished_output_item, invalid_function_call, invalid_reasoning_item, invalid_message, unsupported_output_item, expected_single_scoped_call, expected_structured_output, schema_validation_failed. The worker and `terminal_failure_bound` share this predicate; existing checkpoint classification uses the latter. Incomplete/failed/cancelled/refused remain supported. Envelope, correlation, unknown/missing status, pre-status usage, invalid_terminal_response, invalid_json and future/unreviewed codes do not establish known termination.

The future collector no longer separately admits arbitrary malformed results. Only the exact bound allowlisted path admits terminal malformed output. Authenticated schema_validation_failed selection feedback still goes through existing076, with F2 unchanged. Indeterminate saved results return running without new I/O and cannot become a safe partial settlement; checkpoint uncertainty remains unknown/reconcile. No transport/schema/SQL/accounting/receipt changes.

Actual-parser offline tests cover selection and final correlation mismatch with in_progress, envelope mismatch, unknown/missing status, invalid/missing usage, completed-with-error and invalid JSON; each denies terminal classification and collection and does not invoke worker settlement. All nine allowed output branches plus genuine terminal and queued/in_progress controls are exercised through the real parser. No mocked issue label is used for this new boundary proof.

## P2: receipt completeness across authorized pages

The transition helper tracks every receipt validated in the ordinary authorized paginated proposal listing. At completion the exact supplied-key set must match that checked set; absent, withdrawn or wrong-artifact keys cannot disappear silently. It also checks each listed proposal's own artifact ID, in addition to the existing receipt artifact/base/proposed/current revision/hash/status/decision/justification bindings. Pending proposals still block; unrelated resolved historical proposals still do not require receipts. There is no direct raw-body fallback, additional authority engine or automatic acceptance.

Pure tests cover absent/withdrawn/wrong-artifact/stale/wrong-key receipts, receipt arrival on a later page, unrelated resolved history and pending blocking. The new PG control reuses the established memory/source visibility fixture: produce a genuine proposal with controlled transport, explicitly retain the readable human baseline, record an ordinary dismiss/CAS receipt, withdraw only the new disposable producer's source access, prove the proposal is now hidden/directly unauthorized while the human revision remains readable, and reject the supplied receipt. Historical proposal/provider/request rows and calls must remain exact. No original source grant is touched.

## Changed files and preservation

Compared with the reviewed candidate: `backend/workagent/general_responses.py`, `backend/workagent/general_worker.py`, `evaluation/post_freeze_packets.py`, four existing `backend/tests/test_post_freeze_{terminal,packets,terminal_pg,review_pg}.py`, and new `backend/tests/test_post_freeze_parser_boundary.py` (8 paths).

Reviewed pre-fix code and review/manifest/report copies are in additive `fix-predecessor/`; originals remain untouched. F2 file_input_rejection.py, run_checkpoints.py and all88 migration bytes remain unchanged. The full ten-file corrective increment is bound in MANIFEST_FIX.json, including those two unchanged product files.

Consumer SHA256: `9241268cd97c1c2c8b38b908b23995c8f7eb53a1d208ca1355779b56e59a279d`.
Parent must regenerate the contract registry after inspection: only implementation_sha256 of connectors.github.discover/read differs, due their existing general_responses.py dependency. This writer did not regenerate or edit canonical/proposed contracts or old manifests.

## Actual local execution

- `fix-offline-01.log`:78 PASS in5.30s.
- `fix-offline-final.log`:78 PASS in4.40s, one existing Starlette deprecation warning. Includes prior41 scoped controls,31 actual-parser controls and6 receipt controls; these are78 distinct tests, not156.
- `fix-pg-collection.log`:11 selected PG tests collected in2.98s; **not executed here**.
- Diff whitespace check PASS. Old MANIFEST.json/review preserved; all88 migrations and unchanged F2/checkpoint hashes verified.

## Parent serial PG command

Use the already NEW normally provisioned disposable fixture only. Six new PG cases plus five positive affected-path controls (not the full17 or broader suites):

```bash
set -a
source .local/batch3/b35c/post-freeze-correction/fixture.private.env
set +a
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend:evaluation backend/.venv/bin/python -m pytest -q -p no:cacheprovider \
  backend/tests/test_post_freeze_terminal_pg.py::test_indeterminate_parser_result_stays_unknown_no_resend \
  backend/tests/test_post_freeze_review_pg.py::test_withdrawn_producer_receipt_blocks_readable_human_transition \
  'backend/tests/test_post_freeze_terminal_pg.py::test_terminal_result_restart_exact_no_resend[selection-incomplete]' \
  'backend/tests/test_post_freeze_terminal_pg.py::test_terminal_result_restart_exact_no_resend[final-incomplete]' \
  backend/tests/test_post_freeze_terminal_pg.py::test_targeted_hash_invalid_create_rejected_then_new_authorized_action \
  backend/tests/test_post_freeze_review_pg.py::test_future_review_exact_cas_ack_and_protected_text \
  --basetemp=.local/batch3/b35c/post-freeze-correction/pytest-fix-pg-01 \
  > .local/batch3/b35c/post-freeze-correction/parent-fix-pg-01.log 2>&1
```

New P1 PG cases invoke actual GeneralWorker/transport parser, directly deny settlement/collection, persist an ordinary unknown/reconcile checkpoint, restart from genuine saved receipt/capability without forced expiry, and compare exact request/event/accounting/call history. New P2 PG authority case is pending parent execution. These tests do not establish paid model quality, browser behavior or campaign integration. No new paid validation or C/D release is claimed or authorized by this handoff.
