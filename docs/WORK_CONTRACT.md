# General work contract and migration boundary

## Current bounded checkpoint and next boundary — 2026-10-08

The bounded adaptive checkpoint is verified at runtime implementation `0e81127`,
with Claude's `ea4e29d` generic-table correction integrated at `65e84c6`.
[Executed evidence and limitations](../handoffs/backend/ADAPTIVE_COMPLETION_CHECKPOINT.md)
separate engineering, usefulness and experience. Continuous workers recovered the
original interrupted run, preserving its response identities, saved human note,
pending approval and cumulative reservations. Run 06 failed in the evidence
harness after recovery, not in application publication; its failed evidence is retained.

[Issue #13](https://github.com/alindebergASL/Workagent/issues/13) remains **OPEN**.
This checkpoint is not flexible work creation or sandboxed HTML delivery.
The next slice is a general structured surface plus an isolated generated
HTML/CSS/scoped-JS view on the same durable work/revision/proposal/action substrate.
The earlier blanket "never generated HTML or script" restriction is superseded;
generated views still receive no ambient credentials, approval authority or
unrestricted API/network access. [Owner contract and next slice](../handoffs/backend/FLEXIBLE_WORK_OWNER_CONTRACT.md)
records the agreed direction, responsibilities, and still-undelivered wire contract.
Memory/learning #10 and portability #11 remain sequenced work, not prerequisites.


Status: target design contract, not a claim that these routes/states exist.
Implement additive migrations and regenerate shared contracts from Python.
`contracts/README.md` remains the guide for actual API generation.

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
or restarted framework investigation. Reasonable bounded synthetic model tests
on the recorded route are authorized within one cumulative $20 project ceiling;
activate scoped runtime grants without resetting past counters or liabilities.
Verification records request/source/base/operation/result bindings and scope;
unsupported clauses stay needs-validation. Verification never records human
acceptance. Changes after admission invalidate stale pending work; restart cannot
overwrite them or regenerate an uncertain provider attempt.

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
The current separately approved model test is governed by
`GENERAL_MODEL_AUTHORIZATION.md`: one cumulative $20, no calendar expiry,
reasonable bounded synthetic tests on the recorded route. The original four-turn /
eight-generation cap belongs to its immutable checkpoint, not the whole project.
Shared project reservations, carried historical usage and unknown liabilities
remain enforced. Historical expired intake grants remain closed. New paid routes,
private data, default merge and deployment remain excluded.

Memory/learning #10 and provider portability #11 are sequenced after the adaptive
slice. Durable work belongs to Workagent; adapters may use provider persistence
without making it canonical memory. Known-ID retrieval and ambiguous-send
liabilities remain distinct; portability cannot imply safe automatic regeneration.

## Migration hotspots at 93db754

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
