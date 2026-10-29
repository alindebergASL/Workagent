# B3.1c narrow independent backend risk review

## Verdict

**PASS for the scoped integration diff; no concrete blocking defect found.** This is a source review with bounded static verification, not task closure, runtime acceptance, or live-model usefulness evidence. Parent-owned native/browser/combined journey evidence remains separate.

Reviewed working-tree changes against HEAD `9657a06cfbbcfc5f7c4176a0e8360b12c9e4515d`: `backend/workagent/conversations.py`, `backend/workagent/source_snapshots.py`, and the new `backend/tests/test_combined_attachment_bridge_pg.py`. Supporting existing transaction, ACL, queue/successor, file-read and capability-selection paths were inspected only as needed. No product files modified. Unrelated untracked `contracts/pnpm-lock.yaml` excluded.

## Exact reviewed source (SHA-256)

| File | SHA-256 |
| --- | --- |
| `backend/workagent/conversations.py` | `1d5bfe5de65715e6217191860d8810ca3819df35e8bc2bc8f9797a89f5bab141` |
| `backend/workagent/source_snapshots.py` | `8f2facbafc6285b89845489b737e8eec4687dd5d7cf027f05bb363f5b2948191` |
| `backend/tests/test_combined_attachment_bridge_pg.py` | `69100929d0757f22be6ef3ec6a8fefb21968ee32ea3ab90fb90d8cde01da4779` |

These hashes, not merely HEAD, bind this verdict to the uncommitted integration.

## Risk findings

- **Atomicity — sound by inspection.** `conversations.py:270–284` inserts the message before resolving its attachment evidence and before final bounded-context validation. `source_snapshots.py:54–70` uses the caller's connection for file rows, snapshots, audit and outbox. There is no inner commit, second connection or external effect. `_command` (`service.py:186–211`) holds the workspace write lock and commits the message/run/config/files/snapshots/receipt together through `Database.transaction`; a bridge or later context-validation exception rolls them all back. Queue admission uses an existing savepoint and records admission/held state in the outer locked transaction (`conversation_intents.py:118–173`).
- **Opt-in/backcompat — preserved within the intended scope.** Bridge admission requires a provider grant, a fresh rather than retained message, human message provenance, conversation ownership, and `files_enabled(pinned)`. Existing selectors require `sustained-v1` plus the exact file schema hash, or the explicitly composed compute/memory schema hashes. Legacy profiles remain outside the bridge; empty attachments do nothing. Historical attachments are not backfilled and replayed command receipts do not invoke the bridge. No migration, grant insertion, tool attempt, or execution is added. A worker draining a queued human intent is correctly eligible: eligibility follows retained human input, not `Principal.kind` alone.
- **ACL — no new bypass found.** Evidence creation invokes `_document_scope` (conversation owner plus current conversation source access), queries the exact workspace/conversation/human message, verifies human evidence origin and attachment ref/hash, and rechecks targeted artifact/revision dependency access. Reads continue through owner-scoped `_file_row` and re-resolve original evidence; source snapshot lookup alone does not bypass that check (`source_snapshots.py:73–85`, `workspace_files.py:94–121`). Human workspace membership/write role is checked by command admission. Tool reads still require independently installed exact selectors; making a source file does not grant the model access to it.
- **Exact original bytes — preserved for this UTF-8 attachment contract.** The locator points to the durable message attachment; neither helper parses, normalizes or copies its text into a draft. Evidence re-encodes the retained string as UTF-8 and validates SHA-256 and byte length; snapshot creation binds original/extraction hashes and lengths and reads revalidate both. This preserves CRLF, BOM and Unicode as admitted by the existing attachment contract, not arbitrary binary uploads or bytes already transformed before admission. New test covers CRLF and duplicate rows, not all byte edge cases.
- **Command/continuation/queued replay duplicates — protected by existing transaction boundaries.** Command receipt lookup occurs under the workspace write lock before mutation. Retained successor admission supplies `retained_message=original` (`run_successors.py:160–162`), explicitly skipping the bridge and leaving the original source locator intact. Queue drain supplies a fresh human message once; it moves the FIFO entry from pending to admitted atomically with admission, so subsequent/concurrent drains cannot recreate these rows. A savepoint failure rolls back partial bridge effects. Separate human commands with identical contents are intentionally new attachments, not duplicate command effects. The helper is not independently idempotent; its present sole caller provides that guarantee.
- **Source-pin binding — adequate for this change, with an important distinction.** `general_responses.consumer_hash()` includes both changed production files (`general_responses.py:19–31`); the file adapter implementation binding also includes `source_snapshots.py`. Snapshot locators and read checks bind exact source message/ref/hash to the file/version, and `_file_version` rejects a version belonging to another file. Existing grant hashes are historical provenance: `validate_grant`/`check_pins` deliberately do not require grant consumer hash to equal freshly computed installed source. This diff does not alter that policy. Therefore parent execution evidence must identify its actual installed candidate/source manifest; an old grant hash or accepted HEAD alone is not proof that this bridge ran.

## Nonblocking followups

1. **Add focused bridge regressions when next touching these paths.** The new tests exercise memory-profile opt-in, exact text/hash/locator, ordinary command replay and Service recreation, other-owner list/read denial, no tool grants/attempts, and legacy-profile exclusion. They do not directly execute successor continuation, queue drain/replay, concurrent same-command admission, or forced mid-bridge rollback. Recommended cases: two attachments with a failure on the second snapshot (no partial message/run/file/snapshot/outbox/receipt), repeated queue drain and successor continuation (unchanged file/snapshot counts and original locator), and direct snapshot denial to another owner. The inspected control flow is sound, so missing tests alone are not a concrete blocker here.
2. **Extend byte/profile coverage proportionately.** Include BOM + multibyte Unicode/trailing whitespace and direct file-only/compute-only opt-in tests. Current new positive test selects memory's inherited file capability; it does not independently execute each selector branch. No normalization or selector bug was found.

## Verification and limits

- `git diff HEAD -- backend/workagent/conversations.py backend/workagent/source_snapshots.py`: reviewed complete scoped production diff.
- `git diff --check`: exit 0, no diagnostics.
- `python3` AST parsing: PASS for all three reviewed files; no module execution, database access or generated bytecode.
- `sha256sum`: produced the exact hashes above.
- Did not rerun PostgreSQL tests, touch installed data, operate remote fixtures, run browsers, invoke models, change grants or close the task. Parent-reported 8 passing tests are context only, not independently reproduced in this review.
- One attempted batched read tool was blocked by unattended execution policy; ordinary read/terminal tools completed the review instead. No remaining review blocker.
