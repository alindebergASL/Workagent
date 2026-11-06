# Initial independent Astra review — HOLD

Reviewer: **gpt-6-astra via openai-codex**. Scope: bounded card `t_66f1277f`, new format-4 continuity/queue/STOP/continue/document TUI integration on HEAD `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d` plus the intentional uncommitted integration. No board actions.

## Material findings

### R1 — P2: A normal STOP/completion race permanently locks this conversation's local command slot

**Locations:** `backend/workagent/operator_journal.py:27–40`; `backend/workagent/operator_client.py:80–90, 339–350`; `backend/workagent/tui/session.py:127–135`. Backend trigger: `backend/workagent/conversation_intents.py:27–34`.

**Trigger:** The UI displays a queued/running run; that exact run finishes before STOP reaches the server, without another human work-version change. The backend rejects STOP with its request-ID-matched `409 action_unresolved` before mutation. This is an expected race, not a transport ambiguity. The client recognizes only `version_conflict`, `source_changed`, and `review_required` as definitive rejections, so it retains this first-attempt response as `outcome_unknown`.

**Consequence:** The pending STOP survives session reconstruction. `Abandon rejected` refuses it; there is no receipt for Read back; replay cannot turn the already-terminal run into a stoppable run. New messages and all other commands in this draft are refused by the pending-command guard. Refresh/restart does not resolve it. Human text is preserved, but the conversation is unusable through the TUI without out-of-band local-state repair.

**Independent deterministic reproduction:** Used the real `OperatorClient.request/execute`, `CommandJournal.outcome`, and `Session` transition/validation methods with an in-memory journal/draft adapter and a synthetic urllib HTTPError carrying the actual `DomainError('action_unresolved')` envelope and matching request-ID header. No HTTP was sent. Output:

```text
R1 first matched action_unresolved response -> outcome_unknown pending survives restart: True
R1 abandonment: Only a verified definitive rejection can be abandoned; unknown effects stay locked
R1 next message: Resolve the retained command before a fresh send
```

**Suggested correction/regression:** Retain a provable, action-specific, first-dispatch rejection for STOP's terminal-run refusal, then permit explicit abandonment and deliberate refresh without deleting historical envelopes or text. Do not generally clear provider-unknown state or let a rejection received after an ambiguous POST settle that earlier ambiguity. Add a STOP-versus-completion test with the real error contract, restart the local session, abandon explicitly, refresh, and send a fresh message. Include an unknown-first-dispatch/rejection-on-replay negative control. Audit the new upload path for the analogous permanent-lock case on a definitive server-side `422 validation_error` (e.g. container mismatch); that analogous case was inspected, not executed here.

### R2 — P2: STOP is disabled for still-active runs when the worker is unavailable or dispatch is blocked

**Location:** `backend/workagent/tui/app.py:463–464`. Supporting contracts: `backend/workagent/work_snapshot.py:11–22`, `backend/workagent/execution_status.py:87–104`, and `backend/workagent/conversation_intents.py:23–44`.

**Trigger:** An underlying `Run.state == 'running'` has no live worker. Canonical projection reports `stale`; an active run with a dispatcher failure can instead project `blocked`. The TUI enables STOP only for `queued/running/awaiting_provider/recovering/unknown`, excluding both states.

**Consequence:** With authenticated read access and an exact run ID, the operator cannot fence that retained run before a worker restart or restored authority resumes it. The backend deliberately authorizes STOP by current access and raw queued/running state, independently of execution freshness. The UI defeats that control precisely during interruption/recovery.

**Independent deterministic reproduction:** Called the production `classify_current` for a synthetic underlying running run, then production `WorkagentApp.render_continuity_details` with lightweight in-memory widget stand-ins. Output:

```text
R2 underlying running / available False / failure None -> canonical stale STOP disabled: True
R2 underlying running / available True / failure internal_error -> canonical blocked STOP disabled: True
```

**Suggested correction/regression:** Derive STOP availability from an explicit server-projected stoppable flag or the exact canonical run's raw lifecycle, not only its diagnostic presentation state. Preserve current-access and exact run/version binding. Test a running run with its worker down and another with a dispatch blocker: STOP remains usable and cancels only that run; terminal runs remain non-stoppable. A regression should also check that restarting the worker cannot resume the stopped run.

## Review coverage and evidence limits

- Inspected all eight scoped production files and the three `test_tui_continuity*.py` files; followed the relevant command, document, checkpoint, current-execution, queue, and HTTP error contracts.
- Inspected format-4 record reconstruction/scope binding, exact envelope dispatch, frozen upload/message stages, generation-based preservation of concurrent edits, consent reset, access-loss cache invalidation, scoped binary bounds, hash-checked exclusive downloads, and explicit recovery behavior. No additional material defect is asserted in those inspected paths.
- Reused `.local/b22-rereview.md` for the unchanged legacy B22 corrections rather than repeating that review. Read `.local/tui-continuity-result.md` and the known integration-failure evidence; their test counts are author/parent evidence, not my executions.
- **Actually executed:** read-only Git/source inspection; SHA-256 collection/readback; the two deterministic in-memory probes above, both in one successful Python invocation. This is not a full widget/Pilot, filesystem-restart, HTTP, PostgreSQL, parser, or PTY execution claim. No heavy suite was run concurrently with the parent.
- No provider calls, spend, database access/maintenance, network calls, credential/environment dumps, product/test edits, commits, publication, or Kanban transitions. The only created artifact is this report.

## Reviewed production source SHA-256

Hashes were collected and checked again after the probes; scoped bytes were unchanged during this review.

```text
1d5f710af86d0445084a91d388b36eedcac2a59ff1d271babef06ce9693f29f5  backend/workagent/operator_client.py
d8f45ae1e03306a5661d62a6335a96f575565074305050c64adf2e45beea1261  backend/workagent/operator_journal.py
2c0135aa2412496ffced0fb3c00fedae90fe0ed5ad7fa08bb389143a97263b91  backend/workagent/operator_attachments.py
9218f35b9120c9a35f67dc8196d225bd94b56d3d6fa461aba4690768944f92b3  backend/workagent/tui/app.py
9f0ffaca61a12e8ec4090f5702a17e0c677fe5bcf735baae864b515b07fb5859  backend/workagent/tui/drafts.py
dd6f3f94c04d752423c199c0a904d6e278a1f5faea2f70e5f7b6dcb1e5f1d050  backend/workagent/tui/session.py
fa34dfe870b0587a52968a3eb88fa395573eec111b46eed08ae400c3dc5b8d75  backend/workagent/tui/commands.py
81db55994012763218aa54a284d1a16e0ffd880d3f65710a7419b99d2f5d0899  backend/workagent/tui/continuity.py
```
