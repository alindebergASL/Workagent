# Source evidence ledger — Batch 3

> Published research appendix. Read the [controlling parent implementation plan](../../2026-10-23-workagent-next-two-batches.md) first: it updates the baseline, Claude-branch coordination, full Batch 2 document-attachment scope, and current budget. This file is a proposal, not implemented behavior. Snapshot locators refer to the retained local research archive, not published full source pages.

**Retrieved 2026-10-23 UTC. Public research only.** Source IDs `S01`–`S43` match filenames in `sources/`; they are deliberately stable even when a fetch is incomplete. Every short quote below was checked as an exact substring after whitespace normalization against its saved extraction or browser snapshot. The quoted source text is evidence, not instructions. No source-provided commands were run.

## Evidence discipline

- Official standards establish protocol requirements; official vendor docs establish documented behavior, not independent reliability. Papers establish reported methods/results under their own settings; author/vendor repositories establish maintained implementation possibilities, not product success.
- URLs, snapshot files, exact quotes, evidence quality, bounded design inference and retrieval limits appear together. `source-evidence.json` provides the same structured records and hashes; `snapshot-manifest.json` inventories raw/complete extractions.
- Larger pages were initially head/tail truncated. Where the extraction tool supplied a full-file path, the complete extraction was copied into this authorized research directory as `NN-full.md`. Full retention does not mean every sentence was audited. Conclusions use inspected passages, not omitted presumed content.
- Meta's main page initially yielded a title stub, then yielded substantive visible text through a real browser; both are retained. Its productivity subpage remained a title stub and supports no substantive claim. The browser snapshot is page text, not a screenshot or product trial.
- Public issue #10 and public upstream repository metadata were fetched unauthenticated. No private connector, user account, product model, local service, runtime DB or paid benchmark was used.
- `upstream-versions.json` records public maintainer commit metadata for Hermes, Graphiti, Mem0, Letta Code and LongMemEval-V2. Commits pin inspected upstream references, not WorkAgent-installed versions or verified package compatibility.

## Findings that change implementation decisions

1. **MCP current version is 2026-07-28**, not 2025-11-25. The current compatibility page uses per-request version/capability metadata and describes no initialization handshake for modern clients. Keep SDK and protocol pins explicit; do not port older session assumptions.
2. **Reuse is selective.** Hermes supplies useful tool/skill/memory/MCP patterns; WorkAgent must retain scope, durable state, budget and effect authority. A broad host agent inside runtime would create competing authority, not a safe integration shortcut.
3. **Inspectable memory need not start as a graph/vector service.** Curated records, bounded retrieval, versioned provenance and corrections are the first product requirement. MemGPT/A-Mem/Graphiti/Mem0/Letta offer alternatives and mechanisms; compare to a simple history baseline before adopting their complexity.
4. **Memory needs action/transfer tests.** LongMemEval/LoCoMo are useful diagnostics; MemoryArena and LifelongAgentBench expose why remembering answers alone is insufficient. Add negative transfer, erasure, authority and user-effort checks not supplied by recall benchmarks.
5. **Read-only is not privacy-free.** OAuth scopes, selected resources, token isolation, generation fences and revocation must precede real private pilots. Docs/research approval does not grant account access.
6. **Dots/Muse are experience targets, not scores.** Their pages motivate ongoing work, artifacts, inspectability and approval. No fake head-to-head or parity claim follows.

## WorkAgent product context
### S11 — Memory: persistent work, scoped recall and learning with a seamless experience

- **Primary URL:** https://github.com/alindebergASL/Workagent/issues/10
- **Evidence quality:** First-party public GitHub issue.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Memory must improve ordinary work without making the user operate a memory system.

**Design inference:** Preserve the full ambition: persistent useful work, scoped recall, corrections and learning with machinery hidden until requested.

**Limits:** Issue is open design direction, not proof of implemented features. Retrieved public issue only; no private account/auth used.

**Saved evidence:** `sources/11.md` (local extraction). SHA-256 of substantive snapshot: `7dfd361a84965015d196f718fb0764f1447f8b2920439eb219d4fa0fdc80eff8`.

## Experience targets
### S08 — Introducing dots | OpenAI

- **Primary URL:** https://openai.com/index/introducing-dots/
- **Evidence quality:** Official vendor product page.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> You choose which apps dots can access

