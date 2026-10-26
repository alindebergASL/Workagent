# Implementation handoff and acceptance contract

> Published research appendix. Read the [controlling parent implementation plan](../../2026-10-23-workagent-next-two-batches.md) first: it updates the baseline, Claude-branch coordination, full Batch 2 document-attachment scope, and current budget. This file is a proposal, not implemented behavior. Snapshot locators refer to the retained local research archive, not published full source pages.

**Plan only.** Execute after explicit batch activation, in an isolated implementation checkout based on the parent's final candidate. Do not run these commands against the research checkout or retained/private runtime merely because they appear here. Hermes owns backend/runtime/TUI/integration; Claude is the sole web owner. Read PLAN.md and CODE_MAP.md first.

## 1. Proposed file/change inventory

All paths below are repository-relative. **Existing** means inspected in the research baseline; **new** means proposed, not created in the repository. Migration names `047`–`050` are provisional reservations: choose the next available numbers after parent integration; never edit existing applied SQL.

| Stage | Existing files to change | New files proposed | Concrete responsibility |
|---|---|---|---|
| A: command parity | `backend/workagent/operator_client.py`, `operator_journal.py`, `operator_tui.py`; `backend/tests/test_operator_client.py`, `test_operator_replay.py` | `backend/workagent/operator_commands.py`, `operator_attachments.py`; `backend/tests/test_operator_attachments.py`, `test_operator_review_ack.py` | Shared typed envelope preparation; text attachments; explicit review flags; format-versioned replay and actual HTTP-size checks. Preserve script CLI. |
| B: conversational TUI | `operator_tui.py`, backend dependency/build docs | `backend/workagent/tui/__init__.py`, `app.py`, `models.py`, `transport.py`, `composer.py`, `timeline.py`, `work_list.py`, `review.py`, `drafts.py`, `safe_text.py`, `app.tcss`; `backend/requirements-tui.txt`, `requirements-tui.lock`; `backend/tests/test_tui_composer.py`, `test_tui_review.py`, `test_tui_drafts.py`, `test_tui_transport.py` | Async UI, HTTP-only, draft persistence, safe rendering, work/result/review navigation. Keep noninteractive operator commands unchanged. |
| C: state projection/events | `api.py`, `service.py`, `conversations.py`, `execution_status.py`, `responses_ledger.py`, `responses_dispatcher.py`, `responsibilities.py`, `responsibility_execution.py`, `provider_attempts.py`, `home_work_summary.py`, `db.py`, `backend/dev_db.py` | `backend/workagent/work_events.py`, `work_snapshot.py`, `work_event_models.py`; `backend/migrations/047_work_events.sql`; `backend/tests/test_work_events_pg.py`, `test_work_snapshot.py`, `test_event_stream.py`, `test_event_cursor_security.py` | Transactional metadata-only event projection, commit-safe cursors, authorized snapshot/replay/SSE, command lookup, query cost instrumentation. |
| D: attention and exact-run stop | Existing API/service/projection and `tui/app.py` (new in B) | `backend/workagent/attention.py`, `run_control.py`; `backend/migrations/048_attention.sql`; `backend/tests/test_attention.py`, `test_run_stop.py` | Dedupe/seen state; controlled run-specific stopping without conversation closure; UI quit remains detach. |
| E: retained attachment read | `message_models.py`, `evidence_context.py`, `broker.py`, `general_schema.py`, `general_responses.py`, `saved_work.py` where read tool dispatch is implemented; generated tool/decision contracts | `backend/workagent/attachment_reads.py`; `backend/tests/test_attachment_reads.py`, `test_attachment_continuity_pg.py` | Scoped immutable text retrieval by retained ref/hash; range bounds, omission semantics and model-visible read capability. No new blob store. |
| F: slice continuation | `general_responses.py`, `responses_worker.py`, `responses_ledger.py`, `responsibility_execution.py`, `responsibilities.py`, `responsibility_models.py`, `responsibility_action.py`, `outcomes.py`, `general_alpha_models.py` | `backend/workagent/continuation_checkpoints.py`, `continuation_models.py`; `backend/migrations/049_continuation_checkpoints.sql`; `backend/tests/test_continuation_checkpoints.py`, `test_continuation_faults_pg.py`, `test_continuation_budget.py` | Incremental typed handoff, safe successor admission, no-progress park, completion receipt where verifiable, no unknown resend. |
| G: durable queued input | Existing conversation admission/API, event producers, TUI composer | `backend/workagent/conversation_intents.py`, `intent_models.py`; `backend/migrations/050_conversation_intents.sql`; `backend/tests/test_conversation_intents.py`, `test_intent_races_pg.py` | Explicit server-side queue-for-later; cancellation, stale-target review, one admitted successor and readable pending state. |
| H: web parity, Claude only | `web/src/components/Composer.tsx`, `AttachedFiles.tsx`, `TurnProgress.tsx`, `ExecutionLine.tsx`, `ResponsibilityPanel.tsx`, `FlexibleWork.tsx`, `ProposalReviewGate.tsx` if present; `web/src/lib/flexible.ts`; `web/src/lib/client/api.ts`, `real-api.ts`, `hooks.ts`, `execution.ts`, `pending-command.ts`; proxy `web/src/app/api/domain/[...path]/route.ts` | `web/src/components/StructuredNotesEditor.tsx`; `web/src/lib/client/work-events.ts`, `work-snapshot.ts`, `attention.ts`; `web/test/structured-notes.test.ts`, `work-events.test.ts`, `work-snapshot.test.ts`, `attention.test.ts`; `web/e2e/ongoing-work.spec.ts`, `structured-notes.spec.ts` | Structured multiline notes without lossy line flattening; one shared scoped subscription, fetch-stream proxy path, draft stability, shared semantics, desktop/phone evidence. Claude chooses component decomposition. |
| All API/schema increments | `backend/export_contracts.py`, `contracts/openapi.json`, `contracts/src/schema.d.ts`, `contracts/src/client.ts`, `contracts/examples.json`; tool schemas/registries and hand-maintained web contract types as required | `contracts/work-event-examples.json`, `contracts/fixtures/work-status-vectors.json` | Generate, drift-check and share golden projection/reducer fixtures across Python/TS. Never hand-patch generated schema only. |
| Final evidence | `docs/BUILD_PLAN.md`, `STATUS.md` only when implementation authorized and verified | `docs/TUI_AND_ONGOING_WORK.md`, `scripts/verify_batch2.py`, `scripts/batch2_fault_probe.py`, `evidence/batch2/<candidate>/manifest.json` | Document actual usage/limits, reproducible disposable integration/fault probes and exact candidate result evidence. |

