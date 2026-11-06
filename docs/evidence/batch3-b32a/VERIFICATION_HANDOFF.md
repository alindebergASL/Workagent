# B3.2a targeted verification handoff

## Decision / remaining acceptance

**Do not mark B3.2a complete yet.** P1 regression and narrow P2/P3 behaviors are verified, and the independent native journey is complete. One normal-browser integration gap remains: the `files.create_draft` result in the original browser conversation has no message ProductResult/WorkCard, and neither its WorkspaceFiles editor nor its artifact-detail page mounts `ArtifactCitations`. The browser therefore cannot inspect citations bound to that exact human-edited working-file revision. See `.local/batch3/b32a/PARENT_WEB_ALERT.md`. This helper did not hand-author web application code or delegate another implementation/review. The Claude web owner must close that consumer gap, rebuild the isolated candidate, and repeat the original-browser citation checks. Parent owns the single independent risk-review closure and any publication.

**No commit, push, board transition, production model/search call, installed-data migration, fixture deletion, or historical grant/receipt rewrite was performed by this helper.** Existing unrelated `contracts/pnpm-lock.yaml` was preserved. The known earlier parent root `.next` build caveat remains; this helper built and served only the isolated candidate.

## Code changes owned by this helper

- `backend/migrations/060_research_dependency_visibility.sql`: extended `research_run_dependencies_visible` with a recursive, cycle-terminating `UNION` over `retained_result_reads` whose decision is `read_result`. The original direct-tool guard missed derived retained-result dependencies because `read_result` creates no new tool attempt.
- `backend/tests/test_research_revocation_pg.py`: actual restricted-PostgreSQL + actual worker regressions for capture A / cite B / revoke A while grant B remains active, and for a third run copying B through retained `read_result`.
- `backend/tests/test_research_http_pg.py`, `backend/tests/research_http_fixture.py`: deterministic local HTTPS search/capture transport, snippet-vs-evidence, exact selector/processor refusals, replay and missing-production-processor checks.
- Integrated Claude-authored narrow fixes from the isolated web lane only: `web/src/components/ResearchSources.tsx`, `web/src/lib/research-readers.ts`, `web/test/research-readers.test.ts`. These contain the canonical404 cache clearing/race fences and explicit mounted metadata-refresh controls. No web app files were hand-authored here.
- Ran canonical contracts generation/check after pins changed. The existing parent backend/native integration remains otherwise intact.
- Added/updated local fixture, browser, actual-PTY, readback, migration-proof, service and packaging harnesses under `.local/batch3/b32a/`. Sanitized mirrors are under `docs/evidence/batch3-b32a/harness/`.

## P1: restricted-PG proof

Fresh isolated fixture: `workagent_test_8d84414d1881`; runtime role `workagent_test_8d84414d1881_runtime`. Original isolated fixture retained: `workagent_test_a13af852fbcc`. Migration060 was applied only to those disposable DBs. `migration-proof.py` checks current database naming, restricted/non-superuser/non-bypass-RLS runtime privileges, full migration count and every stored migration checksum against the source files. Records are `records/migration-*.json`.

The real-worker regression pauses at `after_tool_result`, already-prepared selection2, and already-counted selection2. It then revokes only A, asserts B is still active, and verifies:

- both run tool-observation list and individual tool-observation endpoints go from 200 with the quote to 404 without the quoted payload;
- `Ledger.snapshot`, repeat `prepare`, `count_send`, and `dispatch` deny with `not_found_or_not_authorized`;
- direct restricted SQL count/dispatch insertion cannot bypass the trigger (`research dependency no longer visible`);
- resuming the actual worker adds no count or generation call to the controlled provider;
- immutable tool events, tool-cost entries and provider events remain byte-equivalent JSON rows; the human artifact revision remains unchanged;
- a third run consuming B's retained checkpoint is also denied after A revocation, despite having no direct research tool attempt.

The provider is AlphaProvider/controlled transport, not a paid product provider. SQL fixtures and capability secrets stay private. Failed early fixture02 runs remain in `.local/batch3/b32a/focused-04.log`, `revocation-debug-05.log`, `revocation-06.log`, and other numbered logs. Existing profile/pin/state differences were not repaired by changing old history; the definitive regressions use fresh fixture03.

## Exact successful checks

Working directory for all commands: `/home/ubuntu/workagent-continuation-20261026`. Source the named private fixture env without printing it, and set `PYTHONPATH=$PWD/backend:$PWD/backend/tests:$PWD/.local/batch3/b32a` and `WORKAGENT_RESEARCH_ENABLED=1`.

