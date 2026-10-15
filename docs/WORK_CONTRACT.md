# General work contract and migration boundary

## Current delivery state — reconciled Spaces checkpoint

Latest integrated candidate: `70b4d8c`, with frontend fixes required by
[the exact integration review](SPACE_INTEGRATION_REVIEW.md). See
[runtime status](RUNTIME_STATUS.md) for fresh execution and current readiness.

Preserved starting checkpoint: `5854e9f2a1b2778e034ba189aba01c39cae9ccb9`
on `hermes/spaces-continuity-checkpoint`, directly above Claude's `cdea2a0`.
The formerly local 45-file Spaces/TUI implementation is now committed and published;
Claude retains frontend ownership and must integrate/review its inherited web delta.
[Exact reconciliation, evidence and actionable owner handoff](../handoffs/backend/SPACE-DELIVERY.md).

Preserve the complete direction: **general agency + extensible skills/tools +
scoped context/memory + durable continuity + authorized initiative + optional
Spaces + Intelligent UI**. These capabilities must form one useful experience.
Small increments control risk, not product ambition.
Historical reports retain their original scope, failures and verdicts; this
checkpoint does not establish broad product readiness. Preserve the existing #15
research findings. Budget headroom is never independent authority: no default
merge/deployment, external business actions or expanded account/private-data access. GTD and demonstrations are
optional examples, never workflow routing. Completed nanoMuse research and existing
contracts remain useful; no additional vision reset or harness comparison.

The user rejected the Space screenshot's comprehensibility. Controlled engineering
checks do not reverse that verdict. Claude owns coherent, contextual work interaction;
Hermes owns runtime/domain/contracts, integration, actual model testing and evidence.
The next review must show understandable current work, useful next action and
continuity without internal routing choices, while preserving edits and authority.
Different-model/persona review and ordinary-path varied live response testing remain
open. No claim of live Spaces quality, broad ownership or private-alpha readiness.

Read [runtime status](RUNTIME_STATUS.md) and [authorization](GENERAL_MODEL_AUTHORIZATION.md)
for evidence and execution boundaries. $40 is a cumulative authority ceiling;
old liabilities/counters remain. Local activation and one later live turn occurred;
older 'not installed' statements below describe history, not zero usage. No default
merge, production replacement, new paid route or private-data expansion is authorized.
An authenticated isolated review environment is requested; preserve older saved work.

Status: broad target design contract; implemented subsets require exact evidence.
The responsibility-recording subset below exists in the verified backend tree,
not a claim that every target route/state or adaptive UI capability is delivered.
Implement additive migrations and regenerate shared contracts from Python.
`contracts/README.md` remains the guide for actual API generation.

## Verified responsibility-recording seam — local checkpoint

The model-side `RecordResponsibility` decision (`record_responsibility`) records
an Assignment and its canonical lifecycle through the receipt-bound worker path,
not a model-owned store or new public frontend write route. Generated
`ResponsibilityMutationResult` appears on `TurnState.responsibility_recording`
and `AlphaStep.mutation_result`. It records `assignment_id`, `conversation_id`,
`owner_id`, `work_version`, lifecycle state, `outcome_status: unverified` and
`execution_status: not_admitted`; this is a recording receipt, not current-state
or future-execution proof. `owner_id` is the authorized principal, not an inferred
agent identity.

Read current state from
`GET /v1/workspaces/{workspace_id}/assignments/{assignment_id}/responsibility`
(`ResponsibilityDetail`, including `assignment` and `lifecycle`). A turn's receipt
can survive later steering; current state must not be reconstructed from its
snapshot or model prose. Use existing generated controls and CAS/idempotency,
keep failed/denied reads distinct from absence, and preserve uncertain commands.
See the [exact frontend handoff](../handoffs/backend/RESPONSIBILITY_RECORDING_CHECKPOINT.md).

Backend recording is verified separately from combined frontend readback and
broader ownership UX, which remain pending. Recording does not monitor an external
inbox, book or send anything, grant tools, authorize future paid execution,
verify the outcome or accept a proposal. SQL001–024 stays immutable in this pass.

## Common concepts

| Concept | Required behavior | Avoid current intake default |
| --- | --- | --- |
| Conversation | Useful dialogue, optional attachments/scope, no compulsory delegation | Source selection or assignment on each message |
| Responsibility | Durable goal, success conditions, owner, scope, permitted operations, dependencies, next check-in and lifecycle | Saved chat, queued run or draft treated as owned work |
| Work product | Typed editable/inspectable result with version/provenance; real files/data/tools where appropriate | All output restricted to analysis, plan or checklist |
| Capability profile | Supported tools, product shapes and verified operations; explicit unsupported work | Intake profile as global policy |
| Execution grant | Principal, resources, operations, expiry and applicable cost/action limits; bounded or standing | Broad goal as permission; four-call experiment as permanent ceiling |
| Outcome | Goal-specific completion evidence, remaining work, uncertainty and requested judgment | Global `underlying_action_performed=False`; success inferred from prose |
| Decision | Exact change/action, scope, consequences and meaningful alternatives; invalidated by material changes | Vague “Approve” or permission for unrelated future work |
| Event and memory | Scoped events resume work; memory has freshness, provenance, correction and forgetting | Purposeless polling or private memory leaking into shared Spaces |

