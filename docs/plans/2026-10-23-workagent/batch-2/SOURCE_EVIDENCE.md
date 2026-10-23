# Source evidence ledger

> Published research appendix. Read the [controlling parent implementation plan](../../2026-10-23-workagent-next-two-batches.md) first: it updates the baseline, Claude-branch coordination, full Batch 2 document-attachment scope, and current budget. This file is a proposal, not implemented behavior. Snapshot locators refer to the retained local research archive, not published full source pages.

Retrieved **2026-10-23 UTC**. Raw extraction results are saved alongside this document in `sources/source-NN.json`; `sources/retrieval-index.json` maps every request, including a failed guessed URL. `citation-ledger.json` is the machine-readable first-seen URL registry. URLs are mutable live documentation, not pinned implementation versions.

## Evidence discipline

- Quotations below were programmatically checked as exact substrings of the retained extraction text before this file was written. Ellipses are not added inside those quotes. Markdown/code punctuation is retained from extraction.
- Some long pages were head/tail truncated by extraction; raw records preserve that limitation and any tool cache footer. Claims here use retained text; no unseen middle section is treated as inspected. Local raw JSON is sufficient to recover the cited quote without depending on ephemeral cache files.
- Primary source categories include UI framework/test docs, official agent runtime/goal/scheduling docs, durable workflow orchestration docs, web transport standards, PostgreSQL semantics, security guidance, and two official product experience descriptions. These are not independent benchmarks; multiple pages on one vendor are not multiple independent experiments.
- Read-only local code inspection is a separate evidence category, in CODE_MAP.md and repo-evidence-manifest.json. No tests, live product models, database writes or installations were performed in this research. Parent-reported results are explicitly attributed.
- Recommended architecture, thresholds, time bands, routes and new schemas are proposals/inference, not facts asserted by these sources.

## [1] Textual — Testing

- **URL:** https://textual.textualize.io/guide/testing/
- **Category:** Terminal UI/testing
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-01.json` (local source-01.json).
- **Supported reading:** Headless App.run_test and Pilot keyboard/mouse control; snapshot testing is documented.
- **Limits / planning interpretation:** Supports a testable rich client; not proof of actual terminal behavior, screen-reader accessibility, network safety or backend persistence.

> The `run_test()` method is an async context manager which returns a `Pilot` object.

## [2] Textual — Workers

- **URL:** https://textual.textualize.io/guide/workers/
- **Category:** Terminal UI/concurrency
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-02.json` (local source-02.json).
- **Supported reading:** Workers keep UI responsive; exclusive workers cancel earlier work; worker lifetimes follow the app/DOM.
- **Limits / planning interpretation:** Use cancellable/exclusive workers for reads only. App exit cancellation cannot cancel a committed HTTP effect. Do not make UI workers own durable agent execution.

> Similarly if you exit the app, any running tasks will be cancelled.

## [3] prompt_toolkit — Unit testing

- **URL:** https://python-prompt-toolkit.readthedocs.io/en/master/pages/advanced_topics/unit_testing.html
- **Category:** Terminal input alternative
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-03.json` (local source-03.json).
- **Supported reading:** Pipe input and DummyOutput allow scripted application input tests.
- **Limits / planning interpretation:** Credible lean prompt/REPL alternative; these docs alone do not establish full layout regression coverage or superiority to Textual.

> For the output, we want a `DummyOutput`.

## [4] Hermes — CLI commands

- **URL:** https://hermes-agent.nousresearch.com/docs/reference/cli-commands
- **Category:** Official agent CLI
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-04.json` (local source-04.json).
- **Supported reading:** CLI resume/session interfaces and runtime commands are documented.
- **Limits / planning interpretation:** Useful interaction reference; WorkAgent should retain its own journal/HTTP authority, not run hermes per conversation.

> Resume a previous session by ID or title.

## [5] Hermes — Slash commands

- **URL:** https://hermes-agent.nousresearch.com/docs/reference/slash-commands
- **Category:** Official agent interaction
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-05.json` (local source-05.json).
- **Supported reading:** Queue, steer, busy-input behavior and prompt composition are documented.
- **Limits / planning interpretation:** Borrow distinction between queued input and steering. Current WorkAgent messages supersede runs; this is not the same semantics as mid-tool-boundary injection.

> Inject a mid-run note that arrives at the agent after the next tool call

## [6] Hermes — Kanban

- **URL:** https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban
- **Category:** Persistent work/ownership reference
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-06.json` (local source-06.json).
- **Supported reading:** Docs describe SQLite task store, dispatcher reclaim/claims, progress comments, heartbeat, completion checks and near-budget checkpoint notice.
- **Limits / planning interpretation:** Useful lease/ownership/checkpoint comparison. A commit or model final answer does not complete work; importing another task ledger would create integration obligations. Dynamic long page extraction is truncated; only retained passages cited.

