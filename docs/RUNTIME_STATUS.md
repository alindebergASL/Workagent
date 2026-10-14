# Current runtime status and execution boundary

## General alpha (#15) — verified backend checkpoint; combined QA pending

Local candidate: `/home/ubuntu/workagent-alpha-qa-integration`, detached HEAD
`571d0d13df5062dc8f29d795252e2489f24537bc`. The parent-verified backend tree is
`81243ea9a03375f815c04559ae469ccac3a5491e`: full suite **1116 passed, zero
errors/skips**, independent R1–R6 **PASS (129 tests)** and independent PASS for
three authorized test-only fixture corrections. Earlier **1113 passed / 2 failed**
and **1114 passed / 1 failed** runs remain historical failures, not erased.
Read-only parent evidence: `/home/ubuntu/workagent-alpha-responsibility-integrated/.local/responsibility-complete-final-review.json`
and `three-fixture-correction-status.md` in that same `.local/` directory.
These results are carried from the verified parent checkpoint, not rerun by the
documentation writer. The parent subsequently verified every manifest file against
the Git tree and all 1116 unique JUnit cases, then published the exact tree as
`367279b2f4cb9c782082f692e31a0aa3f09f36a7` on
`hermes/responsibility-recording-checkpoint`. Remote commit/tree readback matches.

The candidate combines that backend with existing Claude Cloud frontend
`90ba73bd497d63cfc558855f2156c309dc00a0e2` and its frontend handoff, exact bytes.
Initial integration index tree: `703f9a36e1d60b0290a2d064740bc4a6f639b376`
(before these unstaged documentation updates). Claude's separate checks passed
224 unit tests, 36 DOM cases, three real UI/API/PostgreSQL send-hold cases,
production webpack build, typecheck, lint and format. **Separate component
checks are not combined PASS.** Combined deterministic/browser/contract gates
and independent review remain pending at this documentation checkpoint.

`record_responsibility` now has a backend implementation and generated readback;
its former implementation-gap label is superseded for this backend tree only.
A canonical local record is not proof of future execution, monitored inboxes,
external effects, verified outcomes or accepted work. The
[frontend-owner handoff](../handoffs/backend/RESPONSIBILITY_RECORDING_CHECKPOINT.md)
names exact DTOs, authoritative reads and still-open UI wiring/QA.

Approved order: package/reconcile this checkpoint; integrate the existing Claude
frontend; **rigorous fanout QA before step 3, the user demonstration**. QA must use
genuinely different models, multiple personas, UX needs, visual quality,
accessibility and actual model/agent-response tests. Keep engineering,
usefulness and experience verdicts separate; none becomes broad acceptance from
the backend count. Issue #15 and the adaptive, intelligent UI direction govern.

NEW budget authority: **+$20**, **$40 total authorization ceiling**. This is not
a reset/refund of old reservations or unknown liabilities. Additional runtime
budget is approved but not activated by this file. Actual ledger, route/account,
pricing and enforced accounting still require reconciliation. Earlier “alpha not
installed” text is stale relative to later live attempts; **do not infer zero
prior alpha use**. Historical $5.93640/$20 and $3.42992 carry below are not a
fresh ledger or remaining-spend calculation. See
[authorization](GENERAL_MODEL_AUTHORIZATION.md).

Andrew subsequently authorized publication of this verified development checkpoint
and the Claude handoff: “Yes — publish a development checkpoint and Claude handoff;
no merge or deployment”. This supersedes the local-only publication restriction.
There is still no default merge, deployment, external business effect, expanded
private-data access or unsafe
automatic retries. Preserve production, SQL001–024, saved review state and human
edits. No new frontend writer replaces the existing Claude Cloud owner.

### No pre-canned behavior evidence

Latest user clarification (verbatim):

> Ok yes, we aren’t proving anything when it is pre canned

Scripted provider replies or preselected action sequences prove mechanics only;
they CANNOT pass agency, usefulness or response-quality gates. Rigorous behavior
QA must use actual live model decisions on varied, partly held-out natural-language
requests, unexpected follow-ups and observed failures. No seeded answers, supplied
repair instructions, operator result repair, selective replacement calls or
production task-name branches. Keep evaluation criteria and independent oracles
outside model context. Realistic synthetic input data is permitted for privacy;
synthetic data is not canned model behavior. Report failed/partial cases honestly
and preserve the full attempt and accounting history, not just successful examples.
Live behavior evidence still requires reconciled and enforced runtime authority;
if blocked, report NOT TESTED rather than substituting scripted responses.