Lifecycle must represent active, waiting for a person/event, blocked, completed,
failed, paused and cancelled. A run is an attempt; a responsibility can span
multiple runs and human interventions. Artifact editing, proposal acceptance and
external-action authorization are distinct. Completion requires operation-specific
readback. Unknown results stay unknown until reconciled, without duplicate effects.

Calculations expose inputs and formulas; tools expose runnable artifacts and
observed results. Human edits and prior revisions remain recoverable.
Conversation and cards are not the only representation or canonical storage model.

## One runtime loop, one domain authority

The selected harness owns the model/tool loop. Workagent owns responsibilities,
resources, grants, decisions, versions, audit, events and committed effects.
The broker rechecks current authority at execution and commit. The scheduler
wakes the same runtime; it does not become a second agent loop. Model output
cannot write human acceptance records or bypass the broker.

CLI, web and eventual connectors use the same domain operations and worker.
The thin CLI accepts goals, optional permitted context and steering; persists
identifiers; and offers continue, inspect and cancel through that path. It is
not a new direct-provider script. Existing dispatcher/synthetic journey commands
are engineering evidence, not this prompt interface or general-agent proof.

## Adaptive continuation and remaining ownership/coordination

A capability profile bounds one checkpoint; it does not define the general loop.
The historical one-operation profile remains readable. The integrated
`adaptive-local-v1` capability already retains goals, model-proposed checks,
observations and bounded changed actions through GeneralWorker. Passing model
examples or human-supplied examples does not establish arbitrary goal completion.
The current slice adds independently computed, versioned verification only where
the complete bounded request can be checked, and continuous consumers of the
existing durable outbox. See RUNTIME_STATUS for executed evidence, not this target
contract alone.

Required behavior, including still-undelivered specialist/ownership scope:

1. Persist a responsibility's goal, observable success criteria, routine subgoals,
   priorities and dependencies; distinguish proposed outcome changes from routine
   execution. Keep current context and human corrections authoritative.
2. The same runtime selects a permitted next action, checks actual observations
   against success criteria and either continues, replans, requests a material
   decision, waits, stops at a limit or completes with evidence. A fixed sequence
   or extra plan prose is not an adaptive implementation.
3. Delegation binds parent responsibility, scoped context/resources, success
   criteria, dependencies, current revision/fence and the shared grant. A child
   receives no ambient tools or independent budget refill. The coordinator
   inspects and reconciles results; a child summary cannot establish an effect.
4. A failed, stale or conflicting child result cannot silently become completion.
   Cancellation, revocation and material human edits invalidate affected pending
   work. The parent chooses a bounded recovery or brings back the real blocker.
5. Events and restart resume the same responsibility with current context and
   idempotent effects. Useful check-ins name what changed or the decision needed.
   Pause/resume/cancel/takeover are lifecycle behavior, not cosmetic buttons.

Implement these using existing worker/domain/broker/attempt seams, additive
schemas and suitable established components; no competing orchestration stack
or restarted framework investigation. New live evaluation requires an explicit
consolidated grant under the latest mandate; budget headroom alone does not
renew authority. Preserve all historical counters, reservations and liabilities.
Verification records request/source/base/operation/result bindings and scope;
unsupported clauses stay needs-validation. Verification never records human
acceptance. Changes after admission invalidate stale pending work; restart cannot
overwrite them or regenerate an uncertain provider attempt.

## Guidepost semantics: authoritative work, contextual memory

A useful answer may complete a conversational request without an Assignment or
artifact. Response completion, prepared work, approval, delivery and achieved
objectives are distinct; generic validation warnings cannot erase substantive
answers. Keep consequential uncertainty beside the result, details secondary.

Skills are versioned applicability/method/exception/success-check guidance, loaded
when useful; tools have real typed handlers, availability and scope/effect limits.
Record exact selected versions on runs. Neither grants permissions. Reuse the
same journal, broker, domain and work state, including when no skill fits.

Use existing Assignments for continuing responsibility, not a rival task store.
Persist current outcome, next action, dependencies, waits and lifecycle version.
Material events make only relevant work eligible; no-change reads do not notify.
Pause/resume/cancel/takeover and grant loss constrain execution. Durable wake
eligibility is not evidence that provider execution or external delivery happened.
Restart must use current accepted work and human corrections, not stale summaries.

Accepted/current material, drafts, stale attachments and conflicts retain source
authority and audience. Scoped consequence checks must not rewrite everything.
Reject stale proposals and preserve concurrent edits; separable changes require
selective acceptance without bypassing atomic approval. Correction scope stays
work-local, project or personal as instructed, not an automatic global rule.
Bundle consequential questions and expose commitments clearly on takeover.

## Adaptive, intelligent UI

