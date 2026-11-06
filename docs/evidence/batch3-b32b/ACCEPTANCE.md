# B3.2b — editable office files, verified exports and charts

## Accepted implementation and consumer scope

B3.2b implementation/client acceptance is **PASS**. Final feature publication and exact-head CI are reported in the task's final handoff; this document alone is not a deployment or Batch3-complete receipt. B3.2c remains a separate successor. No paid product calls, installed-data maintenance, default-branch merge or runtime promotion occurred.

- Shared working files now create editable office-v1 document/workbook JSON copies of retained DOCX/XLSX/PDF sources. Original binaries and immutable extraction receipts remain unchanged. Human exact-base edits/proposals retain source provenance.
- Actual confined DOCX/XLSX/PDF/PNG export adapters use pinned libraries, fixed output names, resource bounds and network/host/environment isolation. Downloads enforce scoped access, exact MIME, byte limits, SHA-256, no-store and nosniff.
- Charts compute real grouped Decimal values from saved CSV or typed workbook bytes. Input hash, axes, specification, decimal precision/rounding and computed rows are exposed; the tested chart shows East0.3 (2 rows) and West1.5 (1 row).
- Web acknowledged-copy journals retain both exact request and result until scoped source readback and successful opening; retries with known results make no new POST/command. Export mismatches remain unresolved. Negative, replay, remount and list/open race tests cover these cases.
- BOM inspection preserves human bytes/hash in ordinary JSON, imported-office revisions and proposals. Additive migration062 corrects the SQL parser view without rewriting061 or historical receipts. Only disposable fixture databases were migrated; before/after retained-table hashes match.

## Evidence and execution

`SOURCE_MANIFEST.json` binds final changed source; `BUILD_BINDING.json` binds exact candidate inputs and optimized build outputs. `EVIDENCE_MANIFEST.json` binds this evidence package. API execution used repository-root code; unused copied backend lane files are not evidence. The isolated candidate `.next` was used, never the shared root output.

### Actual clients and downloaded bytes

- Real optimized browser created/edited the brief and downloaded DOCX, PDF, XLSX and PNG. `records/download-readback.json` independently parses the browser bytes with python-docx/openpyxl/pypdf/PIL and matches each download to its stored export manifest. The same stored output hashes were verified after restart. Quote, human wording, annotations, workbook key cells/formula types and omitted formula caches were checked.
- All three DOCX/XLSX/PDF editable imports were opened through real web controls, human annotations saved, and exact text reopened after restart. Native actual PTY also imports all three, creates/edits/exports/downloads and exposes the annotated saved document and computed chart rows; no widget-call simulation replaces these journeys.
- Saved web/native human revisions remain unchanged in `records/final-saved-state.json`. Unsaved web editor and composer text recover exactly after service restart and explicit reload; unsaved native draft text recovers in a fresh PTY. A prolonged outage fences the web page until Reload, as designed; scoped session storage is retained, not lost or exposed under another identity.
- Final actual chart controls/rows fit1440,390 and320px with no horizontal page overflow (`records/browser/final-chart-layouts.json`). Source inspection and a real-CSS regression test reproduced and corrected intrinsic grid/fieldset/button widths. Final desktop/phone screenshots were visually inspected: readable labels, hashes, controls and computed rows.
- LibreOffice/Poppler renders of actual browser DOCX/PDF show readable quotation, human edit and annotation without overlap/clipping; real1000x600 chart has readable labels/axes and correct bar values. XLSX cells/formulas/annotation sheet were independently read; its simple Calc render is not an office-suite print-layout guarantee. LibreOffice may evaluate formulas for its preview; those displayed values are not product-computed truth. Original downloaded formula caches remain absent.

### Checks, not an additive total

- Parent final focused web run:111 tests in5 files, plus TypeScript. Earlier110/100/88 and helper full-suite reports overlap and are not added or relabeled as parent reruns.
- Final post-BOM restricted-PG run:6 checks passed on new test04, including imported-office BOM revision/proposal persistence, migration idempotence, original-byte retention, actual export reader, invalid content refusal, revocation, stale human edit race and broker chart replay.
- Reused unchanged isolation/backend/native evidence: prior82-pass run (initial parent fixture-collection errors preserved), corrected parent TCP/security4-pass run, real confinement outputs, initial lane126 checks. No unrelated full backend/research rerun claimed.
- Final canonical generation/drift/type checks and isolated optimized build pass. Changing the service implementation hash required regenerating capability-registry-v2.json; the final build includes that generated-only correction.
- CI installs its existing pinned Playwright Chromium before `pnpm check`, because the new focused real-CSS test launches it. No untrusted workflow interpolation was introduced.

## Independent review

One existing Astra/high reviewer, session01a1858e-5ea8-7ea1-a204-4de3e4b4d314, performed the original risk review and narrow closures. `REVIEW_INITIAL.md` remains FAIL history; `REVIEW_INTERMEDIATE.md` preserves the incomplete BOM correction. `REVIEW_BOM_CLOSURE.md` and final `REVIEW_CLOSURE.md` close all three findings with exact current source bindings. Parent resolved final browser/build/artifact evidence rather than launching another review campaign.

Sole web owner remained Opus5.5 session80e463c4-c27b-4886-a415-39bfdb82abdd. This continuation's two invocations retained15min/30turn/$3 bounds and returned21 and16 turns. CLI cumulative cost snapshots were8.895804 and10.4736334USD; they are not additive, settled billing or product-ledger charges. No model/account/cap switch or replacement writer occurred.

## Fidelity and operational limits

Editable office JSON retains values/plain paragraphs, not rich office-suite fidelity. Styles, tracked changes, comments, drawings, embedded objects, merged cells and layout may be omitted; manifests and UI disclose this. Formula strings and imported/user-provided caches are observations, never recalculated truth. PNG omits annotations/source details in pixels and explicitly says so; exact inputs/rows remain in the manifest. PDF import reads text layer only; OCR/vision is unavailable. Copy opening checks the first100 file-list entries; beyond that it stays unresolved instead of falsely succeeding.

Synthetic mechanisms are not a live-model usefulness evaluation. Initial failed/unknown PNG broker outcomes, failed test/harness evidence and historical liabilities remain retained. Browser harness selector/toggle/viewport timing failures are not counted as product passes. Owned proof services are stopped and exact ports18235/13235 refused at handoff. Private fixture envs remain private; published evidence copies are scanned/redacted for known credentials. Preexisting untracked contracts/pnpm-lock.yaml is unchanged.
