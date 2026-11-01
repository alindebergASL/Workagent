# Reproducing the acceptance integration checks

These commands use no product model/provider. PostgreSQL checks require a newly provisioned, exactly bound disposable fixture; **never use an original study recipient or paid proof**. Use a new persistent pytest basetemp and retain failures. The ordinary provisioner must commit through migration084 before085–088 because084 has a historical transaction-local search path; the integration fixture used a separate084 bootstrap prefix, then ordinary `workagent.db.migrate`.

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend:evaluation backend/.venv/bin/python -B -m pytest -q -p no:cacheprovider \
 backend/tests/test_current_gateway_contract.py backend/tests/test_model_discovery_v2.py \
 backend/tests/test_model_discovery_review.py backend/tests/test_provider_failure_diagnostic.py \
 backend/tests/test_filename_delivery.py backend/tests/test_implementation_releases.py
npm --prefix contracts run check
npm --prefix web run test -- --run test/products.test.ts test/scope-races.test.ts \
 test/export-download-proxy.test.ts test/proxy-scope.test.ts test/client-scope.test.ts
NEXT_PUBLIC_WORKAGENT_API_BASE=/api/domain npm --prefix web run build -- --webpack
```

The implementation-release regression currently consumes retained historical classifier evidence from `.local/batch3/b35c/retained-read-recovery/classification-01/BEFORE.json`; the other selected tests do not need that external custody. Do not manufacture it on a clean clone or silently skip the check. Its relevant current invariant is explicit rejection of output/schema changes by schema-preserving adoption.

ActualPG selected files: `test_named_export_dispatch_pg.py`, `test_filename_delivery_pg.py`, `test_office_pg.py::test_run_office_chart_exact_receipt_replay_and_human_download` and `test_office_acceptance.py::test_tcp_all_binary_outputs_independent_read_restart`. The latter uses real independent office readers. Keep the app interpreter's own packages first and append the pinned office package directory to `sys.path` for readers; prepending that directory supplies an incompatible `typing_extensions` to AnyIO. The converter still receives only its explicit pinned package mount.

Initial failures and diagnostic tracing remain in the adjacent logs. Migration088 was separately exercised in rollback, compared to the complete predecessor function, tested against safe/unsafe/null/format cases and a forged worker binding, then ordinarily committed/idempotently rerun on the newly owned fixture. Prior73 domain tables/226rows matched exactly.

`git diff --check` passes excluding retained raw `.log` files and three previously frozen whitespace-only locations: `backend/tests/test_gateway_target_rejection.py`, `evaluation/test_gateway_target_install.py`, `evaluation/test_selection_resume.py`. Their original bytes were not rewritten to invalidate old source/evidence bindings. Credential-pattern scan found only generated-DSN source templates and explicit `***` test URLs, not credentials; private envs are excluded.

Historical migration/run/evaluator reports remain historical. Current checkout is not source69 and cannot stand in for its preserved runtime. Publication, source integration, fresh disposable dispatch proof, prior saved-material browser proof and original study efficacy are separate claims.