Implementation may combine tiny modules after the spike, but may not leave authority/transport semantics implicit. The inventory is a proposed change map, not a claim that these interfaces currently exist.

## 2. Proposed schema details

Use the repository migration runner, owner/runtime privilege split, existing lock order and explicit DTO validation. IDs should use existing `Id` conventions; decimals/budgets use existing exact types, never float. SQL below is a design sketch, not approved migration code.

### 047: work event projection

- `work_event_heads(workspace_id PRIMARY KEY REFERENCES workspaces(id), position bigint NOT NULL CHECK(position>=0))`.
- `work_events(workspace_id, position bigint, event_id text, kind text, conversation_id text NULL, run_id text NULL, assignment_id text NULL, artifact_id text NULL, proposal_id text NULL, aggregate_version bigint NULL, access_generation bigint, occurred_at timestamptz NOT NULL, reason_code text NULL, metadata jsonb NOT NULL)`.
- PK `(workspace_id, position)`; unique `(workspace_id, event_id)`; indexes `(workspace_id, conversation_id, position)`, `(workspace_id, occurred_at)`. Metadata max encoded size is checked in trusted code and DB; use closed event-kind/reason enums. No private body fields permitted.
- Allocate position by locked transactional increment of the head, not an independent sequence. Formalize lock order before all producers adopt it. Concurrent committed-prefix test is mandatory.
- Migration/backfill creates head and one **baseline snapshot marker**, not invented historical activity. Existing canonical historical audit/receipts remain accessible via detail APIs. No pretend “message delivered” events.
- Runtime gets SELECT and only required INSERT/UPDATE on projection/head; no DELETE. Administrative cleanup handles event retention after backups/policy. Permission tests must exercise the non-owner runtime role.
- A new projection is derived from existing truth; producers must not require current publication authority just to retain an authorized late provider receipt. Event metadata for receipt-only paths must not expose previously revoked source bodies.

### 048: attention and seen state

- `attention_items(workspace_id, id, recipient_id, conversation_id, source_event_id, kind, material_change_key, created_at, state, resolved_by_event_id NULL)`; unique `(workspace_id,recipient_id,source_event_id,kind)`.
- `attention_seen(workspace_id,principal_id,scope_key,last_seen_position,updated_at)` with PK on workspace/principal/scope. Monotonic advance under a command transaction; source cursor must be valid and currently authorized.
- No external delivery table needed for this batch. A future channel delivery outbox must not overload attention `seen` as provider delivery confirmation.
- Dedupe new equivalent blockers by material-change key; preserve source event link. Do not suppress genuinely changed decisions just because the title matches.

