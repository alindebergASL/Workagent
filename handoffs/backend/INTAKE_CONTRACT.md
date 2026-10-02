# Intake domain checkpoint — frontend/consumer contract

## Status and authority

**No provider/account calls, transport, or product inference grant are included.**
PostgreSQL tests use deterministic fixture execution and explicitly synthetic
provider receipts. `execution.mode=managed` describes configured provenance; it
is not evidence that a real model ran. `provider_observation=received` means the
trusted consumer recorded a receipt, not an independent provider attestation.

The approved change is **only the approved document revision**. Preparing a next
action does not perform that action. No new task-effect operation exists here.
Completion prose and `run.state=ready` are never sufficient outcome evidence.

## Common HTTP projection

Both existing assignment GET and assignment-list GET attach optional
`Assignment.responsibility` (old fixtures may omit it). Use this same projection
on Home, Spaces, and the work surface; do not derive success from run/assignment
status or model text. Command replay responses remain immutable snapshots: after
create/complete/accept/control, refetch assignment and artifact GETs.

- `responsibility.latest_run_id`, ordered `runs[]`,
  `approved_change="document_revision_only"`, `underlying_action_performed=false`.
- Each run: `run_id`, optional `execution`, `state`, `artifacts[]`, `checks[]`,
  `outcome_gate`, `safety_gate`, `underlying_action_performed=false`.
- Execution: `mode` (`fixture|managed`), `profile`
  (`fixture-deterministic-v1|openai-agents-v1`), optional `model`, `grant_id`,
  `attempt_id`, and `provider_observation` (`not_observed|received`).
- Artifact bindings: `artifact_id`, exact `revision_id` when saved/accepted,
  optional `proposal_id`, `base_revision_id`, and SHA-256 `body_hash` using the
  canonical domain JSON representation. The projection carries no document body,
  provider session/turn IDs, raw provider envelope, or credential.
- Checks (`passed|failed|unverified`): `publication_binding`, `saved_body`,
  `exact_base`, `current_revision`, `provider_result`, `authority` where applicable.
  Gates verify the bound local document outcome and current source/assignment
  authority, **not** execution of the document's underlying action or semantic
  fulfillment of every goal criterion.

| State | UI meaning |
|---|---|
| `preparing` | Queued/running; no verified publication yet. |
| `prepared` | Exact initial document bytes saved; next action NOT performed. |
| `decision_required` | Exact proposal retained; human exact-base approval needed. |
| `decision_stale` | Current revision moved; preserve human edit, do not accept stale proposal. |
| `readback_verified` | Accepted revision/body/base verified and still current. Document-only success. |
| `approved` | Exact accepted revision exists historically, but another revision is current. |
| `outcome_unknown` | Dispatched or unknown provider outcome; do not retry inference. |
| `waiting` | Receipt awaiting local publication, unsent abandoned attempt, cancellation, or dismissed proposal. |
| `unverified` | Missing/inconsistent publication evidence or failed checks; never show completion. |

`approved` can have `current_revision=failed` while its historical bytes remain
valid. `readback_verified` requires the current pointer too. Normal GETs are
bounded, read-only checks. Neither approval nor readback launches another turn.
Authorization still gates every GET; revoked private source access is not leaked
through the projection. Existing accept-proposal expected-current/base checks and
human-save concurrency fences are unchanged.

## Trusted consumer seam (not HTTP/model tools)

`Service` methods:

1. `claim_run` assembles/persists reviewed context using existing leases/pins.
2. `prepare_provider_attempt(cap, request_hash=..., consumer_sha256=...)` commits
   one durable identity before any send. Hash the **exact fully materialized
   semantic request**, including profile/model/context/tool settings; exclude
   authentication headers. The concrete consumer must enforce that binding.
3. `dispatch_provider_attempt(cap, attempt_id)` atomically grants permission once.
   Only a successful first transition permits one send. A lost return is unknown;
   **never repeat dispatch/send**. Repeated preparation only retrieves identity.
