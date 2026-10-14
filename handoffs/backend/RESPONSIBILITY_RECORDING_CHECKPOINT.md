# Responsibility-recording checkpoint — handoff to existing Claude Cloud owner

## Identity, evidence and boundary

Published backend checkpoint: `367279b2f4cb9c782082f692e31a0aa3f09f36a7` on
`hermes/responsibility-recording-checkpoint`. Remote commit/tree readback matches
the independently verified tree below. This is not deployment or frontend
acceptance. Existing Claude Cloud owns `web/`; Hermes owns integration/runtime and
generated contracts. Do not replace the frontend owner or invent a parallel UI.
Andrew explicitly authorized: “Yes — publish a development checkpoint and Claude
handoff; no merge or deployment”. Original candidate/index and review evidence
are preserved; the publication branch is separate.
Production code and SQL001–024 are preserved, including all historical migrations.

| Checkpoint | Exact identity and evidence scope |
| --- | --- |
| Parent-verified backend | Tree `81243ea9a03375f815c04559ae469ccac3a5491e` over HEAD `571d0d13df5062dc8f29d795252e2489f24537bc`; published as `367279b2f4cb9c782082f692e31a0aa3f09f36a7`. Full suite 1116 passed, zero errors/skips; independent R1–R6 PASS, 129 tests; independent PASS for three authorized test-only fixture corrections |
| Earlier backend runs | 1113 passed / 2 failed, then 1114 passed / 1 failed; retained historical failures, not relabelled PASS |
| Existing frontend owner | `90ba73bd497d63cfc558855f2156c309dc00a0e2`; separately passed 224 unit tests, 36 DOM cases, three real UI/API/PostgreSQL send-hold cases, production webpack build, typecheck, lint and format |
| Combined local candidate | `/home/ubuntu/workagent-alpha-qa-integration`, initial index tree `703f9a36e1d60b0290a2d064740bc4a6f639b376`, before these unstaged docs; combines exact backend and Claude web/frontend-handoff bytes. Combined gates and independent integrated verdict pending |

