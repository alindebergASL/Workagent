# B01 certificate-funded accounting

This target subaccount has only its imported issuer certificate. Its full amount
stays recorded in the legacy $275 campaign. That campaign is historical, not the
owner's newly authorized rebuild budget; follow GENERAL_MODEL_AUTHORIZATION.md for
configured OpenRouter spending authority. This describes the transitional implementation,
not permission to issue further legacy certificates for the rebuild. Local
settlement never changes alpha, releases historical liabilities, or refunds or
reissues a certificate. No database/socket/live checks were run for this revision.
The initial SQL read failed because the file was under Ubuntu's private home. Parent
may correct non-secret SQL staging within existing fresh-target provisioning authority,
after verifying target identity and partial effects. Home isolation and alpha's retained
financial data remain protected; this document grants no additional access or spending.

## Envelope and documented basis

Policy v2 accepts the authorized `typesafe/jev-router` route and multiple/unrestricted
providers. There is no slug ban, single-provider gate or per-run evidence string.
`jev_policy()` in `workspace_accounting_policy.py` produces the default configuration.
The owner-selected policy and price caps are fixed in the funding binding.

The final Chat Completions body includes
`provider.max_price.{prompt,completion,request,image}`, `allow_fallbacks:false`,
`require_parameters:true`, `max_tokens <= 4096` and
`prompt_cache_options:{"mode":"explicit"}`. Messages are text and client function
calls only, with no cache breakpoints. Media, OpenRouter plugins/server tools,
Decisions, auxiliary inference, extra choices, service tiers and billing headers
are not admitted. Reasoning effort and opaque reasoning replay remain supported.
The transport serializes once, hashes those exact bytes, reserves, durably claims
one-use dispatch, then sends that identical string. No provider retry.

The basis is explicit and conservative:

