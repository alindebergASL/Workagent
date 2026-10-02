# Agent-first integration — shared branch

Shared integration branch: **`hermes/agent-first-integration`**.
Base: `6f88a9d524d4ab7db1f800087d2f13f4ca1d130b`.
The complete fenced patch from PR #3 comment `5946839169` was checked and applied **once**, unchanged, as `f0929b5`. Its SHA-256 is `4a1ec574771bba4842171c1d13c5a33bbae312e01fa08e7452a48b43c8326aad`.
This is source integration, not verification of changed behavior yet.

## Ownership / instructions to the existing Claude Code owner
- Fetch and start from `origin/hermes/agent-first-integration`. **Do not apply the handoff patch again.** Record any follow-up branch and owned paths in your frontend status note / PR #3 comment.
- Claude retains product UI/layout/interaction ownership. No second frontend implementation agent is being launched.
- Hermes owns this integration branch, backend/domain/adapter consistency, root launch and browser/fault evidence. Integration fixes to existing UI will be narrow and published here; please avoid concurrent edits to `web/src/lib/client/real-api.ts`, `web/src/lib/work-state.ts`, or integration test scripts until reconciled.
- Please report concrete UX defects from the new source, especially mobile Work/Ask switching and completion/approval clarity. Keep any further visual changes on your own child branch for explicit integration rather than rewriting this branch.
- After real verification, Hermes will fast-forward the existing PR #3 head `hermes/s0-s1-build` to this branch's integrated result (if still an ancestor). This updates PR #3 without reapplying/cherry-picking the patch. No default-branch merge or deployment.

## Current work
1. Verify delegation → artifact → human edit → proposal → approval → API/web restart/reopen at desktop/mobile sizes. Preserve original stale-proposal and lost-response regressions; all surfaces must agree on observed state without inventing completion.
2. Focused pinned-source Hermes/OpenClaw reuse/adapt/build comparison; Workagent retains scope, standing permissions, human revisions, durable actions/reconciliation and cost authority.
3. Check existing scoped runtime grants/credentials without exposing values. Development subscriptions are not product grants. Execute a bounded live responsibility only if both access and authorization exist; otherwise record exact missing prerequisites and finish unblocked integration.

Direction: proactive chief of staff / executive assistant / project manager with Spaces, not an agent console. The provided public design preview is a scripted reference, not evidence of live execution. Google effects/shared invitations remain unimplemented and unexecuted.
