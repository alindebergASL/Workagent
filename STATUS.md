# Workagent status

Current state only, kept under 100 lines. History is in git: the previous long version is at [2f3c5dd](https://github.com/alindebergASL/Workagent/blob/2f3c5dd447bf92fb34978f8960333c6fe1d165ba/STATUS.md). Direction is in [docs/DEVELOPMENT_AUTHORITY.md](docs/DEVELOPMENT_AUTHORITY.md).

## Now (November 5)

- **Milestone:** install #18 fresh on the Linux development server, with a new database. Andrew uses it on desktop and phone, and we fix what he finds.
- **Code:**
  - PR #18 (`hermes/b2-conversational-client`) is at `2f3c5dd`. It isn't merged anywhere, and nothing is deployed.
  - Claude's web head is `aslcl/elegant-clarke-e22pab`. It contains the verifier fix and this direction.
  - Merging the two conflicts only in `web/src/components/MemoryPanel.tsx`.
- **Installed alpha:** still runs `d4d019c4` (October 23). Leave it and its database untouched.
- **Studies:** the memory A/B program has ended, and no study or acceptance work is queued.
- **Budget:** $275 cumulative ceiling. Read the ledger before paid use.

## Known gaps

- **P7, revocation targeting.** It's proven to deny a request aimed at the wrong target, not that it chose the specific revoked attachment. Next step: one focused fix, or a recorded reproduction.
- **"Execution status:"** still shows in conversation previews. It needs a typed preview field.
- **The repository deletion on November 4.** Published history is restored from GitHub, but some local-only commits from before it may be lost. Details: `docs/evidence/repository-recovery-20261104/REPORT.md`.
