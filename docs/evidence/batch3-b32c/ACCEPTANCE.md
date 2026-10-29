# B3.2c — confined code/log diagnosis and patch/test outputs

This slice adds readable web/native confined execution receipts and proves exact-version patch/test work through the existing GeneralWorker, shared files, capability gateway and gVisor service. No arbitrary host execution API, installer, repository token, SSH, deployment or paid product call was introduced. Publication and CI are recorded in the final task handoff, not implied by this document.

## Evidence and scope

The independently prepared carousel bundle was unfamiliar to the implementer. Its evaluator-only oracle was frozen before diagnosis (SHA256 `39fc05a6829ea8fd280a95f000b8f93f1f3e39bc0cada41a745f0d99ea848af6`), never placed in product storage or solve-time jobs, and run only in separate confined evaluator jobs after exact candidate freezes. Supplied code, dependencies, tests and malicious log text were retained as exact shared-file refs. Code/log text is data; it grants no authority.

- v1: inspection identified dropped wrap/full-lap coverage; initial hypotheses and synthetic log reports were distinguished from executed results. Real baseline tests failed, then the same supplied entrypoint passed against the proposed source.
- v2: phase-codec2.0 changes absolute stop to duration. The new human maintenance-bypass comment and behavior remain intact. The implementation tests the changed baseline rather than rolling back to v1. The old pending v1 proposal is rejected with `version_conflict` against v2; the saved human revision/body remain unchanged.
- Transfer: a related complement-of-occupied-ticks API required a separate fix and execution. The initial transfer request stopped honestly at a synthetic-provider budget limit; that partial run is retained. The completed transfer uses a separate disposable workspace and scoped synthetic grant, not a replay or reset of paid liabilities.
- Supplied tests fail before and pass after for all three stages. Independent held-out results are494/494,518/518 and494/494. These are synthetic mechanism results, not a paid-model usefulness evaluation or proof that arbitrary bugs can be fixed autonomously. Parent-selected decisions use a clearly labeled controlled transport.
- Downloaded patches apply exactly to their recorded bases and reproduce the frozen candidate hashes. `applicability.json` includes exact immutable inputs. The entrypoint is supplied `tests.py`, executed in the worker against original/candidate source. Actual stdout, stderr (including empty stderr), exit status, code/input/image/profile hashes and resource receipt are retained. Patch proposals remain pending, never silently accepted.

## Interruption and isolation

A real application process exits42 after the second computation is durably recorded and before continued observation. The owned isolation service is restarted; a new app process resumes the run. Only two computation attempts exist, repeated completed-run calls produce no new selection/execution, and publication is retained. Additional restricted-PG checks cover unknown service death, late-publication fencing, revoked access, stale proposals and exact HTTP download hashes.

The unchanged B3.1a runtime is reused: pinned gVisor, no network/host mounts/ambient credentials, fixed Python stdlib, finite CPU/wall/memory/PID/output limits. Four real isolation tests recheck network/metadata/hostPG denial, host/secret/proc isolation, unavailable pip, read-only inputs/root, collection boundaries, fork limits and process cleanup, and rejection of argv/path abuse. A shell subprocess *inside confinement* is possible; no host shell capability is exposed. Historical confinement acceptance remains in `../batch3-b31a/HANDOFF.md`.

## Actual clients and review

The optimized isolated candidate serves the real API. Actual browser controls view failed and successful receipts, download patch/source/tests/applicability bytes, and verify them against exact manifests before and after service restart. Desktop1440 and phone390/320 show no horizontal overflow; screenshots were visually inspected. Actual native PTY controls show failure and resources, download the same verified patch, and reopen after restart. Offscreen widget tests are supplemental, not substituted for PTY evidence.

Web now says `Receipt recorded`, not generic `Completed`. Failed tests stay failed; unknown/unavailable states do not imply success or that nothing ran. Output is inert text. Current-scope requests discard stale responses. Failed/refused refreshes clear old records. Refused/mismatched downloads withdraw the affected receipt until explicit successful refresh; the actual browser fault regression also checks late-download suppression.

One Astra/high reviewer found two P2 issues in the initial web implementation. Both are closed by the same reviewer in `REVIEW_CLOSURE.md`; the original HOLD remains in `REVIEW_INITIAL.md`. The existing sole Opus5.5 web owner made the web changes; Hermes implemented native/integration. Development CLI cost snapshots are separately disclosed in the handoff, not product-ledger spending.

Targeted verification:39 native tests;23 final web tests plus TypeScript/lint/format and optimized build;8 restricted-PG integration tests;4 real isolation tests. Counts overlap earlier attempts and are not added to a single total. Initial failing harness/unit logs are retained. `SOURCE_MANIFEST.json`, `BUILD_BINDING.json` and `EVIDENCE_MANIFEST.json` bind the final files and receipts.

## Limits and continuation

Python source/logs use the existing inert text-file substrate (`*_py.txt`, `incident_log.txt`), staged under flat `.py`/`.txt` worker names. Patch download is unified-diff text `patch.txt`, not repository integration. No package installation or arbitrary dependency management is supported. Unsuccessful execution does not publish generated files; stdout/stderr remain in its receipt. Web Tool activity currently shows the latest run; native offers recorded runs. The retained earlier partial transfer is not relabeled as success. Readback evidence, not UI task state, establishes the narrow result.

No installed-data migration, destructive maintenance, default-branch merge, public release or runtime promotion occurred. Isolated proof services are stopped at final handoff; retained fixture databases and runtime snapshot remain. B3.3a public read-only GitHub connector is the existing successor `t_aec74bff`. This is not Batch3 or product-mission completion.
