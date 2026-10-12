# General-work continuation implementation plan

> **For Hermes:** Use subagent-driven-development to implement this slice with focused spec review, then code/evidence review. Andrew authorized planning **and execution**; do not add a routine approval checkpoint.

**Goal:** Improve and demonstrate ordinary general-agent work and continuation without turning a fixture into the product specification.

**Architecture:** Keep the existing conversation/worker/artifact/proposal/broker authority. Make a small generic guidance correction, then let the model choose an appropriate work product for a fresh goal. Exercise natural steering, preserved human work and reopenability through the actual application; independently inspect usefulness, not just response shapes.

**Tech stack:** Existing Python/PostgreSQL domain and adaptive Responses worker; existing Next.js shell/opaque generated-view sandbox; Playwright for production-UI checks. No new framework, dependency, migration, artifact type or route.

## Direction, baseline and scope

- User correction: Workagent is a general agent, not a venue pricing tool. The venue example diagnosed a weakness; it must not dictate product controls or output sequence.
- Appropriate feedback from [trusted-tester review](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6118391394): preserve meaningful flexibility; lead with useful result/next decision; keep detailed history optional while material warnings and human notes stay discoverable; inspect current shell rather than relying on historical screenshots; prove breadth through already-supported work.
- Baseline application `9a009c6467369716a5e1d0c0d6f3b83337a2da8a`, PR #14; prior exact suite 787 passed. Existing untracked `scripts/verify_criteria_view.mjs` is preserved prior work and must not be swept into this commit.
- Hermes owns backend/runtime/integration. Claude remains sole `web/` owner. Local Claude CLI is unauthenticated; a GitHub handoff is coordination, not proof that a worker started. Never silently substitute a competing frontend writer.
- No venue regeneration, prescribed table-to-view sequence, hidden expected answer in generation prompts, UI budget enum, benchmark-only production condition, or output-format mandate for the primary goal.
- No claim that saved artifacts establish durable responsibility ownership. No memory/learning #10, portability #11, connectors, proactive scheduler, migrations, release or default-branch merge in this slice.
- Keep #13 open for Andrew's acceptance.

## Acceptance and stopping rule

1. Generic guidance allows the agent to choose a proportionate supported work shape and preserve useful editing/controls when explanations change. Example values are not hardcoded allowable choices unless the task actually imposes a closed set.
2. Result-first guidance keeps decisions, material uncertainty and human notes accessible, but avoids repeating full criteria/technical diagnostics around each result. A concise adjacent saved/current label is required; full historical text may be on demand.
3. A fresh natural-language goal produces useful work without being told an operation name, output schema, control list, code, artifact sequence or exact solution. The follow-up changes a substantive constraint using saved context. A human edit remains intact. Leaving/reopening exposes the saved result and any pending decision honestly.
4. An already-supported different work shape is exercised as a breadth regression. Replaying retained work is explicitly replay, not a second freshly generated success. Do not rebuild another feature to manufacture breadth.
5. Current desktop/phone UI is inspected for result hierarchy, useful editing, steering and reopenability. If a blocking shell defect is observed, return it to Claude with exact reproduction; never call that fixed unless integrated and exercised. Nonblocking shell findings remain explicit rather than forcing an unrelated redesign.
6. Independent spec/usefulness review and subsequent code/evidence review distinguish what was tested from inference. A failed live attempt remains a failure; do not repeatedly tune the chosen goal until a passing demonstration emerges. At most one targeted correction for an observed generic defect in this slice, then report the actual outcome/remaining blocker.

## Task 1 — small generic policy correction (one backend writer)

**Files:** modify `backend/workagent/flexible_policy.py`; update `backend/tests/test_flexible_policy.py`.

- Write failing pure tests for proportionate work-shape selection, preservation of meaningful controls, no sample-value enumeration, result-first presentation, concise adjacent saved/current semantics, and optional detailed history without hiding material uncertainty/notes.
- Remove the implication that every visible assessment must repeat its full original criteria. Preserve explicit-known/unknown criteria, unchanged original task, exact bindings, readonly broker, no-network sandbox and unverified-draft/proposal semantics.
- Keep guidance generic: no venue, repair-session, rainwater or other fixture vocabulary/amounts. Do not edit the runtime execution loop or its authorization/verification gates merely to improve a demonstration.
- Run `env -u PYTHONPATH -u PYTHONHOME backend/.venv/bin/python -m pytest -q backend/tests/test_flexible_policy.py` from the repo (or equivalent from `backend/`). Pure tests prove guidance presence, **not behavior**. Run the existing related offline suite, inspect diff and commit only intended paths after parent verification.

## Task 2 — bounded, unscripted-output real work

