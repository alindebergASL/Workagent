**Scoped closure: all four findings from this same review are closed. No remaining concrete defect identified within those closures.**

| Finding | Closure evidence |
|---|---|
| Retained MCP evidence bypassed installation/expiry checks | [Migration 066](/home/ubuntu/workagent-continuation-20261026/backend/migrations/066_connector_evidence_authority.sql:2) adds current authority, active/unexpired grant, exact capability pins and enabled/exact installation checks. Targeted tests exercise installation and expiry denial. |
| Reflected bearer entered evidence | [MCP client](/home/ubuntu/workagent-continuation-20261026/backend/workagent/connectors/mcp_client.py:91) rejects the exact credential before returning material. The hostile SDK/ASGI gateway test checks absence from snapshots, receipts and context. |
| Disabled deployment required cryptography | [Lifecycle service](/home/ubuntu/workagent-continuation-20261026/backend/workagent/connectors/service.py:13) imports the vault lazily after enablement. The retained default-environment application-construction check passes. |
| Restricted-SQL test used a nonexistent column | [Corrected test](/home/ubuntu/workagent-continuation-20261026/backend/tests/test_connector_security_pg.py:61) selects receipts through `attempt_id`; active-principal attempts to call completion/revocation attestation are also covered. |

The earlier SQL-boundary uncertainty is resolved within the documented trust model: migration/provisioning separate attestation privileges from the general runtime role. The API process remains trusted with executor and vault credentials; this does not claim protection against compromise of that process.

Native denial clearing, old-selection clearing and modal shortcut fencing are present. Reviewed browser/native result records and selected screenshots support denial clearing and draft preservation across restart. The previously closed stdio wiring and late-exchange cleanup findings remain closed.

Retained logs report **43 passed** and **2 targeted closure tests passed**; these are separate runs, not an asserted unique-test total. I ran no tests, started no services and edited no files. The still-running final suite, exact-source evidence binding and CI acceptance remain the parent’s responsibility.

Exact closure files inspected:

- `backend/migrations/066_connector_evidence_authority.sql`
- `backend/dev_db.py`
- `backend/workagent/connectors/{mcp_client.py,service.py,revocation.py,README.md}`
- `backend/workagent/tui/{app.py,connectors_screen.py}`
- `backend/tests/test_connector_security_pg.py`
- `.local/batch3/b33b/{disabled-app-import.log,integrated-attempt6.log,review-closures-attempt1.log}`
- `.local/batch3/b33b/evidence/browser/{revoke-result.json,after-result.json,scope-denied-390.png}`
- `.local/batch3/b33b/evidence/pty/{result.json,restart-result.json,native-denied.png,restart-human-draft.png}`