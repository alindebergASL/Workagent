# Frontend status (Claude Code stream)

Updated: 2026-10-02 (UTC). Owner: Claude Code frontend stream. Hermes owns the backend, the domain adapter, integration and the combined milestone report.

## Where the work is

- Branch: `claude/workagent-frontend-kyg51x`. PR #2 was integrated into `hermes/agent-first-integration` by fast-forward at exact independently reviewed head `e0da95cc05a103af52cf5a31b328a2ee93486640` (application code `d354940`). The later bounded UI-1 code `bed8fe3`, published at `a1c9df0` in PR #4, is integrated intact in tested merge `80eb2c0`; its focused evidence is separate from the original review.
- The agent-first patch was applied once on each branch in a coordination race: `544531b` here and `f0929b5` on Hermes's branch, with the same patch sha256. `fef8cda` merges Hermes's `f88f63c` into this branch with a merge commit. Nothing was rebased or applied a third time.
- `56d013c` is the PR #2 review refinements. `37169bb` makes the artifact show "Ready for review" until approval, so all surfaces agree.
- `e92c27d` merges Hermes's `a779715`. In a second coordination race, Hermes ported my older `1e10dc5` as `693a54f` while I worked on `56d013c` and `37169bb`. UI files keep this branch's newer version. From `693a54f`, this merge carries over: the status-line wording (preparation is not approval; an approved revision does not complete tasks or responsibility criteria), the task-state readbacks in `real-journey.mjs`, and a pending-decision surface check in `agent-first-journey.mjs`. His non-UI work is taken unchanged: launcher key stripping, `model_responsibility_proof.py`, docs and evidence.
- `7e3a519` follows the 08:44 review checkpoint. The status line is now short ("Revision approved. No external action was taken."), with the explanation in one disclosure. Rows keep separate labels: "Approved revision", "Stopped" and "Ready for review". Home groups them as "Your work", not "Approved revisions / stopped".
- Historical route and base, retained so neither owner ports the same delta again: this branch descends from `a779715`. `git diff a779715 e0da95c -- web` is exactly the frontend delta (the visual refinements plus this round's copy). The shared branch has now been fast-forwarded to that reviewed head.
- `d2f0684` and `d354940` follow the 09:40 checkpoint. A pending proposal is labelled "Decision needed" everywhere, including the artifact's `needs_review` state, which was "Revision needs review". The Home lede orients rather than repeating the card. Hermes's base was still `a779715`, so there was no race.
- Frontend self-test candidate: `d354940`; full real demo and 12 mock cases passed. Subsequent independent Hermes verification at clean `e0da95c` also passed the untouched real demo, both restart checks, nine faults, 25 unit tests, type/lint/format, 12 mock cases and the focused approval/focus/draft probes. See the [published review](../backend/review-pr2-e0da95c/REPORT.md).

## Owned paths

- `web/**` except the Hermes-owned files below.
- `handoffs/frontend/**`.
- `.github/workflows/frontend.yml`.

## Hermes-owned files

- **Taken unchanged from `f88f63c`:** `real-api.ts`, `assignment-summary.ts`, `hooks.ts`, `contract/types.ts`, `api.ts`, `mock-api.ts`, `command-cache.ts`, the `/api/domain` proxy, the backend and `scripts/workagent.py`.
- **Ported into the new UI:** Hermes's work-state semantics (prepared, approved, progress from receipts) and the frozen create command (inputs lock after a lost response; retry replays the exact command and Space).
- **`web/scripts/agent-first-journey.mjs`:** labels and DOM mapped to the new UI. Surface checks now find each assignment by id on Home, in its space and on the assignment page. An optional `PLAYWRIGHT_CHROMIUM_PATH` was added. No assertion was removed.
- **`web/scripts/real-journey.mjs` and `fault-regressions.mjs`:** adapted as in the previous round. Completed-Home checks now require the exact assignment to read "Approved revision".

## Backend requests

1. ~~Pending decisions on assignment summaries~~: resolved by Hermes's `assignmentSummary`. Home's extra reads are removed.
2. ~~Real last-changed time~~: resolved (`updated_at` from the latest revision).
3. **Execution mode per run.** Still open. The UI labels all agent work as fixture computation per build. Once a live runtime exists, artifacts and proposals need each run's `profile` and provider, so items can be labeled individually.
4. **Shared spaces.** Still open. Spaces lists exactly what `GET /workspaces` authorizes. Creation, membership and invitations need domain operations first.

## Integration checkpoint and separate follow-ups

Independent review and the exact-head canonical rerun are complete. Shared integration and the existing non-default `hermes/s0-s1-build` head were fast-forwarded through `e0da95c` to publication `5ae4cbb`. The PR #3 checkpoint binds that publication; no default-branch merge or deployment is authorized.

The [review publication](../backend/review-pr2-e0da95c/README.md#separate-follow-ups-not-part-of-this-publication) retains the original follow-up list. [Current follow-up status](../backend/BASELINE_FOLLOWUPS.md) records the maintained read-only model-proof probe and reconciled RuntimePort guidance. Claude delivered UI-1 separately under the [explicit current-base coordination](https://github.com/alindebergASL/Workagent/pull/2#issuecomment-5953182433); no competing frontend application edits were made. No provider calls are authorized by this update.

## "Keep for later" follow-up (frontend)

Implemented separately as `bed8fe3` with evidence at `a1c9df0` on `claude/workagent-frontend-kyg51x`, built on integration `5ae4cbb`. The explicit collapse closes the revision form and keeps the instruction (and any unconfirmed send's frozen command); "Resume your request" restores it. Claude reports focused desktop/mobile/narrow browser checks and the full real demo passing at `bed8fe3` with a clean tree. Owner evidence: [`evidence/keep-for-later-bed8fe3/`](evidence/keep-for-later-bed8fe3/README.md). Hermes integrated the intact frontend tree by ancestry-preserving merge `80eb2c0` and independently passed the three focused mock cases, a real desktop/mobile collapse-resume and committed-202-loss/same-command retry probe, and current-UI model-draft reopening. [Integrator evidence](../backend/BASELINE_FOLLOWUPS.md) keeps these exact-merge results distinct from the original accepted `e0da95c` review.

## Intake next-action outcome UI (frontend)

`4c36ede` on `claude/workagent-frontend-kyg51x`, built on contract checkpoint `1c04566` (`hermes/intake-next-action`). Home, Spaces and the work surface now read `Assignment.responsibility`, using the run named by `latest_run_id`. They show prepared, decision needed (with the exact question), approved and read back, waiting with a named blocker, provider outcome unknown (no retry; read-only "Check again") and not verified. Provenance comes from `execution.evidence_origin` only. Evidence: [`evidence/intake-4c36ede/`](evidence/intake-4c36ede/README.md). The canonical demo and the intake evidence passed at `4c36ede` with a clean tree; no provider calls. Open backend observation: the synthetic attempt's run projects `evidence_origin=unverified`.

## IR-L2 and footer provenance (frontend)

`af41463` (plus the test-only `f583ecb`) on `claude/workagent-frontend-kyg51x`, built on `71bdb85`. The assignment recommendation is read from the first `managed.current.<attempt>` group of the current saved document, with fixture blocks as the fallback. The global footer no longer claims fixture-only work; each item states its own `evidence_origin`. Checked against the backend's no-inference Responses journey records in the real UI at 1440/390/320. Evidence: [`evidence/ir-l2-af41463/`](evidence/ir-l2-af41463/README.md).
