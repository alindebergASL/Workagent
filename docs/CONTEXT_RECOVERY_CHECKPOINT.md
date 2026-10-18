# Scoped saved-work and continuation context increment

Base: `7032da5` on `hermes/context-recovery`. Backend only; no service, installed
DB, installed grant, provider/model, web, or external-effect changes.

## Delivered

- Sustained selection can page saved-work descriptors beyond the first-12 prompt
  snapshot, read an exact current revision, and propose—not accept—an edit.
- Human discovery stays in the current conversation and honors an explicit target.
  Background discovery/read/edit stays inside exact responsibility dependencies.
  Additional conversation recall permissions are not inferred or expanded.
- Migration 035 recomputes discovery pages, validates retained selection receipts,
  enforces target scope, and rechecks consumed revisions at publication. Python
  rechecks consumed reads on subsequent context materialization as well.
- Background context carries the saved plan, exact recorded human request when
  available, latest human steering, exact dependencies, and bounded own prior
  outcomes/result references. Missing requests and omitted history are explicit.
- A later event/check-in no longer replaces an executable maintained next action
  with generic review text. Human waits, pause/cancel, fences and evidence review
  continue to apply.

## Verification (synthetic transport, restricted PostgreSQL runtime role)

Only newly created disposable `workagent_test_context_recovery_7032da5` was used.
Final migration was applied from a fresh database. Four end-to-end regressions
passed together; the fifth recorded-request test passed after correcting its
synthetic provider to supply the subsequent reply. The five cover:

1. Thirteenth saved artifact discovery, full read, human-note-preserving proposal,
   and duplicate-free worker restart (including a conversation beyond eight turns).
2. Background dependency discovery/read/proposed revision, receipt-backed plan
   update, scheduled later continuation, prior proposal reference and next action.
3. Direct SQL rejection of forged pages, receipts, envelopes and foreign scope.
4. Rejection after a human revision changes a discovered target.
5. Original recorded instructions surviving a newer human message.

Existing `test_followthrough_schedules_checkin_and_restart_not_human_review`
passed separately. A broader serial run was interrupted to return the bounded
increment promptly: **16 passed, 3 failed** before interruption. Retained failures:

- `test_large_work_rechecks_authority_and_revision[before_publication-membership]`
- `test_large_work_rechecks_authority_and_revision[before_publication-grant]`
- `test_read_limit_is_explicit_not_truncated_or_editable`

These assert completion/fault arrival in one worker visit; observed failures were
no exception yet and `running` rather than `ready`. They were not repaired or
independently classified as pre-existing. Do not treat the broad suite as green.

## Integration boundaries and remaining work

Migration 035 and fresh consumer/instruction/selection-schema pins are required
for the changed sustained capability. Legacy non-sustained alpha policy/schema
remain unchanged. All changed runtime modules were already in `consumer_hash`.
Historical sustained grants with old exact pins require the existing explicit
successor/reconciliation process; this increment does not rewrite authority.

Pages are bounded to 12 descriptors, reads to the existing aggregate 32768 bytes,
prior-result context to four recent own messages / 12000 JSON bytes. Binary file
retrieval, arbitrary cross-conversation search, and access to unselected private
work are not added. Prior result references outside current dependencies remain
provenance, not new read/edit permission. Manual delegation without a retained
recording request exposes its saved goal/criteria and current human steering,
not an invented original request. Live model usefulness, full regression results,
integration review and the installed ordinary journey remain parent-owned.
