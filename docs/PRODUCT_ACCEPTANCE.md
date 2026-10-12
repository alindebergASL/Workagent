# Product acceptance

## Flexible-work candidate (#13) — supersedes the next-slice status below

The current integration branch is `hermes/flexible-work-13`. It combines the
additive backend/contracts (`f2b747a`, bridge follow-up `fffb69b`), retained
live-model proof (`a48c6d5`) and Claude’s structured renderer/custom-view adapter
(`878b6b867c3173e428d3744d8c53da92506b9152`). Historical checkpoint sections below
retain their original evidence scope; they no longer describe #13 as unimplemented.

Delivered candidate capabilities: `structured-table/v1` with stable typed fields,
units and edit rules; `custom-view/v1` with durable HTML/CSS/JS, readable fallback,
exact same-conversation bindings and named read-only actions. Historical invoice
`table` bodies are not reinterpreted. The existing save/propose/accept/history
lifecycle remains canonical. Generated source runs only in the opaque no-network
sandbox; the trusted shell owns unverified status and permission/action failures.
Shape-only drafts cannot satisfy human CSV/Wasm acceptance checks: incompatible
selections are rejected and follow the existing continuation/step-limit path.
No SQL acceptance gate or historical migration is weakened.

[Contract](../handoffs/backend/FLEXIBLE_VIEW_CONTRACT.md),
[live evidence and limits](../handoffs/backend/FLEXIBLE_LIVE_PROOF.md), and
[frontend handoff](../handoffs/frontend/FLEXIBLE_WORK_FRONTEND.md) distinguish live
model output, independent bounded checks and controlled engineering fixtures.
Actual rainwater and venue goals, human-price-obstacle adaptation, restart and
scoped-view proof are retained. They are not universal verification or Andrew’s
usefulness/experience acceptance. Static derived assessments can diverge from
changed local filter criteria; those claims remain draft data.

Exact combined gates/review are required before #13 can close. Until their
published verdict, this is an integrated candidate, not accepted delivery.
Backend full-suite evidence at `a48c6d5` is 768 passed; never relabel it as the
post-fix/combined gate. Run `scripts/verify_flexible_integration.py` on a new env
for the real controlled-consumer production-UI lifecycle and process restart.
One cumulative $20 budget remains: latest retained reserve $4.48528 includes
$3.42992 historical carry; reservations are not billing. No additional provider
calls are needed to integrate/replay these saved outputs. Preserve saved review
state. Default merge/deployment remain unauthorized; #10/#11 and broader M4/M5
remain sequenced, undelivered work.

## Current bounded checkpoint and next boundary — 2026-10-08

The bounded adaptive checkpoint is verified at runtime implementation `0e81127`,
with Claude's `ea4e29d` generic-table correction integrated at `65e84c6`.
[Executed evidence and limitations](../handoffs/backend/ADAPTIVE_COMPLETION_CHECKPOINT.md)
separate engineering, usefulness and experience. Continuous workers recovered the
original interrupted run, preserving its response identities, saved human note,
pending approval and cumulative reservations. Run 06 failed in the evidence
harness after recovery, not in application publication; its failed evidence is retained.

