# General products — local integration verification

## Scope and verdict

Integration branch: `hermes/general-products-integration`; worktree: `/home/ubuntu/workagent-general-integration`. Parent base `6924a80`, backend `8ef4aab`, frontend `f071ebd03485cefff733d7796bb1871fce9f85c9`; merge baseline `d0ad63d`. This is a separate local integration candidate, not a push, parent-branch update, deployment, or accepted release. Original backend verification remains unchanged.

- **Engineering:** actual GeneralWorker + API + PostgreSQL + normal continuous controlled consumer exercised from the browser. Typed CSV/table/file and import-free Wasm tools are integrated into conversations without delegated assignments.
- **UI:** implemented and locally browser-verified at desktop, 390px, and 320px. Separate Claude/parent acceptance remains pending.
- **General usefulness:** **UNVERIFIED**. Explicit operator selection and synthetic fixture attachments are controlled inputs, not evidence of autonomous model reasoning. No model/provider calls are made by these paths.

## Implemented UI boundary

Conversation operation composer explicitly chooses CSV reconcile or Wasm, reads bounded UTF-8 local attachments, and submits typed operations to the same conversation API. It never calls kernels itself. New-conversation creation remains create-then-post with retained command identity. Existing general prompt/continue/cancel and truthful paused unsupported delegation remain intact.

Conversation product links open typed table/file/tool pages, not the legacy document editor. Human saves, exact-base re-runs and proposal acceptance reuse existing commands/CAS/revision authority. Drafts survive reloads; failed stale saves retain the human draft and cannot overwrite the newer saved revision. Saved history and originals remain available.

Execution labels require authoritative immutable observation readback, current scope, exact workspace/conversation/artifact identity, body hash and revision binding. Human saves do not inherit verification. Pending proposals and historical observations are explicitly labelled, never upgraded to current verified execution. Provenance details retain controlled transport and no-provider distinctions. Conversation list previews/update times and explicit turn states/reasons come from the service, including unavailable/failed rather than unexplained queued spinners.

Downloads require the same-origin UI header boundary; the proxy preserves safe MIME, attachment name and exact digest, refuses unsafe metadata, and uses `nosniff`. No path-based file access or external fetch/upload is introduced.

## Executed gates

- Fresh integration PostgreSQL backend suite: **372 passed**, one Starlette deprecation warning, **592.16s**. Log: `/home/ubuntu/.hermes/cache/scratch/general-integration-reviewed.log`. Includes B1/legacy, additive upgrade, restart/replay, revocation, conflict, malicious tool input and immutable observations.
- `pnpm --dir web check`: TypeScript, ESLint, formatting and **73 tests passed** across 12 files.
- `pnpm --dir web build`: production build passed.
- `npm run check --prefix contracts`: canonical Python JSON, generated TypeScript drift and typecheck passed.
- Existing mock-mode Playwright regressions: **15 passed** across desktop/mobile/narrow. Explicit mock build required: `NEXT_PUBLIC_WORKAGENT_API_BASE=/api/mock pnpm --dir web build`, then the same environment prefix on `pnpm --dir web test:e2e`. Initial run against the real-mode build timed out at the intentionally disabled mock endpoint; rerun with correct explicit mode passed. Rebuilt real mode afterward; no fallback enabled.
- Real-mode browser journey: `node web/scripts/products-journey.mjs .local/integration-evidence/products-reviewed` passed against normal `scripts/workagent.py serve --env .local/integration-browser.env --skip-setup`. The backend's optional hash-pinned Wasmtime 49.0.0 dependency must be installed, as documented in GENERAL_PRODUCTS_VERIFICATION.md.
- Terminated and restarted normal serve; fresh browser reopened the saved tool return **4250**, verified binding and human cents note, and table latest human note with correctly historical verification. Readback record: `.local/integration-evidence/products-reviewed/restart.json`.

## Actual real-mode run IDs

Evidence JSON: `.local/integration-evidence/products-reviewed/result.json` (local ignored evidence, synthetic fixtures only).

- CSV conversation `1cbfc0d9-bdaa-4dcf-819c-9e653dd2bb92`.
  - Initial CSV `d6a80d0f-42f8-4b2a-89d8-7435602a35db`: reported **78.40**, calculated **77.40**; row B reported **38.50**, corrected calculation **37.50**.
  - Changed rounding `9a606e03-0881-4c8f-804c-69408f6d7441`: exact proposal accepted with saved row and top-level human notes preserved; downloaded `reconciled.csv` contains corrected value and row note. This fixture's totals do not change under HALF_EVEN.
- Tool conversation `202593a2-d8c7-4d3a-8a27-c7757c9ce527`.
  - Initial tool `bfe5ec8a-b17c-4b6f-b4c8-0a430b346b56`: actual return **3750**.
  - Shipping requirement `080dd234-3842-407d-860f-7a298102281d`: changed saved WAT/form inputs `[3,1250,500]`, actual return **4250**; exact proposal accepted and human note preserved; WAT download byte-equal to shipping fixture.
- Malicious host import `71fbed8f-2b4f-4540-84dd-653a8fda2764`: canonical partial run projects to **failed**, explicit `imports forbidden`, no product link or fabricated successful output.

