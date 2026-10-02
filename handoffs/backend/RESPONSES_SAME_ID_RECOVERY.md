# Same-ID final reasoning readback recovery

## Observed defect (not a new provider failure)

The recorded final Responses object was `completed`, model `gpt-6.1-sol`, with
valid usage and a substantively valid structured next-action DTO. Its reasoning
item had `{id, type: "reasoning", content: [], summary: []}` and **no
`encrypted_content`**. The consumer incorrectly required encrypted continuation
state for final output, returning `malformed / invalid_reasoning_item`, discarding
the parsed value and retaining usage. No further model continuation follows final
output. Missing/null encrypted content is now permitted **only for final**;
selection still requires nonempty encrypted continuation content. Supplied invalid
non-string/empty encrypted content is still rejected. Model, tier, metadata,
response ID, project, strict schema and usage checks are not relaxed.

The fixture `backend/tests/fixtures/final_reasoning_no_cipher.json` reproduces the
observed shape and usage with synthetic IDs/text, no credentials, no ciphertext,
and no captured prompt/model prose. It is replayed through the actual worker over
`httpx.MockTransport`; it is not an artifact import fixture.

## Immutable repair, same budget root

Migration `008_responses_recovery.sql` is additive. It creates an owner-only,
append-only `provider_consumer_successors` approval (at most one per original
grant), immutable `responses_consumer_uses` audit rows, and a bounded
`corrected_readback` event (at most one per final phase). It does not rewrite any
old grant, run configuration, request/count bytes or hashes, event, reservation,
provider result or publication. Runtime/model tools cannot install an approval.

The successor approval requires the exact original consumer SHA, current reviewed
successor SHA, and `service.digest(ProviderGrant)` of the **entire immutable
original grant**, binding unchanged model/project/reference/instructions/schema/
scope/tool pins, principal/workspace, run/output/request/cost caps and old expiry.
Every non-consumer pin is checked again against the current runtime. No legacy
hash allowlist or automatic self-approval exists. Actual successor identity is
recorded separately from the immutable original identity on each attempt.

An explicitly approved one-time local lease may expire at most one hour after
installation. This is not renewed user authority or source access: revoked grants,
revoked membership/source access, changed sources/configuration or stale revisions
still prevent further reads/publication. Approval cannot be replaced or repeatedly
extended. Already-dispatched unknown requests remain unknown and are never resent.
Existing arrival-only receipt-retention permissions are unchanged; corrected
readback additionally needs current worker/scope authority.

`--reconcile-run` refuses runs without their existing private receipt capability,
never counts or generates, and takes at most one GET for this repair. The GET
uses the existing recorded final response ID, with ordinary retrieve (no include
retry). Only the original `invalid_reasoning_item` final observation with retained
usage and no parsed value qualifies. The correction must match response ID,
request hash, correlation metadata, model, provenance and **all usage components**;
it includes the original event ID/hash/issue, actual/original consumer identities
and the reserved read-event ID. Invalid/mismatched GETs cannot append a correction
or publish. All reads still consume the original grant's cumulative read cap.

After committed correction readback, the canonical worker creates/retains the
canonical provider result and calls `complete_run`; public readback prefers the
checked correction while the original malformed event remains immutable. Restart
uses the checked correction without another GET or receipt overwrite. Publication
still rechecks current authority. No operator DTO ingestion or manual publication
path was added.

## Trusted operator procedure (NOT executed against live state by this patch)

Stop concurrent consumers for this grant; review the code/commit and existing
user authority first. Preserve the original private state directory. Do not
create a replacement grant or regenerate the initial response. Use the existing
runtime/owner environment securely; never print its values or read the provider
key during approval preparation. All commands below run from `backend/`.

1. Apply the reviewed migration with the existing owner role:

   ```sh
   .venv/bin/python -c 'import os; from workagent.db import migrate; migrate(os.environ["MIGRATION_DATABASE_URL"])'
   ```