[Issue #13](https://github.com/alindebergASL/Workagent/issues/13) remains **OPEN**.
This checkpoint is not flexible work creation or sandboxed HTML delivery.
The next slice is a general structured surface plus an isolated generated
HTML/CSS/scoped-JS view on the same durable work/revision/proposal/action substrate.
The earlier blanket "never generated HTML or script" restriction is superseded;
generated views still receive no ambient credentials, approval authority or
unrestricted API/network access. [Owner contract and next slice](../handoffs/backend/FLEXIBLE_WORK_OWNER_CONTRACT.md)
records the agreed direction, responsibilities, and still-undelivered wire contract.
Memory/learning #10 and portability #11 remain sequenced work, not prerequisites.


Three independent verdicts apply to integrated milestones: engineering,
usefulness and experience. Use PASS / FAIL / NOT TESTED, evidence and exact
candidate SHA. Evidence closes only the property it actually tested.

| Verdict | Evidence required | Cannot substitute |
| --- | --- | --- |
| Engineering | Saved outputs, edits, permissions, replay/recovery and failures through actual domain/worker; observed effect where relevant | Model prose or scripted screenshot |
| Usefulness | Andrew can use the result, understand the next step and see where his judgment matters | Passing checks or plausible text |
| Experience | Actual responsive journey against prototype: hierarchy, copy, conversation/work, editing and continuity | Polished mockup or backend correctness |

## Current candidate and evidence precedence

PR #12 (`hermes/adaptive-product-integration`) supersedes PR #9's old application
checkpoint. Runtime `0e81127` and integration `65e84c6` preserve the reviewed
`3568fbc` baseline and Claude's `ea4e29d` generic-table correction. Historical
evidence remains scoped to exact bytes; the linked checkpoint distinguishes live
execution, read-only closeout, fixture tests and untested human acceptance.

Completed bounded M3 exit (not full general-agency acceptance): ordinary request → useful work → meaningful observed obstacle →
changed action → independently verified bounded result → interruption before
completion → accurate continuation preserving human edits and no duplicate effects.
Both model and local consumers run continuously. A synthetic transport proves
mechanics only; a live model must independently select the repair. No supplied
repair instructions or evaluator answers. Verification is not proposal acceptance.
Keep wrong-but-executable, rejected-operation, stale-input and uncertain-provider
regressions. Unknown request semantics stay partial/needs-validation.

## Required behavior and current evidence

Source direction: [product/experience](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6018834683)
and [goal-directed agency/coordination](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6019150121).
Milestone owners and ordering are in `BUILD_PLAN.md`. All following capabilities
are required; a planned row is not implemented merely because this table exists.

| Milestone | Observable acceptance | Implementation / observed proof at current checkpoint |
| --- | --- | --- |
| M1: Model connection | Four approved natural-language turns select real CSV work, use exact human-edited saved context, generate a runnable calculator without supplied WAT, then change code and form for shipping; preserve notes/history and unaccepted proposals | Implemented at1b81a1d; four authorized live turns observed with exact saved bases, generated WAT and retained pending proposals. Andrew’s usefulness acceptance NOT TESTED |
| M2: Seamless integrated journey | Ask → useful editable work → revise → leave → find current result/pending decision in Home or appropriate Space → reopen and continue, desktop and phone; drafts/edits survive; technical details remain closed | Historical journeys at1b81a1d are retained. Current candidate preserves Claude's rich-text/proposed-input corrections and adds generic-table handling; actual bounded browser closeout passed. Full experience acceptance remains incomplete/NOT TESTED by Andrew; historical GENERAL_MODEL_REVIEW failures are not all current defects |
| M3: Goal formation and adaptive execution | Broad goal yields sensible success criteria/subgoals; more than one plausible approach; an actual obstacle or changed condition changes the next useful action without prescribed steps; verify the result and stop within bounds | Bounded live obstacle/change/finite-verification/unfinished-run recovery proved at0e81127; broader goal formation, flexible creation and HTML remain undelivered (#13). The repair was selected from observed saved work, not supplied by the operator |
| M4: Actual specialist coordination | Suitable work delegates through runtime with scoped context/success criteria/dependencies; coordinator reconciles and checks the combined result; inject one failed, stale or conflicting child and handle honestly | Required, planned; NOT TESTED. Specialist labels, subprocess count or an agent development team do not prove product delegation |
| M5: Persistent ownership | Relevant event/restart resumes the same responsibility with current decisions, corrections and edits, dependency-aware next action/check-in and no duplicate effects; pause/resume/cancel/takeover behave truthfully | Required, planned; NOT TESTED. Saved conversations and the unsupported paused handover are not proof |

M3–M5 must test parent/child authority, shared budget conservation, cancellation,
revocation and material edits. Delegation cannot multiply budgets or widen data
scope. Completion follows trusted result inspection, not child/model prose.
For each milestone publish exact candidate, user outcome, independent behavior,
default experience, breadth preserved, limitations and separate three verdicts.
Label deterministic transport, live model observation and human review explicitly.

No hard-coded prompt-to-answer routing, operator payload repair, hidden replacement
calls or manual acceptance may masquerade as independent agent work. Expected
answers remain outside model context. A useful necessary clarification or honest
failure is evidence to report, not permission to consume replacement calls.

## First breadth proof

B1–B3 have controlled engineering evidence at f68efe5; that evidence is retained,
not promoted to live intelligence. Affected M1/M2 paths now have actual integrated-web evidence at1b81a1d
through the same domain/worker; this does not close broader B4–B7 gates. Synthetic
context and live calls are bounded by `GENERAL_MODEL_AUTHORIZATION.md`.

| Case | Work shape | Observable acceptance |
| --- | --- | --- |
| B1: Work together | Source-free conversation; clarify ambiguity; later delegate | No compulsory source/Space/task form; intent and steering retained |
| B2: Handle operations | Reconcile a supplied CSV, find discrepancy, produce corrected table/file | Reproducible calculation, inspectable data, surviving edits; no invented values |
| B3: Make something | Produce a small runnable local tool; user changes a requirement | Artifact runs in approved isolation; observed output verifies goal; revision preserves user changes |

Operations and making expose the research-only contract immediately. Another
generic brief does not replace B2/B3. Unsupported capabilities must say so.
Controlled execution needs no live provider calls and does not qualify model
capability. Newly enabled execution must pass broker/sandbox checks before
the model can use it.

## Continuity and breadth gates

| Case | Required evidence |
| --- | --- |
| B4: Own ongoing work | Event changes same responsibility; restart/resume with current context and useful next check-in; no duplicate effect |
| B5: Coordinate | Dependency-aware team/meeting preparation and one precise decision; preparation, approval and performance distinct |
| B6: Scope and memory | Private context stays private in shared work; corrections, revocation and forgetting affect future runs without improperly erasing required audit |
| B7: Steering and failure | Pause/cancel/takeover; edit during generation; lost acknowledgement/duplicate delivery preserve truth and work |

B4–B7 need progressively implemented capabilities. Record NOT TESTED until
observed. Calendar/messages need no real effects to prove preparation and
permission denial; external performance requires explicit authority. Do not
claim a complete general agent from B1–B3.

## UX review

Review Home, conversation, responsibility inspection, two different work surfaces,
edit/revise/decision, waiting/error and reopen. Compare actual app/prototype side
by side at desktop/phone widths. Check keyboard focus, pane switching, drafts,
density and empty states. Primary view explains work; details expose evidence
and machinery. Every card has a purpose/action; status copy stays consistent.
No fake dashboard data, lost edits or vague approval buttons.

Andrew's next review sees a real conversational entry, meaningful owned work,
operational/maker results and a clean shell. Do not ask him to approve release
before those results and independent verdicts are concrete.

## Live gate and release

Historical intake grants and initial-checkpoint counters remain closed/unchanged.
The standing clarification in `GENERAL_MODEL_AUTHORIZATION.md` authorizes routine
development, publication, compatible non-default integration and reasonable bounded
synthetic tests on the recorded route within ONE cumulative $20, no calendar
expiry. The initial four turns/eight generations are not a project-wide stop.
Choose bounded run profiles; retain historical usage, reservations and unknown
liabilities, reserve before I/O and never silently refund/reset or resend uncertain
attempts. Provider billing is not the same as conservative reservations.

No new paid route, broader private-context access, external business effects or
automatic human approval is implied. Memory/learning #10 and portability #11 follow
this adaptive slice rather than gate it with their entire backlogs.

Default merge/deployment require Andrew's explicit approval. Development
handoffs/local no-inference verification continue without inventing new gates.