| Command/check | Real output / evidence |
| --- | --- |
| `backend/.venv/bin/python -m pytest -q backend/tests/test_research_unit.py backend/tests/test_research_pg.py backend/tests/test_research_revocation_pg.py backend/tests/test_tui_research.py backend/tests/test_research_retrieval.py` (fixture03) | `37 passed, 1 warning in 219.77s (0:03:39)`; `checks/focused-08.log`. Independent collection confirms 37 named tests. |
| `... pytest -q backend/tests/test_research_revocation_pg.py -k 'prepared or counted'` | `checks/revocation-exact-09.log`; rerun after tightening exact SQL error assertions. This is a subset rerun, not extra unique tests. |
| `... pytest -q backend/tests/test_research_http_pg.py` | `3 passed, 1 warning in 26.95s`; `checks/http-pg-01.log`. |
| Web research readers/sources/workspace-files race tests + typecheck | `Test Files 3 passed (3)` / `Tests 38 passed (38)`; `checks/web-focused-02.log`; `tsc --noEmit` exited0. |
| ESLint/Prettier on the three integrated Claude files | exit0; `checks/web-style-03.log`. |
| `(cd contracts && npm run generate && npm run check)` and final `npm run check` | exit0; `checks/contracts-02.log`, `checks/contracts-final-03.log`. |
| Candidate `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1 npm run build -- --webpack` | optimized build completed; `checks/build-isolated-02.log`; Next16.3.4, static pages7/7, route table recorded. |
| `git diff --check` | exit0. |

The one pytest warning is Starlette's deprecated `anyio.abc.BlockingPortal` alias, not a failed assertion. Existing actual-browser jail and public SSRF proof logs (`browser-isolation-01.log`, `tests-01.log`) are preserved; they were inherited successful checks rather than gratuitously rerun here. The new affected deterministic transport tests were exercised.

## Browser proof and its precise limitation

Main original fixture02:
- workspace `b32a-5d09866f-cba2-4282-9be3-2a28a9c6b5c7`;
- conversation `a9d861d9-a339-449b-9cb8-e62461b0618d`;
- loaded browser at1440/390/320, exact existing human textarea value, no horizontal document overflow, both captured source versions/metadata and the still-pending proposed update;
- screenshots `browser/width*-human-loaded.png`, `browser/source-*-metadata.png`, `browser/unaccepted-proposal.png` were rendered and visually inspected, not accepted as loading skeletons;
- after owned API+web restart, `browser-verify.mjs` passed again (`checks/browser-verify-final.log`). It explicitly records the missing current-working-file citations consumer instead of calling that acceptance complete.

Separate normal Home-created document fixture03 was used to verify the actual mounted WorkCard consumer, without pretending it is the missing file-editor consumer:
- workspace `b32a-f4b8adb0-83d6-426e-b393-618817c6abab`;
- conversation `9ebbcc25-9b0a-4e5b-a101-8f3164bfbe5c`;
- actual normal user prompts, actual worker, controlled TLS source and `publish_artifact` document; exact revision/body hash bound in `browser/document-proof.json`;
- at1440/390/320, claims/unsupported status, citation offsets and exact-source checking rendered with no horizontal document overflow;
- to isolate the explicit refresh control from automatic polling, Playwright delayed **real background non-research GETs only**; no response bodies, research responses or source content were fabricated. Before explicit click the stale count stayed fixed; `Refresh citations` increased it while a same-document browser marker survived, without full-page navigation;
- only the source-A grant in this separate fixture was revoked. The real `/research/snapshots/<A>` response was404; all previously displayed `.research-claim`, `.research-evidence` and quote matches in the citations reader cleared, and the access-changed message appeared. `browser/document-real404-cleared.png` was visually inspected;
- exact success: `PASS actual mounted 1440/390/320 citations, unsupported claim, exact source, stale refresh without reload, real canonical404 clears quotes.` (`checks/browser-document-05.log`).

Earlier browser-document04 failed because polling had already advanced freshness before the harness's zero-stale assertion; that failure log is retained. The successful05 run establishes an honest baseline and delays genuine background polling to isolate the explicit click. Older failed/unused document IDs and raw failure screens remain private; no database history was deleted.

## Native actual-PTY journey

Independent native conversation `a7e8600d-8179-40ba-8126-251a91619c90` in fixture03 was initiated through the ordinary composer using a real pexpect child and pyte ANSI parsing, not Textual pilot or widget methods. It performed:

1. Normal research request; actual worker used the controlled HTTPS source with10units and misleading99unit discovery snippet.
2. Native Files editor opened exact `research-conclusion.txt`; F7 selection, bracketed-paste multiline human annotation, real Ctrl+S save; authenticated readback equals exact UTF-8 human content.
3. A new normal user request and cite run bound claims to that human revision (not its parent), with an explicitly unsupported all-depots extrapolation.
4. A normal native source-change request and changed12unit fetch produced an update proposal; the human body was not overwritten and the proposal was not accepted.
5. Work → Saved results → Working file → Citations & freshness; both A and B metadata, version/time/hash/coverage/trust, complete source text and claims/quotes were inspected at100x45 and80x35.
6. Fresh native processes after owned API/web restart reopened the saved human edit. Supplemental `native-human80-human-annotation.png` and `native-human100-human-annotation.png` visibly show the full exact annotation; both were inspected. These correct earlier viewport-clipped screenshots without redoing any model/tool work.

Real exits: `native100 exit 0`, `native80 exit 0`, `native readback exit 0`, `native human80 exit 0`, `native human100 exit 0`. Final text logs have `ACTUAL PTY PASS inspect`, `ACTUAL PTY PASS restart80`, `ACTUAL PTY PASS human80`, `ACTUAL PTY PASS human100`. Action JSON, PTY text and PNGs are in `pty/`; raw ANSI remains private.

