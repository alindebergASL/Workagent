# B3.5a independent initial safety review

**Disposition: changes required; not task acceptance.** Four actionable findings below: three reproduced on unmodified source, and one provenance hole reproduced with an explicitly disclosed test-only compatibility shim for finding F1. No task transition, source edit, or commit was performed.

## Scope and execution

- Branch: `hermes/b2-conversational-client`; HEAD/base: `46ec6a3da3178a41a98c949d36d1d0d995d635bf`.
- Reviewed the changed backend safety increment and its necessary predecessor/caller code. Excluded the unrelated untracked `contracts/pnpm-lock.yaml`.
- Read AGENTS/development/model authority and product/build/status context. This review does not introduce another owner-approval gate.
- All database probes used a newly provisioned synthetic disposable database, `workagent_test_702d39faf031`, not the parent's fixture or installed/production data. Private environment is `/home/ubuntu/.hermes/cache/scratch/b35a-review.env`; credentials/DSNs are not included here.
- Provider behavior was `AlphaProvider` / controlled transport, with no paid product calls or real provider effects. Synthetic ledger amounts are not real spending or settled billing.
- Repository modification by reviewer: this report only. Temporary probe scripts/results and a disposable fixture were created outside the repository. Existing source was not patched, staged, or committed.

## Findings

### F1 — HIGH: restore guard breaks ordinary file/compute/office adapters before checking whether this is a restore

**Changed location:** `backend/workagent/service.py:85-87`.
**Affected callers:** `backend/workagent/capabilities/file_adapters.py:130`, `compute_adapters.py:149`, `office_adapters.py:47`.

`_scope(..., write=True)` now evaluates `p.kind` before checking for the restore marker. These adapters pass `SimpleNamespace(id=cap.principal_id)`, without `kind`, in ordinary databases. The result is `AttributeError`, not a legitimate authorization denial. The broker records `outcome_unknown`; normal file creation fails with `action_unresolved`. The change therefore damages working capabilities and creates misleading uncertain-effect receipts outside restore mode.

**Observed on unmodified source:**

- Direct normal-fixture `_scope(c, SimpleNamespace(id=p.id), ws, write=True)` raised `AttributeError: 'types.SimpleNamespace' object has no attribute 'kind'`.
- Existing test `backend/tests/test_b30b_final_journeys.py::test_opted_in_file_schema_real_worker_stage_and_checkpoint[False]` failed at `capabilities/broker.py:144` with `DomainError: action_unresolved`.
- The file attempt had `status=outcome_unknown`, `error.code=outcome_unknown`, and no output, despite this being a deterministic local programming error.

**Narrow closure:** use a consistent typed principal for these callers, or perform marker-aware classification that does not assume all existing callers carry `kind`. Do not default an unknown tool caller to human in a quarantined restore. Re-run the exact failing file worker test plus one real compute and one office adapter invocation on the normal fixture. On a restored fixture assert the same worker identities cannot write/send, while explicitly allowed human memory recovery still works. Preserve the historical unknown receipt; do not refund or reinterpret it to manufacture budget capacity.

### F2 — HIGH: migration 070 drops the existing research-source metadata SQL fence

**Changed location:** `backend/migrations/070_memory_output_visibility.sql:42-52`.
**Lost predecessor invariant:** `backend/migrations/063_github_public.sql:134-145`.
**Consumers:** `backend/migrations/060_research_dependency_visibility.sql:40-50` (count/send trigger), `063_github_public.sql:124-130` (publication guard), retained read checks.

The replacement `research_run_dependencies_visible` checks memory manifests and tool attempts but omits `run_contexts.data.research_source_ids`. A run can already have copied a source title/version into its first request without having a tool attempt. After repository/source reduction, the new SQL predicate returns true for that run even though the copied metadata is not visible. The same omission applies through retained-result dependencies.

**Observed on unmodified source:** the existing `test_github_pg.py::test_prior_source_title_in_prepared_prompt_cannot_survive_reduction` passes because another Python check still blocks the standard request. Querying its retained state with the restricted runtime role, however, returned:

```json
{"current_visible": true, "prior_base": true, "metadata_visible": false}
```

