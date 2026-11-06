**REQUEST CHANGES — one Astra/high static review completed against `e1db70df77957de6aca842bc6f47ebb0f133008e`.** Three actionable findings:

1. **P1 — Revoked source quotes remain accessible through citation observations and subsequent model input.**  
   Locations: [research_adapters.py:55](/home/ubuntu/workagent-continuation-20261026/backend/workagent/capabilities/research_adapters.py:55), [research_adapters.py:164](/home/ubuntu/workagent-continuation-20261026/backend/workagent/capabilities/research_adapters.py:164), [observations.py:17](/home/ubuntu/workagent-continuation-20261026/backend/workagent/capabilities/observations.py:17), [general_worker.py:324](/home/ubuntu/workagent-continuation-20261026/backend/workagent/general_worker.py:324), [adaptive.py:318](/home/ubuntu/workagent-continuation-20261026/backend/workagent/adaptive.py:318).

   Capture in run A, cite in run B, then revoke A’s tool grant while B remains authorized. The research claims endpoint correctly withholds the claim, but B’s stored `CiteOutput.result` still contains its claim and quote. Shared tool-attempt reads validate B’s grant without rechecking the cited source. Retained observations can also copy that payload into B’s subsequent model input.

   This is a source-dependency revocation bypass within the same authenticated principal/conversation, not an asserted cross-user exploit.

   **Fix:** Reauthorize research observation dependencies before exposing tool-attempt payloads or consuming retained model context. Preserve immutable receipts/accounting while withholding inaccessible content. Use visibility checks rather than exact-current claim-creation CAS. Verify capture-A/cite-B/revoke-A against both observation endpoints and B’s next prepared model request.

2. **P2 — Web citations retain quoted content after the backend’s authorization-denial response.**  
   Location: [ResearchSources.tsx:638](/home/ubuntu/workagent-continuation-20261026/web/src/components/ResearchSources.tsx:638), especially line 647; supporting contract: [errors.py:4](/home/ubuntu/workagent-continuation-20261026/backend/workagent/errors.py:4).

   After displaying a claim, revoke its source access and select “Check against the capture.” Backend `deny()` returns **404** for `not_found_or_not_authorized`. The callback removes the loaded snapshot and shows an error, but clears claims and other captured content only for **401/403**. The existing claim and exact quote remain displayed.

   **Fix:** Treat the canonical 404 denial as potentially revoked access and clear dependent claims/quotes. Fence pending responses so an earlier successful read cannot restore cleared content. Test the stateful component through the actual 404 path; static `ClaimsList` rendering does not cover it.

3. **P2 — Source refreshes leave web freshness state unchanged for an unchanged artifact revision.**  
   Locations: [ResearchSources.tsx:218](/home/ubuntu/workagent-continuation-20261026/web/src/components/ResearchSources.tsx:218), [ResearchSources.tsx:600](/home/ubuntu/workagent-continuation-20261026/web/src/components/ResearchSources.tsx:600), [WorkCard.tsx:205](/home/ubuntu/workagent-continuation-20261026/web/src/components/WorkCard.tsx:205).

   `ResearchSources` fetches only when workspace/conversation changes. `ArtifactCitations` fetches only when workspace/artifact/revision/body changes. Neither provides refresh or research-event invalidation, and parent polling preserves their keys. Appending a newer source snapshot while preserving the human artifact revision therefore leaves “Sources current” and the source list unchanged until remount/reload.

   **Fix:** Refresh on canonical research/work updates or provide an explicit refresh action, with response fencing and access-loss clearing. Verify in an already-open browser that capture B makes citations to A stale without modifying the human body.

**Coverage and limitations**

The single pass covered all 49 changed/new files, migration 059, generated contracts, native/web surfaces, and relevant shared broker/read/context paths. Findings are grounded in static code paths; no runtime reproduction was performed.

No additional concrete blocker was established in the inspected egress selectors, address validation/TLS pinning, content hashes and quote ranges, post-I/O authorization, settlement/non-replay accounting, or browser confinement implementation. Browser namespace isolation, empty environment, pinned files, network/download denial, resource bounds, and cleanup were inspected—not independently exercised.

Parent-reported test totals were not independently observed or adopted as reviewer evidence. No private logs or worker lease values were inspected. No implementation, runtime tests, network/product calls, commits, or service operations were performed. `git diff --check HEAD` returned no diagnostics.

