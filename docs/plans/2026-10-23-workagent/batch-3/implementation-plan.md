# Batch 3 — reusable tools, bounded connectors, and inspectable learning

> Published research appendix. Read the [controlling parent implementation plan](../../2026-10-23-workagent-next-two-batches.md) first: it updates the baseline, Claude-branch coordination, full Batch 2 document-attachment scope, and current budget. This file is a proposal, not implemented behavior. Snapshot locators refer to the retained local research archive, not published full source pages.

> **Status: research and implementation proposal only. No implementation, product-model call, connector authorization, database mutation, service start, or paid evaluation was performed.**
> Prepared 2026-10-23 from the read-only checkout `/home/ubuntu/workagent-general-review-20261022`. Hermes owns backend/runtime/integration; Claude remains sole web owner. The parent is completing safety/review work concurrently. Every new path, route, schema, migration, threshold, and test below is **PROPOSED**, not an installed capability or grant.

## 1. Product outcome: broad ambition, useful increments

WorkAgent should become a general, persistent work partner: take an ordinary request, find permitted context, choose and compose real tools, produce editable work, learn inspectable lessons, and continue across assignments, interruptions and changed evidence. The user should not have to select an industry workflow, prepare internal IDs, repeat supplied materials, or curate an agent's tool menu. Planning is one task family, not the architecture.

The ambitious endpoint is a durable work workspace containing:

- Real research, file/text/document/spreadsheet manipulation, data analysis, code/test execution, and isolated browsing; generated views are presentations of authorized state, not hidden agents.
- A small, well-integrated set of connector adapters that can grow through MCP and native APIs, with understandable scopes, revocation, read-only defaults and explicitly approved writes.
- Reusable methods and specialist workers when they measurably help, not mandatory multi-agent ceremony.
- Inspectable facts, preferences, episodes and procedures; useful transfer across assignments without leaking private context, treating source instructions as authority, or silently converting a one-off correction into a permanent global belief.
- Evidence-linked exports, changing-evidence refresh, exact-version revisions, preserved human edits, resumable work, truthful uncertainty, and attributable costs.