**Design inference:** Target inspectable persistent work, connected context, read-only proactive work, permission controls and steering; no fixed task menu.

**Limits:** Vendor-described experience and scale, not independently verified reliability. No account trial, pricing study or head-to-head comparison performed.

**Saved evidence:** `sources/08.md` (local extraction). SHA-256 of substantive snapshot: `4cb7e5d3ad48f084905a53c392befba988ad623d757a56a98e5b96877b02095e`.

### S09 — Muse: Meta's personal AI agent, features & capabilities

- **Primary URL:** https://ai.meta.com/muse/
- **Evidence quality:** Official vendor product page; live browser recovery.
- **Retrieved:** 2026-10-23 UTC; web_extract; browser fallback for S09.
> Approve critical actions from your agent

**Design inference:** Target conversational work, ongoing goals, credential separation, critical-action approval and an audit trail.

**Limits:** Text extraction returned only a title stub; a read-only real browser recovered visible page text. Promotional security claims are not audited facts. No login, download or product trial.

**Saved evidence:** `sources/09.md` (local extraction), `sources/09-browser.md` (local browser-visible text). SHA-256 of substantive snapshot: `c2bde5fdc8056faee5672e26257c45f535e4ff9ebee6dcd851e56455f4950978`.

### S10 — How to get started with Muse | Meta Help Center | Meta

- **Primary URL:** https://www.meta.com/help/artificial-intelligence/1331373868832401/
- **Evidence quality:** Official vendor help documentation.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Your Muse may be inaccurate or take unexpected actions.

**Design inference:** Target conversation continuity, cross-chat context, artifact library, follow-up changes and user-defined scope boundaries.

**Limits:** Help documentation describes intended use and explicitly warns of inaccurate/unexpected actions. It does not demonstrate WorkAgent or Muse task performance.

**Saved evidence:** `sources/10.md` (local extraction). SHA-256 of substantive snapshot: `70abcefd7083b7f7c2c3cb241dd3af14e64d582a01b48930089103996b570b81`.

### S43 — Muse for Productivity: Email, Calendar, and Files | AI at Meta

- **Primary URL:** https://ai.meta.com/muse/productivity/
- **Evidence quality:** Retrieval limitation: official productivity subpage.
- **Retrieved:** 2026-10-23 UTC; web_extract.
**No substantive quote:** extraction was a title-only stub.

**Design inference:** None used for substantive product claims.

**Limits:** Extraction returned only a short title stub. Main official page was recovered in a browser (S09), and help page S10 provides useful documented detail; no need to infer missing subpage content.

**Saved evidence:** `sources/43.md` (local extraction). SHA-256 of substantive snapshot: `bbc70183947504b23bca987d24ecab616fcb901999a58d736b455e0889f97dba`.

## Hermes
### S01 — Built-in Tools Reference | Hermes Agent

- **Primary URL:** https://hermes-agent.nousresearch.com/docs/reference/tools-reference
- **Evidence quality:** Official implementation documentation.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Availability varies by platform, credentials, and enabled toolsets.

**Design inference:** Use progressive capability discovery and tools with explicit installation/credential availability; reuse selected utilities behind WorkAgent authority.

**Limits:** Documentation describes upstream, not the installed WorkAgent runtime. Do not advertise the upstream tool count as product support.

**Saved evidence:** `sources/01.md` (local extraction). SHA-256 of substantive snapshot: `eab95f4f0c95b5ee7b39260677070f2ef748ab4f48ec67c0ab6d3b929450d0d4`.

### S02 — Persistent Memory | Hermes Agent

- **Primary URL:** https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- **Evidence quality:** Official implementation documentation.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Hermes Agent has bounded, curated memory that persists across sessions.

**Design inference:** Bounded curated facts/user preferences and session-start snapshots are a useful baseline for inspectable memory and context budgets.

**Limits:** Files/profile-level memory are not WorkAgent project tenancy, correction graphs or verified transfer. Do not ingest the operator profile.

**Saved evidence:** `sources/02.md` (local extraction). SHA-256 of substantive snapshot: `aeecfd4e5e47241021d47d3864610407414852a798369aa56df5475cbc7ee566`.

### S03 — Skills System | Hermes Agent

- **Primary URL:** https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
- **Evidence quality:** Official implementation documentation.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Skills are on-demand knowledge documents the agent can load when needed.

