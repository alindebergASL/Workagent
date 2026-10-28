# B3.1b narrow correction rereview — FAIL

Reviewed the actual working tree (including untracked memory source/tests) over base `6f5897974b3e50024d46ecf09a053e969ab2cd03`, using `.local/batch3/b31b/independent-review.md` as the prior broad review. Exact reviewed-file hashes are in `reviewed-source.json`. This verdict concerns only the five correction findings and their material interactions, not broader product acceptance.

## Remaining material issue

**P1 — Native refresh still retains revoked revision-history payload when the inspected current revision remains authorized.**

- `backend/workagent/tui/memory.py:98–102` checks only whether the previously inspected **current** revision appears in the fresh authorized history. If it does, the method returns `True` without replacing or filtering `self.selected['revisions']`.
- `backend/workagent/tui/memory_screen.py:112–116` then leaves the existing details widget untouched. It was populated with the entire old inspection at `memory_screen.py:193`.
- This is a real distinction in the server contract: `backend/workagent/memory/store.py:181–188` reauthorizes and filters **each historical revision separately**.

Concrete sequence: create a work-area memory, correct its content, then narrow it to a linked task. Inspect the task-scoped current revision in the native screen, including the earlier work-area revisions. Revoke access to a selected source of the work-area conversation while leaving the task accessible. The task-scoped current memory remains authorized, but a fresh inspection omits the earlier work-area revisions. Refresh currently retains their old text in both controller state and the visible provenance/revisions detail. Thus finding 2's history/privacy failure is only partially corrected.

**Lightweight executed reproduction:** compiled the actual `MemoryController` class AST from the reviewed source, with a synthetic transport returning an authorized current revision and a history from which a previously displayed revision was removed. No product imports, network, database, browser or test suite were needed. Actual output:

```json
{
  "returned": true,
  "fresh_revision_ids": ["task-r2"],
  "retained_revision_ids": ["area-r1", "task-r2"],
  "revoked_history_payload_retained": true
}
```

This proves the controller retention path; the unchanged details-widget path is established by source inspection, not claimed as a fresh PTY run.

**Narrow repair:** reconcile every retained server-derived revision/detail against the exact fresh inspection, or clear the inspected payload when any previously displayed revision is no longer authorized. Preserve the original inspected CAS base and unrelated/new unsent typing when still authorized; do not silently adopt the new current revision. Bounded list absence alone must remain non-authoritative. The existing refresh regression only exercises whole-item denial/forget and page absence (`backend/tests/test_memory_recovery.py:52–87`), not partial history authorization loss.

## Disposition of prior findings

| Prior finding | Narrow result |
|---|---|
| 1. Forget receipt with pending/failed readback | Corrected: synchronous receipt notification precedes GET; panel purges forms/payload, fences old reads and masks later stale payloads; denied readback reaches access-loss clearing (`memory-commands.ts:150–166`, `MemoryPanel.tsx:278–299`, `memory-contract.ts:191–230`). |
| 2. Native refresh reauthorization | Partially corrected: exact-item denial/forget clears payload and bounded-page absence does not imply deletion. Historical-revision authorization remains defective as above. |
| 3. Review of temporary correction | Corrected: review retains exception base and validity; SQL enforces unchanged base/interval and direct review supersession. Rejecting an exception is explicitly refused rather than silently destroying its fallback (`review.py:8–14`, migration `058_typed_memory.sql:127–133,155–157`). Regression inspects recall before/during/after for accept and dispute. |
| 4. Web correction CAS | Corrected: drafts pin their original revision, submission uses that base, and adopting the displayed newer base requires an explicit action (`MemoryPanel.tsx:707–728,881–901,943–952`; `memory-contract.ts:240–275`). |
| 5. Newer typing erased by success | Corrected for the reviewed remember/correction paths: submitted fields lock through send/readback and cleanup checks the submitted object identity; unrelated drafts are retained (`MemoryPanel.tsx:346–358,451–476,716–731,828–875`). |

## Limits and changes

Read the requested regression source; did not rerun the parent-owned backend/web suites, build, browser or native journeys. Reported parent verification is not relabeled as reviewer execution. The single probe above is synthetic mechanism evidence, not live usefulness. No product source, board, services or paid product calls were changed. Created only this report and its reviewed-source SHA256 manifest. No additional broad review or stylistic gate is requested.
