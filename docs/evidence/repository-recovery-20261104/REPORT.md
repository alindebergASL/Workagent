# Repository recovery audit — 2026-11-04

## Scope and incident

During owner-approved Tier-1 disk cleanup, the operator mistakenly deleted the main Git repository after `git worktree remove` refused it. This removed the shared object database and linked-worktree metadata. A GitHub clone restored published history, but that is not proof that all pre-deletion local commits, refs, reflogs or indexes survived.

Earlier statements that all history was safe, that no data was lost, and that missing archived worktree linkage was an intended cleanup effect are withdrawn. The linkage loss was an incident. Counting remote-tracking refs in a fresh clone cannot establish that the deleted repository had no unpublished branches.

## Current checkout arrangement: verified

- Restored shared repository: `/home/ubuntu/workagent-backend`.
- Canonical working checkout: `/home/ubuntu/workagent-continuation-20261026`.
- Recovery baseline: `02f91b39878f2bdc2a9effa396022540968205d2`.
- Before repair, both checkouts were attached to `hermes/b2-conversational-client`.
- Verified the redundant main checkout was clean; backed up restored `.git`; detached that checkout at its existing exact commit. Canonical remains the only checkout attached to the feature branch.
- `git fsck --full` completed successfully using checked subprocess exit codes, not piped exit statuses.
- The main checkout has no working-tree modifications. Canonical's 21 pre-existing untracked evaluation scripts/lockfile were separately archived and SHA-256 inventoried before this correction work. Documentation changes from this audit are separate from those files.

This verifies current restored Git integrity, not historical completeness. No default-branch merge or PR merge is part of this recovery.

## Surviving historical material

A bounded scan of canonical `.local` found three independent Git repositories. Each passed `git fsck --full`; each was preserved as a verified `git bundle --all`:

| Surviving repository | HEAD |
| --- | --- |
| `.local/boundary-audit/model-discovery-integration/source` | `016cd122dc400e644c4f240a68d0bae006335c00` |
| `.local/batch3/b34a/web-lane` | `ff702d23239e712b03a123042369ea430cbc34ee` |
| `.local/recovery3/claude` | `396c9131fd659467857e49fe051cb8ada9367a45` |

None of these three HEAD objects was present in the restored main database at inspection. They are separately preserved, not assumed to be missing main-repository ancestors or merged into current development.

The scan identified 17 archived source directories without their own Git metadata (the earlier count of 16 was wrong). Their files remain, but original HEADs, indexes and exact pre-deletion completeness are not established. Before quarantine, Git commands in these directories silently resolved to the canonical ancestor checkout. Each now has an explicit `.git` guard pointing to an absent recovery-metadata location: Git fails closed rather than operating on the wrong repository. These guards do not claim to restore history; do not replace them with a guessed HEAD.

The local `workagent-preserved-checkpoints/20261015-spaces/pre-publication.tar.gz` contains 47 entries and no Git metadata. Inspected host-archive receipts and local backup inventory did not establish a pre-deletion backup of the shared repository. This is a bounded local inspection, not an exhaustive remote archive recovery claim.

## Durable local recovery artifacts

Private recovery files live under canonical `.local/preserve/recovery-20261104/`, outside auto-pruned scratch storage. They are not committed:

- `restored-git-before-layout-repair.tar.gz`: backup of the already-restored Git database, not a pre-incident backup. SHA-256 `046559515fbbbed81f051e1e834913194e4a6d49b0bbf97cdd14e06fb2cfd4ca`.
- `surviving-repositories.json` and three verified bundles.
- `archived-lane-inventory.json`: original discovery state.
- `archived-lane-quarantine.json`: exact guard paths and failed-closed Git checks.
- `preserved-untracked-source.tar.gz` and `preserved-untracked-manifest.json`: 21 canonical untracked source files.
- `preserved-alpha-units/`: all four disabled alpha unit files copied out of scratch retention.
- `remaining-gitfiles.json`: surviving linked-worktree pointer discovery.

Earlier Tier-1 patches and evidence remain under `.local/preserve/tier1-reclaim-20261104/`. Their presence is not a substitute for a pre-deletion complete metadata inventory.

## Disposition

Current canonical Git operation is repaired. Archived worktree metadata recovery is partial/unproven, explicitly quarantined, and must not be described as complete. Existing databases were not modified by these repository repairs. Runtime readiness and Batch-3 acceptance are separate audits; object integrity alone proves neither.