**Design inference:** Reuse progressive disclosure and versioned reusable procedures; disclose provenance and review externally sourced or learned skills.

**Limits:** Upstream agent-created skill behavior is not permission for WorkAgent to self-install tools or broaden grants. Documentation is not a security proof.

**Saved evidence:** `sources/03.md` (local extraction), `sources/03-full.md` (local complete extraction). SHA-256 of substantive snapshot: `482daf9a9c4072abe2123dde2375f3561e35146970a6a42910f3e623b16b7e29`.

### S04 — MCP (Model Context Protocol) | Hermes Agent

- **Primary URL:** https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp
- **Evidence quality:** Official implementation documentation.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Local stdio servers and remote HTTP MCP servers in the same config

**Design inference:** Prefer an MCP adapter over rebuilding commodity integrations; retain per-server allowlists, timeouts and OAuth lifecycle ownership.

**Limits:** Hermes configuration defaults and SDK behavior must not be transplanted blindly into multi-user WorkAgent. MCP connection is a separate permission decision.

**Saved evidence:** `sources/04.md` (local extraction), `sources/04-full.md` (local complete extraction). SHA-256 of substantive snapshot: `2d1dac94adad9ed08a85cc440777351420a7db3e8dec02f2cecacff870204419`.

### S42 — LICENSE

- **Primary URL:** https://github.com/NousResearch/hermes-agent/blob/main/LICENSE
- **Evidence quality:** Official source license.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> MIT License

**Design inference:** MIT licensing supports selective reuse with notices and dependency/license review.

**Limits:** A top-level MIT license does not automatically cover every third-party package/service, model or connector; no code copied in this research.

**Saved evidence:** `sources/42.md` (local extraction). SHA-256 of substantive snapshot: `68fa68048d881c441c9114712c65bd52ec0e39fe8b319115e3855370eda83af7`.

## MCP current protocol and security
### S05 — Authorization - Model Context Protocol

- **Primary URL:** https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- **Evidence quality:** Official older specification, historical.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> MCP servers MUST implement OAuth 2.0 Protected Resource Metadata

**Design inference:** Retained to show initial discovery used the older 2025-11-25 authorization revision.

**Limits:** Superseded for current design by S25–S29. Never describe this URL as the current MCP specification.

**Saved evidence:** `sources/05.md` (local extraction). SHA-256 of substantive snapshot: `ae675a6638916c8fbe670512329bfe8dfb72f310648b0cc401f97f7cfe630219`.

### S06 — Security Best Practices

- **Primary URL:** https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices
- **Evidence quality:** Official older security guidance, historical.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Token passthrough

**Design inference:** Older guidance still explains confused-deputy/token-passthrough risks; compare to current revision.

**Limits:** Use S27 for the current model, including state handles rather than assuming protocol session IDs.

**Saved evidence:** `sources/06.md` (local extraction). SHA-256 of substantive snapshot: `3b829c9bc5172b86b9f0bb4aa25b19df9f7bc4795b8edc70487dce5237794845`.

### S07 — Tools - Model Context Protocol

- **Primary URL:** https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- **Evidence quality:** Official older tools specification, historical.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Tools in MCP are designed to be model-controlled

**Design inference:** Historical baseline for tool interaction and human-denial affordances.

**Limits:** Use S28 current tool metadata/pagination/caching requirements for new implementation; old protocol defaults are not authoritative.

**Saved evidence:** `sources/07.md` (local extraction). SHA-256 of substantive snapshot: `15d96f019ed1e8df64706ee9874b25f4213262b51f057daae8c58b4a65254637`.

### S25 — Versioning

- **Primary URL:** https://modelcontextprotocol.io/specification/versioning
- **Evidence quality:** Official version registry.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> The current protocol version is 2026-07-28.

**Design inference:** Current version observed is 2026-07-28; pin it intentionally and retain legacy support only if needed.

**Limits:** Version status is retrieval-time evidence, not timeless. Recheck before implementation; SDKs may lag.

**Saved evidence:** `sources/25.md` (local extraction). SHA-256 of substantive snapshot: `e3d627bf864d20dafc47b9a3aeafae9f72b913a281d4f59e6f659575968194ac`.

### S26 — Authorization - Model Context Protocol

