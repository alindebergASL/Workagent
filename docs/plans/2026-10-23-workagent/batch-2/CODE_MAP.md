# Verified current code map

> Published research appendix. Read the [controlling parent implementation plan](../../2026-10-23-workagent-next-two-batches.md) first: it updates the baseline, Claude-branch coordination, full Batch 2 document-attachment scope, and current budget. This file is a proposal, not implemented behavior. Snapshot locators refer to the retained local research archive, not published full source pages.

Research-only inspection, 2026-10-23 UTC. Repository `/home/ubuntu/workagent-general-review-20261022`, HEAD `7a90a40`; the dirty proposal-review candidate is part of the inspected working tree. Read [repo-evidence-manifest.json](repo-evidence-manifest.json) before relying on line numbers. Hashes establish which bytes were observed; this is not a frozen checkout, deployed manifest, full audit or freshly executed test report.

## Product and ownership

| Evidence | Observed fact | Consequence |
|---|---|---|
| `AGENTS.md:3–27` | Build mode permits architecture changes; Hermes owns backend/runtime/integration, existing Claude owner owns web. Human edits, access, truth, budgets and duplicate-effect protection remain protected. | No new architecture-preservation veto, but this research assignment explicitly forbids implementation now. |
| `docs/PRODUCT_CONTRACT.md:7–20,39–47` | General persistent partner; ordinary Home conversation; useful work, ongoing responsibility, finite executions not lifetime ceilings; document does not change installed authority. | TUI must be conversational, not a workflow selector; continuation is separate from grant expansion. |
| `docs/BUILD_PLAN.md:7–28` | Fix progress/polling/recovery, ongoing work and useful capabilities; exercise changed input/restart and preserve human work. | Acceptance needs whole journeys, not only status DTO tests. |
| `STATUS.md:1–27` at inspection | Historical evidence continuity installed status and a qualified day/week evaluation; inferior older proposals, display overflow and slow weekly answer recorded. | Motivation, not current-candidate install proof. Parent's active safety batch is newer and dirty. |

## Terminal client and command safety

| File / symbol | Inspected evidence | Implication |
|---|---|---|
| `backend/workagent/operator_tui.py:14–37` `ACTIONS`, `parser` | ID-based operations for work areas, conversations, follow/cancel, artifacts, proposals and replay. Follow has exact-target args. | Reuse script interface rather than replacing it with a TUI-only protocol. |
| `operator_tui.py:40–42` `safe` | JSON ASCII escaping prevents stored text from emitting terminal control sequences. | Rich rendering must replace this guard deliberately, not drop it. |
| `operator_tui.py:45–129` `interactive` | Synchronous refresh/actions, JSON lines, manual refresh, one-line entry, curses redraw. | No multiline composer/automatic live activity in current implementation. |
| `operator_client.py:30–56` | Loopback-only URL and environment token; no proxy discovery/redirect, 15-second urllib timeout; sanitized failures. | Async adaptation must preserve endpoint and credential boundaries and distinguish read/write transport errors. |
| `operator_client.py:58–65` `all` | Consumes pages until `next_cursor`, rejects repeating cursors. | Keep exact totals; public event cursor needs a different type/protocol. |
| `operator_client.py:67–99` `run` | New command ID reserved exclusively; follow/cancel/promote fetch CAS; proposal membership checked; durable record before send. | New TUI should call typed shared command builder and same journal, not direct unjournaled POSTs. |
| `operator_client.py:101–129` `payload` | Follow sends `attachments: []`; accept has only expected revision; no acknowledgement flags in observed bytes. | Parent may add parity; rebase before implementing extended payloads. |
| `operator_client.py:131–163` | Stored envelope validated against current payload builder; replay never refreshes CAS; outcome_unknown recorded before POST, then receipt/readback states. | Format evolution must preserve old records and bytes; path-only attachments are unsafe for replay. |
| `operator_journal.py` `directory`, `_write`, `reserve`, `outcome` | Private disk command ledger with envelope digest and exclusive reservation; used by operator client. | Reuse its security model; local journal stores sensitive prompt/receipt content and is not server authority. |

## HTTP, commands and input contracts

