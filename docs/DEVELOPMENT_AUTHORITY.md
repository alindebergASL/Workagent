# Development direction — Workagent

Build a persistent general work partner through the canonical [blueprint](product/01-product-blueprint.md),
[architecture](product/02-architectural-plan.md) and [build steps](product/03-build-steps.md).
[STATUS](../STATUS.md) records checked state; [model spending](GENERAL_MODEL_AUTHORIZATION.md)
and actual grants/accounting control product spend.

## Current scope

The owner explicitly said START for B01, then B02 resilience and B03 background
usefulness as prerequisites permit. Routine reversible implementation, tests/fixes,
integration, feature-branch publication and private operation on the existing dedicated
server are authorized without per-task consent. Default merge/public deployment and
new purchases remain outside this activation.

Codex/Astra owns frontend and backend, initially as sole integration writer. Parent
Hermes owns Git commits/publishing, test-server setup, accounting reconciliation, live
issuer grants/certificates, paid calls and final browser verification. Delegated coding/review
workers, not Parent Hermes, must not commit/push, manipulate host services, SSH, access databases or credentials,
issue paid calls, delete retained data, change profile skills or spawn agents.

The old owner experience was rejected. Its stopped/disabled services must stay stopped.
Preserve alpha financial authority and rc1 reference code. Pre-pivot application data is
disposable: no migration or compatibility is required, and no deletion is part of this
run. Start fresh product state and preserve new human work. Do not import rejected client
trees or use the legacy launcher.

## Delivery conduct

- For an authorized implementation increment, change or replace development interfaces,
  schemas, runtime policies and architecture as needed. Continue reversible engineering,
  targeted checks, integration, owned development services and feature-branch publication
  without consent at each packet, review, commit or session boundary.
- Use one writer per stream in isolated branches. Codex/Astra owns web and backend;
  Claude availability is no dependency. Preserve concurrent changes and wire interfaces
  with their consuming code. Parent retains the operational responsibilities above.
- Use changed-behavior checks and at most one useful independent risk review. No mandatory
  two-stage/per-task reviews, clean commit per task, full-suite rerun per edit, review fleet
  or automatic task-card requeue. Compatible skill techniques are references; generic
  process cascades are not Workagent's workflow. Higher-priority/tool safeguards remain.
- Deliver useful increments. Owner feedback establishes usefulness acceptance; its absence
  does not block independent authorized engineering. Physical-phone evidence is required
  for physical-phone claims, not unrelated progress. Credentials block dependent features.
- Keep STATUS under 100 lines. Distinguish published, installed, enabled and demonstrated
  behavior, and state genuine blockers promptly. If a check fails twice after a fix or a
  blocker lasts a working day, report the blocker, what was tried and the options.
- No new studies, cohorts, broad audits, guards, boundary inventories, acceptance matrices,
  documentation-wording tests or evidence hierarchy. Logs belong in `.local/` or CI.
  Historical research, plans, cards and handoffs are reference. Profile edits are separate;
  this repository work does not claim to have changed effective profile instructions.

## Money, data and effects

The financial source remains [GENERAL_MODEL_AUTHORIZATION](GENERAL_MODEL_AUTHORIZATION.md),
$275 cumulative, not fresh funding. Read actual accounting before any paid use;
keep allocations, usage, uncertain liabilities and verified bills distinct. Do not invent
available balance. Use OpenRouter with default `typesafe/jev-router` and explicit-model debugging/capability
overrides. `typesafe/jev-1.14` is a separate structured Decisions API, never a chat model.
At most one bounded correction/intent seam belongs in B01; leave it disabled until the
exact contract and accounting are connected. No silent direct-TypeSafe calls. Account
for every enabled path; disable unaccounted auxiliaries, children, retries and compaction.
Routing preferences/tiers are not hard allowlists or monetary caps. Hard permissions,
spending, human-edit commits and cancellation remain deterministic. Parent reconciles
actual headroom before paid use; dated observations belong in STATUS, not standing
authority. Delegated coding workers have no paid-call authority. Synthetic data does
not establish genuine execution.

The old alpha's issuer remains the single ledger. New certificates within the ceiling
are permitted only after a `pg_dump` backup kept in `.local/`; change nothing else in that
database and tell Andrew in one line each time. Parent owns live certificate operations;
delegated coding workers must not access the issuer database. Keep the alpha's services and financial
data otherwise unchanged. Qualify the new accounting seam without importing legacy execution
or creating a second financial authority.

Synthetic-only product-model data remains the boundary until the declared scope and
actual handling are reconciled. Execution approval does not authorize confidential data
or new private accounts. The dedicated test server is `workagent-dev` (`i-0cb1c20ccf6e55c21`, private
`10.0.14.244`), separate from Hermes. Parent verifies its state before operating it. Keep
new services private/loopback and auth-protected, with no public endpoint or operator
home/credential mounts. Delegated coding workers do not operate that server; Parent
owns its already-authorized private setup and verification.

- Stop a failed operation and diagnose its actor, resource, authority and possible
  partial effects using bounded checks. Never force, disable safeguards, broaden access,
  or use an indirect route to bypass an explicit user/tool denial or security boundary.
  Correct reversible setup errors within existing authority, preserving isolation,
  retained data and accounting. A sandboxed worker reports its limitation; Parent may
  perform its separately authorized operation in Parent's permitted context, not lend
  the worker an escape route. Escalate the specific action when authority is missing or
  material risk remains unresolved after diagnosis; uncertainty alone is not an owner
  gate. Use a bounded independent model judgment when useful, not an automatic review
  cascade; models cannot grant authority. Continue independent authorized work.
- Delete only build output/caches you created and can regenerate. Preserve repositories,
  history, databases, credentials, uncommitted work and others' files. No retained-data deletion is authorized in this run.
- Preserve human edits/acceptance, access isolation, immutable receipts and unknown
  outcomes. Never blindly replay an external request whose effects remain uncertain.
- Explicit authority is still needed for installed-data maintenance (migration, VACUUM,
  bulk edits), destructive cleanup, new private access, additional paid providers or SDK purchases,
  external sending/posting/buying, default-branch merge (`hermes/s0-s1-backend`) and public
  deployment. Prepare safe changes and backups before requesting a needed operation.
- Within authorized development, a fresh isolated database is allowed; resetting or
  maintaining an installed database is a different operation. Continue unrelated work.

The retired [development-boundaries workflow](../.github/retired-workflows/development-boundaries.yml)
and its unchanged $100 inventory/checker are historical evaluation tooling. They are not
current authority or product acceptance tests. Runtime money/isolation/receipt enforcement
remains intact; legacy frontend CI stays intact and new-client CI follows actual code.
