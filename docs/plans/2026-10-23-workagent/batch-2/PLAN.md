# Batch 2 — A conversational work partner that stays accountable while you are away

> Published research appendix. Read the [controlling parent implementation plan](../../2026-10-23-workagent-next-two-batches.md) first: it updates the baseline, Claude-branch coordination, full Batch 2 document-attachment scope, and current budget. This file is a proposal, not implemented behavior. Snapshot locators refer to the retained local research archive, not published full source pages.

**Status:** research and implementation-ready proposal, NOT implementation authorization or an installed-runtime claim. **Prepared:** 2026-10-23 UTC. **Baseline inspected:** `/home/ubuntu/workagent-general-review-20261022`, HEAD `7a90a40` plus the concurrent, uncommitted proposal-review candidate. Exact inspected-file hashes and dirty status: [repo-evidence-manifest.json](repo-evidence-manifest.json). The checkout can change while the parent integrates; rebase this plan on the parent's final manifest before coding.

**Audience/ownership:** Hermes owns backend, runtime, terminal client, integration and outcome verification. Claude remains the sole web implementation owner. This document specifies web contracts and acceptance obligations; it does not transfer web ownership. Research produced only files in this batch directory. No product-model calls, database mutations, services, installs, repository edits, commits or publication were performed.

**Companion documents:** [verified code map](CODE_MAP.md), [implementation tasks and acceptance matrix](IMPLEMENTATION.md), [source evidence ledger](SOURCE_EVIDENCE.md). Numbers such as [1] reference the source ledger, not assertions that the described products have been independently benchmarked.

## 1. Decision in brief

Build a **Textual conversational client over the existing WorkAgent HTTP/domain runtime**, with a durable event cursor, attachments that use the existing exact-byte contract, and a bounded continuation/checkpoint seam in the existing PostgreSQL execution model. Keep the current scriptable operator CLI and exact-command journal as an escape hatch. Do not put an agent loop inside the TUI. Do not replace PostgreSQL with Temporal, Hermes Kanban or an in-process background thread as a prerequisite for this batch.

This is not architectural conservatism for its own sake. Inspection found existing command deduplication, transactional outbox/run admission, provider I/O receipts, leases/fences, source reauthorization, responsibility wakes and cancellation-observation guards. Replacing them would spend this batch recreating safety rather than delivering a conversational experience. Conversely, retaining the curses UI unchanged would force custom multiline editing, layout, asynchronous redraw and test infrastructure around a JSON viewer. Selective replacement of the presentation layer is proportionate to the evidence.

**First milestone starts with safe CLI/TUI proposal-review parity:** the freshly re-read `operator_client.py:123–127` still has no acknowledgement fields. Preserve legacy format-1 commands exactly; never invent consent on replay. Only a fresh, explicitly reviewed command may contain true acknowledgement flags. Then start an unnamed conversation by typing, attach supported local text, keep typing while the worker runs, see truthful progress without manual refresh, reopen the same work after closing the TUI, steer using the current superseding-message semantics, and review/apply a proposal with the server's loss/older-candidate acknowledgements. All writes use journaled exact envelopes, and all results are read back. Initially this can run on bounded polling; a streaming server is not a dependency for first usefulness.

**Full batch finish line:** the same experience works across TUI and web; scheduled/ongoing work survives worker/API/TUI restarts and execution-slice boundaries; return-to-work shows what changed, what needs the person, what will happen next, and where an ambiguous provider action blocks progress. Cursor replay, snapshot reset, durable notification dedupe, pause/resume/takeover and unknown-outcome semantics are proven under fault injection. Acceptance includes unfamiliar tasks, human changes between unattended waves, and no resupply of already-retained evidence within supported bounds.

## 2. North-star experience — ambitious, not a workflow menu

A person opens a terminal and writes: “Compare these options and keep an eye on the unresolved constraints. I need a recommendation with a usable table.” They attach material, receive a coherent answer and useful saved work, add a correction while execution is active, and leave. The terminal is not the worker. They return through either UI to a concise account: “I incorporated your revised constraint; one source changed; the comparison is ready for review; I am waiting for your choice, not continuing to spend.” The saved table, pending proposal, evidence and conversation remain distinct and directly reachable.

The default screen has:

- A restrained work list with **attention needed**, **active**, and **recent** groupings, not a compulsory project/workflow selector.
- A conversation timeline with user messages, concise assistant responses and result links. Technical requests/tool traces stay collapsed. Never expose raw provider reasoning.
- A persistent multiline composer and visible attachment chips. New work starts without IDs, a title form, or an operator-created conversation.
- A compact status line: verified activity, fresh/stale timestamp, ownership, next scheduled check-in or explicit wait, and the relevant intervention.
- A results/review pane available by keyboard; machine IDs remain copyable in Details, not required to navigate.
- A return summary built from durable transitions, not an invented model recap: new result, changed evidence, pending review, missed check-in, blocked authority, or unknown external outcome.

OpenAI's dots announcement describes channel continuity, progress visibility, redirection, permission boundaries and work that continues between visits [12]. Meta's Muse help page describes natural follow-ups before a response has finished, ongoing context and files/artifacts [13]. These are **documented experience targets**, not verified comparative benchmarks or promises of equivalent access/capability. WorkAgent should emulate the continuity and legibility, not claim their app integrations, file-format breadth, autonomous external authority or performance.

### Interaction rules

