# B3.0b accepted — exact-version files, evidence and basic exports

2026-10-28 · Task `t_04c80dd1` · branch `hermes/b2-conversational-client` · base `8d90e353e92a403eed521e9feea43b037997f307`.

**PASS for B3.0b only.** This is the current acceptance record; earlier HOLD/RED/quota records remain historical. The coherent feature-branch commit is identified by the task completion metadata and Git history. Existing computation successor `t_ae17ebd1` is the next slice, not a new task or a Batch3 completion claim.

## Final correction and source identity

Claude Code, owner-selected `claude-opus-5-5[1m]`, completed the isolated R3/R4 patch. Hermes integrated only `WorkspaceFiles.tsx`, `file-draft.ts`, and `workspace-files-races.test.ts` after verification. Dead-mount success/error handlers now return before persistent journal/draft mutation. Exact-envelope replay and matching draft ownership preserve newer work; unresolved saves lock editing rather than silently discard later text. Post-hash fencing prevents an unmounted creator from journaling a new command.

`final-source-manifest.json` pins64 intentional source/contracts/test paths. Relative to the previous63-path checkpoint,61 are identical, two web paths changed, and one regression file was added. Backend, native, exports, contracts and their accepted proofs are unchanged. `final-build-source.json` independently pins209 matching main/lane inputs. New optimized build `zBl5D_CnV0WybW-13m2vQ` completed exit0 with no input changes. Main `.next` was not rebuilt.

## Named acceptance and evidence

| Requirement | Verified evidence and scope |
|---|---|
| Real HTTP/restricted-PG creation, bounded read/edit/export and download bytes/digest | Retained `resume-final-core` includes `test_workspace_files_parent_http.py`, `test_workspace_files_pg.py`, export/unit/native checks; production source unchanged. Fresh final browser uses actual current-source API and same verified disposable database. |
| Cross-workspace/owner IDs and counts denied, artifact aliases private | Retained R1 regression/review and SQL056; final13-case journey group passes. Current restricted role again verified non-superuser/non-BYPASSRLS; all56 migration checksums match. |
| Path/symlink/archive/MIME abuse; CSV injection vs safe negatives; BOM/newlines/Unicode/annotations/omissions | Retained parent HTTP, file unit, basic-export and file-draft checks in the qualified core group. No affected code changed. |
| Exact hash/base/CAS; stale human edits; immutable old evidence after refresh/restart | Retained PG/gateway/native tests and final worker journeys. Original attachment storage reused, no duplicate originals store. |
| Actual web1440/390/320 create/edit/export/download/reopen and separate drafts | Retained three-width real browser journey covers four basic export formats and digest readback. New final three-width production-browser proof covers all changed replay handlers, actual API outcomes, same-JS-realm Next Link unmount/remount, reload and independent composer. |
| R3 lost save ACK and newer text preservation |45 focused web tests pass, including9 actual-transpiled race tests;10 independent parent-handler cases pass. Real browser at every width proves unresolved editor locked, identical replay, newer edit after settlement survives reload, independent composer preserved. |
| R4 late A after replay A/new B; old A before live replay A | Real browser at every width delays/loses ACK **after real HTTP201**. Exact envelopes retained; late A cannot remove B journal/draft; reload replays B once. Opposite ordering leaves live A journal intact until live success, then creator recovers. Both editor/creator orders also covered by actual-hook regressions. |
| Responsive controls | Both retry controls focused, visible and center-hit unobscured after normal center scrolling at1440/390/320; no horizontal overflow or page errors. Desktop and phone captures inspected; at320 controls wrap without clipping. Not a claim that controls are visible at every scroll position. |
| Actual native PTY80x24/120x40 create/edit/export/reopen/draft preservation | Retained120 full journey and80 corrected reopen/download proof; initial80 timing failure remains exit1. No native/backend changes since those receipts. |
| Optimized build, focused checks, independent risk review | New optimized webpack build exit0;45 tests + typecheck + full lint exit0. ONE narrow independent Astra correction rereview PASS on exact3 hashes; original resolved R1/R2 and unaffected broader review reused. |

### Test qualifications are preserved

- Retained backend core: **123 passed / 1 failed**, exit1; the only remaining failure was a test accessor typo. The corrected **13-case rerun passes** and includes it. This is not relabeled as a wholly green original suite.
- Retained transport/gateway: **163 passed**. Final worker/R1/R2 journey group: **13 passed**. These overlap other evidence; no inflated aggregate total.
- Original four R3/R4 RED cases, partial39PASS/1schedulerFAIL, parent4PASS/1old-firstFAIL, strict-type failures, timeouts and historical HOLD reviews remain intact.
- Final browser setup first missed explicit BFF origin, then an exact `getByLabel` locator failed on populated text, then390 non-centered scroll hit-testing failed under the sticky composer. No product code changed to evade these checks. Final named run uses textbox accessible names, normal centered scrolling, fresh synthetic fixture and passes all three widths. Initial failure log remains; its screenshot/result path was accidentally reused by attempt2, which is disclosed in the manifest.

## Reproducibility and evidence

`final-verification-manifest.json` contains actual argv/exits, log hashes, retained-proof bindings and negative qualifications. `final-browser-results.json` publishes only outcomes/control geometry/envelope digests, not stored drafts. `r34-final-review.md/json` binds reviewed bytes. `final-api-source.json`, `r34-final-runtime-identity.json` and `r34-final-pg-identity.json` bind actual services and restricted database.

Parent harness sources `r34_final_browser.cjs` and `r34_run.py` are retained here; execute from the matching private `.local/batch3/b30b/` layout, not directly from this evidence directory. Final browser used `R34_OUT=r34-browser4 R34_FIXTURE=r34-final4-fixture.json`; Next used explicit loopback backend18772/origin3199. Private env/DSNs, fixture journals, raw agent contexts and incidental lockfile are excluded. Screenshot inventory/hashes are in `final-browser-image-index.json`; local captures remain under `.local/batch3/b30b/r34-browser4/`.

## Operating boundary and next work

Owned proof API18772 and Next3199 were stopped after verification; both ports closed. All five original processes remain alive and untouched. Candidate implementation is locally committed, **not installed/promoted or remotely pushed** by this task. No product-provider calls, installed-data maintenance, destructive cleanup, private-account expansion, new task graph or default release.

The Claude command retained `--max-turns30` and1200s timeout, same account. CLI returned success/exit0 and `num_turns37`; preserve that reported counter rather than claim it is30. Configured limits were not increased. CLI development list-cost estimate is approximately1.164319USD for this invocation, not actual billing; historical estimates remain separate. Astra review billing is unmeasured. Product budget/unknown liabilities were not changed.

B3.0b acceptance releases only the existing `t_ae17ebd1` computation dependency. Computation, office-format fidelity, scoped memory, later tools/evaluation and Batch3 final acceptance remain future slices.