- `api.py:47–75`: FastAPI app; bearer maps to local human principal; all query routes require schema/request headers. No browser cookie auth assumed.
- `api.py:77–97`: POST body read/256,000-byte check; all responses get `Cache-Control: no-store`. Existing implementation checks length after reading body, so it is not a streaming-memory limit for future binary uploads.
- `api.py:133–135`: existing `GET /v1/workspaces/{workspace_id}/execution`.
- `api.py:147–187`: work-context, work-areas, conversation-work, conversations, conversation detail and POST messages. `202` denotes queue admission, not completed work.
- `api.py:189–226`: conversation cancel/delegate; assignment responsibility activate/update/control/read. Reuse responsibility routes and payloads; do not create a parallel “job control” authority.
- `api.py:230–273`: run/artifact/observation/history/proposal/read/save/revise/accept/dismiss routes.
- `service.py:173–197` `_command`: human-only; canonical payload hash; current authorization before replay; same ID+different payload is `command_conflict`; mutation and cached command result share a transaction. Additive false review flags/empty attachment defaults are excluded to preserve historical receipt hashes.
- `service.py:140–148` `_event`: audit + outbox in one transaction; qualifying operations insert `run_dispatches` with conflict avoidance. Not a client-visible replay stream.
- `backend/README.md:72–74`: authorization is canonical-service enforcement, **not** RLS tenant isolation; DB credentials are trusted and never given to models. Do not claim new stream SQL is secure merely because it uses PostgreSQL.

### Existing attachment limits, exactly

`message_models.py:6–21` and `contracts/message-attachments.json` agree on:

- `count=2`, `file_bytes=200000`, `total_bytes=200000`;
- filename maximum 85 characters, ASCII allowlist with exact lowercase supported extension;
- extensions: `csv, txt, md, py, js, jsx, ts, tsx, json, yaml, yml, toml, xml, html, css, sql, sh, wat, log`;
- CSV MIME `text/csv`, all other accepted text MIME `text/plain`;
- UTF-8, preserve BOM, no normalization, reject NUL, inert/non-executable;
- exact retained UTF-8 content is the hash basis.

`AttachmentInput.bounded` validates encoded bytes and MIME. `MessageAttachment.exact` validates hash/byte length. `models.PostMessage:507–528` enforces aggregate count/bytes and rejects mixing general attachment/target/acceptance inputs with a controlled local operation. The current `text` field is required: do not quietly promise attachment-only messages without a contract change.

`conversations.py:239–240` assigns ref, SHA-256 and byte length on retention. Existing `test_text_attachment_journey.py:30–64` is a deterministic-provider HTTP journey for BOM/CRLF code attachment, exact replay, retained target and no code execution. Reading this test does not mean it was run in this research.

## Context and ongoing evidence

`conversations._admit_conversation_turn:174–251`:

1. CAS/current conversation/source validation and general grant admission.
2. Responsibility calls require worker identity and exact required grant; normal human steering is separate.
3. Context/lifetime checks vary by standing/non-standing profile; don't generalize an old bounded profile's lifetime limit into the product specification.
4. After successful admission checks, human messages cancel existing queued/running conversation runs (`_cancel_conversation_runs:160–167` increments fences and acknowledges dispatch state).
5. Creates run/config/message; records exact attachment refs/hash and optional target; human turns increment conversation work version.
6. New general-alpha configurations pin `conversation-evidence-v1`; bounded human context is materialized transactionally; audit/outbox event emitted.

`evidence_context.py:11–19,22–115`:

- New runs opt in. Materialization checks owning/open conversation and source access before bodies.
- Responsibility-scoped artifact dependencies constrain proposal/target discovery.
- Inline budget `MAX_BODY_BYTES=32768`, `MAX_TOTAL_BYTES=32768`; catalog bounds 24 attachments, 20 proposals, 8 sources.
- Exact attachment hashes checked. Newest eligible human attachment messages through the current cutoff are selected.
- Pending proposal selection requires same conversation, allowed artifact, unchanged current base, pending status, created-before-current-message, and dependency authority. Subsequent reads freeze proposal IDs then revalidate; original current revisions remain authoritative.
- Omissions explicitly carry reason/size; missing inline bytes are not evidence of absent files.

**Design implication:** text retention exists; a scoped bounded retrieval tool is the missing bridge for larger retained evidence. A binary upload pipeline would solve a different problem and cannot be inferred from this code.

## Execution, progress and dispatcher