- **Primary URL:** https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- **Evidence quality:** Official current authorization specification, 2026-07-28.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Access tokens MUST NOT be included in the URI query string

**Design inference:** Implement protected-resource/auth-server discovery, resource/audience binding, issuer checks, PKCE and no query-string access tokens.

**Limits:** A server-required scope is a request for access, not user consent. Prompt/source text cannot authorize scope escalation.

**Saved evidence:** `sources/26.md` (local extraction). SHA-256 of substantive snapshot: `3177fd1be7b74a1f6d52c97ce1f63f766d36566f7c45d8fa32cb5d175a5455c9`.

### S27 — Security Best Practices

- **Primary URL:** https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices
- **Evidence quality:** Official current security best practices, 2026-07-28.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Token passthrough is explicitly forbidden

**Design inference:** Enforce consent/confused-deputy protection, no token passthrough, metadata SSRF checks and authenticated state handles.

**Limits:** Long extraction was initially truncated; full snapshot is retained. Do not blindly reuse older protocol session guidance.

**Saved evidence:** `sources/27.md` (local extraction), `sources/27-full.md` (local complete extraction). SHA-256 of substantive snapshot: `6b1bd2ce1a15c7f141514abf62a3aa3665c4501aa865007d80607dca9fb87187`.

### S28 — Tools - Model Context Protocol

- **Primary URL:** https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- **Evidence quality:** Official current tools specification, 2026-07-28.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> clients MUST consider tool annotations to be untrusted unless they come from trusted servers.

**Design inference:** Treat tool annotations as untrusted; schema-pin tool sets; implement bounded discovery and principal-aware caches; user can deny calls.

**Limits:** Model-controlled discovery is not application authority. More protocol features do not imply sampling, UI, server tasks or roots are enabled.

**Saved evidence:** `sources/28.md` (local extraction). SHA-256 of substantive snapshot: `727425a0e96ff8708efcb402b74b6008b44688ab6a80640dddce6c2a6b3111c1`.

### S29 — Versioning and Compatibility

- **Primary URL:** https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle
- **Evidence quality:** Official current versioning/compatibility specification, 2026-07-28.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> There is no negotiation handshake.

**Design inference:** Modern per-request metadata/version checks and server/discover differ from legacy initialize/session assumptions.

**Limits:** Do not infer SDK compatibility from this page. Dual-era adapter behavior needs tests; legacy fallback is explicit, not silent.

**Saved evidence:** `sources/29.md` (local extraction). SHA-256 of substantive snapshot: `cc1e3e24326629ac895686aecacafa39e0d8e658e77ccf469dec2521286e1fc9`.

## Sandbox and connector authentication
### S20 — Security Model - gVisor

- **Primary URL:** https://gvisor.dev/docs/architecture_guide/security/
- **Evidence quality:** Official gVisor security model.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> additional defense against the exploitation of kernel bugs by untrusted userspace code

**Design inference:** Use a real isolation boundary for generated code; layer network/filesystem/secret limits and host operational controls.

**Limits:** gVisor does not eliminate all side channels, application vulnerabilities or deliberately granted network access. No deployment/runtime test was performed.

**Saved evidence:** `sources/20.md` (local extraction). SHA-256 of substantive snapshot: `6b934293c94258fdd9d00bd2460d49267c2235c229a24b924e5ed584cf96e782`.

### S21 — Security - Wasmtime

- **Primary URL:** https://docs.wasmtime.dev/security.html
- **Evidence quality:** Official Wasmtime security documentation.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> WebAssembly is inherently sandboxed by design

**Design inference:** Keep import-free Wasm as a narrow capability; explicit host imports are authority decisions.

**Limits:** WebAssembly safety depends on runtime/host configuration and patching. It is not general Python support or a filesystem access grant.

**Saved evidence:** `sources/21.md` (local extraction). SHA-256 of substantive snapshot: `e011360af7e59c1c6a272217f3bc3f1d888426050d6b6120ad832e4f07ae3c25`.

### S22 — Authenticating as a GitHub App installation

- **Primary URL:** https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
- **Evidence quality:** Official GitHub App authentication documentation.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> The installation access token will expire after 1 hour.

**Design inference:** Use short-lived installation tokens with explicit repository and permission narrowing for a separately approved private read pilot.

