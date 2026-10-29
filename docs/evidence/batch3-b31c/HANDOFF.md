# B3.1c handoff

## Implemented and verified

The generic opt-in attachment bridge is in `backend/workagent/conversations.py` and `source_snapshots.py`; its new restricted-PG regression is `backend/tests/test_combined_attachment_bridge_pg.py`. No API/schema/migration/web changes. The generated capability registry updates only seven implementation hashes to match the actual runtime descriptors; final canonical and TypeScript checks pass. Exact source and review bindings plus actual combined journey are in [ACCEPTANCE.md](ACCEPTANCE.md), [REVIEW.md](REVIEW.md), `receipts/source-manifest.json` and `evidence-manifest.json`.

The combined controlled path now works from a normal Home/native attachment: immutable source → real confined computation → actual output-derived editable draft → verified client downloads. Human procedure review transfers across assignments without old data; human result revision survives; scoped negative/no-memory controls and post-forget nonappearance pass. Mechanisms only, not paid/live usefulness or causal learning. The no-memory control also computes correctly.

## Continuation

- Main existing successor: `t_2e868b13`, B3.2a public research/freshness/read-only fallback. Do not start B3.2b or an alternate plan here. Preserve authority and accumulated budget lineage; this slice made zero paid product calls and did not adjust grants on the installed product.
- Supplementary isolated web repair: `t_8f2dc0c8`, immediate message after project-memory link can409 until an explicit refresh. Claude owns web; the implementation coordinator must use an isolated branch, not edit this shared lane. It is not a blocker for unrelated research implementation.
- Cloud's later note-label branch remains unintegrated. `web/src/app/conversations/[id]/page.tsx` is a known ownership hotspot; preserve both lanes and reconcile actual deltas.
- Preexisting untracked `contracts/pnpm-lock.yaml` is preserved; do not commit/delete it as part of this feature.

## Test/runtime reconstruction notes

Evidence scripts are in `harness/`; they are explicit deterministic test transport, **not application handlers**. They were run from an isolated candidate root on the development EC2 using its disposable private `fixture.env`, restricted runtime DB role, and separately held migration role for synthetic authority/fixture setup. The candidate copied accepted predecessor dependencies; the proof created a unique workspace rather than touching installed product data. Do not publish the private environment.

The native harness imports the accepted B3.1b `pty_driver.py` at `.local/batch3/b31b/`; its committed source is `docs/evidence/batch3-b31b/harness/pty_driver.py`. The controlled worker imports existing test fixtures from `backend/tests`; use `PYTHONPATH=backend:backend/tests` and set HOME/TMPDIR to the owned proof's private home/scratch. A verified tokenizer cache is required for the production request builder. Set `WORKAGENT_OPERATOR_URL` to the owned API, and the exact accepted compute socket/profile explicitly. Do not reuse a synthetic failing run as a fresh attempt.

The tested web build explicitly enabled `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1`; build ID and362 source hashes are in `receipts/runtime-source-binding.json`. Browser processes were single-concurrency. Native tests use actual `pexpect` PTYs and terminal images, not Textual pilot. Preserve the failed logs when rerunning; use new evidence labels/directories rather than overwriting history.

Owned services have been stopped and lease released. `/run/workagent-compute-b31c` is a retained, root-owned **disposable** pinned snapshot, not an installation promise; transient unit unloaded. Recreate only an owned unit with the accepted config and `python3 -B`, exact manifest check and real readiness computation. Do not regenerate pins to ignore new bytecode files. Installed API/web remained PIDs917/918 and were not promoted. Remote head/CI state is in the final task checkpoint; the accepted source is not automatically what the saved application runs.

## Evidence interpretation

`combined-verification.json` is the independent expected/actual/hash and fresh-process no-repeat readback. `*-observations.json` are real PG tool events, `*-contexts.json` are actual controlled-provider request contexts, and `*-result.json` holds authenticated memory usage/download headers. Historical model-transport unknown remains retained and unrepeated. Original source and edited human revision have distinct immutable hashes. Old sent memory contexts are historical evidence; forget correctly affects future recall rather than falsely rewriting prior sends.

Broader queue/rollback/byte-profile regressions mentioned in the independent review were inspected, not executed anew. Unaffected B3.0/1a/1b tests and isolation/privacy evidence are reused as labeled predecessor evidence. Staged reusable QA skill update `42e36bae` awaits interactive skill approval and is not active enforcement.