Here `metadata_visible` is the omitted `NOT EXISTS (... research_source_ids ... NOT research_source_visible(...))` condition from migration 063. This is a concrete SQL-layer authorization regression, not evidence that a real provider request was sent. Passing the Python-path test does not establish the restricted-SQL invariant.

**Narrow closure:** compose the new memory checks with all pre-existing research checks, including the recursive metadata-source condition; do not replace the latest wrapper with its older subset. Add direct restricted-role assertions that `research_run_dependencies_visible` is false for metadata-only runs and transitive retained readers after reduction, and that a valid next `count_send`/`dispatch`/publication insert cannot bypass that fence. Keep the existing Python test as a separate check.

### F3 — HIGH: hiding assistant messages/revisions does not hide their other public readbacks or pending proposals

**Changed locations:** `backend/workagent/conversations.py:105-109,150-169`; `backend/migrations/070_memory_output_visibility.sql:54-59`; `backend/workagent/service.py:149-153,345-364`.
**Ungated projections:** `backend/workagent/products.py:turn_state/explanation_readback`, `service.py:133-140,352-382`, and proposal-related observation/download paths.

The new message filter leaves the human message, so its run still enters `ordered` and `turn_state`. `turn_state` exposes the retained explanation without applying the new dependency check. Pending model proposals are also unaffected: `memory_revision_visible` joins `product_observations.data.revision_id`, while proposal observations have a `proposal_id` and no published revision ID. `_proposal`, proposal listing/latest-candidate selection, and their downstream projections have no equivalent run-dependency check. A human-authored base remains accessible, allowing a stale generated proposal body to be read after forgetting its memory.

**Observed on unmodified source:**

1. Complete a memory-enabled reply with `REVIEW_FORGOTTEN_REPLY_CANARY` as model explanation, forget the recalled root, then serialize the entire `get_conversation` response. The canary remains at `.turns[0].explanation.text`, although the assistant message is hidden.
2. Save a human original, create a memory-enabled model proposal containing `REVIEW_FORGOTTEN_PROPOSAL_CANARY`, forget the root, and read both proposal listing and conversation detail. Result:

```json
{
  "producer_visible_after_forget": false,
  "canary_in_proposals_after_forget": true,
  "human_original_unchanged": true,
  "canary_in_full_conversation_after_forget": true
}
```

A document-body download probe returned `unsupported_operation` because that body is not downloadable; no successful proposal-download exploit is claimed. The proposal list itself demonstrably exposes the generated text.

**Narrow closure:** gate or redact *all* generated projections using the same producer provenance, including explanation, retained local results, adaptive/tool result projections, pending proposals and their pagination/latest-candidate metadata. Preserve immutable accounting and human-authored/previously accepted work; do not delete whole conversations or human originals as a shortcut. Assert canary absence from the entire serialized DTO/API response, not only `messages`. Exercise exact-ID proposal/observation routes and supported downloads. Verify stale pending content cannot silently become a fresh accepted revision after forgetting; define any explicit human recovery behavior separately. Repeat for correction and authority loss, and with a fresh service instance.

### F4 — HIGH: tool-created files are missing from the producer graph, enabling file-mediated memory re-learning

**Changed locations:** `backend/migrations/070_memory_output_visibility.sql:54-59`, `backend/migrations/069_memory_dependency_safety.sql` (`memory_dependencies_authorized`, recursive erasure), `backend/workagent/workspace_files.py:154`, `backend/workagent/memory/store.py` file-source authorization.
**Relevant existing producer:** `backend/workagent/capabilities/file_adapters.py:invoke`; its `files.create_draft` path uses `_create_text_file`, not `_publish_product`'s `product_observations` insertion.

`memory_revision_visible` treats absence of a product observation as visible. Tool-created draft files do not have that product observation. Their creating run can become invisible after forgetting memory while the file remains listed/readable. A memory referencing that exact file version likewise survives: file-source checks validate owner/hash/revision but do not propagate the creating run's memory dependencies, and descendant erasure follows explicit memory edges rather than this file-mediated edge. This is not the intended exemption for independent human originals.

**Evidence qualification:** current new-file creation first hits F1. To isolate this independent hole without editing source, the disposable probe temporarily supplied `kind='worker'` for missing-kind principals only; normal principal objects and all dependency/visibility/erasure code were unchanged. This models the retained automated-file case and exposes what a compatibility-only F1 fix leaves behind. It is not presented as an unmodified end-to-end file-creation pass.