**Limits:** Omitted narrowing defaults to installation reach. Provider scopes may exceed the exact task. No installation/token was created or used.

**Saved evidence:** `sources/22.md` (local extraction). SHA-256 of substantive snapshot: `bf9f22015090a76e2be26804bb9fc241900a91b9290af2577f9e7d7c0f5ac55f`.

### S23 — Using OAuth 2.0 for Web Server Applications  |  Authorization  |  Google for Developers

- **Primary URL:** https://developers.google.com/identity/protocols/oauth2/web-server
- **Evidence quality:** Official Google OAuth web-server documentation.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> incremental authorization, token revocation

**Design inference:** Use consent, refresh handling, incremental authorization and revocation through provider-specific adapters; avoid requesting account-wide access preemptively.

**Limits:** Docs cover supported flows, not blanket permission. Some scopes require provider verification; actual app/account approval is outstanding.

**Saved evidence:** `sources/23.md` (local extraction), `sources/23-full.md` (local complete extraction). SHA-256 of substantive snapshot: `4ea889208d987676e84aa92d04e9609a478f1620db938034cda7548ef4aa6bbf`.

### S24 — RFC 9700: Best Current Practice for OAuth 2.0 Security

- **Primary URL:** https://www.rfc-editor.org/rfc/rfc9700.html
- **Evidence quality:** IETF RFC 9700, Best Current Practice.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Best Current Practice for OAuth 2.0 Security

**Design inference:** Use current OAuth security practice: authorization-code protection, exact redirect binding, least privilege and safe refresh/revocation handling.

**Limits:** A standards checklist alone does not prove implementation security. Provider and client-specific constraints still need actual tests.

**Saved evidence:** `sources/24.md` (local extraction), `sources/24-full.md` (local complete extraction). SHA-256 of substantive snapshot: `f4bbde057a6a41a81ffa062523d12560c55a475554a518841aab5fc592064ebd`.

### S30 — REST API endpoints for {% data variables.product.prodname_github_app %} installations

- **Primary URL:** https://docs.github.com/en/rest/apps/installations#revoke-an-installation-access-token
- **Evidence quality:** Official GitHub REST installation endpoints.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Revoke an installation access token

**Design inference:** Provider revocation endpoint supports immediate token invalidation; pair it with local generation fences and readback.

**Limits:** Token revocation is not necessarily app uninstall or grant deletion. Provider failures require honest pending state; no real endpoint mutation performed.

**Saved evidence:** `sources/30.md` (local extraction). SHA-256 of substantive snapshot: `220d4af286e9de98a737d06c7b913aedcd1e3fbb60e9cfa3189dac64d679b565`.

## Memory research and maintained implementations
### S13 — MemGPT: Towards LLMs as Operating Systems

- **Primary URL:** https://arxiv.org/abs/2310.08560
- **Evidence quality:** Primary research paper; MemGPT.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> we propose virtual context management

**Design inference:** Memory hierarchy and explicit context management are reusable ideas; keep durable storage separate from model context.

**Limits:** Research system and benchmark results do not supply WorkAgent tenancy, review/forget semantics or a maintained integration contract.

**Saved evidence:** `sources/13.md` (local extraction), `sources/13-full.md` (local complete extraction). SHA-256 of substantive snapshot: `27686147c7865f478a37fba5369e7c0f649524ba1d40bfcd20fdcff931362e50`.

### S14 — A-Mem: Agentic Memory for LLM Agents

- **Primary URL:** https://arxiv.org/abs/2502.12110
- **Evidence quality:** Primary research paper; A-Mem.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> this paper proposes a novel agentic memory system for LLM agents

**Design inference:** Linked notes and evolving organization motivate explicit derived-from and contradiction relations.

**Limits:** Dynamic organization is not verified truth, safe nonmonotonic correction or permission. Evaluate against simpler retrieval before adopting autonomous graph evolution.

**Saved evidence:** `sources/14.md` (local extraction), `sources/14-full.md` (local complete extraction). SHA-256 of substantive snapshot: `720bb655d9590ad4fd13d25ea8ec748b14d298591717fcc295cc9de91667d4c1`.

### S15 — Memory blocks (core memory) | Letta Docs

- **Primary URL:** https://docs.letta.com/guides/agents/memory-blocks/
- **Evidence quality:** Official Letta implementation documentation.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> They are always visible - no retrieval needed.