2. Prepare an explicit operator JSON, **not automatically installed**. Its exact
   accepted fields are:

   ```json
   {
     "grant_id": "intake-live-01",
     "original_consumer_sha256": "45b6240d4981263c7ea5eb3024988d4402e43bc800b153bc736d2188b6f64c5a",
     "successor_consumer_sha256": "82890be27762c227d7a3e42c7db23599173399cc576ad8c20dec5a7aca54c633",
     "original_grant_sha256": "<digest of the existing immutable ProviderGrant, NOT a new grant>",
     "expires_at": "<operator-selected UTC expiry no more than one hour ahead>",
     "reason": "Reviewed final reasoning optional-content parser repair; same grant and budget"
   }
   ```

   The placeholders are intentionally invalid; fill them only after reviewing the
   current root grant and user authority. `consumer_hash()` must equal the reviewed
   successor above; a source edit changes the hash and requires a fresh review,
   not a bypass. To derive the immutable root digest without showing project/key
   references or grant contents, this read-only snippet can be run by the operator:

   ```python
   from workagent.db import Database
   from workagent.models import ProviderGrant
   from workagent.service import digest
   from workagent.responses_worker import consumer_hash
   with Database().transaction() as c:
       row = c.execute("SELECT data,active FROM provider_grants WHERE id=%s", ("intake-live-01",)).fetchone()
       assert row and row["active"]
       grant = ProviderGrant.model_validate(row["data"])
       assert grant.consumer_sha256 == "45b6240d4981263c7ea5eb3024988d4402e43bc800b153bc736d2188b6f64c5a"
       print({"original_grant_sha256": digest(grant), "successor_consumer_sha256": consumer_hash()})
   ```

3. Explicitly install the reviewed JSON using the existing authority record,
   workspace and private state directory (variables below refer to already-known
   paths/IDs; do not invent or replace them):

   ```sh
   .venv/bin/python -m workagent.responses_dispatcher \
     --authority-record "$AUTHORITY_RECORD" --workspace "$WORKSPACE_ID" \
     --grant-id intake-live-01 --state-dir "$EXISTING_STATE_DIR" \
     --install-successor "$REVIEWED_SUCCESSOR_JSON"
   ```

   This performs no provider request/key load. Require
   `operator_successor_installed` and exact approval readback. It does not reset
   counters or rewrite the grant. Installation requires the owner role; runtime
   credentials fail closed. Do not proceed if source pins, grant digest or lease
   checks fail. Never change the original authority record to force admission.

4. Recover only the existing initial run:

   ```sh
   .venv/bin/python -m workagent.responses_dispatcher \
     --authority-record "$AUTHORITY_RECORD" --workspace "$WORKSPACE_ID" \
     --grant-id intake-live-01 --state-dir "$EXISTING_STATE_DIR" \
     --reconcile-run d5e4a200-5886-4386-b595-1e0c00f7ed48
   ```

   Existing attempt: `660c8660-da53-4a39-840f-5fe176101322`; final response:
   `resp_0c2c4ce616fe650c006ac01649075887d0b52cd306cd1e3dd7`.
   Require canonical completion/reconciliation and product assignment/artifact/
   responsibility readback before calling recovery successful. Compare full ledger
   before/after: count and generation remain **2 + 2**, cancel remains zero,
   reserved/observed totals are unchanged, and exactly one read is added on the
   success path (the reported pre-repair read count was 8; preserve all prior
   diagnostic read reservations). The CLI returns current root-budget counters.
   If the worker lease is still actively held, wait for expiry; do not overwrite
   private worker/receipt capabilities. If the source grant is revoked, stop.

5. Only after successful initial publication and a user-authorized revision,
   enqueue the revision through the normal product `request_revision` path and
   run the existing dispatcher `--once` against **the same grant**. This uses the
   remaining two generations/counts, reaching cumulative maximum four. It retains
   original run pins and adds actual successor-use audit evidence. A third run,
   fifth generation, ambiguous-dispatch retry, or silent regeneration is denied.
   The approval lease must still be valid; no replacement grant/counter reset is
   an allowed workaround.

## Verification evidence

Only `.local/intake-checkpoint-v3.env` and newly provisioned disposable migration
probe databases were used. No official requests, live database operations, key
reads, authority-record edits, deployment or push were performed for this patch.
The captured private final response also passed local strict DTO, model/tier,
exact correlation, output-shape and usage validation without printing its body or
performing DB/network/publication operations. The original parser was replayed
against the new actual-worker regression and returned `invalid_final` instead of
`completed` (verified RED). The repaired worker
passes final missing-content, strict selection, same-ID correction, wrong ID/hash/
metadata/model/schema/usage, immutable-event/receipt, expired lease/grant,
revocation, unknown dispatch, runtime approval denial, CLI install readback and
shared-root initial-plus-revision cap tests. Final verification: **331 backend and
runtime tests passed** (one existing Starlette/AnyIO deprecation warning); JSON
contract drift, regenerated TypeScript drift/typecheck, Python compile and
`git diff --check` passed. No public contract/schema files changed. An independent
parent review is still required before approving/installing any live successor.
