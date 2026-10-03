# Workagent development instructions

Read `docs/PRODUCT_CONTRACT.md`, `docs/BUILD_PLAN.md`, `docs/WORK_CONTRACT.md`
and `docs/PRODUCT_ACCEPTANCE.md` before product work.
`handoffs/PRODUCT_RESET.md` assigns the current backend and frontend work.

Workagent is a general, persistent work partner. Intake is an implemented
capability and a closed engineering checkpoint, not the product definition.
Old S0/S1 packets, intake missions and integration handoffs describe historical
slices. Their scope and “no redesign” directions do not govern new product work.
The current product contract governs direction; deployed schemas remain actual
API authority until explicitly migrated.

User instructions and actual authorization always govern execution. Broad
capability grants no access, spending or external effects. An expired mission
grant does not limit architecture. Continue routine implementation and reversible
local checks within authorized scope; ask only for a missing consequential
decision or authorization.

Hermes owns backend/runtime/integration. The existing Claude Code session owns
`web/`. Agree contracts before parallel implementation, use isolated branches
and preserve concurrent changes. Do not create another frontend or another owner
of the model/tool loop. Both owners inspect the integrated journey.

Keep PostgreSQL/domain authority, scoped broker checks, immutable revisions,
human edits, replay, fences, truthful recovery and exact approval. Do not edit
hash-pinned accepted `agent/v0.1.*` bundles in place. Introduce reviewed versions.
Reused upstream components go through the same authority boundary.

Substantive PRs state the user outcome and three verdicts: engineering,
usefulness and experience. Separate fixtures, live calls and human review.
Untested is not PASS. Do not close general-agent milestones using only intake
or research evidence. Keep machinery in details unless it explains a user
action or uncertainty. A reset document is not implementation.
