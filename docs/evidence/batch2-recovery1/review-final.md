# Independent Astra correction rereview — HOLD

Reviewer: **gpt-6-astra via openai-codex**. Narrow correction review on branch `hermes/b2-conversational-client`, HEAD `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d`, plus the intentional integration. Reused `.local/recovery1/review-initial.md` for unaffected format-4 coverage and `.local/b22-rereview.md` for unchanged legacy coverage. No Batch-2-wide review or completion claim.

## Material finding

### F1 — New real-HTTP document recovery regression omits the required delivery lifecycle

**Location:** `backend/tests/test_tui_recovery_http_pg.py:100–107`.

The test stages a document and calls `Session.prepare(..., 'document', ...)` directly without first persisting `draft['delivery']`. After restart, `Session.inspect` correctly refuses abandonment with `Pending upload lifecycle missing` (`backend/workagent/tui/session.py:115–119`). The production sender creates and saves the frozen delivery at `backend/workagent/tui/app.py:631–639` before preparing any upload at lines 645–648; the offline regression correctly models this at `test_tui_recovery_controls.py:20–22`.

This is a concrete **test-fixture/verification defect**, not an asserted production recovery defect. The final parent suite has completed: **182 passed, 1 failed, 0 errors, 0 skipped (183 cases)**. The failure is exactly `test_real_confined_container_rejection_can_be_abandoned`. Its retained 422/`validation_error` assertions and empty server document-list assertion already pass; the restart-abandon assertions do not execute successfully.

**Required correction:** model the actual frozen upload-delivery lifecycle before preparing the document (or drive the real sender), retaining the restart, exact original/text, empty server document list, rejection-envelope and refresh-required assertions. Rerun this regression and the intended final operator/TUI gate on refreshed source manifests. Do not weaken `Session.inspect` to accommodate the malformed fixture. Until then, the requested real HTTP/parser document recovery proof and all-green final gate are not complete.

## Corrections and safety assessment

- **R1 production correction: no remaining material defect found.** Only the STOP endpoint adds matched `409 action_unresolved`; only the document-upload endpoint adds matched `422 validation_error`. Envelope validation, exact body request-ID and response-header request-ID matching remain required. The journal validates the same endpoint-sensitive evidence on retention and reload. `execute` permits definitive rejection only from the first `prepared` dispatch; a rejection after an ambiguous POST does not settle it. Explicit abandonment retains historical envelopes and human input and requires deliberate refresh before a new attempt.
- **Document audit production correction: no remaining material defect found.** Container mismatch raises `validation_error` before the ingest mutation; the new recognition is endpoint/status-specific. Offline restart/abandon coverage passes with the actual delivery invariant. The real HTTP/parser test remains blocked only by F1 above.
- **R2 production correction: no remaining material defect found.** STOP uses the canonical exact run ID joined to the same authorized conversation's raw queued/running lifecycle, not stale/blocked diagnostic labels. The widget retains `read_authorized`; dispatch freezes exact run/conversation/work-version, and server ownership/CAS/fencing remain unchanged. Terminal or nonmatching runs do not enable STOP. Parent final-suite evidence passes both stale/blocked lost-ACK replay and old/fresh-worker fence cases.
- **Eight integration repairs:** original failing case identities were parsed from baseline XML and matched to the final XML; **all eight pass**. The repaired fixtures supply a complete request envelope, validated canonical snapshot/events/attention and empty ancillary lists, the ancillary test's canonical artifact, selected-conversation canonical state, and explicit synthetic Responses authority for text attachments. No production/API/contract adjustment was made for these fixture repairs.
- **Safety assertions remain present:** one write attempt/no automatic retry and token redaction; byte-identical explicit replay after original-file deletion; exact attachment/text readback; one human message; no hidden fresh-CAS GET; stale-CAS rejection; selected-conversation rather than workspace-global state; access-denial cache clearing with human draft retention; candidate/body-bound consent reset; unknown-outcome abandonment refusal and retained pending state. No weakening of these assertions was found. Unchanged access/consent coverage is reused, not claimed as a new comprehensive security audit.

