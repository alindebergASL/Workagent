# Recovery5d — A14 web scope correction (Claude web owner handoff)

Branch `hermes/b2-conversational-client`, current dirty source preserved. Only `web/` changed plus this handoff and two evidence files. No backend/contracts edits, commits, pushes, installs, services, browser runs, builds or provider calls. Product calls: 0.

**Verdict: web correction implemented and unit/route-tested. A14 is NOT complete.** The browser gate (real principal/endpoint switch with staged bytes, active-midstream revocation) still belongs to the parent.

## Design (smallest complete fix)

- `web/src/lib/client/session-scope.ts` (new) is the single source of identity. It has states `checking | ready | unavailable | changed`. `probeSession()` GETs `/api/domain/v1/session` and only the newest probe applies, so a late older response is dropped. A page realm binds **at most one** scope. Once bound, a different principal or scope, a failed probe, or a 401 sets `changed`, which is terminal: only a reload can bind again. So an old async continuation can never bind to a new scope, because a new scope never exists in that realm.
- Storage: `scopedSession` and `scopedLocal` are Storage adapters keyed `workagent:scope:v1:<scope>:<key>`.
  - Unbound or fenced: `getItem` returns null, `setItem` throws (existing catch paths treat it as "storage unavailable"), `removeItem` does nothing and `clear` throws.
  - Legacy unscoped records and other scopes' records are never read, relabelled, migrated or deleted.
  - Every former raw `sessionStorage`/`localStorage` site now uses these adapters: Composer draft/files/home-assignment, Home saga `home-start` (session+local), conversation-reply drafts/files/carry, `usePendingCommand`, operation journal (OperationComposer), FlexibleWork, WorkAreas, SpaceView facet, artifact draft backup `lib/draft.ts`, both artifact pages, since-marker, Home destination, workspace zone.
- IndexedDB staged bytes: `stagedScope(ws, draft)` returns `scope:v1:<scope>:<ws>:<draft>`, or null while unknown. `useStagedDocuments` uses it, so nothing is listed, restored or written until the scope is proven. Old `local-human:…` IDB records stay untouched and unread; `doc-store.list` is an exact index match.
- The build-time `PRINCIPAL` export was removed from `api.ts`.
- Request fence: `scopedFetch` adds `X-Workagent-Scope` with the bound scope.
  - Unknown or fenced scope: it refuses locally and sends nothing.
  - A response that arrives after the page was fenced has its body cancelled and is refused.
  - A 401 fences the page. Nothing is auto-retried.
  - Wired into batch2 `call` and `original` download (via `doFetch`; `setFetch` now swaps the raw transport underneath the fence), work-state snapshot/attention/seen reads, the work-stream default, and the generated client (`onRequest` sets the header or throws; `onResponse` drops results whose scope no longer matches the bound one and fences on 401).
  - `unwrap` and `call` rethrow the local `ApiError` (definite `unauthenticated`, nothing sent) instead of turning it into `transport`.
- `web/src/components/ScopeGate.tsx` (new), placed in `layout.tsx` around `WorkspaceProvider`/Shell. Children mount only in `ready`, keyed by scope. Otherwise it shows a single status line:
  - "Checking access…"
  - "Couldn't confirm access…" with **Check again**
  - "Access for this page changed…" with an explicit **Reload**
  - Revalidation runs on focus, on visibility, and every 60 s. On `changed`, the whole subtree unmounts synchronously (useSyncExternalStore), which aborts streams/reads through their existing unmount aborts and drops in-memory caches and composer state.
  - Mock demo mode binds the explicit `MOCK_IDENTITY` only when `API_MODE === "mock"`; it is never a real fallback.
- Proxy `web/src/app/api/domain/[...path]/route.ts`:
  - `GET v1/session` keeps the existing host/origin/client/local-test guards. It fetches backend `/v1/session` with the private bearer, `X-Schema-Version` and `X-Request-Id`, validates `{principal_id, scope_id:64hex}`, and returns only `{principal_id, scope_id: HMAC-SHA256(key=bearer, "workagent-web-scope/v1\n" + backendURL + "\n" + backendScope)}`. Backend 401/403 becomes 401; anything else fails closed as 503. No URL, DSN, bearer or backend scope reaches the browser.
  - Every other route needs a 64-hex `X-Workagent-Scope`. An absent or malformed header gets 401 before the body is read or anything is forwarded. Then it fetches the session afresh (no cache), compares with `timingSafeEqual`, and returns 401 on mismatch, before forwarding any read or write. It forwards the backend scope as upstream `X-Workagent-Scope`, which closes the gap between the session probe and dispatch.

