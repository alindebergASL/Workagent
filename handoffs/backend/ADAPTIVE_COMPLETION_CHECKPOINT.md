# Bounded adaptive completion — executed checkpoint

## Exact scope and candidates

- Runtime implementation: `0e8112795e09f83a8c393571bfc994c4d603b7c4`, PR #12.
- Harness recovery correction: `c423fec` (follow-up adds optional review-origin/SHA reporting).
- Integrated application: `65e84c673aedd6e4154471f4062349d7b3e014cf`, including Claude's
  `ea4e29d3b07d56f03b0fb73689749dee3d33065a`. Backend, contracts and runtime trees are
  byte-identical to `0e81127`; only the frontend and proof harness changed.
- The subsequent evidence/document commit does not change application bytes. Its
  full publication SHA and exact-head CI are recorded on PR #12/#9 rather than
  using an impossible self-referential commit hash here.

This closes the **bounded adaptive checkpoint**, not broad M3/general-agent
acceptance. #13 remains OPEN: neither flexible work creation nor sandboxed HTML
is delivered. #10/#11 remain sequenced work. No default merge or deployment.

## Actual product journey

The ordinary browser composer admitted a six-row synthetic invoice-reconciliation
request and a finite team-selection tool request without operation payloads or
user-written tests. Existing continuous model/local consumers progressed them on
real isolated PostgreSQL state. The original worker generated the initial tool
correctly and reconciled all six rows, finding three discrepancies.

The operator then introduced a plausible but broken numerator-first integer
implementation through the real tool editor. Continuous local execution returned
**0** for choosing 30 from 60. This was an observed wrong-but-executable result,
not a fabricated tool response. The person asked the model to check the saved
calculator; no repair algorithm, oracle output or supplied acceptance tests were
included. The model changed the code on its first selection. Thus this proves
adaptation to the saved-code/prior-result obstacle across turns, not several
failed autonomous retries inside that one repair turn.

The trusted finite verifier checked **all 1,891 integer pairs** in the requested
range and the default output, **118264581564861424**. Passing model-generated
examples was not the completion basis. The repair remains a **pending proposal**;
verification and download did not replace the human's saved work.

## Genuine interruption, recovery and failed run 06

During the unfinished repair run, the probe paused immediately after the final
provider response identity was durably retained but before its result/publication.
The browser harness asserted the run was still `running` with no assistant result,
then killed that worker with SIGKILL. A human note already saved in the exact base
revision remained intact. During downtime, a separate unsaved note survived phone
Work/Conversation switching and reload (captured screenshot). The same continuous
consumer restarted against the same grant, ledger and private state.

The original repair run became `ready`, with exactly one assistant result and one
pending repair proposal. **Run 06 then failed in the harness**, which requested
nonexistent `GET /proposals/{id}`. Reproduction returned HTTP 404. The canonical
read route is `GET /artifacts/{id}/proposals`; it returned the expected proposal.
No application repair or replacement model turn was needed.

Read-only closeout verified the existing result and downloaded bytes; it did not
recreate the interruption. The current saved revision is still the proposal base,
its human author and note are unchanged, and the proposed code differs from the
broken saved code. Download remains distinct from acceptance.

The unsaved downtime draft was verified before worker restart. Its preservation
**after** the original browser process closed is not claimed: run 06's error
handler closed that context. The final cold-open review shows the preserved
**saved** human note, not a recreated draft presented as original evidence.

## Effect identity and cumulative ledger

| Property | Before restart | Reconciled after restart |
| --- | ---: | ---: |
| Provider send reservations | 6 | 6 |
| Provider dispatches | 6 | 6 |
| Stored-response reads | 34 | 35 |
| Retained results | 5 | 6 |
| Retained local tool results | 3 | 3 |
| Reserved USD | 3.42992 | 3.42992 |
| Current-slice unknown-usage steps | 1 | 0 |

Exact dispatch/request and hashed response identities match. One stored response
was read, not regenerated. The completed response added reported usage; it did
not refund reservations. The immutable **$2.63840 historical carry** and historical
unknown liabilities remain within the **one cumulative $20** ceiling. These are
conservative reservations, not confirmed billing. This closeout made no new model
generations. The continuous worker was restarted only after terminal-state and
ledger reconciliation and remained running during final read-only browser checks;
its final audit showed no additional dispatches/results.

## Tests actually run

