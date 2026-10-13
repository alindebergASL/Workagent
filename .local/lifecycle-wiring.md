# Lifecycle domain / parent integration handoff

Base `a0764115ecc24ef4ca3cf3832c483249c64a1ea6`. Latest existing migration verified **016**. This branch reserves **018_responsibilities.sql**; 017 is runtime-owned. Do not insert 017 into a DB already migrated directly from 016 to 018: migration journals require an exact prefix. Use a fresh isolated DB for combined 017+018 verification.

## Required Service and API wiring (parent owns shared files)

`from .responsibilities import Responsibilities`; put `Responsibilities` **leftmost** in `Service`'s mixins. Its `_event` override calls canonical `_event`, then reconciles only subscribed assignments in the same transaction. No second scheduler, task store, memory store, or run store.

DTOs live in `workagent.responsibility_models`, imported directly by API. Do **not** re-export them back into `models.py`: they reference canonical `Assignment` and this would create a circular import.

Suggested exact routes, using existing principal/workspace/command/error envelope middleware:

| Method/path below `/v1/workspaces/{ws}/assignments/{aid}` | Method | Body | Return |
| --- | --- | --- | --- |
| `POST /responsibility` | `activate_responsibility(p, ws, aid, cmd)` | `ActivateResponsibility` | `ResponsibilityDetail` |
| `PUT /responsibility` | `update_responsibility(p, ws, aid, cmd)` | `UpdateResponsibility` | `ResponsibilityDetail` |
| `POST /responsibility/control` | `control_responsibility(p, ws, aid, cmd)` | `ControlResponsibility` | `ResponsibilityDetail` |
| `GET /responsibility` | `get_responsibility(p, ws, aid)` | none | `ResponsibilityDetail` |

Activation operates on an **existing delegated assignment**, never creates a second assignment/task, requires its canonical owner, an open same-audience conversation, assignment CAS, and no prior assignment run. Legacy intake and unsupported B1 paused handovers do not become ongoing responsibilities by projection. Activation is explicit; tests prove actual saved-context events drive the same opted-in responsibility after activation. Canonical `Assignment.id/owner_id/goal/completion_criteria/work_version` remain authoritative. Lifecycle is nullable metadata on that assignment row. Legacy `Assignment.state` remains `paused` (or `cancelled`) because this branch admits no execution; it MUST NOT be interpreted as its ongoing ownership/wait state. Render the explicit lifecycle for opted-in rows only. Legacy assignment control forwards opted-in records to lifecycle pause/resume/cancel; historical semantics otherwise survive.

### Exact input DTO fields

Activate/update use canonical `schema_version='workagent/v1'`, `request_id`, `command_id`, `expected_work_version`, plus full replacement plan:

- `current_outcome: Text` — descriptive, never trusted verification.
- `next_action: {kind, description}`; kind is `continue_work | review_dependency | request_decision | await_event | obtain_grant | obtain_tool`.
- `dependencies: [{kind: artifact_revision | source_version, object_id, expected_version}]` (0–50, unique kind/id).
- `wait: {kind: person | dependency_change | check_in, reason} | null`.
- `next_check_in_at: aware datetime | null`.

A dependency wait requires a reference; a check-in wait requires a time. Submitted dependency versions must be current; re-acknowledging an old artifact base fails CAS. Artifact refs must belong to this exact conversation (or assignment), sources must be explicitly selected by the assignment; all current source, artifact revision, conversation and membership authority rechecks apply. No ambient workspace private-data searches.

Control takes canonical command fields, `expected_work_version`, `operation: pause | resume | cancel | takeover`. Pause retains pending review and check-in changes but queues no wake. Resume rechecks current dependencies and authority. Cancel/takeover retire wakes, fence claims and are terminal for this ongoing lifecycle (takeover leaves saved human work and canonical owner unchanged; it means the human has taken handling back). These operations neither fabricate completion nor cancel unrelated conversation turns.

### Exact response fields

`ResponsibilityDetail = {assignment: Assignment, lifecycle: ResponsibilityLifecycle, local_review_eligible: bool, provider_execution_queued: false}`.