The memory-enabled synthetic worker then created a file; a second memory cited its exact `MemoryFile` reference; the root memory was forgotten. Results:

```json
{
  "file_probe_uses_test_only_missing_kind_shim": true,
  "file_run_has_memory_manifest": true,
  "file_product_observation_count": 0,
  "file_producer_visible_after_forget": false,
  "file_revision_visible_after_forget": true,
  "file_still_listed_after_forget": true,
  "file_canary_readable_after_forget": true,
  "file_memory_status_after_forget": "active"
}
```

**Narrow closure:** bind every automated output path to producer provenance, including tool-created files, proposals, exports and tool-observation evidence, not just `_publish_product` revisions. File-sourced memory must consult that provenance before create/inspect/recall/rollback, with appropriate transitive erasure or suppression preventing re-learning. Add root-memory → generated-file → derived-memory coverage for correction/forget/source revocation, and direct restricted-SQL writes using the stale file reference. Retest the above without the shim after F1 is fixed. Verify an independent human file and a preserved human revision remain byte-identical and available. Also assert that procedure discovery/promotion cannot reuse a tool observation from an invisible producer run; that procedure extension was inspected but not independently exploited in this review.

## Controls checked and limits of the evidence

### Descendants, cycles, scope, time and restricted roles

The explicit memory-to-memory graph has meaningful safeguards: exact current revision/hash/owner checks, edge scope containment, active/contested and temporal checks, bounded traversal, cycle detection, predecessor source authorization, and workspace-serialized mutation/erasure. Descendant collection includes retained revision/evidence history, tombstones are scope-independent suppression identities, and sensitive physical erasure helpers are not ordinary runtime writers. The following independent execution passed on the fresh fixture:

```text
backend/tests/test_memory_dependencies_pg.py
backend/tests/test_memory_safety_pg.py::test_real_backup_restore_current_tombstones_permissions_and_process_readback
18 passed, 1 warning in 32.61s
```

These tests cover explicit-memory descendant/diamond erasure, provenance loss, time/scope, restricted SQL, correction fields, bounded depth, race serialization, procedure-ancestor reauthorization, and a synthetic restore. They do not close F2-F4 or establish general usefulness. No additional concrete bypass of the explicit-memory cycle/scope/time checks was found in this review.

### Restore quarantine and authority

`backend/isolated_restore.py` restores only into a generated new disposable database; it requires a current authority database and uses a repeatable-read safety snapshot. It replays current memory revisions/tombstones for backed-up identities, intersects/restricts source access and membership, updates access generations, removes connector credential references/consumes flows, and revokes provider/tool grants. The archive restores with `--no-privileges`, then explicitly revokes existing PUBLIC function/schema access before narrowly granting runtime capabilities. Runtime login/environment delivery follows guard verification. Human memory recovery is intentionally allowed, not provider resume.

The source and the passing restore test support that narrow design. They do **not** establish installed-data restore, a live ongoing authority connection, provider-side deletion, or permission to execute against restored budgets. A repeatable-read snapshot is authority as of that snapshot: later revocations must not be implied to stream into an offline restored branch. Historical allocations/reservations/unknown outcomes remain historical evidence, not reconciled current capacity. Before any future execution-capable restore, current liabilities/authority require a separate implementation and verification; merely toggling a grant is not a safe resume procedure.

No concrete restore privilege-escalation exploit was demonstrated. Default-function ACL revocation covers objects present at restore completion, not arbitrary future migrations; that future behavior is not currently claimed. The adapter regression in F1 nevertheless affects both normal operation and correct testing of quarantine identities.

### Incomplete acceptance evidence — not additional vulnerabilities

