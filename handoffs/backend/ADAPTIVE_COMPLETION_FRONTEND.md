# Claude frontend handoff — bounded completion and continuous work

Owner remains the existing Claude frontend lane. Its integrated changes are
preserved. `claude auth status` reported `loggedIn:false` on October 8; the minimum
restoration is **`claude auth login`** on this host. No password/API key in chat;
no substitute paid Claude route. Hermes continues runtime/backend and compatibility
work rather than wait for that access.

## Exact source of truth

Current candidate: PR #12 / `hermes/adaptive-product-integration`; PR #9 points
here. `contracts/openapi.json` and `contracts/src/schema.d.ts` are generated from
Python. Run `npm run generate && npm run check` in contracts; never hand-edit DTOs.
Final hashes/tested SHA and live/fixture verdicts belong in the milestone evidence
checkpoint once executed. This handoff is a contract, not a claim of browser PASS.

Additive read field: `VerificationObservation.automatic`, nullable for historical
observations. It contains versioned checker/scope, recognized/passed,
request/source/base/operation/staged bindings, row/input coverage, failure classes
and limitations. `basis=independent_bounded`, `satisfied=true` and
`requested_goal_status=satisfied` require trusted verification; model checks and
optional supplied checks remain distinct. Missing fields on historical receipts
must remain conservative, not inferred success.

The independently checked request is deliberately bounded. Unsupported wording,
extra obligations or unverifiable output stays `needs_validation`/partial. The
runtime owns that decision; do not infer it from prose, a ready tool, examples,
number of phases, or provider receipt success.

## Minimal compatibility changes by Hermes

- `adaptive-presentation.ts`: show “Requested result verified” only for completed,
  received, published, exact-operation-bound independent proof. Scope/coverage
  remains visible; later edits are not covered. Recognized failed independent
  checks can explain a subsequent changed operation.
- `TurnProgress.tsx`: checker limitations appear inside optional “How this ran”,
  not as a new ordinary-screen control panel.
- Product proposal: separate “Download proposed file” read action. It uses the
  exact `proposal_id` query, never saved `revision_id`, checks the returned digest,
  and does not accept the proposal. “Apply proposed version” remains the only
  explicit replacement decision. Saved-file downloads are unchanged.
- Existing code folding, rich text/link restrictions, proposed input binding,
  editable saved values, mobile pane drafts and general work breadth stay intact.

## Experience acceptance for Claude when authenticated

1. Ask an ordinary supported bounded task without test specs or operation payloads.
   Continuous workers should advance it while the page polls canonical state.
2. Read useful outcome and checked scope first; technical traces remain optional.
   Unsupported goals must not show verified completion.
3. Inspect the proposed output with its own inputs, download it without accepting,
   and confirm saved values/notes still belong to the current revision.
4. During a genuine unfinished turn, interrupt the worker, retain a human edit,
   restart and read accurate continuation. Check both saved-edit preservation and
   unsaved desktop/phone draft continuity; separately test stale-base refusal.
5. Inspect wrong-but-executable output, rejected operations, provider ambiguity,
   unavailable workers and budget/authority stops. Never label these as completed.

Do not redesign the approved visual direction or introduce topology/lease/profile
management as ordinary user work. Memory/learning #10 and portability #11 follow
this adaptive slice, not prerequisites. No default merge or deployment authority
is included.
