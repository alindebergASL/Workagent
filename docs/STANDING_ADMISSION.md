# Standing Home admission — private prototype

Migrations 033 and 037 support ordinary work under one standing allowance. Routine
code, prompt and schema changes do not require a new grant or consumer-successor
approval for new general-responses executions. Route evidence no longer expires
merely because 24 hours elapsed. Real provider/project/model bindings, configured
price ceilings, revocation and cumulative/per-run accounting still apply.

## Normal development

Build/check the changed path, apply new migrations, restart the private services
and exercise the product. Keep the existing standing grant, route record and
historical request identities. Do not renew timestamps or manufacture a grant
lineage for a code-only update.

The active standing policy is `principal-workspace-v1`: conversations owned by the
grant's principal in that workspace, without selected private sources, qualify.
Public HTTPS reading works on authorized human, targeted saved-work and background
responsibility turns. This does not enable private-account access or broader recall.

`max_runs` and per-run step/time/token/cost bounds remain execution limits, not a
conversation-lifetime rule. Standing conversations have no eight-turn lifetime
cutoff. Bounded recent context preserves current input and latest human steering;
older evidence is retained, not silently deleted or fabricated into a summary.

## Actual authority changes

A new route, scope or allowance is different from a code update. When an authorized
change genuinely needs a replacement standing grant, use `draft_standing_successor`
and `configure_grant(..., predecessor_id=...)`. Installation atomically revokes the
predecessor and inserts its successor; do **not** pre-revoke the old grant in a
separate transaction. Old configurations, request identities and receipts stay put.

The existing development authorization is **$100 cumulative**, not $100 of new
capacity. Reconcile actual current capacity; never substitute the limit for the
available balance. Shared reservations, reported usage and unknown outcomes carry
forward. The helper copies the predecessor's ceilings unless an explicit authorized
change is supplied. Historical scoped bindings keep their original limits.

Source/prompt/schema hashes remain provenance for stored requests, not permission
to admit new general executions. An in-flight request whose frozen context is no
longer compatible can still stop with `source_changed`; do not silently rebind or
replay it. Unknown requests remain quarantined and their liabilities remain counted.

Generated schemas and the capability catalog come from `backend/export_contracts.py`.
Use `--check` after changing canonical models/descriptors. Installed state and current
verification are recorded in [STATUS](../STATUS.md), not inferred from this guide.
