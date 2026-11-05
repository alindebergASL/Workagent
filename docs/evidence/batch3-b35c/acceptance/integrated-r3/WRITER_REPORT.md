# R3 current-gateway workflow harness

Base: canonical f206eda. Only new source file: `backend/tests/test_current_gateway_client_workflow.py`.
SHA256: `b86248551407b73d9a3702e711441fc9e8ffcd171b1343da2ab5a3f3b6b73534`.
No product, migration, catalog, web, authority or existing test changes. Preexisting `contracts/pnpm-lock.yaml` and parent-owned evidence are untouched. No PG connection/provisioning, provider request, original-store access, commit or publication was performed by this writer.

## Implemented seam

One restricted-PG integration test uses ordinary authenticated HTTP conversation creation, human file creation/edit, and message admission; a synthetic grant binds the actual current_gateway schema and exact current adapter pins. The actual GeneralWorker executes discover, Markdown draft/export, CSV draft/export and reply/final against explicitly scripted MockTransport. Export choices use only actual worker-visible retained draft references. No direct broker substitution, legacy publication schema, forced expiry, lease edit, adapter monkeypatch or fabricated historical receipt.

The worker is a real owned subprocess using the full project venv interpreter. First process exits at the existing after_tool_result hook after a committed draft; second process resumes the genuine private worker state plus exact persisted synthetic server responses. A third completed-run invocation must make zero additional provider calls and leave all step/event/native/cost/discovery and retained-material rows identical. All seven phases must have exactly one count/dispatch/identity/result, and five native observations must be observed. Two exports/blobs only; no proposal. Provider count/create calls each exactly seven.

A fresh HTTP app/Service instance downloads both artifacts and both exports and checks exact filename, MIME, UTF-8 bytes and SHA256. Both original and edited human versions remain readable and the current human version is unchanged. Missing bearer and a separately authenticated principal without workspace membership are denied. Exact grant data and all material/native/history rows remain unchanged after readback/replay. Successful PG execution writes `mechanism-proof.json` beneath the persistent pytest test directory, plus sanitized child logs and private provider/worker state. Credentials travel to the child only on stdin, never argv/logs; synthetic response state is0600. The child uses the restricted runtime role, not its owner DSN.

## Executed checks

- Final offline selection: **3 passed,1 deselected in15.04s**, `offline-final-02.log`. Validates scripted choices with the real current schema, scoped export construction, exact synthetic response identity across restart, and a real child interpreter invocation rejecting absent fixture routing before DB I/O.
- Collection: **4 tests collected**, `collection-final.log`.
- Python compilation and `git diff --check`: PASS.
- Product/migrations/web/contracts tracked diff: empty.
- Earlier offline iterations retained (`offline.log`, `offline-final.log`, collection logs); no failed test hidden.

**Real PG workflow is UNEXECUTED by writer.** No runtime failure has been established and no product repair made. HTTP uses the existing FastAPI TestClient boundary, with new app/Service instances, not a separate TCP API process. Actual worker process restart is included. Synthetic transport uses the established helper's0.1s MockTransport timeout; production lease, visit, HTTP margins and timeouts are unchanged. This is controlled mechanism proof, not paid model usefulness, browser acceptance, or original A/B success. Accepted prior browser/download and R1 provisioning proofs are reused at their original scope; no broad suite requested.

## Parent serial commands (new fixture only)

Run at repository root. The ordinary provisioner requires local `sudo -n -u postgres`; unavailable sudo is failure, not PASS. Never source an original environment. Keep the generated DB and private state; no cleanup. Provisioning uses the unmodified full-chain normal entry point, not split084 bootstrap.

```bash
R3="$PWD/.local/batch3/b35c/integrated-r3-20261101"
PY="$PWD/backend/.venv/bin/python"
test ! -e "$R3/normal-provision/fixture.private.env" && \
 PYTHONPATH=backend "$PY" backend/dev_db.py \
 --env-file "$R3/normal-provision/fixture.private.env" > "$R3/provision.log" 2>&1
```

After provisioning succeeds:

```bash
(
 set -a
 source "$R3/normal-provision/fixture.private.env"
 set +a
 test ! -e "$R3/parent-pg-01" && \
 PYTHONPATH=backend PYTHONDONTWRITEBYTECODE=1 "$PY" -B -m pytest -q -p no:cacheprovider \
 --basetemp="$R3/parent-pg-01" --junitxml="$R3/parent-pg-01.xml" \
 backend/tests/test_current_gateway_client_workflow.py::test_current_gateway_http_admission_worker_restart_and_named_downloads \
 > "$R3/parent-pg-01.log" 2>&1
)
```

Use a NEW basetemp for any separately authorized later run; pytest clears reused basetemp. Do not retry/replay an uncertain failed run blindly. First inspect its saved state and sanitized child log. No other controls or old prefixes need rerunning.

Offline reproduction:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m pytest -q \
 backend/tests/test_current_gateway_client_workflow.py -k 'not http_admission'
```

Original A/B negative/inconclusive disposition and C/D gate remain unchanged. Development-tool costs are outside the product ledger and unreconciled.