**No acceptance claim:** actual HTTP/browser/native PTY journeys, production web build, and their source-bound evidence remain with the parent. This review does not establish live-search usefulness or B3.2/Batch 3 completion.

**Source binding**

HEAD and all 49 changed/new file hashes remained unchanged between capture and closing rehash. SHA-256 of the manifest below:

`742796ffe8066e00d28431fcb6d5aa16b8b5e38694d56833e973f065aece776d`

Encoding: UTF-8, paths sorted lexicographically, each line `<sha256><two spaces><path>\n`.

```text
0c1501fa9761675b64f7bb6c9841b1caf0c352bfdb8abdd6dd4f098f5a04bd46  backend/dev_db.py
96991f5a762d93ed64debaadcc0a3df6456e76b7066eccb1d76efbb9c6a67451  backend/export_contracts.py
c65d2c49fc19be9575b30b29dec5062b42c9715ef077aee71e07cdd11ab31dd6  backend/migrations/059_grounded_research.sql
aa0356edaa7420aa1946cea4742cf0bbada1c5da22dcf00df621e9004b1adf62  backend/tests/test_public_browser.py
18f3904642e6af708c5de009ea444c6dd805e3b84b1f68e57c1634af4fab6f64  backend/tests/test_research_pg.py
74f62e2ae14b29c9b82662635a344184ef6c2d887add7416a07c3524bf36404f  backend/tests/test_research_retrieval.py
7cf812e94f5e174c3fc5229b7cdd0b235251623fb691421c1482bc0cdd30f8b3  backend/tests/test_research_unit.py
48bb74c3bb906005c16d0232e0f83a490846fddb09a2563d11fd26525084a518  backend/tests/test_tui_research.py
aadbf2eba680804950eb716f849006565fddfe1f2dded336a60b8acfba6a0b9e  backend/workagent/adaptive.py
c3b8b380207947f00ed0e7faa19a5de32868f04da42d3737fa06e27eebed36ca  backend/workagent/api.py
c28116db686aa8179bd8608c08d3a6d782a1b1fdfc12df28414292dc2019285d  backend/workagent/capabilities/broker.py
34fe0aa154c2cd7ded06ebcb4476b70144f67f1024d02b33a0d02dab20a0a768  backend/workagent/capabilities/compute_composition.py
3a1d9c3196499d9a2b60eaffc244accd5cba2f583e8c6f111f577e906dbcf554  backend/workagent/capabilities/policy.py
b90150bcc4b789dc03f9cd67ca5b9361032825b1888d97a2e9cbcb067623b717  backend/workagent/capabilities/registry.py
3f4d7b58cff16ff3bd0682d513e0b7caea807142b900aa8e85239049ac7061fc  backend/workagent/capabilities/research_adapters.py
39b2e28a1ceee4a6d9a45900f5e3e5ee3517ca99e1da0947a424db758c2052e0  backend/workagent/capabilities/research_composition.py
53e81d925f3455e5863219600cb4e5e7c09ea5aff96dbf062c9af2518fea88d6  backend/workagent/conversations.py
4ef81503e8638359b74a0330288cadf154fd946c2a60adb28a1ccb97c3fb9f27  backend/workagent/general_responses.py
34018734dc06de4f4b1b2e26cae11ac5c1b0ee5dd55045078c96fe2888344f87  backend/workagent/products.py
916242786d33094a9a0722935faacf14adfa0b100d143baa91f98d7be7c34d87  backend/workagent/public_browser.py
dab292d94356a6c3bbdde5858510aef055ef4c7139f079f2bd49d6152e454021  backend/workagent/public_browser_lock.json
6062283428c9e78563125a4d0b89a3394a4cdd4fecf5b101d68b1736ebeb84f2  backend/workagent/public_browser_runner.py
e5b37288e6e51aabcf81ada626fd37fff245110485f4a0572ebc97a04cd855d8  backend/workagent/public_retrieval.py
4a0366f330b9ff4957d123c7cfb1af465ef1a80da5f140d496668c82a86d392d  backend/workagent/research.py
60cb9a978f98db298abe53dcc37e103c4a7228fc16b19edbab291183063be4ed  backend/workagent/research_api.py
2c698137caf776937d1a584d4a80b8deae1c5c26ae52da0297005cae407bee21  backend/workagent/research_models.py
8dbe62b0f719135fed0cb3facc1e7fc82c9001cd293b9b2ac81550dfe5516dcc  backend/workagent/responses_ledger.py
d19e0a690c813b3d4196481341370a7f4b4da5f98b2d3c9dd315ed3779a0cf3f  backend/workagent/responses_transport.py
1f339de2e443df78decf7099f3002327bd5903d7a3151ad699d27babf90a0330  backend/workagent/source_snapshots.py
fcee5872e84836d0ba745f277c6558af939d334957421cc9e4d62b24aaab2ea8  backend/workagent/tui/app.py
86ad420b31f2be0ba4a8571e33f44185ab8814b863060eb4fab256ba9cacf7c6  backend/workagent/tui/files.py
850aab2b7c01a21882facdce9b371a1d59b680e47a2148a0b5460633ed482b23  backend/workagent/tui/files_screen.py
3d39f6e025280c8d4d5895fe7ab33365403ec9d2a30935a68e0171eacb908b36  backend/workagent/tui/research.py
5137387e1d364354c8fb93bc2eb1fac91d42e95ffbee4b61be470378ec99e050  backend/workagent/tui/research_screen.py
4f40c6c778a7bb2857cec9de638b3d7e3f50fa3c419e596a0056175d043e3f1c  backend/workagent/workspace_file_models.py
6fdb84687ea54cbcf30b826bee41878e5596428bd810cfbbe931c08536c5d60d  backend/workagent/workspace_files.py
1748e0f1017a5d503a7a8debadae83e3710201c99102767a7f5a174d4d544c59  contracts/capability-registry-v2.json
7dfe08905eb074c449137addcd54b5da5ba2ade0edcddd5c6b41ca100b44688c  contracts/gateway-research-decision.schema.json
1021339aa2ceb02d95475dafeff5ec660aea5f60a65915702dedfcf8f70a5ecf  contracts/openapi.json
f04d544c1cc611dd3b4e6caa260b850cadf18be42ebd283308e5ff01aaad5a4d  contracts/pnpm-lock.yaml
ed0ccbe8ae29bbf3c84a43fe120d04737e081bed3c8a9d43c61f62e2d8095f9e  contracts/src/schema.d.ts
bf1153b4500c323407042ec1eb1e4fe0e635b8835165824ee643d95179724485  contracts/workspace-files-v1.json
09a7f9f31c647f5e5eb46109f210e0d9530502991c661f10a7dc975a52e8528a  web/src/components/ResearchSources.tsx
c9cefb9c7acefe9c9f4a9e9058b9838ead5a44b6b659f6755efbc9033575bc0b  web/src/components/WorkCard.tsx
ffd14405b1deb7ed00f9aa467e144c9d1d9a273a0d25a68d4aaf5918f78a09a5  web/src/components/WorkspaceFiles.tsx
8364e184c2a6edef754f7df0f6cb299c431c60923631a92bae2d20473b2b5fb6  web/src/lib/client/research.ts
74e236fb15cbcf3a3da1e749b423e8712b51d5cefb0f2f23827378ff1b0ea5e4  web/src/lib/research-contract.ts
8b5ea4bfc6e232d3012a3682783aa0e1053796c51873b5ae27a1f2abb4af32fe  web/test/research-sources.test.ts
52d793194eed1881bdec6fcccbc824485ed6434f6e38edbac5ae55dc25425f1b  web/test/workspace-files-races.test.ts
```

Additional unchanged integration files supporting the findings:

```text
315c2b75f74a172f45212308333654cebc8c641d60d67f08c87bf91c8302396b  backend/workagent/capabilities/observations.py
3c52cbd6ba1845e8d764dde772ddb20ff2885bddb96638b1821b36a658275765  backend/workagent/capabilities/api.py
3b04b0c45a5cd4ac8ac555a184629f17c90fecc10eb165227d3249c7ffd8d92f  backend/workagent/general_worker.py
77f2b77e8eb7c5b58df32fddcc42f0ceefcfcf24ef08682473f8f8596137ffc6  backend/workagent/errors.py
f82b8fe693d1b93c48dfd9d98a886b12f151e315a10fb9d0e703d16bc4527858  backend/migrations/053_capability_gateway.sql
3037abc2d40c6f9da955e399040f3156fc4c3e59364a6d8c28654af18c79ba99  backend/migrations/055_file_gateway.sql
ac3cfc705670fd12593e52ea3758324fa81f5b69863b1b610dee209a2196f90e  web/src/app/conversations/[id]/page.tsx
```

The report could not be saved to `.local/batch3/b32a/REVIEW.md` because this session enforces a read-only filesystem with no approval escalation. No write bypass was attempted; the report is delivered above.