## Tests

- RED (pre-correction source, new tests only): `docs/evidence/batch2-recovery5d/frontend-red.txt`.
  - All 6 proxy tests fail on behavior. Examples: session route 404; a stale-scope POST forwarded with 200; no upstream scope header; a session failure still forwarded.
  - The client suite fails at import because the scope module was absent. That is a weaker red: the client-side behaviors were red only by absence.
- GREEN: `frontend-green.txt` shows vitest 51 files / **499 passed** (481 existing + 18 new). `tsc --noEmit`, `eslint . --max-warnings 0` and `prettier --check .` are all clean (run serially).
- New: `web/test/client-scope.test.ts` (12) covers:
  - unknown fails closed
  - proven binding keys
  - legacy non-adoption and non-deletion
  - change fences, retains A's exact multiline draft under A, never re-binds
  - same-scope reload recovers the exact draft
  - revocation sanitizes reads
  - malformed/failed session never binds
  - late-probe race
  - unknown-scope fetch sends nothing
  - header carried / post-change POST not dispatched
  - 401 fences
  - pending batch2 command not dispatched after change
- New: `web/test/proxy-scope.test.ts` (6) covers:
  - session shape and no leaks
  - endpoint-only change gives a different scope
  - absent/stale/raw-backend scope refused for GET and POST with zero forwards
  - matching scope forwards once with the backend scope
  - session failure fails closed
  - revoked gives 401
- Test-only adaptations:
  - `web/test/scope-helper.ts` and `web/test/setup-scope.ts` (added via `setupFiles` in `web/vitest.config.mts`) bind a test scope through the real probe before each test.
  - `draft-carry.test.ts` expects the scoped key.
  - `products.test.ts`: the module-reload test binds the fresh module's scope, and the download-proxy tests answer the session probe and present the scope.
  - `batch2-controls` passed unchanged after `scopedFetch` was made to preserve plain-object headers.

## Changed files

Product:
- `web/src/lib/client/session-scope.ts` (new)
- `web/src/components/ScopeGate.tsx` (new)
- `web/src/app/layout.tsx`
- `web/src/app/api/domain/[...path]/route.ts`
- `web/src/lib/client/{api,batch2-api,real-api,work-state,work-stream,staged-documents,home-start,conversation-reply,pending-command,since-marker,workspace}.ts(x)`
- `web/src/lib/draft.ts`
- `web/src/components/{Composer,FlexibleWork,OperationComposer,WorkAreas,SpaceView}.tsx`
- `web/src/app/page.tsx`
- `web/src/app/conversations/[id]/artifacts/[artifactId]/page.tsx`
- `web/src/app/assignments/[id]/artifacts/[artifactId]/page.tsx`

Tests/config:
- `web/test/{client-scope,proxy-scope}.test.ts` (new)
- `web/test/{scope-helper,setup-scope}.ts` (new)
- `web/test/{draft-carry,products}.test.ts`
- `web/vitest.config.mts`

Evidence:
- `frontend-red.txt`
- `frontend-green.txt`
- this file

## Caveats / parent rerun flags

- A28/A35: no behavior change intended. However, the FlexibleWork note/table drafts, the artifact-page drafts and the operation journal now live under scoped keys, so drafts kept before this change are not restored. That is intentional (legacy unread). **Narrow rerun recommended for the A28 review/consent and A35 note editor journeys.**
- Every proxied request now costs one extra backend `/v1/session` round trip; there is no cache, by design. Long-lived SSE is fenced at open; mid-stream revocation relies on the backend's buffered SSE revocation plus client unmount on `changed`. **Active-midstream revocation still needs the browser proof.**
- A transient session-probe failure on focus or the 60 s recheck after binding is treated as `changed`, which fails closed and needs an explicit Reload. This is deliberately conservative and may be noisy on flaky local links.
- The `original()` download path still maps its local refusal to `transport` (read-only, nothing sent).
- `mock-api.ts` keeps its own demo `PRINCIPAL` header for the `/api/mock` route; it is demo-only and never used in real mode.
- No resource-specific refusal UI was added beyond the existing refusal presentation. Kept bytes and drafts are preserved under their original scope but are not offered for recovery under a different identity.
- Not run: production build, browser/E2E, Playwright, backend tests.
