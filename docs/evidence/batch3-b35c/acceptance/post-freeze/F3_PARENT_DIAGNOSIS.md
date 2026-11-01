# Post-freeze F3 parent diagnosis

Read-only, 2026-11-01. No frozen source, study state, funding, output or grades changed.

## Baseline local stop is specifically an estimate gate, not owner funding exhaustion

R02-E1 / trajectory3cb96b2f0903435dd86330c1 / run6ccbf55c-f94b-4f17-9226-7d45f77845a0:
- Exact retained `actions/000024/worker.stderr` reports selection_7 estimated41203 tokens > local packing ceiling37000, input limit50000, requestSHAe47d2722df38a9b03e26527ac1f0e02308aaa1bd06c2aa058dec4ee7f7a07443. It prepared no seventh count/dispatch.
- Frozen B0 `.local/batch3/b35b/baseline/workagent/request_packing.py:187–189` raises budget_exhausted when estimated packing cannot remove more old messages. The worker maps that to budget_limit and generic cumulative-budget explanatory text. Six prior count/dispatch/result pairs all settled. This is not provider50000-token refusal and not $175 authority exhaustion.
- Read-only SQL snapshot `F3_FROZEN_DIAGNOSIS.json`: both scoped grants max_steps8, count/generation256, input12800000, output2097152, cost12USD. Recipient allocation2USD, retained model accounting0.3942875,72ancillary events (not invoice/tariffs), no tool-budget-account rows or retained-result reads. This rules out the obvious monetary and retained-read limits at this stop; exact stderr/source establishes the estimate gate.
- Current candidate `backend/workagent/request_packing.py:187–192,199–208` already returns the intact compacted request for mandatory exact counting instead of using local estimates as admission. Do not change historical B0 or increase authority/capacity to fix a historical comparator. Test current behavior and document this precise no-change disposition.

## Two current-arm partials retain substantive work but are not successes

R03-E1 / runa0e23fb9-e580-4d2a-b60d-5d5724741876 and R01-E3 / run2e8eb0b7-6b77-40a1-a74b-13b69fac822b each have8selection phases plus completed final, max_steps8 and stop_reasonstep_limit. Explanatory unresolved text is `File operation retained with exact references. No human proposal accepted or overall task completion asserted.` Neither has missing count/generation results in frozen masked evidence. This is task incompleteness, not itself external uncertainty; new collector must prove actual identities/accounting/tool outcomes separately, retain partial status and producer-run scope, and never retroactively convert frozen failed collection to success. Ordinary continuation remains subject to checkpoint/admission/progress/current-authority guards; no forced continuation or unknown replay.

## Operational review

Frozen omissions remain coordinator evidence, not model failures. Future helper must not merely make review optional by convention: dependent transition must enforce explicit proposal decisions, current/base/proposed hashes, protected text, ordinary acknowledgement/CAS and post-action readback/recollection. A helper alone does not prove a future campaign is integrated; state that limitation honestly.