The journey also verifies two-context stale CAS rejection, draft persistence, no delegated assignments, and no page errors. Eight screenshots in the evidence directory cover human saves, recalculation, shipping, fully loaded mobile/narrow views, and rejection. Initial mobile evidence captured a loading screen; adding loaded-state assertions exposed a long-button overflow at 320px, fixed by wrapping product buttons. Final screenshots and no-overflow assertions use fully loaded product pages.

## Independent review corrections and regression evidence

Two independent reviews identified loss of exact Wasm i64 values in JavaScript and loss of pending admission identity on reload; one additionally identified file-read races and latest-proposal verification masking. Corrected before committing:

- **Contract change for UI:** `ObservationReadback.observation.output.value` for `run_wasm` is an exact decimal **string** in JSON. Display verbatim, never `Number(value)`. Python kernel/internal/stored observations retain integer values; only readback serialization adapts. Historical Body bytes, observation rows, accepted profiles and migrations are unchanged. JSON/OpenAPI/TypeScript regenerated; both signed i64 limits tested.
- Pending composer payload, command/request identity and captured work version persist in workspace/conversation-scoped session storage before admission. Reloaded ambiguous commands remain locked to the same payload. Generation guards invalidate older attachment completions and block submission while reading.
- Current saved verification is resolved independently from latest pending output; each shows its own binding. History/proposals exhaust pagination; revision history sorts explicitly. Initial read errors show unavailable with retry; discarding draft resets unapplied tool-input text.
- `node web/scripts/products-review-regressions.mjs`: **6 focused DOM regressions passed** with explicitly mocked fixture transport (not evidence of real execution).
- `node web/scripts/products-readback-journey.mjs .local/integration-evidence/readback-reviewed`: **real API/worker/PostgreSQL passed**. The script admits an operation, deliberately drops its HTTP acknowledgement, reloads the browser, then retries byte-identically. No duplicate operation run/product occurs. Actual Wasm return **9007199254740993** is displayed exactly. Re-running the unchanged saved tool creates a proposal while preserving current saved verification; both observations are shown separately.
  - Conversation `b9f0be77-6c73-4d13-8957-af6fbf2cee79`.
  - Original/replayed admission run `e2f63724-1b90-4304-ab23-eda12b1bcc6e`.
  - Pending proposal run `cfdb589e-228a-42ae-bef3-bac68d93b6f5`.
  - Evidence `.local/integration-evidence/readback-reviewed/readback.json` and `saved-and-proposed-exact-i64.png`.
- Post-fix process restart also reopens exact large-i64 current/pending observations; `products-reviewed/restart.json` records this alongside shipping and saved table notes.
- Post-fix mock Playwright run wrote only `.local/integration-evidence/mock-reviewed` via `WORKAGENT_EVIDENCE_DIR`; old handoff evidence is not part of the diff.

## Final retry-race correction

Post-fix re-review reproduced an additional stale-completion race: an original A response arriving after navigation/retry and admission of a newer ambiguous B could unconditionally clear B's journal. Cleanup now synchronously compares the exact stored attempt before removing it, for both success and definitive errors. Unit coverage and both held-response DOM scenarios pass. Final frontend checks: **74 tests** and **8 focused DOM regressions**, typecheck/lint/format/build/contracts passed. Backend is unchanged from the **372-pass** run above; mock regressions are unchanged from the **15-pass** run above.

Both actual browser journeys were rerun after this last correction:

- `.local/integration-evidence/products-candidate/result.json`: CSV initial `4b291081-cc30-441c-8945-d71d3a2c3646`, changed rounding `4cd2fda6-1af6-4e2a-b925-433084152a89`; tool initial `76409f8e-be2c-454f-ad5e-ad375cb1ada4`, shipping **4250** run `d0c01681-20d1-457d-be58-12b95faa7fc6`; rejected imports `e7f28f0d-eb04-44c8-91d3-5ad06735c371`.
- `.local/integration-evidence/readback-candidate/readback.json`: exact **9007199254740993** with dropped-response/reload/byte-identical retry run `674187fb-e667-4335-a57e-488243a3db34`, unchanged saved-revision rerun/pending proposal `67ba414c-18ad-4133-890b-f6b19503eaf8`.

## Reproduction and remaining gates

Provision a fresh disposable PostgreSQL environment via `backend/dev_db.py`, migrate/seed through the normal launcher, install the existing optional local-tools lockfile into the backend venv, build real-mode web, and run normal serve. Run `web/scripts/products-journey.mjs` with an output directory (optional `WORKAGENT_WEB_ORIGIN`, default loopback port 3000). It uses the normal seeded `local-workspace` and creates new conversations on every run; it does not manually tick a worker.

Independent re-review accepted the i64/readback, saved-verification, pagination, draft-reset and unavailable fixes; final targeted review found **no blockers** in conditional journal cleanup and independently passed **6 focused unit tests** and **8 fixture Chromium regressions**. The backend's reproducible CLI IDs/commands remain in GENERAL_PRODUCTS_VERIFICATION.md. Parent/Claude acceptance remains a separate gate; no claim of autonomous usefulness, live-provider validation, or deployment is made here.