1. **Enter inserts a newline; Ctrl+Enter submits** where the terminal supports it; provide a documented fallback such as Alt+Enter/F5 and a visible Send control. Do not depend exclusively on Shift+Enter; terminal encodings differ. Textual keybindings must be tested in real terminals and tmux, not just Pilot.
2. Keep compose focus, selection, scroll position and unsent bytes stable as events arrive. Auto-scroll only when already at the bottom. Otherwise show a “new activity” marker.
3. While work runs, ordinary send is **“Send and redirect current work”**, matching today's backend semantics. It supersedes active runs only after successful admission. Show this consequence inline; never pretend it is non-interrupting steering. A queue-for-later mode is separately specified below.
4. **Stop this run**, **Pause ongoing work**, **Cancel conversation**, and **Take over responsibility** are different actions. Stopping a run does not automatically surrender durable ownership; taking over ends the agent's ongoing obligation; closing the TUI does neither.
5. No artificial typing/progress animation that implies verified advancement. An indeterminate spinner may mean “request in flight,” never “80% complete.” Local UI animation is not evidence.
6. “Saved,” “proposal ready,” “accepted,” “verified preparation,” and “objective achieved” are distinct. A useful draft is not a terminal responsibility outcome.
7. Prefer conversational output and actual work products over requests to fill in workflow fields. A generic solution must work for research, drafting, comparison, lightweight computation, task coordination and later updates without scenario-specific handlers.

## 3. Current facts and material gaps

See CODE_MAP.md for paths, symbols and line ranges. Important verified facts:

- `operator_tui.py` is a synchronous curses JSON viewer with manual `r` refresh, a one-line command mode and ID-based actions. `safe()` deliberately JSON-escapes terminal controls. A prettier replacement must preserve that protection.
- `operator_client.py` calls the same local HTTP service, disables redirect/proxy discovery, uses a private command journal, reserves an envelope **before** the POST, and never automatically retries a write. Follow-up currently emits `attachments: []`; its payload builder currently has no proposal acknowledgement fields. The parent may add minimum parity before this plan starts; do not overwrite it.
- Backend text ingestion already exists: two attachments, 200,000 aggregate UTF-8 bytes per message, exact retained bytes/hashes, strict filenames and inert source/code text. This is not a new binary-upload system.
- `get_conversation` returns messages/runs/turn projections; `/execution` distinguishes provider waiting, recovery, person wait, unavailable and blocked states. Workspace execution currently reports at most 40 recent accessible conversation runs and should not be sold as complete history.
- `conversations._admit_conversation_turn` checks admission/CAS, then supersedes existing runs for human steering. Calling it for a scheduled responsibility does not supersede unrelated work automatically.
- Existing `audit`, `outbox` and `run_dispatches` are durable. Dispatcher cursors are fairness hints, reset safely on restart. They are not a client replay protocol. Outbox consumption is worker scheduling state, not user notification acknowledgement.
- WorkAgent already owns run and responsibility fences, lease secrets, current-authority checks, exact source/revision bindings and provider result retention that can survive revoked publication authority.
- `evidence_context.py` retains same-conversation attachment/proposal/source references for new opted-in runs, reauthorizes on reads, and caps inline bodies at a **shared 32,768-byte budget**. Up to 24 attachments, 20 proposals and 8 sources are catalogued; a file being accepted at ingestion does not imply its full body is available in every later model context. Omission is not absence.
- Proposal review in the current dirty candidate distinguishes the latest candidate and structural content removal. Server acceptance requires acknowledgement flags when indicated and retains CAS/base matching. This is structural detection, not semantic proof that notes still mean the same thing.
- Ongoing lifecycle and execution state are already separate. The generic responsibility run-settlement path can fall back to “human review required”; explicit sustained-continuity actions may supersede that. General slice continuation must target the fallback rather than indiscriminately deleting person waits.
- Historical STATUS reports qualified usefulness results and latency defects. This research did not rerun those evaluations. Parent-supplied current-batch test/review status is context, not a fresh verification by this author, and no installation of the current candidate is asserted.

### Gaps to close rather than rename

A. Conversational composition and result review over HTTP; asynchronous networking and safe rendering.
B. Shared client parity for attachment payloads, review flags, scope/replay and cancellation distinctions.
C. A durable, authorized, bounded activity/change stream with reconnect semantics; no guessing from timers.
D. A responsibility continuation checkpoint at bounded slice/tool/context limits, with explicit stop reasons, rather than a lost objective or an endless automatic loop.
E. An actionable recovery UI for known pending identity, stopped worker, stale lease and unknown send—these cannot share one “Retry” button.
F. Read-cost/latency control that does not erase semantic budget or review classification.
G. A durable return/attention record so restarts do not redisplay or re-send the same notification indefinitely.

## 4. Alternatives and adoption decision