### 049: checkpoints/successors/completion

- `continuation_checkpoints(workspace_id,id,responsibility_id,conversation_id,predecessor_run_id,ordinal,work_version,conversation_work_version,access_generation,schema_version,runtime_compatibility,data,created_at)`.
- Unique `(workspace_id,predecessor_run_id,ordinal)`; all data immutable. `data` has bounded typed refs, reasons and diagnostic prose; no lease secret, bearer or unbounded raw transcript.
- `continuation_links(workspace_id,checkpoint_id,successor_run_id,admitted_at)` with unique checkpoint and unique successor. Link/claim and canonical run admission share a transaction; no intermediate consumed-without-run state.
- A checkpoint's eligibility is computed from current responsibility/run/receipt/authority, not a mutable client-set `eligible=true`. No new cost ledger.
- `responsibility_completions(workspace_id,id,responsibility_id,work_version,basis,criterion_evidence,confirmed_by,source_run_id NULL,created_at)` with unique terminal confirmation at an exact version. Strict `basis` allowlist; verified-local criteria may only be created by the corresponding trusted verifier, human confirmations by existing human command boundary. Completion is not inferred from an accepted artifact.
- Existing responsibility lifecycle DTO may add `completed`; old JSON records retain their exact historical meaning. No historical outcome/receipt rewrite or arbitrary status cast. Current grants/profile pins must include new consumer hashes only through ordinary authorized activation.

### 050: pending intents

- `conversation_intents(workspace_id,id,conversation_id,owner_id,command_id,queue_position,created_at,expected_work_version,exact_target NULL,attachments_snapshot,text,state,admitted_message_id NULL,run_id NULL,blocked_reason NULL)`.
- States `pending`, `admitting` only if a recoverable claim is needed, `admitted`, `needs_review`, `cancelled`. Prefer no separately committed `admitting` state: pending→admitted and run creation in one locked transaction.
- Unique `(workspace_id,owner_id,command_id)` and `(workspace_id,conversation_id,queue_position)`; owner/scope authorization on all reads/writes. Attachment bytes use current limits and immutable hashing; no path refs.
- Queued original intent and admitted canonical message have an explicit receipt relation. Admission CAS is not refreshed invisibly: un-targeted context drift can use a documented queue policy; exact target drift always needs review. Never let the client set principal/grant/run/fence fields.
- Existing `/messages` command hashes/semantics remain unchanged. Schema changes add independent commands/resources rather than reinterpret old replay records.

### API error additions

Add closed typed errors or typed result states as appropriate: `cursor_expired`, `cursor_scope_mismatch`, `stream_reset_required`, `attachment_range_invalid`, `intent_needs_review`, `continuation_incompatible`. Absent and inaccessible object responses remain indistinguishable where current policy requires it. Do not return database/raw provider exception strings. Distinguish domain conflicts from reconnectable GET transport failures.

## 3. Incremental work packages

Each package is a coherent RED → implementation → GREEN → readback increment, not an arbitrary two-minute task. New tests listed below do not yet exist. Existing test selectors are verified filenames, not assertions that the tests currently pass.

### T0 — freeze the real baseline and agree the contract

**Owner:** Hermes with Claude contract acknowledgement. **Depends:** parent's finished safety candidate.

1. Record final candidate HEAD, dirty status, parent test/review/install evidence separately. Re-read AGENTS/product/build docs and current migrations.
2. Diff operator changes against this plan; retain parent-added attachment/ack parity. Inspect current `AcceptProposal` and generated contract.
3. Confirm exact dependency/runtime Python versions in the intended isolated environment; validate Textual install in an optional venv only after implementation is authorized.
4. Agree DTO/state axes, first milestone scope, stream auth shape, queued-intent distinction, web owner handoff and feature flags. Record rejected alternatives and why.
5. Save a durable batch status/next-owner file before tool/session limits. No install or spending implied by completion of this package.

**Acceptance:** no ambiguous baseline; current review safety is preserved; acceptance matrix and changed-schema ownership agreed.

### T1 — typed command/attachment/review parity

**Files:** inventory A.

**RED cases:** a follow command carries exact BOM/CRLF bytes; changing the file after journal reservation does not change replay; overlarge escaped JSON fails before POST; same command ID with altered attachments or ack flags is refused; both acknowledgement flags default false; a stale proposal remains blocked even with both true; legacy format-1 replay still validates.

