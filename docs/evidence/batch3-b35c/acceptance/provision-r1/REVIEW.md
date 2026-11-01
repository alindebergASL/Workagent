# R1 ordinary provisioning rework review

**PASS — R1 engineering correction closed at the exact bytes below. No material blocking findings.** This does not establish full product/A/B acceptance, satisfy the whole parent mission, or release C/D.

Base HEAD: `95c674f26bfa5f92c3d3521ec1a4104cc89f6b09`. Reviewed the prior acceptance R1 finding, development authority/model authorization, actual db.py diff, the two new test files and supplied parent evidence. No source edits, commits, tests, PG/provider calls or original environment/database access were performed by this reviewer. Only this report was written.

## Exact source binding

| File | SHA256 |
|---|---|
| backend/workagent/db.py | `a575b245e8a4bff117979efe861d96e65f665ba93f0128426969869f1d17da34` |
| backend/tests/test_migration_namespace.py | `ba448ca0928c8b9e7dcd448c921cb771d877a877e1089741413e20f727804ac5` |
| backend/tests/test_migration_namespace_pg.py | `301f01fbb73290e26bc6651844c960d74c4db5076bcc33882a7b2678d2e25ddb` |

All88 current SQL migration files independently match HEAD byte-for-byte, with no missing or additional SQL files. SHA256 of their sorted compact JSON path-to-SHA256 mapping is `5e5ecc14a36949e06793d20c65f32490b6a7b4656c7e2f4686dda625d2071403`. dev_db.py also matches HEAD exactly. Source hashes match HASHES.json.

## Safety and correctness

At db.py:31 and47, `SET LOCAL search_path = public, pg_temp` gives unqualified migration DDL an explicit public creation target. Omitting pg_catalog from the explicit path preserves its implicit precedence for lookup; explicitly positioning pg_temp after public avoids implicit temporary-relation precedence. The setting is transaction-local and resets before every pending file, so084's local path cannot redirect086's subsequent unqualified CREATE FUNCTION into pg_catalog.

At db.py:33,35,40,49, every journal creation/read/write is explicitly public.schema_migrations, including the receipt written immediately after a file changes its path. The same transaction and advisory transaction lock remain at28/32; exact-prefix validation remains at35–37 and per-file SHA256 drift rejection at39–43. No per-file commit, privilege change, historical migration rewrite, journal rewrite or runtime-role bypass was added. A failing later migration rolls back all pending DDL and receipts together.

The PG fixture calls the real unchanged dev_db.provision entry point for a new generated store with all88 migrations, without prefix/bootstrap monkeypatching. Only subsequent failure tests copy SQL into disposable test directories. They exercise a file-local shadow journal and schema, verify the next file targets public and the real receipt journal, then deliberately fail and compare all retained rows/functions/schemas/journal timestamps. Checksum and non-prefix cases fail closed independently. This tests the actual R1 integration boundary rather than split084 provisioning.

## Actual supplied closure evidence

- parent-pg-01.log: **4 real-PG PASS in3.42s**. SHA256 `453aa3c08a5b0a5f5985281c93ca147087548bbbb8e446b186caf5b5d62c88b4`.
- PROVISIONED.json identifies retained newly generated workagent_test_9f8b8af108d4 and normal_full_chain=true. Its SHA256 is `57b8465bd019a7e6188417bdb252a68f518a1e96040f00e2b9db6bcfbc267553`. No private environment file was read.
- FULL_CHAIN_REPEAT.json, PENDING_ROLLBACK.json, DENIED_checksum.json and DENIED_prefix.json each contain equal before/after snapshots:88 exact HEAD journal entries with one transaction-start timestamp,74 user tables and237 functions. Each file SHA256 is `f1b8467c30978e762c1f74b0e12230ea2745f4b69dda6bb35d039e4f7e54ca65`. Their identical hashes reflect the same unchanged snapshots, not different claimed outcomes; the executed assertions/log distinguish the four cases. The successful full-chain case also checks086's function resides in public, not pg_catalog, and restricted runtime receipt/reservation ACLs.
- The parent's formerly running named-export run completed during review: **2 PASS in18.69s**, parent-named-01.log SHA256 `ffc673924c78d15cd10ffa806f2939a1d7a71b667f7398f0cfbafcc87c78870d`. The existing basic CSV and office PNG cases exercise exact current descriptor installation/grant pins, actual broker dispatch, named downloads/hash checks, duplicate replay with one native attempt, unchanged grant data and post-revocation denial. Parent reports this run used the newly normally provisioned fixture; private routing was not independently opened. This is restricted native dispatch proof, not a paid model trial.
- Offline evidence: writer3 PASS in3.09s and parent3 PASS in3.86s. The count is two new sequencing/rollback tests plus one unchanged dev_db environment control, not three new tests. Parent log SHA256 `edecf0737c3f7d16366266e5bc5d8a3c1be846ce658f1748a82fa1538b3188c6`.

No broader predecessor review or study evaluation was repeated. The prior provisioning failure and unrelated evidence remain historical. Source/catalog identity regeneration and any subsequent publication remain parent-owned engineering work; this report binds the reviewed working-tree bytes, not an already published release. Original cohort conclusions, full acceptance limits and C/D gating remain unchanged. No new spending authority is implied; development-tool costs remain separately unreconciled.
