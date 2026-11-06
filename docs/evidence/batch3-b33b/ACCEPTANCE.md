# B3.3b — pinned MCP and synthetic authorization lifecycle

**Scoped engineering acceptance: verified.** Feature publication and exact-head CI are a separate final gate recorded in the card/PR handoff. This is not private-account acceptance, deployment, a default merge or Batch 3 completion.

Base: `d9cd7e4ddbca576986424f7664873286c1fcfa00`. Final candidate source is bound by `SOURCE_MANIFEST.json`; the exact optimized build is `sVDEPH9Pel_-AQAeUFWDH`. Controlling requirements are B3.3 in the two-batch plan, implementation appendix §5/T4, evaluation G/§7 and `BATCH_3_DISPATCH_20261028.md`. This replaces the private, stale working checklist—not the original scope.

## Useful actual outcome

A fresh workspace in fixture-v5 used the **ordinary browser composer**, synthetic consent and the real local TCP SDK to read the reviewed catalog and create `synthetic-reading-brief.md`. The brief contains the actual invented reading, source snapshot, recommendation and limitations. A human edited and saved it, then reloaded the exact text. This exercised the final optimized build at **1440, 390 and 320px**, with no page errors or horizontal document overflow. See `records/final-smoke/`; the actual saved human output is `records/final-smoke/expected-human.md`.

The model selections are deterministic fixtures; the MCP transport, provider exchange, PostgreSQL, API, worker, browser actions and saved file are real. **Zero paid product calls. No autonomous-model usefulness claim.** The older v3 human revision is separately retained and read back, not overwritten by the fresh proof.

## Original acceptance reconciliation

| Requirement | Implementation / actual evidence | Disposition |
|---|---|---|
| Current official protocol and maintained SDK compatibility | Official version/lifecycle and SDK snapshots retrieved during this task; `checks/manifest.json` records URLs, status, hashes, signatures and MIT license. Final readback verifies all five retained snapshots. `mcp` and `mcp-types` **2.3.0**, protocol **2026-07-28**, Pydantic **2.12.5**, Python **3.12** isolated hash-locked profile. Real wire test checks `server/discover`, per-request metadata/header and no `initialize`. | PASS; no remembered-2025 assumption. |
| Version pin / optional legacy behavior | Runtime validates installed SDK versions and exact protocol; no automatic negotiation retry. Legacy/auto/arbitrary stdio rejected. | PASS; legacy adapter deliberately unavailable, not claimed supported. |
| Real local server/tool execution and ordinary product path | `test_synthetic_mcp_wire.py`, restricted-PG gateway tests and fresh final browser → worker → real TCP → file journey. | PASS, not ASGI-only. |
| Reviewed server/tool subset, immutable schema digests | Exact server identity/capability set and full tool metadata digest before/after call; one reviewed `catalog_read`, bounded pages/output. `test_full_schema_pin_not_hint`, schema-poison-before-dispatch test. | PASS; changed description, annotations, output schema, UI metadata or unknown tools refused. |
| Unsupported sampling/elicitation/roots/tasks/UI | Empty client authority, no callbacks/extensions, exact server capabilities, no input-required/claimed result acceptance. Tests verify wire capabilities and reject UI extension/poison. | PASS; these features are unavailable. |
| Scoped cache and principal/workspace/task/generation isolation | SDK cache disabled and tool-list bypassed; no shared reusable connector cache. Existing run-bound sources retain principal, workspace, conversation, exact grant/pins and access generation. Cross-workspace/conversation/project checks plus connector/processor/generation/installation/expiry fences. | PASS via no cross-principal cache, not a new cache product. |
| Discovery SSRF / redirect / ambient credentials | Fixed reviewed loopback endpoints only; exact issuer/audience/resource/redirect, no arbitrary URL, proxy/netrc disabled; redirect rejected before SDK follows it. Metadata/redirect adversarial tests. | PASS within synthetic allowlist, not arbitrary Internet discovery. |
| Minimal environment / isolated stdio | Fixed code via maintained SDK and bubblewrap; no caller command/env, no token, no HOME/procfs/network, read-only reviewed modules/dependencies and bounded resources. Real product gateway stdio and hostile isolation probes in final suite. | PASS; no host shell fallback. |
| PKCE/state/issuer/audience/redirect/expiry/single-use | Real local provider exchange and callback replay/PKCE/mix-up tests; server-side bound flow; canonical DTOs contain no code/token. | PASS; synthetic internal callback only. |
| Vault handles, refresh race and no token propagation | Dedicated envelope-encrypted vault, wrapping key ID, opaque application handle, per-secret locking and rotation tombstones. Locked refresh/revoke and late-exchange real provider tests. | PASS; fixture vault, not production KMS or multi-key rotation tooling. |
| Local-first revoke, cancel, cache denial, late result exclusion | Generation increment commits before remote revocation. Queued/inflight denial, late output exclusion, source/context/receipt/publication/memory fences; prepared provider count/dispatch blocked after revoke. | PASS, final restricted-PG suite. |
| Truthful provider pending/failed | Local revoke remains effective on provider outage; pending/failed remain separate. Browser and native show local revoked/provider failed; tests cover positive provider revocation and races. | PASS; no automatic provider-revocation reconciler claimed. |
| Secret canaries absent from logs/files/memory | Vault plaintext/tombstone tests, reflected bearer rejected before snapshot/receipt/context, DB content scans and actual minted-token scan in `records/final-readback.json`. Packaging known-secret and pattern scan in `PRIVACY.json`. | PASS within recorded scans; no API-compromise protection claim. |
| Actual web consent/status/revoke and phone layout | Fresh current build consent/status and human-file journey at all three widths. Retained real v3 revoke/provider-failed/restart/denial-clearing records/screenshots. | PASS with explicit proof reuse, not all old screenshots relabeled new-build. |
| Actual native consent/status/revoke/restart and human preservation | Real PTY `records/pty/result.json` and `restart-result.json`, screenshots; stale Select and pending flow cleared on denial, modal shortcuts fenced, human composer survives. | PASS; not an offscreen widget-only proof. |
| Production build and source binding | `checks/build-final2.log`, `BUILD_MANIFEST.json`: 328 web/contracts inputs byte-equal to retained build lane, 194 non-cache outputs hashed, zero differences. Fresh smoke uses this build. | PASS; binding is file comparison, not hermetic compiler tracing. |
| Independent security-focused review | One Astra reviewer session `01a18673-bf52-7002-8035-960b460f6ceb`, initial findings and same-reviewer scoped closure retained. | PASS for scoped closure; parent owns final tests/binding/CI. |
| Public connector predecessor and private pilot | B3.3a remains separately accepted. Named private-account/resource/processor consent card `t_bb46e05f` is still blocked/unmet. | Public predecessor reused; private pilot NOT exercised and nonblocking to this engineering slice. |