**Implementation:** start with safe CLI/TUI review acknowledgement parity, confirmed absent in the current payload builder even after the fresh parent report. Extract pure typed payload builder, introduce explicit format-2 journal representation for structured command inputs, read-only compatibility path for format-1, bounded file reader/preview and explicit ack CLI options. A format-1 accept replay still has no acknowledgement fields and may correctly receive `review_required`; never upgrade it into consent. An explicitly reviewed accept is a separate new command. No implicit file-name normalization. Add scope binding and journal size checks. Existing noninteractive commands remain callable.

**GREEN:** run current operator/replay/text-attachment tests plus new parity tests. HTTP integration with actual service and controlled provider verifies message/attachment/target hashes and accepted revision readback. No product-model call.

### T2 — bounded Textual spike, then real conversation shell

**Files:** inventory B. **Depends:** T1.

Build one vertical screen: empty home composer → create conversation → send → progress/result → reopen. Use dependency-injected fake HTTP for Pilot; separately use a disposable real API for integration. Validate 80×24 and 120×40, terminal resize, paste, Unicode, mouse/keyboard focus, long transcript virtualization and slow responses. Preserve screen controls from untrusted text.

Use Textual read workers/exclusive cancellation only for obsolete GETs; writes are supervised one-at-a-time per command with journal state surviving screen changes. A local thread cancellation cannot interrupt a synchronous urllib write; UI reports unknown and permits later readback, not automatic resend. Prefer an async HTTP implementation only if endpoint/proxy/redirect/serialization behavior is parity-tested.

Add private local draft store, result list, artifact reader, proposal review, stop/pause distinctions, and keyboard help. Hide IDs by default, keep them inspectable/copyable.

**Decision checkpoint:** if Textual fails required real-terminal/accessibility behavior, document reproducible failure and select prompt_toolkit as the fallback before building the whole app. Do not maintain two new production clients. Pilot screenshots are evidence of rendering, not proof of actual terminal behavior.

### T3 — first usable milestone on bounded polling

**Depends:** T1/T2; minimum typed snapshot can initially compose existing GETs.

Run the first-milestone journey in a real terminal: arbitrary ordinary question, two-file supported text task, useful output, human correction during work, proposal review, close/reopen and unchanged attachments. Keep composer active under polling and preserve draft on error. Inspect canonical command/message/run/attachment/proposal/readback identities. Verify no worker/provider imports in TUI modules, no new model authority and no write retry.

**Deliverable:** a usable candidate and evidence, not merely a framework shell. Retain legacy curses mode behind an explicit flag during rollout. Do not call this the full batch—durable activity and cross-slice resumption remain.

### T3a — structured-note round-trip blocker (Claude-owned web fix)

**Fresh live finding from parent:** 5 note objects containing embedded newlines appeared as 17 displayed lines and could not be saved unchanged by the line-oriented 10-note editor. The parent replaced intra-note newlines with spaces to continue, with no text dropped. Record this as a live defect/workaround, not PASS. Original note bytes were not supplied to this researcher: obtain the parent's sanitized saved artifact/receipt fixture, or label a shape-equivalent regression fixture synthetic rather than claiming it is the live payload.

**Existing seam:** `FlexibleWork.tsx` notes join/edit/validation paths and `web/src/lib/flexible.ts:426–431` `notesFrom`, which splits/trims/filters. Backend `flexible_models.py:90` limits note objects to 10. **Proposed files:** `StructuredNotesEditor.tsx`, `web/test/structured-notes.test.ts`, `web/e2e/structured-notes.spec.ts`, shared `contracts/fixtures/structured-notes.json`; TUI `review.py`/a new `structured_notes.py` if editing is exposed.

**RED:** five multiline notes survive open→unchanged save and cell-only edit byte-for-byte; 10 multiline objects remain valid regardless of displayed line count; duplicates/order/blank lines within a note/leading spaces/trailing newline survive. An 11th note is refused by object count without deleting any content. Replace the lossy combined textarea with per-note multiline controls and explicit add/remove/reorder. Stable editor keys remain UI-local; wire type stays `string[]` unless a separate reviewed migration is justified. Test accepted proposal→edit→save and web→TUI→web readback. Neither increasing the limit nor flattening text satisfies this task.

**Finish:** actual unchanged/cell-only save readback proves preserved notes; independent Claude/Hermes evidence marks the original workaround as historical FAIL until fixed, not a retroactive pass. Include A35 in the first milestone acceptance before claiming lossless structured-table editing.

### T4 — cheap, truthful snapshot and durable event log

