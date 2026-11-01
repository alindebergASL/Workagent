# Future dependent-transition independent review

**PASS — the finite F3 consumer gap is closed at the exact source/test bytes below. No required implementation change found.** Base: `594334097bdc66dc97684356cbf258b2785d153b`. This is a narrow engineering verdict, not full-product acceptance, C/D release, installed deployment or a new study result.

The new `admit_transition` performs an actual ordinary dependent admission. It no longer stops at the previously accepted standalone review validator. Both frozen campaigns remain separate; this review neither asks for their integration/replay nor claims a future campaign has executed this entrypoint.

## Implementation findings

- **Atomic current checks and admission:** `evaluation/post_freeze_transition.py:87–109` acquires the ordinary workspace write lock before checking review receipts/current saved work, recollecting the source packet, calling ordinary `Service.post_message`, and retaining the transition evidence. `_TransactionDatabase` at45–54 borrows that same connection for nested ordinary Service calls; it neither commits nor opens an independent connection. Exceptions propagate to the outer transaction. Ordinary workspace-serialized human edits therefore cannot intervene between validation and admission. Existing membership/source authorization and ordinary admission checks remain in force; no raw-body or authority substitution is introduced.
- **Exact saved input and scope:** lines57–76 require nonempty explicit review receipts, the accepted current proposal/revision gate, exact target equality, same conversation for both artifact and source run, ordinary authorized reads and protected text. The attached input is the canonical JSON of the actual current saved body, explicitly named prior work. The separate `ExactTarget` binds artifact/revision/body hash. Optional changed input remains ordinary bounded attachment data; no invented successor output, rendering substitution or oracle injection is introduced.
- **Actual operational review remains explicit:** this consumer does not accept proposals. Ordinary acknowledged accept or justified retain-current happens first through the accepted helper. Pending/missing/stale/foreign/withdrawn receipts cannot obtain a valid gate result; the gate's all-supplied-key completeness check is reused unchanged. Removal/older-proposal acknowledgements and protected text are not supplied silently. An already committed explicit review remains durable if subsequent admission fails.
- **Payload tamper, command collisions and retries:** the derived post command ID is stable for a transition command ID. `Service._command` binds principal/workspace/operation/path and the complete ordinary payload, while the second command receipt binds the full Transition (including receipts, source run, kind, protected text and changed inputs). A changed post payload conflicts at the post ledger; a changed transition-only field conflicts at the evidence ledger. Any newly performed admission before the latter conflict rolls back in the same outer transaction. Standard request_id exclusion is unchanged. Retry rechecks current review/material/access, uses ordinary post idempotency, and returns the original durable transition packet rather than replacing it with later recollection. This collision analysis reuses the inspected ordinary command-ledger implementation; no separate adversarial PG collision test was run by the reviewer.
- **Truthful output and effect boundary:** the source packet is recollected after review and remains partial/unscored when the source run is partial. Packet/hash, exact saved-input hash, decision receipts and actual queued admission are durably retained together. Scripted review is not human effort. The entrypoint queues a run only: it does not claim, dispatch or invoke a provider, release unknown history, enlarge authority, or override normal worker/accounting guards. The tests establish duplicate-admission prevention and zero dependent provider/tool attempts; they do not demonstrate paid model no-resend behavior or usefulness of a newly executed successor.

The path intentionally targets reviewed saved work in its existing conversation. It is not cross-conversation target relaxation or a universal product gate. Future orchestration must choose this executable entrypoint for this method; unrelated ordinary work is unchanged. Prior F1/F2, packing/partial collection, R1/R3 and frozen-study evidence are reused only at their already accepted scopes.

## Tests and actual evidence

**Independent offline execution:**

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend:evaluation \
  env -u DATABASE_URL -u WORKAGENT_TEST_DATABASE -u WORKAGENT_TEST_ADMIN_DATABASE \
  backend/.venv/bin/python -m pytest -q -p no:cacheprovider \
  backend/tests/test_post_freeze_transition.py
