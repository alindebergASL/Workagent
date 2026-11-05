# Independent scoped review — migration088 and named-export dispatch

## Verdict

**SCOPED PASS: no material security or correctness defect identified in migration088 or the reviewed regression-test delta.** Original061's other guard predicates remain intact. The schema-preserving upgrade path still rejects both broadened export descriptors; the fresh-grant test does not authorize adopting historical grants.

**Execution acceptance remains pending the parent's fresh post088 restricted-PG run.** At this review's evidence cutoff, `pg-02.log` still records CSV PASS / office PNG FAIL, and `pg-debug.log` attributes that failure to the old fixed-filename guard. The actual migration probe passed, but is not a substitute for completing the broker/converter/download path after migration. No full-product, browser, model-quality, deployment or historical-store upgrade acceptance is claimed.

## Scope and bindings

Reviewed only:
- `backend/migrations/088_named_office_exports.sql`
- `backend/tests/test_named_export_dispatch_pg.py`
- The export-schema assertions added to `backend/tests/test_implementation_releases.py`
- Authorized filename expectation changes in `backend/tests/test_office_pg.py` and `backend/tests/test_office_acceptance.py`

Read the current development/model authority and product context, the prior filename candidate review/repair report, and the actual migration/failure evidence. Previously reviewed gateway, diagnostic, filename and web implementations were not broadly re-reviewed. Branch: `hermes/b2-conversational-client`; HEAD observed: `b9d76aba281c0b6223e68d0af7548df16348aabf`. This is a dirty worktree review, not an assertion that HEAD contains the changes. `REVIEW.json` records exact source/evidence hashes.

## 1. Migration088 preserves the rest of original061

`088_named_office_exports.sql:6–14` obtains the existing function definition, requires exactly one occurrence of the old filename predicate, and replaces only that occurrence. It neither reconstructs a shortened guard nor updates retained exports, capability installations or grants. Missing/duplicated predecessor text fails closed. Ordinary migration repeat is handled by the checksum journal (`workagent/db.py:26–43`); raw SQL repeat intentionally fails the predecessor check.

Independent local verification found `061_office_outputs.sql` byte-identical to HEAD and the reviewed filename candidate. Only061 and088 mention `guard_office_export` in the current migration tree. Reconstructing the substitution in the original function produces only this difference:

```diff
- OR NEW.data->>'filename' IS DISTINCT FROM 'export.'||(NEW.data->>'format')
+ OR NOT coalesce(NEW.data->>'filename' ~
+   ('^[A-Za-z0-9][A-Za-z0-9_-]{0,80}[.]'||(NEW.data->>'format')||'$'),false)
```

The new predicate admits the same safe ASCII stem shape as `ExportFilename`, with the extension bound to the requested office format. NULL filenames fail closed. Unsupported or NULL formats remain rejected by `expected IS NULL`; MIME must still match the format. Traversal, quotes, control characters and overlong stems are not admitted. The retained legacy `export.png` name remains valid.

All other061 clauses remain textually intact (`061_office_outputs.sql:113–145`): office-version routing; supported format/MIME pairing; workspace-local file/snapshot lookup; exact original/extraction/parser provenance; existing office tool attempt; current run/fence/lease/grant/work-version authority; file resources; scope hash; exact revision/input hash/input ID/format; PNG chart specification; principal and conversation binding; dispatch existence and observation absence. The existing trigger and function security mode are not replaced with weaker ones. This is preservation of existing protections, not a new audit of historical guard design.

The parent `migration_probe.py:25–28,56–61` asserts whole live `pg_get_functiondef` equality against exactly this substitution, rollback restoration, and post-journal equality. `MIGRATION088.json` and `migration-01.log` report those assertions passed on `workagent_test_31c7366e15df`; the recorded migration SHA matches the current file. The reviewer inspected the probe and receipts but did not connect to PostgreSQL. A standalone live function dump is not retained in these receipts, so live whole-function equality rests on the inspected executed assertion rather than a separately diffable function snapshot.

## 2. Evidence is specific, not inferred from totals

