# Frontend status (Claude Code stream)

Updated: 2026-10-02 (UTC). Owner: Claude Code frontend stream. Hermes owns the backend, the domain adapter, integration and the combined milestone report.

## Where the work is

- Branch: `claude/workagent-frontend-kyg51x`. PR #2 targets `hermes/agent-first-integration`, so its diff is exactly the frontend delta on top of Hermes's integration branch.
- The agent-first patch was applied once on each branch in a coordination race: `544531b` here and `f0929b5` on Hermes's branch, with the same patch sha256. `fef8cda` merges Hermes's `f88f63c` into this branch with a merge commit. Nothing was rebased or applied a third time.
- `56d013c` is the PR #2 review refinements. `37169bb` makes the artifact show "Ready for review" until approval, so all surfaces agree.
- `e92c27d` merges Hermes's `a779715`. In a second coordination race, Hermes ported my older `1e10dc5` as `693a54f` while I worked on `56d013c` and `37169bb`. UI files keep this branch's newer version. From `693a54f`, this merge carries over: the status-line wording (preparation is not approval; an approved revision does not complete tasks or responsibility criteria), the task-state readbacks in `real-journey.mjs`, and a pending-decision surface check in `agent-first-journey.mjs`. His non-UI work is taken unchanged: launcher key stripping, `model_responsibility_proof.py`, docs and evidence.
- `7e3a519` follows the 08:44 review checkpoint. The status line is now short ("Revision approved. No external action was taken."), with the explanation in one disclosure. Rows keep separate labels: "Approved revision", "Stopped" and "Ready for review". Home groups them as "Your work", not "Approved revisions / stopped".
- Route and base, published so neither owner ports the same delta again: this branch descends from `a779715`. `git diff a779715 <head> -- web` is exactly the frontend delta (the visual refinements plus this round's copy). Hermes can fast-forward `hermes/agent-first-integration` to the head.
- `d2f0684` and `d354940` follow the 09:40 checkpoint. A pending proposal is labelled "Decision needed" everywhere, including the artifact's `needs_review` state, which was "Revision needs review". The Home lede orients rather than repeating the card. Hermes's base was still `a779715`, so there was no race.
- Combined candidate for integration: `d354940`. The full real demo passed at that exact commit with a clean tree, and the mock suite passed 12/12.

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

## Next integration step for Hermes

Review PR #2, then fast-forward `hermes/agent-first-integration` to this branch head (a descendant of `a779715`). Rerun `python3 scripts/workagent.py demo` on your host, then fast-forward `hermes/s0-s1-build` as you planned.
