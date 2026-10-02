# Combined candidate evidence: `e92c27d`

Real Next.js UI + FastAPI + PostgreSQL 16 with deterministic fixture computation. No live agent ran.

- `real-demo/`: `python3 scripts/workagent.py demo` at `e92c27d` with a clean tree (`demo.json`, `dirty: false`). It covers the real journey, Hermes's agent-first journey (in `agent-first/`), both reopens after API/web restart, and the nine fault regressions (in `fault-regressions/`).
- `before-fef8cda/` and `after-e92c27d/`: the same API-driven checkpoints captured by `web/scripts/capture-states.mjs`. The "before" is the merged candidate prior to the PR #2 review changes; the "after" is this commit (`e92c27d`, the merge of Hermes's `a779715`). Each name has a desktop (1440) and a mobile (390) image.

| Pair | Checkpoint |
|---|---|
| `01-home-prepared` | Prepared work awaiting inspection, on Home |
| `02-home-context-chosen` | Intake example filled; context collapsed to a count |
| `03-assignment-prepared` | Assignment page, prepared |
| `04-artifact-prepared` | Artifact, prepared |
| `05-home-decision` | A proposed revision waits for a decision, on Home |
| `06-artifact-decision` | The decision view with exact changes |
| `07-artifact-approved` | Approved current revision |
| `08-home-approved` | Home after approval |
| `09-spaces-approved` | The personal space after approval |

`e92c27d` merges Hermes's `a779715` (operator-assisted Qwen draft import, launcher key stripping, docs). The only UI change since `37169bb` is the assignment status line, which now says preparation is not approval, and that an approved revision does not complete tasks or responsibility criteria. `real-demo/15-approved-with-unfinished-task.png` shows it.
