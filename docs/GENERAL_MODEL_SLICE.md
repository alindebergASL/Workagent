# Proposed bounded same-worker model slice

**Status: proposal only. No adapter implementation or new live calls are claimed.** The current hands-on runtime remains frozen at f68efe5c81e4865f9e1547e03b4af7b62c4303a0. Permission alone cannot connect its model path. This proposal follows repository source inspection, not another harness investigation.

## Smallest useful implementation

One opt-in, versioned general Responses capability profile; one model selection → one authorized pure local operation → one model explanation per turn, inside the existing **GeneralWorker / dispatcher / domain**. Four natural-language turns across two synthetic conversations. No autonomous recursive loop, shell, filesystem/network tool, new scheduler, parallel queue, connector or general upload service.

Existing code provides immutable conversation messages, run/outbox admission, leases/fences, scoped product authorization, CSV/Wasm kernels, artifact/proposal/CAS/readback and a proven intake Responses transport/attempt ledger. It does **not** already connect them for general live work:

1. `general_worker.py:39–44` rejects non-ControlledTransport. `dispatcher.py` instantiates that controlled transport. `conversations.py:147–178` selects the product profile only when a human supplies an operation; plain language receives the no-tools conversation profile.
2. `products.py:54–100` gets all arguments from the human's immutable typed operation. Its execution/publish section currently marks ready, emits canned text and ACKs the turn immediately. Passing a model-selected tool name alone cannot supply generated code or permit a result-aware follow-up.
3. `responses_transport.py` forces intake `read_scoped_context` selection then an intake structured result. Its parser/schema and existing provider-attempt authorization are profile-specific. The existing `Broker.call()` does not register CSV/Wasm; their current authority seam is the Products service, not an exposed kernel.
4. `provider_attempts.py:115–159` assumes assignment authority/old profiles. `responses_ledger.py:40–48,86–107` restores intake schemas and hard-codes old limits. SQL migrations006–008 constrain the old two-phase profile and allowance. Those old restrictions must remain intact for their pinned runs.

### A. Operation-independent immutable admission

Add bounded attachment metadata/bytes to immutable conversation messages: server-assigned reference, safe filename/MIME, byte length and computed SHA-256. Use inline storage in the existing message for this small slice, not arbitrary paths or a new storage subsystem. User sends original language plus the synthetic CSV; no operator selection. Freeze the exact permitted target revision/body hash for an existing product. Server binds the opt-in profile/grant; neither client nor model can expand scope.

The normal conversation composer and thin CLI need prompt-plus-attachment admission without the current operator requirement. Product companion sends must carry the exact current artifact/revision target. Claude retains the small frontend wiring change. Existing controlled operation controls remain available and labeled; they are not the live acceptance route.

### B. Closed model decision boundary

Add a strict general decision schema with one action: reply, reconcile_csv or run_wasm. CSV chooses an authorized attachment reference or exact saved target plus rounding; it cannot substitute new CSV text for the uploaded bytes. Wasm may generate bounded WAT, entrypoint, integer arguments and matching field metadata, with an exact target for revision. Reuse current domain limits, including import-free execution and code/input/fuel/memory bounds.

A structured JSON decision is enough; native multi-tool calling is unnecessary. Do not disguise it as the old forced scoped-read tool. Reject extra authority, acceptance, provenance or observation fields. Current registry schemas have defaults/optional fields and cannot simply be copied into strict provider schemas; use closed schemas with explicit nullability and independent domain validation.

### C. Keep product authority and truthful execution

Introduce a trusted model-action admission seam beside the controlled path. Bind the validated decision to its durable provider selection receipt; resolve attachments/targets using server-pinned scope/hash; construct the existing ReconcileCSV/RunWasm operation; check current capability, profile, grant, cancellation and base revision before execution and commit. Do not forge a human operation message or expose kernels directly.

Factor current Products execution into authorize/resolve → pure computation → durable staged tool result → final model explanation → atomic publication. This is needed because current execution terminalizes the turn before a model could consume the result. Reuse existing attempt/material authority for staged computation, not parallel business state. Trusted tool envelopes bind exact code/inputs/base/result; preserve i64 decimal-string readback. The final model supplies commentary, not evidence or acceptance. Domain code binds actual observations/references. Human-edited revisions remain proposals requiring explicit acceptance.

If final generation fails, retain the observed computation and report incomplete work truthfully; no fabricated response, auto-acceptance or hidden generation retry. Distinguish model-selection provenance from local-kernel execution evidence in backend/generated contracts/UI.

### D. Extend existing attempt recovery and budget guards

Add profile-scoped conversation authority, request/schema pinning and cumulative grant caps to the existing Responses attempt/ledger path and additive DB migrations. Retain exact request bytes/hash, count-before-dispatch reservation, late receipt-only retention, fencing and same-ID retrieval. Reuse the existing transport HTTP boundary; adapt request/parser policy rather than add a separate model runtime.

A provider send with unknown outcome must not flow into the current controlled-worker failure hint that suggests a fresh turn. Keep its identity/reservation; retrieve the known response ID, otherwise remain unresolved without resending. Replaying a durably completed run makes zero provider calls. Preserve historical grants, old four-call guards, accepted bundles/profiles and Body serialization unchanged.

