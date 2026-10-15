# Independent final review — frontend PASS; successor CHANGES REQUIRED

## Exact reviewed bytes

- Candidate: `4aa70fed9ec522a51bc973e7c22ee254cfb2ac1d` (clean before and after).
- Sole frontend owner: `133e857287cab0204a6c210bd1951b539860ec15`.
- Candidate and owner `web` tree both: `f757cb55fdfa258d2e26ab68069237a55b6d422e`.
- Successor helper `.local/overnight-batch3/successor.py` SHA256: `81cfd85a6134a44636d7c4ca22b6aa1a0e15ae31e8a04eb20be6dd8d31162174`.
- `SpaceView.tsx` SHA256: `6dc3d484b4ca3c5ea961c3bd82c4f8d41d6377b90c733790368ba8ee24c6a199`.
- `FlexibleWork.tsx` SHA256: `90fc5505e4a1b873fee0d8c51ac3f3976ed2786ad28cdcbb26ae883ac16d23b7`.

## Required change — STOP is not the last pre-I/O check

**Location:** `successor.py:299–304`, the new HTTPX `request_guard`:

```python
stopped()
candidate(p['candidate'])
verify_route_record(p['route'], g)
```

The hook closes the original count-to-generation / same-visit-poll gap when STOP already exists at hook entry. However, `candidate()` runs two synchronous git subprocesses after the STOP observation. A STOP arriving during candidate or route validation is not checked again; the request is then dispatched with STOP already present.

**Controlled reproduction:** actual helper `run_one`, actual `ResponsesTransport` and its HTTPX request hook, `httpx.MockTransport`, a deterministic worker sequencer, and isolated fake DB/service/credential boundaries. Six safety assertions fail: inject STOP during candidate or route checks, for count POST, generation POST, and response GET. The mock handler observes STOP present at entry in each case. An additional test retains the **actual candidate validator and real read-only git commands**, creates reviewer-local STOP on return of `git rev-parse HEAD`, and observes a generation POST after the clean-tree check completes. That seventh safety assertion also fails.

**Fix direction:** keep early STOP checks if desired, but add `stopped()` as the final statement in `request_guard`, after candidate and route validation. Do not change the canonical transport, bypass SQL permits, retry, refund, or reset intents. Seven paired controls adding only a final in-memory request-hook STOP check suppress all these requests. This is a removable validation-order gap, not a demand to retract an already in-flight request or achieve atomic filesystem/network cancellation.

**Verdict for this helper hash: CHANGES REQUIRED; no activation/live-spend approval.** Rehash and rerun the boundary tests against changed bytes. The reviewer did not edit the helper.

## Closed / approved within scope

- **Readonly clone allowlist fix: PASS.** The fresh reader namespace receives only the exact mutually matching prepared/target clone identity, retains the legacy allowlist, leaves the original list unmodified, rejects unprepared names, validates returned clone identity/read-only status, and uses a read-only local transaction. Five independent synthetic positive/negative cases pass. Actual clone inventory was not accessed in this review; prior read-only receipts are inherited, not reissued.
- **Account observation timestamp fix: PASS.** The actual hashed account body's `checked_at` must equal the wrapper and independently satisfy freshness. The retained 30-day-old body/current-wrapper reproduction now rejects. All 22 DB-free retained package gates pass, including hash/model/project/route/grant/allocation negatives.
- **Frontend owner delta: APPROVED for the reviewed denial/pinned-guidance scope.** Both get/proposals refusals suppress the selected iframe and hold Send despite faster/later failures or pending same/other-work reads. Choice and draft survive; Control+Enter sends nothing; complete fresh reads restore the view. Another work's denial does not suppress the selected work. Transport-only retention is labeled uncertain. Exact-version-pinned views give regeneration guidance rather than impossible rebinding instructions.

## Independently executed evidence

All counts are parsed and asserted in `verification.json`, not inferred from exit codes:

- Frozen in-place component/browser cases: **13/13 PASS**.
- Frozen retention cases: **17/17 PASS**.
- Frozen overlay lifecycle/scope cases: **6/6 PASS**.
- New denial-order/sibling/recovery matrix: **27/27 PASS**.
- Pinned guidance: **1/1 PASS**.
- Total controlled browser checks: **64 PASS**; no observed browser exceptions or external requests in instrumented reports.
- Package gates: **22 PASS** (`package.xml`).
- Final helper boundary suite: **18 PASS / 7 FAIL**, no skips/errors/xfails (`boundaries-complete.xml`). Passing checks comprise five allowlist cases, six existing-STOP/same-visit boundary cases, and seven final-check controls. Failures are the single required-change class above.

Earlier boundary runs are preserved (`boundaries.xml`, `boundaries-final.xml`); they are overlapping checkpoints, not additional unique coverage. The final complete run includes the real-git candidate-validator pair.

Browser checks run actual React components/hooks with controlled APIs, not real-service/Next E2E or natural-model usefulness tests. The new helper tests isolate SQL/worker operations and never load a real credential; they are not a rerun of the prior real-GeneralWorker/PostgreSQL installer suite. Those prior results remain attributable to the previous reviewer/parent.

## Scope and reproducibility

Read `STATUS.md`, batch3 handoff, prior successor/frontend reviews, and batch2 final backend review. Confirmed no backend runtime/migration/contract delta from `a719f28`; only `backend/tests/test_operator_replay.py` differs in backend. Reuse unchanged backend reviews. No full backend suite or production build rerun is claimed.

All created files are under `.local/overnight-batch4/review/`: this report, copied/adapted private harnesses with provenance, new tests, JSON/XML/logs, browser captures, and synthetic pytest temporary evidence. Product/helper/web/control files, secrets/envs, original checkout/data, real DBs/services, grants and installed state were not touched. No provider calls, inference, installation, account lookup or new encumbrance.

From repository root, browser checks use existing Node dependencies:

```sh
TMPDIR="$PWD/.local/overnight-batch4/review" node .local/overnight-batch4/review/space-denial-matrix.cjs
# Likewise inplace-probe.cjs, retention-probe.cjs, overlay-probe.cjs, pinned-guidance.cjs.
```

From `backend`, with a fresh reviewer-local basetemp path:

```sh
env -u PYTHONPATH -u PYTHONHOME PYTHONDONTWRITEBYTECODE=1 \
  /home/ubuntu/workagent-adaptive-execution/.venv/bin/python -m pytest -q \
  -p no:cacheprovider ../.local/overnight-batch4/review/test_package.py \
  ../.local/overnight-batch4/review/test_helper_boundaries.py \
  --basetemp=../.local/overnight-batch4/review/pytest-new-run
```

The current boundary suite must exit nonzero: no expected-failure masking. Future corrected helper bytes should turn all seven safety assertions green; the report's exact-hash/count verifier deliberately describes the present reviewed state and is not an automatic approval generator.