- Broad matrix, real desktop/phone UI behavior, cross-process restart coverage across all output types, and general model usefulness remain pending parent work.
- This review did not rerun every suite or prove all cache/export/readback paths. The specific readback failures above are vulnerabilities; unexercised neighboring paths are closure requirements, not invented exploit results.
- No installed-data maintenance, production DB access, provider resume, real provider deletion, or paid model call was attempted.
- Initial probe retries included an import-path setup error, a synthetic-provider decision-list exhaustion, and an unsupported document download. They were corrected or explicitly bounded rather than reported as product evidence. The F1 regression itself was reproduced separately by an existing unmodified test.
- Approval of the B3.5a task overall is not granted. Parent can close these findings with narrow source changes and the named assertions; another reviewer/process ceremony is not required by this report.

## Reproduction artifacts (private scratch; no credentials in contents)

Run with the private disposable environment loaded and `PYTHONPATH=backend:backend/tests`, using `backend/.venv/bin/python` from the repository root. Scripts are temporary repro helpers, not shipped tests; move durable assertions into the existing test modules when fixing.

| Artifact under `/home/ubuntu/.hermes/cache/scratch/` | SHA-256 |
|---|---|
| `b35a_review_probes.py` (reply + explicitly shimmed file probe) | `90a6c8cfc848aacf63edcfa19765f092cdfa1b63f45f2d55b9364d14ee85d79b` |
| `b35a_review_probe_results.json` | `c96f9850b25cc4679801e01ec5c58172916d83be4d83de417aaf6c59a1f32875` |
| `b35a_review_proposal.py` (unmodified service path) | `8b5ed4d94ee1793698326772fb729b181249f2d446bbae2ae0b12b9193bba131` |
| `b35a_review_proposal_results.json` | `581cf6535aa2cd2ca28a585fc4ee738b14eec4258afb920fc697151b252cdc21` |

Disposable fixtures are retained for parent verification; their private environments are not evidence attachments. Scratch artifacts may expire.

## Reviewed source manifest

SHA-256 of the following literal manifest (UTF-8; one LF after each line, no blank lines): **`9268de238f012ac0c039139b4b6721a5a7e0893582b64fe61aefe7e0fe1402be`**. These hashes bind this initial review, not future corrected source or task acceptance. All fifteen changed backend source/test paths are included.

```text
c13a838dbbc42f0682e4b3cf70f19f088d35f3f8f5f3e7fcbbb8b8256fa3d7b8  backend/isolated_restore.py
573d4762a8f6deb899c39f97a7fab2c0f23ce6f16213e36e3e2a988b0e343d28  backend/migrations/069_memory_dependency_safety.sql
66caa3cff2c5a318463d6069c763ed4992e0a1e743ad20fe439f3582da9912c3  backend/migrations/070_memory_output_visibility.sql
6c300e499a5d633b76ef7d0ada24c17d1f4b8840365e0c1f98c568697d7c5298  backend/migrations/071_memory_erasure_receipt.sql
612b3f7646afe60f533ff79d5a62036f0c4a939fb4eecdfdbd07d83a40ce8408  backend/tests/test_memory_dependencies_pg.py
bf0922ec0fa7982d319215b7da72cdf0d1563205e231f7513ffdc1b97306493f  backend/tests/test_memory_safety_pg.py
a8d0f1d9f09769635c3e9bd453815cea12216823af7dbeb573b039afe609a212  backend/workagent/conversations.py
4f0b9445c9b13b1d0d7b1c9df1b4d6b8615159c7f2a3db41f15451088eeb8154  backend/workagent/memory/corrections.py
d1441cf77866383266661e50504b11f71832c7f0cd548e7b4771b3abe81180c1  backend/workagent/memory/forget.py
7fe8fc4494cf5ce5d641a3bfcf4eded8a4084d344dd150396421bad8f6e2784e  backend/workagent/memory/models.py
daf56e989e6ac8aa3a89c3b3dc5f544a8c4ae3a837ab3d0e118b78fb091e052c  backend/workagent/memory/procedures.py
bcddf23bc779e043deff9037311dea78084797bb4f4d6ae39fa75218cbf332e6  backend/workagent/memory/retrieval.py
d2d9c91273972cb6dc88584c565d6471be9c0c1917aefc45fdaa36bf2d587e35  backend/workagent/memory/store.py
f660ef769e65efdaf95799703a5b311af308f5d6913981959729b943242c2323  backend/workagent/service.py
838ce14168b34a69ef4aba99851fc43c39280914233040bcc2cea02298ab7ad1  backend/workagent/workspace_files.py
```
