# Independent correction-only closure — PASS

## Verdict

**PASS: R1 and R2 are closed for the exact one-off correction package identified below, from the observed canonical pre-install state.** No remaining blocker to this accounting correction was found. This is not approval for certificate-funded recipient admission, paid execution, migration046→074, deployment, or completion of the live study. Owner permission is already granted; no additional permission gate is introduced.

Workspace HEAD: `d9e5d89bf905ccf0fe5a5bee2bca4bd1cd1ed9b3`. Relevant implementation remains working-tree content; use the file hashes, not HEAD alone. Original `REVIEW.md` and original failed/passing evidence remain unchanged.

## R1 — lock inversion closed

- Installer lines97–99 take advisory721004120 before new correction-schema DDL and frozen release calls, with10-second lock timeout and45-second per-statement timeout. Neither installer nor corrected verifier takes public-table SHARE locks. The subprocess has a120-second outer timeout; an uncertain outcome follows the runbook's readback path, not destructive recovery.
- Release reads immutable public receipt/step rows without row locks and writes only correction tables. Its AccessShare reads are compatible with a sender's RowExclusive table lock. It does not acquire the workspace row lock held by the normal sender. No reverse edge to either sender lock order remains in this correction.
- Retained final proof tests both advisory-first and table-first sender schedules. Independently repeated both schedules against the already-quarantined disposable DB, with actual PostgreSQL transactions, synchronized sender pause, bounded waits and rollback-only completion. Both sender and correction replay completed. No provider request or installed mutation was involved.

## R2 — bounded execution and recovery closed

- Fresh `python3 evaluation/install_accounting_correction.py --check` passed. Canonical identity is exactly `workagent_test_47b87fe3b82e|7704275`; correction schema is absent. Source inventory matches the reviewed restore. Primary grants and all three named recent competing pools match the frozen grant/campaign checks.
- Both SQL entrypoints require canonical name **and** OID. `release_exact` also requires the exact owner-approval hash and now rejects nullable transport/state and nonmatching model/tier. The final disposable proof installs unmodified source first and demonstrates release/issuance denial, then explicitly substitutes only test name/OID. This is logical-restored-copy protection, not a claim that a physical whole-cluster clone with preserved OIDs can be distinguished cryptographically.
- Fresh initial installation executes reviewed DDL and186 frozen release calls in one transaction and issues no certificates. Existing-schema handling does not rerun DDL; it checks the expected rows, amounts, authority, function bodies and runtime schema denial. The current canonical source has no correction schema, and postgres has no default ACL entries that would add unintended grants. The named runtime is neither superuser nor BYPASSRLS.
- Independently read the final disposable catalogs: all three functions are postgres-owned SECURITY INVOKER, fixed `search_path=pg_catalog`, owner-only EXECUTE; both immutable statement triggers are enabled for UPDATE/DELETE/TRUNCATE; no nonsuperuser login role has correction-schema USAGE. These observations corroborate the source and retained runtime-denial proof; they do not replace installed readback after the actual write.
- Runbook separates pre-COMMIT rollback from committed/uncertain-ACK readback. Repeating the exact operation cannot mint a second credit. `--check` alone is not installed readback: after an uncertain ACK use the documented canonical readback/`--apply` recovery branch and inspect any failure.
- Recovery preserves issuance history, stops sends if issuer history is uncertain, retains recipient liabilities and prohibits turning a pre-certificate image or restored grants into new authority. Stale backups are explicitly insufficient after issuance. The post-install dump, quarantined restore and exact journal/clone-denial rehearsal remain execution obligations after installation, not completed evidence in this review.

## Conservation and independent narrow proof

Fresh `closure_probe.py` exited0 at `2026-10-29 23:07:44.474589+00`:

- Source candidate→private-snapshot SHA256 binding matches.
- All186 disposable adjustment rows match frozen dispatch/result/grant/hash/amount/authority fields, **including response IDs independently resolved from the frozen result receipts**.
- Decimal arithmetic:38.48712 reserved =6.9408600 retained usage upper bound +31.5462600 released. Existing allocation becomes68.0597000; globally unallocated ceiling headroom is31.9403000 before any new certificate. These are conservative internal amounts, not bills or executable recipient grants.
- All35 original public tables/8,764 rows match between canonical source, final restored copy and saved restore inventory; both original inventories remain unchanged after the independent lock probes. Disposable certificate journal remains unchanged. Canonical correction schema remains absent.
- Existing reserve-based admission is unchanged and does not consult the release table. The original20USD, carry, unknown outcomes, ancillary allowances, other pools and old unspent capacity remain encumbered. No other allowance was collected. The prior accepted conservation analysis is reused, not relabeled as a new full13-store reconciliation.

