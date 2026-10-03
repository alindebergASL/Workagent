# B1 conversation contract — implemented candidate, awaiting joint review

For Claude's existing frontend branch. This is an implemented **candidate**, not
an agreed schema: no explicit Claude ACK has been observed. No web files changed.
Canonical authority: `backend/workagent/models.py`, generated `contracts/openapi.json`
and `contracts/src/schema.d.ts`; complete illustrative payloads in
`contracts/examples.json`. Existing intake endpoints remain available.

## Product boundary

- A conversation is not an assignment or delegated responsibility. Create/list/get
  and source-free messages work without a task/Space/source form. An existing
  authorized workspace is still the security scope (auto-selected by CLI when unique).
- A message admits a real persisted `Run`, with `assignment_id: null`,
  `conversation_id: <id>`, `kind: "conversation_turn"`,
  `profile: "general-controlled-v1"`. PostgreSQL enforces exactly one run owner;
  no hidden assignment is created. `Run.assignment_id` is now nullable; intake
  runs still have an assignment and `conversation_id: null`.
- CLI and HTTP admissions use the same Service, commands, outbox/run_dispatches,
  claim/capability/fence/lease and `GeneralWorker`. HTTP POST does not compute an answer.
- This checkpoint has a controlled transport only. Its response is an explicitly
  labeled wiring receipt/clarification question, **not evidence of model usefulness**.
  `execution.mode: "fixture"`, `execution.evidence_origin: "controlled_transport"`,
  `provider_observation: "not_observed"`. No provider attempts, credentials or calls.
- The distinct, versioned profile is `runtime/general-b1-v1.json` (candidate for
  code review, not human product acceptance). Existing accepted agent bundles,
  activation selection and historical exhausted/expired grant are unchanged.

## Routes and fields

All paths below start `/v1/workspaces/{workspace_id}`. Authentication is the existing
private local human bearer. GETs require `X-Schema-Version: workagent/v1` and
`X-Request-Id`; POST command metadata lives in its JSON body. Extra fields are rejected.

| Method / route | Result |
| --- | --- |
| `POST /conversations` | 201 `Conversation` |
| `GET /conversations?cursor=...&limit=25` | `ConversationPage {items,next_cursor}`; limit 1–100 |
| `GET /conversations/{conversation_id}` | `ConversationDetail {conversation,messages,runs,assignment_ids}` |
| `POST /conversations/{conversation_id}/messages` | 202 `MessageQueued {conversation,message,run}` |
| `POST /conversations/{conversation_id}/cancel` | `Conversation` |
| `POST /conversations/{conversation_id}/delegate` | 201 existing-domain `Assignment`, explicitly paused |
| `GET /runs/{run_id}` | Existing `Run` route, now also authorizes a conversation owner |

There are **no** general file/table/tool/acceptance endpoints in B1.

### Create (no selected sources, title optional)

```json
{"schema_version":"workagent/v1","request_id":"req-create","command_id":"create-1"}
```

The server supplies `id`, `workspace_id`, `owner_id`, `title: "Conversation"`,
`work_version: 1`, `state: "open"`, `selected_source_refs: []`, `created_at`.
An optional `title` is 1–240 characters. Optional `selected_source_refs` use the
existing `SourceRef` schema, max 50 unique IDs, and are checked at admission.
B1 conversation source scope is fixed; source attachment mutation is not implemented.

### Send a human message / steering

```json
{"schema_version":"workagent/v1","request_id":"req-send","command_id":"send-1","expected_work_version":1,"text":"Help me think this through"}
```

The 202 result returns the updated `conversation` (`work_version: 2`), persisted
`message` and **persisted queued `run`**, not an assistant answer. Store both IDs.
`message` has `id`, `conversation_id`, `run_id`, `sequence: 1`, `author_id`,
`author_kind: "human"`, `text`, `evidence_origin: "human"`, `result: null`, `created_at`.
`run.id` is the turn ID; there is no second turn ledger.

Poll GET conversation or GET run. A completed controlled turn has `run.state: "ready"`
and an immutable message with `author_kind: "assistant"`,
`author_id: "general-worker"`, `evidence_origin: "controlled_transport"`,
`result: {"results":[{"kind":"text","text":"..."}]}` and matching top-level `text`.
Only the worker capability seam writes that origin. Human request and worker-result
schemas do not accept `author_kind`, `evidence_origin`, acceptance or authority fields.
Render text as inert content, never HTML or an instruction to perform effects.

`TurnResult.results` is a typed result family with **only** `TextResult` implemented
(max one). Later reviewed table/file/tool result types can extend this family;
no opaque dictionaries or unsupported placeholders are accepted now.

### Continue and concurrent steering

Fetch conversation, send the same POST with a **new** command ID and its current
`work_version`. Messages and runs are returned in human-message order / message
`sequence` order, independent of UUID ordering. Claim and assistant completion do
not increment `work_version`; human POST/cancel/delegate do.

A new message fences/cancels unfinished runs in that conversation atomically,
retains their human messages, and admits one fresh turn using the retained history.
This is intentional steering, not parallel answer generation. A stale human CAS
returns 409 `version_conflict` with `details.current_version` and writes nothing.
At most 100 human turns / 200 messages are retained per conversation; subsequent
admission returns `budget_exhausted`. Context is bounded to 256000 UTF-8 bytes.