## Deterministic gates before a live grant is activated

- Drive ordinary HTTP/CLI prompt admission through the same dispatcher/GeneralWorker, with synthetic provider decisions selecting CSV or generating WAT, no human operator field.
- Verify attachment hash/ref substitution, foreign/stale targets, malformed schemas, injection into attachments, invented observations and acceptance fields are rejected.
- Exercise human edits, cancellation/revocation and base drift between selection, execution, continuation and commit.
- Exercise lost identity/no resend, known-ID recovery, restart after retained tool output, concurrent predispatch winner and post-publication replay with no duplicate artifacts/network.
- Prove cumulative call/token/spend reservations in application **and DB**, including failures/unknown usage and restart. Old pinned-run/fresh-upgrade tests must remain green.
- Verify real product browser flows with deterministic transport: inputs attach naturally, model-selected action is labeled, generated work is editable/exportable, revised work is proposed, human notes survive and pending/failure is honest.

This is a backend/authority/contract change plus a small composer delta—not a configuration toggle. Publish one reviewed candidate before any model-backed run. No fixed development estimate is substituted for these acceptance gates.

## Proposed natural-language usefulness test

Use a new isolated synthetic workspace or two fresh explicitly scoped conversations; **do not mutate the preserved hands-on review examples**. Four turns, with a human-save step between initial work and each revision. Exclude expected answers from model context.

1. **CSV initial:** “Reconcile this invoice CSV. Keep original values and notes; show discrepancies and give me a downloadable result.” Attach only `fixtures/general-work/invoices.csv`, no operation. Model must select reconciliation; actual table/export must show reported78.40, calculated77.40, discrepancyB.
2. **CSV revision:** save a human note and set B's unit price to12.495. Ask: “Recalculate my saved table using round-half-even. Preserve my edits and propose the change.” Model must use the saved base, not the original attachment. Expected B37.48, total77.38 and B difference1.02, with retained edits and an unaccepted proposal. Expectations independently computed with Decimal, not model prose.
3. **Tool initial:** “Build a small local invoice-total calculator with quantity and unit price in cents. Test quantity3 and price1250.” **No WAT attachment or solution fixture.** Model must generate usable WAT and labeled inputs; actual sandbox return3750, editable artifact and portable file.
4. **Shipping revision:** save “Human: keep cents, not dollars.” Ask: “Add shipping as a separate cents input. Test3 items at1250 cents plus500 shipping. Preserve my note and propose the update.” Model must change code/form, not just echo a selected operator. Actual return4250; old code and note recoverable; proposal not automatically accepted.

A run passes usefulness only if action choice, generated work and changed requirement are useful through the actual product. Valid JSON, test-suite success or a plausible explanation alone is insufficient. If the model asks a necessary clarification or fails, record it honestly; no undisclosed operator intervention or replacement calls.

## Concrete proposed route and execution bounds

- **Route/model:** OpenAI Responses API `https://api.openai.com/v1/responses`, `gpt-6.1-sol`, medium reasoning, default service tier. This is the route recorded in INTAKE_ACCEPTANCE.md, not a newly checked entitlement claim. Verify model availability, account binding and authoritative pricing before activation; if unavailable/unverifiable, stop and ask—no fallback model.
- **Scope:** one explicitly bound principal/workspace, two conversations, the four turns above. Synthetic CSV, prompts, human test edits and generated artifacts only. No private sources, broad repository access or external business actions.
- **Generations:** at most8 across the whole grant (selection+explanation per turn), at most8 token-count submissions and80 same-ID retrieval requests. Failed/unknown sends retain their reservation. No automatic generation retries/fallbacks/extra repair turns.
- **Tokens:** at most20,000 input and8,192 output tokens per generation; aggregate160,000 input and65,536 output. Limits enforced before dispatch in application and DB. The tool-call/compute budget is separately bounded to at most one selected local execution per product turn.
- **Spend:** maximum **$2** application reservation ceiling. Historical repository rates imply a worst-case reservation of$1.05536 for these token limits, **not current verified prices or confirmed billing**. Recompute with verified current prices before activation and reduce admissible calls/tokens or stop if the proposed cap cannot be guaranteed conservatively. No silent expansion of the cap.
- **Duration:** expires30minutes after explicit activation; record exact UTC activation/expiry then. No automatic renewal and no reuse of the expired intake grant.
- **Retention:** current Responses transport uses `store:true`; provider-side response storage needs explicit acknowledgment. Exact requests/receipts remain private locally, with only sanitized synthetic outputs/IDs/usage/hashes/readback in published reports. No credentials, raw provider payloads or encrypted reasoning in source/chat/evidence.
- **Effects:** only existing authorized CSV and import-free integer Wasm, no shell/network tools, sending messages, deployment/default merge or automatic proposal acceptance.

## Decision requested—not inferred

1. Approve **only this bounded implementation and deterministic proof**, with no live model calls or spending.
2. Separately approve the above live execution grant and `store:true` handling **after** the implementation candidate is reviewed and the route/pricing/budget gates are verified. This document itself is not authorization, and experience-review approval is not model-test approval.
