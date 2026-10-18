# Workagent development instructions

Workagent is in active build mode. Andrew's October 16 direction is explicit:
“can we blow up these contracts, we are still in build mode and not prod”.

Read [product direction](docs/PRODUCT_CONTRACT.md), [current work](docs/BUILD_PLAN.md)
and [STATUS](STATUS.md). The other contract filenames are short supporting guides,
not additional approval gates. These instructions supersede historical checkpoint
ordering, demo limits and architecture-preservation requirements for new development.

Hermes owns backend/runtime/integration. The existing Claude Code owner owns web.
Coordinate interface changes and preserve concurrent work; use isolated branches.

Change or replace development APIs, schemas, runtime policies, tools and UI when
they obstruct the product. Choose the simplest useful implementation. Existing
architecture is a starting point, not a permanent requirement. Protect saved user
work with migrations/backups or isolated environments; regenerate affected clients.

Continue authorized reversible implementation, targeted checks, integration,
development-service operation and feature-branch publication without routine
checkpoint approval. Publish coherent increments and continue toward the outcome.
A demo, test pass, review or session boundary does not complete the mission.

Preserve human edits/acceptance, access isolation, truthful state, budget accounting
and duplicate-effect protection. Existing external outcomes and historical receipts
must not be erased or reinterpreted. Actual spending/access authority remains in
[GENERAL_MODEL_AUTHORIZATION](docs/GENERAL_MODEL_AUTHORIZATION.md).

Use risk-proportionate tests and independent review where useful. No mandatory
all-model/all-persona ceremony or full-suite rerun for every increment. Share
unfinished work honestly. Evaluate usefulness and the actual desktop/phone
experience; compare the approved designs. Keep machinery behind optional details.
