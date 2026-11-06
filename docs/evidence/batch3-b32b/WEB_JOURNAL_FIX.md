# B3.2b web review fix — findings 1 and 2 (REVIEW_INITIAL.md)

Same web lane, narrow fixes only. No backend, conversations page, Cloud/memory
link, services, builds or commits. Contracts not touched: lane
`contracts/{openapi.json,src/schema.d.ts,workspace-files-v1.json,capability-registry-v2.json}`
are byte-identical to root (cmp).

## Changed paths (delta vs the integrated lane version)

| path | sha256 |
|---|---|
| `web/src/components/FileExport.tsx` | f29b7da371de7c563e3c9cd2d17ebf7adbc6006bd31355247374088802ba6443 |
| `web/src/components/WorkspaceFiles.tsx` | 6c8922a55e5f8381b40a8c3c67da4aa987b80048516146f386047e7b043f0da2 |
| `web/src/lib/office-export.ts` | e3f0dd9c6cbb7b3366b491bdf10a8419a184318f43fb1cefe163372baf48c136 |
| `web/test/workspace-files-races.test.ts` | 0575671ed00fca86ccad64d4daa093ca174b5eae48c02aa06479fcaab77f85d9 |

(`office-export.test.ts`, `export-download-proxy.test.ts`, route.ts unchanged
in this pass except prettier no-op.)

## Finding 1 — acknowledged copy survives readback/list/open failures

- `EditableCopyAction` no longer uses `runJournaled`. Command journal
  `workagent:office-draft:<ws>:<cid>:<fileId>` (unchanged key/shape) plus a
  new result journal `<same key>:result` holding the exact acknowledged
  `WorkspaceFile`. Flow: journal command → POST → (live mount owning that
  exact command only) journal result → exact readback → `openFile(result)` →
  only then clear result, then command.
- While a result is held, the button is "Open the created copy": it re-checks
  and re-opens that same result; **no POST, no new command id**. Readback
  refusal and open failure both keep command+result (unresolved) with a
  visible reason. A stored result without a replayable command is never acted
  on (discard-only; discard clears both). POST failure rules unchanged
  (ambiguous/ever-ambiguous keep; definite refusal of never-ambiguous clears).
- `WorkspaceFiles.openFile(target: WorkspaceFile)` now reads `listFiles`
  directly, propagates any failure, and selects only when `openTargetProblem`
  confirms the exact id, workspace, conversation and current version/hash;
  otherwise throws (status-0 validation ApiError). `FileEditor` default
  `openFile` throws instead of silently succeeding.
- `runJournaled` (exports): readback now runs BEFORE resolving; a mismatched
  manifest keeps the export journal (retry replays the identical body).

## Finding 2 — exact bindings

- `editableCopyReadbackProblem(body, file, {workspaceId, conversationId})`
  additionally requires `workspace_id`/`conversation_id` equal to the page
  scope and `office_provenance.source_snapshot_id === body.source.version_id`,
  `extraction_sha256 === body.source.sha256` (backend `_file_version` /
  `source_snapshots.read`: a source-snapshot file's version id is the snapshot
  id and its sha256 is `sha256(extraction)` = `extraction_sha256`).
- `manifestReadbackProblem` requires `chart.input_sha256 === body.sha256`
  (backend hashes the exact converter input; for the only charts the UI
  enables — saved CSV / typed office-v1 workbook JSON — that is the saved
  version's bytes).
- Fixtures that previously carried mismatched bindings were corrected.

## Tests added (all handler-level through the real components)

- Export mismatch table + "chart input hash" case; each asserts journal retained.
- Copy refusals: original id, read-only, non-JSON, no provenance, other
  workspace, other conversation, other snapshot, other extraction hash — each
  asserts no open, command+result retained, retry makes no second POST.
- Failed open ×2 then success: 1 POST, `cmdSeq` 1, same target each time,
  both journals cleared only after success.
- Reload with command+result: opens with zero POSTs/commands.
- Orphan result: never acted on, discard clears.
- Late answer after remount: dead mount records nothing; live mount replays
  identical bytes.
- `WorkspaceFiles.openFile`: list failure rejects, absent target rejects,
  moved version rejects (selection unchanged), exact target opens the copy.

## Exact checks (run in `web/`)

- `node node_modules/vitest/vitest.mjs run test/office-export.test.ts test/workspace-files-races.test.ts test/export-download-proxy.test.ts test/files-contract.test.ts test/file-draft.test.ts` → `Test Files 5 passed (5)  Tests 110 passed (110)`
- `node node_modules/typescript/bin/tsc --noEmit` → exit 0
- `node node_modules/eslint/bin/eslint.js --max-warnings 0` (5 touched files) → exit 0
- `node node_modules/prettier/bin/prettier.cjs --check` (same) → clean
- Full unrelated suite not rerun (per instruction).

## Limitations

- `openFile` confirms against the first list page (limit 100); a copy beyond
  it reports "not in the file list yet" and stays journaled.
- A refused (mismatched) copy or export stays unresolved by design; the UI
  offers only the same retry, no fresh command.
- Review finding 3 (backend BOM) is out of web scope.
