# Combined candidate evidence: `d354940`

Real Next.js UI + FastAPI + PostgreSQL 16 with deterministic fixture computation. No live agent ran.

- `real-demo/`: `python3 scripts/workagent.py demo` at `d354940` with a clean tree (`demo.json`, `dirty: false`). It covers the real journey, Hermes's agent-first journey (in `agent-first/`), both reopens after API/web restart, and the nine fault regressions (in `fault-regressions/`).
- `before-fef8cda/` and `after-d354940/`: the same API-driven checkpoints captured by `web/scripts/capture-states.mjs`. The "before" is the merged candidate prior to the PR #2 review changes; the "after" is `d354940`, which descends from the merge of Hermes's `a779715` (`e92c27d`). Each name has a desktop (1440) and a mobile (390) image.

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

`e92c27d` merges Hermes's `a779715`: the operator-assisted Qwen draft import, launcher key stripping and docs. The UI changes after `37169bb` are only on the assignment status line. It reads "Revision approved. No external action was taken." (or names what was prepared). One disclosure, "What approval covers" or "What review means", explains that approval does not complete tasks or responsibility criteria, and that preparation is not approval. `real-demo/15-approved-with-unfinished-task.png` shows the approved case. The task stays `created` (see `real-demo/task-readback.json`).

`d2f0684` and `d354940` apply the 09:40 review checkpoint. A pending proposal reads "Decision needed" on Home, Spaces, the assignment and the artifact; "Ready for review" stays for first prepared work. When the timely card is shown, the Home lede only orients ("Here’s where your work stands."). See `05-home-decision` and `06-artifact-decision`.