No installed DB, implementation, service or board mutation; zero provider calls. Only additive reviewer script/results/report were created. Tests reused the final quarantined disposable and made no durable changes there. The original retained proof's rollback/concurrency/cap/immutability controls were inspected, not broadly rerun.

## Explicit scope limitations, not correction blockers

1. The wrapper's `PINS` covers SQL/helper/verifier/authority/candidates/dump/final proof/reconciliation, **not every supporting file**: the private primary snapshot and restored inventory are loaded without their own entries in `PINS`; the runbook is also not a runtime pin. This review hashes those exact supporting bytes, independently verifies candidate→snapshot linkage and verifies source/restore inventories. PASS applies to this exact reviewed package, not arbitrary later replacements of those inputs. A generalized reusable installer should pin those inputs directly.
2. Recovery readback is appropriate for this transaction's absent→fully-installed states, not a complete catalog-adoption or hostile-owner-tampering detector. It compares `prosrc`, not every function attribute/signature/constraint/trigger, and its row comparison omits response IDs. Current reviewed source plus atomic fresh installation and independent exact disposable/catalog checks establish those properties here. Do not treat the wrapper as approval to adopt an unrelated pre-existing schema or repair arbitrary drift automatically.
3. Whole-table inventory equality is not a writer fence. A legitimate append between snapshots causes failure/investigation, not permission to discard the append or restore stale authority. The release conservation argument does not depend on absence of legitimate old-grant sends: their full historical reserve counters remain charged.
4. Sole-lane allocation and no resurrection of physical/database clones remain trusted operator obligations. No issuer-only test establishes recipient single-consumption, immutable recipient pool/source binding, or live-study readiness.

## Exact reviewed SHA256 identities

| File | SHA256 |
|---|---|
| `evaluation/install_accounting_correction.py` | `2b7ea5207f9e16f9cf97b5aacf3716b96933a3ebdfee9d34a1fdd28538a07f80` |
| `evaluation/accounting_correction.sql` | `d141fe3c1dc863a28a9852314f4d676dd9ba01a143734988d391e1b66d968f6e` |
| `evaluation/verify_accounting_correction.py` | `51bb63809595530aafd0382fd3850bd0ca6dca593c3d3b9ab8b97eb3994e0b98` |
| `evaluation/test_accounting_correction.py` | `03c84a36abd3e3fe48f7146d7acb519141ce0239929e4ebfe11c778d036da12c` |
| `docs/evidence/batch3-b35c/accounting-correction/RUNBOOK.md` | `27592afc1a934003319c10355c5d798580af3a8198cb2a3c89a357d8b75405b5` |
| `docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md` | `73d61b550c50d04caa83077ba0883536b2012ca9eabd430de5f05c2212496965` |
| correction `candidate-01.json` | `91c3c7d9e2542a7a55bbfd75c1675e556318c5957e279078aeac14ca6700ad37` |
| correction `primary-before.dump` | `c72935850cfef1729ea6a0461030435c203c5f6205abfe370549eb187ee9e60e` |
| correction `disposable-verification-02.json` | `68d5933583faeb23beeed125b8461b00423213547372c22a81a9405e8ce6504a` |
| correction `primary-readonly-01.private.json` | `2e4d50b8965374289116431d6e4230d300d3e3d2f3deb64a3b6d35ae2f52673a` |
| correction `restored-before-inventory-02.json` | `49d723e718d5ccfc54a0305f51aabbe6064004bbd843aae2d34bb6564c55e0f9` |
| execution ledger `current-reconciliation.json` | `53306d858e4c04d3eaa64e923a7a72950d44cf681eaab5061025d64d63af4673` |
| reviewer `closure_probe.py` | `576f613f6870405b6dfff95c5533bc04983e58adf5b42f5f64bd15134a37aaef` |

Private correction inputs are under `.local/batch3/b35c/accounting-correction/`; ledger input is under `.local/batch3/b35c/execution/ledger/`. Full machine-readable bindings and results are in adjacent `closure-results.json`. Private payloads and credentials are not copied into review artifacts.