## Historical alpha opening status — superseded by the checkpoint above

The following opening status and activation statement describe their original
checkpoint only, not current implementation or the absence of later alpha use.

Integration branch: `hermes/general-alpha-15`, based on PR #14 `a0764115`.
Runtime/skill composition and canonical responsibility lifecycle have isolated
backend writers; Hermes integrates. Existing Claude retains `web/`; Andrew is
resuming that Cloud session (local CLI currently has no login). Exact generated
contracts precede client wiring; [owner handoff](../handoffs/backend/GENERAL_ALPHA_FRONTEND_HANDOFF.md).

Current gaps: ordinary replies are misclassified as waiting/unverified in parts
of the adaptive path, and generic validation text can displace substantive
responses. Skills/tool definitions alone are not runtime composition; a paused
handover is not ownership. These are implementation targets, not declared fixes.
The existing product/work/acceptance/build contracts now incorporate #15 in place.

Earned baseline remains unchanged below. Preview `127.0.0.1:3166` is host-local,
not a deployed alpha; preserve its saved work and later human edits. New work
must use isolated databases and verification before replacing any review build.

Live grant readback: native allowance exhausted, **$5.93640/$20 reserved**,
$3.42992 carry and original count-only unknown preserved. A new bounded alpha
evaluation is approved but **not installed or dispatched**; see
[authorization and all bounds](GENERAL_MODEL_AUTHORIZATION.md). No default
merge/deployment, external business effect or broader account/private-data access.

## Preserved frontend status correction (#13 remains open)

Claude's `edb09db466d3f636818b439c4e2102f9bb3d33f7` is integrated at
`5acc6e521766f3b830dea3f47b3c611056370be4`. Empty/unrun model-example checks
now display **No model examples were run for this step**, not a failed-check
claim. Explicit passed/failed outcomes remain distinct. Only three frontend
source/test files changed; backend, contracts and migrations are unchanged.

Parent verification at the integrated application SHA: **173 frontend tests**,
typecheck, lint, format and production build passed. Both exact-head GitHub
checks passed. The new bundle `gjVVx487evDkjOh6YV9Pn` was built with native
admission enabled and passed the exact-target/full-saved-body preflight in a
disposable database with zero provider attempts.

The updated review UI remains **http://127.0.0.1:3166** (host loopback only),
using the unchanged API on 8166. Actual saved turns show the corrected wording
at desktop/390/320px; Home → Conversations → work succeeds without page errors,
overflow or writes. Later human edits have advanced current work to revision
`6029f895-07ca-421c-96a6-9c77a69ddb32`; they were preserved, not reset to the
historical accepted revision. That accepted revision remains in history and
the exact human-context block is intact. Readback confirms no new runs or
provider usage: **$5.93640/$20 reserved**, original count-only unknown retained.
The model consumer remains stopped; no further live-run allowance exists.

The original live journey below remains evidence at its original SHA; this
read-only status correction is not claimed as a new live generation. Default
merge/deployment and broader product acceptance remain outside this mission.

## Native editable-continuation live record (4186d33)

Live-tested application: `4186d337a5d3b225fc257dda02b9d18bb10ab63e`.
This adds an executable production-build admission guard; backend, web and
contracts are byte-identical to `dd01cd49a9b026edf8a99281d182e0554d54f4e2`,
including Claude's `dff730277c75e789bdc3b242f295e8270f7e7cf6` shell work.
The prior general-continuation attempt remains PARTIAL/HOLD: its build omitted
`NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1`. It is not relabeled by this result.

A separately authorized fresh initial goal and follow-up were sent through the
ordinary UI. The agent chose a document; a human edit was saved through its
editor. The exact-target follow-up produced a pending revision of that same
canonical document, not a substitute view. The operator inspected and explicitly
accepted the proposal through trusted UI controls under Andrew's synthetic-test
authorization. Home → Conversations → work, fresh browser contexts at
1440/390/320px, and API/web service restart preserved the accepted body and the
complete human-edited block, including its line break. No proposal was accepted
in the older evidence and no broader acceptance is implied.

