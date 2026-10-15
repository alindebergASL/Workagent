# Spaces reconciliation and experience handoff

Update 2026-10-15: Claude ACKed and integrated `9675daf` on the existing owner
branch (#9 comment6182032666) and is implementing the redesign. The resume request
below is historical/resolved. Hermes confirmed no recorded accounting changes in a
fresh read-only snapshot at01:06UTC. The [baseline different-model/persona review](../../docs/SPACE_EXPERIENCE_REVIEW.md)
is complete with controller adjudication; integrated/live review remains outstanding.

## Current checkpoint — 2026-10-15

Application candidate: `5854e9f2a1b2778e034ba189aba01c39cae9ccb9`, tree
`6cfec3fa31a2a91561eebb688e9e7da368d1578d`, branch
`hermes/spaces-continuity-checkpoint`. Published and exact remote SHA read back.
It descends directly from Claude's `cdea2a090b0c47eb84fda050c787b4bb147a1b9e`.
No default branch or existing Claude branch was changed.

This reconciles two different facts: Claude committed the responsibility UI at
cdea2a0; Hermes subsequently built Spaces/TUI locally, including frontend changes
outside the agreed ownership. Those 45 files are now preserved in the checkpoint,
not discarded or misattributed to Claude. All 45 matched the prior final evidence
manifest before publication. The only publication correction removes a trailing
blank line from `backend/tests/test_operator_replay.py`; its 32 operator tests
were rerun afterward. A private pre-publication archive retains the original bytes.

Claude remains the frontend owner. Hermes owns backend/runtime/domain/contracts
and integration. Do not apply the old patch again or rebuild its components in
parallel. Claude should merge this checkpoint into the existing owner branch,
inspect the inherited web delta, and take responsibility for the next experience
changes. If the branch moves, reconcile ancestry and preserve both owners' work;
never reset or force-push it.

## Product outcome and verdict

The checkpoint connects a persistent project/workflow Space, canonical saved work,
conversation, editing/review links, and a real HTTP terminal client. Work can be
reopened and continued without losing accepted human changes in controlled tests.
It does **not** yet make purpose, current state and next action sufficiently clear.
The user rejected the screenshot as an understandable/useful experience. That
experience verdict is not superseded by passing engineering checks.

The complete product remains general agency + extensible skills/tools + scoped
context/memory + durable continuity + authorized initiative + optional Spaces +
Intelligent UI. Quick questions need no Space. GTD and all evaluation scenarios
are optional examples, not product routing or a supported-workflow whitelist.
Retain the completed nanoMuse research and current contracts; no vision/harness reset.

## Evidence classification

- Committed implementation: exact candidate above, including inherited Claude UI.
- Local evidence only: original `.local/budget-preparation/SPACE-DELIVERY.md`,
  `space-verification/FINAL-MANIFEST.json`, and retained fixture/failure directories.
  Private environments, credentials, databases and raw provider records are NOT published.
- Fresh publication checks: 239 frontend unit tests, TypeScript, lint, formatting,
  32 operator tests and staged diff checks passed. `pnpm` initially refused the
  externally symlinked modules directory; `npm run` used the existing dependencies
  successfully, without install/removal. An operator test invocation from repository
  root failed import collection; running from `backend/` passed. Neither failed
  command is hidden or called product behavior evidence.
- Carried controlled evidence, byte-verified rather than newly rerun: 179 scoped
  backend tests (includes the operator tests), 12 Chromium/React boundary cases,
  production Webpack, actual PostgreSQL/API/browser/TUI/PTY/reopen journey and
  prior independent Astra review. Full backend suite was not completed for Spaces.
- Historical live evidence: one actual ordinary-browser/model turn on cdea2a0
  produced a retained lightweight commitments draft. It did not exercise the new
  Spaces schema, ongoing execution or a changed requirement. Do not present the
  controlled Space contents as live model output.
- Different-model review and full persona/response/experience QA remain open.
  Inherited Astra reviewers alone do not satisfy that requirement. Human usefulness
  acceptance remains the user's, not a model vote.

## Claude: actionable frontend implementation handoff

Continue in `claude/workagent-frontend-kyg51x`, not a replacement session/branch owner.
Merge `hermes/spaces-continuity-checkpoint` after preserving any of your local work.
ACK the exact resulting SHA and the inherited web delta before changing it.

Deliver a coherent work experience, not another saved-content card rearrangement:

1. A person entering a Space should understand its purpose, current work, material
   decision/uncertainty and sensible next action without reading implementation
   vocabulary or a history dump. Use canonical data; do not invent progress or an
   agent promise. Keep conversation beside the work in a familiar responsive shell.
2. Use one contextual conversation entry point. Carry a clearly selected saved
   work target internally with its exact revision/hash. Do not ask the user to
   choose technical 'general Space chat' versus 'exact artifact refinement'. If
   intent genuinely conflicts or several targets are plausible, explain the
   concrete ambiguity. Do not weaken explicit unlinked-send protections on older
   builds or silently convert an uncertain command to a different target.
3. Intelligent UI is first-class: compose concise answers, comparison, editable
   work, visual explanation, adjustable analysis and real available controls as
   useful. Reuse ProductView/FlexibleWork and existing editors/command adapters.
   No fixed workflow dashboard or separate screen for each probe. Skills supply
   methods, tools supply executable capabilities, presentation supplies interaction;
   keep their extension points separate. Report missing runtime descriptors to
   Hermes before inventing client-authoritative work state or presentation claims.
4. Preserve edits, unsent text/files, active inputs, selection, keyboard focus and
   orientation across refresh, changing layout, work/conversation switches and
   navigation/reopen. Controls and conversation must mutate the same canonical
   work through current versioned commands. No phantom actions.
5. Space title/goal can be user-steered; agent identification must not overwrite
   human metadata. Ongoing responsibilities use current Assignment/lifecycle,
   not an immutable recording receipt, model prose or 'active' as proof of running.
6. Build believable synthetic demo content with a visible demonstration-mode label;
   no test assertions, fixture IDs, grant/schema jargon or scripted-success copy in
   the work itself. Deterministic transports remain explicitly controlled evidence.

Relevant inherited files: `web/src/components/{WorkAreas,ProductView,FlexibleWork}.tsx`,
`SpaceWork.css`, `web/src/app/spaces/[spaceId]/work/[id]/page.tsx`, conversation and
artifact pages, `web/src/lib/client/work-areas.ts`, shared reply/edit/recovery code.
Published backend routes/semantics: `backend/SPACES.md`, generated `contracts/openapi.json`
and `contracts/src/schema.d.ts`. No new migration or duplicate task/commitment store.

Return exact SHA, screenshots and actual-service evidence for desktop/390/320px,
keyboard/focus, meaningful accessible names/statuses, draft preservation, genuine
control effects, stale/denied/unavailable reads and no misleading ongoing promises.
Exercise broad request → useful work → unexpected change → leave/return, plus a
materially different request and a plain answer. These are probes, not routes.
Do not manually repair live outputs, prescribe model answers or hide failed cases.
Hermes owns paid subject-model dispatch, accounting and independent integrated QA.

## Coordination and next owner actions

- Hermes: publish/read back checkpoint and #9 update; reconcile canonical status;
  verify backend/context seams, exact-candidate tests and authorized model accounting;
  arrange real different-model review and authenticated review access.
- Claude: resume existing Cloud session, integrate checkpoint, ACK ownership and
  implement the experience above; report concrete contract blockers promptly.
- Session status: latest remote owner branch remains cdea2a0. No local Claude
  process was observed. A GitHub comment does not resume Claude Cloud; this report
  does not claim the session is active. User should open the existing Cloud task
  associated with that branch and send: "Resume the existing WorkAgent frontend
  task. Read the latest #9 handoff and handoffs/backend/SPACE-DELIVERY.md on
  hermes/spaces-continuity-checkpoint; preserve your work, integrate it, ACK the
  SHA, and implement the coherent Space/Intelligent UI experience. You own web;
  coordinate backend/contracts with Hermes. No independent paid calls or deployment."

## Authority and review access

Latest instruction continues routine development and requests an authenticated
review environment while preserving the older saved preview. It is not permission
for a default merge, production replacement, new paid route, expanded private data
or external business actions. Use existing authenticated access; do not expose
application/API ports publicly or claim localhost is user review access.

$40 is the cumulative authorization ceiling, not available spend. Historical
activation/reporting retained original $20 encumbrance plus a $1.978800 first slice;
$18.021200 remained unactivated. Last recorded live lineage: 54 dispatches, 56 count
requests, 466 reads, 28 runs and $7.12368 product reservations. Two unresolved count
attempts remain quarantined. These are historical observations pending current
readback, not billing or refunds. Changed schema/consumer hashes cannot be installed
by repinning the old grant. Reconcile enforced limits before new inference; no
unknown retry, reset, duplicate carry or silent replacement generation.

Review access, actual running services/lifetime and current accounting will be
recorded in the runtime status when verified. This checkpoint alone is not a
running private alpha or a successful next user demonstration.
