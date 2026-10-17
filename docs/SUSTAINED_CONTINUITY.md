# Sustained preparation (`sustained-v1`)

An opt-in extension of `general-alpha-v1`, not a second worker or scheduler.
Install a new explicitly authorized binding with
`continuity_version: "sustained-v1"` and the pins returned by
`adaptive.contract(binding)`. The continuity decision schema is exported as
`contracts/continuity-decision.schema.json`. Missing continuity version preserves
legacy behavior and legacy serialized binding shape. Nothing repins old grants.

## Work and followthrough

- `publish_artifact` retains a durable local observation and permits another
  selection within the existing step and cumulative budget bounds.
- Final publication includes **all** retained observed products/proposals, plus
  the final explanation, atomically. A reply cannot silently discard earlier work.
- Multiple proposals against one saved revision remain separate **pending**
  proposals. No human revision is accepted, overwritten or fabricated.
- On a bound responsibility continuation, `advance_responsibility` stages an
  exact-version next plan. It may change current outcome, next action, wait and
  check-in, but may not expand dependency access or change owner/goal/criteria.
- Evidence cites earlier observed phases and operation hashes. The stored
  evidence adds exact body hashes and is explicitly preparation evidence, not
  proof of overall/external goal completion.
- The last staged plan applies only in the same transaction as final publication,
  after reconciliation, while the original lease/CAS/fence still holds. Applying
  it increments the canonical assignment version/fence and uses the existing
  responsibility wake dispatcher. A restart cannot apply it twice.
- A safe staged plan avoids the legacy blanket review wait. A meaningful person
  wait remains a person wait. Missing plans retain the conservative old fallback.

## Boundaries

Unknown provider effects, lost responses, stale human plans/revisions, authority
loss and budget stops retain their existing fences. A budget stop does not apply
an unfinalized plan or manufacture a final response. Intermediate local bodies
remain durable in the receipt journal on interruption/budget stop; normal saved
artifacts are materialized only upon final publication.

The status `evidenced_preparation` is deliberately not `verified` or `completed`.
This mechanism does not add tools, external-effect authority or paid-model access.

## Integration

Migration `034_sustained_continuity.sql` wraps the prior alpha budget validator,
validating/removing only the continuity field before delegating. This composes
with the standing-admission migration in `033`. Preserve both optional-field
serializers if the standing binding adds one. Two small schema-selection hooks
are in `responses_transport.py` and `responses_ledger.py`; no timing changes.
`general_responses.py` only selects the new schema and authorizes the new action.
Generated OpenAPI and TypeScript reflect the additive lifecycle/readback fields
and bounded multi-product turn results.
