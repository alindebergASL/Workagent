**Scoped verdict: changes required before B3.3b acceptance.** This continues the same review against the updated uncommitted candidate on `d9cd7e4`. No files changed, services started, accounts accessed or paid models run.

1. **High — retained MCP evidence misses current installation/expiry checks. Source-confirmed; PostgreSQL reproduction outstanding.**  
   [065_synthetic_connectors.sql:134](/home/ubuntu/workagent-continuation-20261026/backend/migrations/065_synthetic_connectors.sql:134) adds only `connector_read_authorized` to snapshot visibility. That predicate checks connector state/generation but omits tool-grant expiry and installation enablement. The predecessor’s corresponding checks apply specifically to GitHub capabilities. Consequently, disabling the MCP installation can block new calls while leaving its existing snapshots—and consumers following those source dependencies—eligible.
   
   **Required test:** retain an MCP snapshot and derived memory, disable its installation while keeping the connector connected, then attempt snapshot/file reads, retained-context reuse and prepared provider dispatch. Repeat with an expired tool grant. Repair through a successor migration; preserve installed 065.

2. **Medium — an MCP response can copy its bearer credential into retained evidence. Reproduced with the real SDK and an in-memory mock transport.**  
   [mcp_client.py:90](/home/ubuntu/workagent-continuation-20261026/backend/workagent/connectors/mcp_client.py:90) returns text and structured content without checking for the supplied credential; [mcp_adapters.py:42](/home/ubuntu/workagent-continuation-20261026/backend/workagent/capabilities/mcp_adapters.py:42) serializes both into snapshot material. A response with the unchanged reviewed schema and a synthetic credential canary in `summary` passed SDK validation and reached snapshot text.
   
   This requires a malicious or faulty HTTP provider response; it does **not** demonstrate leakage from the fixed benign fixture or isolated stdio. Reject credential-bearing output before persistence. Extend the canary test through actual snapshot, receipt and model-context paths; the existing test uses a benign provider.

3. **Medium — disabled connector deployments acquire an unconditional missing dependency. Reproduced without starting the API.**  
   [api.py:380](/home/ubuntu/workagent-continuation-20261026/backend/workagent/api.py:380) imports the connector router, which imports lifecycle → vault → `cryptography`. The default environment lacks that package. Importing the router with the connector flag absent raises `ModuleNotFoundError`; disabling the feature therefore does not preserve the documented old dependency profile.
   
   Defer optional imports until enabled, or explicitly change the supported baseline. Verify application construction using the unchanged default lock with connectors disabled.

4. **Medium — the new restricted-SQL receipt test contains an invalid attack statement. Source-confirmed.**  
   [test_connector_security_pg.py:61](/home/ubuntu/workagent-continuation-20261026/backend/tests/test_connector_security_pg.py:61) filters `tool_attempt_events` by `workspace_id`, which that table does not contain. This produces `UndefinedColumn`, outside the expected authorization exceptions, before testing receipt protection.
   
   Select the receipt through `attempt_id` joined to `tool_attempts`, verify the target exists, then assert permission/immutability denial. A fresh installation alone does not repair this test.

The **direct SQL attestation boundary remains unverified**, rather than a confirmed HTTP exploit. Migration 065 explicitly grants existing tool-grant readers execution of `connector_finish` and `connector_revoke_result`; those functions accept caller-supplied handles/outcomes. The fresh provisioning helper does not itself grant these connector functions after migration. Thus “restricted role” alone establishes neither availability nor protection. Read back the actual role’s function privileges, then test an existing active principal—not only `"intruder"`—attempting fabricated completion and `provider_result='revoked'` without provider activity. Current tests do not resolve that boundary.

The updated repairs are acknowledged:

- Isolated stdio is now wired through shared discovery/schema validation, and the adapter hash includes jail/bootstrap. The earlier unwired-gap finding is closed at source level.
- Rejected late completion now requests provider token-family cleanup. My narrow in-memory reproduction confirms that call occurs.
- Native denial now clears options and flow and disables confirmation; the narrow reproduction passes.

