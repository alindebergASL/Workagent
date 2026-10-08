# Current runtime status and execution boundary

## Candidate and preserved review state

Current published baseline: **3568fbcada2ab564bbf3d7dbd49f0d41d8700013**,
PR #12, `hermes/adaptive-product-integration`. This preserves implementation
8ed405e, checkpoint 898c64e and the independently reviewed rich-text URL fix.
PR #9 is a coordination/history entrypoint, not the latest application head.

Historical application 1b81a1d and its saved 3000/8000 review environment remain
preserved. The prior adaptive 3120/8120 environment is also retained. Do not reset
those databases or overwrite human edits. New milestone proof uses isolated state.

## Implemented baseline

- Same GeneralWorker/domain/broker, durable outbox and immutable Responses ledger.
- Bounded adaptive goals, observations and changed local actions; real CSV and
  import-free Wasmtime execution, not model prose standing in for execution.
- Model-generated checks and optional human cases are honestly limited evidence;
  passing them alone leaves `partial` / `needs_validation`.
- Exact saved targets, human edits, proposals and separate explicit acceptance.
- Explicit saved-tool reruns perform local execution with no provider dispatch.
- Cross-grant shared project reservations with immutable historical carryforward;
  uncertain attempts retain liabilities. Original provider reasoning/IDs survive
  stored response recovery; no silent replacement generation.
- Claude's integrated rich-text/long-reply/proposed-input fixes and reviewed URL
  safety correction, desktop/phone work/conversation and result-first surfaces.

Prior evidence: [adaptive integration](../handoffs/backend/ADAPTIVE_PRODUCT_CHECKPOINT.md)
and [ordinary reuse](../handoffs/backend/ORDINARY_REUSE_CHECKPOINT.md).
613 backend tests apply to unchanged baseline backend bytes; 138 frontend tests
apply to the final URL correction. These are historical executed results, not a
claim that the next milestone has already passed its new gates.

## Next complete adaptive milestone — in progress

Add independent completion verification for a bounded ordinary request, with
explicit scope and exact evidence bindings. Run existing model/local consumers
continuously in isolated state. Prove a meaningful obstacle and changed action,
then interrupt before completion and continue with human edits/no duplicate
effects. Do not substitute reopening a completed artifact. Unknown goals remain
needs-validation; verifying a proposed result never applies it.

Engineering, usefulness and experience verdicts for this new candidate remain
NOT TESTED until linked execution evidence is recorded. Broader M4 specialist
coordination and M5 persistent event-driven ownership remain undelivered.
Memory/learning #10 and portability #11 follow this slice, not prerequisites.

## Authority and cumulative budget

Routine development, fixes, tests, publication and compatible non-default
integration are authorized. Reasonable bounded synthetic model tests may continue
on official `gpt-6.1-sol` within **one cumulative $20**, no calendar expiry. The
initial four-turn/eight-generation checkpoint is not a project-wide stop. New
bounded runtime grants share the same budget; historical grant bytes, counters,
reservations, carried usage and unknown liabilities must remain intact.

Last published aggregate reservation: **$2.638400 / $20**, including historical
carried liabilities. This is not confirmed billing and is not a fresh $20 grant.
Read the durable ledger before further activation; account/model/pricing evidence
must be current. No automatic resends of uncertain sends or hidden refunds.

Default startup remains controlled and strips model keys. New paid routes, broader
private-data access, external business actions, default merge and deployment are
outside authority. [Authorization](GENERAL_MODEL_AUTHORIZATION.md) records the
clarification. Claude CLI is logged out; restoring its frontend-owner lane needs
`claude auth login`, not an API key pasted into chat. Backend work continues and
exact generated contracts/handoff will be published.