## Execution and source integrity

- Independently executed the deterministic offline recovery subset: `PYTHONPATH=backend PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python -m pytest -q -p no:cacheprovider backend/tests/test_tui_recovery_controls.py -k 'not stop_uses_exact_raw_lifecycle'` → **10 passed, 1 deselected in 4.50s**. An initial invocation without `PYTHONPATH=backend` failed collection with `ModuleNotFoundError: workagent`; the corrected invocation above is the result claimed.
- Parsed parent evidence: baseline **168 cases / 8 failures**; eight-green **8 passed**; review-first **34 passed**; final operator/TUI **183 cases / 1 failure**, detailed above. These parent HTTP/PG/Pilot results are read evidence, not independently rerun services.
- Independently recomputed all **1,426** candidate-manifest file hashes twice: **zero mismatches**. Programmatic baseline-to-candidate manifest delta is exactly the **10 paths** in `scoped-changes.json`, including the two new regressions; every before/after entry agrees with the corresponding manifest. Baseline has **1,424** entries. The initial report's unchanged production paths match the candidate manifest. Historical baseline bytes are represented by the retained baseline manifest/report, not a newly executed historical checkout.
- No product/test edits, web edits, provider/product calls, database access, credential/environment dumps, heavy concurrent suite, commits, publication or board transitions. Only this review report was created.

## Checked SHA-256

```text
bbeb1d9dc7c8e3a1ed49fa4e77ec64291ebef75dd808b75a0392164584f645a4  .local/recovery1/baseline-manifest.json
e3944461db521a69b18895ce7f9d3497cb9b98ac309683c39dce93d912ddf367  .local/recovery1/scoped-changes.json
7d1ed6ccbea943fff73f113204f22f09aa10afb413014065e58a4f24bb739a1b  .local/recovery1/test-source-manifest.json
763eab21133b155708c470c1aa1b29eb688f93836d6b3c63fc969dc1776eb9e7  backend/tests/test_operator_client.py
2c7a85fa167643db98a5a743bb2b03bb90aec2ff3e19565e3ed7c35f5046ae0a  backend/tests/test_tui_b22_corrections.py
d9393731fb5c4a402669354b9fd57e9519431a18388d48777eb345924b60ade4  backend/tests/test_tui_composer.py
08ece110533a31e70e9365dac6a8d7b2e81ea234ca5bffc887104290fb8e2b2f  backend/tests/test_tui_http_pg.py
01b2e18c59e0aaefdd9c0ca4f5e54afb4ea76c01ff814a4cf5792317c2f1754d  backend/tests/test_tui_recovery_controls.py
f943e8744a7baaa0170b606a83be81ef5058e9f6d2e70513ea9581bf3fe4602c  backend/tests/test_tui_recovery_http_pg.py
8e575752cdc57d99119c10482ca685c3dc8ee0cc04ed45feb264edd59434830c  backend/workagent/operator_client.py
f3e3aca39f82c4a4ca6b913e7ceb28d4b59652576ecae16c0972cca3b63e7bb3  backend/workagent/operator_journal.py
bc49ac0b3e5c675388da9371021708482519482954ef7d363f7a40b7a6f90f4a  backend/workagent/tui/app.py
3e502c66cdf511bba09be5036fbe091487c770c595657d0c97df83ade980b2c8  backend/workagent/tui/continuity.py
87ce70154a192c9d1fa69697c3c07a79ea91bb9a40b889f5a1b6d393f6b0579c  .local/recovery1/final-operator-tui.xml
16f30e0ac65c87d999750e292d1df68b53ff6eeb9fcce622dadcbca82696e466  .local/recovery1/eight-green.xml
5743981339f0171fac9b1bffcb1235293a68ae3bdf8c1d3eb8ced2bb51fd7e76  .local/recovery1/review-first.xml
```
