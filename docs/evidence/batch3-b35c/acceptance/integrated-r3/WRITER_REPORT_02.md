# R3 stronger post-generation human edit / return proof

Only test source changed: `backend/tests/test_current_gateway_client_workflow.py`.
Final SHA256: `da8e34d74aca7fa9f1a276857abd24073e16c28687a91dac119e78e8472c02bf`.
Preimage retained as `test-before-generated-human-edit.py`, SHA256 `b86248551407b73d9a3702e711441fc9e8ffcd171b1343da2ab5a3f3b6b73534`. Prior report, logs and parent PG evidence are unchanged. Explicit hashes of exercised backend sources, provisioner and reused test helpers are in `SOURCE_HASHES_02.json`; this is not a new product release identity.

Parent's first actual PG proof passed3 tests in169.21s (`parent-pg-01.log/xml`), including the conversation/current-gateway/worker-process/download seam. That run predates this extension and the last offline subprocess test; it does not establish the new assertions.

## Narrow extension

After the existing completion, downloads, original human-note preservation, authorization negatives and unchanged-row checks, the test now:

- Opens a fresh HTTP client/Service, reads current conversation work_version, and edits the GENERATED Markdown through ordinary `edit_workspace_file` with its exact retained base version/hash.
- Verifies exactly one human-authored revision was appended, the generated artifact changed only its current_revision_id, and every other old material row (including both exports/blobs and the separately authored human note) remains unchanged.
- Invokes a fourth real owned worker subprocess for completed replay using genuine saved state. It must remain READY with identical synthetic provider state and identical request/count/result/native/cost/discovery rows.
- Returns through another fresh HTTP client/Service: current download must be the exact human-edited bytes/hash; explicit original revision and historical export must retain exact pre-edit bytes/hash. Filename/MIME remain exact. All retained material rows must equal the post-human-edit snapshot after replay/readback; no new export or native effect is permitted.
- Adds the new worker PID, generated human revision/hash and immutable export identity/hash to `mechanism-proof.json`, written only after all assertions succeed.

Existing proof assertions and sanitized child-output handling remain intact. No product, SQL, web, caps, grant history, provisioner, authority or original data changes. Preexisting untracked pnpm lock and parent-owned evidence remain untouched. No PG/provider calls by writer.

## Executed

Final-source offline command:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m pytest -q \
 backend/tests/test_current_gateway_client_workflow.py -k 'not http_admission'
```

**3 passed,1 deselected in10.99s**, `offline-02-final.log`. Earlier same-turn offline result retained in `offline-02.log`. Python compilation and `git diff --check` pass; tracked product/migration/provisioner/web/contracts diff remains empty. The added PG-only suffix is **pending parent execution**, not inferred PASS from offline controls.

## Parent fresh-fixture command

Use a NEW ordinary provisioned DB and NEW persistent basetemp. Do not reuse/clear the successful first proof. From repository root:

```bash
R3="$PWD/.local/batch3/b35c/integrated-r3-20261101"
PY="$PWD/backend/.venv/bin/python"
test ! -e "$R3/normal-provision-02/fixture.private.env" && \
 PYTHONPATH=backend "$PY" backend/dev_db.py \
 --env-file "$R3/normal-provision-02/fixture.private.env" > "$R3/provision-02.log" 2>&1
```

Only after provisioning succeeds:

```bash
(
 set -a
 source "$R3/normal-provision-02/fixture.private.env"
 set +a
 test ! -e "$R3/parent-pg-02" && \
 PYTHONPATH=backend PYTHONDONTWRITEBYTECODE=1 "$PY" -B -m pytest -q -p no:cacheprovider \
 --basetemp="$R3/parent-pg-02" --junitxml="$R3/parent-pg-02.xml" \
 backend/tests/test_current_gateway_client_workflow.py \
 > "$R3/parent-pg-02.log" 2>&1
)
```

This file contains exactly one integrated PG test plus the three cheap offline controls. No broad gates or R1 retests. Preserve the fixture, private worker state and logs. No browser rerun requested. Mechanism evidence remains distinct from model usefulness/original A/B acceptance; prior negative/inconclusive result and C/D gate are unchanged. Development-tool costs remain outside the product ledger and unreconciled.
