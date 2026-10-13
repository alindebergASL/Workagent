# General-alpha generated wire delta for the existing Claude owner

This backend-only checkpoint contains reviewed continuation source `5a296c39b31a91fc25090d93732a2d90dc0b3b0b` (including runtime/lifecycle, budget019, continuation020 and fixes021/022), plus reviewed adaptive-interaction direction `01fbee4`. Canonical OpenAPI/TypeScript is regenerated from those exact models. Parent independently passed **249 tests** on fresh restricted PostgreSQL SQL001–022; independent backend re-review passed **49 focused cases** and closed all three continuation P2s. These are separate runs, not an aggregated count. Earlier 75/201/268-test checkpoints retain their historical scope.

No live provider calls or evaluation-grant activation. This is controlled backend engineering evidence, not live usefulness, frontend acceptance or release approval. This backend branch intentionally does not incorporate Claude's newest web changes; consume its canonical contracts on the existing frontend owner branch, rather than treating its older web baseline as a tested frontend release.

## Answers and optional capabilities — available now

Generated `TurnState.adaptive` is `AlphaExecution | AdaptiveExecution | null`. Alpha carries `runtime_extension: general-alpha-v1`, adds `outcome: answered`, and each `AlphaStep` may contain typed capability-result metadata. Guidance/discovery/read handlers are real journaled selection steps, not permissions. Details may show chosen skill id/version/hash and unavailable capabilities; do not force a skill/workflow screen.

Generated `TurnState.explanation: ExplanationReadback | null` exposes only retained, schema-validated final model prose:
- `text`: full retained final explanation (up to 12000 characters).
- `attempt_id`, `phase: final`.
- `authority: model_explanation_not_verification`.
- `published`: an assistant publication for this attempt exists, NOT a promise that historical `message.text` used this prose verbatim.

For new alpha **direct answers**, canonical `message.text` is the exact selected answer, `adaptive.outcome` is `answered`, and the run is ready/replied. That is response completion, not independent verification or external-objective achievement. Do not replace that selected answer with a secondary explanation merely because the latter exists.

For new alpha **work results**, publication retains the final explanation plus a trusted execution-status suffix. The explicit `explanation` projection permits result-first prose with separately rendered recorded status rather than parsing/hiding a warning heuristically. The full prose remains available if public message length required an explicitly marked shortening.

For **historical runs**, the projection recovers retained prose without rewriting immutable messages/receipts. Label it as retained model explanation, keep the recorded message/status inspectable, and do not imply that later human revisions are that model's proposed version. Your earlier-version links/author labels remain required.

**Frontend status:** Claude `55e2924` fixed the earlier alpha helper/test union errors; `f6ce09b` adds the contract-independent F2–F5 corrections. Those changes remain frontend-owned. The generated continuation contract below now unblocks F1 and the remaining F2 execution-state wiring. Do not cast away new states or relabel them completed/verified. The frontend review hold remains until corrections are integrated and independently verified.

## Canonical responsibility HTTP and continuation — controlled execution demonstrated

All routes use the existing authenticated local principal, workspace, command/schema/request envelopes, typed errors and owner/CAS checks. Paths start `/v1/workspaces/{workspace_id}/assignments/{assignment_id}`:

- `POST /responsibility`: `ActivateResponsibility` → `ResponsibilityDetail` (201).
- `POST /responsibility/update`: `UpdateResponsibility` → `ResponsibilityDetail`.
- `POST /responsibility/control`: `ControlResponsibility` → `ResponsibilityDetail`.
- `GET /responsibility`: `ResponsibilityDetail` (same GET metadata headers).

**Update is POST**, following existing command middleware; the earlier child handoff's suggested PUT is not the generated API.

Activation applies to an existing explicitly delegated assignment, never creates a duplicate task/ownership store. Plan fields: `expected_work_version`, `current_outcome`, `next_action {kind,description}`, exact `dependencies`, optional `wait`, optional `next_check_in_at`. Controls: `pause | resume | cancel | takeover` with current version. Use generated DTOs, not this prose as an alternative schema.

Response includes canonical `assignment`, explicit `lifecycle` and `local_review_eligible`. Material saved-work events update the same responsibility through the real production Service. The lifecycle distinguishes active/waiting/blocked/paused/cancelled/taken-over, exact observations, review/check-in status and blockers.

The normal ResponsesDispatcher now admits eligible wakes through the same canonical worker only with an active exact-scoped alpha grant and current authority. Controlled tests exercise actual continuation, cancellation/dependency fences and restart/replay. Natural-language auto-delegation and selected-private-source conversation execution are not demonstrated or newly authorized.

Generated changes:
- `ConversationMessage.author_kind`: `human | assistant | system`; `evidence_origin` also permits `runtime`.
- `ConversationMessage.responsibility_origin` and `TurnState.responsibility_origin`: nullable `ResponsibilityOrigin`, with `kind: responsibility_wake`, `assignment_id`, `wake_id`, and `work_version`.
- `ResponsibilityLifecycle.execution_status`: `not_admitted | queued | running | settled | blocked`; nullable `run_id` links the actual bound run.
- `ResponsibilityDetail.provider_execution_queued`: boolean, no longer the constant false.

Preserve origin through DTO/view-model/full-thread/peek rendering. Runtime requests must not become “You” or inherit a different human request as their progress anchor. Use the run/request identity and explicit provenance. Distinguish readiness wakes from admitted execution; queued is not dispatched, settled is not accepted or goal-complete, and blocked alone cannot assert no provider work occurred. Keep the not-admitted disclosure when true, not as an unconditional product claim. A lost acknowledgement or unavailable read remains uncertainty, not absence or verified current state.

SQL022 prevents new cross-conversation request misrouting and fails closed on incompatible stored rows. No historical repair is claimed. Use fresh disposable SQL001–022 resources for combined verification, not an old journal with022 inserted out of order or the protected saved preview.

## Next owner action

Consume this canonical backend/contract checkpoint into the existing Claude owner branch and complete F1 plus the contract-dependent part of F2. Retain and test the F2–F5 fault/recovery corrections from `f6ce09b`; preserve substantive answers, historical human-edit links and mobile drafts. Run source/handler and actual-browser tests for runtime attribution, execution states, denied/stale reads and exact-command retry. Read-only revalidation is allowed; no UI timer may invent execution or issue commands.

The full consolidated findings remain [PR9 comment 6137032304](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6137032304). The temporary patch there is superseded by these canonical files; no hand-edited schemas or shadow types are needed. Parent owns backend/generated contracts/integration; Claude owns web. Report exact commit, executed checks and remaining limits. No model calls, default merge or deployment.

Adaptive interaction strengthens the broad mission as recorded in the four canonical contracts, not a disconnected prototype or excuse to bypass current fixes. The approved evaluation remains parent-controlled and NOT INSTALLED, pending complete integration/review and fresh route/account/pricing/baseline verification. All inherited accounting, unknowns and scope/cost ceilings remain unchanged.
