# Frontend result: agent-first, combined candidate `d354940`

Status: independently reviewed **PASS** at `e0da95cc05a103af52cf5a31b328a2ee93486640` (application code `d354940`), then integrated by fast-forward into `hermes/agent-first-integration`. See the published [Hermes report](../backend/review-pr2-e0da95c/REPORT.md) and [structured result](../backend/review-pr2-e0da95c/review.json). This status/evidence publication changes no application code and does not claim another broad test run.

**Usable outcome.** A person starts on the Agent home and hands over a request with chosen records. They see honest queued and working states. Prepared work appears above the composer as one timely card with "Open prepared work". The plan opens as a calm document with an agent pane: one outcome line, a collapsed "What changed", and "Ask for a revision" on demand. A proposed revision shows its exact changes; the person applies it or keeps their version. An applied revision reads "Approved revision" on Home, in the space, on the assignment and on the artifact. It never implies an external effect. Everything reopens after the API and web processes restart.

**What runs where.** Real: browser UI, FastAPI domain services, PostgreSQL, authorization, revisions, proposals and restart. Fixture: all analysis and revision text comes from the deterministic fixture worker. No live agent ran. The mode line on every screen says so, and provenance is available in "What I checked" and History.

**Branch / commits / PR.** `claude/workagent-frontend-kyg51x`:

- `fef8cda`: merge of Hermes's `f88f63c`.
- `56d013c`: review refinements.
- `37169bb`: final consistency fix.
- `e92c27d`: merge of Hermes's `a779715` (his port of my older `1e10dc5`, plus model-proof tooling and docs). This branch keeps its newer UI and carries over his additional guards.
- `7e3a519`: per the 08:44 review checkpoint, the approval and review explanations sit one disclosure away on the assignment page.
- `d2f0684`, `d354940`: per the 09:40 checkpoint, a pending proposal reads "Decision needed" on every surface, and the Home lede orients instead of repeating the card.
- `e0da95c` holds the evidence and notes and is the exact independently reviewed head.

PR #2 targeted `hermes/agent-first-integration`; it was integrated by fast-forward at exact head `e0da95c`, preserving ancestry.

**Commands run at `d354940`:**

```sh
python3 scripts/workagent.py demo --skip-setup --env .local/final-d354940.env   # fresh isolated DB
cd web && pnpm check                                       # tsc, eslint, prettier, 25 unit tests
cd web && NEXT_PUBLIC_WORKAGENT_API_BASE=/api/mock pnpm build && pnpm test:e2e   # 12 mock browser tests
node web/scripts/capture-states.mjs <dir>                  # matched checkpoint captures (stack running)
```

| Check | Mode | Result | Evidence (`evidence/combined-d354940/`) |
|---|---|---|---|
| Delegation with a lost 202: same command replayed, one assignment, one run | real | pass | `real-demo/agent-first/state.json` |
| Prepared checkpoint: Home card, space, assignment and artifact all read "Ready for review" | real | pass | agent-first journey; `after-d354940/01`–`04` |
| Proposal awaiting decision: "Decision needed" on Home, Spaces, the assignment and the artifact; exact changes and both bodies; stale accept returns `version_conflict` | real | pass | `real-demo/04`, `05`, `10`; `after-d354940/05`, `06` |
| Approved checkpoint: every surface reads "Approved revision"; human text and checklist preserved; the task stays `created`, and "What approval covers" says approval does not complete tasks or responsibility criteria | real | pass | `real-demo/agent-first/05`, `06`, `real-demo/15`; `after-d354940/07`–`09` |
| Phone: document first, Agent pane switch, unsent instruction and unsaved edit kept | real | pass | `real-demo/12`, `agent-first/03` |
| API and web restart, then reopen the same assignment, approved revision and retained human revision | real, PostgreSQL retained | pass | `real-demo/restart.json`, `agent-first/restart.json`, `demo.json` (`dirty: false`) |
| Nine fault regressions | real | pass | `real-demo/fault-regressions/results.json` |
| Full journey at 1440 / 390 / 320 px, errors, reconnect, replay | mock | pass (12/12, twice) | `evidence/{desktop,mobile,narrow}` |
| Pending decision reads the same on Agent, Spaces and the assignment | real | pass | agent-first journey |
| Live agent or model execution in the product | live | not observed | No runtime grant. Hermes's recorded Qwen draft is an operator-assisted import (`handoffs/backend/model-proof/`), not a product run |

**PR #2 review items:**

1. Calmer artifact screen: done (`after-d354940/07`).
2. No raw IDs or hashes in the document: done. They are in History "Identifiers" and the decision card's "Revision details".
3. A timely outcome above the composer on mobile Home: done (`01`).
4. Context collapses to a count: done (`02`).
5. Less repeated fixture copy: done, with one mode line and provenance on demand.

**Independent review.** PASS at `e0da95c`: the untouched canonical real demo, actual API/web restart, all nine real fault cases, 25 unit tests, type/lint/format and 12 mock-browser tests passed. Extra real-browser checks covered approval invalidation, serialized refresh and retained drafts. No provider calls or live product execution occurred. “Keep for later” remains a nonblocking, separately tracked frontend follow-up. Earlier frontend self-review on real screens found and fixed:

- The prepared artifact header disagreed with the other surfaces (fixed in `37169bb`).
- A timing-dependent mock reconnect test (it now uses the focus re-read).
- A delegation prompt on approved rows.

**Model-proof labeling.** Hermes's operator-imported Qwen draft is saved as a human revision. Its first paragraph states its provenance. The mode line ("fixture worker, not a live agent") stays accurate because no agent ran in the product. Labeling each item by how it was produced needs backend request 3. The hash-pinned `handoffs/backend/model-proof/browser-probe.mjs` remains historical evidence of the earlier "Saved" label; do not rewrite that archive. The maintained read-only `scripts/model_draft_browser_probe.mjs` expects "Ready for review" on the current UI, writes fresh evidence outside the archive, and performs no import or inference.

**Known gaps.** Backend requests 3 and 4 in `STATUS.md`. Live runtime remains blocked on the authorized project or secret reference and spend grant in `docs/RUNTIME_STATUS.md`.

**Integration checkpoint.** Independent review and the exact-head canonical demo are complete. Shared integration and the existing non-default PR #3 head were fast-forwarded through reviewed `e0da95c` to report/status publication `5ae4cbb`. Subsequent [bounded evaluator/documentation follow-ups](../backend/BASELINE_FOLLOWUPS.md) remain distinct from that accepted review; UI-1 is assigned to the existing Claude frontend owner through PR #2. Do not reapply the patch or reopen the passed review for these small follow-ups. Default-branch merge, deployment and provider spending remain unauthorized.

**Resumption checkpoint.** Branch head and these notes. `scripts/workagent.py demo` reproduces the real evidence on a fresh database.