| Choice | What the primary evidence supports | Cost/risk in this codebase | Decision |
|---|---|---|---|
| Evolve curses | Python documents terminal painting, keyboard handling and windows [17]; current UI is tiny and dependency-light. | Must hand-build multiline editing, scrolling transcript, concurrent I/O, focus and test fixtures; existing safe JSON output is not a reusable rich UI. | Keep as legacy/debug fallback during rollout; not the primary conversational surface. |
| prompt_toolkit | Official tests inject `create_pipe_input` and `DummyOutput` [3]; good fit for prompt editing and REPLs. | Viable for a prompt-first minimal client, but a work list, activity view, result diff and modal review still need substantial custom composition. DummyOutput input tests alone do not prove layout. | Fallback if Textual's real-terminal/accessibility spike fails; do not implement two new UIs. |
| Textual | `App.run_test()` runs headless and returns Pilot; keys/clicks and snapshots are documented [1]. Workers support concurrent I/O, cancellation and exclusive read workers [2]. | Adds dependencies, async lifecycle and Rich/terminal-output attack surface; headless tests miss terminal/IME/accessibility issues. Textual worker cancellation must never be confused with backend run cancellation. | Preferred, with a bounded usability/protocol spike and pinned optional TUI dependency set. |
| Hermes interactive CLI/background/goals | Official CLI has resume and rich interaction [4,5,19]; goals persist across turns [15]; Kanban supplies durable worker ownership/checkpoints [6]. | These are product/runtime mechanisms, not a WorkAgent HTTP frontend contract. `/bg` is documented as a separate daemon-thread session, not proof of crash-safe WorkAgent execution. Goal counters/auxiliary judges are not WorkAgent budget authority. Existing bridge report documents accounting and dependency seams still open. | Borrow interaction patterns and checkpoint lessons. Do not launch a second agent per TUI conversation or import Hermes defaults. A future isolated broker adapter remains possible. |
| Temporal | Durable replay checks commands against event history [8]; activities provide timeouts/retries and heartbeat cancellation [9]. | A second scheduler/state owner, determinism/versioning obligations and migration/operational load. Activity retry defaults cannot safely wrap unknown provider sends. WorkAgent's existing receipts, effects, access and budget ledger remain necessary either way. | Not a dependency. Revisit only after measured scheduler scale, cross-host orchestration or timer/replay maintenance costs justify a separate ADR and migration proof. |
| Poll current snapshots | Existing API is usable; few new server changes. | Expensive full readbacks, UI lag, gap detection and since-you-left limited. Current status read already has costly semantics. | First milestone transport, bounded/backed off. Retain as fallback forever. |
| SSE + HTTP commands | WHATWG defines `text/event-stream`, event IDs and `Last-Event-ID` reconnect [10]. One-way state updates fit this product. | Must implement durable replay/retention/auth, buffering/backpressure and fetch-stream parsing; SSE alone is not a queue. | Preferred full-batch transport. |
| WebSocket | RFC 6455 defines bidirectional communication [18]. | Still needs durable cursor/authorization/replay; adds connection command acknowledgements and recovery paths for no current functional need. | Defer; HTTP writes already supply exact command semantics. |

The existing Hermes spike is useful **historical controlled evidence**, not current upstream verification. It recorded extra summary requests beyond a naive iteration count, a Pydantic lock conflict and lack of durable effect-idempotency integration. Modern official documentation is richer, but does not by itself close those code seams. Do not make the batch a framework migration disguised as a TUI project.

## 5. Hard invariants versus targets

### Non-negotiable invariants

- PostgreSQL domain records and effect receipts are authoritative. TUI/widget state, websocket/SSE connections, heartbeat files, notification delivery and model prose never grant work authority.
- Every command has a durable exact envelope before first send. Replaying it preserves ID, route, scope, preconditions, attachments and acknowledgement flags. A changed payload is a new command and requires new review.
- An ambiguous POST is not failure. No automatic write resend, refreshed CAS, generated replacement command or hidden provider retry follows a timeout.
- No automatic regeneration of an unknown provider send/count. Known provider IDs may be observed under the existing narrowly scoped gates and accounting. Unknown usage retains its liability; restart/resume never resets budgets.
- Fences/epochs prevent stale workers from publication. A lease expiring does not prove the external request failed. Receipt-only retention never becomes publication or source-read authority.
- Human revisions, acceptance and original evidence/receipts remain intact. A proposal acknowledgement does not rebase stale proposal bytes or approve unrelated external effects.
- Attached files are untrusted evidence, never instructions, executable tools, credentials or new access grants. No local file is read until explicitly selected.
- Current access and source/dependency authority are rechecked on snapshot, event replay, file read, admission and publication, including after revocation while a connection is open.
- Only an evidenced completion condition closes an objective. Preparation, publication, provider completion and user acceptance each have separate semantics.
- Closing a client does not cancel durable server work. Cancelling a local async request does not prove server cancellation. Every cancellation outcome is read back.
- Never mark research or a controlled replay as live usefulness, paid usage, installed state or production readiness.

### Proposed, not measured, quality targets

These are initial engineering targets to validate and revise with measurements, not contractual latency promises:

- Composer processing remains interactive during network work; target p95 local key-to-render below 100 ms under a 1,000-message virtualized transcript and slow API fixture.
- Under a healthy local stack, target p95 committed transition-to-visible update below 1 second over SSE; polling fallback target within its current poll interval plus API latency.
- Target p95 body-free attention snapshot under 500 ms in the agreed disposable dataset; preserve correct classifications even if the target is missed.
- Target reconnect-to-consistent-view within 5 seconds after API availability for a bounded backlog. Expired cursors may require paginated snapshot restoration; report that time separately.
- Suggested poll cadence: active 2 seconds, idle 15 seconds, backoff with jitter up to 30 seconds; one outstanding request per scope. Tune from query cost, not a desire for decorative motion.
- Suggested SSE heartbeat 15 seconds, reauthorization at least every heartbeat and before each batch; stale UI indication after two missed heartbeats. Existing 120-second worker-file freshness remains a separate liveness input until measured replacement.
- Do not promise end-to-end task completion in two minutes. Measure queue delay, provider latency, tools, projection reads, review and reconnect separately. The plan's engineering time bands are not model-task duration promises.

## 6. Architecture and ownership

```text
Textual TUI ─┐                        ┌─ existing local/Responses worker
Web UI ─────┼─ authenticated HTTP ────┤  dispatcher / responsibility scheduler
CLI scripts ┘   commands + snapshots │              │
                + replay/SSE         └─ canonical service + broker
                          │                         │
                    scoped projections       PostgreSQL transaction
                          │                    commands / runs / receipts
                          └─ work_events <──── audit/outbox + domain change
                                  │
                         notification facts / per-user seen cursor
```

The new event table is a **delivery/read projection**, not a second task ledger. Existing `outbox` consumption and `run_dispatches` continue scheduling. One responsibility remains the ongoing owner; execution slices are replaceable workers with fenced authority. A UI subscribes, never becomes the owner.

