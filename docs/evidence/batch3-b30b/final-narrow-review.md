**HOLD — two concrete web defects remain.** R1 and R2 are resolved within their reviewed scope. This is the requested narrow rereview against base `8d90e353e92a403eed521e9feea43b037997f307`, not Batch 3 acceptance.

**R3 — P1: replaying an unresolved save deletes newer human edits.**

Location: [WorkspaceFiles.tsx:513](/home/ubuntu/workagent-continuation-20261026/web/src/components/WorkspaceFiles.tsx:513), with the enabling textarea at line 643.

Reproduction:

1. Edit a saved file to “first edit”; send Save and lose its response.
2. The pending envelope remains, but the textarea is enabled because it checks only `busy`.
3. Enter “second newer human edit”.
4. Retry the same save successfully.

Replay correctly sends “first edit”, but its completion unconditionally clears the draft and replaces the editor with those older bytes. The newer text is lost.

**Reproduced using the actual transpiled component handlers with synthetic transport and in-memory storage:**

```text
after ambiguous POST: editor disabled = false pending content = first edit
before replay: safety copy = second newer human edit
after successful exact replay: sent = first edit editor = first edit safety copy = null
```

Required correction: preserve edits made after the retained envelope was prepared, or prevent editing while that envelope remains unresolved. Completion must clear only the matching draft generation.

**R4 — P1: a late create response deletes a newer unresolved create journal and draft.**

Location: [WorkspaceFiles.tsx:242](/home/ubuntu/workagent-continuation-20261026/web/src/components/WorkspaceFiles.tsx:242), including `dropDraft()` at line 244. The existing guarded alternative is [pending-command.ts:61](/home/ubuntu/workagent-continuation-20261026/web/src/lib/client/pending-command.ts:61).

Reproduction:

1. Send create A; delay its successful response.
2. Navigate away and back within the same authenticated page session, remounting the creator.
3. Replay restored A; that replay succeeds.
4. Start create B; leave B’s outcome unknown.
5. Deliver A’s original delayed response.

The old component calls `pending.set(null)` and `dropDraft()` against the shared storage keys, deleting B’s journal and text. Reload then loses B’s exact replay identity, allowing a fresh command for an effect B may already have committed.

**Reproduced using the actual transpiled creator and pending-command hook, with synthetic transport:**

```text
before old completion: pending journal = B
after old A completion: B pending journal = null B draft = null
```

Required correction: fence late completions by operation/mount identity and use matching-envelope clearing, including matching draft ownership. Authentication scope fencing does not prevent this same-scope remount race.

**R1 resolution: scoped PASS.** Conversation artifact enumeration, Home pagination, work-context artifact/proposal counts, and supporting inherited paths now filter private file aliases before limits/counts. Migration 056 adds the owner predicate while retaining ordinary artifact visibility and existing dependency checks. The two-member regression exercises restricted PostgreSQL/API access, hidden rows beyond projection limits, visible ordinary artifacts/proposals, direct denial, and the SQL predicate.

**R2 resolution: scoped PASS.** Native send persists `outcome_unknown` before transport. Only a matching first-attempt definitive rejection can become `rejected`, using `operator_journal.valid_rejection`. Explicit resolution archives the rejected envelope, refreshes conversation CAS, and preserves text and exact file base. Earlier ambiguous, mismatched, and legacy attempts remain locked after later rejection. The regression covers restart, history, reprepare, and these ambiguity cases.

The relevant R1/R2 production and test hashes match `verified-core.json`. Its five review-regression cases were not among the failures; the overall run was **116 passed / 2 failed**, not green.

**Web disposition: HOLD.** All final **13 files**—the originally excluded 11 plus the BFF route and export-download test—match the isolated web-owner checkout byte-for-byte. Generated DTO bindings, exact-version reads, byte/hash verification, BOM/newline handling, and the corrected binary BFF path for TXT/Markdown/CSV/JSON were inspected. The create ambiguity correction works within a stable mount; R3/R4 remain outside that helper’s protection.

**Subsequent backend deltas:** inspected JSON `RecursionError` conversion, file-schema request validation and ledger restoration, and the subsequently added own-file-output attribution in `workspace_files.py`/`products.py`. The latter validates settled observations and untouched worker revisions before excluding them from frozen inputs. No additional concrete production blocker was established.

Worker evidence remains incomplete:

- `resume-worker-green` actually exited **1**, with `source_changed`.
- `resume-worker-fixed` exited **1**, with observation datetime validation failure.
- `resume-worker-fixed2` reached `ready`, then exited **1** on the test’s nonexistent `tool_attempts.data` column.
- That test query is now corrected. At final read, `resume-final-core.log` contained only progress dots and no completed result.

None of those incomplete/red runs is counted as a final worker/restart pass.

