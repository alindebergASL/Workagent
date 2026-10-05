# Companion-work frontend integration verification

This supersedes experience/ACK gaps in GENERAL_PARENT_VERIFICATION.md. Current published SHA is pinned by PR #9's final integration comment. Application checkpoint: `37f1c1098411839312f4e3ca40b50a17188c5490`, built from Claude's exact delivery `43cfe3f984382ff39e5b2c11b1e972c9a6468937` and three bounded integration corrections. Backend, generated contracts and runtime are byte-identical to the verified19e1478 parent. No reset, new harness, model route or backend feature.

## Integrated experience

- Result-first CSV discrepancy/totals, all table columns, contained phone scrolling and readable rounding labels.
- Conversation beside table/tool, phone Work/Conversation switch with both panes mounted, and shared reply path from either surface.
- Individual labeled whole-number tool fields, immediate valid draft edits, save/discard, observed result and shipping requirement change3750→4250.
- Machinery moved to disclosure while retaining exact scope/hash/revision binding and verbatim i64 strings.

Claude's explicit B2/B3 generated-contract ACK is now recorded at [PR9 comment6000227871](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6000227871). Claude retains frontend design ownership. The parent reported and corrected only material integration regressions via [6001415876](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6001415876), without reconstructing the frontend.

## Review corrections

1. A late reply callback from an unmounted surface could erase a newer unconfirmed send. Exact-attempt conditional journal cleanup now protects both the newer pending payload and its draft; success and definitive rejection tested.
2. Invalid per-field tool text previously left last-valid values actionable and vanished on navigation. Raw labels/values now persist separately from contractual Body, mark the draft dirty and block Save/Run/Apply until valid/applied. Invalid data never enters typed payloads; Discard restores saved input.
3. Retained calculated/check columns previously let an unchecked human-edited CSV claim a match. Result headlines now require the corresponding saved/proposal observation binding. Disclosure regressions explicitly open and inspect visible semantics.

A final re-review also reproduced a storage-quota regression: when journal persistence failed but reads remained available, confirmed sends could remain retry-locked. Cleanup now distinguishes a failed persistence attempt from a genuinely newer journal entry. Successful sends and successful exact in-memory retries unlock while prior late-callback protections remain tested. Quota-limited in-memory recovery is not a claim of durability across reload when storage cannot accept writes.

## Personally rerun

- **81 frontend tests**, typecheck/lint/format and production build passed after corrections.
- **15 mock Playwright regressions** passed after corrections; real-mode build restored. Evidence `.local/parent-integration/37f1c10-mock`; owner evidence not overwritten.
- **17 focused server-free DOM regressions** passed, including both late reply races, invalid value/label preservation, save/run/apply gates, immediate valid edits, unapplied restored raw input, disclosure visibility and stale headline binding. These are fixture-transport regressions, not live execution proof.
- **72 relevant PostgreSQL tests** personally rerun in this integration: conversations/products/worker failure isolation. Backend unchanged throughout these frontend corrections. Prior403 full backend pass is reused by verified byte identity, not claimed as a new full-suite run.
- Generated-contract canonical JSON/OpenAPI/TypeScript drift/typecheck passed; backend/contracts/runtime diff against19e1478 is empty.
- **Real clean application checkpoint37f1c10**, fresh PostgreSQL and production web/API/continuous controlled dispatcher: `scripts/verify_general_integration.py` passed CSV edit/save/export/reopen, per-field shipping change, reply beside work while retaining unsaved notes, malicious imports, actual lost response/reload/exact replay, consumer outage/unavailable and process restart/same-run recovery. No manual worker tick.
- **Additional real320px companion probe:** `scripts/verify_product_companion.mjs` preserves unsaved notes and reply draft across Work/Conversation switching, commits a send then drops its response, navigates to the full conversation and replays the exact command once, returns to retained unsaved notes. No duplicate human message or page errors. It also verifies invalid Quantity3.5 plus dirty notes survive reload, Save disabled and no enabled Run action, then Discard restores3. The first test attempt incorrectly expected the dirty-state Run button to remain present; the actual UI hides it, so the assertion now checks that no enabled Run action exists.
- **Real B1 conversation journey** after correction passed source-free start, steering, CAS, lost-response/reload, paused handover and cancel on a new database.

Actual evidence: [observations.json](evidence/companion-integration/observations.json), [tool and companion](evidence/companion-integration/tool-companion.png), [table320](evidence/companion-integration/table-320.png), [mobile preserved draft](evidence/companion-integration/mobile-preserved-draft.png). All data is synthetic. CLI/domain counts and old evidence are not relabeled as new UI tests.

Representative real runs: CSV43461433-2533-4ba3-8b0f-abbb432c343e; changed rowsaebd103a-e0c7-4e8c-9259-e56edf2e9757; tool shipping98b04521-5275-420e-b2e7-c2fd271f99fa; exact-i6490acd6cc-6d44-4290-806d-92bdad427109; recovered outage850dab3b-fec2-4a1b-b008-cfed4ef7edd8.

## Reproduction and verdict boundary

Build real-mode web, install backend/optional local-tools dependencies, then run `python3 scripts/verify_general_integration.py --env .local/new-companion.env --output .local/new-companion`. For the extra cross-surface/mobile probe, start normal `scripts/workagent.py serve` with that same environment and run `node scripts/verify_product_companion.mjs .local/new-companion`; stop test processes afterward. Each companion probe expects one fresh fixture run so it can assert exact message counts. No credential file belongs in published evidence.

Engineering passes these controlled integrated/recovery paths subject to the final independent correction-review/CI verdict pinned in PR9. Desktop/phone interaction experience is personally browser-verified, but Andrew's product/prototype acceptance remains NOT TESTED. General-model usefulness remains NOT TESTED; explicit operations, supplied WAT and controlled replies are not model reasoning. Remaining general-product limitations are controlled-reply wording/behavior and operator-selected operations, not missing companion wiring or comma-separated fields. No new Workagent model calls/spend/private context/external business effects/default merge/deployment.