> A commit or diff alone never automatically completes a task.

## [7] Hermes — Scheduled Tasks (cron)

- **URL:** https://hermes-agent.nousresearch.com/docs/user-guide/features/cron
- **Category:** Durable scheduling/delivery reference
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-07.json` (local source-07.json).
- **Supported reading:** Docs distinguish durable execution receipt/output handoff from delivery; interrupted send claims stay unknown.
- **Limits / planning interpretation:** Borrow identity and no-unknown-resend discipline; no external delivery credentials or channel authority implied. Docs contain both general mid-run-unknown guidance and more specific receipt reconciliation; do not infer all failed work is safely retried.

> Delivery interrupted after a send claim stays unknown and is not retried automatically.

## [8] Temporal — Workflow Execution

- **URL:** https://docs.temporal.io/workflow-execution
- **Category:** Persistent execution/orchestration
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-08.json` (local source-08.json).
- **Supported reading:** Replay compares commands against event history and resumes from recorded events.
- **Limits / planning interpretation:** Durable replay is a substantive alternative, but it does not automatically make an arbitrary model/tool effect idempotent. Adoption needs determinism/versioning/operations/migration work.

> During a Replay the Commands that are generated are checked against an existing Event History.

## [9] Temporal — Activity Execution

- **URL:** https://docs.temporal.io/activity-execution
- **Category:** Persistent execution/effect lifecycle
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-09.json` (local source-09.json).
- **Supported reading:** Activities have separate task/execution identity, timeout/retry policy and heartbeat-mediated cancellation.
- **Limits / planning interpretation:** Retrying an activity can repeat its external action; retain WorkAgent effect keys, uncertain-send gating and accounting even under an orchestrator. This source is not evidence of exactly-once provider effects.

> Activities must heartbeat to receive cancellations from a Temporal Service.

## [10] WHATWG HTML — Server-sent events

- **URL:** https://html.spec.whatwg.org/multipage/server-sent-events.html
- **Category:** Transport standard
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-10.json` (local source-10.json).
- **Supported reading:** UTF-8 text/event-stream, IDs, reconnect and Last-Event-ID; 204 can stop reconnection.
- **Limits / planning interpretation:** SSE specifies wire/reconnect behavior, not durable authorization/replay history. Native EventSource constructor does not provide the custom headers WorkAgent uses; use authenticated fetch stream or a carefully scoped proxy.

> The `Last-Event-ID`` HTTP request header reports an `EventSource` object's last event ID string to the server when the user agent is to reestablish the connection.

## [11] PostgreSQL — NOTIFY

- **URL:** https://www.postgresql.org/docs/current/sql-notify.html
- **Category:** Database/transaction semantics
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-11.json` (local source-11.json).
- **Supported reading:** Notifications delivered after commit; duplicates can be folded within a transaction; default payload below 8000 bytes; notifications visible to all users.
- **Limits / planning interpretation:** NOTIFY is a wakeup hint, not durable client delivery or sensitive payload channel. Durable table remains source of replay. Workspace cursor commit ordering is our design inference, not a direct quote from this page.

> Notifications are visible to all users.

## [12] OpenAI — Introducing dots

- **URL:** https://openai.com/index/introducing-dots/
- **Category:** Documented product experience target
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-12.json` (local source-12.json).
- **Supported reading:** Describes context across channels, persistent work, progress visibility, redirection, tools and permission settings.
- **Limits / planning interpretation:** Vendor announcement, not independently verified performance or safety evidence. No dots account was exercised. Do not inherit availability, external-app permissions or benchmarks.

> Dots carry context across every channel, so your dot will have the full context wherever you reach it.

## [13] Meta — Muse help page

- **URL:** https://www.meta.com/help/artificial-intelligence/1331373868832401/
- **Category:** Documented product experience target
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-13.json` (local source-13.json).
- **Supported reading:** Describes files, follow-ups before response completion, collaboration/history and artifacts.
- **Limits / planning interpretation:** Vendor help documentation, not independent testing. No Muse account was exercised. Broad format/file claims do not establish WorkAgent support.

> You don’t have to wait for Muse to respond before asking your next question.

## [14] OWASP — File Upload Cheat Sheet

