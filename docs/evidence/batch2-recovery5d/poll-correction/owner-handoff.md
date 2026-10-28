# A14-R2-POLL correction — web owner handoff (Claude Opus 5.5)

Scope: only the polling fallback in `web/src/lib/client/work-stream.ts` (`poll()`). No backend/contracts, config/deps or other product-path changes. No commits, services, browser, DB, provider calls or installs. Product calls: 0. All prior evidence is retained; no file outside this directory was overwritten except the one production file and the new test.

**Verdict: R2-POLL fixed and covered by focused actual-module regressions. A14 is not closed; the parent owns the full serial gates and the independent disposition.**

## Changed files

- `web/src/lib/client/work-stream.ts`: production. Before `533b1045…c1fbc708` (matches `.local/recovery5d-poll-before`); after `21bc7396…dea23faa`. The full diff is in `work-stream.diff`.
- `web/test/poll-scope.test.ts`: new, 4 tests. Hash `879a968d…a5d5591`.

## Fix

The poll page body is awaited in its own try/catch, with a dropped body still becoming `Transport`. Then, before any parse, filter, `seen` dedup, cursor mutation, `onChange` or `has_more` continuation:

- If aborted, throw `AbortError`. The loop returns silently, with no revocation.
- If `fenced()` (the subscription's captured scope is no longer bound), throw `Revoked`.

That throw sits outside the parser catch, so it isn't reclassified. The existing caller rethrows `Revoked`, which leads to exactly one `onRevoked()` and a return, with no reset, retry or `"polling"` status. The contract parse keeps its own catch (`ContractError` → `NeedsReset`).

## Regressions (actual `subscribeWork` over actual `scopedFetch`)

In each test the stream connection fails so the subscription enters polling, the poll headers are accepted, and the JSON body is held. A `highWaterMark: 0` stream proves `res.json()` has begun reading before the event fires. Fetch attempts are counted at the `subscribeWork` boundary, because `scopedFetch` refuses locally after a fence and the raw transport alone would hide an attempt.

1. Fence, then release a `has_more=false` page: 0 `onChange`, no `"polling"` status, `onRevoked` once, 0 resets, no extra fetch attempt.
2. Same with `has_more=true`: no next-page request.
3. Abort, then release a `has_more=true` page: 0 `onChange`, no `"polling"`, 0 revocations, 0 resets, no extra attempt.
4. Same-scope control: the held page is applied exactly once and polling continues.

## Results

- `red.txt` is the valid red against unchanged source (`work-stream.ts` hash 533b…). Command: `timeout 100 ./node_modules/.bin/vitest run test/poll-scope.test.ts`. **exit=1**: 3 failed (tests 1–3, each with one late `onChange`), 1 passed (control).
- Retained invalid red attempts. These are not product evidence:
  - `red-attempt1-unbounded-hang.txt`: the harness had no loop bound, and the pre-fix loop kept running after the fence. The owner stopped it after a 120 s foreground timeout, so there is no exit code.
  - `red-attempt2-invalid-fixture-hang.txt`: the page fixture lacked the required `checked_at`, and `timeout` killed the run (exit=124). Fixed afterwards by adding a 200-sleep loop bound and `checked_at`.
- `green.txt`, after the fix. Command: `timeout 100 ./node_modules/.bin/vitest run test/poll-scope.test.ts test/scope-races.test.ts test/work-events.test.ts test/client-scope.test.ts`. **exit=0, 4 files / 56 passed.** This includes the existing SSE late-frame, upload-ambiguity, explicit-preflight-failure and same-scope recovery guards.
- `format.txt`: `prettier --write` exit=0 (both files unchanged), `prettier --check` exit=0. Post-format hashes equal the green run's.
- Not run, left to the parent: full vitest, tsc, eslint, full-repo prettier, build, browser.

## Remaining risks

- A pre-existing behavior was observed while debugging, not fixed (out of scope): a poll page that repeatedly fails the contract, combined with an `onReset` that resolves immediately, makes `NeedsReset` → `reset()` → `continue` repeat without a timed backoff. In tests this spun without yielding. In production, `onReset` does a real network snapshot read, so it yields. Flag it for a separate decision.
- After the fence, the in-flight poll request is not actively aborted; its result is discarded by the post-await guard instead.
- Consumers' `onChange` (useWorkState) still has no scope check of its own; the guard is at the subscription boundary, as required.
