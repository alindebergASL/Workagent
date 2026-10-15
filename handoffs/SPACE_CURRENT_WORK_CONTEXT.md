# Space current-work context — backend / frontend handoff

## Ready to integrate

New additive authenticated GET:

`/v1/workspaces/{workspace_id}/conversations/{conversation_id}/work-context`

Operation ID: `get_work_area_context`. Existing conversation and Space endpoints
are unchanged. The route works for ordinary conversations too; `purpose: null`
does not promote a conversation to a Space. Use existing auth/schema/request
headers. This is a derived read model, not a new store, mutation, or permission.

Canonical Python: `backend/workagent/work_area_models.py::WorkAreaContext`.
Generated TS: `components['schemas']['WorkAreaContext']` from
`contracts/src/schema.d.ts`. OpenAPI: `contracts/openapi.json`.

### Exact response fields

- `schema_version: 'work-area-context/v1'`, `provenance: 'canonical_current_work'`.
- `conversation_id`, `conversation_work_version`.
- `purpose: WorkAreaMetadata | null`: title, goal, kind, human/agent origin,
  identifying run provenance when present.
- `artifacts: WorkAreaArtifact[]`: `artifact_id`, `revision_id`,
  `revision_number`, `body_hash`, `author_id`, `author_kind`,
  `body: ProductBody | null`, `body_omitted`.
- `proposals: WorkAreaProposal[]`: `proposal_id`, `artifact_id`,
  `base_revision_id`, `base_work_version`, `body_hash`, `status`,
  `accepted_revision_id`, `base_is_current`, `stale`.
  `stale` means **pending and base revision is no longer current**; accepted
  proposals are not mislabeled stale. Proposed bodies remain on existing detail
  endpoints. No acceptance is automatic.
- `responsibilities: WorkAreaResponsibility[]`: `assignment_id`, `work_version`,
  `owner_id`, `lifecycle_sha256`, `lifecycle: ResponsibilityLifecycle | null`,
  `lifecycle_omitted`. Existing typed lifecycle carries current outcome,
  next_action, wait, state, execution_status, blocker, pending proposals, etc.
  Display execution truth separately from active/waiting lifecycle state.
- `offered_targets: ExactTarget[]`: exact artifact/revision/body-hash triples for
  fully included supported editable bodies. This is not a permission grant.
- `omissions`: numeric `artifacts`, `proposals`, `responsibilities`,
  `saved_bodies`, `lifecycles`; literal `proposal_bodies` and
  `historical_revisions` are both `'not_in_projection'`.
- `truncated: boolean`: at least one count/body/lifecycle bound was hit.

Limits: deterministic ID order; at most 12 artifacts, 20 proposals, 8 lifecycle
responsibilities. Each saved body/lifecycle is all-or-null at 8,192 UTF-8
canonical-JSON bytes; shared material budget 32,768 bytes. Counts/omission flags
are explicit. Do not interpret omitted bodies/lifecycles as absent work, invent
summaries, or use this as the complete artifact list. Fetch existing details
on demand. Projection records may include proposals for an omitted artifact.

## Runtime semantics

Human `general-responses-v1` turns use the same transaction-local projection.
The first run snapshot is retained in immutable `run_contexts` evidence. Every
selection, staging, and publication revalidates the original bounded read set
and existing grant, membership, fence, revision, hash, and editability checks.
A changed human revision or accepted proposal invalidates the run even if
conversation work_version did not move. Explicit request targets remain binding.
Alpha untargeted turns may choose only an exact offered target via the existing
`decision.target`; results stage existing proposals and never save over human work.

The initial read set does not expand after same-run creation. Own receipt-bound
responsibility recording uses existing `responsibility_action.offer` version
normalization and its state/version checks, rather than rewriting evidence or
invalidating itself. New records appear in fresh API reads and the next human
turn. Original records are still revalidated; unrelated new records are not
silently added to the model snapshot. System continuations keep their original
exact dependency scope; historical controlled runtime context is unchanged.

## Evidence / limits

All model transport evidence is **controlled fake transport**, backed by a fresh
isolated disposable local PostgreSQL DB created with `backend/dev_db.py` and
normal fixture guards. No provider calls, retained DB, live grant changes,
migrations, frontend edits, or external effects.

- `.local/space-context-red.log`: initial missing projection / inferred-target
  failures observed before implementation (2 failed).
- `.local/space-context-verified.log`: 80 passed; current-context, Spaces,
  receipt-bound responsibility actions, products, conversations.
- `.local/space-context-regression.log`: 95 passed; general Responses, alpha,
  responsibility execution/lifecycle.
- `.local/space-context-contracts.log`: generated contracts, drift checks, TS
  checks passed (`npm run generate && npm run check` in `contracts/`).

Coverage includes fresh-service reopen and human revision, API/runtime equality,
accepted/dismissed/stale proposals, lifecycle updates, bounded omissions, plain
answer/no forced Space or assignment, untargeted staged proposal, explicit-target
switch denial, cross-conversation/unoffered denial, own responsibility recording
followed by inferred proposal, duplicate delivery, exact system dependency scope,
and human-save/accept/purpose/revoke/cancel/membership changes at selection and
prepublication boundaries. Immutable request and context evidence are asserted.

An earlier overlarge combined test command timed out and exposed a compatibility
regression in historical controlled execution. Projection was limited to the
intended general Responses human runtime; both complete final test batches above
passed afterward. Do not count the interrupted log as evidence.

Engineering: focused checks pass; parent independent review still required.
Usefulness: controlled current-body follow-up / proposal behavior verified;
no live model usefulness claim. Experience: frontend integration/browser review
belongs to the existing Claude owner and is not verified here. Changed consumer
and alpha policy pins need fresh exact review/authorization before live use;
no retained grant was repinned.