- [Jev FAQ](https://openrouter.ai/typesafe/jev-router) describes billing at the serving model's price and context windows up to 1,000,000 tokens. Possible advisor work is not evidence of a separately charged unbounded fee.
- [Provider selection](https://openrouter.ai/docs/guides/routing/provider-selection) documents maximum prompt/completion prices per million tokens, per-request pricing, and routing to providers supporting the requested output length.
- [Reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) describes output/reasoning limits, with endpoint differences. Accordingly the default reserves **one million input AND one million completion/reasoning tokens**, independently, despite requesting at most 4096 output tokens. This deliberately overbounds the advertised context rather than assuming chars/4 or universal inclusive `max_tokens` behavior.
- [Caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching) documents explicit mode without breakpoints to disable OpenAI cache writes; Anthropic/Google cache writes require breakpoints, which this wire disallows. Other automatic discounted cache reads do not increase the plain-input envelope.

Envelope = round UP to microUSD of
`inputTokenCeiling * max_price.prompt / 1e6 +
completionTokenCeiling * max_price.completion / 1e6 +
max_price.request + extraChargeUsd`.
Default caps $1/M input, $5/M completion, $0/request and no enabled extra fee
produce a **$6 temporary reservation**, not a $6 charge. Both Jev token ceilings
must be at least one million. Other routes require their configured context bounds;
changing the approved route is not done by the adapter. A smaller certificate or
insufficient free balance refuses reserve; caps can be chosen before binding/funding.

Engineering assumptions: the advertised context bounds billed text/reasoning;
`max_price` constrains the serving price for this request; the FAQ's serving-model
billing applies to the request; the disabled features add no separate charge.
These are reliance on the documented contract, not claims of a universal upstream
guarantee. Receipt cost overruns freeze further dispatch. The narrow question if
actual behavior contradicts this basis is: **does `max_price` constrain the actual
context-tier price and all serving charges of this Jev request, including any
advisor billing?** A practical stronger control is a dedicated OpenRouter native
spending limit scoped to this subaccount and no larger than its certificate;
Parent owns any such key/limit work. No key operation or new permission gate is
implemented here. Do not invent an `extraChargeUsd` value to cover an unknown fee.

## Atomic settlement and recovery

Funding, reservations, dispatch, receipts and settlements are append-only.
All financial transitions serialize on the binding row. Runtime gets only the
policy/status/reserve/dispatch/retain functions, never table writes or admin import.
Receipts and settlement commit in one transaction before acknowledgement.

[Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
defines `usage.cost` as the total account charge. A received **terminal** response
with a finite nonnegative monetary cost no greater than its envelope settles to
that provider-reported amount, rounded UP to microUSD. Tokens never substitute for
cost. This is not a verified invoice. A definitive `not_dispatched` receipt settles
to zero only under the dispatch lock, with no dispatch or prior uncertain receipt.
A finalized request can never dispatch again, even if its entire envelope was freed.

Unknown/interrupted requests retain the envelope (or a larger reported cost).
Missing/invalid terminal costs freeze new reserve/dispatch until reconciliation.
Overruns and unsupported BYOK billing also freeze; they cannot be erased by a lower
replacement cost. Exact receipt retries are idempotent. Conflicting receipts/costs,
negative refunds and reuse of one response ID across attempts cannot mint balance.
A later higher reconciliation cost is retained, increases liability and freezes
further dispatch; a lower conflicting cost cannot free additional money.
`status` separates funded, settled, held liability and reported amounts; verified
invoice cost remains null. The full central certificate remains allocated.

When a generation ID was retained, `reconcileOpenRouterReceipt(binding, dependencies)`
in `wire.mjs` performs **only**
`GET https://openrouter.ai/api/v1/generation?id=<exact_retained_response_id>`.
See [generation lookup](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation).
It requires matching ID, resolved model, finish reason and finite nonnegative
`total_cost`, then sends `outcome:"reconciled"` with the raw generation record to
`retain`. SQL verifies the ID against existing evidence, permanently retains the
lookup result and atomically settles eligible uncertainty. It never generates a
replacement answer. Missing ID, 404, incomplete lookup, conflicting cost or an
overrun leaves liability held. The function is explicit recovery, not an automatic
provider call; Parent controls its use and supplies the existing key in memory.

## Parent-only setup after the filesystem stop is cleared

Use a fresh dedicated target, existing declared psycopg dependency and separate
migration/funding owner versus restricted runtime LOGIN role. The owner requires
`pg_control_system()` permission in the target; runtime receives none directly.
The binding includes target database name/OID, cluster system identifier, nonce
and exact policy. A different restored target cannot replay the certificate.
Nothing auto-migrates, resets existing state, or changes issuer schema/grants.

Create the policy file locally (this command performs no network/DB access):

```sh
PYTHONPATH=backend python -c 'import json; from workagent.workspace_accounting_policy import jev_policy; print(json.dumps(jev_policy(),indent=2))' > "$POLICY_FILE"
```

Parent sets `WORKSPACE_ACCOUNTING_ADMIN_DSN`, `WORKSPACE_ACCOUNTING_RUNTIME_DSN`,
`ACCOUNTING_RUNTIME_ROLE`, `BINDING_FILE`, `CERTIFICATE_FILE`,
`ACCOUNTING_SOCKET_DIR`, `ACCOUNTING_SOCKET` through the existing configuration.
The following are fresh-target setup instructions for Parent, subject to verified
target identity, existing authority and appropriately readable non-secret SQL staging:

```sh
psql "$WORKSPACE_ACCOUNTING_ADMIN_DSN" -v ON_ERROR_STOP=1 -f apps/workagent-server/migrations/0002_accounting.sql
PYTHONPATH=backend python -m workagent.workspace_accounting_service --dsn-env WORKSPACE_ACCOUNTING_ADMIN_DSN initialize --policy "$POLICY_FILE" > "$BINDING_FILE"
PYTHONPATH=backend python -m workagent.workspace_accounting_service --dsn-env WORKSPACE_ACCOUNTING_ADMIN_DSN grant-runtime --role "$ACCOUNTING_RUNTIME_ROLE"
```

After backup and binding review, Parent uses existing issuer
`test_budget_correction.issue_exact(id,target_database,target_binding_sha256,amount_usd)`
on `workagent_test_47b87fe3b82e`, verifies readback, then imports exactly these fields:

```json
{"issuer_database":"workagent_test_47b87fe3b82e","issuer_schema":"test_budget_correction","id":"EXACT_ISSUER_ID","target_database":"EXACT_NEW_DATABASE","target_binding_sha256":"EXACT_BINDING_HASH","amount_usd":"EXACT_ISSUED_AMOUNT"}
```

```sh
PYTHONPATH=backend python -m workagent.workspace_accounting_service --dsn-env WORKSPACE_ACCOUNTING_ADMIN_DSN import-certificate --certificate "$CERTIFICATE_FILE"
PYTHONPATH=backend python -m workagent.workspace_accounting_service --dsn-env WORKSPACE_ACCOUNTING_RUNTIME_DSN validate
install -d -m 700 "$ACCOUNTING_SOCKET_DIR"
PYTHONPATH=backend python -m workagent.workspace_accounting_service --dsn-env WORKSPACE_ACCOUNTING_RUNTIME_DSN serve --socket "$ACCOUNTING_SOCKET"
```

No secrets belong in policies/certificates/receipts. Import trusts Parent's verified
readback, is exact-idempotent, and rejects a different second certificate. The
socket is 0600 inside an owned 0700 directory, with bounded JSON and sanitized errors.
Existing endpoints are never deleted/replaced, including at shutdown.

Policy format changed to v2 and the migration now includes settlement. If any
previous schema/binding actually exists, stop for Parent's assessment; do not drop,
rewrite binding or re-import funding. An existing financial binding is not disposable
application state; verify partial effects before continuing setup.

## Contract and checks

Existing `IssuerSocketAccounting` wiring is retained. Policy/status are POST `{}`.
Reserve includes `policyHash`, exact `requestBody`, and stable `requestId` (default:
body hash within session); permit echoes `policyHash`. Terminal received receipts
now include `terminal:true`; only the wire after SSE completion sets it.
Reconciliation reuses `/retain`. Acks add `settled`, `settledCostUsd`, `liabilityUsd`,
`monetaryState` and `frozen`; tools still wait for durable receipt acknowledgement.

```sh
PYTHONPATH=backend python -m unittest discover -s backend/tests -p 'test_workspace_accounting*.py'
/home/ubuntu/workagent-dsh-slice-20261111/.local/toolchain/node-v24.22.2-linux-x64/bin/node --test apps/workagent-runner/tests/provider-contract.test.mjs
```

The gated suite needs a NEW empty `workagent_accounting_test_*` database plus
`WORKSPACE_ACCOUNTING_TEST_DSN`, `WORKSPACE_ACCOUNTING_TEST_RUNTIME_DSN`,
`WORKSPACE_ACCOUNTING_TEST_RUNTIME_ROLE`, `WORKSPACE_ACCOUNTING_TEST_DATABASE`.
Only Parent, after verifying the authorized fresh empty test target, may set `WORKSPACE_ACCOUNTING_RUN_DB_TESTS=1` for
that same unittest command. It installs in the empty target, uses a synthetic
certificate and actual configured Jev route, exercises settlement/replay/row-lock
concurrency/rollback/socket behavior, and preserves its records. No issuer or
provider calls occur. Passing pure tests is not DB, provider or browser proof.
