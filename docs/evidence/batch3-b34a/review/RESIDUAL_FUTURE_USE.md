# B3.4a residual — post-rollback and source-revoke future use

**PASS for this residual only.** No product source changes, new review/Claude invocation,
paid product calls, transfer replay, build, deployment or full B3.4a/Batch 3 acceptance.
Existing audit `t_a6fd92de`, package `t_58f29c05` and parent `t_0ff857b1` retain their work.

## Evidence level

Real restricted PostgreSQL, real authenticated TCP API on owned port 18240 and the
production GeneralWorker. Only the model HTTP transport is controlled (`httpx.MockTransport`,
`AlphaProvider`): every decision is a fixed reply, no computation/file mutation or
model benefit claim. Actual outgoing request-body SHA-256 and context were captured
at that transport boundary, then matched to HTTP memory-usage and persisted
`responses_steps` by attempt and phase. This is stronger than DB selection alone,
but not a live model/service call. Both selection and final phases were checked.
New worker instances re-read completed runs without another provider request; this
is worker idempotency, not a new OS-process restart campaign.

## Fresh use after the already-completed client rollbacks

| Previously exercised client | Original adopted revision retained in historical usage | Restored revision used in both fresh requests | Fresh run |
|---|---|---|---|
| Web | `397c0e87-d781-435c-a479-dd137f556277` | `9027eae7-bf25-4336-bac2-1e2bf84cd5f9` | `81ebe2a0-0a5d-4da2-a115-3384cbcb9329` |
| Native | `7bb17eb6-a3d8-4aba-a4aa-cf62d8a25337` | `3b151a41-c611-41a8-a4a2-d12cd4740bc5` | `f675f18e-1b53-4285-8f8e-f4bd73ba2064` |

The restored content equals the adopted content, with a new revision identity,
active status and inferred confidence. Original successful denominator/editorial
usage receipts remain byte-for-byte equal to the retained prior HTTP results;
they still name the original adopted revisions, not the restored identities.
The original useful transfer outputs were not recomputed.

## Separate source-revoke control

A dedicated task-scoped procedure was proposed from an actual synthetic human
message and explicitly adopted. A correction added a source dependency; rollback
to the earlier adoption restored its content while retaining the dependency union.
The source belongs to a separate newly created source-bearing conversation in the
same explicitly bound work area, keeping the execution conversation itself usable.
No original useful source, original lesson, membership or grant was revoked.

- Procedure `5f62d7e5-cc21-4e93-b15a-63fe3e2d6d58`, restored revision `6cb6f864-d46e-476d-a843-94413e7dd441`.
- Exact dedicated source `residual-source-124b5cad-586c-433d-b8a3-37546ce845ea`.
- Positive run `730f03c9-6159-4cdf-b3f3-0708a8032124`: both requests use that restored procedure.
- Revoked exactly its one `source_access` row (`active=false`) and read back the real DB state.
- Real HTTP GET of source and dependent current procedure returns **404**; list is empty with `has_more=false`.
- Future run `02f076cd-925b-4126-a360-4bf656b556dd`: both request manifests and memory-context items are empty; the full captured contexts contain neither the dependent lesson payload nor its source ID.
- Earlier successful control usage remains immutable and readable after revoke.

## Human work and existing state retained

HTTP current-file reads before work, after rollback, before/after revoke and at final
verification match the retained deliverable bytes and exact file/version IDs:

- transfer: **107 bytes**, SHA-256 `c0b01b8262cc1d3c7d00d54d84ef3617b908a2ef4f488a3c6c2351760f413b35`, version `32afa607-802c-45f1-bc29-ecb9ca173014`.
- editorial: **554 bytes**, SHA-256 `0cb5a5d85b274785ecca405a8b15c05612ee67dcf8031ed1801304206e9f53b2`, version `3644ff0c-d3c0-4ffc-a2bb-cc4794917893`.

Whole-row hash multisets cover all 68 existing public tables. All pre-existing
rows remain unchanged except the two intended transfer/editorial conversation
state rows, their two conversation event projections and this workspace's one
event-head position. Current changed conversation IDs were checked against those
two plus the three newly created control conversations/work area. All pre-existing
run/usage/request, memory-revision, saved-file, source-ACL and grant rows remain;
**all grant rows are exactly unchanged**. New synthetic usage/accounting remains
recorded normally, not refunded or erased. The historical unknown runs in this DB
were not replayed or modified; the old test-02 DB was never opened.

All 32 SECOND-checkpoint source hashes and the retained pnpm lock match before
and after. No full new build claim: web and compute were unnecessary and never
started. Prior reviewed real-PG/HTTP revoke/CAS/conflict/human-file tests are reused
from REVIEW_CLOSURE/REVIEW_RESIDUAL; they were not rerun here.

## Retained harness failures, not product defects

- Direct execution of non-executable `run-env.sh` was refused before any proof;
  use `bash .local/batch3/b34a/run-env.sh ...` (no chmod needed).
- `control.log`: correction correctly returned 404 because its readable source
  had not yet been selected into the procedure's authorized project. Readback
  verified unchanged adopted revision and no committed command. Only the new
  synthetic conversations were explicitly bound; the exact original correction
  command was then sent and read back successfully. No unknown outcome was retried.
- `verify.log`: initial read-only preservation check omitted expected event-head/
  projection movement. `verify-final.log` separately checks the exact intended
  scopes and preserves the failed check; no mutations or worker runs were repeated.

## Exact evidence and shutdown

Evidence root: `.local/batch3/b34a/journey-v2/evidence/future-use-residual/`.
`results.json` contains exact run/revision/request/output identities; `manifest.json`
binds all local evidence plus the harness and reused review/source checkpoints.
Raw `*-wire.json` and worker state are retained private: do not blindly publish
request contexts. Packaging owns its full privacy/source/build review.

- Results SHA-256: `a4c78b0f205f221c5076a86d9e79af77c3ae25961b9021c62e702a5e13f86d41`.
- Harness SHA-256: `20ea7603b29ff0acd0ede56a75aa9e12d1986858ae36ba07e53d21ac851218ba`.
- API 18240 stopped with PID/start/cwd ownership verification; final PID absent,
  connect refused 111. Web 13240 remains stopped, PID absent/refused 111.
- `workagent-compute-b34a`: inactive/MainPID 0; never started here. No installed
  service touched. Final disk headroom approximately 25 GiB.

Commands executed serially under test-04 + tokenizer HOME/native-state wrapper:
`prepare`, `rollback`, `control` (fixture prerequisite denial), `control-resume`,
`revoke`, `verify` (read-only verifier mismatch), `verify-final`.
**Five fresh reply-only runs, ten controlled model request boundaries**, including
the setup human-observation run; eight boundaries are the named acceptance probes.
No production source delta requires new independent review.
