# Integrated Space review — 70b4d8c

Exact reviewed candidate: `70b4d8cf692355acc137608e0424a026c2c7f0a7`, tree
`0d93507b1f561bdc288e828b8478c9c7046d35ba`. Independent Astra review: **changes
required**. No new backend/security blocker identified; frontend ownership remains
Claude. This report is not approval for live evaluation or a usefulness verdict.

## Required fixes

### P1 — restored purpose draft loses its original version

`web/src/components/WorkAreas.tsx`: the saved draft contains values only, while
`SpaceDetails.from` is initialized from the latest conversation version.
Reproduced in actual React components with controlled mocked API boundaries:
start a draft atv1, another edit savesv2, reload, save restored draft → command
uses expectedv2 and can overwrite the intervening edit without a conflict.

Persist and restore the draft's original base version alongside its values.
Advance it only through explicit conflict resolution. Add the before-reload
concurrency case; changing the version only after reload misses the defect.
Preserve exact command replay for genuinely uncertain writes.

### P2 — automatic preview silently becomes binding reply target

`SpaceView.tsx`: without `?work=`, `leadWork` determines `selected`, which determines
the explicit message target. A controlled actual-component browser reproduction
showed targetA→B after refresh while the draft stayed “Please shorten this”; focus
moved to `space-selected-heading` without a user selection. Backend correctly binds
explicit targets and cannot recover intent silently changed by the frontend.

Separate suggested preview from established reply target. Ordinary project chat
stays untargeted unless intent is established; retain established target/selection
while drafting. Refresh-driven presentation changes must not steal focus.

### P2 — unsupported file work becomes an invalid exact target

`SpaceView.tsx` currently creates targets for every artifact. Browser probe observed
auto-targeting a FileBody; a database-free call to actual backend `exact_target`
returned `unsupported_operation`. Thus a normal message can fail before inference.

Use the actual editable-kind contract (or canonical offered_targets) when producing
a target. Keep files visible and conversation useful; do not silently target a
different piece of work or invent file editability.

### Parent real-service failure — purpose save remains stale after reopen

Fresh actual PostgreSQL/Next/FastAPI journey (`web/scripts/space-experience.mjs`)
passed cases1–8, then failed case9 atline314. Deliberate intervening update200,
first form save409, reread200, Cancel/reopen/retype/second save409, reread200.
Canonical purpose remained unchanged. Retained `.local/space-integrated-journey.log`
and `.local/space-experience-services-70b4d8c/api.log` record the failure.

Fix the version-refresh/reopen race with delayed reread coverage; keep text, CAS
and explicit retry semantics. Do not change the test merely to wait away a real
user race. No failed live output was repaired: no product-model call occurred.

## Related experience correction

Pending proposal status is not proof its base revision is current. Distinguish
stale pending proposals from actionable current-base ones; do not summarize an
old-base proposed diff as if it were based on today's saved body. Keep history
visible and retain canonical acceptance protection. Existing IDs already permit
the comparison; the new WorkAreaContext also exposes it. No new store needed.

## Evidence and remaining gates

Independent reviewer inspected exact diff, requirements, runtime context and tests;
16 space-view unit tests, static diff checks, in-memory actual React/Chromium
probes and actual exact_target validation. No source edits, retained DB writes or
provider calls. SQL table identifiers in the projection are internal literals.

Parent fresh checks:255 frontend tests, type/lint/format, production webpack build;
real-service journey8 cases passed then failed; desktop/390px actual UI inspected.
The full backend suite is running on a separate freshly provisioned disposable DB;
no pass claimed until it ends. Backend author's175 focused tests remain carried
controlled evidence, not live model behavior. No grant installation or default merge.

Claude should return a focused fix SHA and regressions; Hermes reuses the backend
review and checks the exact frontend fix delta plus relevant integrated scenarios.
The baseline GLM critique remains separate from this independent engineering review.
