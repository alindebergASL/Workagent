# Synthetic MCP lifecycle (B3.3b candidate)

This opt-in is a local invented catalog, not a private-account connector. Consent
never installs a task grant. The existing capability gateway must also install an
exact `connectors.mcp.read` descriptor and selectors for the run. Its accounting,
run fences, source snapshots and derived-memory visibility remain authoritative.

## Dependency profile

Use a **fresh Python 3.12 environment** with
`pip install --require-hashes -r backend/requirements-connectors.lock`.
This complete app profile replaces, rather than overlays, `requirements.lock`:
it keeps FastAPI 0.115.12 and upgrades Pydantic to 2.12.5 for MCP 2.3.0 / mcp-types
2.3.0, with cryptography 46.0.3. The old app lock remains unchanged. The connector
imports SDK packages lazily; disabled deployments can keep the old profile.
The lock was resolved for Python 3.12; it is not a Python 3.14 lock. MCP's 3.14
Starlette requirement conflicts with this FastAPI pin. Do not force-install it.

Reproduce the lock with `uv pip compile backend/requirements-connectors.txt
--python-version 3.12 --generate-hashes --no-header -o backend/requirements-connectors.lock`.
No existing environment needs to be mutated.

## Fixture setup

Migrate only a fresh disposable `workagent_test_*` database with the existing
migration runner through **066_connector_evidence_authority.sql**, preserving all old
migration checksums. Use its restricted application DSN for the API/worker.

Set `WORKAGENT_SYNTHETIC_CONNECTOR=1`, `WORKAGENT_SYNTHETIC_VAULT_DIR` to a private
0700 dedicated directory, `WORKAGENT_SYNTHETIC_VAULT_KEY_ID` to a fixture key name,
and `WORKAGENT_SYNTHETIC_VAULT_KEY` to an environment-injected base64 32-byte key.
Never print the key or put it in command arguments, fixtures, source or logs.
Retain the same key and private directory across restart; losing the key fails
closed. This is a dedicated local encrypted fixture vault, not a production KMS.
It records a wrapping key ID but does not implement multi-key rotation tooling.

Set `WORKAGENT_SYNTHETIC_LIFECYCLE_DATABASE_URL` privately to a separate restricted
executor role with schema USAGE and EXECUTE only on `connector_finish` and
`connector_revoke_result`. `dev_db.py` provisions it for fresh fixtures. The normal
runtime role cannot attest exchange success or provider-revocation completion.
Do not use an owner DSN for this role. The API/lifecycle process is still trusted
with its vault and executor credentials; this is a SQL-role boundary, not a claim
to survive compromise of that whole process. Web and stdio receive neither.

Run the **fixed code** `PYTHONPATH=backend python -m
workagent.connectors.synthetic_server` on reviewed `127.0.0.1:18769`. It has no
other account/resource configuration. No ambient proxy/netrc, user URL, command,
metadata discovery or redirect is accepted. Set the operator-only
`WORKAGENT_SYNTHETIC_MCP_TRANSPORT=isolated-stdio` to use the fixed reviewed server
through the same pinned SDK discovery/schema checks in a bubblewrap jail. It has
no network, home, procfs or credentials; only read-only reviewed modules and SDK
dependencies, minimal environment and bounded resources. No caller commands,
paths, mounts or environment are accepted. Legacy protocol remains unavailable;
unsupported versions do not silently fall back. Default transport is loopback HTTP.

Use the existing API service and native client. Native commands are `connectors`,
`connector-connect`, `connector-confirm FLOW`, `connector-status CONNECTOR`, and
`connector-revoke CONNECTOR GENERATION` under `python -m
workagent.operator_tui --workspace WORKSPACE ...`. The Textual Files tab opens
**Synthetic connectors**. Connect shows consent; confirm is a separate explicit
synthetic action. Unknown outcomes retain the exact command in the existing
journal for explicit replay. The active composer/draft stays mounted.

All lifecycle routes are authenticated and use the workspace's existing write
membership rule plus X-Schema-Version/X-Request-Id headers. Request JSON contains
only the canonical new DTO fields, with no command envelope, OAuth code or token.
Completion drives real fixture issue/exchange through an internal callback;
there is no public OAuth callback URL.

For ordinary conversation selection install the additive
`capabilities.mcp_composition.SCHEMA` / `POLICY` using the existing provider-grant
bootstrap and separately install the exact tool grant. `MCPRead` arguments are
`kind`, `connector_id`, `access_generation`, and `page` (1–3). Use
`mcp_adapters.input_refs(request)` for the exact connector/generation and processor
selectors. The current task's granted connector metadata is projected into
selection context; no credential handle is exposed. This setup does not authorize
or perform a paid model call.

## Verification and limits

`test_synthetic_connectors.py` exercises offline SDK HTTP/ASGI protocol behavior,
full schema drift, redirects, callback mixups, provider replay/rotation and vault
races. **ASGI is not real TCP proof.** `test_synthetic_mcp_wire.py` starts an owned
real localhost server, executes the current SDK tool, asserts per-request metadata
and headers with no initialize, and revokes. It fails rather than skips without
socket support. `test_synthetic_connectors_pg.py` additionally needs fresh real
restricted-PG DSNs and exercises real reads, source/memory revocation and late
results. Parent owns ordinary worker/client journeys and independent review.

Local revoke commits first and increments generation. Refresh serialization uses
per-secret file locks, with no app DB lock across I/O. Rotated credentials are
stored under the lock before the final generation check so a waiting revoker can
remove/revoke the latest token. The synthetic provider revokes the whole rotation
family even using an older refresh token. Provider outcome remains distinct:
pending on crash, failed on outage, revoked only after an affirmative response.
There is no background provider-revocation reconciler in this slice; a failed or
pending provider outcome stays honest. Local fences still deny all new use.
