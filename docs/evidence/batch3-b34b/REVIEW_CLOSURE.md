# B3.4b — closure of the existing independent risk review

## Disposition

**R1, R2 and R3 are closed in the inspected implementation. No concrete remaining code blocker was found in these findings or the specifically requested changed closure seams.** This is narrow review closure, **not final task/slice acceptance**. Parent owns execution, final source/evidence binding and acceptance claims. No paid evaluation or new broad audit is required by this report.

Scope: `REVIEW_INITIAL.md` findings, current `delegation.py`, migration 068, focused regressions, exact proposal binding, transitive implementation pinning, native read-only presentation, and strengthened completion-loss/process-restart tests. Untracked source files were read directly. Existing authority/product documents were consulted; source, configuration, secrets/env files, databases and task state were not modified. The only file created is this report.

## Finding closure

### R1 — compute/export assimilation bypass: CLOSED

- `068_bounded_delegation.sql:6–10` now gates non-delegation capabilities by their installed descriptor's `draft` effect rather than the former narrow file-capability list. `compute.python` declares this effect, so its ordinary reservation/resource checks are blocked while a child proposal is unresolved.
- Existing `057_compute_python.sql:27–43` calls the current `tool_file_resources_authorized` during compute export creation under the workspace lock. Consequently, the new gate also reaches the actual export sink, including a computation that was dispatched before a proposal became unresolved.
- `068:87–98` also covers response-stage `compute_python`, `run_wasm`, `reconcile_csv`, publication, file/export operations and reply, under the workspace fence. Delegation verification and ordinary read capabilities are not indiscriminately blocked.
- `test_delegation_review_pg.py:25–35` exercises delegation plus compute, requires denial and zero exports before checking, then successful computation and exact downloaded bytes after checking. That case is present and passing in retained `controls-final.xml`.
- Limitation: the retained focused tests do not separately demonstrate the `run_wasm`/`reconcile_csv` stage-denial branches or the pre-dispatch/post-proposal export race. Those specific branches were inspected statically, not newly executed by this reviewer. This is not evidence of a remaining bypass.

### R2 — incorrect child permanently blocks useful continuation: CLOSED

- `delegation.py:212–221` distinguishes a successful, correctly shaped verifier result with `passed:false` as **discarded**, returns no proposal, and retains inspection/check/execution evidence. An exception or malformed verifier output remains **checks_failed**, not discard or success.
- `068:75–86` recognizes either `checks_passed` or `discarded`, bound to the exact child attempt and proposal digest, with current source/processor authorization. Immutable prior bad results remain in history; no refund path was added.
- The policy text explains discard, prohibits treating discarded content as accepted, and preserves the distinction from human acceptance/memory admission.
- `test_delegation_review_pg.py:38–52` checks actual failure, exact discard, a corrected verified sibling, successful useful output and two retained child reservations. It passes in `controls-final.xml`.
- Existing direct child-to-procedure exclusion remains in `068:100–107`. Discard does not grant a new memory path. As before, executed parent-authored checks cannot enforce semantic honesty or prevent deliberate copying of discarded text; this is a bounded checking mechanism, not a trusted correctness oracle.

### R3 — exponent overflow silently normalized into another proposal: CLOSED

- `delegation.py:146–152` rejects non-finite `parse_float` results, literal non-JSON numeric constants and duplicate keys. Nested positive/negative overflow reaches the same parser hook.
- `delegation.py:204–225` turns rejected JSON into `failed` with no proposal/hash rather than allowing JSON serialization to normalize infinity into null. Execution stdout digest remains retained.
- Retained passing regressions include positive overflow, nested negative overflow, NaN, Infinity, duplicate keys, ordinary finite numbers, and an actual sandbox stdout overflow case (`test_delegation_review_pg.py:16–22,55–60`).
- This closes the reported non-finite normalization defect; it does not introduce an arbitrary-precision numeric contract.

## Changed closure seams

### Parent-accessible exact verification identity

**Sound replacement for the inaccessible outer-receipt hash.** `ChildProposal` exposes `child_attempt_id` and `proposal_sha256`; `VerifyDelegate` consumes them. `child()` restricts lookup by workspace, run, child capability, observed status, proposal state and exact digest (`delegation.py:98–107`). SQL independently matches the same pair (`068:17–24,80–85`). The immutable attempt supplies the rest of the retained provenance; the digest is explicitly a proposal-content digest, not an outer-observation digest.

`test_delegation_worker_pg.py:32–40` constructs verification solely from the child fields present in actual adaptive observations, rather than reading an inaccessible receipt hash. The retained production-parent `[False]` run demonstrates this path. The forged-digest rejection case passes in `controls-final.xml`.

### Implementation hash includes transitive authority

`delegation.py:231–236` now explicitly includes `compute_adapters.py`, `file_adapters.py`, `workspace_files.py` and `workspace_file_models.py`, along with sandbox implementation/protocol/profile inputs and migration 068. `registry.implementation_hash` hashes these bytes together with its common broker/policy/service/model/observation inputs; `_adapter` also includes registry source. The named compute/file authority dependency omission is closed. This statement is not an exhaustive new audit of every transitive dependency in the repository.

