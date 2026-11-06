# B3.4a — three remaining mounted browser orderings

Task `t_95a17c3f` · 2026-10-29 · **3/3 named cases passed**. This closes only this card's browser evidence. It does not accept B3.4a, B3.4b or Batch 3.

## Exact candidate and execution

- Retained worktree: `/home/ubuntu/workagent-continuation-20261026`; branch `hermes/b2-conversational-client`; unchanged base `16923fef5f82f41c53e8242fe4e69e21de8da377`.
- Reused optimized isolated build `HAEr4yziKBlWBIpt1euzS`. All **32** second-checkpoint source hashes matched before/after. **205** source/public/contract/config/package inputs matched the isolated web lane on final verification (201 source/public/contract inputs checked before startup). No rebuild or product-source edit.
- Real mounted MemoryPanel, Chromium desktop 1440×1100, real local API and current `journey-v2/fixture.json`, explicit `test-04.env`. The harness detaches AbortSignals, including generated-client Request signals, then holds successful real API responses and explicitly releases them. No invented API payloads or injected denial. This is **controlled completion timing**, not natural latency or server-revocation proof.
- Entry point: `node .local/batch3/b34a/browser-fences.mjs --residual`. A new residual-only mode imports `browser-fences-residual.mjs`; historical six-case script behavior and its saved results remain retained and were not rerun.
- One browser attempt (`attempt-01`) passed all three. No write replay. No Claude/reviewer invocation, broad tests, paid product calls, private access, deployment, default merge or cap change.

## Results and literal orderings

| Case | Executed ordering | Verified state |
|---|---|---|
| Same-scope Forget → late response | Dedicated task-scoped control preference was remembered by API; browser correction generated a real automatic current-list refresh. Its response contained the control's content and was held. Browser Forget succeeded and removed the content **before** release of that old current-list response. No form cancellation or route change substituted for Forget. | Same URL/scope; forgotten content and history chooser absent. Screenshot says “Nothing is remembered for this conversation.” Exact server readback is `forgotten` with null content. |
| Client route/scope replacement → late response | Held study conversation's real evidence response (8 entries); followed actual Next links through Conversations to the control conversation, opened Procedure and loaded its current evidence, then released the old response. A document UUID survived the links, proving this was client navigation, not hard reload dropping the promise. | Replacement panel text unchanged; “Nothing in this conversation can be cited yet”; no old evidence or memories appeared. Zero browser writes. |
| Older history **after newer target selected** | Held old history, closed/reopened chooser, held newer history, released newer response, selected target, **then** released older response. Recorded event sequence: newer release 109 → selection 110 → older release 111. | Same radio remains checked, chooser text unchanged, Restore this version remains enabled. Restore was not submitted. Zero browser writes. |

Exact selected target: memory `5707807c-0cef-4d3f-aca8-98d576a68d49`, revision `10d35e93-86a2-420f-a5d7-6e8ba274a474`. The actual stored content has a leading space; the retained API payload preserves it. Selection was checked against authoritative `rollback_revision_ids`.

The Forget response ordering records UI purge at event 113 and held list release at 119. Route replacement records new panel readiness at 149 and old evidence release at 150. Payload hashes and sequence assertions are in `ordering-verification.json`.

## Mutations and preservation

Dedicated control memory: `fa9594cd-73b4-4342-b330-f30a9b17b30e`, conversation `b506e34d-4b3c-41a6-b45c-6617d08e6ed8`. Only intended effects:

1. API Remember of that synthetic task-scoped preference (setup, read back).
2. Browser Correct of the same preference, to produce an actual automatic refresh while it stayed actionable.
3. Browser Forget of the same preference, followed by exact server readback.

All **pre-existing row hashes across 68 public tables remained unchanged**. The only additions were 3 command rows, 1 memory item, 3 revisions and 1 tombstone; every added row was checked to bind this dedicated memory ID. Thus zero unintended database mutations were observed. Original adopted lessons, grants, unknown runs, usage receipts and human file records remained intact. The fixture identity file and `contracts/pnpm-lock.yaml` are unchanged; lock hash remains `f04d544c1cc611dd3b4e6caa260b850cadf18be42ebd283308e5ff01aaad5a4d`.

No installed-data cleanup was performed. Retain the dedicated forgotten control and command receipts as evidence; do not rerun destructive setup to reproduce an already-passing case.

## Evidence and screenshot inspection

Evidence root: `.local/batch3/b34a/journey-v2/evidence/browser-fences-residual/`.

- `attempt-01/results.json`: three scenario records.
- `attempt-01/*-network.json`: exact request URLs/bodies, successful held response payloads, payload SHA-256, write receipts and event order. No bearer headers recorded.
- `attempt-01/*-ui.json`: final URL and exact panel text.
- `attempt-01/*-before-*.png`, `*-pending.png`, `*-selected-before-old*.png`, `*-final*.png`: actual before/after full-page and panel screenshots.
- `control-request.json`, `control-receipt.json`, `control.json`, `control-forgotten-readback.json`: dedicated fixture inputs and exact readbacks.
- `database-before.json`, `database-after.json`, `preservation.json`, `mutation-identity-verification.json`: hash-only baseline preservation and exact identity checks.
- `ordering-verification.json`: independently recomputed sequence/payload/selected-revision assertions.
- `manifest.json`: current source, lane inputs, harness, fixture, historical reports and evidence hashes.
- `services-stopped.json`: owned process and listener readback.

All three final panel screenshots were visually inspected: empty remembered list after Forget; empty current-conversation evidence rather than study evidence after navigation; selected human-correction target with enabled restore action after old history arrives. No concrete product defect was observed, so no correction lane or new review was started.

Results SHA-256: `fe092fd806d1f36bae366eac5a71df999ef4b0df6fd25ffdf18779537d40e134`.

Manifest SHA-256: `bc49ca8f51f1db8ea44639cdcbb9ed012ac7c60d034047fa98ff4dbd05091e26`.

## Stopped services and next owner

Owned API PID 695232/start 125025799 and web PID 695291/start 125026101 were stopped only after matching PID/start/cwd. Both PIDs are absent; ports 18240 and 13240 return connection-refused errno 111. Compute-b34a was not started and reads inactive/MainPID 0. Disk remains 25 GiB available.

Existing successor `t_cd71932b` owns post-rollback and source-revoke future-use proof. Existing reconciliation/package children own remaining acceptance/publication preparation. No future-use, source-revoke, live learning-benefit or full publication claim is added by this browser-only card.
