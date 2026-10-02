# Runtime decision and evidence boundary

## Current mode
Local deterministic fixture adapter is the only executable product mode. It is not a
selected live agent runtime and does not qualify live A16/S1 or A17/S0. `MODE=live`
must fail closed; no silent fixture fallback, credential inference or new paid calls.

## Managed-first discovery
Primary documentation retrieved during this build:
- https://developers.openai.com/api/docs/guides/agents
- https://developers.openai.com/api/docs/guides/agents-api/architecture
- https://developers.openai.com/api/docs/guides/agents-api/configuration

The current docs describe a managed Codex harness with durable sessions, application
function handlers and `environment.type=none`. The Python example uses
`client.beta.agents.sessions.create` and `gpt-6-astra`. This establishes documentation,
not account access, installed product SDK support, lifecycle proof or entitlement.

Local Codex development cache lists `gpt-6.1-sol` and `gpt-6-astra` with
`supported_in_api=true`; CLI 0.160.0 reports a ChatGPT login. Neither observation proves
this product can call either model through a managed Agents API project.

## Selection remains pending
The managed route is the first candidate. No required-contract failure has been
observed, so no SDK/Responses contingency is selected. There is no Temporal service,
second agent loop or default product delegation. An unavailable account is not proof
that the managed API fails a contract.

Required before a live spike: authorized project/secret reference, explicit maximum
incremental spend, permitted synthetic-data route, verified SDK/model/API access and
trace/retention controls. Do not store secret values in Git or chat.

## Ownership map
- PostgreSQL/domain services: assignments, source/access scope, immutable revisions,
  human decisions/proposals, commands, task inspection, audit/outbox, run/fence state.
- Application dispatcher: one active lease/fence, admission/control checks, durable
  submission intent and reconciliation before retry after uncertain acknowledgement.
- Selected live runtime (not yet selected): sole owner of model/tool loop, once tested.
- Broker: rechecks current principal, assignment sources, access generation, fence,
  budget, operation and exact applicable grant at dispatch and commit.
- Fixture computation: bounded deterministic derivation; no network/external effects.
- Human app: authorized save and exact proposal acceptance, never model-callable tools.
- Outbox: stable event consumption, not a second owner of model/provider retries.

## Required live observations: all NOT OBSERVED
Session/turn binding; stream loss and same-session restart; basic approval wait/resume;
configuration change/session replacement; actual compaction event; usage/cost and
trace redaction/retention; selected-runtime approved skill loading; enabled/disabled
skill comparison; model outcome/latency comparison. S4 multi-hour lifecycle remains
out of scope. Application fixture proofs will be recorded separately.

## Product bundle
`agent/v0.1.0/runtime.yaml` and `agent/v0.1.1/runtime.yaml` are product schemas
serialized as JSON (valid YAML), not provider configuration. Reviewed approval registry
snapshots are exact-hash allowlisted: existing runs retain their original registry and
manifest, while explicit operator activation selects a version for future runs.
Runtime sources control neither path. The loader pins every byte, offers only
registry+scope intersections, and assembles guidance and untrusted evidence separately.
Scripts and prepare-contribution are inactive.

Actual PostgreSQL tests establish a proposed version absent from the old approval
registry cannot activate through that registry; explicit approved 0.1.1 activation,
continued 0.1.0 run pins, exact prior instruction/source-input reproduction after
rollback, and denial after current source revocation. Fixture worker context loading,
activation audits and outbox/fenced recovery are integrated and exercised. These are
application adapter/fixture observations, not provider execution or live skill ablation.
