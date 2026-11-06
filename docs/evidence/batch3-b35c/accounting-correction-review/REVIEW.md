# Independent pre-mutation review — REQUIRED CHANGES

## Verdict and scope

**REQUIRED CHANGES before installed mutation: R1 and R2 below.** The exact frozen 186-row adjustment passes the financial and receipt-consistency checks described here. This is not approval to issue usable paid authority, deploy, migrate 046→074, or accept the whole study. Existing R1–R4 controller acceptance is not reopened.

Reviewed workspace HEAD: `d9e5d89bf905ccf0fe5a5bee2bca4bd1cd1ed9b3`. The three correction implementation files are untracked working-tree files; HEAD alone does not identify them. No implementation, installed database, service, board state, profile or model was changed by this reviewer. One new quarantined disposable restored database and additive review files were created. Zero provider calls.

## Required changes

### R1 — P2: table/advisory lock inversion can abort a live sender

`evaluation/verify_accounting_correction.py:56` obtains SHARE locks on `responses_events`, `responses_steps`, and `provider_grants`, then `release_exact()` takes advisory lock721004120 (`evaluation/accounting_correction.sql:50`). The normal Python sender takes that advisory lock **before** inserting into `responses_events` (`backend/workagent/responses_ledger.py:209–246`). Thus:

1. Sender owns advisory721004120, before its INSERT/table RowExclusive lock.
2. Correction owns table SHARE, waits for advisory721004120.
3. Sender requests RowExclusive, waits for correction's SHARE.

**Independently reproduced** on `workagent_test_correction_review_5971eab572a6`; PostgreSQL selected the simulated sender as the deadlock victim. The reproduction uses the exact lock sequence and real PostgreSQL transactions, not provider calls or a live worker. This is an availability/failure-mode defect, not demonstrated overspending: transactions roll back and original rows stayed unchanged.

Do not copy that sequence into installation. Prefer the advisory lock alone for this additive adjustment over immutable receipt rows, or use a nonblocking acquisition/rollback protocol, or explicitly quiesce relevant writers for the bounded mutation. Simply reversing the two locks is not a universal fix: direct INSERT clients acquire table RowExclusive before their SQL trigger takes advisory. Exercise the chosen protocol against an in-flight sender and prove both controlled completion/denial and unchanged accounting. No broad runtime redesign is needed.

### R2 — P2: supply the bounded installed execution/recovery procedure

The owner explicitly requires a restore/recovery procedure before installed mutation. The retained dump and a successful isolated restore exist, but the reviewed three-file package contains no installed execution/recovery wrapper or operational procedure. `pg()` accepts any `workagent_test_*` database; SQL does not pin the canonical source database, reviewed candidate manifest, authority document hash, or central accounting lineage. `auth_hash` and target binding are merely caller-supplied well-formed strings. Those are acceptable inputs to a **trusted one-off operator**, not independently validated authority.

Before mutation, provide an exact procedure or guarded wrapper that:

- Names the single authoritative issuer/source `workagent_test_47b87fe3b82e`, the frozen186 dispatch/result/hash tuples, expected release, reviewed SQL and owner-authorization hashes; fail closed on mismatch. Explicitly designate restored copies as nonissuers.
- Confirms the99.605960 baseline has not gained an independent allocation since the retained reconciliation. Future additions must use this single accounting authority or be explicitly included; the hardcoded baseline cannot discover out-of-band owner allocations.
- Takes a consistent identifiable backup and preserves the post-correction journal and any certificate issuance during recovery. Before COMMIT, rollback/retry is safe. After COMMIT or uncertain ACK, exact readback/idempotent replay is required. **Never restore a pre-certificate image as a fresh issuer or resume cloned grants** after a recipient may have consumed the certificate.
- Specifies the R1-safe lock protocol, actual installed-role ACL checks, exact installed readback and retained original-row verification. A whole-table equality assertion needs a writer fence; legitimate concurrent appends otherwise invalidate it without implying corruption.