### Read projection

Add a body-free `WorkSnapshot` containing: conversation identity/version, current run ID and execution state, current phase label, last durable event time, last worker observation time, connected/fresh flags, responsibility state/next action/wait/check-in, outstanding decisions, output references and actionable blocker. Use explicit nulls for unknown timestamps. Include `snapshot_cursor`, `access_generation` and schema version. Do not request all artifact bodies merely to render the work list.

Keep separate timestamps:

- `last_durable_progress_at`: admitted/recorded result or meaningful state transition.
- `last_worker_seen_at`: liveness observation, not evidence the task advanced.
- `last_provider_observed_at`: trusted observation of that attempt, not inferred from elapsed time.
- `checked_at`: when the read was computed.

Server projections map existing facts into a stable typed model. Frontends must not independently infer truth from a run's color or the last assistant sentence. A server-provided `next_action_code` is a bounded UX hint, never a permission token; the command route still validates everything.

### State axes, not one overloaded status

| Axis | Existing state / proposed projection | Meaning and permitted transition |
|---|---|---|
| Conversation | `open`, `cancelled` | Scope for messages. An active run is not required for an open conversation. |
| Execution slice | existing `queued`, `running`, `ready`, `partial`, `cancelled` | Concrete run authority and outcome; `ready` means this slice's work settled, not objective achieved. |
| Provider attempt | prepared/counting/counted/dispatching/accepted/received/invalid/unknown, derived from ledger | Receipt truth, independent of client connectivity; preserve unknown liability after cancellation. |
| Responsibility | existing `active`, `waiting_person`, `waiting_event`, `blocked`, `paused`, `cancelled`, `taken_over` | Ongoing ownership. Proposed additive `completed` only after a scoped completion receipt; do not backfill it from historical ready runs. |
| Objective outcome | existing unverified/needs_review/evidenced_preparation; proposed explicit achieved receipt | A supported claim tied to acceptance criteria/evidence and current relevant revisions. Agent text alone cannot set it. |
| Decision | pending/current-or-older/stale/accepted/dismissed | Proposal lifecycle. Taking a proposal does not imply all tasks are done. |
| Client delivery | connecting/live/stale/offline/resetting | Availability of the view, never execution state. |
| Notification | outstanding/seen, optionally dismissed by explicit command | User attention state. Reading an event does not accept a proposal or resume a responsibility. |

Full batch need not invent general external-world verification. A completed state is allowed for explicitly verifiable local deliverables or a human completion confirmation; external obligations remain waiting/unverified unless an authorized evidence mechanism exists. First implement a completion receipt with `basis = human_confirmation | verified_local_criteria`, evidence references, criterion IDs and relevant versions. Never convert all `evidenced_preparation` rows into completed.

## 7. Event/cursor protocol

### Existing versus new routes

All paths below are relative to `/v1/workspaces/{workspace_id}` and keep current bearer/schema/request headers.

**Keep:** `GET /conversations`, `GET /conversations/{id}`, `POST /conversations`, `POST /conversations/{id}/messages`, `POST /conversations/{id}/cancel`, `GET /execution`, existing artifact/history/proposal routes and `assignments/{id}/responsibility` routes. Do not rename working routes merely for UI polish.

**New:**

- `GET /work-snapshot?conversation_id=<id>&cursor=<page>&limit=<n>`: body-free scoped state with a watermark. Work-list pagination and event continuation tokens are different types.
- `GET /events?after=<opaque>&limit=<n>&conversation_id=<id>`: authorized durable page. Response `{schema_version, events, next_cursor, has_more, reset_required, checked_at}`. `has_more` uses an authorized lookahead; no approximate totals.
- `GET /events/stream?after=<opaque>&conversation_id=<id>`: the same events via SSE. `id` is the exact opaque cursor; `event: work.changed` or a closed event enum; JSON `data` uses `WorkEvent`. Emit heartbeat comments without advancing durable cursor. Control event `snapshot.required` instructs resnapshot after an expired/incompatible cursor; never silently jump to “now.”
- `GET /commands/{command_id}`: scoped, body-minimized receipt/status lookup for the current principal, not arbitrary private journal inspection. Return known accepted receipt or a bounded not-found response; a temporary absence during an in-flight transaction is not permission to resend.
- `POST /attention/seen`: exact command sets a monotonic seen cursor for this principal and scope. Seeing is not accepting.
- `POST /runs/{run_id}/stop`: new exact-run scoped stop with expected fence/work version, rather than misusing conversation cancellation. Preserve unknown external liability.
- Optional-but-in-batch follow-on once core concurrency is proven: `POST /conversations/{id}/intents`, `GET /conversations/{id}/intents`, `POST /conversations/{id}/intents/{intent_id}/cancel` for explicit queue-for-later. Existing `/messages` remains superseding send, so existing clients are not reinterpreted.
- `POST /assignments/{id}/responsibility/complete`: proposed human completion confirmation, requiring expected work version and completion evidence/statement. It is not artifact acceptance. If objective completion is not needed for the first release, expose existing evidenced-preparation honestly and do not fake completion; full-batch state-axis acceptance still applies.

### Envelope and durability

`WorkEvent` contains only a closed `type`, opaque `event_id`, `conversation_id`, optional run/assignment/artifact/proposal IDs, `aggregate_version`, `occurred_at`, `access_generation`, bounded reason code, and affected read-model keys. It contains no raw prompt, file body, model reasoning, token, lease secret or exception text. The authenticated client refetches permitted details. Untrusted titles are rendered as text, never markup.

