# Independent material review — pinned Cloud reconciliation

**Verdict: PASS. No blocking finding in the reviewed integration and verifier fixes.**

Task: `t_481afd69`. This is one risk-proportionate material review, not a full Batch 3 re-audit, product acceptance, deployment approval, or review of later Cloud work.

## Exact source binding

- Accepted parent: `307c184d1fcffa244165bf727631fa5ccbf6f878`.
- In-progress merge pin (`MERGE_HEAD`): `dff9dc068b4227018612f7a99866e7f565130fa0`.
- Binding: `.local/cloud-reconcile/review-source.json`, SHA-256 **`3a94ddf7c589cab24efebe087f56e0ae506ce0517af8b710df8599e17d8de30e`**.
- Reviewed all of `.local/cloud-reconcile/integration.diff`, SHA-256 **`36bd539f879293bdfddda0734f0f13b14bcb42d7078b8753d65da671e87ad0b6`**. Programmatic comparison confirmed it exactly equals the current diff against HEAD for the bound paths.
- Independently hashed all **52** bound paths before and after checks: **zero mismatches**. The manifest exactly covered the tracked integration changes at review time.
- Independently checked the **36** changed web paths against the Cloud pin. All are exact Cloud bytes except `web/src/app/api/domain/[...path]/route.ts` and `web/src/app/conversations/[id]/page.tsx`; both exactly reproduce clean `git merge-file` output using merge base `26e599b3db8a61b73eeeaea4f87a1d3de0b296d9`, the accepted parent, and the pin. No unexplained web edits were found. Later `88bf984` / `4f75f5d` work is outside this verdict.

## Material conclusions

1. **Readiness now exercises the real access contract without weakening it.** `scripts/workagent.py:68-89` reads the canonical session, validates the opaque lowercase 64-hex scope, then requires a successful scoped domain response with authorized workspaces. Each attempt rediscovers scope; malformed/HTML/refused responses cannot report ready. No bearer is placed in verifier request headers. `web/scripts/lib/scope.mjs:9-25` applies the same canonical discovery to direct script requests. Existing proxy host/origin/client checks, per-request session proof, constant-time browser-scope comparison, and backend-scope forwarding remain intact (`web/src/app/api/domain/[...path]/route.ts:43-149,205-208,223-240`).
2. **The isolated launcher remains bounded and owner-safe.** Configurable distinct ports propagate to web/API origins and bind both services to loopback; occupied ports cause refusal rather than owner termination (`scripts/workagent.py:61-65,92-126`). Cleanup targets only recorded child process groups (`:128-140`). Moving to direct uvicorn does not omit validation: API lifespan still calls `settings.validate()` and checks the runtime DB role (`backend/workagent/api.py:57-70`). Fixture mode is explicitly enabled in the controlled general/flexible verifiers (`scripts/verify_general_integration.py:70-74`; `scripts/verify_flexible_integration.py:30-39`), not globally in `environment()` or ordinary runtime defaults.
3. **Notes checks preserve content rather than normalize away failures.** `scripts/notes_controls.mjs:5-26` waits for NotesList, reads/writes arrays of exact strings, and asserts exact equality without splitting or trimming. The requested four verifier migrations use that boundary. The regression asserts delayed loading, multiline/trailing-space values, empty-note save refusal, real save/reload/API equality, and phone width (`scripts/verify_notes_controls.mjs:11-42`). Empty notes are not silently deleted to obtain a pass.
4. **Cloud changes compose with accepted B3 functionality.** The proxy retains original-document and four-format export paths (`web/src/app/api/domain/[...path]/route.ts:158-178,258-349`), and the conversation retains its WorkspaceFiles/ToolActivity integration. The stream-opening deadline is separate from established stream lifetime (`:209-257`); transient snapshot read failures gain bounded retry without changing revocation handling (`web/src/lib/client/work-state.ts:154-164,204-218,259-264`). Notes/row presentation and focus changes do not change save, acceptance, or replay contracts. No backend DTO, migration, budget, or outcome-provenance implementation was introduced by this diff.

## Verification actually performed by this reviewer

- `PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python -m pytest -q -p no:cacheprovider backend/tests/test_launcher_readiness.py` — **19 passed**, exit 0.
- `node node_modules/vitest/vitest.mjs run test/stream-proxy-start.test.ts test/export-download-proxy.test.ts test/cell-authors.test.ts test/work-state.test.ts` — **32 passed**, exit 0.
- `node node_modules/vitest/vitest.mjs run test/proxy-scope.test.ts` — **6 passed**, exit 0.
- `git diff --check HEAD` — exit 0; source hash recheck remained clean.

The `work-state.test.ts` run tests presentation helpers, not a mounted-hook retry scenario; no such stronger coverage is claimed. The retained readiness log says 21 passes; this review's exact-file rerun independently establishes 19, and does not reinterpret the older aggregate.

Read retained evidence under `.local/cloud-reconcile/evidence/`: successful optimized webpack build, 58 focused web tests, 49 DOM regressions (fixture transport), `general-3` actual PostgreSQL/browser controlled-consumer outage and restart readback, and `notes-controls-2`/`notes-controls.json` exact array readback. These are reused parent-run evidence, not represented as independent reruns. No paid usefulness or full-suite claim follows. The original transfer `source-manifest.json` predates changes to `verify_general_integration.py`, `verify_flexible_integration.py`, and `verify_notes_controls.mjs`; it is **not** this verdict's final source binding. The verified `review-source.json` above is controlling.

## Execution limitations and changes

An initial `pnpm exec vitest` attempt refused the shared external `node_modules` symlink; direct invocation of the already-installed Vitest runner completed the narrow checks without installing or replacing dependencies. An unattended Python tool batch was blocked; ordinary read/terminal tools completed the review. No heavy local build, service launch, database operation, paid call, or installed-service change was performed.

Only this review document was created. Product/verifier source was not edited. The pre-existing untracked `contracts/pnpm-lock.yaml` was left untouched. Separate contract investigation remains proposal-only and is not certified as implemented by this PASS.
