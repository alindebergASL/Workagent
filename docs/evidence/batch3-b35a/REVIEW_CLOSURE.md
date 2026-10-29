# B3.5a — narrow F1–F4 closure assessment

**Disposition: the four reported defects have targeted implementation fixes; retained execution closes the original file/reply/proposal/forget reproductions, but the additional verification gaps below remain. This is not overall B3.5a acceptance or a full-suite pass.**

Reviewed only F1–F4 from [REVIEW_INITIAL.md](REVIEW_INITIAL.md), the changed fixes and necessary callers/tests. Working tree: `hermes/b2-conversational-client`, HEAD `46ec6a3da3178a41a98c949d36d1d0d995d635bf`; fixes are working-tree changes, not identified by HEAD alone. Current hashes were captured at `2026-10-29T14:13:52Z`.

## Evidence boundary

This reviewer inspected source and parsed existing JUnit results; **no behavioral tests were executed by this reviewer**. No new database, service, provider call, source edit, board mutation, staging or commit. Only this report was created. No installed-data or paid-model behavior is inferred from synthetic fixtures.

Retained results under `.local/batch3/b35a/`:

| Result | Observed result | Use here |
|---|---|---|
| `closure-02.xml` | 21 tests, no failures/errors/skips | Original reply/file/proposal closure tests, exact failing F1 file-worker regression, restore and GitHub checks |
| `matrix-02.xml` | 257 passed, 1 failed, no errors/skips | Relevant compute/GitHub tests; **not** an all-green matrix |
| `http-fix-03.xml` | 2 passed, no failures/errors/skips | Corrected HTTP fixture rerun; does not rewrite matrix history |
| `connectors-01.xml` | 46 passed, no failures/errors/skips | Supporting connector evidence only; not a substitute for the missing metadata-only SQL probes |

These runs overlap and are not additive. The matrix failure is `test_parent_tcp_remember_review_race_forget_restart`: the old procedure fixture lacked the required observed evidence. Current test source supplies `evidence(...)`/`details(...)`; its separate two-test rerun passes.

**Execution gap:** `closure-03.xml` was absent at the single result inspection. The supplied context described that run as running; this reviewer did not poll or wait, and makes no outcome claim. Current closure tests add correction/revocation, fresh-Service reads, restricted-SQL stale-file replay and tool-evidence exclusion beyond the four older closure cases in `closure-02.xml`. The older XML cannot establish those added assertions. Parent must verify the eventual result against the executed source; another broad audit or reviewer ceremony is not required.

## F1 — missing `principal.kind` breaks ordinary adapters

**Implementation addressed; original file regression tested; office/quarantine identity coverage remains inspected-only.**

- `service.py::_scope` now uses `getattr(p, 'kind', 'worker')`. Existing file/compute/office `SimpleNamespace(id=...)` callers no longer raise `AttributeError`; an unclassified caller is conservatively a worker, not a human. The restore marker still rejects its writes with `action_unresolved`.
- `closure-02.xml` passes the exact original `test_opted_in_file_schema_real_worker_stage_and_checkpoint[False]`, plus its restart/before-stage/human-edit variants. The test checks actual file bytes, an `observed` receipt, checkpoint, and no duplicate provider calls.
- `matrix-02.xml` passes `test_compute_gateway_pg::test_calculation_independent_oracle_download_restart_and_replay` and the other compute gateway cases. Its source invokes the real broker/compute adapter, checks successful output and independent arithmetic, downloads and replay; this exercises the formerly failing `_scope` caller.
- Retained restore evidence covers human correction/forget and refused new conversation execution. Current restore test source additionally checks retained human-file bytes and withheld generated conversation content, but has changed since the older unparameterized XML case.
- **Remaining narrow evidence:** no actual office-adapter invocation result was found in the inspected batches. DOCX ingestion is not office export. No direct restored-fixture assertion using each missing-kind adapter identity was found; the shared guard is inspected, not separately exercised for those callers. Historical unknown receipts are not reclassified by this fix or report.

## F2 — dropped metadata-source SQL fence

**Implementation addressed; metadata-only direct assertion awaits current execution evidence; stronger SQL probes remain absent.**

