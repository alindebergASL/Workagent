# Current runtime status and execution boundary

## Verified bounded checkpoint

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

## Review environments and workers

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

## Limits and next work

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

## Authority and one cumulative budget

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
