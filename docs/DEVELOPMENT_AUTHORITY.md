# Development direction — Workagent

Build a persistent general work partner through the canonical [blueprint](product/01-product-blueprint.md),
[architecture](product/02-architectural-plan.md) and [build steps](product/03-build-steps.md).
[STATUS](../STATUS.md) records checked state; [model spending](GENERAL_MODEL_AUTHORIZATION.md)
and actual grants/accounting control product spend.

## Current scope

Andrew approved the November 12 bounded cleanup of active instructions, the three
product documents and obsolete CI routing. This scope does not activate product
implementation, paid calls, deployment, database maintenance, private access or global
safeguard changes. The parent owns commit/publication, mirrors, scoped profile-skill
maintenance and final verification for this cleanup.

The old owner experience was rejected. Its three services were stopped and disabled at
the last verified check and must stay stopped under current direction. Preserve their
saved work and the old alpha. The published rc1 slice is compatibility evidence, not the
product or an acceptance gate. Neither old first-use sequencing nor old UI designs govern
the fresh client. Later explicit service authorization can change the stopped state.

## Delivery conduct

- For an authorized implementation increment, change or replace development interfaces,
  schemas, runtime policies and architecture as needed. Continue reversible engineering,
  targeted checks, integration, owned development services and feature-branch publication
  without consent at each packet, review, commit or session boundary.
- Use one writer per ownership stream in isolated branches. Hermes owns backend/runtime/
  integration; the existing Claude owner owns web, including the new client. Coordinate
  interfaces and preserve concurrent changes. If web ownership is unavailable, report it
  immediately and request reassignment for that stream; continue independent backend work.
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
  this repository cleanup does not claim to have changed effective profile instructions.

## Money, data and effects

The financial source remains [GENERAL_MODEL_AUTHORIZATION](GENERAL_MODEL_AUTHORIZATION.md),
unchanged: $275 cumulative, not fresh funding. Read actual accounting before any paid use;
keep allocations, usage, uncertain liabilities and verified bills distinct. Do not invent
available balance. Use the approved model route for owner use and the smallest real-model
fix check; no studies or new paid provider authority is implied.

The old alpha's issuer remains the single ledger. New certificates within the ceiling
are permitted only after a `pg_dump` backup kept in `.local/`; change nothing else in that
database and tell Andrew in one line each time. This retained authority is not an
instruction to issue a certificate during cleanup. Keep the alpha's services and data
otherwise unchanged. Qualify the new accounting seam without importing legacy execution
or creating a second financial authority.

Synthetic-only product-model data remains the boundary until the declared scope and
actual handling are reconciled. Execution approval does not authorize confidential data
or new private accounts. A Workagent test server means an explicitly isolated product
environment; it never means the operator's Hermes host, profile or home directory.

- Never bypass a git, filesystem, database or permission refusal. Stop and report it;
  do not force or reroute the refused operation.
- Delete only build output/caches you created and can regenerate. Preserve repositories,
  history, databases, credentials, uncommitted work and others' files. The approved
  workflow relocation preserves every byte; it is not permission for further deletion.
- Preserve human edits/acceptance, access isolation, immutable receipts and unknown
  outcomes. Never blindly replay an external request whose effects remain uncertain.
- Explicit authority is still needed for installed-data maintenance (migration, VACUUM,
  bulk edits), destructive cleanup, new private access, new paid providers or SDK purchases,
  external sending/posting/buying, default-branch merge (`hermes/s0-s1-backend`) and public
  deployment. Prepare safe changes and backups before requesting a needed operation.
- Within authorized development, a fresh isolated database is allowed; resetting or
  maintaining an installed database is a different operation. Continue unrelated work.

The retired [development-boundaries workflow](../.github/retired-workflows/development-boundaries.yml)
and its unchanged $100 inventory/checker are historical evaluation tooling. They are not
current authority or cleanup acceptance tests. Runtime money/isolation/receipt enforcement
remains intact; legacy frontend CI stays intact and new-client CI follows actual code.
