# Batch 2 recovery 2 — document confinement gate complete

Card `t_1ff7a54e`; declared successor **`t_762e2de6`** owns the Claude web/type/build repair. **Batch 2 remains incomplete.** No web implementation, publication, install, default-branch merge, production replacement or product-provider call occurred.

## Exact source and bounded change

Workspace `/home/ubuntu/workagent-continuation-20261026`, branch `hermes/b2-conversational-client`, HEAD unchanged at `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d`. The intentional uncommitted integration is preserved. No other implementation writer was found: active worker/client PIDs matched this card; known old uvicorn PID2688430 remained untouched and was not used as proof.

Only **`backend/tests/test_document_confinement.py`** changed relative to both this card's baseline and the predecessor's final source manifest. **No production parser, sandbox, ingestion, schema, dependency or web source changed.** Evidence and this handoff are additional documentation. No commit was made; full integration publication belongs to the later card.

Evidence: [`evidence/batch2-recovery2/`](evidence/batch2-recovery2/).

- `scoped.diff` and `test_document_confinement.before.py`: complete narrow test delta, including the untracked file absent from ordinary Git diff.
- `scoped-changes.json`: before/after SHA-256; manifest hash `708be21149bb2e43605c7835e51e4886ef94507e8995762894ce42b292c604d7`.
- `baseline-manifest.json` / `test-source-manifest.json`: 1,448 entry candidate files, including intentional untracked files. All test-source hashes rechecked after the full campaign: **zero mismatches**. Predecessor source comparison also found only the one test-file change.
- `database-proof.json`: fresh disposable DB/role identity fingerprints, restricted runtime, all **49 exact migration checksums** verified against current source. No DSNs or credentials included.
- `test-summary.json`: totals and limit observations parsed from XML, not inferred from progress dots.

## Diagnosis and limit semantics

The historical `docs-final-parent` campaign is retained as `historical-red.log/xml`: **64 passed / 1 failed**, exit 1. Its CPU probe failed with `TimeoutError: parser_timeout`; that was valid wall-guard rejection, **not CPU-limit evidence**.

The unchanged original CPU test, run alone first, passed (exit 0, pytest reported **15.06s**) but had almost no margin against its 15-second wall guard. The repaired proof observes the actual confined process's `RLIMIT_CPU == (5,5)` and at least 4.5 CPU seconds, then requires SIGKILL-compatible exit (-9 or 137). It allows **60 wall seconds in this CPU test only**, leaving wall timeout a test failure. There is no acceptance of arbitrary failure codes.

**Production remains CPU soft/hard 5:5 seconds per process and wall 15 seconds per jail**, with the existing memory/FD/process/file/output limits, empty environment, namespaces, read-only mounts and group/namespace termination. RLIMIT_CPU is not a cumulative whole-tree CPU budget. Under contention, five scheduled CPU seconds can exceed fifteen elapsed seconds; the production wall guard must still fail closed in that case.

The separate wall test uses the same real launcher with a **5-second test wall bound**, a sleeping parser and a detached child with closed standard descriptors. A forwarding observer records the real SIGKILL and host `/proc` identities; PID/start-time matching checks that the observed tree no longer executes. This tests constructed child-tree termination rather than claiming coverage of every possible process topology or a strict maximum scheduler latency.

## Actual execution

1. Original isolated CPU probe: **1 passed**, exit 0 (`cpu-baseline`).
2. Instrumented complete confinement suite: **7 passed**, exit 0 (`confinement-first`).
3. Complete final document campaign: **104 passed, 0 failures, 0 errors, 0 skipped**, exit 0; pytest **373.39s** (`final-campaign`).
4. Bounded negative control: explicitly load `cpu_wall_negative.py`, making only the CPU test's wall deadline 0.25s. **1 failed**, exit 1, exactly `TimeoutError: parser_timeout` (`cpu-wall-negative`). Parent parsed and asserted this result: wall termination cannot satisfy the CPU proof. No production/source file was mutated for the control.

Final campaign recorded:

| Proof | Real observation |
|---|---|
| CPU guard | `(5,5)` limit; **4.500427144 CPU seconds observed**; exit **137**; **18.0914154899 wall seconds** under the test-only 60s guard |
| Wall guard | **5.0310974440 wall seconds** with the 5s test guard; **4 processes observed**, **0 live survivors**, including a detached session-leading leaf |
| Actual HTTP process restart | **1 process restart**, **3 exact original formats retained**, command replay/event cursor preserved |

The CPU result exceeding fifteen wall seconds is direct evidence why the original CPU-only assertion could instead encounter the unchanged production wall guard under load.

Commands from workspace root, using existing pinned environments:

```bash
export PYTHONPATH="$PWD/backend"
backend/.venv/bin/python backend/dev_db.py --env-file .local/recovery2/test.env
source .local/recovery2/test.env
backend/.venv/bin/python .local/recovery2/verify_database.py
backend/.venv/bin/python -m pytest -q backend/tests/test_document*.py \
  backend/tests/test_work_events_migration.py backend/tests/test_batch2_process_restart_pg.py \
  -o junit_family=legacy --junitxml=.local/recovery2/final-campaign.xml \
  > .local/recovery2/final-campaign.log 2>&1
```

The document glob includes ingestion contracts, actual parser fixtures, confinement, security-review corrections, document PG/API journeys and target-bound PG. It also reruns the historical additive-migration proof and actual uvicorn restart test. Each PG context seeds a fresh synthetic workspace. HTTP proof uses ephemeral current-source servers, not stale API18963. Optional parsing uses the existing `backend/.venv-docs` distributions mounted selectively into the actual jail: pypdf6.21.2, python-docx1.2.0, openpyxl3.1.5, defusedxml0.7.1, lxml6.1.3; bubblewrap0.9.0 and util-linux prlimit2.39.3.

Only new disposable test databases were provisioned/migrated; no existing user database maintenance or cleanup. No model worker or live provider transport was launched. Controlled synthetic transports are not live model evidence. The sole full-campaign warning is the existing Starlette/AnyIO deprecation. `git diff --check` passes; disk remains about15GB free.

## Review and residual boundaries

Independent **gpt-6-astra via openai-codex** narrow review **PASS**, preserved in `review.md`. It inspected the actual test delta and unchanged launcher plus first confinement execution evidence; the later complete campaign/negative control were parent-executed, not falsely attributed to the reviewer. Source remained unchanged after review.

Unchanged target-filter/XML-preflight security review is reused verbatim in `reused-document-rereview.md`; its original static-only scope remains explicit. The reviewer identified nonblocking test limitations: an exceptional `/proc` observation failure could interrupt the forwarding observer; failed cleanup fixtures lack extra fallback cleanup (their sleeps are bounded); wall assertions prove termination, not strict upper latency. No production enforcement defect was identified. CPU signal/consumption evidence does not forensically exclude every unrelated external SIGKILL. Severe starvation still fails the bounded CPU test rather than being called a pass.

Successor `t_762e2de6` is pre-created, depends on this card and was inspected before completion. It must use Claude for web corrections and current-source contract/build verification. Downstream integrated/browser/PTY/cross-client/A01–A35/P1–P8 gates and publication remain owed, followed by the declared Batch3 chain. This narrow confinement completion is not full-batch acceptance or new spending/access authority.