This can be a short narrow runbook, not a new accounting platform. The explicit missing recipient-side immutable DB/source/grant-pool binding remains a separate **paid-execution prerequisite**; do not claim the issuer table itself enforces recipient admission.

## Findings that pass for the frozen correction

### Liability arithmetic and competing grants

Independent Decimal computation validates the historical allocation chain (all prior/addition/cumulative links plus the two campaign additions) at **99.605960USD**. The exact186 eligible dispatches reserve **38.48712USD**, retain **6.9408600USD** at full uncached2.5USD/M input and10USD/M output, and release **31.5462600USD**. Net retained allocation becomes **68.0597000USD**; total unallocated ceiling headroom becomes **31.9403000USD**. These are internal conservative accounting amounts, **not provider bills or currently executable grants**.

The original20USD, all carry, other pools, ancillary allowances, unresolved outcomes and all old unspent capacity remain retained in the baseline. In the frozen13-store reconciliation the seven eligible grants09–15 occur only in the primary store. This was checked programmatically, not inferred from grant names. The fresh primary snapshot is at `2026-10-29T22:48:28.132567+00:00` with no other DB sessions at that instant; this is not an ongoing fence.

Unchanged old admission counts full historical reservations and never reads the correction table. Releasing a past unused portion therefore does **not** refill old grants. Existing senders can consume only their already-retained residual. Consequently other stores need not share a PostgreSQL advisory lock to preserve this narrow conservation argument; PostgreSQL advisory locks are database-local, not a13-store coordinator. This conclusion depends on not independently increasing grants, cloning live pools or reallocating baseline capacity outside the issuer.

### Receipt authenticity and pricing bounds

On the actual frozen candidates, all186 result identities are unique; complete metadata matches the immutable step metadata; request payloads are `model=gpt-6.1-sol`, `service_tier=default`; all results carry official-api/OpenAI provenance and terminal `completed`/`function_call` state. Usage totals and cached/reasoning detail bounds are consistent. SQL rechecks dispatch/result/step linkage, stored JSON hashes, an existing matching identity, known integral nonnegative usage, token reservations and the exact rate-derived reservation. No unknown receipt is credited.

The retained transport parser checks model/default tier and usage bounds before producing these terminal states (`responses_transport.py:360–374,434–452`); reasoning is already within output tokens, so adding it again would double count. No cached-input discount is used. These are trusted application-retained receipts, not cryptographically provider-signed receipts or independently verified invoices. The correction does not itself authenticate arbitrary future receipt creation. Restricting execution to the reviewed frozen manifest is what keeps this a one-off audit rather than a generic settlement oracle. No new billing-account access is demanded.

Nonblocking hardening: SQL's `r.data->>'state' NOT IN (...)` and transport comparison use nullable predicates, rather than `IS DISTINCT FROM`/explicit null rejection. No frozen candidate has missing fields, and this review does not claim an exploit of an honest candidate; if the helper is kept for broader future use, make those checks fail closed and explicitly validate request model/tier and full usage details rather than relying on this fixed audit.

### Duplicate credit, certificates and isolation

Primary/unique constraints cover dispatch, result and response IDs. READ COMMITTED plus the shared transaction advisory lock serializes release and certificate operations. Four concurrent **first insert** attempts for the same release produced one row; this extends the author's existing-row replay proof. Two20USD certificates, each affordable alone, yielded exactly one acceptance and one `cumulative_100_exceeded`; exact retry did not duplicate, changed amount/target was denied. Repeatable-read/serializable and nonfinite/nonpositive certificate probes were denied.

A certificate is an irrevocable encumbrance in the issuer, not a transferable bearer balance. Its ID, target name, hash and amount are immutable. Different IDs may legitimately allocate additional amounts, but their sum remains counted. Recipient single-consumption, clone resistance, source/grant-pool hash interpretation, and enforcement of its own spending ceiling are not implemented here and are **not approved by these issuer-only tests**.

### Rollback, preservation and privileges

Freshly restored the actual12,655,183-byte dump (hash below). A deliberately bad second receipt rolled back a valid first insertion. All35 original public tables /8,764 rows matched before and after the independent run. DELETE and TRUNCATE of both correction histories were denied. The original migration journal remains at046; no upgrade was applied.

