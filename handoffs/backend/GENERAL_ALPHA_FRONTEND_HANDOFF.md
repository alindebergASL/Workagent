# General-alpha frontend owner handoff (#15)

Owner: existing Claude Code frontend session, `web/` only. Hermes owns runtime/domain/generated contracts/integration. Do not create a second frontend or agent loop.

Base: PR #14 `a0764115ecc24ef4ca3cf3832c483249c64a1ea6`; tested application `5acc6e521766f3b830dea3f47b3c611056370be4`; your `edb09db` fix is already integrated. New integration branch `hermes/general-alpha-15` carries the reconciled existing product/work/acceptance/build contracts. Preserve both branches and concurrent human edits. Read AGENTS.md, the four canonical contracts, issue #15 and this handoff; current branch/evidence supersede old milestone prose.

## Start now with existing contracts

1. Inspect substantive replies and work, not only status screenshots. Runtime fixes will stop generic validation notices replacing selected/generated answers. The shell must lead with the substantive result, recommendation or change; keep meaningful uncertainty next to it and technical details secondary. Ordinary answer completion is not external-objective completion. Preserve prepared/approved/delivered/achieved distinctions.
2. Make the first phone screen useful: concise current result and decisions; history and diagnostics secondary. Preserve existing edits, mobile drafts, work/conversation navigation and the `edb09db` none/passed/failed distinction. No broad redesign, compulsory workflow menus or forced task/artifact for ordinary conversation.
3. Explain actual capability gaps. An unavailable connection or unsupported operation is not an invitation to pretend an artifact performed it. No account configuration flow or implied external operation without a real contract.
4. Inspect existing 'Take it from here' delegation. Do not imply active ownership when the backend only saves a paused handover. Until the new canonical lifecycle is available, accurately label what is recorded and what remains necessary. Do not substitute UI timers or a second task store.

## Contract-dependent wiring (Hermes will publish exact generated delta)

Backend writers are implementing:
- first-class direct answers plus optional versioned skill/tool composition through the same worker/broker; method/capability details stay optional;
- lifecycle on existing canonical Assignments: current outcome, next action, exact dependencies, waiting/blocked/paused/resumable/cancelled/takeover state, material changes and deduplicated check-ins.

Do not invent DTOs or API endpoints before the exact generated contract lands. You can implement/review the existing-contract presentation items above now and report any required wire fields precisely. Hermes will integrate and run the real production-bundle/UI/API/PostgreSQL journey. Keep receipt/fence/provider details out of ordinary interaction, without hiding consequential failures.

## Required evidence

- Frontend tests/type/lint/format/production build on exact commit; label mocks versus actual service.
- Actual conversations/results at desktop and phone, useful first screen, direct answer without compulsory artifact, meaningful revision review and no lost edits.
- Capability-unavailable and truthful ownership states; no fake running activity, completed objective or externally delivered effect.
- Provider-free scope for frontend work. Hermes alone operates any newly authorized bounded model evaluation after integration/verification; no model calls or business account operations from this handoff.

Commit/push on your existing owner branch (or an isolated continuation branch clearly identified). Send exact SHA, tests, UI observations and wire blockers to Hermes. No default-branch merge or deployment. A repository comment alone does not wake the session; Andrew is explicitly resuming the existing Cloud owner.
