# B3.0b — exact-version files, source snapshots and basic exports

Accepted B3.0b substrate. See `../evidence/batch3-b30b/ACCEPTANCE.md` for
exact source, verification and qualifications. This is not computation,
office-format fidelity, a paid-model evaluation, Batch3 completion, or runtime promotion.

## Identity and storage

- Working-file IDs are opaque and artifact-backed. Every read/edit/export binds
  an explicit version ID and SHA256. Filename is bounded display metadata,
  never a host path. Reads are bounded UTF-8 byte ranges with explicit omissions.
- Human edits require exact base version/hash and conversation work-version CAS.
  Agent patches are proposals, not silent acceptance of human work.
- Immutable evidence snapshots reference existing document/original-attachment
  identities and hashes. Original bytes are not duplicated into a second store.
  Refresh creates a new version linked to its parent; older evidence remains
  readable. Extraction status/coverage/parser identity and observations are
  retained; absent source version timestamps remain null.
- Migrations054/055 introduce file/snapshot/export storage and the file gateway.
  Additive056 restricts inherited artifact aliases to the file owner without
  hiding ordinary shared artifacts. Owner filtering occurs before inherited
  enumeration, pagination, proposal counts, and omission counts.

## Gateway and execution

`files.list`, `files.read_range`, `files.create_draft`, `files.propose_patch`,
`files.compare` and `artifacts.export` use the common tool authority, selectors,
reservation/dispatch/observation accounting and run fence. Availability is not a
grant. A newly created file does not implicitly authorize unrelated inputs.

The opted-in file decision schema extends sustained execution, leaving historical
schemas intact. Request validation and persisted-request restoration must select
that exact validator. A settled gateway-created draft may be excluded from the
run's original frozen input only when its exact immutable observation, owner,
conversation, current revision, worker authorship and bytes still match. A human
revision, foreign addition, or unknown outcome must not be normalized away or
recreated. Controlled transport proof is not evidence of model usefulness.

## Byte-preserving export and clients

TXT/Markdown/CSV/JSON exports create actual downloadable bytes and a manifest
with digest, length, source version, omissions and provenance. Formula-like CSV
cells are escaped; safe numeric negatives remain numeric. BOM/newline/Unicode
and human annotations are preserved or an explicit normalization choice/omission
is shown. Generated blob contracts leave room for later office/rendering work.

Web consumes generated OpenAPI/TypeScript DTOs, not handwritten wire contracts.
The BFF treats JSON exports as bytes and validates path, scope, filename/MIME and
digest before forwarding. Native and web verify downloaded byte length/hash.

Native drafts journal exact commands before sending. A matching definitive
first-attempt rejection is durably rejected. Explicit resolution archives the
rejected envelope, preserves text and exact file base, and refreshes only the
conversation CAS. Earlier ambiguity, unmatched rejection, legacy state or restart
cannot become safe reprepare because a later response rejects.

**Web replay ownership:** unresolved saves lock editing; preexisting newer drafts
survive exact replay and remain explicitly recoverable. Dead-mount completions
return before journal/draft mutation. Matching-envelope clearing, matching draft
ownership and post-hash fencing protect both old-first and replay-first orders.
Actual-hook regressions and real delayed/lost-ACK browser proofs cover these
races. Claude remains the sole web writer.

## Verification and operating boundary

Tests and UI journeys use disposable restricted PostgreSQL and loopback APIs.
No installed database/migration history or historical receipt was replaced. The
isolated web-owner optimized build is source/config/contracts-bound; main `.next`
and intentionally retained published/stale processes are untouched. Failed logs
and unsuccessful captures remain negative evidence, never passes. Exact commands,
exits, source manifests, review and remaining blockers are in the evidence handoff.