**Design inference:** Structured inspectable memory blocks, bounded sizes and read-only controls illustrate a practical explicit memory interface.

**Limits:** Always-visible blocks consume context and are not a substitute for scope filtering. Check compatibility with the current maintained harness in S41.

**Saved evidence:** `sources/15.md` (local extraction). SHA-256 of substantive snapshot: `2f48238fed25d09dddfea989445ca08ef868438389b10227cf6d155997d46c9b`.

### S16 — getzep/graphiti

- **Primary URL:** https://github.com/getzep/graphiti
- **Evidence quality:** Maintainer repository; Graphiti.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> A Framework for Building Temporal Knowledge Graphs

**Design inference:** Temporal knowledge relationships are a candidate adapter for later source-backed fact evolution and valid-time queries.

**Limits:** Maintainer descriptions/benchmarks are not independent security or transfer evidence. Graph infra and LLM extraction add cost, dependency and deletion complexity.

**Saved evidence:** `sources/16.md` (local extraction). SHA-256 of substantive snapshot: `5ed9388633d54dc21fb237a5f78c435a0e5c8995c4420269e416459d5c300882`.

### S17 — mem0ai/mem0

- **Primary URL:** https://github.com/mem0ai/mem0
- **Evidence quality:** Maintainer repository; Mem0.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> The Memory Layer for AI Agents

**Design inference:** A managed/reusable memory interface is an alternative to building every extraction/retrieval component.

**Limits:** Production-ready/vendor claims do not prove cross-tenant isolation, erasure or useful learning in WorkAgent. Keep app-owned record authority and audit behavior.

**Saved evidence:** `sources/17.md` (local extraction). SHA-256 of substantive snapshot: `a0dbe84d4852e427e02683a54260a0afe2576c04478f10b6bb1ab93e4c129645`.

### S31 — Benchmarking AI Agent Memory: Is a Filesystem All You Need? | Letta

- **Primary URL:** https://www.letta.com/blog/benchmarking-ai-agent-memory/
- **Evidence quality:** Vendor-authored benchmark blog; methodological counterpoint.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> memory is more about how agents manage context than the exact retrieval mechanism used.

**Design inference:** Keep a simple raw-history/filesystem retrieval baseline and test whether organization—not elaborate memory infra—causes gains.

**Limits:** Vendor experiment, not independent replication; reported LoCoMo comparison depends on setup. It does not prove filesystem access is safe or best for WorkAgent.

**Saved evidence:** `sources/31.md` (local extraction). SHA-256 of substantive snapshot: `42ff67296948a5b9134caf4fafe65e16fd62ca264eefe72030109e0ebe4abc12`.

### S33 — Zep: A Temporal Knowledge Graph Architecture for Agent Memory

- **Primary URL:** https://arxiv.org/abs/2501.13956
- **Evidence quality:** Vendor-affiliated primary research; Zep.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Zep: A Temporal Knowledge Graph Architecture for Agent Memory

**Design inference:** Temporal graph design is relevant to valid/recorded time and evolving facts; inspect Graphiti rather than assuming static vector memory is enough.

**Limits:** Vendor-affiliated benchmark claims and comparison settings are not neutral rankings; no replication or adoption decision based on score alone.

**Saved evidence:** `sources/33.md` (local extraction), `sources/33-full.md` (local complete extraction). SHA-256 of substantive snapshot: `058435587a99676f8f6159e69cbd6d36f3590f6d459997f5eb1cc70f1c87c44b`.

### S34 — Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory

- **Primary URL:** https://arxiv.org/abs/2504.19413
- **Evidence quality:** Vendor-affiliated primary research; Mem0.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory

**Design inference:** Extraction/consolidation/retrieval and cost/latency reporting help frame alternatives to full-history prompts.

**Limits:** Published vendor scores are not a WorkAgent baseline, and production framing does not verify permissions/forget semantics.

**Saved evidence:** `sources/34.md` (local extraction), `sources/34-full.md` (local complete extraction). SHA-256 of substantive snapshot: `22a20f25109da80800dc796b25d6aae4e7170a03b405af141245241d30977333`.

### S35 — letta-ai/letta

