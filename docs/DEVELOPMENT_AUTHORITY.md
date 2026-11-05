# Development direction — Workagent

Andrew's direction, November 5, 2026. It replaces every earlier version of this file. The old text is history, not instruction ([previous version](https://github.com/alindebergASL/Workagent/blob/2f3c5dd447bf92fb34978f8960333c6fe1d165ba/docs/DEVELOPMENT_AUTHORITY.md)). Read it with `../AGENTS.md` and `GENERAL_MODEL_AUTHORIZATION.md`. A newer direct instruction from Andrew overrides it.

## The goal

Build a Workagent that Andrew actually uses for real work, on desktop and phone. Andrew using it, and saying what helps, is the measure of progress. Test totals, acceptance matrices, evaluation studies and reviews are tools for getting there. None of them counts as progress on its own.

## Current milestone: Andrew uses the current build

1. **Take Claude's web head:** the tip of `aslcl/elegant-clarke-e22pab`. It includes the web work through `b5d5183`, the `products-journey.mjs:315` verifier fix (`3a48072`) and this direction. Merge it into #18.
   - In `web/src/components/MemoryPanel.tsx`, combine both sides. Claude can do this merge on request.
   - In `STATUS.md`, `docs/DEVELOPMENT_AUTHORITY.md` and `docs/GENERAL_MODEL_AUTHORIZATION.md`, keep this branch's version.
2. **Install #18 fresh on the Linux server you've been working on.**
   - Use a new database.
   - Don't migrate, change or delete the old alpha database or its services. Leave them as they are.
   - Andrew's conversations get model answers through the approved route, within the budget in `GENERAL_MODEL_AUTHORIZATION.md`.
3. **Tell Andrew how to open it** on desktop and phone, the same private way he reached the old alpha. Keep it to a few lines.
4. **Fix what Andrew finds.** Hermes fixes the backend, Claude fixes the web. Ship each fix to the install as soon as it works.

The milestone is done when Andrew has used the current build and his first round of findings is fixed or explicitly scheduled.

**Until it's done:**
- **Don't start new capabilities.**
- **Cancel queued work that doesn't serve the milestone.** That includes the B3.5g re-run (card `t_4ccebe23`) and any other study, acceptance or audit card.
- **Treat older "next" and "successor" entries as history.** Any such entry from before November 5, in STATUS.md, a handoff, a task card or `docs/evidence/`, is not an instruction.
- **Connecting the approved model to Andrew's install is routine engineering.** Use the existing grant mechanism. Don't build new authority or accounting machinery to do it.
- **If you're stuck, tell Andrew.** If something blocks the install for a working day, or the same check fails twice after a fix, send Andrew three lines: what's blocked, what you tried, the options.

## How to work

- **Build-mode authority stands.** Change APIs, schemas, policies, tools and architecture whenever they get in the way of the product. Implementing, testing, running development services and publishing feature branches need no approval.
- **Verify in proportion to the risk.** Run the tests for what you changed, plus one real end-to-end check when behavior a user sees changes. Don't re-verify published work unless it changed. Don't run a whole-suite rerun, a broad audit, an extra review layer or an all-model review by habit.
- **No acceptance gates.** Don't build pass-rate matrices, HOLD verdicts or batch acceptance programs. A known gap is a line in the next update, not a gate on the rest of the work.
- **No new process tooling.** Don't add guards, boundary inventories, anti-drift checks or tests that check the wording of documents. Don't extend `evaluation/development_boundary_guard.py` or its inventory.
- **One worker, few reviews.** Work as a single writer. Use at most one independent review, and only for changes that risk data loss, security or money. Don't fan out agent fleets unless Andrew asks.
- **No evaluation studies unless Andrew asks for one.** That includes A/B cohorts, longitudinal studies and synthetic-episode campaigns. The memory A/B program is ended. Its results stay as history.
- **Keep evidence out of git.** Screenshots, terminal logs, run dumps and manifests go under `.local/` or into CI artifacts. A change gets at most one short note in the repository. Don't add new files under `docs/evidence/`.
- **Keep STATUS.md under 100 lines**, describing the current state only. History lives in git.
- **Send web failures to Claude.** Claude owns everything under `web/`, including `web/scripts`. Report a failing web check to Claude instead of carrying it as a hold.
- **Keep updates short and about the user.** Each update to Andrew or on a PR is at most 10 lines:
  - what Andrew can now do;
  - how to try it;
  - what's still broken.

  Hashes, test counts and accounting go in a linked file if they're needed at all.
- **State only what you've checked.** If you haven't checked something, say "not checked". Correct a wrong claim in one line and carry on.

## Safety

- **Never bypass a refusal.** If git, the filesystem, the database or a permission check refuses an action, don't force it, find a way around it or delete the thing refusing. Stop and tell Andrew. Bypassing git's worktree refusal on November 4 deleted the shared repository.
- **For disk space, delete only build output and caches that you created and can regenerate.** Ask Andrew before removing anything that contains `.git`, a database, credentials, uncommitted work or anyone else's files.
- **Preserve what people made.** That covers human edits, saved work, credentials, access isolation between people and conversations, and duplicate-effect protection, so an uncertain external request is never blindly re-sent.
- **These still need Andrew's explicit approval:**
  - maintenance on installed data (migrating, vacuuming or bulk-editing an existing database);
  - destructive cleanup;
  - access to new private accounts or data;
  - effects outside Workagent (sending, posting or buying);
  - merging to the default branch (`hermes/s0-s1-backend`);
  - any public deployment.

  A fresh database for a fresh install doesn't need approval.

## Open technical items, after the milestone

- **P7, revocation targeting.** Make one focused fix, or record a reproduction as a known gap. No further evaluation runs.
- **The 21 untracked files under `evaluation/`, and `contracts/pnpm-lock.yaml`, in the canonical checkout.** Check them for private paths and credentials, then archive them outside the repository with a one-line note. Don't commit them.
- **Archived source directories with `.git` guards.** Leave them as they are unless Andrew asks.
