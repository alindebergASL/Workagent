# Evidence continuity fix and day/week planning evaluation

## Verdict

The retained-evidence continuity fix is installed and live-proven. The new day-plan → saved tasks → human correction → weekly outlook → unattended follow-up exercise completed with correct planning and preserved saved human state, but the overall product verdict is **PARTIAL**, not a clean pass: an inferior intermediate proposal remains selectable and the expanded desktop proposal review overflows horizontally.

## Installed implementation and engineering evidence

Private runtime: `4b55cc5afa8c4e076f388ec85d5a02f5f38b0da2`, candidate `/home/ubuntu/workagent-candidates/evidence-continuity-20261022`. The development integration branch contains the same backend/web bytes at `9324205d09ea6b8de3b86ffe9e92d1d6ed1ae328`; no default-branch merge or production deployment.

New runs retain a bounded, versioned evidence view for authorized same-conversation human attachments and current-base pending proposals. Scheduled proposal access stays within dependency artifacts; source evidence is filtered to explicit source-version dependencies. Reads do not accept proposals or enlarge mutation authority. Existing human-edit, ACL, generation, frozen-context, budget and duplicate-effect protections remain. Older run configurations retain their original shape. See [implementation notes](EVIDENCE_CONTINUITY.md).

Parent verification: two genuine original RED cases, two passing isolation/state controls; then 56/56 final selected tests passed, including context-scope, recording refresh and context-efficiency regressions. Independent review initially held on a latent source-scope defect and unreachable ACL-test fixtures. The parent reproduced the scope defect directly, corrected it and the fixtures, and obtained a focused follow-up PASS. No full-suite claim. No migration or frontend implementation change.

Installation used a backup, exact source manifest and retained-row/budget readback. The successor grant was activated without rebinding old attempts or changing old receipts. The unchanged built frontend was carried forward.

## Supplier regression: live PASS

A new scheduled recheck in the original Cedar conversation received **zero new attachments**. Actual retained read receipts prove it read both original packets, the complete B-10 amendment and the complete original pending proposal. It produced a separate correct R2 decision note: Birch $13,920, $580 headroom; Alder late; Cypress $200 over budget. The prior human revision, pending proposal, old runs and old tool receipts stayed unchanged. The new responsibility ended waiting for a person, with no further timed check-in.

Evidence: `/home/ubuntu/workagent-evidence-continuity-evidence/supplier-live-verified.json` and `verify_supplier.py`. The original failed exercise remains retained as failure evidence. Execution completed after the requested due time; exact two-minute execution is not claimed.

## New synthetic task

Inputs were a weekly calendar and nine tasks, followed by a later calendar/status update. No expected answer was supplied to WorkAgent. The synthetic planning clock was Monday 2 November 2026 at 09:00 UTC, later changed to 10:30; real elapsed execution did not imply task completion.

WorkAgent created an editable structured task table with nine stable rows and completion controls. The evaluator marked only T1 complete through the UI, added a human correction, verified persistence after reload, and supplied a later source changing Monday/Wednesday availability and delaying T7's figures. It then requested a weekly outlook and one unattended follow-up and left the browser.

### Verified useful results

- Only T1 stays complete; T2–T9 stay not done. The actual saved human revision is unchanged after model work.
- T3 moves from the new Monday appointment conflict to Tuesday 10:00–11:30.
- T5 receives 240 minutes in blocks of at least 60 minutes, followed by T6's 120 minutes; their proposed deadlines are met.
- T4 is the existing Tuesday review meeting, counted once rather than duplicated.
- Lunch, fixed meetings, the new appointment and Wednesday afternoon unavailability are respected. A parser checked the actual final row allocations for overlaps, effort totals, ordering and deadlines; not merely keyword presence.
- T7 is explicitly blocked: unconfirmed Friday 11:30 figures leave only 30 minutes for 90 minutes of work before the unchanged noon deadline. The agent surfaces the 60-minute shortfall and asks for a decision about earlier figures, reduced scope or an agreed later deadline. It does not assume an extension or receipt.
- T8 receives 180 optional minutes and carries 720 minutes forward; required work and buffers have priority.
- The final scheduled run read all three original/update attachments completely and both earlier pending proposals. No source resupply was needed.
- The final proposal preserves all saved human notes and task edits. It remains unaccepted. The responsibility ends `waiting_person`, with no further schedule and no external actions.

### Remaining failures, not hidden by the final good result

1. **Intermediate proposal retention/preservation.** Three proposals remain pending. The first, `ce069582-f2c7-4805-ad6c-4dab049ab547`, drops most historical/human notes and includes a malformed “don’t copy?” fragment while claiming preservation. The next proposal and final scheduled proposal preserve those notes, but the first is still exposed with an apply control. No proposal was accepted and no saved human content was lost. This is a real review/acceptance risk, not a corrected clean pass.
2. **Desktop review overflow.** Expanding the full final proposed table at a 1440px viewport produces a 1689px document width. At 390px phone width there is no page-level overflow and tasks render as cards, but the review remains dense. Screenshots and DOM measurements are retained. A compact preview alone would have missed this defect.
3. **Latency and verbosity.** The weekly turn took 299.26 seconds from the recorded request to publication. Final results are useful but the workflow produces multiple long proposals instead of one clear current candidate plus a concise check-in. Exact requested check-in timing is not promised by this evidence.

The backend retrieval fix is verified independently of these new quality/UI findings. Frontend two-file upload cap remains unchanged; all planner inputs fit the current cap. Generated titles were coherent in this example, not a general stale-title fix.

## Evidence, models and budget

Product model: `gpt-6.1-sol`; implementation/evaluation/independent review: GPT-6 Astra via Codex. Engineering runs are separate from product-evaluation accounting.

The day/week exercise used 17 generation requests and added $3.51764 in conservative reservations, not billing. After both live evaluations, shared reservations are $59.34388. Aggregate allocation is $84.44992 within the same cumulative $100 ceiling; three historical unknown generations remain and no new unresolved generation remains from these tests. Re-read the live ledger before more generation.

Evidence: `/home/ubuntu/workagent-day-week-evidence/verified-results.json`, `verify_day_week.py`, `scoped-evidence.json`, `latest.json`, `browser-verification.json`, `weekly-review-{desktop,phone}.png`, source files, expected-results oracle and UI request/edit readbacks.

Human-readable exports (unaccepted synthetic proposals):
- `/home/ubuntu/workagent-day-week-evidence/weekly-outlook-proposed.csv`
- `/home/ubuntu/workagent-day-week-evidence/weekly-checkin.txt`

Conversation `066f6476-935f-4aac-b573-f8f0c930190a`; task artifact `78f29577-4b39-4c7e-85c6-7eebf224a828`; human revision `d46872fe-b339-44e0-b01d-9fe62727bf50`; final proposal `40ebbd67-9404-4083-99ff-d3aa9e74bbe1`; scheduled run `a4068a92-4aa4-4eb0-862e-0af26ab441db`.

## Handoff

Requested fix and subsequent evaluation are complete; the wider product mission is not. No engineering successor is active at this checkpoint. The product responsibilities are waiting for a human decision. Next concrete work: prevent presenting note-destructive intermediate candidates as interchangeable apply choices, and have the web owner fix expanded-table desktop containment. Preserve the failed evidence and pending-vs-accepted distinction; do not auto-accept/dismiss proposals merely to clean up the evaluation.
