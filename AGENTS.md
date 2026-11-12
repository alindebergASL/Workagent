# Workagent development instructions

Start every session or resume with [development direction](docs/DEVELOPMENT_AUTHORITY.md),
[model spending](docs/GENERAL_MODEL_AUTHORIZATION.md), and [truthful status](STATUS.md).
The canonical versioned product direction is the [blueprint](docs/product/01-product-blueprint.md),
[architecture](docs/product/02-architectural-plan.md), and [build steps](docs/product/03-build-steps.md).
Read these before product work. Product scope is not execution or spending approval.

The current authorized increment is the November 12 bounded instruction/documentation
cleanup and historical CI relocation. It does not activate the product rebuild.
For later authorized increments, continue reversible implementation, targeted checks,
integration, owned development-service operation and feature-branch publication without
per-packet consent. A review, commit or session boundary creates no new approval gate.

Hermes owns backend/runtime/integration. The existing Claude Code owner owns web,
including the future client. Use isolated branches, preserve concurrent work and agree
shared interfaces. If that owner is unavailable, surface the client blocker immediately
and request reassignment for that stream; continue independent backend work without
silently taking over web.

Use one writer per stream, changed-behavior checks and at most one useful independent
risk review. Skills may load as references; apply compatible techniques without activating
generic two-stage/per-task reviews, fresh-agent mandates, clean-commit-every-task or
full-suite-every-edit loops. Higher-priority instructions and tool safeguards still apply.
Repository prose does not update profile skills; scoped profile maintenance is separate.

Build mode permits replacing development APIs, schemas, runtime policies, tools and UI
when they obstruct the product. Preserve saved human work with migrations/backups or
isolated environments and regenerate affected clients. The rejected UX, old designs,
first-use checklist and historical runtime are not implementation requirements. Keep the
old owner services stopped under current direction; do not use the old launcher for the
new product. Preserve the alpha and historical rc1 compatibility slice.

Preserve human edits/acceptance, access isolation, truthful state, financial accounting,
historical receipts and duplicate-effect protection. Follow the actual spending and
effect limits in the linked authority documents. Never bypass a git, filesystem,
database or permission refusal; stop and report the refused action.

Older plans, research, audits, cards, handoffs and evidence are reference, not additional
authority. Remove contradictory active wording instead of accumulating overrides.
Keep STATUS under 100 lines and state what actually ran. No new guards, matrices,
evidence files, studies or documentation-wording tests are needed for this cleanup.
