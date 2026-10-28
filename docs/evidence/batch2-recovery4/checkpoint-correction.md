# Recovery4 correction checkpoint

The exploratory30-file shared-runtime campaign was deliberately interrupted after ~16minutes to diagnose four already-observed failures within this card's runtime budget. Exit2; actual pytest summary **128 passed,4 failed**, not a complete suite. The original XML includes an anonymous incomplete testcase: `results.json`'s initial naive aggregate129passes/133cases is invalid for this interrupted suite; authoritative completed count is132(128+4). Original red log/XML/results remain unmodified.

Root causes and bounded corrections:
- Controlled provider-free CLI crossed into `responses_transport` through unconditional `retained_results` import during admission. Guard that import with actual grant presence; controlled turns retain `bounded=False`, managed standing/sustained expression unchanged. The existing subprocess regression guards provider imports, credential lookup and nonloopback sockets.
- Two HTTP/CLI journey expectations and one revocation accounting assertion still expected20k per request.50k reservation policy already exists in HEAD and migration041; update only test expectations to400000/eight and50000/one. Historical{}=>20000 policy and installed/product authority are unchanged. Explicit legacy fixed-budget tests will also rerun.

Changed files only: `backend/workagent/conversations.py`, `backend/tests/test_general_responses_journey.py`, `backend/tests/test_general_responses_gates.py`. No web/contracts/model/budget/DB changes. Independent bounded Astra source review PASS; preserved separately. Entire original core411pass evidence predates this correction and is **not final exact-source proof**.

Final campaign will re-freeze source and run known failures first, then the entire34-file core plus full affected conversations/journey/gates/fixed-budget suites and selected durable response admission/recovery/handoff regressions, then all frontend/contract/build gates. The exploratory30-file broad suite is not a full-backend acceptance requirement and will not be represented as completed; exact final selection is authoritative. Runtime limit remains unchanged. Batch2 and user journeys remain incomplete.
