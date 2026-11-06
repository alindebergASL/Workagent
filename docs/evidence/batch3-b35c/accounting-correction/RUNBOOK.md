# Scoped accounting correction — execution and recovery

Authority: `docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md`, exact owner approval
hash `73d61b550c50d04caa83077ba0883536b2012ca9eabd430de5f05c2212496965`.
This is **one correction of186 frozen receipt pairs**, not a generic settlement
service. No provider request, receipt replay, invoice access, installed046→074
upgrade, service replacement or deployment is involved.

## Conservation and possible spenders

Retained allocation baseline:99.605960USD. Only the seven primary grants09–15
are adjusted; they are unique to the primary in the accepted13-store snapshot.
Their186 terminal receipts reserved38.48712; full uncached standard pricing
retains6.9408600 and demonstrates31.5462600 unused. These amounts are usage-based
upper estimates, **not settled bills or refunds**. No cached discount is assumed.

After adjustment:68.0597000 remains encumbered;31.9403000 is globally unallocated.
The original20USD, carry, all unknown usage/charges, every other pool, ancillary
allowances and all existing unspent authority remain fully encumbered. No other
pool is collected or released. Old admission continues charging **all** historical
reservations; no old grant gains additional usable headroom from this adjustment.
This is why older stores can retain their original gates without a cross-store
coordinator or13-store recollection. New independent allocations outside this
single issuer would invalidate this proof and are prohibited during this study.
Parent `t_82b30c02` was notified of sole-lane issuance in comment325.

Installed private-development API/worker PIDs875172/875174 continue to use the
primary. Their full remaining capacity is still retained. Recent campaign pools
`workagent_test_8c78561a8e8d` and `workagent_test_942379a11eb1` remain expired;
the closure pool has no official grants. The wrapper refreshes their exact grant
hash/active flags and campaign allocation/linkage/expiry, plus primary grant
identity. It rejects changes. This is a scoped current-state check, not an
account-wide billing assertion or repeated collection of13 ledgers.

## Before mutation

- Canonical source/issuer ONLY: `workagent_test_47b87fe3b82e`, database OID7704275.
  Both SQL issuance functions enforce that name/OID. A restored/renamed copy is
  **never an issuer**. Testing substitutes both constants only inside a quarantined
  disposable database, with PUBLIC CONNECT revoked and no worker credentials.
- A consistent `pg_dump -Fc` is retained privately at
  `.local/batch3/b35c/accounting-correction/primary-before.dump`,12,655,183 bytes,
  SHA256 `c72935850cfef1729ea6a0461030435c203c5f6205abfe370549eb187ee9e60e`.
  The dump was independently restored twice and restored again after review fixes.
  Do not publish it or any private receipt payloads.
- The wrapper pins SQL, helper code, owner approval, frozen186 tuples, historical
  baseline and final disposable evidence. Source original-table inventory must
  match the restore before installation. Changes fail closed for investigation.
- Focused review must close its two findings before `--apply`; it is not a new
  owner-approval request. `--check` is read-only.

```sh
python3 evaluation/install_accounting_correction.py --check
# After focused review closure only:
python3 evaluation/install_accounting_correction.py --apply
```

The transaction takes advisory721004120 with a10-second lock timeout and45-second
statement timeout. It takes **no conflicting table SHARE lock**. Immutable source
receipts plus exact hash/metadata/model/tier/usage checks are sufficient. Both
Python advisory-first and SQL table-first sender interleavings were tested on a
restored copy; both complete without deadlock. DDL and186 adjustments commit
atomically. No existing row is updated/deleted and no existing gate is replaced.

## Readback and recovery

- Before COMMIT: failure aborts the entire transaction. A bad second receipt
  after a valid first receipt was exercised and leaves zero adjustments.
- After COMMIT or uncertain acknowledgment: first query the **canonical issuer**.
  Exact idempotent replay/readback is safe; do not issue an additional credit.
  Re-execution of the wrapper skips DDL when the schema exists and verifies exact
 186 rows, amounts, owner authority, stored function bodies and runtime ACL denial.
- Original35 tables/8,764 rows are compared before/after. Legitimate concurrent
  unrelated appends would invalidate exact equality and require investigation;
  do not erase them or pretend they are data loss. Paid release remains locked.
- Preserve the post-correction journal and **all certificate issuances** durably.
  Immediately take another consistent private dump after installed verification,
  restore it to a new quarantined inspection DB, and verify adjustment/certificate
  equality plus canonical-issuer denial there. That is the recovery rehearsal,
  not a second execution authority.
- NEVER overwrite the canonical database with the pre-certificate dump, clone a
  live grant, or resurrect unused authority after a recipient might have consumed
  a certificate. If the canonical issuer is lost after issuance, stop paid sends,
  retain all recipient liabilities and recover the latest journal/WAL/backups plus
  exact certificate readback before reactivating anything. A stale backup alone
  is insufficient; uncertainty stays encumbered. No automatic destructive restore
  or rollback of historical economic outcomes is authorized.

## Paid-execution boundary

Correction installation issues **zero certificates**. It changes no provider grant
and does not unlock `LIVE_EXECUTION_RELEASE`. Before a paid run, a fixed certificate
must bind the exact isolated recipient database/OID, runtime/source, project pool
and all grant identities with an enforceable aggregate cap, clone denial and
no duplicate issuance. Its amount is added once to `99.605960-releases+issued`,
which cannot exceed100. No transfer/refund/rebalancing APIs or broad coordinator
are required. This recipient admission and normal-capacity full12-trajectory /
72-episode live study remain the existing execution lane's next work.
