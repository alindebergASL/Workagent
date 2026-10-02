# Frontend status (Claude Code stream)

Updated: 2026-10-02 (UTC). Owner: Claude Code frontend stream. Hermes owns the backend, the domain adapter, integration and the combined milestone report.

## Where the work is

- Branch: `claude/workagent-frontend-kyg51x`. PR #2 was integrated into `hermes/agent-first-integration` by fast-forward at exact independently reviewed head `e0da95cc05a103af52cf5a31b328a2ee93486640`. Application code is `d354940`; this subsequent publication is documentation/evidence only.
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

Independent review and the exact-head canonical rerun are complete. Shared integration was fast-forwarded to `e0da95c`; publish this documentation/evidence-only child and fast-forward the existing non-default `hermes/s0-s1-build` head to the same integrated history. The PR #3 checkpoint binds the publication SHA; no default-branch merge or deployment is authorized.

Keep the nonblocking “Keep for later” frontend fix, the old model-proof badge assertion and the RuntimePort documentation reconciliation separate. Their scope and ownership are tracked in the [review publication](../backend/review-pr2-e0da95c/README.md#separate-follow-ups-not-part-of-this-publication). This update neither implements those fixes nor authorizes provider calls.