**Files:** inventory C + migration 047. **Depends:** T0 contract; can parallel T2 after interfaces agree.

**RED:** omitted state category, current/old run confusion, unrelated scope leak, snapshot/event race, sequence commit-order gap, rollback creates no visible event, late provider receipt emits no private content and remains retainable after publication revocation.

Implement bounded projection first; instrument SQL counts/timings. Extract shared server classification rather than approximate it in TUI. Then transactionally emit closed metadata events from canonical domain and receipt transitions. Enumerate all producer seams in a test table; missing required producer is a failing contract test. Preserve existing outbox consumption and run-dispatch behavior.

Build `/events` page and cursor validation before streaming. Prove exact replay and lookahead/has_more using real PostgreSQL with two transactions/processes. Current query headers/auth and no-store remain.

### T5 — streaming/reconnect/attention without command duplication

**Files:** event stream/attention + migration 048; Claude owns web portion H. **Depends:** T4.

Implement SSE server and bounded stream parser/client; same DTO/reducer fixtures in Python and TS. Test split UTF-8, multiple events per chunk, comments, duplicate IDs, stale aggregate versions, malformed/oversized frames, disconnect after apply-before-cursor-save and reconnect with expired cursor. Bound memory and one subscription per active UI workspace/scope. Poll fallback reads the same event log.

Command-status lookup is authenticated to current principal; no raw journal contents returned. Notifications are transactional derived facts with unique keys. Test a replay through TUI and web creates no repeated badge/bell; seen state shared across UIs without marking hidden decisions accepted. Verify revocation during stream clears local protected data and stops disclosure.

### T6 — retained attachment read across long work

**Files:** inventory E. **Depends:** T1/T4.

Implement immutable ref/hash bounded reader and model tool schema through existing broker authority. Record chunk provenance and boundary handling; no file path/URL fetch. Add current-context metadata indicating full-body availability via read tool. Reauthorize on every chunk and on scheduled continuation.

**RED/GREEN:** a file accepted at the 200,000-byte limit but omitted from the 32,768-byte inline budget is not reported absent; worker reads needed bounded sections; changed target/source authorization blocks appropriately; foreign ref and arbitrary hash are rejected; UTF-8 range boundaries don't silently corrupt bytes; attachment code is never executed. Existing same-turn/source-continuity tests remain.

### T7 — deterministic checkpoint and bounded successor

**Files:** inventory F + migration 049. **Depends:** T4/T6 and current unknown-receipt regressions.

Implement structured checkpoint per meaningful safe boundary before adding automatic successor admission. Then test exact-one successor under concurrent dispatchers and crash-between-commit/ACK. Hook slice-limit outcomes only when authorized work remains and prior effects are settled. Preserve explicit person waits/blocked unknowns and latest human revisions. Integrate no-progress park and compatibility validation.

Completion receipts are implemented separately from continuation and proposal acceptance. Only verified local criteria or explicit human confirmation can mark a responsibility completed; a new contradictory evidence change must reopen/review under defined policy rather than erase the old completion receipt. If completion remains out of scope after contract review, remove the promised completed route and retain truthful evidenced-preparation labels; do not leave half-defined terminal behavior.

**Hard cap proof:** force a task requiring more steps than one slice allows, verify at least one checkpoint/successor, unchanged shared budget accounting, all intended tool-result refs, and no repeated settled external effects. Hard kill before warning must still recover from structured facts.

### T8 — durable queue and exact stop controls

**Files:** inventory G + migration 050, run control.

Keep existing superseding send semantics. Add explicit queue mode, list/edit-by-new-intent/cancel controls and admission policy. Reordering/editing queued content is a fresh command with a new revision/receipt, never mutation of an old command envelope. Implement exact-run stop separately from conversation cancel; both UIs use same semantics.

Test queue admission after normal settlement; pending unknown result blocks queue admission without discarding intent; targeted drift requires review; pause prevents new intent admission; simultaneous queue/cancel/admit has one valid result; closing a UI does not lose queue ownership; a stale client cannot stop a replacement run accidentally.

### T9 — full parity, fault campaign and unfamiliar task evaluation

**Depends:** all promised preceding packages; Claude web integrated.

Run matrix below with real PostgreSQL/API, controlled provider traces and real terminal/web. Then perform a small, explicitly authorized live-model evaluation using unfamiliar synthetic tasks, within verified remaining authority. Do not authorize a new spend envelope from this plan. If no live spend is authorized, label live usefulness evaluation pending and do not claim full live product acceptance; deterministic runtime acceptance can still be reported separately.

