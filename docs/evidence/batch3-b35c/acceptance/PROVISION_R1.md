# R1 — ordinary fresh migration path

Base: `95c674f26bfa5f92c3d3521ec1a4104cc89f6b09`, existing feature PR18. This is a narrow correction to the acceptance review, not a new study or product-acceptance claim.

## Failure and change

The reviewer ran ordinary `dev_db.provision` on a new disposable database and reproduced `InsufficientPrivilege: permission denied for schema pg_catalog` at086. Migration084 sets a transaction-local catalog-first search path; the runner previously let that setting leak to later files, so086's unqualified function creation targeted pg_catalog. The failed fixture and review remain retained. The earlier split084-prefix bootstrap was a fixture workaround, not proof that ordinary provisioning worked.

`backend/workagent/db.py` now sets `search_path = public, pg_temp` at entry and before every pending migration. PostgreSQL implicitly searches pg_catalog first while public remains the DDL creation target; explicit pg_temp prevents implicit temp-first lookup. All migration-journal references explicitly target `public.schema_migrations`, including inserts after a file changes its path. The whole pending chain and its receipts still use one transaction and the original advisory lock. Exact-prefix validation, checksums and applied timestamps are unchanged. All88 historical migration files, dev_db.py, grants and runtime role provisioning remain byte-identical to the base. No per-file commit, historical checksum rewrite or privilege relaxation.

## Actually executed

Parent-run, normal public entry point, generated fixture `workagent_test_9f8b8af108d4`:

- **4 PostgreSQL cases pass**: clean full-chain normal provisioning through088; two no-op repeats preserving all74 tables/93 rows (including journal),237 functions and exact receipt timestamps; pending SQL and receipt rollback across two test-only migrations that change namespaces/create a shadow journal/raise; checksum and non-prefix input rejection without persistent effects. The clean-chain receipt timestamps all match one transaction start. Runtime role is neither owner nor superuser nor BYPASSRLS; the discovery receipt and guarded reservation ACL assertions pass.
- **2 exact-pin export cases pass** on that same normally provisioned fixture: native CSV and confined PNG; named download bytes and hashes, actual descriptor/implementation pins, one retained attempt on replay, unchanged grant contents and fresh-call revocation denial. These are real restricted-PG/converter mechanisms, not model generation.
- **3 fast controls pass** (two new runner regressions and existing dev_db environment check); canonical contract/OpenAPI/TypeScript check passes. Existing Starlette/AnyIO deprecation warning remains.
- All88 migration hashes and the preexisting untracked contracts lock match the baseline. `git diff --check` passes.

Logs and snapshot evidence live in `.local/batch3/b35c/provision-r1-20261101/`. The additive archive includes only explicitly selected source, reports, logs and credential-free snapshots. Private0600 environment files and raw coding-agent logs are excluded. Prior source manifests and archives remain historical, not overwritten to pretend the new tree was previously reviewed. Narrow reviewer verdict and exact publication/CI identities are recorded separately in the task/PR handoff.

## Reproduce without original-store access

Use a new path below, not an existing pytest basetemp (pytest clears reused basetemps). The first suite calls unchanged `dev_db.provision` directly, needs local PostgreSQL/sudo, and does not consume an inherited original DSN. No split-prefix bootstrap or migration monkeypatch is used for clean provisioning. Copied migration inputs are used only by the explicit failure controls. Databases/roles are retained, not cleaned up.

```sh
R1="$PWD/.local/batch3/b35c/provision-r1-20261101"
PY="$PWD/backend/.venv/bin/python"
test ! -e "$R1/reproduce-pg" && \
 PYTHONPATH=backend PYTHONDONTWRITEBYTECODE=1 "$PY" -B -m pytest -q -p no:cacheprovider \
 --basetemp="$R1/reproduce-pg" backend/tests/test_migration_namespace_pg.py
# Only after the first command succeeds; do not substitute an original env:
(
 source "$R1/reproduce-pg/normal-provision/fixture.private.env"
 test ! -e "$R1/reproduce-named" && \
 PYTHONPATH=backend PYTHONDONTWRITEBYTECODE=1 "$PY" -B -m pytest -q -p no:cacheprovider \
 --basetemp="$R1/reproduce-named" backend/tests/test_named_export_dispatch_pg.py
)
```

## Boundaries

Zero paid calls, original recipient/store mutations, installed maintenance, historical grant changes, new tasks, web edits, default merge or deployment. Original A/B stays negative/inconclusive:29 collected/3 failed-uncollected/40 not runnable,4 UNKNOWNs preserved; no measured human-effort or causal arm benefit. Full A/B/product acceptance remains open and existing C/D task remains dependency-gated. Saved-material browser evidence is reused, not fresh model-after-fix evidence. No new paid trial is assumed affordable from the historical0.9403USD unallocated balance; no budget/usage refund is inferred.

Development/review: existing gpt-6-astra/openai-codex writer/reviewer; development-tool costs are outside the product ledger and unreconciled. Sole Claude web ownership is unchanged; no web work was needed.
