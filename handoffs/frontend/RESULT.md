# Frontend result: agent-first reconciliation

Status: ready for integration. The full journey passes against the real API and PostgreSQL. Independent review is still pending.

**Usable outcome.** A person starts on the Agent home, hands over a request with chosen records, and watches honest queued and working states. They then inspect completed work, the recommendation and its evidence. They edit the plan and save. They review a proposed change with its exact differences, apply it or keep their version, and find the same work after the API and web processes restart. Spaces lists the authorized personal space with its work and records. On phones the document comes first, and switching to the agent pane keeps unsent instructions and unsaved edits.

**What runs where.** Real: browser UI, FastAPI domain services, PostgreSQL, authorization, revisions, proposals, restart. Fixture: all analysis and revision text comes from the deterministic fixture worker. No live agent or model execution happened, and the UI says so on every screen.

**Branch / commits / PR.**

- Branch: `claude/workagent-frontend-kyg51x`.
- `544531b`: patch applied unmodified.
- `1e10dc5`: reconciliation (code).
- The next commit holds evidence and notes.
- PR #2, retargeted to `hermes/s0-s1-build`.

**Shared contract.** `workagent/v1` as integrated on `hermes/s0-s1-build` @ `6f88a9d`. The adapter and generated client are unchanged.

**Owned paths and coordinated changes.** See `STATUS.md`.

**Setup, launch and test commands** (all run in this session; Ubuntu 24.04, PostgreSQL 16, Node 22, Python 3.11 venv):

```sh
python3 scripts/workagent.py setup        # or the steps in README; this host skipped `playwright install`
python3 scripts/workagent.py demo --skip-setup --env .local/final2.env   # fresh isolated DB
python3 scripts/workagent.py serve        # use it at http://127.0.0.1:3000
cd web && pnpm check                       # tsc, eslint, prettier, 16 unit tests
cd web && NEXT_PUBLIC_WORKAGENT_API_BASE=/api/mock pnpm build && pnpm test:e2e   # 12 mock browser tests
```

Hosts without Playwright's own Chromium can set `PLAYWRIGHT_CHROMIUM_PATH` to a preinstalled browser.

| Check | Mode | Result | Evidence |
|---|---|---|---|
| Start and inspect result | real app + fixture compute | pass | `real-agent-first/01`, `02`, `09` |
| Human edit and save, protected note | real app | pass | `03`, `saved-artifact.json` |
| Stale proposal: both bodies, exact differences including checklist state, keyboard "Keep current" | real app | pass | `04`, `05`, `stale-proposal.json`; stale accept returns `version_conflict` |
| Fresh proposal: exact changes, apply, human text preserved, provenance shown | real app + fixture compute | pass | `10`, `11`, `applied-artifact.json` |
| Completed state everywhere: no "in progress", decision or delegation controls | real app | pass | `13`, `14`; assertions in `real-journey.mjs` |
| Phone: document first, unsent instruction and unsaved edit survive pane switches | real app | pass | `12` |
| API and web restart, then reopen the same assignment, applied revision and retained human revision | real app, PostgreSQL retained | pass | `07`, `08`, `restart.json`, `demo.json` (commit `1e10dc5`, `dirty: false`) |
| Nine fault regressions: response loss, ambiguous saves, decision replay, source drift | real app | pass | `fault-regressions/results.json` |
| Full journey at 1440 / 390 / 320 px, errors, reconnect, replay | mock | pass (12/12) | `handoffs/frontend/evidence/{desktop,mobile,narrow}` |
| Live agent or model execution | live runtime | not observed | No runtime grant. Every run is labeled fixture. |

**Independent review.** Not yet performed by a second author. Self-review against real screens found and fixed these issues:

- A stale diff struck through the human's text.
- Checklist changes were invisible in diffs.
- Unchanged lines buried the exact changes.
- Phone edit fields clipped their text.
- Phones stayed on the agent pane after a request was sent.
- An accepted proposal read as a plain human edit.
- Raw IDs and duplicated status cluttered the screens.
- The existing CI failure on PR #3, caused by the missing `contracts/` install. It was reproduced in a fresh clone and fixed.

**Screenshots and saved results.** `handoffs/frontend/evidence/real-agent-first/`, with a 28-file `MANIFEST.json` of sha256 hashes. It includes two design-reference captures for comparison.

**Known gaps and requested actions.** The four backend requests are in `STATUS.md`. Live runtime remains blocked on the authorized project or secret reference and spend grant named in `docs/RUNTIME_STATUS.md`.

**Next integration step for Hermes.** Merge or review PR #2 into `hermes/s0-s1-build`, rerun `scripts/workagent.py demo` on your host, and coordinate a second-author review of the integrated commit.

**Resumption checkpoint.** Branch head and these notes. `scripts/workagent.py demo` reproduces all real evidence on a fresh database.
