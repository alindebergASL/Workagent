# Recovery5d — authenticated scope correction; A14 remains HOLD

Task `t_372fad62`. **Not complete.** Parent-owned full acceptance, 5c reconciliation and publication remain HOLD. No other card was completed/unblocked, no new cards, commits, pushes, merge, deployment or Batch3 work.

## Exact candidate and ownership

- Branch `hermes/b2-conversational-client`, HEAD `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d` plus preserved intentional dirty source.
- Before editing, all602 source hashes matched the5b manifest SHA256 `1a969241aa7dfba5f77cf7382f2c521cb1d5fd12bb1ce831e230968fba89017f`. A private baseline was reconstructed and independently hash-verified for exact dirty-to-dirty deltas.
- Current candidate2:610 source files,39-file material delta from5b. Manifest `docs/evidence/batch2-recovery5d/candidate2-source-manifest.json`, SHA256 `fd1c6bdb6d97727d5883d989bc6adb3d9c0690a1d02858f6b58d73377c68746c`. The candidate1→2 correction is10 files; both manifests/diffs retained.
- Astra gpt-6-astra/openai-codex owned orchestration, narrow backend/session contract and verification. Claude Opus5.5 (`claude-opus-5-5`, authenticated first-party Claude Code2.1.300) was the sole web writer. Old session `b21dc091-b18f-442f-9b6c-e4ccb160a1e0` was inspected, not resumed; fresh current-source session `ae4ca6cd-e75c-4af8-8e4f-d6d0348d6387` implemented the correction and one narrow review-fix pass. No wholesale stale-lane replacement.

## Implemented

Backend authenticated `GET /v1/session` returns actual principal plus opaque keyed scope binding principal/database/credential; existing bearer authentication remains authoritative. Optional expected-scope header refuses stale requests before service invocation. Existing principal-only `/v1/identity` was insufficient for stable backend/session identity. Generated contracts were refreshed.

The server-side web proxy derives a separate endpoint-bound opaque browser scope and requires it on every domain request. It verifies current authenticated backend identity before forwarding and forwards the backend fence to close the preflight/dispatch race. Private credentials, DSNs and endpoint configuration are not exposed to browser code.

A root gate withholds client state until identity resolves; each page realm binds once and terminal-fences on changes until explicit reload. Session/local storage, staged binary scopes, Home continuations, pending envelopes and relevant caches use the authenticated namespace. Legacy unproven records remain untouched/unadopted. Original-scope data survives reload and temporary scope changes.

First independent review found three races. The Claude correction now preserves ambiguous post-dispatch upload identities and exact retry bytes; guards JSON/binary/digest/download continuations and SSE callbacks; and fences explicit identity-preflight failures without treating ordinary upstream503 as lost identity.

## Open blocker — A14-R2-POLL

**Independent narrow rereview remains HOLD.** `web/src/lib/client/work-stream.ts:211–239` has a separate polling fallback path. After `await res.json()`, it filters/deduplicates events, advances the cursor and calls `onChange` without checking its captured scope. An actual-module deferred-body probe delivered one late event callback while scope status was already `changed`. This is a subscription-boundary defect, **not evidence of a rendered cross-principal canonical-data leak**; current consumer callbacks ignore payloads and canonical reads have further fences.

Required narrow correction: check captured scope (and abort) after polling JSON resolves and before filtering, cursor mutation or callback. Throw `Revoked` outside the parsing catch so it is not reclassified as transport. Add actual `subscribeWork`+`scopedFetch` delayed-body regressions, including `has_more`, proving zero late callback/polling status, one revocation notification and no extra fetch/reset. Keep existing SSE regression. Reverify the exact correction and obtain disposition of this remaining independent HOLD before closing A14. No retry/iteration limits were changed; this bounded run stops with an explicit blocker, not a phantom successor.

## Verified evidence

