# B3.1b remaining historical-revision correction — PASS

## Scope and verdict

**PASS: the sole remaining P1 in `correction-review.md` is resolved.** This is the final narrow verification within that same correction review, not a new broad audit or product-acceptance declaration.

Compared the actual two changed files against the SHA256-bound prior `reviewed-source.json`, and inspected the unchanged screen clearing path and per-revision server authorization context. Programmatic comparison of all 18 manifest entries found exactly the requested two files changed; the other 16 match their prior hashes. This comparison is evidence reuse, not a fresh broad source review.

## Exact repair and regression

- `backend/workagent/tui/memory.py:98–106` builds fresh authorized revision IDs and all retained revision IDs. Missing **any** retained history revision now clears `selected` and returns `False`, even when the inspected current revision remains authorized. The explicit inspected-current and forgotten checks remain.
- The unchanged `memory_screen.py:112–115` handles that false result by calling `clear_payload()`. Lines 178–188 clear controller selection, visible content/details/usage, correction metadata, scope selection and summary. Thus the formerly retained historical text is removed from both controller and visible details. This screen conclusion is source inspection, not a newly executed Textual/PTY journey.
- Success does not assign the fresh inspection to `selected`; the original inspected CAS base remains. The existing success screen path does not reload the form, preserving unsent typing. Bounded list absence remains non-authoritative because authorization still uses the exact item endpoint.
- `backend/tests/test_memory_recovery.py:52–91` adds `history_denied`: the initial inspection includes a historical payload, while refresh returns the same authorized current revision without that history. Existing assertions require selection and visible content/details/usage/subject to clear. The unchanged `MemoryHTTP` fixture returns fresh deep copies, so this is not an accidental shared-object deletion. The temporary-exception regression and existing denial/forgotten/page-absence cases are unchanged.

The controller baseline was read from `backend-fixes.tar.gz` and matched its prior manifest SHA256. For the test, reversing only the displayed new parameter and fixture block reconstructed the prior manifest SHA256 exactly; the resulting diff contains no other changes.

## Independently executed lightweight checks

Executed the actual `MemoryController` class AST from both hash-verified prior source and current source with a synthetic in-memory transport, without product imports, database, network or test-suite execution. Assertions passed; command exit 0:

```json
{"case":"history_denied","source":"prior","returned":true,"revoked_payload_retained":true}
{"case":"history_denied","source":"fixed","returned":false,"revoked_payload_retained":false}
{"case":"authorized_new_current","selection_identity_preserved":true,"prepared_CAS":"task-r2","fresh_current":"task-r3"}
```

The success probe used a newer current revision while retaining authorization for every previously inspected revision, then called actual `prepare('correct', ...)` to verify the original expected revision. This independently reproduces the specific old controller failure and verifies the repaired behavior. The parent's reported RED Textual regression and `remote36test` execution are **not** claimed as reviewer-run tests; no backend/web suites, browser or PTY journeys were rerun here.

## Prior four resolved findings remain unaffected

The prior dispositions are carried forward, not re-audited:

| Finding | Why unaffected by this repair |
|---|---|
| 1. Forget receipt with pending/failed readback | Web receipt notification, purge, fencing and masking files are byte-identical to the reviewed manifest; the native change does not enter those paths. |
| 3. Review of temporary correction | Review implementation, migration, models and retrieval/correction sources are byte-identical; the exception regression in the changed test file is untouched. |
| 4. Web correction CAS | Panel and contract sources are byte-identical. Native success additionally demonstrably retains its original inspected CAS. |
| 5. Newer typing erased by success | Web submit locking and identity-guarded cleanup sources are byte-identical; this native change only adds the previously required authorization-loss clearing condition, not a success-form rewrite. |

No remaining concrete issue found in this bounded correction.

## SHA256 bindings

Paths are relative to `/home/ubuntu/workagent-continuation-20261026`.

| Artifact | SHA256 |
|---|---|
| `.local/batch3/b31b/recovery/correction-review.md` | `a8b2c19c6ae59977f4fe28cb1f446c000acee18d394df74926af8abbbcc863e3` |
| `.local/batch3/b31b/recovery/reviewed-source.json` | `59f1894d4d5af8d10a9794b3daf037d9f75e7acc9cab93ca4f02e1a064b107a3` |
| Prior `backend/workagent/tui/memory.py` | `4163f71b007c32167846cdba0f3ae77d95ec68d78cbb97b72491a684b2e980da` |
| Current `backend/workagent/tui/memory.py` | `d9ead16a14ef5ad0afc2746a69e8f7acbcc41ca1e482b7f126740af0dc698d4f` |
| Prior `backend/tests/test_memory_recovery.py` | `1ecc406a7613bc8f30254a9f334c5248332e4a7c8bcf026dae3631eccc55fd59` |
| Current `backend/tests/test_memory_recovery.py` | `6ec5d568530f0631cf6f76ef924a798cc679654975aa0ba393d683d2cea1ddf1` |
| Unchanged `backend/workagent/tui/memory_screen.py` | `255cd44835be4cbdbca618f81e1984e16c471cc70fddf2f2e5f870d30025336f` |
| Unchanged `backend/workagent/memory/store.py` | `0a95b5d42eacfed54edd91ddd1826dcfd63c9054df88ec0004c7eccb23fa6c24` |

All other current source bindings are inherited unchanged from the manifest bound above. Only this report was created. No product/board edits, external calls, other agents or heavy tests. An initial read-batching helper was blocked by unattended-tool policy; ordinary read tools and bounded terminal checks completed the review without changing that policy.