Parent's read-only evidence is
`/home/ubuntu/workagent-alpha-responsibility-integrated/.local/responsibility-complete-final-review.json`
and `three-fixture-correction-status.md` in that `.local/` directory. The backend
counts above are carried from that parent-verified checkpoint, not a claim that
the documentation writer reran the full suite. Frontend evidence remains in
[Claude's existing handoff](https://github.com/alindebergASL/Workagent/blob/90ba73bd497d63cfc558855f2156c309dc00a0e2/handoffs/frontend/GENERAL_ALPHA_FRONTEND.md). Its older
`record_responsibility` backend-gap statement is superseded for this exact backend
tree, not evidence that frontend recording-result wiring has already landed.

Separate component PASS is not integrated PASS. HEAD alone cannot identify an
uncommitted tested candidate. Keep exact tree, test scope, failures, controlled
transport and live-provider evidence distinct.

## Documentation verification (not product QA)

The documentation writer ran the existing
`backend/tests/test_alpha_contract_scope.py` and
`backend/tests/test_adaptive_ui_contract_scope.py`: **15 passed in 0.07s**.
Command: `backend/.venv/bin/python -B -m pytest -q -p no:cacheprovider` followed
by those two paths. The subprocess received only PATH, HOME, LANG,
`PYTHONDONTWRITEBYTECODE=1` and `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`; no provider
credentials, database URL or inherited runtime settings. No bytecode/cache output
was requested. `git diff --check` also passed for the unstaged docs.

These existing guards check documentary wording/direction, including preserved
historical bounds. They do not validate the new $40 runtime accounting, prove
live behavior or replace the pending combined/product QA gate. Tests and all
backend/web/contracts source were left unchanged by this documentation pass.

## Generated contract to consume, not re-create

Public read DTOs come from `contracts/openapi.json` and
`contracts/src/schema.d.ts` (`components["schemas"]`):

- `ResponsibilityMutationResult`: `kind: "record_responsibility"`, `version: "1"`,
  `assignment_id`, `conversation_id`, `owner_id`, positive `work_version`,
  `state: "active" | "waiting_person" | "waiting_event" | "blocked"`,
  `outcome_status: "unverified"`, `execution_status: "not_admitted"`.
- `TurnState.responsibility_recording?: ResponsibilityMutationResult | null` is
  the durable recording readback on a conversation turn. It is distinct from
  `TurnState.responsibility_origin`, which identifies a runtime wake request.
- `AlphaStep.mutation_result?: ResponsibilityMutationResult | null` retains the
  local action result in `AlphaExecution.steps`. Continue handling
  `AlphaExecution | AdaptiveExecution`, not an invented common response shape.
- `ResponsibilityDetail` contains `assignment`, `lifecycle`,
  `provider_execution_queued` and `local_review_eligible` for current readback.
  `ResponsibilityLifecycle` and `ControlResponsibility` remain the canonical
  generated state/control contracts. Use the current assignment's `work_version`
  for steering, not the older recording receipt's version.

The model-side decision contract is separate:
`contracts/alpha-decision.schema.json`, `contracts/src/alpha-decision.d.ts`,
`contracts/alpha-types.mjs`, and `contracts/alpha-capability-catalog.json`.
`RecordResponsibility` has `kind: "record_responsibility"`, `goal`,
`completion_criteria` and `plan: RecordingPlan`. `RecordingPlan` carries
`current_outcome`, `dependencies`, `next_action`, `next_check_in_at` and `wait`.
This is a model-selected, receipt-bound local worker action, **not a new browser
write endpoint**. Do not send model decisions as frontend commands or fabricate
typed receipts from prose. Python exports remain the contract source of truth;
frontend aliases must consume generated types rather than fork the DTO.

## Canonical readback and meaning

1. Obtain a typed `TurnState.responsibility_recording` from the actual conversation
   response. It identifies a recorded effect, not merely an intention. Validate
   the linked conversation/assignment through authorized reads; do not infer an
   assignment ID, owner or recording success from answer text.
2. Link to the existing `/assignments/{assignment_id}` work surface. Read
   `GET /v1/workspaces/{workspace_id}/assignments/{assignment_id}/responsibility`
   using the existing authenticated client. The result is `ResponsibilityDetail`.
   Its Assignment/lifecycle is authoritative current state. The recording receipt
   is a historical snapshot and can coexist with a later pause or take-back.
3. Keep loading, explicit absence, denied, stale and unknown reads distinct. Only
   the existing explicit `unsupported_operation` handling establishes absence;
   transport/access failures do not prove that nobody owns the work. Reuse the
   existing freshness/re-read behavior, not a competing state store.
4. Keep controls on the existing
   `POST /v1/workspaces/{workspace_id}/assignments/{assignment_id}/responsibility/control`
   with generated `ControlResponsibility`, current CAS version, confirmation and
   same-command recovery. A failed readback after acknowledgement remains “not
   re-read yet”; an uncertain command is not replaced, rebased or auto-regenerated.

`owner_id` identifies the authorized principal on the record; it is not a model
identity. `active` is lifecycle state, not proof of running. The initial receipt
is deliberately `not_admitted` and `unverified`. Current queued/running/settled/
blocked execution is read separately from the lifecycle; readiness review/wake
is not execution. Do not call a settled run accepted or the overall goal done.

The worker records the Assignment, lifecycle and effect journal through its
fenced transaction and immutable receipt binding. It does not monitor external
inboxes, make bookings, send business messages, grant future paid execution or
accept a proposal. Model explanation is retained prose, not verification.
A displayed check-in time is not proof that an external monitor exists.

## Existing-owner integration request and acceptance checks

Inspection of the combined candidate's `web/src` found no explicit
`responsibility_recording`, `mutation_result` or `ResponsibilityMutationResult`
consumer. Assignment links and the existing responsibility hook/panel are present;
that alone does not prove the new turn receipt is mapped or surfaced. Treat this
as an open integration seam, not a request to redo existing rendering or a claim
that the UI already passes the new journey.

- Consume the generated receipt in the existing conversation/companion mapping
  and show a record-backed link/status where useful. Preserve answer-first
  rendering and retained explanation; no “I own it” inference from model prose.
- Reuse current Assignment/responsibility UI for fresh lifecycle readback and
  steering. Do not add browser activation/update controls merely because the
  model action exists. Preserve runtime/system attribution and run anchors.
- Cover missing receipt, real receipt, later pause/take-back, denied/stale reads,
  failed final explanation after a saved effect, reopen/restart, lost control
  acknowledgement and exact CAS conflict. Assert actual read identities and
  zero duplicate mutations, not just a label or mocked screenshot.
- Preserve Claude's stale/revoked/ended send holds, deliberate unlinked reply,
  exact-target handling and attachment descriptor/byte parity. Files, drafts and
  human revisions survive recovery; reconnecting must not silently send.
- Integrator-owned harness gap: Claude reports
  `scripts/verify_product_companion.mjs` still clicks “Send” on a build without
  exact targets; the deliberate action is now “Send without linking this version”.
  Verify/fix through the appropriate owner separately. This docs-only pass does
  not change that script or claim its combined journey passes.

Run exact combined unit/type/lint/format/build/contract checks and real
UI/API/PostgreSQL journeys on isolated state before any integration PASS.
The new receipt-to-current-record journey needs desktop/phone, keyboard and
screen-reader review, not just backend acceptance. Existing frontend fixtures
and separately checked source SHAs cannot substitute for this combined gate.

### Confirmed integration findings and minimal owner patch

The preparatory seam audit ran typecheck and 75 focused tests across seven files;
all passed. These tests do not cover the missing integration below. No provider
calls or browser journey were performed by that audit.

1. **Receipt loss:** `web/src/lib/contract/natural.ts` drops
   `TurnState.responsibility_recording`; `components/TurnProgress.tsx` ignores
   `AlphaStep.mutation_result`. Preserve generated types and surface a compact
   historical recording link even if the final explanation fails or never arrives.
   Share it between the full thread and `ConversationPeek`; deduplicate by actual
   assignment ID rather than counting repeated steps as separate responsibilities.
2. **False calculation/persistence copy:** `TurnProgress.tsx` calls every observed
   unpublished selection a calculated result that is not saved. A recording-only
   turn has null product output but a saved Assignment. Discriminate mutation from
   actual product output in that component and `lib/adaptive-presentation.ts`.
   Keep useful response text first, with the local-only/unverified boundary visible;
   a later verified calculation cannot mark an ongoing responsibility complete.
3. **Home/Space lifecycle:** reuse/extract the canonical read helper from
   `lib/client/responsibility.ts`; enrich `real-api.ts`, `assignment-summary.ts`
   and shared view types with current lifecycle plus explicit freshness/availability.
   Adapt `work-state.ts`, `WorkRow.tsx` and Home/Space projections. Coarse Assignment
   `paused` does not mean the canonical lifecycle is paused. Keep the similarly
   named Assignment run-outcome projection separate. Bound/consolidate reads,
   retain abort/workspace scoping, and distinguish denied/stale from known absence.
   Never turn active into running, settled into achieved, or stopped into handling.
4. **Detail truth:** in `app/assignments/[id]/page.tsx`, current
   `ResponsibilityDetail.assignment` supplies the current goal/criteria/version.
   Do not let an older summary mask a human edit. Scope empty-state wording to
   absent documents/files; the responsibility itself is saved. Remove guesses
   about controlled/live provenance merely because `Assignment.run_ids` is empty.
   Keep controls on current readback/CAS and explicitly show unverified outcome.
5. **Discoverable links:** conversation links currently all say “Recorded hand-over”.
   Use authorized current goal-specific names with the shared projection and an
   originating-turn receipt link. Do not fabricate an artifact to make work visible.

Required tests: exact receipt/step preservation and missing receipt; recording-only
and mixed output; failed/cancelled/unknown final explanation; later human goal edits,
pause/cancel/take-back with immutable historical receipt; Home/Space lifecycle versus
coarse paused state; stale/denied/absent reads; two obligations and workspace isolation;
exact uncertain-command recovery. Reuse existing deterministic fault tests for
mechanics, then run real UI/API/PostgreSQL receipt-to-work journeys. Follow with
live behavior QA under the separate gate, not scripted answers renamed as agency.
Include desktop/390/320px, meaningful link names, keyboard focus, readable uncertainty,
no duplicate accessible IDs or uncontained overflow. No new endpoints, parallel
store, budget dashboard, provider admission or relaxed verification rules are needed.

## QA, product breadth and spending gate

Approved order: package/reconcile checkpoint → integrate existing Claude frontend
→ **rigorous QA BEFORE step 3, the user demonstration**. Fan out genuinely distinct
models and multiple personas; record actual identities and independent findings.
Cover UX needs, visual quality, accessibility, model/agent responses, continuity,
authority and recovery. Keep engineering, usefulness and experience verdicts
separate. At this handoff, combined engineering and the new multi-model/persona
usefulness/experience gate remain NOT TESTED. Andrew's acceptance is not inferred.

Issue #15 and the adaptive, intelligent UI addition remain governing. Recording
one responsibility does not deliver the full general-work mission, autonomous
external monitoring, broad specialist coordination or every adaptive UI capability.
See [acceptance](../../docs/PRODUCT_ACCEPTANCE.md) and
[plan](../../docs/BUILD_PLAN.md) for the required gate and remaining breadth.

### No pre-canned behavior evidence

Latest user clarification (verbatim):

> Ok yes, we aren’t proving anything when it is pre canned

Scripted provider replies or preselected action sequences prove mechanics only;
they CANNOT pass agency, usefulness or response-quality gates. Rigorous behavior
QA must use actual live model decisions on varied, partly held-out natural-language
requests, unexpected follow-ups and observed failures. No seeded answers, supplied
repair instructions, operator result repair, selective replacement calls or
production task-name branches. Keep evaluation criteria and independent oracles
outside model context. Realistic synthetic input data is permitted for privacy;
synthetic data is not canned model behavior. Report failed/partial cases honestly
and preserve the full attempt and accounting history, not just successful examples.
Live behavior evidence still requires reconciled and enforced runtime authority;
if blocked, report NOT TESTED rather than substituting scripted responses.

Latest approval (verbatim):

> Also I grant you $20 more in budget, use and test the model unrestrained!

This is **NEW +$20**, **$40 total authorization ceiling**, not a reset/refund of
past reservations or unknown liabilities. It provides broad scenario discretion
within finite scope. Additional runtime budget is approved, not activated by
this file. Actual ledger/route/account/pricing reconciliation and enforced
accounting are pending; `AlphaExecution.shared_cost_limit_usd` still declares
literal `20.00`. No runtime/profile/SQL bound is changed here. Earlier alpha
attempts must be accounted for; historical “not installed” wording is not proof
of zero earlier use. No independent child spend, unsafe retries, external business
effects, broader private-data access, default merge or deployment. See
[authorization](../../docs/GENERAL_MODEL_AUTHORIZATION.md).