## Verification counts and history

- Final integrated suite: **46 passed, no skips** (`checks/integrated-final2.log`). Covers the five connector/wire/stdio/security test modules. This is the controlling final targeted backend result.
- Final focused web run: **39 passed** (`checks/web-connectors-final.log`). Optimized final build includes successful TypeScript and route generation.
- Earlier **43 passed**, **2 targeted closures passed**, **34 passed** and earlier web **30/39** are overlapping runs, **not additive unique totals**. Compatibility runs are separate: **48 passed**; PG compatibility **29 passed / 1 failure**, with the same CLI provider-import failure reproduced on unchanged base. Neither is represented as a clean full-suite pass.
- Earlier failing migration/fixture/test/build and client attempts remain retained. Initial migration SQL precedence failure rolled back before repair; installed 065/066 were not subsequently rewritten. Final readback verifies all 66 installed migration checksums in both v3 and v5. v4 preserves its failed final-suite attempt; v5 is the passing current installation.
- v3's first ordinary callback selected a metadata-only duplicate and produced an unknown outcome. It is retained and **not replayed or reclassified**. The corrected fresh fixture reads the actual text-bearing snapshot. Failed native/browser attempts likewise remain historical.
- The first extra final readback probe incorrectly looked for editable human output in `generated_blobs`; no DB change occurred. Corrected read-only inspection uses the actual current artifact revision, matching the real product storage path. Both v3 and v5 human revisions are exactly 825 bytes, with separate hashes in the final readback.

## Review, authority and privacy boundaries

The same reviewer closed four concrete findings: retained evidence bypassing installation/expiry, reflected bearer retention, disabled-path cryptography import, and a faulty SQL test column. Earlier stdio wiring and late-exchange cleanup are also closed. `security-review-closure.md` expressly did not run final tests or certify exact source/CI. The final `policy.discover` scope reduction/import repairs are covered by the final 46-test run, not retroactively attributed to the reviewer.

Migration 066 is additive. Normal runtime SQL cannot call exchange/revocation attestation functions; the separate executor has only the needed function privileges. **The API process is trusted with both vault and executor credentials. This is not protection against API-process compromise.** Web/stdio receive neither.

Raw `.env`, vault, worker contexts/capabilities, ANSI dumps and agent logs stay private. `PRIVATE_BOUNDARY.json` hashes retained material; selected logs/screenshots/results only are published. SQL-URI scanning has only three exact inspected Python f-string exceptions in `backend/dev_db.py`, not a blanket brace exclusion. Positive controls include actual-shaped SQL credentials with braces, GitHub tokens and bearer strings. Known private values are checked before any exception. Actual minted credential canaries are checked in memory only and never serialized.

`records/proof-reuse.json` compares all six unchanged web-owner files to the retained lane and binds current native files. Native modification-time/checkpoint continuity is supporting evidence, not a fabricated historical hash attestation. Older revoke/restart screenshots remain labeled retained proof. Fresh final-build ordinary-use proof plus unchanged broad coverage and final security tests are the proportionate acceptance basis.

## Limits and onward work

Only a fixed synthetic account/catalog/read tool is enabled. No private OAuth account, new processor, external business write, paid product call, installed-data maintenance, cleanup, default merge or deployment occurred. Owned proof ports 18769/18239/13239 refuse connections after ownership-checked shutdown; databases/vault/history are preserved. Preexisting `contracts/pnpm-lock.yaml` remains untracked and unchanged; separate memory-link/Cloud work is not integrated.

Existing successor is **B3.4a `t_0ff857b1`**, evidence-backed human-reviewed procedures. No new graph or reviewer campaign. See [HANDOFF](HANDOFF.md) for operation and cost boundaries. The final card/PR publication receipt must establish pushed exact head and CI before this card is completed.