Independent review focuses on command replay, control semantics, scope/event disclosure, migration guards, commit-order cursor correctness, late receipt retention, successor uniqueness and budgets. Address actual findings with repro tests. Final report includes exact dataset/candidate/commands and untested environments; no unsupported physical-phone claim from browser emulation.

## 4. Commands for implementation-time validation

These are intended commands, **not executed during research**. Run only in an authorized disposable implementation environment. Do not source an existing private-runtime env file. Database tests may create/write fixtures; inspect their fixture provisioning first.

```sh
# Start from a separately prepared implementation checkout, not this read-only research tree.
# Set WORKAGENT_IMPL to its exact absolute path after discovering it.
cd "$WORKAGENT_IMPL"
git status --short
git rev-parse HEAD

# Inspect actual Python before dependency work.
backend/.venv/bin/python --version
# If the existing documented environment is absent, follow backend/README.md setup
# in this isolated checkout; don't overwrite a shared venv or current runtime.

# Existing baseline regression groups; no live provider scripts here.
cd backend
.venv/bin/python -m pytest -q \
  tests/test_operator_client.py tests/test_operator_replay.py \
  tests/test_text_attachments.py tests/test_text_attachment_journey.py \
  tests/test_proposal_review.py tests/test_proposal_review_pg.py

.venv/bin/python -m pytest -q \
  tests/test_execution_status.py tests/test_progress.py \
  tests/test_stalled_turn_status.py tests/test_dispatcher_resilience.py \
  tests/test_responses_leases.py tests/test_responses_recovery.py \
  tests/test_cancelled_response_observation.py tests/test_cancelled_response_receipts.py \
  tests/test_settled_turn_recovery.py tests/test_sustained_continuity.py \
  tests/test_responsibility_person_wait.py tests/test_evidence_continuity.py \
  tests/test_evidence_continuity_guards.py

# New tests only after their corresponding implementation packages exist.
.venv/bin/python -m pytest -q \
  tests/test_operator_attachments.py tests/test_operator_review_ack.py \
  tests/test_tui_composer.py tests/test_tui_review.py tests/test_tui_drafts.py \
  tests/test_tui_transport.py tests/test_work_snapshot.py tests/test_work_events_pg.py \
  tests/test_event_stream.py tests/test_event_cursor_security.py \
  tests/test_attention.py tests/test_run_stop.py tests/test_attachment_reads.py \
  tests/test_attachment_continuity_pg.py tests/test_continuation_checkpoints.py \
  tests/test_continuation_faults_pg.py tests/test_continuation_budget.py \
  tests/test_conversation_intents.py tests/test_intent_races_pg.py

# Export contracts from the implementation checkout.
cd ../contracts
npm run generate
npm run check

# Claude's web lane; package manager and scripts are verified in package.json.
cd ../web
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:e2e
```

For a new disposable DB, follow `backend/dev_db.py --env-file <new-private-path>` only after confirming it provisions fresh random test DB/roles and the invocation is authorized. Use the intended non-owner API role for tests; migration owner only for setup. Run migration prefix checks and a repeat no-op application on that disposable database; verify retained fixtures/historical receipt hashes unchanged before/after. Never run destructive DB fixtures on the parent's live state.

Proposed probes after they are implemented:

```sh
cd "$WORKAGENT_IMPL"
backend/.venv/bin/python scripts/verify_batch2.py \
  --mode controlled --evidence-dir "$BATCH2_EVIDENCE"
backend/.venv/bin/python scripts/batch2_fault_probe.py \
  --disposable-only --case all --evidence-dir "$BATCH2_EVIDENCE"
```

These flags/files are proposed interfaces, not current commands. The probes must refuse non-disposable DSNs by construction, sanitize outputs, record process identities and stop only their own processes. Don't claim “all” unless the manifest enumerates and counts every case. Capture stdout/stderr/exit code and machine-readable assertions; final commands should be documented after implementation, not retrospectively invented.

### Real-terminal protocol

Launch through the documented new TUI entry point after implementation, e.g. proposed `python -m workagent.operator_tui interactive --ui textual` (CLI argument placement must match the final parser). Test Linux terminal and tmux, 80×24/120×40, paste with CRLF/Unicode, Ctrl+Enter fallback, resize during send, screen reader behavior where a real tester is available, mouse/keyboard-only review, unsent drafts, detach/reopen. Record terminal name/version and accessibility limitations. Pilot is necessary but insufficient.

## 5. Acceptance matrix

