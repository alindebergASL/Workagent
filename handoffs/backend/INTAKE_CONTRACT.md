# Intake domain checkpoint — frontend/consumer contract

> **Intake capability contract, not the general product contract.**
> Preserve deployed semantics and historical records. For new common primitives
> follow `../../docs/WORK_CONTRACT.md` through additive migration.
> `../../docs/PRODUCT_CONTRACT.md` and `../PRODUCT_RESET.md` govern new direction.
> Preparation-only outcomes and experiment limits stay local to this profile.

## Status and authority

**This implementation includes no provider/account calls or inference transport.**
Tests use deterministic fixtures and explicitly synthetic provider receipts. A
separate user execution grant is not a backend review pass, installed transport,
provider credential or proof of execution. The parent owns the live-grant artifact;
this fix does not consume or amend it.

`execution.mode=managed`, a model identifier, and `provider_observation=received`
are never live evidence. `execution.evidence_origin` is explicitly one of:

- `unverified` — conservative default, including old records;
- `fixture` — newly admitted deterministic fixture execution;
- `synthetic_provider_receipt` — explicitly selected by trusted synthetic consumer
  code at preparation and retained from an immutable DB binding;
- `live_provider_receipt` — reserved contract vocabulary only. **No path in this
  checkpoint can attest this origin.** Preparation rejects it; receipt payloads
  cannot supply origin. Do not infer or invent live attestation.

The approved change is **only the approved document revision**. Preparing a next
action does not perform it. Completion prose and `run.state=ready` are not enough.

## Common HTTP projection

Assignment GET and assignment-list GET attach the same optional
`Assignment.responsibility`. Use it on Home, Spaces and the work surface. Command
replays remain immutable snapshots; refetch assignment/artifact GETs after writes.

- Responsibility: `latest_run_id`, ordered `runs[]`,
  `approved_change="document_revision_only"`, `underlying_action_performed=false`.
- Run: `run_id`, `execution`, `state`, `artifacts[]`, `checks[]`, `outcome_gate`,
  `safety_gate`, `continuation_available`, `attempt_state`, `blocker`, `reason`,
  `next_action`, `question`, `unresolved[]`, `underlying_action_performed=false`.
- `blocker` is a server-owned enum, not provider prose. `reason`, `next_action` and
  question prompt are bounded to 500 characters. `unresolved` is the run's actual
  bounded list (at most 100 entries, each at most 10,000 characters), not merely
  assignment-level unresolved data. It is not a claim of semantic task completion.
- `question`, when present, binds an actionable prompt to **exact `artifact_id`,
  `proposal_id`, `base_revision_id`**. It never confers approval authority.
- Execution: `mode`, `profile`, optional `model`, `grant_id`, `attempt_id`,
  `provider_observation`, and `evidence_origin` as defined above.
- Artifact bindings carry exact saved/accepted `revision_id`, optional proposal/base,
  and canonical SHA-256 `body_hash`. No document body, provider session/turn ID,
  raw provider envelope, receipt capability or credential appears in this projection.
- Checks (`passed|failed|unverified`): `publication_binding`, `saved_body`,
  `exact_base`, `current_revision`, `provider_result`, `authority` as applicable.

`outcome_gate` verifies **historical document bytes/bindings**, independently of
current continuation. `safety_gate` describes current authority/pins, not whether a
consumer is installed or an inference is safe to repeat. Use `continuation_available`
and the bounded blocker/action too. These fields are descriptions, never grants:
commands recheck current authority, lease/fence and exact base. No transport exists,
so an unstarted managed run is `waiting/consumer_unavailable`, not `preparing`.
Revoked/expired grants and unavailable pins likewise stop any preparing claim.

| State | Meaning |
|---|---|
| `preparing` | Available fixture work queued/running; no verified publication yet. |
| `prepared` | Exact initial document bytes saved; underlying action NOT performed. |
| `decision_required` | Exact proposal retained; exact-base human decision needed. |
| `decision_stale` | Base moved; preserve human edit and request a new proposal. |
| `readback_verified` | Accepted revision/body/base verified and still current; document only. |
| `approved` | Accepted revision exists historically, but another revision is current. |
| `outcome_unknown` | A dispatch may have executed; never retry inference. |
| `waiting` | Availability/control blocker, prepared/abandoned attempt, pending publication or dismissed proposal. |
| `unverified` | Missing/inconsistent document evidence; never claim completion. |

A historical `prepared`/approved result can keep a passed document gate while its
current safety gate fails after pause/revocation/expiry. `approved` may have
`current_revision=failed`; `readback_verified` requires the pointer as well.
Authorization still gates every human GET. Revoked private content is not returned
through projection or attempt readback. Existing human-save and accept-proposal
expected-current/base checks remain unchanged. Readback never launches a turn.

## Trusted consumer seam (not HTTP/model tools)

1. `claim_run` assembles immutable reviewed context using the existing live lease.
2. `prepare_provider_attempt(cap, request_hash=..., consumer_sha256=...,
   evidence_origin='unverified')` commits one identity before any send. Hash the
   **exact fully materialized semantic request**, including model/profile/context/
   tool settings, excluding authentication headers. The concrete consumer must
   enforce that binding. Synthetic consumers explicitly choose synthetic origin.
3. **Before dispatch**, `receipt_cap = bind_provider_receipt(cap, attempt_id)` binds
   a write-only receipt/settlement capability. Persist it privately with the
   consumer's existing job. It fixes workspace/run/principal/attempt/request hash/
   consumer hash/original fence and a one-way domain-separated receipt secret.
   It does not contain the worker lease secret and cannot be recast as a publication
   capability. Only the receipt secret's hash is retained in DB; migration 005 makes
   the binding immutable. It cannot be minted from a free
   human Principal or recovered from a newly claimed publication lease. It must
   never enter model context, logs, HTTP responses or the projection.
