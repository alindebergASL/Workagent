# General-alpha generated wire delta for the existing Claude owner

The integration branch now contains runtime `0d2ebfe`, lifecycle `f41ddfe` and your `7bee1d1`. Parent wired the actual Service MRO and HTTP adapter and regenerated canonical OpenAPI/TypeScript. Parent's fresh combined-017+018 PostgreSQL gate passed **75 tests** (runtime alpha, lifecycle, actual HTTP, conversations and domain). No live provider calls or grant installation. This is implementation/controlled engineering evidence, not broad usefulness or final acceptance.

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

**Known compile integration:** parent `tsc --noEmit` currently reports five `TS2345` calls in `test/adaptive-presentation.test.ts` because `AlphaStep.outcome=answered` is not accepted by the old adaptive-step helper signature. Update the helper/test types using the generated union; do not cast away the new state or relabel it completed/verified. Parent did not edit `web/`.

## Canonical responsibility HTTP — available now, not autonomous execution yet

All routes use the existing authenticated local principal, workspace, command/schema/request envelopes, typed errors and owner/CAS checks. Paths start `/v1/workspaces/{workspace_id}/assignments/{assignment_id}`:

- `POST /responsibility`: `ActivateResponsibility` → `ResponsibilityDetail` (201).
- `POST /responsibility/update`: `UpdateResponsibility` → `ResponsibilityDetail`.
- `POST /responsibility/control`: `ControlResponsibility` → `ResponsibilityDetail`.
- `GET /responsibility`: `ResponsibilityDetail` (same GET metadata headers).

**Update is POST**, following existing command middleware; the earlier child handoff's suggested PUT is not the generated API.

Activation applies to an existing explicitly delegated assignment, never creates a duplicate task/ownership store. Plan fields: `expected_work_version`, `current_outcome`, `next_action {kind,description}`, exact `dependencies`, optional `wait`, optional `next_check_in_at`. Controls: `pause | resume | cancel | takeover` with current version. Use generated DTOs, not this prose as an alternative schema.

Response includes canonical `assignment`, explicit `lifecycle` and `local_review_eligible`. Material saved-work events now update the same responsibility through the real production Service. The lifecycle distinguishes active/waiting/blocked/paused/cancelled/taken-over, exact observations, review/check-in status and blockers. Provider execution is **not yet connected**: current literals remain `provider_execution_queued:false` and `execution_status:not_admitted`. A queued readiness review is not ongoing model execution. Do not remove the paused/unadmitted disclosure or promise takeover based only on these fields. Parent is implementing the canonical admission/worker/cancellation bridge and will regenerate its additional origin/execution projection.

## Next owner action

Wire the answer/read-provenance fields and `answered` state now; test substantive direct/work/historical responses and metadata independently. Wire only truthful current lifecycle read/control behavior; no invented running state or UI timer. Preserve source/budget/privacy boundaries, legacy examples, human edits and mobile drafts. Commit on the existing Claude owner branch and report exact SHA and checks. No model calls/default merge/deploy. The approved evaluation remains parent-controlled and blocked pending tighter budget enforcement, integration, review and fresh route/pricing checks.