This is an endpoint, **not a claim of present parity with dots, Muse or Hermes**. Official dots and Meta Muse pages document desired experience dimensions—continuity, connected context, artifacts, steering and memory—not measured WorkAgent performance ([S08, S10](source-evidence-ledger.md#experience-targets)). No competitor account or benchmark trial was used.

### First shippable slice: a useful cross-assignment workspace

Ship one coherent vertical experience before adding connector breadth:

1. From ordinary conversation, ingest scoped UTF-8 files and tabular inputs; read/patch exact versions, compute generic results with bounded Python, retrieve public evidence, and export a document plus a data file with a reproducible observation trail.
2. In a later assignment, recall an **explicitly reviewed** preference or procedure and its source; apply a correction to that scope without changing another project. Show “used these memories” and make correction/forget accessible.
3. Preserve the parent's safe proposal-review and human-edit behavior. Resume after worker interruption without duplicate output or unaccounted execution.
4. Exercise a native **read-only public GitHub metadata adapter** through the same registry/permission machinery. Test private/OAuth behavior only against synthetic or provider test fixtures until separate access approval.
5. Evaluate changed-evidence research, editorial work and data analysis end to end. Exercise software/ops with a supplied synthetic code bundle and isolated tests. Personal administration starts with synthetic supplied records, not a real inbox. Planning remains one varied scenario.

This is not “memory CRUD plus a tools settings page.” A user must complete useful work using both real computation and scoped recall. Conversely, a connector marketplace, global memory graph, arbitrary shell, autonomous account access and full office-suite fidelity are not prerequisites to that first slice.

### Delivery sequence

| Increment | User-visible result | Main dependencies | Not yet claimed |
|---|---|---|---|
| A — safe extension seam | Existing tools remain usable; new tool discovery explains scope and missing permission; richer exact-version files and exports | Parent safety batch and lifecycle/TUI contract | No new private access |
| B — general workbench | Generic analysis, text edits, bounded code/tests, cited public research, downloadable outputs | Registry, workspace refs, sandbox worker, budgets | No production shell or arbitrary packages |
| C — inspectable continuity | Reviewed memory helps a different assignment; corrections, conflicts, expiry and forget are visible | B's provenance; lifecycle restart/cancel; memory UI | No proven general self-improvement |
| D — connector pilot | Public GitHub reads; optional separately authorized private read pilot; revoke works during in-flight work | Registry/policy, token vault, revocation tests | No mailbox-wide grant, no writes by default |
| E — wider agency | Isolated browser, richer office files, reviewed procedures, bounded delegates, then approved external writes | Evidence from B–D and explicit gates | No thousands-of-apps promise |

B and C can overlap after schemas are agreed; Claude can build the review surface against fixtures while Hermes implements typed services. The point of sequencing is useful delivery, not preserving artificial demo limits.

## 2. What exists, what is missing, what must not regress

The [verified code map](verified-code-map.md) and `code-snapshot.json` identify inspected files and hashes. At initial inspection the branch was `9324205…`; later it was `be87cc9…` with parent safety changes. Do not interpret this document as a frozen release audit. Reconcile the final parent SHA before implementation.

**Existing, narrow but real:** typed capability discovery and reviewed skill loading; unauthenticated bounded HTTPS text retrieval; invoice-specific CSV arithmetic; import-free i64 Wasm execution; JSON inspection; document/table/custom-view drafts; exact-version proposals and readbacks; current-conversation saved work/evidence; bounded cross-conversation literal search under existing grants; persistent responsibilities and cost reservations. Public fetch has SSRF defenses and untrusted-source labeling. The generated-view iframe and broker are distinct from a general computation workspace.

**Missing/generalization needed:** general file workspace and binary artifact store; generic data transforms and Python execution; web search and rendered browsing; native/MCP connector lifecycle; durable typed memory with user review; provenance snapshots spanning tools and memories; provider-independent tool budget accounting; transfer and negative-transfer evaluations.

**Do not rename old evidence into new capabilities.** Invoice reconciliation is not a spreadsheet engine. Wasm i64 kernels are not Python, shell or an arbitrary filesystem. `search_work_context` is not a learned memory system or permission to search all prior work. A published table is a draft, not proof its numbers were computed. A sandboxed custom view is not an authorized browser.

**Parent safety baseline:** the latest checked-in evaluation reported a useful but partial day/week experience, unsafe intermediate proposal choices, review overflow and high latency. The parent is addressing those issues. Batch 3 depends on their final safe-review behavior; it does not claim they remain unresolved or that this research fixed them.

### Dependency on conversational TUI and lifecycle batch

Before enabling new tools, require an agreed lifecycle contract supporting ordinary conversation, durable responsibility identity, bounded continuations rather than lifetime turn ceilings, human steering/cancellation, and restart-safe receipt settlement. New tools and memory must work through both the conversational TUI and web; neither may require operator-only database setup or product-specific handler selection.

Required integration points:

- Distinguish **waiting for user permission**, **waiting for external observation**, **budget exhausted**, **blocked tool**, **cancelled**, and **outcome evidenced**; do not equate a retained intermediate artifact with task completion.
- TUI and web show the same tool/connector/memory status DTOs, approval state and retry explanation. Avoid duplicating an authority engine in the TUI.
- A cancelled/revoked run may settle an already incurred cost but must not apply its late artifact, promote memory, or restart another tool.
- Save material human edits as current state; generate proposals against exact bases. A memory update cannot bypass artifact review.
- Tool and memory events should push progress or use existing event mechanisms; do not add expensive polling loops that worsen the observed latency.

## 3. Architecture: keep WorkAgent authoritative; reuse selectively

### Decision summary

| Area | Recommendation | Alternatives and tradeoffs |
|---|---|---|
| Agent orchestration | Retain WorkAgent responsibility/run/grant/revision authority; generalize its typed broker | Embedding an unconstrained Hermes process is faster superficially but introduces another task, auth, memory and tool loop; reject as runtime default |
| Tool/skill ecosystem | Adapt reviewed Hermes patterns and selected compatible utilities; keep MIT notices and pin source revision | Reimplementing every parser/connector wastes effort; importing all tools inherits host and secret assumptions. See [S01–S04, S42](source-evidence-ledger.md#hermes) |
| Connector abstraction | Small native adapter interface plus MCP adapter; native public GitHub pilot first | MCP provides interoperability, not safe permissions, tenancy or complete connector behavior |
| Memory | WorkAgent-owned relational, versioned records and provenance; start lexical retrieval, add vectors only behind the same ACL boundary | Letta/Mem0/Graphiti are useful maintained design references; adopting an entire memory service adds tenancy, deletion and spend integration before proving value |
| Compute | Retain import-free Wasm; add one constrained Python worker image behind an isolation service | Wasm-only is too restrictive for everyday data/software work; a host shell is too broad; gVisor or a microVM offers a better boundary than plain Python filtering |
| Rendering | Keep inert artifacts and current sandboxed custom views; browser work gets a separate isolated service | Giving generated views connector tokens or arbitrary parent actions would collapse the current boundary |
| Search/evidence | Brokered search provider plus existing hardened fetch, exact snapshots and explicit refresh | Model-generated URLs and remembered snippets are not fresh source evidence; a rendered browser is a fallback, not a substitute for provenance |
| Delegation | Optional read/work children with narrowed authority and shared budget; parent owns acceptance | Unbounded agent swarms increase cost and conflicting edits; defer until single-worker evidence identifies useful parallelism |

Do not copy Hermes profile memory files, credentials or user sessions into WorkAgent. Hermes's memory/skills/session design is an upstream reference, not permission to inspect the operator's private history. The retrieved Letta README directs current source development to `letta-ai/letta-code`; do not assume an older API/tutorial is the maintained integration target ([S35, S41](source-evidence-ledger.md#memory-research-and-maintained-implementations)).

### Execution chain

`intent → capability discovery → concrete typed call → policy/grant resolution → cost reservation → immutable inputs → isolated/native adapter → observation → reauthorize → retained result → artifact proposal/memory candidate → human acceptance where material`

The model selects actions and arguments. The application derives the principal, allowed resources, credential handle, grant generation and budget from authenticated run state; none are accepted as model authority. The same policy path covers native, MCP, browser and child-worker tools.

### Capability is not permission

**PROPOSED `CapabilityDescriptorV2`:**

```text
id, version, schema_sha256, implementation_sha256, transport(native|mcp|sandbox|browser),
input_schema, output_schema, effects(read|local_compute|draft|external_write),
resource_kinds, privacy_classes, execution_profile, cost_profile,
result_byte_limit, timeout_ms, retry_policy,
installation_state, availability_reason, required_permission_template
```

Discovery reports installed capability separately from current authorization: `available`, `needs_consent`, `blocked_by_scope`, `temporarily_unavailable`, or `not_installed`. No secret resource titles leak through unavailable descriptors. A schema update invalidates frozen tool selection; it cannot silently broaden an existing grant.

**PROPOSED `ToolGrantV1`:** principal/workspace; task/project/user-scope binding; allowed capability IDs and pinned versions; exact resource selectors; permitted effects; privacy/egress policy; expiry; access generation; budget account and limits; optional approval evidence. An implementation descriptor never generates its own grant.

**PROPOSED `ToolCallV1`:** only `call_id`, `capability_id`, `capability_version`, typed `arguments`, exact input refs, and `expected_work_version`. The broker adds run/attempt identity and grant bindings. No free-form principal, unrestricted URI, executable command string, connector token or acceptance flag is accepted.

**PROPOSED `ToolObservationV1`:** call/attempt identity, pinned adapter/profile, exact input hashes, output refs/hashes, start/end timestamps, status, structured error, truncation/omission flags, source refs, privacy label, reserved/observed/unknown costs and verification scope. A successful HTTP response is not `task_complete`.

Checks occur at discovery, argument resolution, immediately before dispatch, after result return, before model-context inclusion, and before any retained publication. Revocation cannot retract bytes already sent to an authorized provider: record that limitation rather than promising it can. Never publish or reuse a late result after scope loss.

### Cost and retry contract

Extend—not replace—the existing provider-attempt/reservation ledger. Maintain a shared budget account for model tokens, search requests, extraction/rendering, compute duration, connector API costs and delegated workers. Entries distinguish `reserved`, `provider_reported`, `estimated`, `unknown` and `reconciled`; `unknown` is not zero and reservations are not billing. Record local CPU/time even where marginal dollars are not known.

Reserve conservatively before every paid or capacity-limited call; atomic parent+child reservations prevent oversubscription. A task can stop with a useful partial artifact when its cap is reached. Existing unknown/historical spending is never reset to admit this batch. Backend account billing is not inferred from elapsed time. Writes require stable idempotency keys and provider-aware retry; uncertain outcomes go to reconciliation, never blind repeat.

## 4. Tool workspace and reusable capability roadmap

### Files, text and artifacts

Use opaque `workspace_file_id`/`version_id` refs backed by content-addressed blobs, not arbitrary host paths. Ownership is `(workspace_id, principal_id, work_area_id)` plus explicit share/assignment bindings. Resolve through ACLs; no user-selected absolute paths, symlinks, archive traversal, device files or host mounts. Filename is display metadata only.

Initial actions: `files.list`, `files.read_range`, `files.create_draft`, `files.propose_patch`, `files.compare`, `artifacts.export`. Patches require exact base hash and preserve BOM/newline metadata when relevant. Exact human edits win via conflict, not silent overwrite. Each read discloses omitted/truncated ranges; a missing excerpt is not evidence of absence.

Start with UTF-8 text/Markdown/JSON/CSV; extend to XLSX, DOCX and PDF through isolated parsers and exporters. Validate MIME by bytes plus allowlist; cap expanded archive size, entry count, nesting, text extraction and parser time. XLSX formulas/macros/external links are not executed; formula presence is explicit. PDF text-layer extraction and OCR have separate cost/accuracy evidence. Preserve original blob and extraction-version provenance. Downloads use content disposition, `nosniff`, scoped access and a server-computed digest. No blob becomes public through a guessed URL.

Exports are real files, not a promise in chat: Markdown/TXT/CSV/JSON first, XLSX next, DOCX/PDF when rendering tests exist. Export manifests cite input and artifact revisions, tool observations and parser versions. CSV formula-injection protections must distinguish safe numeric negatives from formula content. Include human annotations in supported exports or prominently report omitted fields.

### Generic data and code

Add a generic bounded data API for column selection, typing, filtering, grouping, joins and aggregations, with explicit null/decimal/timezone semantics. Reuse these operations through Python rather than adding invoice/procurement/planning handlers. A model-authored table remains a draft; a calculation observation points to actual executed code/input/output.

**PROPOSED Python profile `python-analysis-v1`:** immutable pinned image; fixed runner argv, no shell endpoint; read-only staged inputs; isolated writable output directory; non-root process; no application/vault/database mounts; no ambient credentials; network denied; fixed packages (stdlib initially, reviewed pandas/openpyxl additions); no `pip install`; process-tree kill, CPU/memory/PID/disk/output/wall limits. The backend calls the isolation service with signed scoped input refs, never executes generated Python in the application process. Static import checks are defense-in-depth, **not** a sandbox.

Candidate initial limits for implementation testing—not existing authority: 30 seconds wall time, 512 MiB memory, 64 PIDs, 32 MiB output storage, 128 KiB combined stdout/stderr. Calibrate against useful CSV/code tasks before launch; limit changes are profile versions, not model requests. Cross-tenant resource isolation and outbound denial must be exercised adversarially. Reuse gVisor if compatible with deployment; choose a microVM if stronger isolation or kernel compatibility requires it. No fallback to ordinary host subprocess on failure ([S20, S21](source-evidence-ledger.md#sandbox-and-connector-authentication)).

Software/ops tasks use supplied source/log bundles and explicit test entrypoints inside this worker. They can produce patches, diagnostics and test results, not alter a deployment or connect to production. Package installation, real repository credentials and privileged commands are later, separately scoped capabilities. Code can be useful without exposing a general shell.

### Research and browser

Keep `public_retrieval.py` defenses; add `research.search` as a provider adapter. Record query, returned candidates, retrieved URL/final URL, fetch timestamp, status/redirects, content hash, extracted text hash, extractor version, selected quotes and omissions. User-private query terms cannot be sent to a public search provider merely because read access exists; require an egress grant or ask to redact.

A source snapshot is evidence, not instructions. Repeated URL fetches create new versions. A downstream artifact cites the version used; refreshing evidence marks dependent conclusions potentially stale and proposes revisions without rewriting the earlier assessment. Human factual corrections and new external evidence may conflict: represent both with attribution.

Add an isolated public browser only after static search/fetch is useful. No ambient account cookies, clipboard, host downloads or private network access. DOM reads, screenshots and narrowly typed navigation/form actions are separate from mutating clicks. Downloads return quarantined blobs. Logging into a service is a new connector authorization, not an extension of public browsing. Cross-origin redirects and navigation recheck network policy. Generated views never inherit browser or connector permissions.

## 5. Connectors, MCP, OAuth and external effects

### Practical pilot

1. Native public GitHub read adapter: read a named public repository's issue/release/README metadata and exact version; public rate limits and failures are observations. No code execution from README instructions.
2. Synthetic OAuth/MCP resource server exercises consent, auth failures, expiry, per-principal cache partitioning and revoke races without any real account.
3. **Only after explicit user approval:** one private read pilot, preferably a GitHub App installed on an explicitly selected test repository. Request selected repositories and only the permission needed (for example issues read, not contents/write by default). Public OAuth documentation is design evidence; we did not authorize a GitHub App.
4. Alternative personal-admin pilot: a separately approved test calendar or mailbox with the narrowest provider scopes, and precise time/folder filters enforced in WorkAgent even if provider scopes are broader. “Read-only” can still disclose highly sensitive information; it is not low-risk by definition.

Choose the pilot based on a real task, not connector count. Gmail/Calendar/Drive may be a valuable later adapter, but no existing approval is assumed. Third-party MCP relays are an additional processor and require explicit endpoint, data-retention and vendor review.

### MCP protocol reality discovered in this research

The official version page retrieved on 2026-10-23 identifies **2026-07-28 as current**, and 2025-11-25 as older. The current lifecycle page describes per-request `_meta`/HTTP versioning and `server/discover`, rather than the older initialization-only model. Do not implement from remembered 2025 guidance. Keep an explicitly pinned legacy adapter only for servers/SDKs that require it; test actual SDK compatibility before adoption ([S25–S29](source-evidence-ledger.md#mcp-current-protocol-and-security)).

Use a maintained MCP SDK, not a new JSON-RPC stack. Its adapter must provide:

- Reviewed server identity, protocol pin, transport/endpoints, schema digest, approved tool subset and bounded discovery pagination. Unknown/new tools are not automatically enabled.
- Current authorization discovery/resource indicators/audience validation; issuer binding and PKCE; exact redirect allowlist and CSRF protection; no token passthrough. Stdio servers execute pinned code in an isolated worker with a minimal environment, never arbitrary user-configured host commands.
- Treat tool descriptions, annotations, resources and all results as untrusted. Server `readOnlyHint` is not authority; WorkAgent's reviewed effects classification controls dispatch. An MCP tool result cannot activate another server, approve an effect or install a skill.
- Cache tool lists and resources by principal, connector, granted scopes, protocol/schema version and access generation. A shared cache must not replay another user's tools/data. Metadata URLs and redirects get SSRF checks too.
- Disable or reject unsupported server-initiated sampling, elicitation, roots, tasks and UI extensions until their authorities/budgets are modeled. Protocol support does not imply those features are granted.

### OAuth/token lifecycle

**Connect:** UI presents provider, named account/resource selection, permissions/effects, data destination and retention. Start an authorization-code flow bound to authenticated principal/workspace, exact connector configuration, nonce/state, PKCE and expiry. Keep pending flow state server-side; reject login CSRF, callback replay, issuer mix-up and redirect mismatch. Record consent receipt separately from tool grants.

**Store:** only encrypted token material in a dedicated vault/secret service using envelope encryption and a rotating key identifier; application rows contain opaque credential refs, issuer/audience/scopes/expiry and account metadata minimized for display. Tokens never enter model prompts, memory, generated views, tool stdout, URLs or logs. Prevent URLs containing authorization codes/query secrets from entering the research ledger. Refresh in the credential broker with concurrency locking and provider-specific rotation/reuse handling.

**Use:** mint/select short-lived resource-scoped credentials when supported. GitHub documents installation token expiry and narrowing by repositories/permissions; enforce local constraints even if the provider token is broader. Do not forward WorkAgent session tokens to remote MCP services. Separate connector authorization from each task's right to read that connector.

**Revoke:** locally disable first, increment access generation, cancel queued/in-flight work, invalidate caches and block refresh; call provider revocation/uninstallation endpoint as appropriate; remove usable secrets; read back local state and provider effect where supported. Keep honest `provider_revocation_pending/failed` state if disconnected. An access token expiring later is not proof of immediate provider revocation. Late responses cannot be retained or sent to a model after local revocation. Mark dependent memories unavailable or stale according to retention policy; explicitly decide whether earlier authorized artifacts remain. Never silently retain connector content as “learned preferences.”

### Approved writes are a later, explicit feature

A write preview includes destination/account, exact payload diff, resource version, recipients, attachment hashes, privacy implications and cost. Approval binds those exact bytes, task/principal and expiry. Revalidate at dispatch. If stale, re-preview. Confirmation is not a vague “do what is needed.” Ordinary reversible local drafts do not require repeated consent; external publication, messages, scheduling, purchase and irreversible changes do unless bounded standing authority explicitly covers them.

Record idempotency keys, provider receipt and exact postcondition readback. Handle timeout-after-effect as `outcome_unknown`; reconcile before retry. No product-model response or connector source text can supply approval. This research does not authorize any write trial.

## 6. Inspectable memory, not an invisible self-modifying prompt

Issue #10 calls for scoped recall, separate evidence/preferences/inferences, corrections, provenance and learning across work—not an unbounded journal. Current literal search is a valuable starting point, not something to discard ([S11](source-evidence-ledger.md#workagent-product-context)).

### Memory classes and scopes

| Class | Example | Admission and expiry |
|---|---|---|
| Fact | “This project's export timezone is UTC” or “source version says deadline X” | Attribution and valid-time required; source fact is not a user command; expire/refresh when source changes |
| Preference | “For this project, use concise headings” | Explicit statement or reviewed inferred candidate; project by default; user-wide only when explicitly chosen |
| Episode | “Attempt Y failed because input schema changed; corrected version succeeded” | Evidence-linked event summary; outcome must be observed, not the agent's self-rating; retention limits |
| Procedure | “For this export, validate column types before joining” | Versioned method with applicability, counterexamples, validation and rollback; reviewed before cross-assignment use |

Scope hierarchy is **task → explicit project/work-area membership → owner-user within this workspace**, not automatic inheritance across every workspace. No existing `project_id` is assumed: initially map a project to an explicit work-area scope binding; add richer project membership later if the lifecycle batch establishes it. Shared project memories and private user preferences are distinct ACL types. “Same person” alone is not authorization to move confidential project facts into unrelated work.

### Record shape and operations

**PROPOSED `MemoryRevisionV1`:**

```text
memory_id, revision_id, workspace_id, owner_id,
kind(fact|preference|episode|procedure), scope_kind(task|work_area|user), scope_id,
subject_key, predicate_key, content, content_sha256,
status(candidate|active|contested|superseded|expired|forgotten),
origin(human_explicit|human_reviewed|tool_observed|agent_inferred|external_source),
source_refs[], evidence_event_ids[], proposed_by_run_id, reviewed_by_principal_id,
confidence_label, confidence_basis, sensitivity, source_acl_dependencies[],
valid_from, valid_until, recorded_at, expires_at,
supersedes_revision_id, contradiction_group_id, applicability,
validation_refs[], extraction_method_version, access_generation
```

Confidence is qualitative and explained initially (`explicit`, `observed`, `inferred`, `uncertain`), not an uncalibrated numerical probability. Missing evidence lowers usability, not only rank. Precise source locators and content snapshots support inspection. Store secrets nowhere in this schema; redact tokens and avoid extracting sensitive personal categories by default.

Model tools: `memory.search`, `memory.read`, `memory.propose`. Human-facing services: review/accept, edit/correct, scope change, expire, forget, export and inspect usage. Agents cannot call `accept`, `promote_scope` or overwrite active procedures. Automatic episodic bookkeeping may retain a minimal task-local observation; broad/material use requires review. A user's explicit “remember for this project” can create an active scoped record with a visible receipt and undo; inferred durable learning is a candidate.

**Material memory review** is required for cross-assignment procedure adoption, inferred preferences, broadening scope, sensitive content, changing a standing preference, or changing what later autonomous work does. Batch summaries can group related candidates so the user is not asked to approve every sentence. The UI explains anticipated effect (“applies to future briefs in Project A”), source, conflicts and scope; it does not display a generic “memory improved” toast.

### Retrieval and context budget

1. Resolve task/owner/project authorization and source dependency ACLs **before** search/ranking, counts, title exposure or embeddings.
2. Retrieve active applicable memories plus unresolved corrections/conflicts; combine bounded lexical search with exact subject/predicate keys. Only introduce vector retrieval when lexical baselines show real misses; embeddings are sensitive derived data and require their own deletion/egress policy.
3. Prefer explicit, applicable corrections over superseded values, but never use a global newest-wins rule. Fresh marketing content cannot overrule a human preference; an outdated human factual claim is not automatically more accurate than current evidence. If authority/time/applicability cannot resolve the conflict, expose it and ask or abstain.
4. Return compact evidence with why selected, source/version/valid-time, scope and omission flags. Freeze a manifest for each model request and reauthorize before use. New corrections invalidate unsent context; do not rewrite already-sent receipts.
5. Include `memory_used` refs in outputs where material. Logs retain access decisions and IDs, not duplicate private payloads.

Proposed starting budget: at most 6,000 characters of memory excerpts and 12 candidates per retrieval; total context still passes `request_packing.py`. Caps are tunable resource policies, not a success target. Follow explicit drill-down for relevant omitted evidence. Do not dump all history into every run or include negative information about unauthorized memories.

### Nonmonotonic corrections, forgetting and transfer

Corrections append a version and supersession/conflict edge; they do not silently rewrite the past. For “10 minutes, not 15,” preserve the old provenance but stop serving it as current. For “10 minutes this week only,” preserve the earlier preference outside the valid interval. Undo creates an explicit restoration revision. A corrected memory's descendants (summaries, embeddings, procedures and scheduled contexts) become stale and must be recomputed or excluded; deletion cannot leave a stale vector cache serving the old fact.

Forget is a real scoped operation: remove active payload, search entries, vectors and derived caches; revoke frozen manifests for future sends; maintain only a minimal non-content tombstone/audit record if needed. Backups have a documented retention/deletion schedule and restore-time tombstone replay. Explain that already exported artifacts, user-visible history or content already transmitted to providers may require separate deletion and cannot be magically unsent. Offer the choice to remove referenced local artifacts where the user has authority, without destroying others' saved work silently.

Evaluate positive transfer **and negative transfer**: a learned concise-writing preference should help another appropriate brief, not shorten a legally required notice or leak Project A into Project B. Procedures are hypotheses supported by observed episodes, not automatic policy. Keep a rollbackable version and compare against no-memory and raw-history baselines.

## 7. Proposed schema, routes, paths and migration strategy

This section is implementation direction, not installed schema. Start additive; old receipts and prepared requests remain immutable and readable with their old validators. New behavior is negotiated by run/profile schema versions, not retroactively added to old grants.

### Tables and constraints

| Proposed table | Required fields/invariants |
|---|---|
| `capability_installations` | workspace/global-reviewed installation, ID/version/schema+implementation hash, effects/profile, enabled state; immutable version rows |
| `tool_grants` | principal/workspace/scope selectors, capability pins, effects, privacy/egress, expiry, generation, budget/approval refs; no implicit user-wide grant |
| `tool_attempts` | run/call/attempt identity, descriptor/argument/input digest, reservation ref, execution state, result refs, timestamps; unique logical call key; append-only outcome/settlement history |
| `workspace_files`, `workspace_file_versions` | workspace/owner/work-area, opaque refs, parent revision, blob hash/MIME/size/extraction metadata; compare-and-swap current version |
| `source_snapshots` | original/final URL or connector locator, external version, fetch time, blob/extraction hash, parser pin, trust/privacy/ACL dependencies, truncation; immutable evidence version |
| `connector_accounts` | principal/workspace/provider, minimized account ref, scopes/resource selectors, opaque vault ref, state, expiry, generation, consent receipt |
| `connector_auth_flows` | short-lived principal-bound state/PKCE/issuer/redirect/nonce record; consumed-once; no persistent code/token logging |
| `connector_revocations` | generation, local block timestamp, provider request/outcome, retries/errors; no loss of local revocation if provider fails |
| `memory_items`, `memory_revisions` | stable item/scope and versioned record above; immutable content revisions except privacy erasure protocol; active pointer CAS |
| `memory_evidence`, `memory_usage` | exact source/version/ACL refs; per-run retrieval manifest and selection reasons; no private payload copied into usage rows |
| `memory_relations`, `memory_tombstones` | supersession/contradiction/derived-from edges; cycle rejection; erasure version and restore replay marker |
| `tool_cost_entries` | shared budget/account, attempt, category, amount/currency/unit, reservation/observed/unknown status; parent-child spend attribution |

Every tenant-owned primary lookup includes workspace and authorized owner/scope; foreign keys include workspace where possible. App-role grants forbid direct authority escalation, mutable receipt history and token reads. Source ACL loss propagates to derived memory eligibility before ranking. Transactional fences serialize human edits, revocation, grant generation and publication. Do not hold database locks across network calls; reserve/freeze in one transaction, perform IO, then revalidate and settle in another.

### Proposed migration files

At inspection, migrations ended at `046_cancelled_receipt_terminalization.sql`. Exact **proposed**, unreserved filenames:

1. `backend/migrations/047_tool_workspace_and_provenance.sql` — capability/installations/grants/attempts, files, snapshots, shared tool-cost entries.
2. `backend/migrations/048_inspectable_memory.sql` — memory tables, scoped indexes, revision/supersession/erasure constraints.
3. `backend/migrations/049_connector_authority.sql` — connector accounts/auth-flow references/revocation lifecycle; no token plaintext.

If the parent/lifecycle batch takes these numbers, rebase and renumber before merge; never overwrite another migration. Supply rollback-by-disable and database backup/restore verification rather than destructive down-migrations. Do not backfill all historical conversations into memory. Legacy context search remains available under its original grants. Migration fixtures must prove retained artifact bodies/human notes/receipts/reservations unchanged and old unknown attempts still unknown.

### Proposed module ownership

**Hermes — new:** `backend/workagent/capabilities/{models,registry,policy,broker,observations}.py`; `backend/workagent/workspace_files.py`; `backend/workagent/source_snapshots.py`; `backend/workagent/artifact_exports.py`; `backend/workagent/sandbox/{client,profiles,runner_protocol}.py`; `backend/workagent/connectors/{base,github_read,mcp_client,oauth,vault,revocation}.py`; `backend/workagent/memory/{models,store,retrieval,corrections,review,forget}.py`; `backend/workagent/tool_costs.py`.

**Hermes — extend:** `composition.py`, `products.py`, `public_retrieval.py`, `work_context.py`, `evidence_context.py`, `request_packing.py`, `provider_attempts.py`, `responses_ledger.py`, `api.py`, `models.py`, `operator_tui.py`, `prompt_cli.py`; regenerate `contracts/openapi.json`, `contracts/src/schema.d.ts` and affected alpha types through `backend/export_contracts.py` and `contracts/package.json` (`npm run generate`; then `npm run check`). Avoid turning `service.py` into another enormous dispatch switch; compose services and retain current authoritative checks.

**Claude — proposed UI:** `web/src/components/{ToolActivity,ConnectorConsent,ConnectorSettings,MemoryReview,MemoryInspector,MemoryUsage,WorkspaceFiles}.tsx`, matching `web/src/lib/client/api.ts` / `web/src/lib/client/real-api.ts` wrappers and fixtures. Integrate into existing conversation/result shell; no separate memory application. Keep machine detail secondary. The exact insertion points are agreed with Claude, not implemented by Hermes.

**Contracts:** `contracts/capability-registry-v2.json`, `contracts/tool-observation-v1.json`, `contracts/workspace-files-v1.json`, `contracts/memory-v1.json`, `contracts/connector-consent-v1.json`; generated schema snapshots from typed models, not hand-edited divergent copies.

### Proposed routes

All use existing authenticated `P`/workspace checks, nonenumerating unauthorized responses, typed pagination and existing idempotency/version conventions. Mutation commands include expected generation/current revision and idempotency key.

```text
GET  /v1/workspaces/{ws}/capabilities
GET  /v1/workspaces/{ws}/runs/{run}/tool-attempts
GET  /v1/workspaces/{ws}/tool-attempts/{attempt}
GET  /v1/workspaces/{ws}/work-areas/{area}/files
POST /v1/workspaces/{ws}/work-areas/{area}/files
GET  /v1/workspaces/{ws}/files/{file}/versions/{version}
POST /v1/workspaces/{ws}/files/{file}/proposals
POST /v1/workspaces/{ws}/artifacts/{artifact}/exports
GET  /v1/workspaces/{ws}/exports/{export}/download
GET  /v1/workspaces/{ws}/source-snapshots/{snapshot}
GET  /v1/workspaces/{ws}/memory
GET  /v1/workspaces/{ws}/memory/{item}
POST /v1/workspaces/{ws}/memory/candidates
POST /v1/workspaces/{ws}/memory/{item}/review
POST /v1/workspaces/{ws}/memory/{item}/correct
POST /v1/workspaces/{ws}/memory/{item}/forget
GET  /v1/workspaces/{ws}/runs/{run}/memory-usage
GET  /v1/workspaces/{ws}/connectors
POST /v1/workspaces/{ws}/connectors/authorization-flows
GET  /v1/connectors/oauth/{provider}/callback
POST /v1/workspaces/{ws}/connectors/{connector}/revoke
GET  /v1/workspaces/{ws}/connectors/{connector}/status
```

Do **not** expose a public arbitrary `POST /tools/execute` that accepts a principal/grant in its body. Model calls enter the existing run-bound broker. OAuth callback derives the workspace from authenticated pending flow state, never caller-controlled scope. Artifact exports bind exact revisions and return a job/status if asynchronous. MCP resources are not blindly proxied as public URLs.

## 8. Ordered implementation tasks and executable verification plan

These are future tasks after approval. Commands below have **not** been run as part of this research. Use an isolated checkout/database and synthetic fixtures. Do not point tests at the live DB or inherit its provider credentials.

### T0 — reconcile parent contracts and freeze baseline

- Read final parent safety/lifecycle/TUI handoff, SHA, migrations and generated-client changes; record unresolved limitations.
- Confirm unsafe intermediate proposals, human-note preservation and review containment behavior remain covered; verify exact budget/authority state without resetting it.
- Establish an isolated DB and fake provider/connector adapters. Document schema version/capability toggles and denial paths.
- Deliver `docs/plans/batch3-tool-memory-contract.md` and a short Claude interface handoff. No broad framework rewrite.
- Tests: existing `test_proposal_review.py`, `test_sustained_continuity.py`, `test_saved_work_retrieval.py`, `test_work_context_search.py`, `test_evidence_continuity.py`, `test_cancelled_response_receipts.py`, `test_ledger_summary_projection.py`; reconcile names against the final parent tree.

### T1 — registry, policy and accounting seam

- Implement descriptors/grants/attempt observations and wrap existing capabilities without changing their behavior or old frozen schema hashes.
- Add migration 047's first tables and a run-profile opt-in. Validate strict inputs/outputs and typed errors. Add shared cost reservation categories.
- Failing tests first: descriptor alone cannot execute; model cannot supply principal or escalate effects; schema drift invalidates a call; revoked generation blocks pre/post IO; concurrent reservations cannot exceed cap; late cancelled result settles cost only.
- Deliver new discovery/tool activity DTOs and old/new catalog compatibility tests. Existing public fetch/JSON/Wasm tests still pass.

### T2 — scoped files, provenance and exports

- Add versioned blobs and exact refs; range reads; file patch proposals; immutable extraction and source snapshots; text/CSV/JSON exports.
- Extend download service without weakening existing `FileBody` guarantees. Support binary export through a new typed blob representation, not by stuffing bytes into a text field.
- Tests: traversal/symlink/archive abuse, MIME mismatch, Unicode/BOM/newlines, hash mismatch, unauthorized IDs/counts, stale base/human concurrent edit, formula injection, download digest and readback, source refresh retaining old evidence.
- Browser acceptance with Claude: create/edit/export/reopen; no lost active input; explanation and source details accessible at desktop and 390px phone.

### T3 — bounded Python and generic data work

- Implement isolated runner service adapter and fixed image/profile. No product process `eval`, arbitrary shell or network. Add cancellation/resource telemetry and crash cleanup.
- Supply generic data operations, safe module set and exact input/output manifests; later add reviewed XLSX parsing/export.
- Tests: real arithmetic against independently calculated expected values; missing/null/decimal/timezone cases; malicious Python trying network, `/proc`, host path, subprocess, fork/resource exhaustion; result truncation; timeout/restart; no host fallback; no publication after revoke.
- User-visible exit: the agent computes a real non-invoice data task, exports the dataset/chart or summary, revises after changed input and preserves a human annotation. An isolated software patch/test bundle provides a second domain.

### T4 — public research and connector seam

- Add search provider adapter with explicit egress/cost policy; exact snapshots and changed-source dependency flags.
- Implement public GitHub adapter and the common connector interface. Add synthetic OAuth/MCP server tests. Pin current protocol/SDK support and allowlisted tool schema digests.
- Tests: source prompt injection asking for secrets/permission expansion; redirect/private-IP metadata SSRF; stale/empty extraction; misleading result snippet; search query leaking private memory; MCP schema changes/tool poison; principal-specific cache isolation; current and legacy version adapters.
- No real account consent in this task. Public metadata only until T7 approval.

### T5 — inspectable memory store and correction semantics

- Add migration 048; explicit scoped records and candidates; source attribution; review/correction/forget services. Reuse exact-version and access-generation patterns.
- Retrieval combines current scoped memory with existing raw-context search; no auto-migration of history. Log selected/omitted evidence and why.
- Tests: preference scope, disputed fact, time-bounded exception, correction invalidating summaries, supersession cycle, stale revision CAS, source revocation, sensitive-data filter, cross-project/user noninterference, forgotten content absent from indexes/cache/restored backup, malicious source unable to promote a procedure.
- User-visible exit: a later assignment benefits from reviewed memory; a correction changes only applicable future behavior; user can inspect and remove it without editing database rows.

### T6 — surfaces and longitudinal paired evaluation

- Claude integrates connector/memory review and tool activity into web; Hermes integrates the same DTOs into TUI. Show reasons for unavailable tools and memory use rather than internal jargon.
- Run the [evaluation protocol](evaluation-plan.md) on isolated synthetic work first, then explicitly approved public/sanitized tasks within fresh spend authority. Hold oracles outside product-visible files/context.
- Fix general mechanisms exposed by unfamiliar tasks; do not hardcode answers/domain handlers. Record all failures and user interventions.
- Acceptance is useful completed work, maintained human edits and safe recovery—not tool count or a favorable one-shot model score.

### T7 — separately approved private read pilot

- Obtain named provider/account/resources/scopes/data-egress/model processing/retention/spend approval. Provision vault references through operator auth UI, never chat secrets.
- Connect one test resource, perform task reads, inspect data lineage, revoke during queued and in-flight reads, verify provider/local outcomes, then attempt reuse and prove denial.
- Record provider-specific limitations. If the narrow provider scope is insufficient, ask for a specific expansion; never silently request full account access.

### T8 — measured expansion, not a second runtime

- Add isolated browser, richer office formats, optional vector ranking and procedural methods only where earlier failures justify them.
- Add delegated workers with child grant intersection, parent budget/cancel propagation, bounded concurrency, immutable task inputs and separate output proposals. No worker can spawn broader authority or accept another worker's changes.
- Design and test exact-payload approved writes only after the read pilot. Explicit approval is required for any real external-effect trial.

### Future command examples

From the isolated implementation checkout's `backend/` (not this research task):

```sh
.venv/bin/python -m pytest -q tests/test_capability_policy.py tests/test_tool_attempts.py tests/test_tool_costs.py
.venv/bin/python -m pytest -q tests/test_workspace_files.py tests/test_source_snapshots.py tests/test_artifact_exports.py
.venv/bin/python -m pytest -q tests/test_sandbox_runner.py tests/test_generic_data_tools.py
.venv/bin/python -m pytest -q tests/test_memory_scopes.py tests/test_memory_corrections.py tests/test_memory_forget.py tests/test_memory_retrieval.py
.venv/bin/python -m pytest -q tests/test_connector_oauth.py tests/test_connector_revocation.py tests/test_mcp_adapter.py
.venv/bin/python -m pytest -q tests/test_proposal_review.py tests/test_work_context_search.py tests/test_evidence_continuity.py tests/test_cancelled_response_receipts.py
```

New test filenames above are proposed. Add migration tests with the real restricted PostgreSQL app role and retention snapshots, not mocks only. Run `npm run generate` and `npm run check` from `contracts/` (the latter checks canonical export and generated TypeScript drift). Claude runs `pnpm typecheck`, `pnpm lint`, `pnpm test` and targeted Playwright journeys using existing scripts. Sandbox tests run against actual isolation, not a fake “denied” return value. Ordinary fixtures prove mechanism safety; paid agent trials prove usefulness separately.

## 9. Gates, acceptance and research risks

### Authorization gates

- **Current task:** planning/public research only. No authority for any new private connector, model spend, deployment, migration or external effect is inferred.
- **Implementation gate:** explicit approval of this batch and isolated environment; parent/lifecycle contract reconciled; backend/web ownership retained.
- **Compute gate:** reviewed runner isolation, operational patching, resource controls and no-secret/no-network adversarial tests before arbitrary generated code.
- **Model/evaluation gate:** named allowed provider/model/data classes, per-trial and aggregate spend/call/time caps, current unknown costs accounted; stop when exhausted. Existing historical ceiling is not a new allowance.
- **Private access gate:** explicit account/resources/scopes, model/processor egress, retention and revoke expectations; read-only is still a privacy decision.
- **External write gate:** exact effect authorization and approved test destination; never infer from permission to research or read.

### Acceptance matrix

**Hard failure:** unauthorized read/write/egress; credential exposure; cross-scope memory leak; accepted human work overwritten; fabricated observation/citation; forgotten memory served; duplicate external effect; spend beyond cap; unsafe proposal presented as automatically safe; denial bypass via MCP/browser/worker.

**First-slice product acceptance:** unfamiliar tasks produce useful editable artifacts and real exports; computations are executed and reproducible; changing evidence can be revisited without resupply; a later assignment uses justified memory and honors correction/forget; recovery preserves work and accounts for costs; the user can see and steer consequential operations from both intended interfaces.

**Do not declare general learning from recall scores.** LongMemEval and LoCoMo diagnose retrieval and correction; MemoryArena and LifelongAgentBench motivate transfer during action; AgentDojo motivates permission-boundary adversarial trials; tau-bench motivates repeated reliability. Published scores are not directly comparable to WorkAgent and vendor results are not independent replication. See the ledger for evidence quality and limits.

### Open risks and choices to resolve with evidence

- MCP has moved beyond commonly remembered 2025 lifecycle semantics; SDK support may lag. Test pins rather than assuming compatibility from the protocol page.
- Sandbox isolation has real operational cost; gVisor is not protection against every kernel/application side channel or unrestricted outbound access. MicroVMs improve isolation but add startup and maintenance burden.
- Memory extraction can invent durable falsehoods or amplify a transient preference. Explicit review reduces harm but can increase user effort; measure review burden and false-positive candidates.
- Vector recall can improve matching but complicates privacy/deletion and can resurrect stale meaning. Start simpler; compare on missed cases before adopting.
- Broad connector scopes may defeat per-resource consent expectations. Local filters help but do not change provider token reach; tell the user the actual grant.
- Pure source snapshots can retain private data beyond revocation. Make retention semantics explicit and exercise deletion dependencies, not only token expiry.
- General file/code support creates parser and supply-chain attack surfaces. Pin images/packages, track upstream vulnerabilities, scan outputs and enforce no ambient authority.
- More tools can increase latency, retries and planning overhead. Measure context discovery size, unnecessary calls, first useful artifact latency and total user effort; tool count is not success.
- Permission conservatism can make the product annoying. Use bounded standing authority for routine local work, and reserve reviews for material memory/effect changes.
- No evidence currently establishes superiority to dots, Muse or upstream Hermes. The appropriate near-term comparison is a frozen WorkAgent baseline on paired tasks, with documented experience gaps rather than marketing parity.

## 10. Deliverables and planning completion

This research package contains the substantial implementation plan, separate evaluation protocol, verified code map, source evidence ledger, source snapshots and machine-readable provenance manifests. It is ready to turn into an implementation branch after approval, but it is **not** an implementation or a verification of future behavior. The source ledger identifies unavailable pages, truncation, vendor claims, paper limitations and the protocol-version discovery. No runtime state or user account was touched.