- **URL:** https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- **Category:** Security primary guidance
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-14.json` (local source-14.json).
- **Supported reading:** Extension allowlists, MIME distrust, signatures/size controls, separated storage, antivirus/CDR where applicable.
- **Limits / planning interpretation:** Defense-in-depth guidance; no claim current WorkAgent has a binary parser sandbox/scanner. The text-only first milestone deliberately avoids that authority and dependency expansion.

> Validate the file type, don't trust the Content-Type header as it can be spoofed

## [15] Hermes — Persistent Goals

- **URL:** https://hermes-agent.nousresearch.com/docs/user-guide/features/goals
- **Category:** Persistent agent goals/reference
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-15.json` (local source-15.json).
- **Supported reading:** Standing objectives span turns; judge checks goal satisfaction; explicit max-turn/budget controls; goals do not create Kanban cards.
- **Limits / planning interpretation:** Goal loop is not equivalent to an always-on durable responsibility or proof the objective is complete. Any future adapter must account for auxiliary judge/summary calls and retain WorkAgent authority.

> Setting a goal never creates a kanban card

## [16] Failed guessed background-session URL

- **URL:** https://hermes-agent.nousresearch.com/docs/user-guide/features/background-sessions
- **Category:** Retrieval limitation
- **Retrieved:** 2026-10-23 UTC; failed extraction; recovered canonical link separately.
- **Local evidence:** `sources/source-16.json` (local source-16.json).
- **Supported reading:** The initially guessed page was inaccessible/not found; no substantive body was obtained.
- **Limits / planning interpretation:** Not evidence. Browser navigation discovered the actual official CLI anchor; see [19]. Kept in the ledger rather than silently deleted.

No quotation: no substantive page retrieved.

## [17] Python — Curses Programming HOWTO

- **URL:** https://docs.python.org/3/howto/curses.html
- **Category:** Standard-library alternative
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-17.json` (local source-17.json).
- **Supported reading:** Terminal painting/windows/input and curses facilities.
- **Limits / planning interpretation:** Supports retaining a lightweight fallback; no conclusion that a full conversational app cannot be built with curses. Extra custom UI/test work is a codebase-specific estimate.

> The curses library supplies a terminal-independent screen-painting and keyboard-handling facility for text-based terminals;

## [18] IETF RFC 6455 — WebSocket Protocol

- **URL:** https://datatracker.ietf.org/doc/html/rfc6455
- **Category:** Transport standard alternative
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-18.json` (local source-18.json).
- **Supported reading:** Standard bidirectional channel over a connection.
- **Limits / planning interpretation:** Does not define WorkAgent durable cursor replay, task ownership, exact command receipts or budgets. No present requirement needs a command transport rewrite.

> The WebSocket Protocol enables two-way communication between a client

## [19] Hermes — CLI Background Sessions

- **URL:** https://hermes-agent.nousresearch.com/docs/user-guide/cli#background-sessions
- **Category:** Official background-session scope
- **Retrieved:** 2026-10-23 UTC; live extraction.
- **Local evidence:** `sources/source-19.json` (local source-19.json).
- **Supported reading:** Official CLI page says each /bg prompt spawns a separate daemon-thread session, has isolated history and returns a result panel.
- **Limits / planning interpretation:** A documented background thread/session is not a restart-safe WorkAgent execution promise. Discovery came from actual links in the official slash-command page, not a guessed canonical path.

> Each `/bg` prompt spawns a completely separate agent session in a daemon thread:

## Additional retained passages and why they matter

The following exact passages are particularly relevant to rejecting unsafe shortcuts:

- **[6] Hermes Kanban:** “This is a reporting opportunity, not a guarantee that a model will heed the notice.” A pre-cap warning supplements structured checkpoint persistence; it cannot replace it.
- **[7] Hermes cron:** “A known terminal result is handed to the delivery queue without running the agent again; duplicate handoffs and bookkeeping use the original fire identity.” This motivates effect/notification identities rather than repeating work after restart.
- **[15] Hermes goals:** “Setting a goal never creates a kanban card” distinguishes persistent conversational intent from dispatched task ownership. A single label “background” would conceal this important difference.
- **[19] Hermes CLI:** “Background sessions do not appear in your main conversation history.” This is explicitly different from the requested one ongoing cross-UI WorkAgent conversation.

## Product-target interpretation, not competitive benchmarking

**Dots:** [12] says the product can maintain context across channels and describes progress/redirect/permissions. This motivates WorkAgent's durable cross-UI state and interventions. No task-quality result, speed claim, cost comparison, customer adoption claim or private connector availability is inferred.

