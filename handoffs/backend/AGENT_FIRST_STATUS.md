# Agent-first integration — combined candidate

Shared branch: **`hermes/agent-first-integration`**. Base milestone: `6f88a9d524d4ab7db1f800087d2f13f4ca1d130b`.
Application candidate: **`693a54f`**, followed only by frontend historical evidence at `42473fed44af7e4675945830b5931cf1acab93b6` and the backend evidence/review notes in this handoff.

## Coordination and scope
- The patch was applied exactly once here as `f0929b5`; its stable Git patch ID equals Claude's separate patch-only `544531b`: `7d238aa505a9961f7dadaf798d09c5e6d66169c6`.
- Integrated only Claude's **post-patch** refinement delta `1e10dc5` into `693a54f`, resolving three conflicts; retained historical evidence/handoff `70ff04a` as `42473fe`. No duplicate patch application and no replacement frontend session.
- Preserved Claude's Composer, Space detail, responsive document/agent panes, exact checklist diffs, keyboard controls, CI fix and tests. Moved the frozen full delegation-command guard into Composer; one authoritative adapter supplies proposal/approval summaries, avoiding a second competing overview derivation.
- Corrected initial prepared work versus proposed-change decisions versus approved current revision. Approval explicitly does not complete task/responsibility criteria or imply external actions. A created but unfinished task remains created after restart.
- Claude retains UI ownership. Further changes should be bounded post-candidate deltas; do not reapply the original patch. Hermes owns integration and exact-candidate verification. Earlier instructions in the preserved frontend handoff to merge the entire old branch are superseded by this reconciled route.
- PR #3's existing non-default head will be fast-forwarded to the verified combined branch; no default-branch merge or public deployment is authorized/performed.

## Demonstrated on the combined application
- Real Next.js/FastAPI/PostgreSQL: delegation (including dropped 202 / same-command retry) → generated artifact → human note/checklist edit → stale proposal rejected without overwrite → fresh proposal → explicit approval → actual API/web restart/reopen.
- Agent Home, Space detail, assignment and artifact checked at prepared, pending-decision and approved checkpoints. Checked human note remains exact and checklist state durable. Approval remains visible while a separate task is unfinished.
- 49 backend/runtime tests; 22 frontend unit tests; contract drift/type checks, lint/format and production builds passed. All nine real browser fault regressions passed. Twelve separately labeled mock browser cases passed at desktop/mobile/320px; those are not backend/runtime evidence.
- Code paths did not change between `693a54f` and the combined real-demo run at `42473fe`; the only untracked files during that run were the upstream research documents. The evidence records this dirty-docs state rather than falsely claiming a pristine checkout.
- Independent review of the final combined candidate is **pending**. Earlier independently reviewed milestones and separate-branch results do not close this gate.

## Model access / upstream decisions
See [RUNTIME_ACCESS_AUDIT.md](RUNTIME_ACCESS_AUDIT.md): recovered prior Qwen app/subscription authorization; one actual model response, durable import, intentional post-commit crash, exact-command recovery and browser reopen, no second model call. This is explicitly **operator-assisted**, not an autonomous product worker or owner approval. The default fixture profile is unchanged; managed product access remains a separate gap.

[Upstream review](upstream/REPORT.md), [exact pins](upstream/pins.json): retain managed-first; reuse current Workagent authority/bundle/broker/outbox, adapt narrowly useful context/receipt vocabulary, defer framework/gateway/scheduler adoption. Do not build a parallel abstraction without a concrete consumer. Both root licenses are MIT with noted file/dependency exceptions; no source copied or framework executed.

Still out of scope: shared-Space mutations, Google/calendar actions, autonomous recurring responsibility execution, managed-session/compaction/skill qualification, public deployment, owner usefulness acceptance and default-branch merge.

## Local execution
`python3 scripts/workagent.py demo` provisions an isolated database, builds, runs both real journeys, restarts and runs all fault cases. `python3 scripts/workagent.py serve --env .local/combined-exact.env` reopens the retained combined proof on this evaluation host. The separately retained live-draft import uses `.local/model-proof.env`; it contains no provider key. These ignored environment files are not portable credentials and are not published.