Persist meaningful domain transitions in the same transaction as the canonical change, not after a successful HTTP response. Include command admission, phase/receipt settlement, artifact/proposal publication, control/steering, responsibility wait/wake/next-action changes and newly actionable failures. Do not persist one event for every idle poll or spinner frame. Receipt observation while cancelled may emit a **receipt-settled/unapplied** fact without changing the cancelled run.

**Ordering trap to avoid:** a bare PostgreSQL sequence is not commit order. If transaction A reserves event 41 and commits after B's 42, a client that advanced past 42 can lose A. Proposed implementation: allocate a workspace stream position through a locked `work_event_heads` row held until commit; all event-producing transactions use the same allocator and documented lock order. Existing scope/domain locks precede the event-head lock, and no domain locks are acquired after it. Receipt-retention paths must be audited for this order without adding a current-grant requirement that breaks late receipt retention. Deadlock and delayed-commit tests are required. Rollback rolls back the head increment/event. Never reuse a worker fairness cursor as a public cursor.

Snapshot reads use one repeatable-read transaction to collect authorized state and the committed event watermark. Paginated workspace snapshots need a bound snapshot token or an explicit restart-on-change protocol; do not claim cross-page consistency from existing UUID pagination. Prefer initial per-conversation snapshots and a bounded work-list page with explicit freshness, followed by invalidations; implement a retained snapshot-token manifest only if the full list requires an exact consistent export.

Opaque event cursors bind workspace, principal/scope, access generation and schema version, are length-bounded and validated, and cannot broaden access. Do not expose a global sequence that leaks other tenants' traffic. Access-generation changes invalidate old cursors and force authorized resnapshot. Recheck permission on every replay page and before emission, not only at connection open.

At-least-once delivery is expected. Reducers dedupe by event ID and ignore stale aggregate versions; apply the event to local state before persisting the cursor. Reconnect uses the last applied cursor, not the last byte received. Keep a small bounded pending buffer and coalesce invalidations. A slow client is disconnected with recovery guidance rather than retaining an unbounded queue. Proposed default page size 100, hard cap 500, frame cap 16 KiB; these are tunable proposed limits.

Retention proposal: retain client event projections for 30 days with a bounded per-workspace storage cap, **not** canonical receipts/history. On expiry return explicit cursor-expired/reset semantics and a current snapshot. Acknowledge that the lost fine-grained client timeline is unavailable; do not synthesize historical events. Retention requires a separate owner-run maintenance path, not unrestricted runtime DELETE.

### Transport details

SSE is a transport, not persistence [10]. PostgreSQL `NOTIFY` can wake subscribers after commit, but is not a durable queue and notifications are visible to database users [11]. Payload should be a constant invalidation or opaque key only; poll the authorized durable table to catch missed wakes. No prompts/filenames in NOTIFY.

Native browser `EventSource` does not give the current web client a general custom-header API. Current WorkAgent routes require bearer and schema headers. Prefer a fetch-stream parser through the existing same-origin server proxy, preserving its origin/client checks and keeping the bearer server-side. Claude owns this implementation. TUI uses an independent read connection with the existing strict loopback scope. Never put bearer tokens in URL query strings. Test buffering/proxy flush, abort cleanup, malformed UTF-8/frame limits and revocation. If streaming is unavailable, fall back to `/events` polling, not resubmitted commands.

## 8. Attachment ingestion and continuity

### Stage A: parity on the existing contract

Implement terminal file selection/explicit `/attach PATH`, remove, inspect and preflight. Use `AttachmentInput`/generated contract for admission; don't widen extensions or silently lowercase/rename disallowed names. Show why a name is rejected and let the user choose an allowed display filename explicitly. Read selected regular files with no symlink following, bounded read before allocation, UTF-8 strict decoding, no newline/BOM normalization, NUL rejection and no hidden recursive directory scan. File paths never go to the server—only the explicit filename/content/mime envelope. Show bytes, retained hash and inert status.

Because the HTTP body is limited to 256,000 bytes and `operator_client` currently uses JSON serialization that escapes Unicode by default, validate **actual encoded request bytes**, not only raw attachment bytes. Quotes, controls, backslashes and non-ASCII can inflate JSON beyond ingestion limits. Prefer a single explicit UTF-8 serializer (`ensure_ascii=False`) shared with request-size preflight while preserving hash basis over content bytes. Failing preflight must retain the composer and read no additional files. The server remains authoritative.

Snapshot attachment bytes in the journal before send. Replaying an ambiguous command must not reopen the local path (which may now contain changed content). Never re-read CAS or acknowledgement flags on replay. Expand journal format explicitly, migrate/read old format-1 records without rehashing their historical envelopes, and reject incompatible/corrupt records safely. Protect journal/draft directories and files with existing private ownership/mode/no-symlink rules; attachments make unredacted local storage larger and more sensitive. Provide explicit local journal/draft retention documentation, not automatic cleanup of unresolved commands.

Cross-UI tests reuse `contracts/message-attachments.json` and existing attachment vectors: exact BOM/CRLF, multibyte limits, uppercase extension, malicious filename, empty/NUL/invalid UTF-8, aggregate size and server body size. Source-looking `.py`, `.sh`, `.html` and `.sql` remain **inert**. Terminal output removes/visibly escapes CSI/OSC/other control sequences and bidirectional spoofing in labels; disable Rich markup for untrusted content. Never run shell interpolation from a selected filename. OWASP recommends allowlists, size limits, distrust of MIME and separated storage [14]; these are layered controls, not a guarantee that a parser is safe.

### Stage B: retrieve retained text without repeating it

