# Batch 2 publication and private development runtime

## Candidate

Product source commit: `1c36002cd2481ef2f3195ae4c52ba4dd05e0608c`, branch `hermes/b2-conversational-client`, feature base `hermes/conversational-continuity` (`c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d`). The subsequent evidence-only commit publishes this directory; its exact remote head and CI are recorded in the PR and final task handoff, not guessed here.

`acceptance/ACCEPTANCE.md` preserves the predecessor's **43/43 literal A01–A35/P1–P8 acceptance**, including all qualifications. The predecessor validator was actually rerun successfully before publication:630 source hashes,731 deduplicated evidence bindings,7 rejected negative controls. Final `final-source-manifest.json` binds all630 staged product files, including117 previously untracked accepted files. Existing Step2/Step3 and later material reviews were reused. Independent publication-risk review passed; no second broad product review was commissioned.

Only four formatting-only changes follow acceptance: Claude Code formatted `web/src/lib/attachment-context.ts` and its test; Hermes removed one redundant EOF blank line from each of two backend attachment tests. Production TypeScript emitted identical JavaScript; the Python ASTs were identical. Test JavaScript emission was not byte-identical (formatting remains), and is not claimed otherwise.525 web tests passed after correction. Original source hashes, formatting failures and corrections remain separate records. No product behavior was edited by this card.

## Executed checks

- Predecessor read-only validator: exit0;43 PASS,630 original source files,731 evidence bindings,7 negative controls.
- Exact current optimized real-proxy build: exit0, `next build --webpack`, build ID in `final-browser-report.json`.
- TypeScript typecheck and ESLint: exit0. Initial formatting check failed on the two files above; Claude's bounded correction and final full formatting check passed.
- Vitest:55 files,525 tests PASS (`web-final-check.log`).
- Real restricted-PostgreSQL HTTP lost-ack/replay and actual API-process restart:2 PASS (`real-stack-tests.log`), including original PDF/DOCX/XLSX parsing/download retention.
- Fresh real browser→Next proxy→API→PostgreSQL journey: Home lists fresh work; actual human edit persists as a new revision, survives reload and a real Next process/build restart. Desktop1440, phone390 and narrow320 passed without page overflow or JS errors. Native HTTP client read back the exact browser-saved revision/body hash. Actual Textual PTY120×40 and80×24 showed canonical messages; initial still-restoring capture is retained separately.
- Source/index hash verification:630/630; product staged diff whitespace check passed after disclosed EOF fixes.
- Publication text security scan:20 matches classified as synthetic test constants/template URLs/copied synthetic failures/scanner controls; no provider/private keys or restricted-customer matches in the changed candidate.102-member accepted archive scan had no pattern matches. Static scan is not image OCR or a repository-history audit.

The inherited two budget-test failures and earlier failed campaigns remain historical; this is **not a whole-backend-suite-green claim**. New seed-harness mistakes (canonical defaults, migration column, repeated fixture insert) and missing web-scope test header are retained as negative evidence; they were corrected without weakening product assertions. No historical failed log was rewritten.

## Actually running, not production

- Web: `http://127.0.0.1:3197/?workspace=batch2-publication-smoke-final`
- API: `http://127.0.0.1:18967` (private bearer required).
- API PID2718652; final Next PID2733711. Exact process cwd/start identities and build/source bindings are in `runtime.json`.
- Fresh disposable database: `workagent_test_c24f03221a59`, restricted runtime role, migrations through052. Failed harness setup left a separate synthetic workspace in this new DB; nothing was deleted.
- No dispatcher/model worker runs for this stack. The smoke uses an explicitly controlled synthetic transport fixture, not a newly generated live-model result; no product-provider requests or spending were added.
- Loopback-only. Not publicly accessible, not installed production, no default-branch merge, no reverse-proxy or account/access expansion. An operator with access to this host may use an SSH tunnel to3197; no public reachability is claimed.
- Prior stale API PID2688430/port18963 remains untouched and is **not** current proof. The old owned Next3195 process was positively identified and stopped before rebuilding shared `.next` output; old API18965 remains untouched.
- New API and Next processes are intentionally persistent development services. TUI smoke sessions detached normally; they did not cancel work.

## Reproduction and limits

Use the locked backend requirements plus optional `requirements-tui.lock` for Textual. Document sandbox requires Linux bubblewrap/prlimit/user namespaces and `backend/.venv-docs` with the locked parser requirements, compatible with `/usr/bin/python3`. The actual parser environment and sandbox succeeded in the2 real-stack tests above. Do not assume ordinary backend dependencies provide document extraction.

Provision a **new** disposable DB using `backend/.venv/bin/python backend/dev_db.py --env-file <private-new-path>`, source that private file without printing it, then run:

```sh
PYTHONPATH=backend backend/.venv/bin/python -m pytest \
  backend/tests/test_batch2_process_restart_pg.py \
  backend/tests/test_tui_real_stack_pg.py -q --tb=short
(cd web && npm run typecheck && npm run lint && npm run format:check && npm test)
(cd web && NEXT_PUBLIC_WORKAGENT_API_BASE=/api/domain node_modules/.bin/next build --webpack)
```

Historical generated proof files are immutable: run fixture/browser scripts into a new evidence location rather than overwriting their recorded outputs. Scripts and exact captured receipts remain available for inspection. Shared dependency symlinks were not mutated; no auto-install or cleanup occurred. Disk headroom was8.6GB at this checkpoint. Existing frontend CI tests the mock browser suite; it is not a substitute for the real PostgreSQL/client proof above.

## Authority, accounting and next owner

Retained cumulative allocation99.60596USD of100USD;0.39404USD globally unallocated is distinct from0.52700USD remaining inside the existing expired campaign pool. Billing remains unknown; historical liabilities were not refunded. No additional product calls, grants or allocations. Engineering/review used Astra/openai-codex; bounded Claude Opus5.5 formatting lane reported0.3522604USD list-price usage, separate from product accounting and not a billing claim.

Final audit remains on existing `t_99aaa2a0`; Batch3 follows the established dependency chain from the verified published head, never from the old base or a partial copy. This card publishes/verifies Batch2 only; the wider mission is not complete. Default merge, production replacement, new external business effects/access, installed-data maintenance, bulk UID migrations, VACUUM and destructive cleanup remain gated.