Each row requires the evidence named; PASS/FAIL/PENDING is recorded independently. “No mutation” includes verifying canonical counts/hashes, not merely no visible duplicate bubble. Test fixtures may use simulated clocks/provider responses but must be labeled controlled. Live usefulness rows require actual approved product runs.

| ID | Task / adversarial condition | Required result | Evidence |
|---|---|---|---|
| A01 | Ordinary source-free question from empty home | Useful conversation without project/IDs/operator setup; one admitted message. | TUI capture + API receipt/readback; later live synthetic question if authorized. |
| A02 | Compare two unfamiliar vendor/options CSV/text files | Real table/document/result links; hashes exact; no special domain handler. | Controlled tool trace + canonical artifact; live task-quality rubric separately. |
| A03 | Draft/edit brief with human notes | Human revision preserved; proposed changes separate; note removal visibly acknowledged, never autoaccepted. | Before/after body hashes + proposal/review/accept receipts, TUI/web. |
| A04 | Analyze attached code/log as evidence | Exact bytes incl. BOM/CRLF; code never runs; no shell escape or terminal OSC action. | No marker file/process effect; terminal sanitize vectors; retained hash. |
| A05 | File within ingestion limit but beyond inline context | Inline omission explained; scoped range read supplies actual evidence without resupply. | Read-attachment receipts/chunk refs, context manifest and result attribution. |
| A06 | Unsupported binary/ZIP/PDF in text-first batch | Clear supported-format refusal; no parsing/execution/partial send; draft retained. | Zero POST/provider actions; UX capture. |
| A07 | Long task exceeds one tool slice | Safe checkpoint + at most one successor; objective retained and useful work continues. | Run/link/checkpoint rows, tool receipts, shared budget conservation. |
| A08 | Changed source and human correction between unattended waves | Next run binds latest permitted versions; older results/history retained, no repeated request for already-supported evidence. | Ordered DB timestamps and run-context refs across two waves. |
| A09 | Two independent responsibilities; one provider slow | Other progresses; waits are explicit; no starvation/hot-loop spending. | Dispatcher visit times, outbox/run records, bounded request counts. |
| A10 | Scheduled check-in while all UIs closed | Server continues within authority; return shows actual new output/next action or honest blocker. | Worker-only interval; later TUI/web snapshots/events matching DB. |
| A11 | TUI close/reopen during progress and with unsent draft | Work persists independently; same draft bytes restored; closing does not cancel. | Process boundary + canonical run and local draft hashes. |
| A12 | API restart and stream reconnect | Last applied cursor resumes without lost/duplicate meaningful transitions. | Event IDs/cursors and reducer state; reconnect trace. |
| A13 | Delayed commit A / earlier commit B / rollback | Commit-safe cursor cannot skip A; rollback emits nothing; no sequence-hole shortcut. | Two-process PG barrier test. |
| A14 | Cursor expired / wrong principal / changed access generation | Explicit authorized snapshot reset or refusal; no foreign count/title/body disclosure. | HTTP statuses/error DTOs and sanitized cache behavior. |
| A15 | Stream data split at arbitrary bytes, duplicates, out-of-order, oversized frame | Bounded parser; exact logical events; stale versions ignored; safe reconnect. | Property/fixture tests with max-buffer assertions. |
| A16 | Lost ACK after command commit, duplicate clicks, CAS drift | Same exact command preserved; explicit replay dedupes; payload change rejected; no refreshed hidden CAS. | Journal records + command/message/side-effect counts. |
| A17 | File changes/deletes after journal reservation | Replay uses retained bytes; no filesystem reread or hash drift. | Journal/payload/retained attachment hashes. |
| A18 | Send while running; queued send while running | Superseding send and queue are distinct, visible and server-owned; queue doesn't steal authority. | Fences, intent/message links and both UIs. |
| A19 | Cancel queued intent at same time worker admits it | One atomic valid result; no hidden second run; user sees final receipt. | Concurrent PG race test. |
| A20 | Stop one run / pause / resume / takeover / conversation cancel | Distinct effects, no unintended auto-restart, no stale worker publication; readback proves state. | Commands/fences/lifecycle/receipt rows + UI labels. |
| A21 | Crash before send; after dispatch before known identity | First can safely admit if proven unsent; second quarantines unknown with reservation retained, zero auto-resend. | Controlled transport call counters and persisted ledger before/after restart. |
| A22 | Known provider identity; worker kill before result | Bounded exact-ID GET observations recover; no new provider create. | Same identity, read reservations, result receipt; create count unchanged. |
| A23 | Effect committed before tool ACK/history save | Exact receipt consumed once, no duplicate effect; checkpoint isn't source of truth. | Operation hash/unique effect/result rows. |
| A24 | Cancelled run gets late trusted response | Remains cancelled; unapplied receipt retained; only NEW normal admission may unblock. | Migration046 regression plus canonical history immutability. |
| A25 | Lease expires; old worker returns after replacement | Old fence rejected for publication; allowed receipt retention only. | Cross-process stale capability assertions. |
| A26 | Budget/authority expires at admission, dispatch or successor boundary | Correct blocked reason; no new spend/grant/reset; saved output still scoped-readable. | Exact accounting/authority snapshots and zero forbidden calls. |
| A27 | No progress repeated / malformed output / persistent tool rejection | Bounded park with actionable diagnosis, not infinite spend or false completion. | Threshold/circuit-breaker trace and useful UI next action. |
| A28 | Proposal current/older/removes >20 entries/stale base | Total distinct from displayed sample; explicit required acknowledgements; stale base refused despite flags. | Server regression + TUI and web acceptance/readback. |
| A29 | Event replay/duplicate wake/return in second UI | One attention fact/bell per material transition; seen shared, decision not autoaccepted. | Attention unique keys + cross-UI capture. |
| A30 | Long transcript + slow/erroring API during typing | Composer/selection/scroll stable; no interleaved writes; freshness truthful. | Pilot tests, real terminal capture, measured key/render and query timings. |
| A31 | Simple deliverable finished vs proposal accepted vs objective finished | Separate state axes; no global Done from a single ready run/accepted draft. | Golden status vectors + completion evidence where supported. |
| A32 | Cross-UI journey: begin TUI, edit web, return TUI | Canonical work/target/current revisions consistent; drafts safe, stale target explicit. | Paired UI evidence + exact IDs/versions/readbacks. |
| A33 | Incompatible checkpoint after runtime upgrade | Blocks with explicit compatibility reason, no old request rebound to new prompts/grant. | Upgrade fixture, pinned hashes and zero I/O. |
| A34 | Migration/new event schema over retained history | Prefix checks pass, repeated application no-op, old receipts/work/budget unchanged; rollback feature flags preserve canonical records. | Disposable before/after hashes and migration journal. |
| A35 | Five multiline note objects / 17 displayed lines; 10 multiline notes; duplicate/blank-line content | Unchanged save and cell-only edit preserve exact note strings/count/order; limit counts objects, not lines. Explicit flattening workaround is not PASS. | Parent sanitized fixture or clearly synthetic equivalent; structured-editor unit/E2E tests and canonical body/hash/readback across web/TUI. |