4. `record_provider_identity` can persist received session/turn IDs before a final
   result. `mark_provider_unknown` records ambiguity. `dispatched` also projects
   as unknown until a receipt exists, covering process death before error handling.
5. `record_provider_result` saves a sanitized typed `ProviderResult`: session/turn
   IDs, document `bodies`, `unresolved`, and input/output token `usage`. It does not
   publish documents. Contradictory repeats fail; identical receipts are replay-safe.
6. Use existing `complete_run`/proposal broker path with the **exact stored receipt
   bodies and unresolved list**. After lease expiry, `recover_provider_run` grants
   a new fence for this local commit only, never another inference. Commit failure
   leaves the receipt available; result storage, domain commit, readback/ACK are
   separate boundaries.
7. `reconcile_provider_attempt` compares immutable publication bindings against
   actual saved revisions/proposals and the stored result, then marks reconciled
   and ACKs the existing outbox. It never sends, commits a document, or approves.

One attempt **total per run** is deliberately conservative at this checkpoint.
Prepared orphans, failures, expired leases, and repeated dispatch deliveries never
create another attempt. Unknown/prepared/responded attempts also block creating a
replacement run on the same assignment, including pause/resume retries. Only an
unsent prepared attempt can currently be marked failed by the service; unknown
failure classification waits for a concrete provider contract. The fixture
scheduler defers managed runs; it cannot substitute fixture output.

This is local idempotency and fenced admission, **NOT provider exactly-once**.
An unknown create with no returned session ID may be unreconcilable and must stay
waiting/unknown. Future tool-result continuations require their own reviewed
logical-dispatch ledger; do not reuse this single permission to send multiple
inference-producing messages. Model-facing proposal calls currently require a
stored matching final receipt: the concrete consumer must decide how to stage
proposed bodies and record that receipt before domain publication, rather than
bypass the broker or fabricate a result.

## Operator grant / pin seam

`configure_grant(owner_db, ProviderGrant(...))` and `revoke_grant(owner_db,id)` are
migration-owner-only Python seams. No CLI, HTTP route, tool, or seeded product
grant is added. Grants bind workspace/principal, profile/model, consumer code hash,
expiry (maximum one hour), and admission count (1–10 runs). An active expired or
exhausted grant fails closed instead of falling back to fixture. Revocation cannot
be undone; continuation and commit recheck current grant/source authority.

`max_received_output_tokens` is only a local receipt-publication ceiling. Already
incurred usage is retained even when publication is refused. Pins explicitly say
`provider_hard_budget="not_enforced"`; the local publication budget is **not** a
provider model-call/token/USD hard limit. Managed Agents create starts inference;
no invented provider max-token field or claimed create exactly-once guarantee is
included. A route/grant decision (including any bounded Responses contingency)
and verified official API contract are prerequisites for a real consumer.

Old fixture configurations/context remain immutable. Their previous registry is
archived and byte-bound; existing fixture adapter/bundle bytes are not edited.
New runs pin the new registry. Unknown hashes fail closed.

## Migration and validation

Additive `004_intake_checkpoint.sql`: `provider_grants`, `provider_attempts`, and
immutable `run_publications`; original migrations 001–003 are untouched. No data
backfill: old completed records lacking a publication binding are unverified,
not guessed complete. Runtime role needs SELECT on the new tables, INSERT on
attempts/publications, UPDATE on attempts; **no grant mutation or publication
UPDATE/DELETE**. `dev_db.py` provisions these permissions for a new disposable DB.
Existing deployment grants must be explicitly extended by the migration operator.

Tests cover real PostgreSQL uniqueness/concurrent dispatch, restart and expired
lease ambiguity, immutable request/result bindings, source/grant revocation,
receipt/commit/readback boundaries and rollback, exact approval, in-flight human
edits, false-completion rejection, old registry pins, and HTTP projection parity.
All provider-shaped receipts are labeled synthetic; no live transport claim.
Generated contracts: OpenAPI, tool registry, examples, TypeScript schema. No web
source files changed. Parent must run final integration/independent review and
implement only the subsequently approved concrete transport/continuation seam.