- Conversation: `cf457e1d-0590-4dea-9287-279413eefa9c`.
- Work: `54f1ff77-d3c1-43f1-8416-69338e415089`.
- Accepted proposal: `aced3518-25c1-4cd7-a152-efa2c56ab2b7`.
- Accepted revision: `cd06942f-1a32-409a-b186-13900632970c`.
- Accepted body hash: `aae632c58fe85550e12acb53419254dece7c841d5d1fb4026792a2775f71a41a`.

The content is a conditional plan, not a verified event: replacement-guide and
access decisions remain open. Both model runs retain `partial/needs_validation`;
accepting an editable revision does not certify the overall goal complete.

Review UI: **http://127.0.0.1:3166**, API 8166, host loopback only. Services were
restarted and checked; the model consumer is stopped. This is not public hosting
or deployment. The two authorized live runs are consumed; no replacement turn
or further paid generation is authorized by this closeout. Cumulative reserved
cost is **$5.93640/$20**, including **$3.42992** carry, not provider billing.
The historical count-only unknown remains unresolved. No counters were reset.

Use `scripts/verify_native_admission.py` against the intended production build
before a live review. A disabled-build negative control is rejected before
message admission; the enabled-build positive control verifies exact target,
complete saved body and canonical context hash with zero provider attempts.
Build with `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1` **during `next build`**;
setting it only on `next start` is not sufficient. Use a new output directory/
disposable DB for each preflight. No model transport or dispatcher is started.

Historical full gates (792 backend/170 frontend) remain scoped to unchanged app
code. New focused admission checks and exact-head CI are separate evidence.
Current review/evidence is published on `hermes/flexible-work-13-evidence` in
`handoffs/backend/NATIVE_CONTINUATION_RESULTS.md`; prior evidence is retained.
Default-branch merge and deployment remain unauthorized. #13 stays open for
broader requirements and Andrew's product/experience judgment.

## Historical flexible-work candidate (#13)

The material below is historical, not the current budget or review environment.

The current integration branch is `hermes/flexible-work-13`. It combines the
additive backend/contracts (`f2b747a`, bridge follow-up `fffb69b`), retained
live-model proof (`a48c6d5`) and Claude’s structured renderer/custom-view adapter
(`878b6b867c3173e428d3744d8c53da92506b9152`). Historical checkpoint sections below
retain their original evidence scope; they no longer describe #13 as unimplemented.

Delivered candidate capabilities: `structured-table/v1` with stable typed fields,
units and edit rules; `custom-view/v1` with durable HTML/CSS/JS, readable fallback,
exact same-conversation bindings and named read-only actions. Historical invoice
`table` bodies are not reinterpreted. The existing save/propose/accept/history
lifecycle remains canonical. Generated source runs only in the opaque no-network
sandbox; the trusted shell owns unverified status and permission/action failures.
Shape-only drafts cannot satisfy human CSV/Wasm acceptance checks: incompatible
selections are rejected and follow the existing continuation/step-limit path.
No SQL acceptance gate or historical migration is weakened.

[Contract](../handoffs/backend/FLEXIBLE_VIEW_CONTRACT.md),
[live evidence and limits](../handoffs/backend/FLEXIBLE_LIVE_PROOF.md), and
[frontend handoff](../handoffs/frontend/FLEXIBLE_WORK_FRONTEND.md) distinguish live
model output, independent bounded checks and controlled engineering fixtures.
Actual rainwater and venue goals, human-price-obstacle adaptation, restart and
scoped-view proof are retained. They are not universal verification or Andrew’s
usefulness/experience acceptance. Static derived assessments can diverge from
changed local filter criteria; those claims remain draft data.

Exact combined gates/review are required before #13 can close. Until their
published verdict, this is an integrated candidate, not accepted delivery.
Backend full-suite evidence at `a48c6d5` is 768 passed; never relabel it as the
post-fix/combined gate. Run `scripts/verify_flexible_integration.py` on a new env
for the real controlled-consumer production-UI lifecycle and process restart.
One cumulative $20 budget remains: latest retained reserve $4.48528 includes
$3.42992 historical carry; reservations are not billing. No additional provider
calls are needed to integrate/replay these saved outputs. Preserve saved review
state. Default merge/deployment remain unauthorized; #10/#11 and broader M4/M5
remain sequenced, undelivered work.

## Historical: Verified bounded checkpoint