4. `dispatch_provider_attempt(cap, attempt_id)` grants one permission atomically.
   Only a successful first transition permits a send. A lost return is unknown;
   **never repeat dispatch/send**. Persist receipt capability before this boundary.
5. `record_provider_identity(receipt_cap, provider_session_id=...,
   provider_turn_id=...)`, `mark_provider_unknown(receipt_cap)` and
   `record_provider_result(receipt_cap, result)` retain correlation/receipt/usage
   even after lease/grant expiry, revoke, pause, cancel or source-access loss.
   `ProviderResult` contains bounded session/turn IDs, bodies, unresolved items and
   input/output usage. These methods return **only a boolean ACK**, not stored
   content; contradictory repeats fail and identical receipts are replay-safe.
   They do not read private sources, send, renew a lease, publish or restore access.
6. Existing `complete_run`/proposal broker publication requires the exact stored
   receipt bodies/unresolved list and **current** authority/pins/valid lease.
   `recover_provider_run` after lease expiry grants a new fence only for local
   publication, never inference; an expired/revoked run grant still denies it.
7. `reconcile_provider_attempt(receipt_cap)` internally compares immutable
   publication bindings, actual revisions/proposals and stored result. It returns
   only a boolean, marks reconciled and ACKs the existing outbox atomically. Already
   committed history can be ACKed after authority loss without exposing its content
   or permitting new publication. It cannot ACK an absent/inconsistent publication.
   Postcommit grant revoke → safe ACK → fresh grant → new revision is supported.
8. `fail_provider_attempt(receipt_cap)` terminally abandons **only `prepared`**,
   definitely-unsent attempts, even after pause/expiry. One transaction records
   `unsent_abandoned`, sets run partial with a reason, increments fence, clears
   lease/token, refreshes assignment progress (preserving paused/cancelled control),
   and ACKs outbox/dispatch. Replay is inert. New work requires explicit admission;
   the failed run is never reclaimed or resent. DB guards reject dispatched/unknown
   → failed even for direct owner SQL; a timeout is not definitely unsent.

`get_provider_attempt(human_principal, workspace, run)` remains a separate private
read path requiring current membership, exact owning principal and every selected
source authorization. Possession of a receipt capability does not enable it.

One attempt **total per run** remains deliberate. Prepared/dispatched/unknown/
responded attempts block replacement runs on the assignment. The fixture scheduler
defers managed work; it cannot substitute fixture output. Losing a receipt
capability or getting an unknown outcome without provider IDs can remain unresolved.
There is no emergency free-principal bypass, automatic resend or fabricated receipt.
This is local fenced admission, **not provider exactly-once**. Future tool-result
continuations require a separately reviewed logical-dispatch ledger; this fix adds
neither multi-step inference nor an HTTP transport.

## Operator grants and compatibility

`configure_grant(owner_db, ProviderGrant(...))` / `revoke_grant(owner_db,id)` remain
migration-owner-only seams. No new grant CLI/HTTP/model tool or seeded product grant.
The existing profile's model field is an opaque configured string, not evidence of
API/route compatibility. Grant count/expiry remain local admission limits.
`max_received_output_tokens` is only a local publication ceiling; incurred usage is
retained even when publication is refused. `provider_hard_budget="not_enforced"`
still means no provider hard call/token/USD guarantee. A separately approved route,
consumer and product credential are required before any real execution.

Original fixture bytes, approved bundles, context and configurations are unchanged.
Both pre-checkpoint and checkpoint tool registries are archived with exact byte and
canonical hashes; compatible existing runs keep their pins. Unknown hashes fail
closed. New runs pin the new registry; no immutable record is rewritten.

## Additive migration / upgrade privileges

001–004 are unchanged. Apply **005_receipt_retention.sql** via the migration owner
before starting this code. It adds receipt-key hash, conservative evidence origin,
abandonment reason and tightening guards to `provider_attempts`; no new tables,
sequences, roles, authority bypass or fabricated data backfill. A second apply via
`workagent.db.migrate` is a checksum-journal no-op.

An installation already provisioned for 004 needs **no extra runtime privilege**
for 005: existing table-level SELECT/INSERT/UPDATE on `provider_attempts` covers the
new columns. Column-specific ACL installations must extend only those three new
columns for the same existing operations; do not grant DELETE, ownership, BYPASSRLS
or grant/publication mutations. Migration operator still owns all DDL.

For upgrades from before 004, explicitly grant the runtime SELECT on
`provider_grants, provider_attempts, run_publications`, INSERT on
`provider_attempts, run_publications`, and UPDATE on `provider_attempts`. Never give
it grant mutation or publication UPDATE/DELETE. `dev_db.py` applies this for new
isolated disposable databases; existing deployments require owner-executed grants.

Legacy attempts without a preexisting receipt-secret binding remain conservative:
005 does not manufacture credentials, relabel evidence as live, or silently enable
retention/ACK through a human identity. Resolve those synthetic/operator records
under a separately reviewed migration procedure; do not reset or rewrite history.
Old completed records without publication bindings remain unverified.

Maintained tests convert independent review characterization into intended-state
assertions; raw reviewer originals remain untouched. Evidence covers red-before-
green R1/R2/R3, immutable capability retarget rejection, post-revoke no-read/no-send,
postcommit reconciliation, unknown/unsent races, rollback/idempotency, historical vs
current projection, exact-base questions, conservative origin, registry pins and
real PostgreSQL privileges. All provider-shaped test evidence is synthetic.
Generated contracts are OpenAPI, tool registry, examples and TypeScript. Final
backend review and parent-owned frontend integration remain separate gates.