Earlier native harness attempts failed on restoration/layout timing, unfocused nested scroll areas, and an unnecessary re-open action despite already-restored exact content. Successful harness now waits for actual current-saved state, explicitly focuses metadata/claims before scrolling, and scrolls the outer editor to expose the human annotation. No native app change was needed for these harness errors.

## Exact snapshots, human hashes, restart and zero-repeat

`restart-proof.json` programmatically compares before/after records, not merely matching counts: source objects/raw bytes/extracted text, exact current human revision, proposal objects, receipt counts and empty repeated-provider-call arrays are equal; both owned service PIDs changed. `records/*-readback.json` contain the actual authenticated snapshots and raw UTF-8 bodies.

Shared synthetic sourceA/version1/10units:
- raw SHA256 `b8a97f264aa68a5dfb402cf2b8eac65bdcb575d9da624d52814473d20c0c9370`;
- extracted SHA256 `9363f305ceceef4dbd3e87c9ea8e36b9cc4ebad985f193fdd3b46eff4bc8954d`.

Shared sourceB/version2/12units:
- raw SHA256 `f8f15d385bbc5269b7e6c82e67eb26ab40b6c4e019d392ffc1606f48726537fa`;
- extracted SHA256 `ae916256563bc97d82606557f5bcae9ec7e4d0092b21da777cd78ed9d70314cb`.

Exact human UTF-8 SHA256:
- original browser `f72e37e4a2e656e9dd9d6830cb089f5650f9a24c4fa4c12034cf176497d7b8bd`;
- native `e43a2f4dd56d853d272326fbcd06331c4a46d329d7a557fc6b2b9bc84def85c5`.

For each main browser/native conversation before and after restart: `tool_attempts=7`, `tool_events=14`, `tool_costs=14`, `provider_events=75`, `source_snapshots=2`, completed runs3. Re-entering all completed runs through the actual worker yielded `provider_calls=0`, no new observations/costs/captures, and one pending update proposal. This is zero **repeat** provider activity, not a claim that the initial synthetic worker made no controlled calls.

## Transport / public fetch

`test_research_http_pg.py` proves real local HTTPS search returns `deterministic_http_fixture`, labels99unit snippets `discovery_only`, and creates no source snapshot until a separately authorized fetch. The fetch yields10units and retains the source injection literally as untrusted text. Replay makes no extra HTTP request. Exact private query and URL changes, allow-browser changes, and omitted processor selectors all deny before tool creation and with zero HTTP calls. Missing production search processor returns explicit `unavailable`, zero calls and zero candidates.

`public-fetch.json` preserves the parent's actual public HTTPS GET of `https://example.com/`: HTTP200, raw bytes/base64, coverage/version metadata, extractor and hashes. It is explicitly separate from the synthetic source demonstration. The synthetic malicious instruction remains raw source text; no model/tool executed it.

## Current owned runtime and safe continuation

At final readback the services are deliberately left running on **fixture03**, not fixture02:
- API PID **4068117**, `http://127.0.0.1:18234`, cwd repository root;
- candidate Next PID **4068161**, `http://127.0.0.1:13234`, cwd `.local/batch3/b32a/candidate/web`;
- process start identities are in `.local/batch3/b32a/processes.json` and sanitized `runtime-processes.json`.

Only these recorded process groups may be restarted with the helper. `services.py` verifies exact PID/cwd/start before stop, checks ports, and preserves stop records. Do not touch the unrelated older root Next service. Candidate backend/runtime/web source hashes were compared against current source with no differences. Candidate web dependencies are symlinked; its `.next` is isolated. Private environments remain `.local/batch3/b32a/fixture-02.env` and `fixture-03.env`.

To inspect the original browser conversation, source fixture02 (without printing), set the usual URL/PYTHONPATH/research env, and run `services.py restart`; otherwise the current fixture03 DB correctly will not contain the fixture02 conversation. Switch back to fixture03 for the native/separate-document conversation. Do not install new pins into old historical grants to force them to pass; use new runs where new authority is needed.

## Evidence and omissions

Sanitized package: `docs/evidence/batch3-b32a/`, with test/build logs, browser/PTY PNG+text+action JSON, controlled worker contexts/observations, source bytes and hashes, authenticated readbacks, migration and process records. `SOURCE_MANIFEST.json` records candidate source hashes; `EVIDENCE_MANIFEST.json` hashes the package. Packaging scans for the known private env credentials/passwords/bearers and excludes env files, TLS keys, private session files and worker-capability state. Raw failed logs remain under `.local/batch3/b32a/`.

Outstanding acceptance is the original browser human-working-file citations consumer described at the top. The separate document proves the mounted P2/P3 behavior, but is not substituted for that missing integration. Parent must review the small SQL correction and regressions, resolve the web consumer gap with its existing web owner, and make the final acceptance/publication decision. No production search processor or paid model behavior is claimed; the unavailable production search behavior is intentional and tested.
