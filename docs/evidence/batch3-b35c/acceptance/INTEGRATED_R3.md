# R3 — integrated current-gateway workflow, controlled transport

**The missing integration mechanism is now verified.** This is not a new model evaluation or full product acceptance. R1 remains closed at `f206eda4609dd9223332ceaaeccd10adb134beee`; no runtime, migration, web or contract source changed in R3. The only new executable source is `backend/tests/test_current_gateway_client_workflow.py`.

## Actually executed

Ordinary, unchanged `dev_db.provision` created isolated fixture `workagent_test_a11d706ab2f1` through all88 migrations, without the former split084 workaround. Only new synthetic workspaces in that fixture were used. The restricted-role test verifies the exact migration journal and refuses inherited/mismatched fixture routing before connection.

Final-source parent execution: **4 tests pass, no skips,181.95seconds**. One integrated PostgreSQL/worker/HTTP case plus three focused harness controls; do not add repeated writer/earlier executions to this total. Test hash: `da8e34d74aca7fa9f1a276857abd24073e16c28687a91dac119e78e8472c02bf`. All16 exercised-source/helper hashes matched after execution. One existing Starlette/AnyIO deprecation warning remains.

The integrated path is:

1. Ordinary authenticated HTTP conversation creation, a human-authored working file/correction, and message admission. Synthetic authority uses the actual current-gateway schema and fresh exact descriptor/implementation pins, with no historical grant rewrite.
2. Actual `GeneralWorker.work` in a real child process: capability discovery, Markdown draft/export, CSV draft/export, reply and final explanation. Export references come from worker-visible retained outputs. There is no direct-broker shortcut.
3. Deliberate interruption after a committed draft/tool-result; a distinct worker process resumes from the retained worker/synthetic-provider state. Two further distinct processes verify completed replay before and after a human edit. Four worker process results are retained; no lease edits or forced expiration.
4. Seven synthetic create/count phases, each with exactly one durable count-send/count-result/dispatch/identity/result; five observed native attempts and exactly two exports/blobs. Completed replay preserves provider state, step/event/native/cost/discovery rows and material without duplicate effects.
5. Fresh HTTP app/Service instances download both named files and both exports through ordinary authorized API routes, checking filename, MIME, exact UTF-8 bytes, SHA256 and `nosniff`. Missing bearer returns401; another authenticated principal without membership returns404. Original and corrected human-note versions remain readable and unchanged.
6. Human edits the **generated** Markdown through ordinary HTTP using the current work version and exact base. Exactly one new human revision and the target current-revision pointer change; all other material is preserved. A new completed-run worker returns READY without another model/native effect. Returning client downloads the human-edited current file while explicitly requested old revision and immutable export retain the original bytes.

| Retained output | SHA256 |
|---|---|
| `field-notes.md`, original/export | `379efa204783ea8ff8d6f76f849c30f5b789506d441f84cead6b9d882a3ab8e6` |
| `field-counts.csv` | `eb3ddaba6782a4a28fef09329ef4747235505420214290554f898be63d54f0f2` |
| `field-notes.md`, human-edited current revision | `a6f3cb0d599125fb51bf9fe4d62ae8021a6e1f535ed76d38cd79403554091b3e` |

The first harness variant also passed (3tests169.21seconds), but did not yet contain the generated-file human-edit suffix or fourth harness control. Its log remains historical, not final-source proof.

## Review and evidence reuse

The existing sole reviewer read the complete new test and actual helpers, independently checked528 unchanged runtime/migration/web/generated-contract bindings,16 exercised-source bindings, nine reused-report hashes, four prior real browser download hashes/lengths, four unchanged filename web-delta files and12 unchanged formatting files. **No blocking source finding.** Reviewer source PASS was conditional because its evidence read preceded final test completion; the parent subsequently verified the final4PASS log/XML, mechanism receipt and exact source hashes. This closes that stated execution condition; it is not mislabeled an independently rerun PG test. Review is retained verbatim in `integrated-r3/REVIEW.md`.

Reused—not rerun—evidence:

- R1 ordinary migration/restricted-role exact-export proof and its independent parent verification. No migration review or broad suite was reopened.
- Previous actual desktop1440×957 and phone390×844 filename downloads:1470-byte Markdown and147-byte CSV on each surface. All four retained bytes re-hash correctly; the affected web implementation remains exact. These were saved-material downloads from separate live75, not these new scripted files, and not new model-after-fix proof.
- Original72-slot/29-review negative study disposition and custody review. No regrading, original replay or rewrite of any UNKNOWN outcome.

## Precise limits

Provider decisions/text/usage are explicitly scripted **MockTransport**, not networked model results. HTTP uses FastAPI TestClient (real routes/ASGI, in-process), not a newly launched TCP API or browser. Actual worker processes are restarted; a deliberate post-commit interruption is not arbitrary crash/unknown-send recovery. The established helper's0.1second MockTransport timeout is not evidence about live-provider100/105second margins. Ordinary request admission and the worker entry point are covered; deployed queue polling and an end-to-end newly running browser stack are not newly exercised. Prior client evidence is reused only at its stated source-bound scope.

Human edit persistence and authorized readback pass; **model response to that human edit, actual usefulness, active-human-effort benefit, comparative efficacy and full UX acceptance remain unestablished**. The original result remains29 collected/3 failed-uncollected/40 not runnable, four UNKNOWNs preserved. Full A/B/product acceptance is not granted, and C/D remains dependency-gated.

Fresh accounting and concrete remaining24/72-episode proposals are in [live-validation remainder](LIVE_VALIDATION_REMAINDER.md). The unchanged100USD ceiling has99.0597 encumbered and0.9403 unallocated, billing unknown; neither meaningful proposed envelope fits. This is a genuine paid-validation limitation, not a permission hold on engineering. No paid test, new allocation, source69 adoption into originals, default merge, deployment, broad private access or destructive cleanup occurred. Fixtures and failed/historical evidence are retained.

## Reproduction

Run only on a **new normally provisioned isolated fixture**, never an original study environment. The first command creates it; keep its environment private. Use a nonexistent basetemp, since pytest clears a reused one.

```sh
R3="$PWD/.local/batch3/b35c/integrated-r3-reproduce"
PY="$PWD/backend/.venv/bin/python"
test ! -e "$R3/fixture.private.env" && \
 PYTHONPATH=backend "$PY" backend/dev_db.py --env-file "$R3/fixture.private.env"
(
 set -a; source "$R3/fixture.private.env"; set +a
 test ! -e "$R3/pg" && \
 PYTHONPATH=backend PYTHONDONTWRITEBYTECODE=1 "$PY" -B -m pytest -q -p no:cacheprovider \
 --basetemp="$R3/pg" backend/tests/test_current_gateway_client_workflow.py
)
```

Credential-free reports/logs/receipts and a hash manifest are in `integrated-r3/`; raw fixture environment and synthetic provider/worker state are not published. Development and narrow review use the existing gpt-6-astra/openai-codex sessions; costs outside the product ledger remain unreconciled. Existing Claude web ownership was preserved; no web work or duplicate owner was needed.
