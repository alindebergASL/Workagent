# Responses consumer/frontend additive handoff

Backend implementation/runbook: `../backend/RESPONSES_WORKER.md`.
No `web/` files were edited by this backend integration.

## Contract changes (existing fields/endpoints preserved)

- `ExecutionProfile` additionally accepts **`openai-responses-v1`**. It is an
  honest Responses transport profile, not an alias for legacy
  `openai-agents-v1` or an Agents SDK claim.
- `RunOutcome.response_steps` is additive, defaults to `[]`, maximum two entries.
  Each has `phase` (`selection`/`final`), `state` (`prepared`, `count_unknown`,
  `counted`, `outcome_unknown`, `accepted`, `received`, `invalid`), nullable
  `response_id`, reported input/output tokens, reserved cost, conservatively
  calculated cost and billed cost. Costs are decimal strings; missing/unknown
  costs are **null**, not zero. These are observations, not human decisions.
- Additional continuation blockers are `provider_response_pending` and
  `provider_result_rejected`. Existing `reason`, `reason_code`, `continuation`,
  `next_allowed_action`, `continuation_available`, outcome/safety gates,
  artifact bindings, conflicts and exact-version approval fields are retained.
- A known accepted response projects as **preparing**, never completed. A
  rejected terminal response projects as **waiting** with a rejection reason.
  A dispatched step with no accepted ID remains **outcome_unknown**. Retained
  results do not establish source access, current authority or publication.
- `execution.evidence_origin` still distinguishes fixture, unverified,
  synthetic-provider and live-provider evidence. A profile name alone is NOT
  evidence of live provider execution. The implementation tests/journey are
  explicitly synthetic transport and zero provider inference.
- `contracts/openapi.json`, `contracts/tool-registry.json` and examples are
  regenerated. Separate `contracts/responses-tool-registry.json` and
  `contracts/responses-output.schema.json` describe the narrow worker-only
  scope tool and final wire DTO. Neither exposes a new HTTP tool or approval.

## Product behavior to integrate/test

Normal assignment admission under an explicitly installed Responses grant
queues the configured managed run. The separate local Responses dispatcher
consumes its existing outbox record and produces the artifact/proposal itself.
Do not import a hand-written provider artifact or redirect the fixture worker.
The fixture dispatcher continues to defer managed runs and cannot fall back.

For revision, the worker preserves every human/base block and appends proposed
next-action advice. The existing proposal/base/current views supply an
inspectable diff. An intervening human edit leaves a stale proposal; only the
existing human approval action with the exact current revision can promote it.
The approved change is **document revision only** and
`underlying_action_performed=false`. No new task or customer action happened.

Reopen/restart and repeated delivery use the same run/attempt/step responsibility,
not a fresh inference. Unknown dispatch must not offer a retry-as-new-send.
Permission revocation may leave retained receipt observations but never grants
continued source use or publication.

## Remaining owner gates

Frontend owner regenerates its typed client and performs the browser matrix
(initial, human edits, proposal, exact approval, stale conflict, reopen/restart,
unknown response and revocation). Parent owns integrated independent review and
any bounded live provider execution after explicit product project/key access.
Backend synthetic tests are not frontend/browser evidence or live compatibility
proof. The canonical `INTAKE_LIVE_GRANT.json` was not changed.