The migration probe executes the actual trigger on a temporary lookalike table. Its twelve cases include valid generic/named/maximum-length PNG names and invalid traversal, newline, quote, extension, MIME, length, NULL filename, NULL format and unsupported format. A safe named manifest with an absent worker attempt is separately denied. The probe also verifies raw reapplication denial, transactional rollback, and two ordinary `migrate` calls.

These are real trigger predicate tests, but the temporary table is not the complete production export-table constraint/ACL path, and the forged-attempt case does not independently exercise every authority predicate. Preservation of the other predicates is supported by the exact function-delta assertion and source analysis, not by treating twelve cases as exhaustive authorization coverage.

The reviewer independently parsed and compared `PG_BEFORE088.json` and `PG_AFTER088.json`: **73 non-journal tables, 226 rows, identical per-table counts and content hashes**. Both snapshot files have the same SHA256. The probe deliberately excludes `schema_migrations`; a new journal row is expected. This is preservation of this disposable fixture, not proof about unvisited original/paid stores.

`pg-debug.log:7–22` shows office conversion reached `artifact_exports` insertion and PostgreSQL raised `fixed office output manifest required`. The prior office `outcome_unknown` result remains failed evidence. The migration resolves the identified predicate mismatch in source and actual trigger tests; end-to-end post-fix success was not yet in the available PG logs.

## 3. Schema broadening is not smuggled through implementation adoption

`test_implementation_releases.py:25–34` now requires both export descriptors to change output schema and schema hash, retain all other non-implementation fields, and return false from `compatible`. Other capabilities retain their previous implementation-only assertions.

Reviewer execution: **12 selected offline controls passed, 21 deselected**, recorded in `reviewer-offline.log`. This includes the actual old/current catalog comparison and each schema/authority-field incompatibility case. PostgreSQL connection and socket-connect functions were blocked during that run; no DB/provider work was performed.

An additional reviewer offline exercise called the real `_binding` with each historical export descriptor and current descriptor using a minimal cursor double. Both raised `exact compatible enabled predecessor required` after the initial SELECT and before any write. This confirms the Python installer gate, not actual SQL execution.

Current code still requires full descriptor equality except implementation hash in `implementation_releases.compatible` and `_binding` (`:62–65,109–113`). SQL081 retains the corresponding full-descriptor-minus-implementation comparison and exact schema pin checks (`:68–75`); the source-cohort resolver in083 retains that comparison as well (`:73`).088 touches none of these. `policy.install:227–240` uses insert-on-conflict-do-nothing plus installed-descriptor checks, rather than replacing an old installation. A fresh grant is therefore not a mechanism to rewrite a historical schema installation.

## 4. Fresh-grant and filename regression tests

The new dispatch test uses the ordinary restricted-runtime service and `CapabilityBroker`, not a direct adapter success stub. Its shared installer derives exact current version/schema/implementation pins and finite local capacity from the registry. The test reads back the complete installed descriptor and exact persisted grant before dispatch, then checks observed status, implementation identity, named output, stable replay, authenticated downloaded manifest/attempt binding, byte hash, exact CSV bytes or PNG signature plus decimal chart value, one attempt for the repeated call, unchanged grant JSON, and denial of a new call after revocation.

This is correctly scoped to an ordinary current-schema installation in a disposable fixture. It neither invokes the schema-preserving transition installer nor demonstrates historical installation migration. The CSV and PNG parameter cases are meaningful positive controls; the parent still needs to complete both after088.

The office-PG expectation changes `export.png` to the independently known `dataset.png`. The TCP helper now checks Content-Disposition against the returned retained filename, while DOCX/PDF cases independently require the known `PRIVATE-FILENAME-SENTINEL` basename. Exact bytes/hash/MIME, non-embedding of the source filename in binary contents, and unauthenticated denial remain asserted. These are intentional authorized metadata expectations, not removal of an access-isolation requirement. The full TCP office suite was not executed by this reviewer.

## Limits and files written

No product code edits, credentials reads, database connections, provider calls, migration executions, deployment or git changes were made by this reviewer. Created only this report, `REVIEW.json`, and `reviewer-offline.log` in this evidence directory. The attempted generic execution helper was policy-blocked before running; the permitted terminal was then used for offline checks. No additional broad review or full-suite rerun is required by this verdict; the outstanding integration evidence is the parent's already-planned post088 PG run.