- `072_memory_review_closure.sql:7–20` restores the `run_contexts.research_source_ids` condition inside the same recursive retained-read graph as memory and tool visibility. It composes all three checks instead of retaining migration 070's older subset. Migration 070 alone is still insufficient; this assessment requires 072.
- Existing count/dispatch trigger (`060:40–50`) and publication wrapper (`063:124–130`) call the repaired predicate. Their continued enforcement is source-inspected.
- The retained GitHub metadata test passes in older results, but those results do **not** prove its newly added direct restricted-role `research_run_dependencies_visible = false` assertion (`test_github_pg.py:224–225`). That exact addition needs the current result.
- The retained `test_retained_read_result_transitively_fenced_after_repository_reduction` passes in the matrix and directly queries the SQL predicate. Its originating run has a GitHub tool attempt; it is **not** a metadata-only ancestor isolation test.
- **Remaining narrow evidence:** a metadata-only ancestor followed through a retained reader, plus valid restricted-role count/dispatch/publication insertion attempts demonstrating this fence rather than a separate earlier guard. No successful unauthorized send is alleged; the original defect was the permissive SQL predicate.

## F3 — explanation and pending-proposal readback leaks

**Original reproduced leaks addressed and covered by retained tests; expanded routes/mutations only partly evidenced.**

- `products.py::turn_state` returns a payload-free unavailable state before explanation, retained-local or adaptive/tool projections when producer dependencies fail. Immutable accounting is not deleted. `get_product_observation` separately checks its producer.
- `_proposal`, proposal filtering **before pagination**, and latest-candidate selection consult `memory_proposal_visible`. That predicate includes product observations, explicit producer IDs and legacy file-patch observation provenance. Proposal acceptance and supported proposal downloads use `_proposal`; exact-ID observation reads have their own gate.
- Older closure cases pass for absence of the forgotten reply/explanation canary from complete serialized conversation/list DTOs while retaining the historical response event, and for pending-proposal removal/refused acceptance with the human original preserved.
- Current proposal regression adds correction and source revocation, a fresh Service instance, full-conversation canary exclusion and refused acceptance. Those additions await `closure-03` verification. Fresh Service construction is not a process restart.
- **Remaining narrow evidence:** exact-ID product-observation read, a supported proposal-body download, and pagination/latest-candidate metadata assertions after invalidation are source-inspected but not directly exercised by these closure tests. The successful file-export denial in F4 is not a proposal-download test. No explicit human recovery of a stale pending proposal is introduced; normal acceptance is refused, while already human-authored/accepted revisions are not erased by these producer checks.

## F4 — generated-file provenance and file-mediated re-learning

**Original generated-file/forget hole addressed and covered without the F1 shim; broader mutation/SQL/procedure assertions await evidence.**

- File creation and patch proposals carry `producer_run_id`. Migration 072 combines explicit IDs with product observations and a legacy `files.create_draft` attempt-ID derivation, without rewriting old revisions. The legacy derivation applies to worker revisions, not independent human revisions.
- `_file_version` reaches the gated `_revision`; file lists and revision history filter before paging. Export downloads reauthorize file/revision inputs and, where present, the tool attempt's producer run before reading bytes.
- The SQL file-source dependency branch now calls `memory_revision_visible`; Python create/inspect/recall and procedure rollback reuse the same file checks. `memory_parent_edges` carries file/tool-evidence producer memory manifests into recursive forgetting, including historical references.
- Procedure discovery and authorization share the amended evidence predicate, which now checks the tool producer's run, not just its direct tool inputs. This is source-inspected for promotion/rollback as well as discovery.
- Older closure results pass generated-file → derived-memory forgetting, stale file/export denial and preserved human-edit variants with ordinary unshimmed file creation.
- Current six file cases cover forget/correct/source-revoke with and without a preserved human edit; they assert fresh-Service denial, restricted `write_memory_revision` rejection, tool-observation exclusion and exact preserved human text/hash-reference reads. **They are inspected, not claimed passed from the older two parameter IDs.**
- **Remaining narrow evidence:** completed results for those additions. The procedure discovery assertion has no explicit pre-mutation positive evidence control or attempted stale-evidence promotion/rollback; those paths are inspected, not independently executed here. Legacy producer fallback likewise has no separate legacy-row regression in the reviewed closure tests. These are bounded verification gaps, not newly demonstrated exploits.

## Current source/test SHA-256s

Computed from current on-disk bytes, **not copied as a historical manifest**. Identical values where files did not change are intentional. These hashes bind this inspection, not a retrospective claim that older XML executed today's expanded tests.