Keep original message attachments immutable. Add `GET /conversations/{id}/attachments/{ref}` for metadata and bounded text ranges (line or byte ranges with explicit encoding-safe boundaries), and an internal broker `read_attachment` capability accepting only a retained ref/hash and bounded range. Both authorize the owning conversation and relevant target/source context on every call. Admission alone does not grant arbitrary filesystem access. Inline context remains bounded; a metadata catalog should state `available_for_scoped_read`, `omitted_inline`, `not_authorized` or `unavailable`, rather than equating “not inline” with “missing.”

Freeze refs/hash/selection cutoff in the run context, and explicitly log which chunks informed a result. A changed human message/target version invalidates only appropriate work under existing fences. The worker must not fall back to stale unauthorized bytes after revocation. Retained attachment access must work in scheduled responsibility turns without the person re-uploading the same file. A 200,000-byte accepted file need not be fully copied into every prompt; scoped retrieval is the bridge between ingestion and the 32,768-byte evidence budget.

### Deliberately excluded from this batch's binary contract

PDF/DOCX/XLSX/image/audio support is desirable but not a free extension of text MIME. Treat it as a separately authorized sub-batch with blob storage outside webroot, upload quotas, quarantine, magic/signature detection, parser sandbox/no network/no credentials, CPU/RAM/wall-clock/expanded-byte limits, malware/CDR policy, extraction provenance and original-versus-derived hashes. No macros, scripts, archive extraction, remote URL ingestion or OCR/model calls by default. Proposed initial binary caps must be selected after parser spike measurements—not advertised now as existing support. Format breadth does not block the text-first complete batch; the TUI must clearly label supported formats.

## 9. Composer, steering, cancel and review semantics

### Commands and local drafts

Create a reusable typed command builder so TUI and script mode share semantic payloads, but keep a synchronous CLI path. Draft state is local, private and keyed by endpoint/workspace/principal/conversation. Persist text, selected attachment snapshots, intended target and draft edit version; never persist bearer credentials. Switching conversation or reconnecting must not overwrite another draft. “New chat” is create-then-send using separate exact commands; if creation succeeds and sending fails, resume the created conversation, do not create another.

The send button moves through **draft → journaled → sending → admitted/readback pending → confirmed** or **outcome unknown**. It does not clear the draft on mere HTTP initiation. A confirmed readback ties to the exact command/message; duplicate clicks share the in-flight command ID. Client errors display sanitized codes and recovery choices. GET reconnect can retry with bounded backoff; writes require an explicit exact replay or a fresh user action.

### Steering now versus queue later

Phase 1 keeps backend `/messages` behavior: a successfully admitted human message supersedes active runs and advances conversation work version. Label it honestly. Existing provider calls may still settle; cancelled results remain unapplied where required.

Queue-for-later is a **new intent resource**, not a frontend timer that will send after a spinner stops. It retains text/attachment snapshot, author, creation command, expected input/target versions and queue order; it is visible in both UIs and cancellable before admission. Only the server claims it under the conversation lock. On admission revalidate access, sources, grant and budget; if context drift makes a targeted request stale, mark `needs_review`, do not silently refresh exact target. Preserve the original queue command separately from the derived message-admission receipt. A queued message is accepted as pending intent, not claimed to have started a run.

No mid-provider-request prompt injection is proposed. True non-interrupting `/steer` at a safe tool boundary would require a separately pinned input revision and revalidation of subsequent actions; Hermes documents that experience [5], but current WorkAgent semantics differ. For this batch provide superseding send and durable queue, not a misleading emulation of Hermes `/steer`.

### Cancellation and control

- **Stop this run:** atomically fence only that run; retain outputs and receipts, stop future publication/work from the old capability, and show provider cancellation as best effort/unknown until observed. Ongoing responsibility explicitly transitions to a person-controlled wait or paused state according to the displayed choice; it must not immediately restart the same work behind the user's back.
- **Pause responsibility:** existing human control path; stop admission and fence current work per current semantics, preserve plan/check-in and explain how overdue ticks coalesce on resume.
- **Resume:** new authorized work from latest context, never regeneration of an unresolved historical attempt. Display blockers before offering the command; server checks again.
- **Take over:** durable `taken_over`, no autonomous revival; saved work stays accessible. “Cancel conversation” is a separate whole-conversation action.
- **Quit UI:** detach only. A running POST thread may still complete; persist unknown state before closing, then inspect on reopen. Don't use Textual `exclusive=True` for writes: it can cancel one local worker when another starts [2]. Exclusive cancellation is appropriate for obsolete GETs only.

### Structured-note editing regression (fresh parent live finding)

The parent reports a freshly installed-candidate live exercise in which **5 note objects containing embedded newlines displayed as 17 lines and could not be saved unchanged by the current line-oriented 10-note editor**. The parent explicitly replaced intra-note line breaks with spaces to continue, dropping no text. This is a disclosed workaround, **not PASS for unchanged save or lossless round-trip**. This report does not establish any other installed-candidate capability and was not independently replayed in this research.

Source inspection locates the seam: `web/src/lib/flexible.ts:426` `notesFrom()` splits on newline, while `FlexibleWork.tsx` joins `body.notes` with newline for the edit control and assigns `notesFrom(notesText)` back to the structured table. Backend `flexible_models.py:90` limits the **array to 10 notes**, not each display to 10 visual lines. The current representation is not lossless: an embedded newline and an inter-note separator collapse to the same delimiter.

Claude must implement a structured list of note editors (one multiline text control per note), with explicit Add/Remove/Reorder controls and the limit applied to objects, not displayed lines. Keep note text bytes/Unicode/newlines and array order intact on untouched open/save; no trim/filter/join/split normalization on that path. Stable UI-local IDs may identify editors but must not add unauthorized IDs to the existing `string[]` wire format. Ordinary cell edits must not rewrite notes. Explicit user note changes remain legitimate human edits and must be visible in the diff. TUI note editing must use the same object semantics rather than copying the line parser.