Lifecycle includes the plan plus:

- `schema_version='responsibility/v1'`
- `state: active | waiting_person | waiting_event | blocked | paused | cancelled | taken_over`
- `outcome_status: unverified | needs_review`
- `observations`: dependencies plus `observed_version`, `content_hash`, `changed` (same-version source-content drift also triggers review).
- `review_required`, `check_in_due`, `conversation_work_version`, `last_change_key`
- `blocker: grant_required | tool_required | authority_unavailable | conversation_closed | null`
- `wake_id: Id | null`, `wake_status: none | queued | reviewed`
- `execution_status='not_admitted'`

A changed dependency or due check-in can be **blocked for continuation, but eligible for local readiness review**. With no active exact principal/workspace/conversation general grant, a `continue_work`/`review_dependency` action gets `grant_required`. Revoked/run-count-exhausted scopes also block. This query is only an existence/run-count check: even when a scope exists, full canonical admission/pins/shared budget/tool/grant limits must still run. Missing tooling/grant does not discard ownership. The parent's newly approved evaluation grant is **not installed or used here**.

## Canonical events and exact trusted worker seams

The MRO hook reacts to real `human_save`, `accept_proposal`, `complete_run` (only canonical product observations), `post_message`, and `cancel_conversation` events. It compares persisted versions/content hashes/conversation version; unchanged deliveries do not bump lifecycle version or queue duplicate wakes. It preserves saved revisions, human notes and proposal bodies. Creating/approving a product never completes the responsibility. Material changes increment **the same assignment's work_version**, invalidate claims, and write a canonical `responsibility_changed` audit/outbox event. At most one current `responsibility_wake` is pending; superseded wakes are retired without ACKing source events or run dispatches.

Use these methods from the **existing** parent consumer, not a new loop:

1. `reconcile_responsibility(p, ws, aid) -> ResponsibilityDetail`: exact-target catch-up under current owner, for reconnect/imported source changes and explicit grant installation/revocation. This is how changes without an existing domain event become durable. No caller-provided clock or completion.
2. `reconcile_due_responsibilities(Principal(owner_id,'worker'), ws, limit=50) -> list[assignment_id]`: bounded owner/workspace check-in sweep for the existing worker tick; compares actual saved timestamp with DB/app time. Do not claim scheduled delivery until this hook is integrated.
3. `claim_responsibility_wake(Principal(owner_id,'worker'), ws, aid, expected_work_version) -> ResponsibilityReviewCapability`: exact owner; persistent secret-hash lease, 30-second expiry, monotonically increasing fence, workspace access generation, assignment version and wake binding. Catch-up is committed even when a stale requested version then conflicts. Refresh after conflict. Human/API/model callers cannot claim.
4. `review_responsibility_wake(cap) -> ResponsibilityReviewReceipt`: current authority/snapshot/fence validation, atomic local readback + exact wake ACK; a fresh Service can resume the live capability or reclaim an expired lease. Lost-ACK replay returns the same receipt under current authority and snapshot. No provider execution.

`ResponsibilityReviewReceipt = {responsibility: ResponsibilityDetail, reviewed_wake_id, continuation: ResponsibilityContinuationRequest | null, provider_execution_started: false}`.

For next-action `continue_work` or `review_dependency`, `continuation` is an **inert, exact-snapshot request**:

```
assignment_id, workspace_id, conversation_id, owner_id, wake_id,
expected_work_version, expected_conversation_work_version,
goal, completion_criteria, current_outcome, next_action, observations,
execution_admitted: false
```

It remains returned for blocked responsibilities to explain what cannot run. It is **not** an admitted run. Stable `wake_id` is the parent's command-idempotency input; do not invent another work item.

## Remaining parent continuation binding — required before any live claim

The child implements and tests event-driven lifecycle/wake/readiness, not provider continuation. Parent must wire the existing worker to the above local review receipt and, only under the separately installed exact evaluation grant:

- Revalidate `assignment_id/owner_id/workspace_id/conversation_id`, assignment work version, conversation version, observed artifact revision IDs/body hashes and selected sources in the same admission transaction. A received request is not reusable authority after pause, cancel, takeover, source revoke, new human edit or steering.
- Admit through the existing canonical general admission/broker/run-dispatch path, with a stable command identity derived from `wake_id`; **forbid controlled-transport fallback** if a managed continuation lacks a scoped grant. Do not call plain `post_message` blindly: at this base it falls back to controlled transport when no grant exists and labels the new message human. Parent must preserve truthful lifecycle origin rather than fabricating a new human instruction.
- Persist an exact run-to-responsibility binding on existing canonical records and extend the execution readback fields before reporting an admitted/queued/running provider continuation. Current literals deliberately always say false/not-admitted. No new responsibility is created; no result may overwrite current saved edits or mark the goal complete from preparation/approval.
- Pause/cancel/takeover must fence any parent-added continuation run using that binding. This branch only fences existing runs whose canonical `assignment_id` is this responsibility; it never cancels unrelated conversation runs. Parent's new conversation-run binding must extend that narrow cancellation check.
- Dependency-triggered admitted continuations count within the parent's 10-new-run ceiling. Preserve the existing cumulative reservation/count-only unknowns and exhausted prior allowance. This child makes no provider calls, installs no grant and changes no budget ledger.
- If model lifecycle tools are needed, expose only separately reviewed capability-bound operations for the current run's exact conversation/assignment/version. Do not expose generic principal/workspace service methods, worker claims or grant installation as model/HTTP tools.

Natural-language new-task/delegation selection, continuation admission/execution, independent goal-completion verification and frontend/API integrated behavior remain **pending parent integration/live proof**. Do not represent these as demonstrated by the provider-free lifecycle tests. Do not remove the truthful paused-handover disclosure or present “Take it from here” as working ongoing execution merely because these fields exist. The retained native conversation with no assignment is not retroactively delegated by this patch. Parent owns generated contracts, shared runtime, public docs/issue 15 and coordination with the existing Claude frontend owner.

## Executable verification

Use the existing venv but this checkout's explicit module path. Fresh provisioning via `backend/dev_db.py` (base launcher has no `isolated-env` command); env files are private/ignored and never committed.

```
PYTHONPATH=$PWD/backend /home/ubuntu/workagent-flexible-work/backend/.venv/bin/python backend/dev_db.py --env-file .local/another-fresh-lifecycle.env
set -a; source .local/another-fresh-lifecycle.env; set +a
PYTHONPATH=$PWD/backend /home/ubuntu/workagent-flexible-work/backend/.venv/bin/python -m pytest -q backend/tests/test_responsibilities.py
```

The focused suite uses real restricted-role PostgreSQL; synthetic saved products come from the existing deterministic capability-bound local domain (no model selection, client, runtime loop or provider delegation). It proves unrelated responsibilities, actual human-edit dependency events, pause/resume/fresh-Service recovery, due-time wake, command/CAS/idempotency/claim fencing, exact scope denial and source revocation, human-edit survival, no prepared/approved completion, and no provider attempt/run-dispatch manufactured by local review.

Final child verification: **19 focused PostgreSQL tests passed**; focused plus `test_domain.py`, `test_conversations.py`, `test_general_products.py`, `test_flexible_work.py`, and `test_flexible_edit_recovery.py`: **103 passed, one existing Starlette/AnyIO deprecation warning, 210.97 seconds**. `git diff --cached --check` and added-line shell/eval/deserialization/SQL-interpolation/provider-construction scans passed. An earlier broad run hit a 180-second tool timeout; the complete rerun used a 600-second limit and passed. No independent provider-backed reviewer was launched (child delegation/calls were prohibited); parent code review and actual Service/API/worker integration remain required. Private disposable DB: `workagent_test_6c17e38b1d57`, env `.local/lifecycle-tests-final.env` (ignored, not committed). The first provisional isolated DB was superseded before final migration validation; no saved review/live DB was touched.