- Backend pre-fix5 failing session regressions retained (plus one earlier import-path harness error). Current affected backend/HTTP/Pg cursor-generation/revocation suite:14 passed, zero skips/failures. Contracts export/drift/type checks pass.
- Parent serial candidate1 gates:499 frontend tests, typecheck, lint, format, production webpack build PASS.
- Parent serial candidate2 gates:510 frontend tests, typecheck, lint, format, production webpack build PASS (`gates2-*`). These are not a substitute for the open security finding. Historical508 backend/134 journey evidence remains historical; no current full-backend-suite claim.
- First independent review and narrow rereview are retained as `independent-review.json` and `independent-rereview.json`; R1/R3 fixed, R2 partially fixed/open. Some initial generated-client red fixtures were invalid; the owner handoff identifies them. Do not recast every historical red as a valid product regression.
- `verified-browser-report.json`: actual production-build principal-only change on18965, endpoint-only change18965→18966 with same principal, exact A draft/staged-byte recovery, frozen pending-envelope retention, legacy non-adoption and controlled unavailable-session refusal PASS. Only two intentional stale command probes POSTed, both401; no automatic mutation or upload.
- B's ordinary shared conversation read is200 while existing owner-only work-snapshot is404. The browser truthfully refuses; sampled UI never restores A draft/staged files under B. Unrelated A-only workspace404. Authorization was not weakened to make B receive a composer.
- Fresh runtime2 fixture: actual open stream200/heartbeat, then membership revocation once, actual `snapshot.required`/`access_changed` frame, canonical conversation/snapshot/events404, canonical title/content removed, no send/retry affordance, zero automatic POST. A's own exact unsent draft remains read-only and explicitly labelled kept/not-sent; staged bytes remain intact. This is valid local recovery for unchanged authenticated A, not cross-principal disclosure. Old5c and first5d revocations were never reversed.
- Retain `preflight-report.json` and `final-browser-report.json` FAIL receipts: respectively an overstrict assumption that B must have a composer, and an overstrict zero-textarea assertion that counted the read-only local recovery field. Corrected fresh-fixture evidence supplements rather than overwrites them.
- Responsive screenshots and DOM/overflow metrics at1440/390/320 cover staged drafts, unknown identity and revoked recovery. Browser page errors are empty; expected503/401/404 console messages correspond to deliberate faults/refusals. Screen captures are synthetic.
- A28/A35 shared-transport narrow check PASS: actual UI cell-only saves/readbacks/reloads preserve exact five/ten multiline note arrays; unchanged retype remains a no-op; consent-bearing stale-base acceptance still409 with canonical revision unchanged. Original broader A28/A35 evidence is retained. All167 prior5b and170 prior5c evidence-manifest entries verified unchanged.

## Runtime, privacy, effects and resumption

Restricted/disposable PostgreSQL `workagent_test_0604a6a3b5d9`; private env `.local/recovery5a/test.env` was sourced without publishing its contents. Owned API18965 and web3195 serve candidate2; exact PID/cwd/argv/build identity is recorded in `final-verification.json`. Auxiliary18966 is stopped at handoff; browsers and Claude lanes have exited. Old18963 and installed8152 were untouched and are not proof targets.

Product-provider calls/spend/reservations added:0. Provider-attempt/response/budget tables are hash-compared across browser proof; authority/grant tables unchanged. One additional synthetic queued dispatch was created by the affected backend HTTP test, not by a provider worker; browser-boundary dispatch state is unchanged. No provider/model worker was started. Developer-tool list-cost counters reported3.9276352 then7.1704424 USD for the resumed Claude session; do not sum these as verified billing or product spend. Astra reviews ran via inherited openai-codex; no global model/configuration change.

Resume this existing correction card only for A14-R2-POLL, exact verification and narrow review disposition. Do not restart the entire5c/full43-row campaign, erase old reds, reverse revocations, create more cards, unblock predecessors, publish or start Batch3. Parent owns reconciliation. This handoff is a **partial implementation and verified browser increment, not completed A14 or Batch2**.
