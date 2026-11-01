# Next narrow repair — not implemented or approved for installation

The scoped reviewer's source-grounded analysis is retained at
`.local/batch3/b35c/discovery-recovery/RECOVERY_ANALYSIS.md`.
The exact current live trigger/constraint readback is retained at
`.local/batch3/b35c/discovery-recovery/RECOVERY_SQL_BOUNDARIES.json`, SHA256
`c332c674f990613cff6f33060500e39a194951b5460a34a48c43f534a3abf85a`.
It was read-only:35 triggers across responses_events/responses_steps,4 event
constraints,0 pg_policies rows for those two tables. Absence of policies is not
an assertion that the wider service lacks authorization.

## Recommended smallest path

Keep the current strict draft schema and installed capability descriptors.
Introduce a distinctly typed append-only `selection_rejection` event, not a fake
tool_result and not corrected_readback (the latter handles a different historical
final-response parsing defect). Bind it to exact old result event identity/hash,
request/response/attempt/phase, terminal schema-validation failure and known usage.
No unknown, count-only, pending, ambiguous or already-effected phase qualifies.

Use the already captured exact diagnostic for this run, never another GET.
Compute the digest for its rejected, UNEXECUTED text and expose labeled feedback
for a legitimate new selection. Do not turn the old malformed result into a valid
function call, execute substituted DTOs or claim an artifact was created. Any new
selection must pass the unchanged schema, authority and gateway normally; its
text must exactly match a supplied hash hint, including Unicode/newline bytes.
The model may still fail; record that honestly. At the existing step limit,
settle as a truthful partial schema-rejection outcome, not budget exhaustion and
not an eternally running terminal receipt.

## Actual SQL boundaries to preserve

- `responses_events_kind_check` currently excludes selection_rejection. Extend
  only the explicit new kind, retaining existing values and rows.
- `guard_responses_event()` takes the workspace lock, performs grant/budget logic,
  and applies current general execution checks only to a named list including
  tool_result. A new kind MUST join the relevant authority checks; merely adding
  a constraint value would allow an unguarded observation. Preserve membership,
  open conversation, active grant, access generation, lease and scope checks plus
  `require_general_publication_authority`.
- `guard_responses_material()` requires function_call for tool_result. Do not
  weaken that check. Validate the separate rejection kind strictly against its
  original receipt/identity/material-free semantics instead.
- `guard_responses_step()` requires a preceding continue observation. Add only
  exact validated rejection continuation as a second qualifying path. Preserve
  all normal phase bounds, source/request identity and per-send funding gates.
- `study_funding.guard_event()` deliberately ignores non-I/O event kinds. The
  rejection itself spends no provider allowance; NEW count/create/read operations
  must still take the original per-operation authority/accounting path. Do not
  reinstall or change this installed funding gate.
- Preserve uniqueness, immutable-history triggers, deferred work-capture and all
  other35 trigger behaviors. No blanket early return that bypasses fences.

## Required focused verification

Real restricted-PG worker path: malformed result → exact rejection observation →
new valid selection → actual draft → restart → no duplicate effect. Original
result and diagnostic remain byte-identical. Assert negative wrong response,
request, attempt, missing usage, pending/unknown, existing effects, revoked/stale
worker, duplicate/conflicting observation, tampered diagnostic, changed text/hash,
and exhausted phases. Test interruption before/after observation and next
provider dispatch, rollback and installed-source amendment separately. Existing
B0 observer limitation remains explicit, not inferred from B1.

This is bounded recovery guidance, not a release decision or a new framework.
The cleaner future generated-content API computes hashes server-side without
asking the model for them, while keeping preexisting-object hashes strict. That
larger change also needs exact historical-schema restoration and explicit new
capability pins; do not slip it into the existing grant/receipt identities.
