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

- B1 candidate `9a8944b387efad7b895ac7de45bd1f458bb0105f` is published in [draft PR #9](https://github.com/alindebergASL/Workagent/pull/9): source-free conversations and actual-worker prompt/continue/inspect/cancel/delegate CLI. Parent reproduced two turns/four messages across fresh processes with zero sources/provider attempts/pending dispatches; 14 focused B1 tests and exact-head frontend CI passed. Independent review remains pending. Explicit delegation is recorded paused, not falsely active autonomous work.
- Harness comparison is complete and integrated at `0acdf3f31afea7f13f6fcffd4a82802acc12e472`. [Observed adoption decision](HARNESS_ADOPTION.md): preserve Workagent authority and keep the existing Responses adapter for its narrow profile; defer production Hermes adoption. Parent reran ten actual-loop/broker cases and three Responses comparisons with zero external inference. Original 227-test XML/hashes verified; one test explicitly deselected. Two iterations produced four controlled SDK requests while reporting api_calls=2; general broker/effect recovery, all-dispatch accounting, embedding isolation and dependency conflict remain blockers. No OpenClaw lifecycle stack or upstream skill execution was adopted.
- B2/B3 follow through the same worker: real CSV reconciliation and a runnable local tool, preserving edits and observed results. Do not substitute another brief or a canned success string.
- Parent inspected the approved prototype. This is design-reference evidence, not an actual source-free application screenshot.

## Frontend contract coordination

[Installed-base and proposed additive delta](https://github.com/alindebergASL/Workagent/pull/8#issuecomment-5964471922): conversation/messages/turns with optional scope; explicit delegation into existing assignments; capability-specific versioned products and goal-specific outcomes; preserve existing intake routes and semantics. Generate Python/OpenAPI/TypeScript together. No frontend may wire invented endpoints.

Claude has resumed, consumed b76eef8 and acknowledged the interface semantics in [5964491675](https://github.com/alindebergASL/Workagent/pull/5#issuecomment-5964491675). Their frontend checkpoint `63c83b2` is prototype-foundation work against the prior service, not working general conversation. The exact generated B1 mapping (including two-phase create/post, expected_work_version and paused delegation) is delivered in [5964862953](https://github.com/alindebergASL/Workagent/pull/5#issuecomment-5964862953) and [GENERAL_CONVERSATION_CONTRACT.md](GENERAL_CONVERSATION_CONTRACT.md). Exact candidate mapping ACK and actual-service wiring remain pending; no invented endpoints or competing frontend writer.

## Concrete gaps and gates

- First same-worker CLI case is parent-verified; explicit unavailable/failed turn projection, list previews, normal-server worker advancement and actual-service source-free UI remain integration work, not assumed behavior.
- No general-model usefulness proof: controlled transport exercises engineering, not model capability or Andrew's usefulness judgment.
- [CSV and import-free Wasmtime 49.0.0 kernels](LOCAL_CAPABILITY_KERNELS.md) have nine passing tests and observed calculation/tool results, including a changed shipping requirement. They offer pure Wasm functions with fuel/memory/type bounds and no host/WASI imports—not an unrestricted Python/shell sandbox. Typed table/file/tool persistence, broker execution binding, safe downloads, human edits/proposals and same-worker B2/B3 readback are being integrated on `hermes/general-products`; standalone kernel tests do not close product acceptance.
- B4–B7 general ongoing ownership/coordination/memory/steering coverage remains unqualified beyond preserved historical intake behavior.
- Publish engineering / usefulness / experience separately, with exact heads and actual observations.

## Authority

No new Workagent inference/spending, private-context access, external actions, default-branch merge or deployment. The old four-generation grant is exhausted and expired; it is not a product architecture ceiling and will not be reset. Routine implementation and reversible local no-inference verification continue. Any future live request must specify route, data, calls/tokens/spend, expiry and trace handling. Credentials never enter source, chat or evidence.