Runtime implementation **0e8112795e09f83a8c393571bfc994c4d603b7c4** is published
on PR #12, `hermes/adaptive-product-integration`. Integrated application
**65e84c673aedd6e4154471f4062349d7b3e014cf** adds Claude's **ea4e29d** generic-table
correction while preserving Hermes's verified-proposal/download changes.
Backend, runtime and generated contracts are unchanged between those SHAs.
PR #9 remains the owner coordination/history entrypoint, not the candidate branch.

[Executed checkpoint](../handoffs/backend/ADAPTIVE_COMPLETION_CHECKPOINT.md)
and its sanitized evidence distinguish original runtime execution from later
read-only closeout and integrated frontend checks. Full backend: **752 passed**.
Combined frontend: **145 tests** plus type/lint/format; **23 fixture DOM cases**;
**3 scoped-proposal-readback regressions**; contracts and production build passed.

Two actual browser/model goals produced independently checked six-row CSV work
and a tool checked over all 1,891 supported integer pairs. A deliberately broken
saved tool returned 0; the model changed the code and proposed the correct result.
The unfinished run was interrupted with SIGKILL and recovered through the same
retained response identity. One result/proposal, no additional send/dispatch,
saved human note/current revision unchanged, explicit approval still pending.

Run 06's post-recovery HTTP 404 was a **harness endpoint defect**, not a failed
application resume. The failed evidence remains retained. Correct artifact-scoped
readback and actual downloads passed. The downtime unsaved draft survived phone
switching/reload before worker restart; persistence after the original browser
closed is **not** claimed. Saved-note preservation is verified after recovery.

## Historical: Review environments and workers

- Integrated UI/API: **http://127.0.0.1:3140**, API 8140, same isolated milestone state.
- Original `0e81127`: http://127.0.0.1:3130, API 8130, preserved.
- Existing continuous consumer uses the original hash-pinned backend/grant and
  durable state. It was restored after full ledger/terminal-state reconciliation;
  subsequent read-only checks did not create provider or product effects.
- Historical 3000/8000 and 3120/8120 environments/databases are preserved.

These are host-local development review processes, not production deployment.
Do not reset the saved review database, accept the proposal or replace its human
revision merely to rerun proof. Process readiness is checked independently of
these durable documentation claims.

## Historical: Limits and next work

Completion is deliberately narrow: full recognized request, exact input/result
bindings, independent finite oracle. Unsupported phrases/obligations retain
partial/needs-validation. Verification never equals human approval. Finite tool
reverification may hold publication locks for up to 15 seconds; it is not an
unbounded scheduler or general autonomous worker platform.

**Issue #13 remains OPEN.** Generic frontend tables are integrated, but backend
flexible creation and sandboxed generated HTML/CSS/scoped JavaScript are not
implemented by this checkpoint. [Owner contract and next slice](../handoffs/backend/FLEXIBLE_WORK_OWNER_CONTRACT.md)
accept Claude's structured-work direction with Andrew's generated-HTML addition.
Hermes owns durable contracts/runtime/actions/evidence; the existing Claude owner
owns rendering/interaction/isolation. Exact new generated DTOs and Claude's wire
ACK are next, not claimed delivered. Memory/learning #10 and portability #11 stay
sequenced work, not prerequisites for this proof. Broader M4/M5 remain undelivered.

Claude resumed and published ea4e29d; the old local-CLI-authentication blocker is
superseded. No login action is requested from Andrew for this owner coordination.

## Historical: Authority and one cumulative budget

Routine development, fixes, tests, publication and compatible non-default
integration remain authorized. Reasonable bounded synthetic testing uses the
recorded official `gpt-6.1-sol` route within **one cumulative $20**, no calendar
expiry. The initial four-turn/eight-generation checkpoint is not a project-wide stop.

Readback before/after recovery: **$3.42992 reserved**, including **$2.63840** retained
historical carry. Six provider sends/dispatches remained six. One stored-response
read completed the retained final result; reported current-slice usage became
known without refunding reservations. Historical unknown liabilities remain.
Reservations are not confirmed billing; read the ledger before further execution.

Default controlled startup strips model keys. Uncertain sends must never be
regenerated automatically. New paid routes, broader private data, external business
actions, default merge and deployment remain outside authority. See
[authorization](GENERAL_MODEL_AUTHORIZATION.md); no new routine permission gate.
