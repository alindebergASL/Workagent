# B3.0b R3/R4 continuation — historical technical capacity HOLD

**Resolved:** see [ACCEPTANCE.md](ACCEPTANCE.md) for completed R3/R4 correction, exact-source build/browser/review acceptance. The snapshot below is retained history; latest owner-selected Claude model is `claude-opus-5-5[1m]`, superseding historical Fable pins.

2026-10-28. Task `t_04c80dd1`, existing branch/workspaces and graph unchanged. **Not complete, not integrated, not committed.** `t_ae17ebd1` stays dependency-gated.

## Actual blocker, not an authorization gate

The assistant-selected lifetime correction-count restriction was wrong; `authority-correction-20261028.md` supersedes that claim. Standing development authority permits further focused correction under unchanged per-invocation/resource/budget limits.

Two sequential Claude Fable5 invocations have both exited. The first hit its unchanged30-turn cap after13 tool permission denials. Parent corrected only per-process add-dir/Read/Edit/Write/node/npm permissions before a fresh focused continuation; no duplicate writer or global change. That continuation had no permission denials, wrote the partial implementation/test, then exited1 with: **“You've hit your session limit · resets 5:30pm (UTC)”**. Observed2026-10-28; retry not before17:30UTC and verify capacity then. No model/account switch, cap increase or blind relaunch. CLI subtype `success` is NOT completion: actual exit1 and quota message control. Two CLI list-price estimates sum to12.380083USD; actual subscription billing unmeasured, outside product ledger. Zero product-provider calls.

## Exact state

- Main retains all63 prior source-manifest hashes unchanged; previous13 integrated web paths remain the pre-R3/R4 candidate. Previous build/browser/native/backend proofs retain their historical scope; do not claim they prove this partial lane patch.
- Isolated `.local/batch3/b30b/web-owner` has exactly3 changed source/test files relative to the continuation baseline: `web/src/components/WorkspaceFiles.tsx`, `web/src/lib/file-draft.ts`, `web/test/workspace-files-races.test.ts`.
- `r34-candidate-source.json` and `r34-candidate-diff.patch` bind the isolated partial patch. No wholesale lane copying; integrate only the finished allowlist.
- Main source, backend, contracts and original runtimes were not changed. Fresh synthetic fixture `r34-ui-fixture.json` lives in existing verified disposable DB. Owned API18772 was started for planned browser proof, then stopped; Next3199 was never restarted. No installed-data maintenance or cleanup.

## Verification and concrete remaining work

1. **Original reproduction RED:** actual transpiled component handlers + real pending hook/file-draft module against unpatched main:4fail, including the two R3 sequences, original R4 lateA-after-B sequence, and old-mount hash-before-send. `r34-red.log/json`.
2. **Partial lane tests:**39pass/1fail across5 files (40tests). Failure is a new test scheduler bug: sequential input events are fired without flushing a React render, so the textarea handler stores an empty filename. Add `await w.settle()` between filename/content input events in the test, not a production workaround. `r34-green.log/json` is retained RED, not green acceptance.
3. **Parent corrected scheduler probe:** separate parent-owned `.local/batch3/b30b/r34_parent_handlers.cjs` changes only the test scheduler between discrete events, not web source. Actual lane handlers/hook now pass original4cases. One additional real ordering **fails**: send A, unmount, mount/replayA, deliver originalA success BEFORE live replayA success. Old dead handler runs `pending.clear(body)` before its `alive` check, removes the journal; live replay then sees persisted=true/stored=null and cannot clear its in-memory A. Live creator remains permanently “Retry the same create” although both replies succeeded and durable journal is absent. `r34-parent-handler-result.json/log` records4pass/1fail. Fix by fencing dead-mount completions before persistent mutation (and verify equivalent editor order); preserve exact envelope and matching draft ownership. Add this ordering to Claude's regression, not just original lateA-after-B.
4. **Typecheck:** exit2, all reported errors in the new regression test (unchecked indexed accesses, including real[spec], effects[i], editCalls/createCalls indexes). Fix strict typing with checked access/assertions justified by fixture expectations. `r34-static.log/json`. Lint was short-circuited and **not run**.
5. No optimized rebuild, real browser race proof or final independent rereview yet: intentionally defer expensive final-source checks until actual partial blockers are corrected. No reviewer was launched this run; prepared `r34-review-task.md` is NOT a review receipt.

## Bounded continuation recipe

Use the same task and existing web-owner. Verify prior agents exited and source hashes first. One focused Claude invocation, unchanged30turn/20min cap, same claude-fable-5/account; use authorized per-invocation `--add-dir /home/ubuntu/workagent-continuation-20261026 --allowedTools Read Edit Write 'Bash(node *)' 'Bash(npm *)'` so reads/checks are possible. Do not repeat package-discovery or broad inventory.

Fix the concrete completion-order residual, discrete-event scheduler and strict test types. Add direct hook/component regression for oldA-first vs replayA-first; ensure B durable identity survives original sequence and actual remount replay. Re-run focused tests/typecheck/lint and retained RED comparison. Parent harness remains outside web as an independent check. Integrate only allowlisted finished files.

Then one optimized build in isolated lane (`node node_modules/next/dist/bin/next build --webpack`), one heavy job at a time and disk check. Main `.next` stays untouched. Parent prepared `r34_run.py` writes argv/source-before/after/exit receipts. `r34_browser.cjs` uses actual loopback API and production app, intercepting fetch only AFTER a real successful response to lose/delay its ACK; tests1440/390/320, exact envelopes, JS-realm-preserving Next Link remount, B draft/journal preservation, reload, separate composer, focused/unobscured phone controls. It has **not run** and may need bounded harness selector adjustments; do not claim it passes. Add oldA-before-liveA recovery sequence as needed. Fixture and service env use `verified.private.env` privately; never print/commit secrets. API identity before stop is `r34-api-identity.json`.

Use ONE narrow independent correction review after the patch/tests are ready; reuse unaffected R1/R2/backend/native/export proofs with explicit source-impact binding. Final docs/source/build/browser/review manifest, sanitized allowlisted commit, then complete only this slice to release existing successor. Preserve all historical HOLD/RED/timeouts and both agent execution receipts. No broader campaign rerun, new graph, paid product calls, default merge, public exposure or runtime promotion.