Functions are SECURITY INVOKER with fixed `search_path=pg_catalog`; public targets and correction tables are schema-qualified. PUBLIC schema/table/function access is revoked. The original restricted runtime role could not read/write/execute correction objects, issue certificates, or connect to the quarantined restore. Catalog checks found no nonsuperuser login role with correction-schema USAGE in that restored deployment. PostgreSQL built-in `pg_read_all_data`/`pg_write_all_data` and superusers are privileged trust boundaries, not runtime identities. The owner can bypass triggers/directly insert, so operator discipline remains explicit. Restore used `--no-owner`, making the disposable object owner postgres; installed role/ACL readback is still required rather than assuming exact ownership equivalence.

## Is the certificate table needlessly broad?

**A small append-only allocation/issuance journal is proportionate** if released capacity is to fund several isolated evaluation stores: it prevents independent recipients from each treating the entire released amount as available. Two owner-only tables and locked issuance do not themselves constitute an unrelated product-schema migration. There is no reason to build transfer/refund/rebalancing APIs, change normal runtime admission, or upgrade046→074 to accomplish the correction.

**The helper's indefinitely reusable scope is broader than this frozen one-off**, however: any eligible future receipt and any syntactically valid target/hash can be submitted by the owner. Narrow that operationally with R2, or replace it with exact one-off inserts and a frozen issuance manifest. Keeping a permanent general-purpose certificate service is unnecessary. Do not activate an opaque target hash before a real immutable binding/consumer has been separately verified.

## Commands and fresh evidence

From `/home/ubuntu/workagent-continuation-20261026`:

```sh
python3 docs/evidence/batch3-b35c/accounting-correction-review/independent_probe.py
sha256sum evaluation/test_accounting_correction.py evaluation/accounting_correction.sql evaluation/verify_accounting_correction.py
```

The probe itself records the exact `psql`/`pg_restore` commands and all SQL. It connects to postgres only for creating its fresh disposable database, never to the installed primary. Exit0: **10 named checks passed**, plus the intentional deadlock reproduction. Machine evidence: `independent-results.json`. Original author evidence was inspected at `.local/batch3/b35c/accounting-correction/disposable-verification.json`, not overwritten. No broader suite or real-provider test was run. The disposable database remains quarantined, with zero other sessions at final readback.

## Exact SHA-256 identities

| File | SHA-256 |
|---|---|
| `evaluation/test_accounting_correction.py` | `03c84a36abd3e3fe48f7146d7acb519141ce0239929e4ebfe11c778d036da12c` |
| `evaluation/accounting_correction.sql` | `d54caa75f8a2528b6469b2057ff6f6e06844740a855e444e66b4d02c892aab63` |
| `evaluation/verify_accounting_correction.py` | `3c1055ee1d1e1be7a4c6b44ff42f8fb290d3302f8e9b69ffbb092a189c3e079b` |
| `docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md` | `73d61b550c50d04caa83077ba0883536b2012ca9eabd430de5f05c2212496965` |
| private correction `primary-before.dump` | `c72935850cfef1729ea6a0461030435c203c5f6205abfe370549eb187ee9e60e` |
| correction `candidate-01.json` | `91c3c7d9e2542a7a55bbfd75c1675e556318c5957e279078aeac14ca6700ad37` |
| private correction `primary-readonly-01.private.json` | `2e4d50b8965374289116431d6e4230d300d3e3d2f3deb64a3b6d35ae2f52673a` |
| author `disposable-verification.json` | `63927693be173239094379c8f81e54f45fa6398c315a0ccc70325ea95bd2467d` |
| execution ledger `current-reconciliation.json` | `53306d858e4c04d3eaa64e923a7a72950d44cf681eaab5061025d64d63af4673` |

All private correction paths above are under `.local/batch3/b35c/accounting-correction/`; the execution ledger is under `.local/batch3/b35c/execution/ledger/`. Private payloads/credentials are not copied into this review.