| Gate | Result / scope |
| --- | --- |
| Full backend on real isolated PostgreSQL | **752 passed**, one dependency deprecation warning, 1129.57 s; exact `0e81127` backend/test bytes unchanged by integration |
| Earlier full backend attempt | **747 passed / 3 failed**: stale status expectation, unsupported test poll interval, stale fixture CAS; failures preserved, fixes verified by 46 focused tests then the full rerun |
| Combined frontend checks | **145 passed**, typecheck, lint and format passed on `65e84c6` |
| Claude DOM regressions rerun by Hermes | **23 passed**; explicitly fixture transport, zero provider calls; includes generic-table editability and no automatic-check claims |
| Proposal-readback regression tests | **3 passed**: scoped endpoint/pagination, missing/cross-artifact refusal, repeated-cursor refusal |
| Generated contracts | Python/OpenAPI/TypeScript drift checks passed |
| Production bundle | Next webpack build passed; symlinked review checkout required webpack rather than Turbopack |
| Actual browser closeout | PASS on original `0e81127` and integrated `65e84c6`; desktop/390 px, pending proposal, exact download, saved note, unchanged revision; zero mutating requests and page errors |
| Independent downloaded-byte checks | All **1,891** WAT inputs vs Python `math.comb`, fresh Wasmtime store per case; all **6** CSV rows vs `Decimal` half-up, original fields/notes preserved, **3** discrepancies |

The backend suite includes wrong-but-executable output, rejected execution,
unsupported goals, stale inputs/proposals, uncertain provider sends, immutable
historical grants/carryforward and recovery cases. These deterministic failure
checks are not represented as additional live-model experiments.

Original independent backend review: direct Z.AI GLM 5.3 PASS on retained file
hashes; static analysis only, not test execution. Known limitation: finite team
reverification may hold publication locks for up to its 15-second subprocess
bound. The incremental integration/harness/evidence review is separately pinned
in PR #12 and its sanitized review artifact.

## Failed evidence is retained

1. Initial environment lacked a seeded workspace: no provider call.
2. Harness expected a completed-result label the UI does not display.
3. Harness locator matched visible reply and hidden details.
4. First fault fixture was actually correct; its replacement was independently
   tested to return 6 for a small valid case but 0 for the requested default.
5. Harness expected the artifact page after local execution navigated to conversation.
6. Nonexistent proposal endpoint after genuine successful restart, described above.

All original logs/receipts remain private under `.local/milestone-live`; none were
reset, replaced with successful output, or republished with provider IDs/secrets.
The public checkpoint records the failed-report hash. Read-only completion is a
separate report, not an overwrite of run 06.

## Review path and reproducible evidence

Integrated review: http://127.0.0.1:3140/conversations/8fed7a79-0751-4cb3-87e0-46d5806c309e/artifacts/c03d4cc6-aeb2-4589-aeeb-1154a82b1770

Original `0e81127` review remains at port 3130. Historical 3000/8000 and 3120/8120
review environments were not reset. Ports are host-local: remote reviewers may
use an SSH tunnel, e.g. `ssh -L 3140:127.0.0.1:3140 <existing-host-alias>`.

Public [evidence directory](evidence/adaptive-completion/) contains synthetic
source and delivered CSV, proposed WAT, desktop/phone/interruption captures,
SHA-256 manifest, scoped verification and sanitized continuity counts. No raw
provider receipts, response IDs, credentials or environment files are included.

- `node --test scripts/adaptive_proposal_readback.test.mjs`
- `PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q`
  (requires a disposable database's owner/runtime environment; never reset a review DB)
- `pnpm --dir web check`; `node web/scripts/products-review-regressions.mjs`
- `npm --prefix contracts run check`
- `scripts/finish_adaptive_milestone.mjs` performs **only read-only** completion of
  retained run-06 state. Its original private manifest is intentionally not published.

## Separate verdicts

- **Engineering: PASS for this bounded checkpoint.** Exact recovery and independently
  verified proposal, no duplicate provider dispatch or committed result; test scopes above.
- **Usefulness: demonstrated for these synthetic bounded tasks.** Inspectable CSV
  discrepancies and a repaired reusable tool are available to download. This is not
  Andrew's acceptance of general work usefulness; finite phrase recognition remains narrow.
- **Experience: browser checks PASS in the stated scope; Andrew's acceptance NOT TESTED.**
  Saved/proposed results and approval controls are distinct, notes remain available,
  details stay folded. The closed-browser unsaved-draft limitation is explicit above.

Next owner work is [the #13 contract/slice](FLEXIBLE_WORK_OWNER_CONTRACT.md), not a
new framework or another round of this completed finite proof.