```

Result: **10 passed in0.84s**. The same environment and flags with `backend/tests/test_post_freeze_transition_snapshot.py` produced **1 passed in5.41s**, one existing Starlette deprecation warning. These are11 distinct offline cases, run separately by the reviewer; no PG connection was made. Consumer doubles are not PG authority proof. The snapshot regression executes the real workspace join predicates against in-memory SQLite, adapting only JSON projection/cast and placeholders.

**Parent actual restricted-PG result:** `parent-pg-02.log` completed during this review: **14 passed, 1 existing deprecation warning, 50.71s**. Inspected all final test assertions. Scope: two acknowledged-accept/retain-current actual admission cases with exact target and saved/changed attachment bytes, immutable command receipt and Service/DB recreation idempotency; eight no-admission denial cases; truthful partial recollection; actual producer-source withdrawal while human work stays readable; current provider revocation; and an injected evidence-retention failure after a real queued admission proving full transaction rollback. The newly queued dependent run is not executed. Service recreation is tested; no OS-process crash or paid/browser outcome is inferred.

The first parent run remains **13 failed / 1 passed, 41.46s**. Its snapshot SQL incorrectly assumed `responses_steps.workspace_id`; this is not relabeled as an all-green run. The final test-only fix joins steps through provider_attempts and the owning workspace/run while retaining complete step rows. tool_attempts keeps its actual direct workspace predicate. All13 snapshot table sets remain. Independently compared the final PG test AST to its preserved preimage: everything outside `snapshot` is identical. The extra SQLite scope regression preserves two-workspace isolation and empty-scope behavior. The writer's final additive handoff was present before these test bytes were bound; the original report/manifest/failure remain untouched.

The original manifest plus additive snapshot-fix manifest bind all four final files; unchanged helper/Service/DB/conversation dependencies match. The production entrypoint stayed byte-identical across inspection and the test-only fix. No additional production/runtime/migration/catalog change was declared or observed in this increment. Preexisting STATUS/authority/fresh72 helper/lock dirt is excluded.

## Exact final files

| File | SHA256 |
|---|---|
| `backend/tests/test_post_freeze_transition.py` | `655dff753cc6a5adca1f63c15e6f6e2b73d12bcc03540d876bf2b22c16f8abb5` |
| `backend/tests/test_post_freeze_transition_pg.py` | `52511fcd45274c3ca1e466ec6d498adbe8f3fae113c04bbeff3a6dc7f34c6229` |
| `evaluation/post_freeze_transition.py` | `02e7f659214b6668d6c98434f1a17a8d2de9b9a856989b82b0d5c03f100ea097` |
| `backend/tests/test_post_freeze_transition_snapshot.py` | `2b0621faabd0ee5f066dcd2304c3f21c72c44133a205f085640e894496ebe7a1` |

Unchanged dependency bindings inspected/reused:

- `backend/workagent/conversations.py`: `0f3feceab0af0fa07db4f5f59fd6f012864257d6435c7e31d54749ee0802f0b9`
- `backend/workagent/db.py`: `a575b245e8a4bff117979efe861d96e65f665ba93f0128426969869f1d17da34`
- `backend/workagent/service.py`: `5a34a7105f2eaa2c2ac15c2921c8aa11400f38b17351a1734418823129c79dfe`
- `evaluation/post_freeze_packets.py`: `3ecd4971ef65249cc4be3c1d946f6949062213adeb953cff56da5f293e1e7fcd`

Evidence bindings:

- `MANIFEST.json`: `9b80b68db8ee27dbdf43db11ddbeaf23087322361f1bb494575d112c6feabad7`
- `MANIFEST_SNAPSHOT_FIX.json`: `09ef78e9dd55422f100e656f74fb3e30cf68094d53ff0536df896d977fdc600e`
- `WRITER_REPORT.md`: `e7c1498e2a618432670bc70e04eb653aa736415bcb978a3a3463f6f9a10378be`
- `WRITER_SNAPSHOT_FIX_REPORT.md`: `eb7983e6d6ab6d983e91b8c642c56ada2f9b6770c885763ede4567987fd53a7d`
- `parent-pg-01.log`: `a2d798b4ea642f3b72ad34e0ef5eafbc65aa270df377c458db8a7d8e61c98004`
- `parent-pg-02.log`: `de51995043ed2b90cc190717fd1b42c8dbc80b8ade75e09a8f8bf171c6378a4c`
- `snapshot-fix-offline.log`: `830ae88cab38197446e9e2a43a27c378f79658400776f52942a9f7cbc399cb9c`

Only this report was written by the reviewer. No source/evidence rewrite, PG execution, original DB mutation, provider/paid call, funding change, commit/push, process intervention or new reviewer/task graph occurred. Parent owns final byte verification/readback/publication and the same-card acceptance disposition. Existing175 TOTAL authority and the full-product/C-D gate are unchanged. Development/review model GPT-6 Astra; tool costs remain outside the product ledger and unreconciled.
