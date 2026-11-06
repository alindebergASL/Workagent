# Recovery5d bounded poll correction — PASS

Task `t_372fad62`, deliberate narrow resumption. **The remaining A14 correction criterion is verified; this correction card may complete.** Parent still owns A14/A28/A35 reconciliation in `t_5f1899a4`, full43-row acceptance in `t_75bcdd10` and publication in `t_45ab8522`. Those cards, the historical acceptance matrix and publication HOLD are untouched. No successor was created. This is not completed Batch2 or permission to publish/start Batch3.

This append-only supplement supersedes only the open A14-R2-POLL disposition in the retained `docs/BATCH_2_RECOVERY_5D_HANDOFF.md`. That handoff, previous reviews, red receipts and manifests have not been overwritten.

## Source, ownership and exact change

- Branch `hermes/b2-conversational-client`, HEAD `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d` plus intentional dirty source. All610 candidate2 files were verified before the resumed writer, against manifest SHA256 `fd1c6bdb6d97727d5883d989bc6adb3d9c0690a1d02858f6b58d73377c68746c`. The original602-file baseline verification remains retained from the prior run.
- Sole web writer: Claude Opus5.5, first-party authenticated Claude Code2.1.300 session `ae4ca6cd-e75c-4af8-8e4f-d6d0348d6387`. Astra gpt-6-astra/openai-codex handled orchestration, verification and one independent narrow security disposition. No global model/configuration or limit change.
- Exactly two source changes from candidate2: production `web/src/lib/client/work-stream.ts` and new `web/test/poll-scope.test.ts`. Backend/contracts and all other source files are unchanged. `source-delta.json` and `delta.patch` bind the change.
- Current611-file manifest: `source-manifest.json`, SHA256 `194d317f63fdf7fea4dadc38c6a6377a7196a8c02c74fc8da9db230f8b205c07`.
- Production hash: `21bc73963492b2486808d47d78db9aa4d36c5b9b379d9bf7daffffaadea23faa`; new regression hash: `879a968dae7bf29354cc2106ca2b13aa41d150e29779663253ccc858510d5591`.

The polling body is awaited separately; abort and captured-scope checks run before contract parsing, filtering/deduplication, cursor mutation, callback or pagination. `Revoked` escapes the parser/transport catches unchanged. Abort exits quietly; fenced decoded bodies revoke once without resets, retries or polling publication. No persistence/authentication/mutation interface was redesigned.

## Executed verification

| Gate | Result and evidence |
|---|---|
| Valid pre-fix regression | `red.txt`:3 failures/1 pass on exact old production hash; each failed case observed one forbidden late callback. |
| Owner focused green | `green.txt`:56 passed, including existing SSE, upload ambiguity, explicit-preflight failure and scope recovery guards. |
| Parent serial gates | `gates.tsv`, `frontend.xml`:514 frontend tests,0 failures/errors/skips; focused tests, typecheck, lint, format and production webpack build all exit0. Existing locked dependencies only. |
| Independent Astra review | `independent-review.json`:PASS A14-R2-POLL, no remaining bounded findings. Exact611 hashes and two-file diff verified.56 regressions and7 adversarial scenarios passed; old source defect independently reproduced in memory. |
| Current production browser | `verified-browser-report.json`:PASS delayed polling body after terminal identity fence, no subsequent domain fetch, no mutation, exact same-scope draft reload, canonical readback unchanged. |
| Preservation | `final-verification.json`:126 earlier5d evidence/handoff hashes,1675b entries and1705c entries unchanged; source unchanged after tests/review/browser. |
| Provider/state/privacy | `audit-before.json`/`audit-after.json`:11 read-only table fingerprints unchanged; provider state matches prior evidence;0 new product calls/spend. Secret scan of evidence/current static assets found no private env values. |

Review SHA256: `82358ed3b7e8dc86c3b916f76059be11b841a16a3dfbb2a75b3cbd29cf71fb65`.

The new tests use actual `subscribeWork` plus actual `scopedFetch`, deferred body consumption and request-attempt counts above scopedFetch, so locally refused extra fetches cannot hide. Both `has_more` values, abort and unchanged-scope behavior are covered. Independent probes also cover fenced contract-invalid/reset-required bodies, abort+fence priority, and same-scope pagination/cursor/dedup.

