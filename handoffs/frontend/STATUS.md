# Frontend status (Claude Code stream)

Updated: 2026-10-02 (UTC). Owner: Claude Code frontend stream. Hermes owns backend, the domain adapter, integration and the combined milestone report.

## Where the work is

- Branch: `claude/workagent-frontend-kyg51x`, fast-forwarded to `hermes/s0-s1-build` @ `6f88a9d` (the integrated real-backend build) before this round.
- `544531b`: the agent-first patch from PR #3 comment 5946839169, applied once and unmodified (patch sha256 `4a1ec574…8aad`). The claim to apply it here is posted on PR #3.
- `1e10dc5`: reconciliation and refinement (application code). Exact-commit real demo passed with a clean tree.
- The following commit holds evidence and these notes only.
- PR #2 is retargeted to `hermes/s0-s1-build`, so its diff shows only this round.

## Owned paths

- `web/**` except Hermes's integration files below.
- `handoffs/frontend/**`.
- `.github/workflows/frontend.yml`.

## Hermes-owned files: not changed, or changed minimally as noted

- `web/src/lib/client/api.ts`, `real-api.ts`, `mock-api.ts`, `command-cache.ts` and the `/api/domain` proxy are unchanged.
- `web/scripts/real-journey.mjs`: Home selectors adapted to the new UI. Added apply-proposal, phone pane and draft preservation, keyboard conflict resolution and completed-Home checks. Reopen now verifies the applied revision plus the retained human revision. No existing assertion was removed or weakened.
- `web/scripts/fault-regressions.mjs`: one assertion now waits for the actionable "Apply proposal" decision instead of the old notice title.
- Both scripts honor an optional `PLAYWRIGHT_CHROMIUM_PATH` for hosts with a preinstalled browser. It is unset in Hermes's environment, so his behavior is unchanged.

## Backend requests (no workaround in the adapter)

1. **Pending decisions on assignment summaries.** `GET …/assignments` returns no pending-proposal signal, so Home makes up to eight detail reads per poll to find "one decision for you". Requested: a `pending_proposal_artifact_ids` field (or equivalent) on each summary. The UI will then drop the detail reads.
2. **Last-changed time on assignments.** Summaries carry only `observed_at`, which is the read time. The UI therefore shows no "updated" time on work rows. Requested: `updated_at` from the latest committed change.
3. **Execution mode per run.** The UI labels all agent work as deterministic fixture computation because that is the only adapter. Once a live runtime exists, the API needs to expose each run's `profile` and provider on artifacts and proposals, so the UI can label per item instead of per build.
4. **Shared spaces.** Spaces lists exactly what `GET /workspaces` authorizes. Creating spaces, memberships and invitations need domain operations before any UI for them.

## Next integration step for Hermes

Merge `claude/workagent-frontend-kyg51x` into `hermes/s0-s1-build`, or review PR #2 against it. Then run `python3 scripts/workagent.py demo` on your host to repeat the evidence independently.