Add the reported five-note/seventeen-displayed-line fixture, an exact 10-note fixture with multiline content, duplicate notes, blank lines within a note, leading/trailing spaces and trailing newlines. Assert `decode(encode(notes)) == notes`, unchanged body-hash/readback where the operation is a no-op, and preservation across cell-only edits, proposal review and both UIs. An actual save may append a revision under existing semantics; that revision's body must remain byte-equivalent for unchanged fields. Increasing the limit, deleting blank lines, flattening newlines or asking the person to manually repair generated content does not satisfy the regression.

### Review acknowledgement

Use current server `ProposalReview`: latest candidate marker, total removal count, bounded displayed removals, exact base/current revision. No default-checked acknowledgement. Show full review details on demand; if only 20 removals are displayed, state that detection count is larger and expose a bounded paginated detail route or current/proposed bodies for further inspection before acceptance. Never suggest the displayed sample is exhaustive.

Pass `acknowledge_removed_content` and `acknowledge_older_proposal` only after explicit actions for this proposal and base. A newly changed review resets local acknowledgements. Stale base, version conflict or source drift demands a new review/new proposal, not a forced rebase. Read back accepted status and exact new current revision. Generic “Continue” must never mean accepting a proposal. Model agents cannot call a human acceptance surface.

## 10. Durable continuation, leases and recovery

### Preserve the authority chain

The canonical chain remains: responsible owner → plan/dependency version → wake ID/review fence → run admission → run fence/lease → exact request/operation hash → provider/local receipt → fenced publication. A client reconnect, model context summary or worker PID cannot replace any link.

Use existing `run.fence`, `responsibility_fence`, work versions and `access_generation` as the real epochs. A proposed `worker_instance_id`/boot identity is diagnostic, not a new competing publication authority. Heartbeats may diagnose a lost process but do not renew grants or establish completion. Reclaimed work gets a new fence; old results may be retained as evidence but cannot mutate current human work.

### Checkpoint at every safe boundary, not only at exhaustion

New `continuation_checkpoints` records are immutable typed facts keyed by `(workspace, responsibility_id, predecessor_run_id, checkpoint_ordinal)` and written transactionally with the corresponding local result/stop transition. Contents:

- owner, conversation and responsibility IDs and exact work/input/dependency versions;
- predecessor run, latest settled phase/operation IDs and receipt refs;
- desired outcome and acceptance-criterion refs, unresolved criteria, next executable action **description**;
- saved artifact/current/proposal refs and attachment/source manifests, not an unbounded transcript copy;
- reason `slice_limit | context_budget | time_slice | waiting_event | waiting_person | authority_block | unknown_external_outcome | objective_complete`;
- actual reservations/usage references and remaining-authority snapshot for display, never a transferable allowance;
- `eligible_after`, observed external-operation state, attempts/circuit-breaker counters and next-owner mechanism;
- schema/runtime compatibility version and diagnostic summary marked non-authoritative.

A free-text handoff is useful for comprehension, but admission reconstructs authority and context from canonical refs. A missing prose summary cannot lose acknowledged tool results. Save incremental structured checkpoints after meaningful local/tool receipt boundaries so hard kill at the cap still leaves deterministic recovery information. Offer a model-facing pre-cap warning while a tool-capable step remains (Kanban uses such a pattern [6]), but do not depend on model compliance for persistence.

### Successor admission

For a continuing responsibility with a safe settled predecessor, a durable continuation link records at most one successor per checkpoint. In one authorized transaction: revalidate owner/scope/current plan and sources; prove no unresolved send blocks the conversation; consume the eligible checkpoint; admit a new run with a fresh fence and latest permitted context; store predecessor/successor binding and event. A crash after commit reuses that successor; a crash before commit leaves the checkpoint eligible. Unique constraints enforce one successor.

Per-slice tool limits remain finite. A slice ending is not lifetime task completion. Automatic continuation is permitted only when a previously authorized responsibility still has an executable next action, relevant settled progress and remaining budget. Explicit person waits, pause/takeover/cancel, missing access, semantic uncertainty and unknown provider effects prevent automatic continuation. Routine preparation should not need blanket human review solely because it crossed a tool budget; consequential acceptance still does.

Suggested initial runaway policy: one active slice per responsibility, workspace concurrency configurable with existing provider limits, bounded successor waves, and a no-material-progress detector keyed to canonical refs/result hashes. After three repeated no-progress checkpoints (proposed threshold), park with a diagnostic rather than spend indefinitely. Do not falsely call “no progress” when observing a valid long-running known provider response; that is a time/event wait with read budget and deadline. Test thresholds with long and short tasks before tuning.

### Crash/recovery classification

| Durable boundary at crash | Safe recovery | Forbidden shortcut |
|---|---|---|
| Before command reservation/send | Restore unsent draft; user may send. | Claim it was queued. |
| POST may have committed, no receipt | Inspect command/readback; explicit exact replay only under existing dedupe. | Generate a new command ID/CAS automatically. |
| Run queued, no claimed provider operation | New worker claims through ordinary authority and fence gates. | TUI runs provider directly. |
| Prepared step, durable proof it was never dispatched | Existing bounded unsent settlement/admission rules apply. | Treat all timeouts as unsent. |
| Provider dispatch recorded, no known identity | Quarantine unknown; retain reservation and show explicit resolution need. | Automatic regeneration on restart, retry, lease expiry or new framework activity. |
| Known provider identity, no terminal result | Bounded GET observation under current read authority/accounting; settle exact identity. | New create/send or rebinding to successor grant. |
| Terminal result retained, no local effect | Reconsume retained result under a fresh valid capability and exact effect binding, if allowed. | Ask provider to generate it again. |
| Local effect committed, acknowledgement lost | Read exact operation/result receipt and advance idempotently. | Rerun side-effect tool from a prose checkpoint. |
| Cancelled run later gets trusted terminal receipt | Preserve cancelled state; record unapplied receipt/disposition, then allow only ordinary NEW admission if unblocked. | Publish cancelled output or erase unknown history. |
| Slice cap with settled results and authorized next action | Checkpoint → one successor; shared budget unchanged. | Infinite same-run extension or asking the user to repeat the objective. |
| Budget/authority/access exhausted | Durable blocked reason and required resolution. | Allocate money, reset counters, widen connectors or grant new authority. |
| Host/client restarts during notification delivery | Reopen durable attention fact, dedupe by transition identity. | Treat disconnected UI as lost domain work or resend an unknown external message. |

