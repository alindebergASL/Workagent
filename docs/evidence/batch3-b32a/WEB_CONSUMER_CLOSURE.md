# B3.2a web consumer closure — working-file editor citations

**Status: consumer gap closed and verified in the actual original fixture02 browser conversation, before and after one owned-process restart.** No commit, push, board action, backend edit, DTO change, DB edit, provider/model/tool call or run re-entry beyond `readback.py`'s fake-provider zero-call check. Merge/review/publication remain with parent.

## Changed files (only these app/test files)

| File | SHA-256 (source == candidate, path-for-path) |
| --- | --- |
| `web/src/components/WorkspaceFiles.tsx` | `a7b5b913d66047c84ae9385bc5fbaf9cbb2b6a8306847644806ccca9422cf5f7` |
| `web/test/workspace-files-races.test.ts` | `d04855503575985880cb01251042c3c90d0fb8b766dc518a5ca12b53ac9530b5` |

Pre-copy candidate hashes were `ffd14405…a09a5` / `52d79319…5f1b`; after copy `diff -rq web/src candidate/src` and `web/test` were identical (`web-consumer-copy-01.log`).

Harness (not app): `.local/batch3/b32a/browser-file-citations.mjs` `81c666a2f5e82226e2581d461a3b5f3019160e5b31eea28c4601227581bb0ad7`.

## Change

`FileEditor` (editable files only) looks up the citation binding for the **exact saved version it holds** (`loaded.ref.version_id`, which is set only from a verified readback, never from typed text or the list head). It makes one read of the existing canonical `GET /work-snapshot?conversation_id=`. That response goes through the existing `parseWorkSnapshot` validator and is frozen, and only the frozen result is consulted. An artifact binds only when its `current_revision_id` equals that saved version. Its `id`/`body_hash` are then passed to the existing `ArtifactCitations`, keyed `${ws}:${revision}:${body_hash}`. There is no new DTO, client module or backend change.

- If the head has moved, or the snapshot is refused or unreadable, nothing is bound, so a wrong revision is never shown.
- The lookup re-runs only when the saved version changes, i.e. after a save. Unsaved edits and list metadata refreshes neither rebind nor touch the textarea. While the editor is dirty, a note says the citations describe the last saved version.
- The 401/403/404 clearing and the `Refresh citations` control are inherited unchanged from `ArtifactCitations` and its reader.
- The conversations page, WorkCard, ResearchSources and the artifact-detail route are untouched. The artifact page still has no citations consumer, which is not an acceptance blocker per the prompt.

## Checks

| Check | Result / log |
| --- | --- |
| `npx tsc --noEmit` | exit 0 — `web-consumer-typecheck-01.log` |
| vitest: workspace-files-races, research-readers, research-sources, file-draft, files-contract | `Test Files 5 passed`, `Tests 67 passed` — `web-consumer-focused-01.log` |
| eslint + prettier --check on both changed files | exit 0 — `web-consumer-lint-01.log` |
| RED check: the 4 new tests against a source copy with the mount removed (`WF_RACES_SRC_ROOT`) | 3 failed / 10 passed (the 4th new test asserts the *absence* of citations, so it correctly passes either way) |
| Candidate `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1 npm run build -- --webpack` (isolated candidate only; root `.next` untouched) | exit 0, 7/7 static pages, BUILD_ID `f81VUigyJq5lbmurBaPTo` — `web-consumer-build-01.log` |

There are 4 new focused tests:
1. The editor mounts `ArtifactCitations` on the exact saved artifact/revision/body hash, using one canonical snapshot read.
2. Dirty text plus a metadata refresh (same version, and then a moved head) keeps the exact human text, keeps the v1 binding, and makes no re-read.
3. A moved head or a refused (404) snapshot binds nothing.
4. A save rebinds to the new revision's exact body hash.

## Runtime / processes (owned only, via `services.py restart`)

| When | API PID | Web PID |
| --- | --- | --- |
| Before (fixture03, from handoff) | 4068117 | 4068161 |
| Switch to fixture02 (`file-citations-restart-switch-01.log`) | 4090397 | 4090449 |
| One verification restart (`file-citations-restart-02.log`) — **left running on fixture02** | **4097920** (start 121982688) | **4097968** (start 121982888) |

Before-records are in `evidence/file-citations-processes-before-{switch,restart}.json`. No other service was touched.

