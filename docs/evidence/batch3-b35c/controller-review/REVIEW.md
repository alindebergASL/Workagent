# B3.5c scoped controller/transport review

## Verdict: CHANGES REQUIRED for a live-ready handoff

Reviewed implementation `4119e299249846796e567dab450f40a8f7e6b2e1` and evidence commit `1762d69f0b2b0d0773cb4bb8ce3a319932032df4` in the canonical continuation checkout. Controller manifest SHA256: `863e570706c1c6ce36df329481f074788166e5210cdce247b0afe20c97ab33be`.

The locked diagnostic implementation is useful and may be retained. **Do not release the paid switch or describe the candidate as fully live-ready:** four scoped defects below require correction. This is a technical review result, not a request for generic budget approval. Existing `t_fedd7a60` owns the integration handoff; `t_e07c8870` retains execution and `t_82b30c02` publication/acceptance. No new graph or competing isolation implementation was created.

This review independently examined only the new delta. Original run102 fixes remain **parent-verified closure**, not a retrospective second independent PASS. Existing public inputs, frozen oracles, original isolation launcher, network13 evidence, accounting diagnosis and additive receipt repair were reused unchanged.

## Findings

### R1 — P1: execution binding drops the retained environment pins and rebaselines dependencies

**Locations:** `evaluation/study_controller.py:128–140,148–150`; `evaluation/study_application.py:246–254`; `evaluation/study_worker.py:18–23`. Compare retained `evaluation/network_harness.py:113–127`.

The original launch binds the interpreter/system-Python files, runtime profiles/modules, migration files, ancillary dependency locks and tokenizer. The new worker's `execution_files` contains only `/worker.py`, `/network_worker.py` and `/study_transport.py`. The controller's durable binding does not cover the omitted environment. Dependencies are inventoried anew for every execute, rather than checked against a study-start lock. Consequently a changed runtime mount or dependency tree can become the next worker's accepted environment within the same study. Reusing the unchanged namespace mount launcher does not reuse its separate `readiness()` binding logic.

**Reproduced:** an actual Controller with the real frozen-input validator reopens the same SQLite study after a test-local `runtime/general-responses-v1.json` change without a binding error. A second probe captures the actual `execute()` launch payload before subprocess creation and confirms that all original environment pin classes above are absent. No real runtime/dependency file was modified.

**Required correction:** extend the existing retained environment-lock mechanism, not a replacement jail. Bind selected interpreter/system Python, mounted runtime/migrations/locks/tokenizer, dependencies and launcher identity once in the study identity; compare before application/worker execution and after restart. Carry those expected pins into the child. Targeted drift controls must fail before product/provider effects, including a dependency change between episodes. Preserve the original receipts and the current release lock.

### R2 — P1: a cold controller trusts any tree found at the B0 path

**Location:** `evaluation/study_controller.py:128–140`; `evaluation/study_application.py:58–62`.

The controller records the current B0 directory inventory as its expected value. Application setup compares the loaded tree with that same directory and self-derived hash; neither comparison anchors a fresh study to the accepted B0 source. The public preparation freeze contains no baseline paths. Restart drift detection is present, but first-start baseline substitution is not rejected.

**Reproduced:** a shadow checkout with byte-preserved frozen inputs and a B0 tree containing only a deliberately incorrect `__init__.py` is admitted by the real Controller and produces an `open_trajectory` call. The protocol peer is fake, so this proves controller admission, not execution of that invalid backend. No original baseline was modified.

**Current evidence is not mislabeled:** independently comparing the retained baseline to git commit `26e599b3db8a61b73eeeaea4f87a1d3de0b296d9` gives **103/103 files matching**, no missing/extra files. The defect is missing enforcement for a new study, not observed corruption of controller12. The old `evaluation/harness.py:129–134` already demonstrates accepted-manifest validation.

**Required correction:** validate B0 against the accepted immutable baseline manifest/commit and B1/M1 against the explicit reviewed candidate binding before creating/admitting a new study. Record those anchors in the durable identity. Reject an altered/candidate-as-B0 tree on cold start, not merely on resume.

### R3 — P1: official bindings admit aliased longitudinal and other-project scopes

**Locations:** `evaluation/study_application.py:70–93`; `evaluation/study_diagnostic.py:77–83,119–123`.

Official setup checks access and grant JSON/treatment, but not that the original and other workspaces differ, that transfer/other conversations differ, or that independently blinded trajectories own disjoint contextual state. `ProductAdapter` also accepts the supplied per-blind-ID binding map without a cross-trajectory uniqueness check. Valid access is not experimental isolation. Episode6 may eventually detect accessible old artifacts, but that is after earlier paid episodes and state mutations; it does not prevent cross-trajectory reuse.

**Reproduced:** exercising `open_trajectory()`'s post-release logic with strictly in-memory fake service/database objects accepts two identical workspace IDs, identical original/transfer/other conversation IDs, and the same grant for both scopes. All ordinary access/grant callbacks succeed. The test temporarily stubs the release check only inside its process; it never changes the source lock, connects to SQL, obtains a credential or makes a provider call.

