# Backend / integration — general work-agent reset

## Active mission

Andrew's approved [canonical handoff](https://github.com/alindebergASL/Workagent/pull/5#issuecomment-5964366611) governs this development mission. Workagent is a general persistent work partner. Intake is a preserved capability and completed engineering checkpoint, not universal product defaults or a new release-review request.

Read `../../AGENTS.md`, `../../docs/PRODUCT_CONTRACT.md`, `../../docs/WORK_CONTRACT.md`, `../../docs/PRODUCT_ACCEPTANCE.md` and `../PRODUCT_RESET.md`.

## Installed and verified

- Exact packet reset: **`b76eef865b13486e045d20e2c4586b3975e6ba2c`**, branch `hermes/general-work-reset`, isolated from both owners' prior worktrees.
- Base: `93db754c28385401d62703116313cfd23e153855`; fetched development head still matched that base at installation.
- Fifteen documentation/template files match the supplied result manifest; canonical comment and attached patch match byte-for-byte. Preflight and post-apply verifier passed; no conflicts. No application tests are implied by this documentation check.
- Existing application/bundle bytes, intake receipts, grants and saved DB state were untouched. PR #5's stale intake-in-progress description was replaced and read back.
- The prior S0/S1 status is historical: [preserved pre-reset status](https://github.com/alindebergASL/Workagent/blob/b76eef865b13486e045d20e2c4586b3975e6ba2c/handoffs/backend/STATUS.md). Its narrow ceilings and pending/no-live claims are not current guidance.

## Ownership and work underway

Hermes owns backend/runtime/contracts/integration. Existing Claude Code session owns `web/`; no competing frontend is commissioned.

- B1 implementation: source-free conversations, persisted turns and a thin prompt CLI through the actual domain/worker; explicit delegation is distinct from conversation. Isolated writer branch `hermes/general-conversation-cli`. Routes are not implemented merely because proposed.
- Harness comparison: actual pinned upstream Hermes loop/tool/skill adapter behind a broker boundary, controlled transport only, in `hermes/general-harness-spike`. Compare observed behavior with the existing Responses profile; no harness adoption is assumed.
- B2/B3 follow through the same worker: real CSV reconciliation and a runnable local tool, preserving edits and observed results. Do not substitute another brief or a canned success string.
- Parent inspected the approved prototype. This is design-reference evidence, not an actual source-free application screenshot.

## Frontend contract coordination

[Installed-base and proposed additive delta](https://github.com/alindebergASL/Workagent/pull/8#issuecomment-5964471922): conversation/messages/turns with optional scope; explicit delegation into existing assignments; capability-specific versioned products and goal-specific outcomes; preserve existing intake routes and semantics. Generate Python/OpenAPI/TypeScript together. No frontend may wire invented endpoints.

**Agreement pending:** no Claude acknowledgement was observed when this status was written. The existing [Claude session](https://claude.ai/code/session_01DGkZiuRC1j4VkK4rNQ3c3D) is behind a security-verification wall in the available browser. Posting the handoff did not establish that its session resumed. Backend work proceeds without pretending agreement or taking over `web/`.

## Concrete gaps and gates

- First same-worker CLI case and real-service source-free UI screenshot: pending implementation/owner integration.
- No general-model usefulness proof: controlled transport exercises engineering, not model capability or Andrew's usefulness judgment.
- Local tool execution isolation needs an observed broker/sandbox proof. Unprivileged user/network namespace creation was denied; the local Docker daemon was unavailable. Kernel Landlock ABI 8 and libseccomp were detected as an alternative candidate, **not yet execution proof**. Do not fall back to unrestricted host execution.
- B4–B7 general ongoing ownership/coordination/memory/steering coverage remains unqualified beyond preserved historical intake behavior.
- Publish engineering / usefulness / experience separately, with exact heads and actual observations.

## Authority

No new Workagent inference/spending, private-context access, external actions, default-branch merge or deployment. The old four-generation grant is exhausted and expired; it is not a product architecture ceiling and will not be reset. Routine implementation and reversible local no-inference verification continue. Any future live request must specify route, data, calls/tokens/spend, expiry and trace handling. Credentials never enter source, chat or evidence.