**Files:** new ignored `.local/general-continuation-*` operator/evidence files; reuse canonical admission, worker, ledger and save/proposal APIs. No new production helper unless a generic defect is demonstrated.

- Fresh read-only ledger audit completed at planning: $4.88104 reserved / the existing one $20 project cap, including $3.42992 carry. Local records: 11 dispatches, 12 counts, 106 reads. The old first-attempt final count remains unknown; zero unknown generation usage is not all operations reconciled.
- Preserve every original artifact/history/receipt and all carry records. New policy needs a newly pinned adaptive grant and fresh conversation; never repin a historical grant/conversation. Use supported exact-target revoke/readback for the currently active predecessor, preserving unknown attempts and aggregate limits.
- Same authorized synthetic-only official route; no new paid route/private data. A small bounded grant permits initial goal and an ordinary follow-up through the continuous worker. Existing project cap and cumulative counters remain authoritative. Do not ask Andrew for routine budget reapproval.
- Supply the goal below verbatim, with no attachment containing output structure or answers. Capture immutable prompt/selection/final receipts and exact artifact identity. Inspect what it actually chose before deciding how to test/edit it.

**Primary natural request:**

> Help me organize a neighborhood repair session on Saturday from 10:00 to 12:00. Sam and Jules can repair bikes; Lee can handle sign-in and keep waiting visitors informed. All three are initially available for the whole session. We need a 15-minute safety briefing with everyone at the start, two 30-minute repair slots, and 15 minutes to pack up before noon. There are six booked visitors, but I do not know how many will need long repairs. Give me something useful to run the session from and make clear what I still need to decide. Do not contact anyone or make bookings.

- Human edit through the trusted editing path, appropriate to the chosen artifact: `Human note: keep the entrance clear for wheelchair access; do not remove this reminder.` Record exact saved revision before follow-up. Do not bypass editability constraints to plant the test.
- Ordinary follow-up, without prescribing the answer or artifact operation:

> Sam now has to leave at 11:00. Adjust the work so the safety briefing and packing-up time are protected. Keep my accessibility reminder. What changes, and what do I need to decide?

- If a revision is proposed, show its actual diff and preserve the current saved version until explicit acceptance. Do not claim the whole user journey is complete if the model only replies with a plan or cannot update its chosen product. A testing acceptance, if required on an isolated synthetic fixture, must be labeled as operator test action, not Andrew's acceptance.
- Verify temporal feasibility, availability, unknown workload and decision clarity independently from the model's claims. Assertions may use fixture facts in the test harness, never inject expected assignments/answers into the generation prompt.

## Task 3 — actual interaction and breadth, not another narrow demo

**Files:** new ignored browser scripts/results; any reusable verifier can be published separately with correct source/evidence labels. Inspect `web/src/components/ConversationWorkspace.tsx`, `FlexibleWork.tsx` and `TypedWork.tsx` only as applicable; Claude owns modifications.

- Exercise current exact-candidate production UI at desktop and phone: inspect result, edit where supported, steer naturally, leave via Home, reopen, see preserved note and pending/saved change distinction.
- Check substantive controls with a value not supplied as a sample when the chosen shape exposes controls; do not require a generated view where a document/table is more appropriate.
- Reopen and use the retained calculator as a clearly labeled breadth replay with a different supported input. Verify its actual numerical result independently and inspect ordinary wording/editing. This is not a new calculator generation or generalized autonomy proof.
- Send Claude current, reproducible shell findings and request only shared-shell corrections relevant to this journey. Historical screenshots alone are insufficient. Preserve existing review services; use isolated review ports/worktree when needed.

## Task 4 — close the bounded slice honestly

**Files:** a new `handoffs/backend/GENERAL_CONTINUATION_RESULTS.md` and allowlisted evidence on the existing evidence branch; update PR #14/coordination PR #9 with exact identity.

- Run affected backend tests, an exact-candidate fresh-DB full suite once after final runtime edits, production UI/build/contract gates as affected, and exact-head CI. Do not rerun unchanged broad gates for docs-only edits while relabeling the application SHA.
- Independent spec/usefulness review first: did the agent select and adapt useful work, or did the harness secretly supply the product? Then code/evidence review: authority, saved edits, truthful incomplete/proposal state, cumulative liabilities, and source/replay distinction. Fix only confirmed in-scope blockers and reverify their exact changes.
- Publish actual outcome, not an unconditional promised PASS. Include screenshots of useful work, concise ordinary-user walkthrough, what changed, what needs a decision, exact application/artifact identities, model/route and cumulative ledger, failed attempts, replay labels and remaining shell/ownership limits.
- Read back GitHub evidence/metadata/comments. Keep #13 open, no merge/deployment. Stop after this slice rather than launching another framework or polishing the fixture.
