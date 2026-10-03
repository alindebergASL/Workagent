# General work contract and migration boundary

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

## Adoption spike

Use `handoffs/backend/upstream/REPORT.md` as the existing research input.
First test a Hermes loop/tool/skill adapter against this contract; Python fit
makes it the first candidate, not a selected dependency. Compare the current
Responses adapter on the same scenarios. Borrow OpenClaw event, steering,
scheduling and recovery patterns where they solve observed gaps. Do not import
competing full stacks or upstream default tools/permissions around the broker.

Deliver a running reproducible local adapter spike, exact pins/licenses and a
keep/adopt/reject decision based on observed behavior. Reuse means less custom
lifecycle code with the same authority and recoverability, not renamed classes.
Verify actual interfaces before promising an SDK. No paid calls are authorized;
controlled transports prove wiring only. A fixture cannot decide usefulness.
Request a fresh bounded grant after the live route/test matrix are concrete.

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