**Muse:** [13] says people can follow up without waiting for the prior response, and describes file/artifact use. This motivates an always-available composer and useful saved outputs. It does not prove a specific implementation of mid-run steering or guarantee that WorkAgent's existing supersede semantics are equivalent.

The two sources may use broad language about ongoing work and supported file formats. In this plan those are experience aspirations. WorkAgent capabilities remain those supported by inspected code and later actual acceptance evidence.

## Fresh parent report — structured note defect (not a web source)

An authenticated mid-turn user/parent message reports a newly exercised installed candidate: **5 note objects with embedded newlines produced 17 displayed lines and could not be saved unchanged in the current line-oriented 10-note editor**. The parent explicitly replaced intra-note line breaks with spaces to continue; no text was dropped. This is a workaround, not a passing lossless-edit test. This researcher did not re-run the live scenario and was not supplied the original note bytes.

Read-only source follow-up verified:

- `web/src/lib/flexible.ts:426–431` splits on newline, trims entries and drops blank lines;
- `web/src/components/FlexibleWork.tsx:2511–2519` labels notes one-per-line and joins note strings with newline;
- `backend/workagent/flexible_models.py:90` limits note **array objects** to ten.

The plan therefore specifies a structured list of multiline note controls, explicit add/remove/reorder, exact text/order preservation, and A35/T3a regression acceptance. A synthetic shape-equivalent fixture must be labeled synthetic; it cannot pretend to be the missing original live payload.

The same parent message reconfirms the current operator acceptance payload lacks acknowledgement fields. A fresh read of `operator_client.py:123–127` verified that. T1 must begin with safe proposal-review parity, preserve old journal formats/exact replay, and never invent acknowledgement consent.

## Retrieval issues and unresolved questions

1. Guessed `/docs/user-guide/features/background-sessions` failed. A real browser read of the official slash-command page discovered `https://hermes-agent.nousresearch.com/docs/user-guide/cli#background-sessions`; [19] was then substantively extracted. This is a recovered canonical documentation location, not an archive substitution.
2. Long official docs are mutable and some extractions are truncated. No specific current Textual/prompt_toolkit/Hermes package pin was selected or installed; implementation must verify dependency compatibility and licenses.
3. Temporal pages explain replay and activity lifecycle but no Temporal deployment/SDK was exercised. Incremental PostgreSQL recommendation is based on WorkAgent's existing receipts/fences/outbox plus migration cost, not an empirical throughput comparison.
4. Real-terminal accessibility, proxy streaming behavior, actual latency, task usefulness and physical-phone operation are unmeasured here. Proposed targets are clearly separated from facts.
5. Historical `HARNESS_ADOPTION.md` contains a controlled pinned experiment, not proof about all current Hermes versions. Its accounting/persistence integration warnings remain acceptance obligations until a new pinned adapter proves them closed.
6. The parent was concurrently finalizing installation/tests. Working-tree hashes/line references are an inspection manifest, not a stable installation manifest. Reconcile with the final candidate before implementing.

## Citation-to-decision map

| Decision | Direct sources | Local/code reasoning |
|---|---|---|
| Prefer Textual over handwritten curses; retain CLI fallback | [1], [2], [3], [17] | Existing curses JSON viewer lacks composer/test/concurrent-I/O infrastructure. |
| Keep domain/runtime authority in PostgreSQL | [6], [7], [8], [9] as alternatives | Existing command/outbox/lease/fence/provider receipts already implement hard boundaries; framework replacement does not remove them. |
| Use SSE + HTTP writes, polling fallback | [10], [11], [18] | Existing exact commands and header-auth API; no bidirectional command-channel requirement. |
| Persist structured checkpoint; don't trust a warning/summary alone | [6], [8], [15], [19] | Existing receipt facts and safe successor admission must survive hard kill; background thread is not durable authority. |
| Do not auto-resend unknown external delivery/effect | [7], [9] | Current worker count/dispatch/identity gates and late receipt retention. |
| Text-first attachment parity, binary isolation later | [14] | Existing exact-byte text attachment schema and 32KiB inline evidence bound. |
| Conversational, always-available composer/cross-UI continuity | [4], [5], [12], [13], [19] | Current HTTP runtime supports ordinary conversations but operator UX is ID-oriented/manual. |
| Fix structured notes as objects, not visual lines | Parent report, local code | The lossy join/split representation aliases embedded newlines with object separators. |