## Browser attribution and retained journeys

The new browser used the actual current production bundle and authenticated GET context for synthetic `recovery5a-workspace` conversation `cb848ce6-e383-4dc8-b2dc-7721720e45e6`. It deliberately failed the SSE transport to enter polling, accepted a real HTTP200 polling response and held JSON completion. It then injected a controlled unavailable-session response, waited for the terminal gate, and released the held body. The real page was empty (`has_more=false`); event-bearing/has-more callback assertions come from actual-module regressions and independent probes, **not** this browser receipt.

After the confirmed terminal fence: no domain request, no composer/private draft/canonical content, no mutations, no page errors or console errors. Same authenticated principal/endpoint reload recovered the exact local draft. Canonical GET bodies before/after matched. This is a controlled transport/session-loss smoke, **not** a new actual principal switch or membership revocation. React cleanup also aborts the subscription here; scope-only fencing is independently exercised without cleanup in the module probes.

`verified-fenced-1440.png`, `verified-fenced-390.png`, `verified-fenced-320.png` were visually inspected: readable access-changed message and Reload button only, no private content or clipping; measured document/body widths equal viewport. The deliberately minimal existing gate is unchanged; no visual redesign claim.

The prior `../verified-browser-report.json` is retained and reused: actual principal-only and endpoint-only switches; exact A draft and staged PDF bytes recover only under original scope; frozen pending envelope not adopted/dispatched under B; legacy non-adoption; unrelated workspace404. B's shared conversation200 with owner-only snapshot404 is truthful refusal, not an authorization failure to work around. The original confirmed defect was A's unsent multiline draft visible under B—not a visible B attachment or server canonical-data leak.

Prior active-midstream proof remains: open200 stream/heartbeat, one fresh membership revocation, actual `snapshot.required/access_changed` frame, canonical reads404 and canonical content hidden with no automatic POST. A's unchanged-identity unsent draft remains explicitly read-only/kept/not-sent, with staged bytes retained; this is not foreign-principal disclosure. Those memberships/source-access rows are unchanged in this resumption.

Reuse is justified by the exact two-file delta: auth/session/proxy, durable storage, uploads/pending commands and SSE paths are unchanged; only late poll application is restricted. Existing14 affected backend tests and historical508/134 evidence are retained, not claimed as freshly rerun. A28/A35 source-editor/acceptance/mutation paths are unchanged; same-scope polling remains correct. Prior narrow exact multiline-note saves/readbacks and stale-base409 evidence is hash-preserved; no unrelated journey replay.

## Retained failures and limits

- `red-attempt1-unbounded-hang.txt` and `red-attempt2-invalid-fixture-hang.txt` are harness failures, not valid product reds. The latter omitted required `checked_at`; neither is substituted for `red.txt`.
- First `browser-report.json` FAIL remains intact: its flag marked the start of a session probe, before the terminal fence. Three authorized focus-refresh GETs were incorrectly counted as post-fence. `browser2.mjs` separately marks the confirmed terminal gate before releasing the body; no product change or mutation retry occurred.
- Existing transport/body-read rejection behavior and pre-existing immediate-reset backoff behavior were not expanded into a broad audit. A held successful request is discarded after it resolves rather than actively cancelled by the scope-only guard. Consumer callbacks rely on the corrected subscription boundary. Independent review records these as nonblocking for this bounded correction.
- No live paid/model usefulness or full43-row claim. No commits/pushes/default merge/production replacement, authority/grant changes, new private integrations, DB maintenance or cleanup.

## Runtime handoff

Owned API18965 remains PID4089836, unchanged backend. Owned web3195 now PID4139215 serving production build `UVAOGiCFyNJ75OIYY_jOz`; cwd/argv captured in `final-verification.json`. It is restored to the original18965 endpoint. Auxiliary18966 remains stopped; old18963 and installed8152 untouched. Browser contexts and Claude writer exited; no provider worker started. Services are intentionally left available to the parent. Restricted disposable DB is `workagent_test_0604a6a3b5d9`; private env contents were never published.

Developer-tool list-cost counter for the resumed Claude session is8.8781276 USD (cumulative session report, not verified billing, not additive to previous counters, not product spend). Product calls/reservations/spend added0. Parent retains next-step decisions and all broader HOLDs; no active autonomous successor is claimed.