### First milestone acceptance subset

A01–A04, A06, A11, A16–A17, A28, A30, A35 and a minimal A32 readback parity path. Existing backend status/lease safety regression group must remain green. A passing subset is labeled **first milestone**, not full batch.

### Full batch finish line

All applicable A01–A35 assertions pass, with any genuinely unavailable live/device tests explicitly PENDING and excluded from the corresponding claim. Runtime/fault rows run on real disposable PostgreSQL, not an in-memory fake. At least several unfamiliar task categories are evaluated for usefulness; one successful comparison demo does not establish generality. Real terminal and Claude desktop/phone browser evidence are required; physical phone/screen-reader coverage is a separately identified environment, never implied.

## 6. Evidence manifest and durable handoff format

For each candidate save a private evidence directory containing a manifest with:

```json
{
  "candidate_commit": "exact SHA, not a placeholder at delivery",
  "dirty_files_manifest": "path or null",
  "migration_checksums": {},
  "mode": "controlled | approved-live",
  "dataset": "synthetic named fixture and hash",
  "commands": [{"argv": [], "cwd": "", "exit_code": 0, "stdout_path": "", "stderr_path": ""}],
  "acceptance": [{"id": "A01", "status": "PASS | FAIL | PENDING", "evidence": [], "limitations": []}],
  "product_usage": {"basis": "reservations_not_billing", "authority_source": "", "unknown_liabilities_preserved": true},
  "next_owner": "named owner or none; never imply a worker is running",
  "next_action": "exact unfinished task or verified finish",
  "installed": false
}
```

This is a proposed schema/example shape, **not actual test output**. Replace placeholders only with real observations. Never copy expected results into an evidence manifest as though the probe produced them.

At a session/tool limit: persist current acceptance rows, exact failing command/error, files/migrations changed, outstanding ambiguous effects and a concrete next executable task. If no successor is running, say so. Durable handoff is an artifact plus ownership, not a final chat sentence promising to continue.