## Browser evidence (original fixture02 conversation `a9d861d9-a339-449b-9cb8-e62461b0618d`, workspace `b32a-5d09866f-…`)

Final passes:
- `browser-file-citations-04.log`: `PASS file-editor citations initial4 …`
- `browser-file-citations-05-restart.log`: `PASS file-editor citations restart …`

Both runs verified the following on the real rendered page (`evidence/browser/file-citations-{initial4,restart}-*`):
- **Exact human textarea:** the textarea equals the fixture human body, UTF-8 SHA-256 `f72e37e4a2e656e9dd9d6830cb089f5650f9a24c4fa4c12034cf176497d7b8bd`, which equals the file `current.sha256`.
- **Exact binding:** `data-revision` is `5f0ee19e-3b1f-4e68-b15f-ed31d54c469c` and `data-body-hash` is `1c69d66ee30e34106ea248e67752e6bde6f8149bd55befa27ab872c7aac34e50` (artifact `af15eddc-cb9e-4e39-b010-b380e7e9f7ba`). Every claim's `revision_id`/`body_hash` equals that binding.
- **Unsupported claim:** `1fd06878…` ("entire organization … 99 units") shows "No supporting quote recorded".
- **Stale claim:** `79ccb056…` is `potentially_stale`, with the stale warning and badge visible.
- **Captures loaded:** after clicking the saved-version citation controls, the real details of both captures loaded, and no load buttons remained.
- **Quotes:** the cited quote matches capture A exactly (characters 20–54); there are 0 mismatches.
- **Capture details:** the rendered text contains:
  - A (version 1, 10 units): raw `b8a97f26…c9370`, extracted `9363f305…954d`;
  - B (version 2, 12 units): raw `f8f15d38…37fa`, extracted `ae916256…14cb`;
  - final URL `https://fixture.example/source`, the complete-coverage text, and the claim IDs.
- **Widths:** 1440/390/320 with no horizontal document overflow. The screenshots were taken after the claims became visible, so they show the result, not a skeleton. The 320 full-page PNG was visually inspected and shows the rendered claims and capture details.
- **Refresh:** `Refresh citations` and `Refresh sources` were clicked while the textarea was saved, and again while it held unsaved text. Both times the textarea value was unchanged and the binding was unchanged. A same-document marker survived, so there was no navigation.
- **Requests:** only GET requests were made; the harness fails on any non-GET request.

**Readback after restart:** `readback.py browser file-citations-after-restart` reported `passed: true`, `provider_calls: 0`, 3 completed runs, and counts unchanged at tool_attempts 7 / events 14 / costs 14 / provider_events 75 / source_snapshots 2 (`file-citations-readback-01.log`, `evidence/file-citations-after-restart-readback.json`).

## Failed attempts (preserved)

All failures below were in the harness, not the app:
- **`browser-file-citations-01.log` (initial):** capture A's nested disclosures were not opened, so A's hashes were missing from `innerText`.
- **`-02` (initial2):** `Refresh citations` was matched by its label, which changes to "Checking…" while it runs.
- **`-03` (initial3):** the second refresh found the button hidden because the citations disclosure had collapsed after the first refresh.

Failure PNG/TXT/JSON files are kept under `evidence/browser/file-citations-initial{,2,3}-*`. The run interrupted by the outer timeout left no partial state; this resume reused the existing edits, tests and build.

## Limitations

- **Disclosure collapses on refresh (inherited, not fixed here).** After `Refresh citations`, the "Sources for this version" disclosure collapses (recorded as `collapsedAfterRefresh: [false, true]`). This is inherited `ClaimsList`/reader behaviour that is outside the allowed edit scope: while it is checking it likely remounts its `<details>`. The data and binding are unaffected. It is a minor UX follow-up for the ResearchSources owner.
- **Only the editor consumer:** the artifact-detail page still has no citations consumer.
- **Not rerun here:** the 404 clearing was not re-exercised on this fixture; that was already verified on the fixture03 document. The full web suite and `npm run ci` were not run; only targeted checks were.
- **Accepted assumption:** binding relies on the work snapshot listing the working-file artifact. It does in this fixture, where `workspace_file_id` equals the artifact id.
- **Cost:** CLI cost is outside the product ledger; there were zero product provider calls.
