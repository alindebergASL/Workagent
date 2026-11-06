# Recovery5d — A14 correction for independent review R1/R2/R3 (Claude web owner)

Base: candidate1 (manifest SHA `43ed5905…1242`, 609 files). Only `web/` changed, plus three new evidence files: `correction-red.txt`, `correction-green.txt` and this handoff. Candidate1 evidence and the earlier handoff/red/green files are unchanged. No backend/contracts changes, installs, services, browser, build, git or provider calls. Product calls: 0.

**Verdict: R1/R2/R3 are fixed and tested at unit/route level. A14 is NOT complete; the browser gate and the narrow re-review remain with the parent.**

## Fixes

**R1 — sent-then-fenced is an unknown outcome, not "nothing sent"**
- `session-scope.ts` now separates two refusals:
  - `ScopeRefused` (`unauthenticated`): used only before dispatch, or when the proxy marks identity unconfirmed and forwarded nothing.
  - `fencedOutcome()` (`code: "transport"`, `isAmbiguousWrite`): used after dispatch.
- Where each applies:
  - `scopedFetch`: fenced after the response → `fencedOutcome`. A network error after the fence → `fencedOutcome`.
  - Generated client `onResponse`: scope mismatch → `fencedOutcome`.
- `uploadAll` (`documents.ts`): a `ScopeRefused` keeps the exact upload identity, since an earlier attempt may have been sent. Other definite refusals still clear it as before. Post-dispatch fences follow the existing unknown path: `state: "unknown"`, identity kept under the captured original IDB scope. No automatic retry.

**R2 — the initiating scope is carried through bodies, digests and side effects**
- `captureScope()` / `assertScope(captured)` throw `fencedOutcome` if the page is no longer bound to that scope. They are checked at these points:
  - batch2 `call`: after the body is parsed, success or error.
  - `documentApi.original`: after `arrayBuffer` and after the digest.
  - New `saveOriginal()`: right before `createObjectURL`/anchor. `DocumentRow` now uses it.
  - `productApi.download`: after the response, after `arrayBuffer`, after the digest and before `createObjectURL`.
  - Generated `unwrap`: after the body-parsed result.
  - work-state `readJson`: after the JSON body.
- `work-stream`: the scope is captured when the subscription starts. `apply` (before `onChange`) and `reset` (before and after `onReset`) check it synchronously and throw `Revoked` once fenced. They no longer rely only on React cleanup.
- Ordinary application 5xx are not treated as auth loss.

**R3 — explicit proxy identity-failure fence**
- The proxy adds `X-Workagent-Identity: unconfirmed` when identity can't be confirmed: session preflight failed, threw, timed out or was malformed (503); backend 401/403 (401); or the page's scope was absent or stale (401). Nothing is forwarded upstream in any of these cases.
- An ordinary upstream 503 carries no marker.
- Both transports (`scopedFetch` and generated `onResponse`) fence the page terminally on that marker and throw `ScopeRefused`. Pending identities and stored bytes/drafts are kept, hidden, and not retried automatically.

## Tests: `web/test/scope-races.test.ts` (11)

- **R1:**
  - A late committed batch2 upload, released after `fenceScope()` and `ctl.open(null)`, rejects with an ambiguous error.
  - After A rebinds, the restored entry is `state: "unknown"` with the exact `command_id`/`request_id` and identical sha256.
  - The retry sends a byte-identical body.
  - A generated-client write fenced after dispatch rejects with `transport`.
- **R2:** each of these is suppressed after the fence, with zero `createObjectURL` calls and zero anchor clicks where a download is involved:
  - delayed batch2 JSON body
  - delayed original binary body
  - delayed original digest
  - `saveOriginal` with a late body
  - generated product download with a late body, and separately with a late digest
  - a frame arriving on an already-open stream after the fence (not applied, no reset)
- **R3:**
  - The actual proxy marks failed and malformed preflights for both GET and POST, with zero domain forwards; an ordinary upstream 503 stays unmarked.
  - `scopedFetch` with a plain 503 stays ready; with the marker it fences, and the scoped draft becomes hidden but retained.
  - Generated `send` with the marker fences, throws `ScopeRefused`, and calls the transport once.
  - A pending upload refused by preflight keeps its exact `command_id` and bytes in the store, with no retry.

Evidence:
- **`correction-red.txt`**: the new tests run against the pre-fix candidate1 product source, captured before any product edits. All 10 tests that existed then failed.
  - **Caveat:** in that run, the generated-client cases (R1 generated write, R2 product download) were not exercising the generated client correctly. It was building a relative-URL `Request`, which Node rejects. The product-download case was not yet in the run.
  - After the red capture, the test harness was corrected to mirror `products.test.ts`'s mocked absolute base URL and fresh module load. Those generated-client rows therefore lack a valid pre-fix red receipt. Their pre-fix behavior is established by the reviewer's reproduction and by code inspection, not by my red run.
  - The red run was captured before the final test-fixture fixes (receipt shape, sessionStorage stub).
- **`correction-green.txt`**: full web vitest after the fix, **52 files / 510 passed**. These are the earlier 499 plus 11 new, with no existing test modified in this correction.
- Run serially and clean: `tsc --noEmit`, `eslint . --max-warnings 0`, `prettier --check .`.

## Changed files (this correction)

- `web/src/lib/client/session-scope.ts`
- `web/src/lib/client/real-api.ts`
- `web/src/lib/client/batch2-api.ts`
- `web/src/lib/client/products.ts`
- `web/src/lib/client/documents.ts`
- `web/src/lib/client/work-stream.ts`
- `web/src/lib/client/work-state.ts`
- `web/src/components/Batch2Controls.tsx` (DocumentRow now calls `saveOriginal`)
- `web/src/app/api/domain/[...path]/route.ts`
- `web/test/scope-races.test.ts` (new)

## Caveats

- Behavior changes to flag for the parent's narrow rerun:
  - Late GET reads fenced after dispatch now surface as `transport` instead of `unauthenticated`.
  - The proxy's stale/absent-scope 401s now carry the identity marker, so the client throws `ScopeRefused` instead of returning a 401 Response. The existing proxy tests still pass.
- In-flight reads are not actively aborted on fence. Every publish/side-effect point is guarded afterwards instead.
- `useStagedDocuments` writes for a definitely unsent fresh attempt keep the identity with `state: "local"`. Replaying a never-sent command is harmless.
- Not run: production build, browser/E2E, backend tests. No claim of A14 browser completion.