Protocol `2026-07-28` and SDK/types `2.3.0` match the checked official references and installed package metadata. Explicit discovery, disabled caching, schema digest checks, redirect rejection and unsupported callback defaults have supporting source evidence. [Protocol specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [SDK release](https://pypi.org/project/mcp/2.3.0/).

The retained first run reports **34 passed**. Attempt 2 reports **34 passed / 4 failed**, with installation drift before the affected checks execute. Neither establishes acceptance of the current candidate. Actual browser/native stale-response journeys, desktop/phone rendering, restart, ordinary-conversation selection→read→saved output, human-edit preservation, and the complete principal/project/workspace isolation matrix remain outstanding. No source-only green acceptance is given.

**Exact files reviewed**—repository-relative; integration files and unchanged dependencies were reviewed at relevant sections:

- Instructions/evidence: `AGENTS.md`; `docs/DEVELOPMENT_AUTHORITY.md`; `docs/GENERAL_MODEL_AUTHORIZATION.md`; `docs/PRODUCT_CONTRACT.md`; `docs/BUILD_PLAN.md`; `STATUS.md`; `.local/batch3/b33b/RESUME.md`; `.local/batch3/b33b/ACCEPTANCE-WORKING.md`; `.local/batch3/b33b/protocol/manifest.json`; `.local/batch3/b33b/integrated-attempt1.log`; `.local/batch3/b33b/integrated-attempt2.log`.
- `backend/workagent/connectors/`: `api.py`, `models.py`, `registry.py`, `oauth.py`, `vault.py`, `revocation.py`, `service.py`, `mcp_client.py`, `synthetic_server.py`, `stdio_jail.py`, `stdio_bootstrap.py`, `synthetic-tools.json`, `README.md`.
- `backend/workagent/capabilities/`: `mcp_adapters.py`, `mcp_composition.py`, `broker.py`, `policy.py`, `registry.py`, `github_composition.py`, `observations.py`.
- `backend/workagent/`: `adaptive.py`, `api.py`, `conversations.py`, `general_responses.py`, `operator_client.py`, `operator_tui.py`, `products.py`, `responses_ledger.py`, `responses_transport.py`, `service.py`, `db.py`, `research.py`, `workspace_files.py`, `source_snapshots.py`, `retained_results.py`, `memory/retrieval.py`.
- `backend/workagent/tui/`: `app.py`, `connectors.py`, `connectors_screen.py`, `transport.py`, `research.py`.
- `backend/migrations/`: `053_capability_gateway.sql`, `054_workspace_files.sql`, `055_file_gateway.sql`, `058_typed_memory.sql`, `059_grounded_research.sql`, `060_research_dependency_visibility.sql`, `063_github_public.sql`, `064_tool_scope_reductions.sql`, `065_synthetic_connectors.sql`.
- `backend/tests/`: `test_domain.py`, `test_synthetic_connectors.py`, `test_synthetic_connectors_pg.py`, `test_connector_security_pg.py`, `test_synthetic_mcp_wire.py`, `test_mcp_stdio_isolation.py`, `fixtures/synthetic_connector_lifecycle.sql`.
- Backend support: `backend/dev_db.py`, `backend/export_contracts.py`, `backend/requirements.txt`, `backend/requirements.lock`, `backend/requirements-connectors.txt`, `backend/requirements-connectors.lock`.
- Web: `web/src/lib/client/connectors.ts`, `web/src/lib/client/session-scope.ts`, `web/src/components/ConnectorPanel.tsx`, `web/src/components/Shell.tsx`, `web/src/app/connections/page.tsx`, `web/src/styles/products.css`, `web/test/connectors.test.ts`.
- Generated connector entries inspected, without equivalence acceptance: `contracts/openapi.json`, `contracts/capability-registry-v2.json`, `contracts/src/schema.d.ts`.
- SDK dependency sections: `.local/batch3/b33b/venv/lib/python3.12/site-packages/mcp/client/session.py`.