Status: required direction, not implementation evidence. This addition grants
no new permissions, no new live-evaluation budget, and no default merge or deployment authority.
Existing approval, human-edit, source/audience, recovery and accounting boundaries remain in force.

Apply the [product direction](PRODUCT_CONTRACT.md#adaptive-intelligent-ui) through
one authoritative work model and the existing worker/domain/broker, not a new UI
agent or a parallel editable-work store. Skills describe methods; tools expose
real authorized capabilities; presentation components describe how to understand
and interact with their state. These are separately extensible contracts, not a
fixed workflow menu or a requirement that a skill prescribe its own screen.

Hermes and Claude agree typed, versioned presentation descriptions and fallback
behavior before client wiring. Reuse composable, accessible components with
consistent input, focus, validation, loading, error and recovery semantics. The
agent can choose concise text or combine useful representations; a presentation
choice neither creates a capability nor grants permission. Richer custom
experiences are supported where justified, within the existing reviewed rendering
and execution boundaries; arbitrary generated UI is not the only flexible path.

Actionable controls bind real operation handlers and exact canonical work/target
versions. UI and conversation changes use the same authorized commands, replay
identity, reauthorization, proposal/acceptance and stale-write checks. Unknown
outcomes remain unknown; readback must establish effects. Missing or denied
operations are explained, not rendered as misleading working buttons. Runtime
origin and current-versus-proposed/human-edited state remain explicit.

Keep the application shell and navigation familiar while the working area adapts.
Incremental responses must preserve active inputs, focus and orientation. Treat
exploration as temporary when appropriate; retain useful work when continuity
calls for it, without forcing every answer into an artifact or responsibility.
Reopening/resuming uses authoritative saved state and protected drafts rather
than reconstructing a competing truth from the rendered interface.

## Canonical overview and frontend agreement

Home/Spaces must include conversation-owned current products and pending decisions
through an authoritative read projection or documented joins of existing scoped
records. Do not materialize duplicate business state or manufacture assignments.
Expose stable conversation/artifact/proposal identity, exact current revision,
meaningful status and a reopen route. Derive proposal freshness from its actual
base versus current saved revision; stale work cannot appear ready to apply.
Only associate a Space where domain scope actually establishes membership.

Claude owns `web/`; Hermes owns runtime/domain/generated contracts/integration.
Publish exact generated payloads and the read contract before client wiring.
Natural-language admission uses bounded immutable attachments and exact saved
revision targets; preserve command identity, retries, edits and recovery behavior.
The default UI must not require operation names, supplied code or runtime setup.

## Completed adoption spike (historical rationale)

The completed spike used `handoffs/backend/upstream/REPORT.md` and compared a
Hermes adapter with the current Responses path. The decision retains Workagent
runtime/domain authority. Reuse upstream event/steering/recovery patterns only
where they solve observed gaps; never import default tools or permissions around
the broker.

The spike is complete: `handoffs/backend/HARNESS_ADOPTION.md` records the
keep/adopt/reject decision. Retain Workagent authority and the existing runtime;
do not repeat the investigation. Controlled transport proved wiring only.
The latest boundary in `GENERAL_MODEL_AUTHORIZATION.md` controls: NEW +$20 is
approved, $40 total authorization, with actual ledger/route/pricing and enforced
runtime accounting still pending. Prior exhausted grants, carried usage and
unresolved liabilities remain; this documentation neither activates the increment
nor asserts that earlier alpha attempts never happened. Historical profiles stay
readable, not automatically reactivated. No unverified paid route, expanded
private-data access, external business effect, default merge or deployment.

Memory/learning #10 and provider portability #11 are sequenced after the adaptive
slice. Durable work belongs to Workagent; adapters may use provider persistence
without making it canonical memory. Known-ID retrieval and ambiguous-send
liabilities remain distinct; portability cannot imply safe automatic regeneration.

## Historical migration hotspots at 93db754

- `web/src/components/Composer.tsx`: remove mandatory sources and fixed
  plan/checklist completion criteria from general entry; keep an intake route.
- `backend/workagent/models.py` and generated consumers: separate conversations,
  delegated responsibilities, capability-specific products/outcomes. Preserve
  readable historical records and intake semantics through additive migration.
- `responses_worker.py`, `responses_transport.py` and broker: goal-dependent
  authorized tools/iteration; preserve denial, scopes, budgets, fences and
  uncertain-attempt reconciliation. Source subsets must stay within scope.
- `responses_schema.py`: product-specific rendering; stop flattening every result
  into six paragraphs or stacking the whole old body in every revision.
- `responses_synthetic.py`: retain labeled transport scenarios; do not present
  a canned intake response as support for arbitrary goals.
- `agent/v0.1.*`, grants and skills: retain accepted pins and closed experiment.
  New reviewed profiles support broader operations and recurring work.

Agree a minimal schema migration/frontend adapter together. Do not duplicate
“new work” storage and abandon the proven domain. Compatibility is required;
keeping narrow defaults as the new product is not.
