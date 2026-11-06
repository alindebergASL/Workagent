**HOLD — two actionable findings in B3.2c.**

1. **P2 — “Nothing ran” can contradict actual execution.** [tool-activity.ts:261](/home/ubuntu/workagent-continuation-20261026/web/src/lib/tool-activity.ts:261) labels every `unavailable` result “Compute unavailable — nothing ran.” The existing worker can return that status after execution when subsequent collection/cleanup encounters an error (`sandbox/service.py:166`). A synthetic local probe produced **“Compute unavailable — nothing ran (exit 0)”** while retaining stdout. Reserve “nothing ran” for the short `ComputeUnavailable` variant; use an uncertainty/failure label for full execution receipts.

2. **P2 — Refused downloads retain stale output and enabled download controls.** [ComputeReceipt.tsx:72](/home/ubuntu/workagent-continuation-20261026/web/src/components/ComputeReceipt.tsx:72) only sets an error. When current export/dependency authorization returns 404, the shared helper does not fence the session, and this component retains stdout, provenance, and download buttons. A local mocked-404 probe confirmed all remain displayed and download becomes enabled again. Propagate authorization/source-change refusals to invalidate the affected receipt and clear its output/export controls until explicit successful refresh. Download bytes themselves remain protected.

Validation: **14 native tests passed**. Both local reproduction probes confirmed the findings. Web Vitest could not execute tests because its temporary-directory creation was blocked by the read-only environment. Browser/PTy integration and final manifests remain outside this review. Private oracle unopened; no source edits or product/network calls.

Reviewed source SHA-256 hashes, relative to repository root:

```text
ace06cf7b3fde13cc0e886e34134df15e78f013d805f55ad709c93c270970a2e  backend/workagent/operator_client.py
4816c1e6eb840dbe98707e52afb0c5af4cd58d83f4b29bc72e13a666977062a6  backend/workagent/tui/app.py
92ae721234448fd411c78f52c64d49f140ba2d6f37c28c84e9f53d8c4b626dd1  backend/workagent/tui/tool_activity.py
0b5c8b185ccaa3d645d086375c4b232902d2f37a37a4f5d6cb00cfca61191a68  backend/workagent/tui/tool_activity_screen.py
3edc3f6c4bd637590bd1e06a4009299458b29b3d2f4e597bef8d4d47249d34cf  backend/tests/test_tui_tool_activity.py
810a6a29902a9e5e9b488486d941191147879e71c18f58d6fcc9d7a52d3bb968  web/src/components/ToolActivity.tsx
021926fa0cad46a5719cb6091b4d25cf2e25d88a6b9d09ebecf49873a081fb58  web/src/components/ComputeReceipt.tsx
f971c7c3ea716535a30ff1f544ea80ec015c701eff7be327b926d30063842c93  web/src/lib/tool-activity.ts
43255b940ad2b9c221e77c44b0401abaad474902e2314ced07ea8ab8e2e29a9f  web/test/tool-activity.test.ts
12233e35236362aae1c793f8823889ec0bc3f3ecad7bcac61e9bdb111be981db  web/test/compute-receipt.test.ts
```