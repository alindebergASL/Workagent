# Sandboxed agent-created views — frontend host (issue #13)

Status: the isolation host is built and attacked in a real browser. It is
**not wired to any product yet**: the generated custom-view contract (source,
data bindings, actions) is Hermes's to publish, and no fields are invented
here.

## What exists

- `web/src/components/SandboxedView.tsx`: renders a view's HTML/CSS/JS in an
  iframe and talks to it over one private `MessageChannel` port.
- `web/src/lib/sandbox.ts`: the frame document, its content policy, limits
  and the message reader.
- `web/src/lib/security-headers.mjs`: app-wide `Content-Security-Policy:
  frame-src 'self'`, served by `next.config.ts` on every route.

## Isolation, layer by layer

| Layer | What it does |
| --- | --- |
| `sandbox="allow-scripts"` only | Opaque origin: no cookies, storage, parent DOM, forms, popups, modals, downloads or top navigation |
| Frame content policy (meta, first in `<head>`, plus the iframe `csp` attribute) | `default-src 'none'`; inline script/style only; images, fonts and media from `data:`/`blob:` only; no connect, frames, workers, objects, forms or base URL |
| App `frame-src 'self'` header | The embedding page's policy blocks the frame from navigating itself to another site |
| Navigation watch | Any second load of the frame removes it and shows "This view tried to load something else, so it was stopped." |
| Permissions Policy (`allow`) | Camera, microphone, location, clipboard, payment and similar denied |
| Host message reader | Only `resize` and `request`; requests must name an action the host was given (own property, `^[a-z][a-z0-9_.-]{0,63}$`); malformed or oversized requests are answered "refused" so views don't hang; 30 requests/min, 4 in flight; failures return a generic message |
| Limits | Source 512 KB, data 1 MB, message 64 KB, height 120–4000 px |
| Trusted shell | The frame is bordered and captioned "Made by Workagent for this work. It can't reach your account or the internet."; approval controls stay outside it |

Data reaches the view as plain JSON (`workagent.ready()`, `workagent.data`,
`workagent:data` events). The view asks for things with
`workagent.request(action, payload)`; requests made before the connection
wait for it.

## Evidence

`web/scripts/sandbox-regressions.mjs` (real Chromium, no server or model;
the page is served with the app's real headers). 9/9 pass:

1. Renders generated HTML/CSS/JS with its data; sizes to content.
2. Data updates after connection reach the view.
3. Only granted actions run; `constructor`, `toString`, `__proto__`, wrong
   case and ungranted names are refused; handler failures stay generic.
4. Oversized requests never reach handlers; a 40-request flood is limited to 30.
5. No network: fetch (external, app origin, relative), XHR, WebSocket,
   EventSource, beacon, worker, module import, image, CSS background,
   stylesheet, prefetch, font, video, nested frame and object are all
   blocked; **no request reached the network layer** and each created one
   failed in the browser.
6. No cookies, local/session storage, IndexedDB, parent DOM or top location;
   `window.open` returns nothing; no popup, dialog, form post or download.
7. Markup that tries to close its own `<style>`/`<script>` can't run in or
   touch the trusted page.
8. A view navigating itself to another site is blocked by the app's frame
   policy, nothing reaches the network, and the view is removed with a
   readable fallback.
9. Oversized source is refused with a readable fallback.

Unit tests: `web/test/sandbox.test.ts`. The Next server was checked to send
`frame-src 'self'` on Home and product routes; all existing journeys pass
with it.

## What the contract needs to provide (for Hermes)

The host takes `{html, css?, js?}`, plain JSON data, and a table of named
actions whose handlers validate the payload, recheck permission and freshness,
and go through the normal backend path. Concretely, per view:

- source (and any bounded assets, inlined as `data:` or delivered as data);
- the exact artifact/revision it is bound to, so a stale view's actions are
  refused;
- declared actions and their payload schemas, so the host can expose only
  those and the backend can validate them.

## Known limits

- Inline script is allowed by design (it is the view), so the boundary is
  the opaque origin, the no-network policy and the host's message checks,
  not script restriction.
- Chromium is what the regressions exercise; other engines are untested.
- A view can still draw anything inside its own box, including something
  that looks like a button. The trusted caption and keeping real approvals
  outside the frame are the mitigation; it cannot approve or save on its own.