| File | What is present | What not to infer |
|---|---|---|
| `general_alpha_models.py:61–73` `TurnState` | Turn queued/responding/replied/failed/unavailable/outcome_unknown/cancelled; provider observation; response steps; adaptive results; responsibility origin/recording. | A replied turn is not responsibility completion. |
| `general_alpha_models.py:32–42` `AlphaExecution` | Max steps bounded to 8; shared cost reservations labeled not billing; explicit step/budget/wait/validation outcomes. | Automatically resetting slice limits must not reset monetary budget. |
| `execution_status.py:39–55` | Typed status/failure reason, bounded last progress; up to 40 accessible recent runs. | Not a complete activity feed or ordered durable replay. |
| `execution_status.py:57–84` | Atomic private heartbeat file with PID/hash/age verification; freshness currently 120 seconds. | Process alive does not prove run progress, new-work authority or objective success. |
| `execution_status.py:87–104` | Cancellation first; unknown provider outcomes, invalid response, partial/budget/work/person classification; unavailable/recovering/provider waiting. | One generic retry action would be unsafe. |
| `execution_status.py:136–211` | Current scope/grant/budget accounting and recent runs, per-run ledger observations; partial adaptive outcomes preserve semantic classification. | Removing expensive canonical classification to accelerate polling changes truth. Profile before optimizing. |
| `responses_dispatcher.py:67–130` | Existing durable outbox/run dispatches; in-memory fairness cursors; bounded cancelled-response exact-identity observations; local dispatcher still advances independently. | A new scheduler is not required to survive a UI close. |
| `responses_dispatcher.py:132–200` | Per-run error isolation, sanitized diagnostics, blocked unknown/invalid outcome gates; successful canonical reads clear diagnostic state. | Errors/lock contention are not proof of recovery or grounds for regeneration. |
| `home_work_summary.py:1–44,107–133` | Body-free current artifact projection; up to 100 with cursor/has_more; authorized lookahead; bounded query path. | It has no full attention/responsibility/event stream; UUID pagination is not a snapshot or attention order. |

## Responsibility authority and settlement

- `responsibility_models.py:36–85`: current outcome, next action, dependency observations, wait, next check-in; lifecycle active/waiting_person/waiting_event/blocked/paused/cancelled/taken_over; outcome unverified/needs_review/evidenced_preparation; execution admitted/queued/running/settled/blocked; wake none/queued/reviewed. Keep these axes.
- `responsibilities.py:174–190`: readiness wakes use existing audit/outbox, deliberately no model run until admitted.
- `responsibilities.py:282–321`: human CAS controls. Resume only from paused and open conversation, clears old run link for a new human-controlled wake; unresolved sends still gate admission. Other controls pause/cancel/takeover, stop current responsibility runs, advance work version and persist.
- `responsibilities.py:344–385`: material-change digest coalesces changes; source/check-in/blocker/context change invalidates previous execution observation. Explicit person wait and next action are retained; ordinary messages do not silently authorize continuation.
- `responsibilities.py:492–555`: responsibility review capability checks owner, fence, secret, work/access generation, wake identity and lease; claim lease currently 30 seconds. Claim/expiry is not provider authority itself.
- `responsibility_execution.py:24–66`: bound run must match assignment/conversation/owner/review fence/work and source observations.
- `responsibility_execution.py:126–193`: trusted worker-only fenced review/admission in one transaction; exact lost-admission ACK replay retained; outbox consume after admission.
- `responsibility_execution.py:195–263`: bounded catch-up on existing dispatcher tick, scoped grant, fairness hints restart safely; explicit blocked reasons; unresolved attempt leaves continuation pending, not a new send.
- `responsibility_execution.py:265–296`: generic run settlement fallback labels needs_review and waits for event/person; step/budget/wait stop reasons become blocked. Audit callers/overrides in `general_responses.py` and sustained-continuity tests before changing this fallback.
- `responsibility_action.py`: receipt-bound local recording, run/workspace fence + effect journal, not external connectors; request/decision hashes and source/current artifact refs. Reading a recorded responsibility is not verified execution of external work.

## Provider uncertainty and recovery

- `provider_attempts.py` has prepare/dispatch, receipt binding, known identity/result retention, reconciliation and recovery. `ReceiptCapability` is explicitly not publication authority; late receipt retention is separate from ordinary access.
- `responses_ledger.py`: immutable phase events, reservation gates, receipt-only retain, local tool results and aggregate accounting; `observations()` projects provider states, `summary()` projects reservations and counts. Event producers here must be covered when building client activity; hooking only `Service._event` misses receipt transitions.
- `responses_worker.py:352–431`: reuse corrected/retained result; count-send without count-result is ambiguous and not repeated; count/dispatch reserve/check I/O window; create retains exact accepted identity; missing identity after dispatch marks unknown; known identity retrieves with bounded read accounting. This is substantive recovery already in place.
- `provider_attempts.py:259–302`: settled responses lease yield is not lease renewal/retry; a new visit claims ordinarily.
- `responses_recovery.py`: successor runtime approval/effective expiry, **not** a generic task retry queue. Avoid assuming its filename means “all recovery.”
- `backend/migrations/046_cancelled_response_observation.sql`: current latest numbered migration in inspected source; trusted cancelled observation/disposition guards are relevant. This research did not execute or fully re-audit its security-definer logic. Preserve and regression-test it; do not patch applied migrations.