### Native Tool Activity

The new delegation projection validates receipt identity and child run/attempt binding, renders proposal/check/status/cost/limitation as text, and labels proposals unreviewed rather than accepted (`tui/tool_activity.py:53–94`). The existing screen uses a read-only TextArea and literal text; its delegation path supplies no compute export entries and introduces no execute/retry/accept control. Refresh clears visible evidence before reading and on refusal.

`native-03.xml` contains two passing mounted Textual/live-local-TCP cases, at 120×40 and 80×24. The tests select both child and verifier receipts, assert truthful labels/check text, revoke source authority, refresh, require empty receipt/export state, and verify HTTP 404. This is mounted native-widget/TCP evidence, not a newly performed physical-terminal, browser or full client-acceptance campaign.

### Completion ACK loss and real subprocess restart

The strengthened tests inspect correctly, with precise evidence-level limitations:

- `test_delegation_pg.py:168–187` now calls the actual sandbox client to completion, retains its successful/cleanup result in the harness, then raises `SandboxOutcomeUnknown`. It asserts unknown accounting, replay without another invocation, and refusal of identical/new-ID and changed-task relaunches. This is **injected loss at the client-return boundary after actual child completion**, not an actual TCP packet/socket ACK drop. Do not describe it as a network fault-injection test.
- `test_delegation_worker_pg.py:63–78` and `delegation_restart_worker.py` now use distinct Python subprocesses. The first exits 71 after the production worker's `after_tool_result` hook; the parent expires the lease; the second resumes using persisted deterministic provider state. Assertions require different PIDs, ready completion, exactly two child observations among five tool observations, retained checkpoint/account linkage, and no work on a later ready revisit.
- The separate retained `test_actual_reclaim_rotates_fence_and_blocks_changed_unknown_launch` verifies a real reclaim increases the fence and refuses a changed launch after unresolved dispatch. It is not substituted for a process restart.
- The process test is deliberate termination at a retained tool-result boundary, not arbitrary SIGKILL during provider or child I/O. Provider selections remain controlled; children use the actual isolation path.

**Execution qualification:** the strengthened completion-loss and subprocess-restart source is newer than the supplied retained results. At inspection there was no new final XML/process-result artifact in `.local/batch3/b34b` demonstrating execution of these exact strengthened versions. `controls-final.xml` must not be relabeled as proof of the newer completion-loss body, nor `worker-debug.log` as proof of the new `[True]` subprocess branch. Parent's fresh test-04 run owns that confirmation; absence of its result here is an evidence limitation, not an invented product defect or new audit gate.

## Retained evidence checked

Parsed testcase entries and failure/error/skip elements rather than relying only on summary text:

- `controls-final.xml`: **39 cases, zero failures/errors/skips**, including all focused R1–R3 regressions and the adjacent native controls. These are one retained batch, not 39 fresh reviewer executions.
- `native-03.xml`: **2 cases, zero failures/errors/skips**, as described above.
- `worker-debug.log`: actual production-parent `[False]` case ends **1 passed in 156.00s**. The preceding 45-second faulthandler stack dump is diagnostic, not a test failure. It is no subprocess-restart proof.

No DB-backed tests, service operations or paid calls were performed by this reviewer. Read-only inspection and XML parsing were sufficient for this bounded closure. The general-purpose `execute_code` tool was blocked before execution; ordinary file and terminal tools completed the read-only review without changing approval configuration.

## Inspected source identities

Working tree was not declared frozen. These SHA-256 values bind this report to the inspected closure source; parent must reconcile any later changes when binding final evidence.

```text
93b172bc8a40408343b1f82d9bbb8d085341451e6fbcd28f2ce4951c320d5e76  backend/workagent/capabilities/delegation.py
c6944ce24e351106a784511874b7d9e707f4a57f336fb18436e2ea35f5de97ea  backend/migrations/068_bounded_delegation.sql
a53a8383049e2a170b9bfe4eba9d66dcc869befac0adf3cbb784760fdf280509  backend/workagent/capabilities/delegation_composition.py
097a9111deabbe76a60b4c845e22c6926bbc25aad3ce70fb0b557f0727d8886a  backend/workagent/tui/tool_activity.py
71a2e6574a284b7220747b2fb1e7d99e598d3a0de446d23f14fd9fa1e30f369a  backend/tests/test_delegation_review_pg.py
91add766da38ad201611b2b76c87da664b85b53cf04effa506eaa447c358c982  backend/tests/test_delegation_pg.py
91fed7884bcab65372d34b668ff7c8f22b661c569451223dc45d97fe3d8085b2  backend/tests/test_delegation_worker_pg.py
621a908f24650d3db2979c6fba4baf15c95edef8bf2ea54636fa0f28a0c5b431  backend/tests/delegation_restart_worker.py
```

**Bottom line:** original findings closed; requested changed seams have no identified concrete code blocker. New strengthened-test execution and final acceptance remain the parent's responsibility. No autonomous specialist-model benefit, independent goal truth, full-suite pass or overall Batch3 acceptance is claimed.