**Scope and limits.** Recovered task `t_04c80dd1` from `graph-manifest.json`; retained its original substrate/basic-export acceptance scope. Reused unaffected original coverage. No source/evidence files were written, no tests/build/browser/PTY campaigns duplicated, no services or databases changed, no network/product-provider requests made, and no board transitions or reviewer dispatch occurred. The two new reproductions were pure in-memory component exercises, not browser evidence. Parent owns final integration and completion. Development-model cost is unmeasured and outside the product ledger.

**Source binding.** The original review JSON has SHA256 `6262bcc5623b43536394b3762282560a76e30ce860b5b9a4a7e49fe334a6aacd`; its `candidate.source_sha256` inventory supplies the reused hashes for **28 unchanged production files**. Correction/newly reviewed production hashes follow:

```text
b0d2c4205674845d35e8b81390f501e8f23facccb92d294c29c91499728e0472 backend/migrations/056_file_alias_visibility.sql
ef13db1f8a8d6b75b73dd5aa9d2ce8b4b6c8e2d9bdd84dacf1d09d32841a3e54 backend/workagent/conversations.py
ce78eff1c1960a695b170c47c68d4a725471529de56289e765a6d8f6d74775da backend/workagent/home_work_summary.py
b48ac94f67b9d79e764c5bf8eb27c0c91ccc8e4e892640e60fb26c1eac4d508b backend/workagent/work_areas.py
0fceff1df1a92320c31af9860690d609cbb2574e218fc480e1e6879592a392ef backend/workagent/work_context.py
81a35c88e6b073902a7749a5a842bca0e80b562c79c8f220d5d66f17f49eb16d backend/workagent/responsibility_action.py
e6fc7934631643908dc940cb687eef19b86bb9b61dcc99ce21d8ba4026974ff5 backend/workagent/run_successors.py
fbccf0de893b6acfecf18063715865175b46c694c6f59f78e7792e05268b4043 backend/workagent/tui/files.py
8743153a2c82e174f07125f32c74167b9a554baad2c85fc124b42b49b45aaa6a backend/workagent/tui/files_screen.py
6dab78c2cc1a54109a7c00ca7c1c776eff7a2b6279d73801c543080c119e8291 backend/workagent/workspace_file_models.py
a6d47fa26ea33485fe8309482fdf41eaba0dc59355c32b855925cfceec980011 backend/workagent/responses_transport.py
10764516045b587c59902887042e376f93c29cefb90d917a8d4db013c9ee348c backend/workagent/responses_ledger.py
ce49e3316f4cb982b8bf18fc0b930bb0c4ddfb91b0659cfdef850ab81f611830 backend/workagent/products.py
e24f7a9a83fded58405dba496c582eb0eaadb33728d3168b5c0d2328ff7bbd00 backend/workagent/workspace_files.py
d632958a7b10e83860b9c1e8f20d7ecb952be24ba8409a947b7c1d0bf3b1ed6a web/src/app/api/domain/[...path]/route.ts
0f4545aa9bd157ffd68b2d09d677fe59839ddaca0828bcff7cb2a786a108215e web/src/app/conversations/[id]/page.tsx
dc0b230620c0ef7b5a71aa2c9fbe0583377913614f16710e09612d83597606f0 web/src/components/ToolActivity.tsx
d6dbcd37c48f2f5e2a31b77b73affd4b65d3e03501c5c42dea899855a93ffd59 web/src/components/WorkspaceFiles.tsx
c3ca9d55eb075567f8798d6977ed82b6390276a304c6f39b0bed4e1630563e81 web/src/lib/client/workspace-files.ts
efa08e301f89e24553c64f545c533e4e7b5d4b6f6132f896f153721fa2667473 web/src/lib/file-draft.ts
94187212ad17ad38e8099da17ce932510f53b0506efcd5b59f28ab3bacca8b39 web/src/lib/files-contract.ts
97e1925718f27355dc3c7c50f15a47b3b986927a87228303e9fa72cda36c93ce web/src/lib/tool-activity.ts
138d4220be8791e0911e7d32eaa68bc832382443c4cc0e9f9bfc8e7b64c3dda1 web/src/lib/client/pending-command.ts
afa50119f6d76cafe9d7f97aa889466d6b24844bab17e70da1fd0dab8d4b1cbc web/src/lib/client/session-scope.ts
73ae0094a4f51a8f855674a7cd099b1f1fcfdd4e559d183284c1308fcd0fe31d web/src/lib/client/real-api.ts
f19c7a83928d023028d78e857e20d06921233a07ab3a21b370e19b7ea4864dc7 web/src/lib/contract/errors.ts
```

Reviewed regression sources:

```text
53ace521cb9b05ee1b070f9d08bd19da94f94f239bbadb9b7d6ae34f628e8425 backend/tests/test_b30b_review_regressions.py
c66fcbb4a06807e1bc25c62b346c4b07db627bd3e65b8744f384d41e99a5fdee backend/tests/test_b30b_final_journeys.py
```