- **Primary URL:** https://github.com/letta-ai/letta
- **Evidence quality:** Maintainer repository redirect/current-source guidance.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> The current source code lives in `letta-ai/letta-code`

**Design inference:** Current source location is letta-ai/letta-code, not an assumption that every historical MemGPT server API is the supported integration target.

**Limits:** Repository text directs source location; do not falsely label it archived merely because development moved. No runtime installed.

**Saved evidence:** `sources/35.md` (local extraction). SHA-256 of substantive snapshot: `830c8bf8838a6a612fb14e1efadd8aed5767870b1bf93f5a002bfbcee83e05f8`.

### S41 — letta-ai/letta-code

- **Primary URL:** https://github.com/letta-ai/letta-code
- **Evidence quality:** Maintainer repository; Letta Code.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> All context (including memory blocks) is tracked via git.

**Design inference:** Git-tracked context and inspectable memory/skills suggest versioning and rollback patterns worth adapting.

**Limits:** Harness supports broad self-modification/cloud/host execution; do not embed that authority unbounded in WorkAgent. Pin and license-review only selected components.

**Saved evidence:** `sources/41.md` (local extraction). SHA-256 of substantive snapshot: `7b166cf82dc61db17082655a0b5025b7afafe1c02e99cb699ed723b948df233d`.

## Evaluation research
### S12 — [2410.10813] LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory

- **Primary URL:** https://arxiv.org/abs/2410.10813
- **Evidence quality:** Primary research abstract; benchmark paper.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention.

**Design inference:** Evaluate extraction, temporal/multi-session reasoning, updates and abstention; keep raw-history baselines.

**Limits:** Abstract-level evidence in this snapshot; published accuracy claims were not reproduced. Question answering alone does not test agentic work or permissions.

**Saved evidence:** `sources/12.md` (local extraction). SHA-256 of substantive snapshot: `5575851b4f7a4d12dd59f7d60dec36d4c0c7d26c09ef90b556cd73cd2404eb1e`.

### S18 — [2406.12045] $τ$-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains

- **Primary URL:** https://arxiv.org/abs/2406.12045
- **Evidence quality:** Primary research abstract; tau-bench.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> compares the database state at the end of a conversation with the annotated goal state

**Design inference:** Use independent postcondition checks and repeated trials to measure reliability in user/tool interactions.

**Limits:** Domain-specific benchmark tasks motivate evaluation, not product domain handlers. Do not extrapolate published older-model scores to the current route.

**Saved evidence:** `sources/18.md` (local extraction). SHA-256 of substantive snapshot: `703785fe2df92dd705007ae142a1f691e8ea4f542bcdac6155fa334b46bbb0af`.

### S19 — AgentDojo: A Dynamic Environment to EvaluatePrompt Injection Attacks and Defensesfor LLM Agents

- **Primary URL:** https://arxiv.org/abs/2406.13352
- **Evidence quality:** Primary research paper; AgentDojo.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> an evaluation framework for agents that execute tools over untrusted data

**Design inference:** Treat external tool data as injection-bearing and evaluate task utility alongside attack success/permission violations.

**Limits:** Benchmark defenses are not complete protection. Adapt adversarial tests to actual WorkAgent broker, memory, connectors and sandbox.

**Saved evidence:** `sources/19.md` (local extraction), `sources/19-full.md` (local complete extraction). SHA-256 of substantive snapshot: `2bc6e70864ce72a828238f51cde3f5281c205dc3261e44465ec59654c47c76c0`.

### S32 — Evaluating Very Long-Term Conversational Memory of LLM Agents

- **Primary URL:** https://arxiv.org/abs/2402.17753
- **Evidence quality:** Primary research paper; LoCoMo.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Evaluating Very Long-Term Conversational Memory of LLM Agents

**Design inference:** Use long-history temporal context and multi-session dialogue diagnostics alongside real work.

**Limits:** Synthetic/curated conversation recall does not establish external-effect safety or procedural transfer. No paper benchmark rerun here.

**Saved evidence:** `sources/32.md` (local extraction), `sources/32-full.md` (local complete extraction). SHA-256 of substantive snapshot: `8f573f57e32b7814b60e096615566bf25911dc64f9211b982756d31311999a50`.

### S36 — MemoryArena: Benchmarking Agent Memory in Interdependent Multi-Session Agentic Tasks

