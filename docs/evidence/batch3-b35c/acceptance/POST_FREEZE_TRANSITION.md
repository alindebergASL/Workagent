# B3.5c — Executable reviewed dependent transition

## Disposition

Closes review152's finite F3 consumer gap with a separate future-only increment based on `594334097bdc66dc97684356cbf258b2785d153b`. The same independent reviewer found **PASS, no required changes** at the exact source hashes in [transition/REVIEW.md](transition/REVIEW.md). F1/F2, local-guard/partial handling and R1/R3 remain accepted at their existing scope; they were not reopened.

**This is working controlled admission, not a new paid study, live successor usefulness, full-product acceptance or C/D release.** Original29 collected/3 failed/40 NR with4 UNKNOWNs and fresh23 collected/12 failed/37 NR remain finished negative/inconclusive results. No replay, regrading or historical-source edit occurred.

## Changed behavior

`evaluation/post_freeze_transition.py` exposes the executable `admit_transition(service, principal, workspace, Transition)` entrypoint for future reviewed resume/changed-input work. Unlike the earlier standalone validator, it actually calls ordinary `Service.post_message` and retains the resulting admission.

1. Require explicit accept or justified retain-current receipts, the exact current saved artifact/revision/body hash, protected human text, same-conversation source run and work-version CAS. The consumer never chooses acceptance or fabricates removal acknowledgements.
2. Hold the ordinary workspace write lock and use one borrowed ordinary transaction for current authorized review/material reads, recollection, admission and immutable evidence retention. Ordinary authority, access and target checks remain effective. Receipt failure rolls back the dependent admission.
3. Attach the exact canonical saved body as identified prior work and separately attach any changed input. Retain the actual queued admission, source packet/hash, saved-input hash and review receipts together in the existing immutable command ledger. Partial source packets remain partial/unscored; no human-time benefit is claimed.
4. On retry, recheck current review/access/revision and reuse ordinary payload-bound command receipts. Return the original retained packet with no duplicate run/queue row. Later human edits deny stale reuse.

No backend/runtime/migration/helper/contract/UI change was necessary. This is intentionally a narrow evaluation entrypoint, not a universal review gate or a frozen-campaign retrofit. Future orchestration for this method must invoke this entrypoint; unrelated ordinary work is unchanged. It queues a run, not a provider request: the dependent worker still applies normal execution authority, source and budget controls.

## Actual verification

New disposable fixture `workagent_test_f3413dee8f3e` was provisioned normally through all88 migrations. Actual runtime role was non-superuser, non-BYPASSRLS and non-owner. No retained study or installed database was used.

| Check | Observed result |
|---|---|
| Parent restricted-PG consumer integration | **14 PASS**,50.71s |
| Parent focused offline tests | **11 PASS**,5.54s |
| Same independent reviewer offline | **10+1 distinct PASS**; PG result inspected/reused, not independently rerun |
| Parent OS-process recreation probe | **PASS**: two distinct exited processes, identical retained receipts,13 snapshot table sets unchanged, exactly1 dependent run/queue row and0 dependent provider attempts |
| Prior accepted source/evidence verifier | **27 source/evidence +88 migration hashes PASS**; all previous bound files unchanged |
| Predecessor dirty files and finished fresh evidence | **14 SHA256 bindings unchanged** |

The14 PG cases cover actual accept/resume and retain-current/changed-input admission using exact saved bytes; Service recreation/retry; pending, missing, stale, wrong-revision, withdrawn, missing-acknowledgment, lost-protected-text, work-version and authority denials; partial recollection; current provider revocation; and injected evidence-retention failure after actual admission with full rollback. Denials compare domain/admission/effect snapshots; no dependent dispatch/transport occurs. Parent's subsequent OS probe adds actual process recreation, not merely a newly constructed Service. These prove admission idempotency, not paid successor no-resend or useful downstream output.

The first PG run is retained as **13 failures/1 pass**, not concealed: the test snapshot incorrectly filtered `responses_steps.workspace_id`. The test-only correction joins its real attempt/run ownership and keeps all13 table sets. A new offline two-workspace SQL-scope regression checks this. Production consumer bytes did not change. Earlier writer-only fixture/assertion failures remain in the local archive at their original scope.

## Custody, costs and remaining work

Four new source/test files plus this report/evidence are the only staged increment. Predecessor STATUS, authority docs, fresh72 harness files and `contracts/pnpm-lock.yaml` are untouched. Frozen source snapshots, inputs/oracles, output/ledger evidence and both completed study archives remain separate and unchanged. The accepted prior evidence verifier still passes against canonical files.

No paid product call, new allocation, ledger adjustment, installed deployment, default merge, web edit, credential/route change or destructive cleanup. Existing175USD TOTAL authority is unchanged. Last accepted137.0597 allocation is not billed spend; billing remains unknown. Development and review used GPT-6 Astra/high; tool costs are outside the product ledger/unreconciled. No new spending audit is needed for zero-paid engineering.

Full longitudinal/changed-evidence usefulness, causal benefit and measured human-effort reduction remain unestablished. Existing generic-label/raw-Markdown/CSV-as-text and other recorded UX limitations remain. C/D and later E/F/G are not automatically released. This same-card handoff is for acceptance disposition of the finite correction, not another content review, funding question, broad test cycle or frozen72 replay.

Evidence: [exact-source independent review](transition/REVIEW.md), [manifest](transition/MANIFEST.json), [PG log](transition/parent-pg-02.log), [offline log](transition/parent-offline.log), [actual process restart result](transition/PROCESS_RESTART_RESULT.json). Private fixture credentials are excluded. Feature publication and exact-head CI are recorded separately in the final handoff; no running-product claim follows from publication.
