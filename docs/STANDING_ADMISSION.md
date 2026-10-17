# Standing Home admission

`033_standing_admission.sql` implements the build-mode direction (Andrew's
comment6229889011). It does **not** install or enlarge any existing grant.

An operator can explicitly install a `StandingResponsesBinding` with
`admission_policy: "principal-workspace-v1"` and `conversation_ids: []` through
`configure_grant`. All existing alpha fields are still required: synthetic-only
scope, exact consumer/instruction/schema pins, project/route, and explicit
request/token/cost limits. `max_runs` is an explicit cumulative grant bound from
1–256, not a conversation-lifetime bound. The generated
`contracts/provider-grant.schema.json` describes both binding forms.

- Only conversations owned by the grant's principal in that workspace, with no
  selected private sources, qualify. Membership, current access, revocation,
  immutable request pins and send/publication authority still apply.
- The existing one-active-grant-per-principal/workspace rule remains. Replacing
  standing authority requires explicit inactive continuation lineage. Historical
  explicit-conversation grants keep their original scope. A new standing grant
  never silently takes over unrelated historical scopes; an explicit
  `predecessor_id` successor may admit new runs in its ancestors' conversations.
  Old run/configuration/receipt bindings are never changed.
- Keep the same project/route accounting when replacing authority. Shared
  reservations, actual usage, unknown outcomes, old admissions and receipts remain
  counted by the existing ledger; a new grant does not clear those records.
- Execution admission does not grant cross-conversation recall. Explicit
  read-only context scopes remain a separate authority surface.

Standing conversations have no eight-turn lifetime cutoff. Each request uses a
bounded, deterministic human-first history window. Current input is preserved
whole; for system continuation the latest human steering is also mandatory.
Older human text is preferred over assistant prose, and prior attachment/result
bodies are not duplicated. Omitted history is explicitly disclosed, not replaced
by a fabricated summary. Durable messages and saved work are never deleted.
Oversized current input or mandatory dependency context fails closed without
truncating human intent. This is bounded recent context, not unlimited semantic
memory: old instructions beyond the window require fresh user context.

## Development installation seam

After migration, stop/fence the old consumer and account for unsettled attempts.
Use the migration identity, the actual predecessor ID and a fresh successor ID:

```python
from workagent.db import Database
from workagent.standing_admission import draft_standing_successor
from workagent.provider_attempts import configure_grant, revoke_grant

owner = Database(owner_dsn)
successor = draft_standing_successor(owner, predecessor_id,
                                    grant_id=successor_id, max_runs=256,
                                    cost_limit_usd='50.00')
# Review the draft/accounting and current route evidence before activation.
revoke_grant(owner, predecessor_id)
configure_grant(owner, successor, predecessor_id=predecessor_id,
                route_record=current_route_record)  # None only for synthetic.
```

Drafting copies every budget ceiling by default, plus approved route/secret
reference, principal/workspace and model. The optional explicit `cost_limit_usd`
reconciles the latest authorized cumulative ceiling (at most $50); omitting it
retains the predecessor's cap. It is **not** $50 of new capacity: all existing
shared reservations/carry still reduce remaining capacity. Old bindings retain
their historical $20 ceiling. Other changes are current implementation pins,
the explicit standing execution policy and run-admission bound.
Installation uses the existing owner-only lineage machinery and readback. If it
fails, the predecessor remains revoked (fail closed), not silently reactivated.
Start the consumer with the new grant ID and matching current implementation.
No precreated conversation or web-specific ID wiring is required for fresh Home.
The PostgreSQL tests exercise this exact seam and verify old JSON/configurations,
shared historical charges, old-conversation succession and fresh admission.

No installed/retained database, paid route, or allowance was changed by this
implementation. Activate only against compatible explicit authority and current
cumulative accounting; the recorded development ceiling remains $50.