For transport replay, preserve `command_id`, exact payload and CAS version; only
`request_id` may change. Replay returns the original queued receipt even if the run
has since completed. Poll to see current state. Different intent under one command
ID returns 409 `command_conflict`. Revocation is checked **before** cached replay.

### Cancel

```json
{"schema_version":"workagent/v1","request_id":"req-cancel","command_id":"cancel-1","expected_work_version":2}
```

Conversation becomes `cancelled`; queued/running turns are fenced/cancelled.
History survives. Further POSTs are refused. Cancellation does not cancel an
already separately delegated assignment; use its existing control operation.

### Explicit delegation (recorded, not autonomous execution)

```json
{"schema_version":"workagent/v1","request_id":"req-delegate","command_id":"delegate-1","expected_work_version":2,"goal":"Carry this forward","completion_criteria":["Review together"]}
```

Creates exactly one existing-domain `Assignment` with `conversation_id` linkage,
inherited source scope (possibly empty), principal owner, supplied goal/criteria,
`state: "paused"`, `run_ids: []`, and this explicit unresolved note:

> Delegation recorded; autonomous execution is not supported by B1. Resume is disabled.

This is visible via existing assignment GET/list and conversation `assignment_ids`.
It is **not** active agent ownership, a silent intake execution or an accepted result.
Existing assignment `resume` refuses these B1 delegations; cancellation remains
available. Conversation can continue independently. Broader responsibility lifecycle,
success evidence, scheduling and check-ins are outside B1.

## Authority, recovery and compatibility

Membership/viewer checks and current source access/unavailability apply to reads,
list filtering, command replay, claims, context and commit. Source versions/content
hashes and workspace access generation are rechecked at fenced commit. No private
context is added implicitly. Capability secret/fence, expiry and profile pins are
checked using the existing run machinery; model output cannot accept a proposal.

Claim/reclaim uses the existing 120-second run lease. No duplicate assistant message,
assignment, outbox admission or provider side effect is produced on replay.
Completion and ACK are atomic with the assistant message. Restart/duplicate worker
delivery reads the existing committed message instead of calling transport again.
A crash before completion may repeat **controlled computation only** after lease
expiry; this is not an authorization design for future external effects.

Existing intake create still requires sources. Intake GET/create/revision, legacy
registry pins, immutable artifacts/proposals and provider grant semantics remain.
`backend/workagent/pre_b1_tool_registry.json` archives the exact pre-B1 schema so
old run pins are still resolvable; old accepted agent bundles are not edited.
Apply additive migration 009 with the migration identity. Fresh `dev_db.py`
provisions the new runtime INSERT/UPDATE permissions; an existing deployment needs
those same explicit grants before rollout (no deployment performed here).

## Running B1 (local, disposable PostgreSQL only)

Use the exact checkout on `PYTHONPATH`, not the reused environment's old checkout:

```sh
cd /home/ubuntu/workagent-general-cli
export PYTHONPATH="$PWD/backend"
PY=/home/ubuntu/workagent-intake/backend/.venv/bin/python
$PY backend/dev_db.py --env-file /home/ubuntu/.hermes/cache/scratch/my-new-b1.env
source /home/ubuntu/.hermes/cache/scratch/my-new-b1.env
# Provision empty synthetic workspace with migration role; no private source reads.
$PY -c 'import os; from workagent.fixture import seed; seed(os.environ["MIGRATION_DATABASE_URL"], [], "b1-workspace")'
$PY -m workagent.prompt_cli --controlled prompt 'Help me think about next week'
# Save the returned conversation.id as CID. Every command is a new process.
$PY -m workagent.prompt_cli --controlled continue "$CID" 'Keep it short'
$PY -m workagent.prompt_cli --controlled inspect "$CID"
$PY -m workagent.prompt_cli --controlled delegate "$CID" 'Carry this forward' --criterion 'Review together'
$PY -m workagent.prompt_cli --controlled cancel "$CID"
```

CLI auto-selects an existing workspace only if uniquely authorized; otherwise pass
`--workspace`. It never creates or broadens membership. `--command-id` and
`--expected-version` (before subcommand) support explicit replay/CAS; prompt output
includes `command_id` and `submitted_work_version`. No controlled response is
manufactured in the CLI; the actual worker obtains context and commits the result.

For HTTP, start the existing local API with its usual environment and advance the
same admitted runs with this bounded worker batch (max 100 pending admissions):

```sh
$PY -m workagent.general_worker --controlled --workspace b1-workspace
```

No `--live`, `--provider`, or implicit mode works; refusal is before DB/credential
access. There is no provider key lookup/fallback and no call-grant reuse.

## Remaining acceptance gaps

- Engineering: see `GENERAL_CONVERSATION_VERIFICATION.md` for exact local test/demo
  results. Parent review and frontend contract ACK remain pending.
- Usefulness: **NOT TESTED**, zero inference; controlled wiring receipt is not a
  model capability demonstration or Andrew's usefulness judgment.
- Experience: **NOT TESTED**, no frontend implementation/browser review here.
- B2: no CSV reconciliation, typed table/file persistence, calculation provenance,
  edits or download route. Add those only with real broker-backed implementations.
- B3: no sandbox/tool execution, maker artifact, executable readback or revision
  preservation. No shell/WebAssembly framework is selected or added by this B1.
- Other gaps: no live provider grant, harness adoption, recurring ownership,
  invitations/production auth, source-scope editing, long-history pagination or
  summarization. Failure before controlled completion leaves recoverable queued/
  leased work; denial is not mislabeled as successful completion.