## Proposal review candidate

`proposal_review.py:1–100` detects structural removals/replaced nonempty values, stable-ID list changes, exact note multiset losses and preserved document-text additions. It bounds displayed entries to 20 and each before string to 500 characters while retaining the complete removal count. This can warn on safe paraphrase and miss semantic distortion without structure loss; acknowledge that in UI copy.

`service.accept_proposal:402–434` locks/rereads artifact, checks expected/current/base revision, pending status, source dependencies and edit validation; recomputes latest/removal review; requires `acknowledge_removed_content` and/or `acknowledge_older_proposal`; only then appends exact proposed body as a human revision and marks proposal accepted. An acknowledgement cannot fix a stale base. `_command` preserves historical hashes for default-false flags.

## Web owner touchpoints and integration seams

Existing files, **Claude-owned**:

- `web/src/components/Composer.tsx`, `AttachedFiles.tsx`, `TurnProgress.tsx`, `ExecutionLine.tsx`, `ResponsibilityPanel.tsx`, `FlexibleWork.tsx`; concurrent candidate adds `ProposalReviewGate.tsx`.
- `web/src/lib/client/hooks.ts`: bounded resource loading/poll scheduling; avoid mounting a competing independent event subscription per component.
- `web/src/lib/client/real-api.ts`, `api.ts`, `pending-command.ts`, `command-cache.ts`, `operation-state.ts`, `execution.ts`, `responsibility.ts`.
- `web/src/app/api/domain/[...path]/route.ts`: same-origin domain proxy; streaming needs explicit proxy support and cleanup, not bearer exposure.
- `web/src/lib/contract/types.ts`, `errors.ts` plus generated `contracts/openapi.json` and `contracts/src/schema.d.ts`.
- `web/test/attachment-vectors.test.ts`, `web/test/fixtures/attachment-vectors.json`, `web/scripts/attachment-parity.py`: current parity assets.

Do not claim direct browser UI inspection was done in this research. Source code and historical evidence are the basis. Claude must validate desktop/phone and live inputs after actual changes.

## Fresh structured-note defect seam

Parent reported a freshly exercised installed-candidate defect: 5 note objects with embedded newlines rendered as 17 lines and could not be saved unchanged in the line-oriented 10-note editor. Parent explicitly flattened intra-note line breaks to spaces, dropping no text; that workaround is **not PASS** for unchanged save. This researcher did not re-exercise the live scenario or receive original note bytes.

Read-only follow-up verified `web/src/lib/flexible.ts:426–431` `notesFrom` uses `.split("\n").map(x => x.trim()).filter(Boolean)`; `FlexibleWork.tsx:2511–2519` joins note objects with newline and labels each line a note; `backend/workagent/flexible_models.py:90` limits the array to ten strings. Therefore the editor aliases an embedded newline with an object separator and also normalizes whitespace. Proposed fix is Claude-owned structured per-note multiline editing, not a higher note cap or hidden flattening. PLAN.md specifies exact semantics; IMPLEMENTATION.md T3a/A35 supplies the regression.

A fresh read of `operator_client.py:123–127` also reconfirmed absent acknowledgement fields. Safe review parity starts the batch; historical journal replays must remain without invented consent.

## Test/build tooling facts

`backend/requirements.txt` pins FastAPI 0.115.12, Pydantic 2.11.5, psycopg 3.2.9, uvicorn 0.34.3, httpx 0.28.1, pytest 8.3.5 and tiktoken 0.12.0 in the inspected file; no Textual dependency there. Exact package locks, Python compatibility and installed environment must be rechecked before implementation.

`backend/README.md` documents `backend/.venv`, `dev_db.py` disposable DB creation, runtime/non-owner authority and checksummed migration protocol. `contracts/package.json` has `generate` and `check`. `web/package.json` has `typecheck`, `lint`, `format:check`, `test`, `test:e2e`, `build`; Node >=22 is declared. Commands in IMPLEMENTATION.md are future instructions, not executed results.

Historical `spikes/hermes_bridge/README.md` and `handoffs/backend/HARNESS_ADOPTION.md` explicitly limit the bridge to a pinned, controlled-provider experiment. They report dependency and all-dispatch accounting gaps, no production runtime binding and no durable cross-process effect-resume proof. They justify caution, not a permanent rejection of Hermes or proof that present upstream has the same implementation.