```text
4bec30ad96a0f50875ee468fae4edb0e1f33b7d3c0595b2ab2dfa23de4b32dc3  backend/migrations/060_research_dependency_visibility.sql
bc934c7b1928cb532f0404a7865904b40b897299864f652769b064902b4bece9  backend/migrations/063_github_public.sql
573d4762a8f6deb899c39f97a7fab2c0f23ce6f16213e36e3e2a988b0e343d28  backend/migrations/069_memory_dependency_safety.sql
66caa3cff2c5a318463d6069c763ed4992e0a1e743ad20fe439f3582da9912c3  backend/migrations/070_memory_output_visibility.sql
6c300e499a5d633b76ef7d0ada24c17d1f4b8840365e0c1f98c568697d7c5298  backend/migrations/071_memory_erasure_receipt.sql
1f10e11ed2434e5ef893d72526585a7a156591329f232c097fdbc362e27a1dbd  backend/migrations/072_memory_review_closure.sql
0b61a428308b726f3b4bc0340165d684340cfea51900f05ae75387f27e8f1869  backend/workagent/service.py
6586fe3965f861eb04a09c348c2ba9e17d72b4058658fee6d20c74583fcaf6be  backend/workagent/products.py
a8d0f1d9f09769635c3e9bd453815cea12216823af7dbeb573b039afe609a212  backend/workagent/conversations.py
d021494f2c7c2326c4555692def410340c6274662c55af772f160b8c2f4fb600  backend/workagent/artifact_exports.py
5384ab867584910916ecc4f5fe4722ded7c12c11b49ced0c0c7cfd064d056b27  backend/workagent/workspace_files.py
89a2dc4f23b57adeb620f8108f279d804aed56b8f15acc1ee274bf4097b20e95  backend/workagent/capabilities/file_adapters.py
f8c727bba20dc8c6d8dc5f84822a0f220ab633954a7f7e842317455170cf4f0b  backend/workagent/capabilities/compute_adapters.py
44a46891d5b20bf6ecd7fe682a4be5616cbd1d275c8e00373d02cb357fae12bc  backend/workagent/capabilities/office_adapters.py
d2d9c91273972cb6dc88584c565d6471be9c0c1917aefc45fdaa36bf2d587e35  backend/workagent/memory/store.py
daf56e989e6ac8aa3a89c3b3dc5f544a8c4ae3a837ab3d0e118b78fb091e052c  backend/workagent/memory/procedures.py
ca5f46f4e4ca86b2d45504e318f1090f6b2f2ab655e1228b1a2f38e4f65b4b2e  backend/tests/test_memory_review_closure_pg.py
b29f4baec972355124bd46f34b530fb652bb4b4742a8e880d54168c9d8ef679f  backend/tests/test_memory_safety_pg.py
873aeee69cd0a044f901c5c5818cc56b17202a0f9b63081fb784c97445437b14  backend/tests/test_github_pg.py
0a5b872d227102ce6d5ea8b59f03ab2aef1c3f762172e2b1f766d7fa733a73b7  backend/tests/test_b30b_final_journeys.py
8758eda666daaf38f0cd3c1791ac5a25683b836a2fda0c7f10bce8ad58323dd4  backend/tests/test_compute_gateway_pg.py
eab2a21e80b7ddccb1305db7ccd9b23b2d0c95e6644f51cfbede1b241f01e0b6  backend/tests/test_memory_parent_http.py
```

Result digests:

```text
439b4e8c47091697c771dcaa95b471e929a25baa0ac8729a87652a44e6695760  .local/batch3/b35a/closure-02.xml
0e04f897dcf5490c8f5d106320d2cf7f050e87f39cc64eae33936342019570c7  .local/batch3/b35a/matrix-02.xml
b4b2974b336985346c9310235315e1f2111093d0593fe87d2d90e2646afd367b  .local/batch3/b35a/connectors-01.xml
3a5725b8837b93c121c62b1677ee871461b703cf3c1a6a8e63183838a52e5899  .local/batch3/b35a/http-fix-03.xml
```

No UI acceptance, provider usefulness, installed restore, publication, budget reconciliation or overall task acceptance is granted. The parent may finish this narrow closure from exact results and the specifically identified assertions, without replacing it with a broad campaign.