Compatibility: a checkpoint is pinned to a schema/runtime version. An upgrade may translate only explicit supported versions, with preservation tests; incompatible continuation is blocked with repair guidance. Do not replay old provider requests under new prompts/consumer hashes. Existing migrations are immutable and checksummed; allocate new migration numbers after the parent finishes its batch.

## 11. Notifications and return-to-work

Create `attention_items` as a derived durable fact for meaningful transitions: decision needed, new reviewable result, authority/budget block, unknown outcome, missed check-in, or responsibility completion. Key dedupe by `(workspace, recipient, conversation, transition_type, source_event_id)` (and a material-change key when coalescing repeated equivalent blocks). Keep separate `seen`/dismissed state. A streamed replay of the same event must not ring again or create another row. A subsequent genuinely changed blocker is new information.

First delivery is in-app and optional terminal bell, with a one-session quiet mode; do not send email/Slack/push or request connector credentials. External notification delivery would require a durable outbox, send claim, receipt/unknown disposition and channel-specific authorization. Hermes cron's distinction between output, durable handoff and unknown delivery is relevant [7], not permission to call those channels here.

Use a server per-principal seen cursor for cross-UI continuity. Opening the page is not sufficient to mark every hidden item seen; mark only the visible/explicitly acknowledged scope. The return summary can say “2 new decisions” only from authorized counted rows, not a guessed badge. Scope removal/revocation must remove cached private titles and prevent notification payload disclosure.

## 12. Rollout, dependency boundaries and cost controls

- This document authorizes **nothing beyond research**. Implementation begins only after the user/parent activates the batch and selects the final candidate. No production deployment or private connector authorization is implied.
- Isolate implementation from the current dirty review checkout. Preserve parent changes; do not commit this plan into that tree without a separate decision.
- Dependencies: first parity/TUI uses current endpoints; durable event work follows the shared read contract; continuation depends on verified runtime receipt/fence tests; web changes wait for Claude's agreed contract. Binary attachments and a new agent harness are separate.
- Select Textual and pytest-asyncio/snapshot-tool versions during the spike; pin and lock them in an optional `requirements-tui` group compatible with backend Python. No guessed current version or install occurred in this research. Record transitive dependencies/licenses and import-cost measurements before merging.
- Use controlled providers and disposable PostgreSQL for default tests. No live product models until the integration owner confirms the current cumulative authorization, remaining headroom, approved route, synthetic-data boundary and existing unknown liabilities. Historical STATUS amounts are not a fresh budget reading.
- Separate development-tool costs from product-model reservation/billing. No auxiliary judge, title model, recap model or “smart retry” is added invisibly. Deterministic titles/return summaries suffice for the first batch.
- Instrument status query counts/durations before optimization. Preserve canonical budget/review checks; add indexes/bounded projections or measured caching keyed to authority generation rather than dropping fields to meet a timeout.
- Suggested engineering planning bands (not guarantees): first vertical milestone about 4–7 focused engineer-days; durable events/notifications 4–7; continuation/fault coverage 5–9; cross-UI integration/review 3–5. Some can overlap, but lifecycle changes and two-owner contract review dominate uncertainty. Re-estimate after the first spike and actual query/protocol profiling; don't add these bands as a promised calendar date.

### Largest risks and stop conditions

1. **False recovery:** any duplicate provider send or stale publication is a release blocker; stop and diagnose, do not weaken the test.
2. **Authority split:** if a proposed event/queue/checkpoint becomes a competing work owner, simplify back to canonical assignments/runs before shipping.
3. **Status cost:** streaming notifications without cheap projections can increase load. Bound request concurrency, coalesce reads and test actual SQL counts.
4. **Input loss:** background refresh replacing the composer, or queue admitting stale targeted intent, is a blocker.
5. **UI trust:** terminal escape/markup injection or leaked file text in logs/events is a blocker.
6. **Long-task starvation:** one provider wait must not block unrelated ready work. Preserve dispatcher fairness and measure multiple responsibilities, not one happy path.
7. **Over-scoping:** binary parsing, external notifications, full agent-harness migration and generic collaboration are explicitly not prerequisites. If they consume the first milestone, stop and resequence.

## 13. Handoff and completion contract

Every implementation increment updates a durable handoff with: exact candidate/hash, changed files/migration checksums, acceptance rows completed and untested, commands run/exit status, controlled versus live evidence, budget state source, outstanding unknowns, exact next task and named owner. A tool/session limit must leave this record plus a saved next-action artifact; it is not a product completion event or an active-worker claim.

The first milestone is done only when its named user journey is exercised, not when Textual starts or unit tests pass. The full batch is done only when the IMPLEMENTATION.md acceptance matrix, independent safety review, real-terminal checks and Claude's web integration evidence are satisfied. A failed real task can remain a useful finding, but it is not labeled PASS because an easier fixture worked. Installation/deployment is a separate explicitly authorized operation with exact readback, preserved data and rollback plan.