- **Primary URL:** https://memoryarena.github.io/
- **Evidence quality:** Benchmark authors project page; MemoryArena.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> memorization and action are tightly coupled

**Design inference:** Evaluate interdependent tasks where memory acquired during action helps later action, not recall and behavior separately.

**Limits:** Project-page explanations and selected results are author claims; pair with proceedings metadata S37. No local benchmark replication.

**Saved evidence:** `sources/36.md` (local extraction). SHA-256 of substantive snapshot: `550cd4f768a4236c215d6e5a003b575956573012b5d7e07b12609b344f88b9a5`.

### S37 — Benchmarking Agent Memory in Interdependent Multi-Session Agentic Tasks

- **Primary URL:** https://proceedings.mlr.press/v306/he26am.html
- **Evidence quality:** Primary peer-reviewed proceedings record; ICML 2026 / PMLR.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> Proceedings of the 43rd International Conference on Machine Learning

**Design inference:** Confirms MemoryArena publication and its action-memory evaluation framing.

**Limits:** Proceedings status is stronger provenance than a vendor blog, not proof the benchmark covers WorkAgent privacy, correction or product UX.

**Saved evidence:** `sources/37.md` (local extraction). SHA-256 of substantive snapshot: `40968bb40b8939b5a295701faf879ebeecfb1429779dfbf4fb9dd4fc33ed7c7c`.

### S38 — [2605.12493] LongMemEval-V2: Evaluating Long-Term Agent Memory Toward Experienced Colleagues

- **Primary URL:** https://arxiv.org/abs/2605.12493
- **Evidence quality:** Primary preprint abstract; LongMemEval-V2, 2026-05.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> premise awareness

**Design inference:** Evaluate workflow/GUI/environment knowledge and premise awareness; measure latency as well as accuracy.

**Limits:** Work-in-progress benchmark/preprint; no independent replication. Retrieved latest abstract rather than independently audited dataset.

**Saved evidence:** `sources/38.md` (local extraction). SHA-256 of substantive snapshot: `3657a30c7c0ad6f9c17bc0c37c3bf03cef306f6821c4a6c34609e4f1b6a2b084`.

### S39 — xiaowu0162/LongMemEval-V2

- **Primary URL:** https://github.com/xiaowu0162/LongMemEval-V2
- **Evidence quality:** Authors maintained public benchmark repository.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> the public evaluation harness, data preparation tools, leaderboard packaging utilities

**Design inference:** Provides executable harness/data-preparation/baseline reference for later isolated evaluation; commit pin recorded.

**Limits:** Do not mount private oracle/harness answer data into the product. Repository presence does not mean it was installed or run.

**Saved evidence:** `sources/39.md` (local extraction). SHA-256 of substantive snapshot: `484e6c3fb3f48404866385f47b0d6c9f5e33f761aa51d0c069bfd93a1a45710a`.

### S40 — [2505.11942] LifelongAgentBench: Evaluating LLM Agents as Lifelong Learners

- **Primary URL:** https://arxiv.org/abs/2505.11942
- **Evidence quality:** Primary research abstract; LifelongAgentBench.
- **Retrieved:** 2026-10-23 UTC; web_extract.
> conventional experience replay has limited effectiveness for LLM agents

**Design inference:** Use sequential interdependent tasks and compare relevant experience transfer against harmful/irrelevant replay.

**Limits:** Database/OS/KG benchmark framing is not a request for production shell/DB access. Abstract-level findings, not WorkAgent results.

**Saved evidence:** `sources/40.md` (local extraction). SHA-256 of substantive snapshot: `367dbfbcac0e4bbb4d4f7cd9dc8500c3045845e4be00ef9b8ab042543928d04b`.

## Scope of research and remaining lookup work

This is a multi-category primary-source review, not a systematic literature meta-analysis. Search results were used for discovery only; substantive claims cite retrieved pages. No model/connector/library was installed to reproduce paper results. No vendor security claim was audited. The plan treats its architecture and thresholds as design choices, not as conclusions proved by the papers.

Before implementation, recheck current MCP SDK compatibility, OAuth app review requirements, deployment support for gVisor/microVMs, exact package license/dependency vulnerabilities, and the final parent/lifecycle candidate. Before claiming useful memory, run the paired transfer/negative-transfer evaluation with held-out oracles and explicit budget/privacy approval.