**Required correction:** preflight exact longitudinal identity invariants and cross-trajectory scope ownership before any live study effects. Reject aliased workspaces/conversations and reused project-memory context across independent trajectories; bind the accepted mapping durably. Sharing accounting infrastructure need not be forbidden—context isolation is the requirement, not new funding pools. Add negative tests for within-trajectory aliasing, cross-case/arm aliasing and mapping drift on restart. Existing synthetic evidence remains valid: diagnostic setup creates separate disposable trajectory scopes.

### R4 — P2: the verifier accepts substituted evaluator packets

**Location:** `evaluation/verify_study_diagnostic.py:87–92` (export interface: `study_controller.py:229–240`).

The verifier checks packet count, null quality/effort and absence of a top-level `variant`, but does not bind each packet's identity, episode, oracle hash, messages or artifacts to the corresponding collected result. Nor does it enforce a bijection of packet identities or exact artifact body hashes in the exported packets themselves. The collected SQLite results are checked elsewhere, but those checks do not authenticate the separate files a scorer consumes.

**Reproduced:** copy the retained evidence to a test-local directory; change one packet to an unrelated blind ID, episode999, zero oracle hash and empty artifacts/messages. The unchanged verifier still returns `PASS` with72 blinded packets. No retained packet was changed. This is not evidence that the original72 packets are wrong; it is a missing negative check.

**Required correction:** derive the expected packet payload from each bound collection receipt and compare exact canonical content and unique identities, including evidence label, pending judgment and null scores. Reject substitution, duplication, omission and stale export. Preserve arm/oracle-content separation and do not add scoring feedback to worker ingress.

## Verified safeguards and evidence scope

- Independently reran the existing **15 targeted tests: PASS**. This includes controller ordering, all72 exact protocol ingresses, receipt/payload drift, no resend across unknown outcomes, controlled-loopback provenance and locked live admission. These are not15 live trials.
- Added **11 independent zero-network probes: PASS against the observed candidate**: five tests reproduce the four defects, six exercise retained guards. A passing defect reproducer means the defect exists, not that it is repaired.
- The added safeguards directly exercise the real ProductAdapter receipt boundary: lost committed acknowledgement is observed after adapter restart without a second child launch; failed child remains unknown and is not resent. The actual `study_worker.py` subprocess rejects official mode before any source/config/SQL access. Controlled mode rejects explicit credentials, live grants and unknown transport names.
- Read-only rerun of the retained controller12 verifier returns12 trajectories,72 scripted episodes,504 local HTTP requests,252 scripted generations,12 interruption/resumes and zero duplicate create sends. This reuses the implementation's actual worker/SQL receipts; **no fresh full worker campaign was run**.
- All **13 controller manifest files** and **57 run102 additive-bound files** match. The retained B0 matches all103 accepted git source files. No implementation, public input, oracle, original receipt or frozen baseline was edited.
- Existing mount/PID/user namespace isolation, clean environment, closed inherited-FD behavior and Landlock port policy are reused at their original scope. There is no new claim of an IP firewall or a broad independent re-audit of that boundary. R1 specifically concerns missing binding inputs in the new worker path.
- Scoring remains separate and unscored; no judge was invoked. R4 limits confidence in the current packet verifier. No model quality, full-tool live trajectory, download or desktop/phone/native usefulness approval is given.

## Reproduction

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=evaluation:backend backend/.venv/bin/python -m pytest -q evaluation/test_study_controller.py
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=evaluation:backend backend/.venv/bin/python -m pytest -q docs/evidence/batch3-b35c/controller-review/test_scoped_review.py
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=evaluation backend/.venv/bin/python evaluation/verify_study_diagnostic.py .local/batch3/b35c/controller-12
```

`independent-probes-01.log` retains the first11-pass run. Strengthening the two source-binding tests to use the real frozen validator initially hit a test-shadow symlink `SameFileError` (02:2 failed/9 passed); this was a reviewer fixture error before the tested behavior, not a product failure. Final03 uses copied evaluator files and the real validator and passes11/11. These overlapping attempts are not additive totals. No original evidence was overwritten.

## Handoff and authority

Review phase is complete; **live-ready approval is withheld until R1–R4 are closed with narrow regressions**. Route corrections through the existing implementation/integration ownership; do not add a new graph, repeat the full review or implement a competing isolation framework. A follow-up should inspect only the exact fixes and their relevant negative controls.

`LIVE_EXECUTION_RELEASE=None` remains unchanged. Zero paid product/judge/search calls, allocations, PostgreSQL provisioning, installed database/grant/accounting changes, ledger recollections, model/profile changes, deployment or default merge were performed. Only task-local review evidence/tests and temporary test SQLite/copies were written. No provider credentials or private accounts were accessed. The unchanged100USD ceiling and unanswered installed-accounting-maintenance approval remain separate from these technical findings.

The original12 trajectories/72 **live** episodes, independent quality/effort scoring, model-produced downloads and actual desktop/phone/native outcomes remain owed. Reviewer: GPT-6-Astra/openai-codex in this separate review run; no additional reviewer spawned. Development/review-tool costs remain outside the product ledger and unreconciled.
