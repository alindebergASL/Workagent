# B3.2b web — 320px Files/export overflow fix

Same web lane; narrow layout fix only. No backend, conversations page,
Cloud/memory link, services, builds or commits. The four review-fix journal
changes are untouched (`web/src/lib/office-export.ts` unchanged, same hash as
WEB_REVIEW_FIX_HANDOFF.md; all their tests still pass).

## Changed paths

| path | sha256 |
|---|---|
| `web/src/components/FileExport.tsx` | b8d4696e8ed24788fc05d9ab22fca6fdab92ebf2936beb9edfbd489353a92210 |
| `web/src/components/WorkspaceFiles.tsx` | 5d5f39afd3aed5fdc4b3f30463b762dbcb4aba21f334b2a2d2e062f5e74a0e73 |
| `web/test/workspace-files-races.test.ts` | a0dcb8c49ce45f3d198fec7ad7457cde43d0b4daae18e45419d9a8e750d49e6a |
| `web/src/lib/office-export.ts` (unchanged) | e3f0dd9c6cbb7b3366b491bdf10a8419a184318f43fb1cefe163372baf48c136 |

## Root cause (from source)

1. `.stack-sm` (foundations.css) is `display: grid` with an implicit `auto`
   column, and grid/flex items default to `min-width: auto`. The Files
   section, file list, editor card, export panel, chart fieldset and copy
   block are all `.stack-sm`, so one unbreakable string (OOXML MIME type in
   the list row span, a long filename, a long option label) sized the whole
   card to its min-content width, which is why the card grew past the column.
2. `<fieldset>` defaults to `min-inline-size: min-content`.
3. `.btn` is `white-space: nowrap` (globals.css:384), so a long action label
   ("Export saved version snapshot_012…", "Abandon the unsent save (keeps the
   text)") could not wrap. The real-CSS test below found this one after 1–2
   were fixed.

## Fix (inline styles, scoped to these two components; no global CSS change)

- `FIT` = `WRAP` + `gridTemplateColumns: minmax(0, 1fr)` on the Files section,
  file `<ul>`, editor card, editor/creator `.stack-sm` blocks, export panel,
  chart `<fieldset>`, export result and editable-copy block.
- `SHRINK` (`min-width: 0; max-width: 100%`) on list `<li>` rows, `.field`
  labels, selects and chart inputs.
- `WRAP` on the list MIME/size span, list filename button (+`white-space:
  normal`), editor `<h3>` filename and `role=alert` hints.
- `BTN` (`SHRINK` + `white-space: normal; overflow-wrap: anywhere`) on the
  action buttons in FileExport (5) and WorkspaceFiles (8).
- Nothing is hidden: no `overflow: hidden`, no truncation; the chart table
  block keeps its existing `overflow-x: auto`.

## Real-CSS test at 320 and 390

New test "Files and export at 320px / 390px with the real stylesheets" in
`workspace-files-races.test.ts`. It drives the real components (WorkspaceFiles
with a long DOCX source, an XLSX source and a CSV in the list, the DOCX editor
open with its FileExport and editable-copy block; a separately driven PNG
chart export whose result has long filename/hashes/provenance placed inside the
same card shape). It serializes the rendered trees to HTML, loads them with
the app's five real stylesheets (globals, agent-first, foundations, products,
phone) into locally installed Playwright Chromium (no server), opens all
`<details>`, and asserts that at 320 and 390, (a) no descendant of the Files
card extends past the card, (b) `document.scrollWidth` ≤ the viewport, and
(c) the card stays inside a 33px page inset. A control at 320 strips the
component styles and asserts the same markup DOES overflow, which shows the
test catches the bug. Before the `BTN` change it failed with
`button.btn btn-sm right=356.7 "Export saved version snapshot_012…"`.
Limitation: the page around the card is a 33px-inset stand-in, not the real
conversation layout; the parent's production browser check is still the
authority.

## Exact checks (in `web/`)

- `node node_modules/vitest/vitest.mjs run test/office-export.test.ts test/workspace-files-races.test.ts test/export-download-proxy.test.ts test/files-contract.test.ts test/file-draft.test.ts` → `Test Files 5 passed (5)  Tests 111 passed (111)`
- `node node_modules/typescript/bin/tsc --noEmit` → exit 0
- `node node_modules/eslint/bin/eslint.js --max-warnings 0 src/components/FileExport.tsx src/components/WorkspaceFiles.tsx test/workspace-files-races.test.ts` → exit 0
- `node node_modules/prettier/bin/prettier.cjs --check` (same 3 files) → clean
