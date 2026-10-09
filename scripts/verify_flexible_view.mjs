#!/usr/bin/env node
/** Exercise actual saved model source through the unchanged owner sandbox host.
 * Integration harness, not product UI and not a model/goal verifier. API bearer
 * stays in Node; the opaque frame gets only declared named actions and JSON.
 * Usage: source private proof env; node scripts/verify_flexible_view.mjs ARTIFACT_ID OUTPUT_DIR
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
const require = createRequire(path.join(web, "package.json"));
const { chromium, expect } = require("@playwright/test");
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { build } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { APP_SECURITY_HEADERS } = await import(
  pathToFileURL(path.join(web, "src/lib/security-headers.mjs")).href
);
const [aid, out, mode] = process.argv.slice(2);
assert(aid && out, "artifact ID and output directory required");
assert(!mode || mode === "--save-stale", "unknown mode");
await fs.mkdir(out, { recursive: true });
const origin = process.env.FLEXIBLE_API_ORIGIN || "http://127.0.0.1:8150";
const ws = process.env.FLEXIBLE_WORKSPACE || "flexible-proof";
if (mode)
  assert(
    origin === "http://127.0.0.1:8150" && ws === "flexible-proof",
    "writes limited to owned disposable live proof",
  );
assert(process.env.LOCAL_BEARER_TOKEN, "private local API env required");
async function api(route, body) {
  const r = await fetch(origin + "/v1/workspaces/" + ws + route, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + process.env.LOCAL_BEARER_TOKEN,
      "Content-Type": "application/json",
      "X-Schema-Version": "workagent/v1",
      "X-Request-Id": randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
const initial = await api("/artifacts/" + aid);
assert.equal(initial.status, 200);
let artifact = initial.data;
const view = artifact.current_revision.body;
assert.equal(view.kind, "custom_view");
const allowed = new Set(view.actions.map((a) => a.name));
assert(allowed.size > 0, "A real declared interaction is required");
const calls = [];
const entry = `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SandboxedView} from '@/components/SandboxedView';
import '@/styles/globals.css';
import '@/styles/agent-first.css';
import '@/styles/foundations.css';
import '@/styles/products.css';
function Host(){const [v,setView]=useState(null);window.mountView=setView;if(!v)return <p>Loading saved work</p>;
const actions=Object.create(null);for(const action of v.body.actions)actions[action.name]=async(payload)=>window.scopedBroker(action.name,payload);
return <main><h1>{v.body.title}</h1><p>Draft generated source — not independently verified.</p><SandboxedView key={v.revision} title={v.body.title} source={v.body.source} data={{}} actions={actions} fallback={<p>{v.body.fallback}</p>}/><section aria-label="Readable saved fallback">{v.body.fallback}</section></main>;}
createRoot(document.getElementById('root')).render(<Host/>);`;
const built = await build({
  root: web,
  configFile: false,
  logLevel: "error",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "@": path.join(web, "src") } },
  oxc: { jsx: { runtime: "automatic" } },
  plugins: [
    {
      name: "real-saved-view-proof",
      enforce: "pre",
      resolveId(id) {
        if (id === "proof-entry" || id === path.join(web, "proof-entry"))
          return "\0proof-entry.tsx";
      },
      load(id) {
        if (id === "\0proof-entry.tsx") return entry;
      },
    },
  ],
  build: {
    write: false,
    minify: false,
    lib: { entry: "proof-entry", formats: ["iife"], name: "SavedViewProof" },
  },
});
const code = (Array.isArray(built) ? built[0] : built).output.find(
  (x) => x.type === "chunk",
).code;
const css = (Array.isArray(built) ? built[0] : built).output
  .filter((x) => x.type === "asset" && x.fileName.endsWith(".css"))
  .map((x) => String(x.source))
  .join("\n");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {}),
});
const errors = [],
  network = [],
  checks = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  await page.context().tracing.start({ screenshots: true, snapshots: true });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("scopedBroker", async (name, payload) => {
    assert(allowed.has(name), "handler not declared by saved view");
    const r = await api("/artifacts/" + aid + "/view-actions", {
      schema_version: "workagent/v1",
      request_id: randomUUID(),
      view_revision_id: artifact.current_revision_id,
      view_body_hash: artifact.current_revision.body_hash,
      access_generation: view.access_generation,
      action: name,
      payload,
    });
    calls.push({ name, status: r.status, response: r.data });
    if (r.status !== 200) throw new Error("View action refused");
    assert(JSON.stringify(r.data).length < 60000);
    return r.data;
  });
  await page.route("**/*", (route) => {
    network.push(route.request().url());
    if (route.request().url() === "https://app.test/work")
      return route.fulfill({
        contentType: "text/html",
        headers: Object.fromEntries(
          APP_SECURITY_HEADERS.map((h) => [h.key, h.value]),
        ),
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
      });
    return route.abort();
  });
  await page.goto("https://app.test/work");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: code });
  await page.waitForFunction(() => typeof window.mountView === "function");
  await page.evaluate((v) => window.mountView(v), {
    revision: artifact.current_revision_id,
    body: view,
  });
  const frame = page.frameLocator("iframe");
  await expect
    .poll(() => calls.filter((c) => c.status === 200).length, {
      timeout: 15000,
    })
    .toBeGreaterThan(0);
  await expect(frame.getByLabel(/budget/i)).toBeVisible();
  const budget = frame.getByLabel(/budget/i);
  const capacity = frame.getByLabel(/capacity/i);
  const stepFree = frame.getByRole("checkbox", { name: /step.free/i });
  assert.equal(await budget.inputValue(), "300");
  assert.equal(await capacity.inputValue(), "70");
  assert(await stepFree.isChecked());
  await expect(frame.locator("body")).toContainText(
    /no (?:qualifying|matching|venues)|0 (?:matching|venues|of)/i,
  );
  checks.push("Initial saved constraints honestly show no qualifying venue");
  await budget.fill("350");
  await budget.dispatchEvent("input");
  await expect(
    frame.getByRole("heading", { name: "Willow Hall", exact: true }),
  ).toBeVisible();
  await expect(
    frame.getByRole("heading", { name: "River Centre", exact: true }),
  ).toBeVisible();
  await expect(frame.locator("body")).toContainText(
    "Human: ask Marta about a discount before any booking. Keep this note.",
  );
  checks.push(
    "Budget control reveals Willow Hall and River Centre with preserved human note",
  );
  await page.screenshot({
    path: path.join(out, "generated-view-desktop.png"),
    fullPage: true,
  });
  await budget.fill("300");
  await budget.dispatchEvent("input");
  await stepFree.uncheck();
  await expect(
    frame.getByRole("heading", { name: "Station Loft", exact: true }),
  ).toBeVisible();
  checks.push("Accessibility control changes eligible result to Station Loft");
  await stepFree.check();
  await budget.fill("350");
  await budget.dispatchEvent("input");
  const before = calls.length;
  await frame.getByRole("button", { name: /refresh saved data/i }).click();
  await expect.poll(() => calls.length).toBeGreaterThan(before);
  assert.equal(calls.at(-1).status, 200);
  assert.equal(calls.at(-1).response.revision_id, view.bindings[0].revision_id);
  checks.push(
    "Refresh performs an actual authenticated exact-bound broker read",
  );
  const child = page.frames().find((f) => f !== page.mainFrame());
  assert(child);
  const undeclaredBefore = calls.length;
  const denied = await child.evaluate(async () => {
    try {
      await window.workagent.request("approve", {});
      return false;
    } catch {
      return true;
    }
  });
  assert(denied);
  assert.equal(calls.length, undeclaredBefore);
  checks.push("Undeclared approval is refused by host without any broker call");
  const malformed = await child.evaluate(async (name) => {
    try {
      await window.workagent.request(name, { artifact_id: "arbitrary-target" });
      return false;
    } catch {
      return true;
    }
  }, view.actions[0].name);
  assert(malformed);
  assert.equal(calls.at(-1).status, 422);
  checks.push(
    "Extra target payload is rejected by real broker and cannot write",
  );
  const isolation = await child.evaluate(() => {
    let parentBlocked = false,
      storageBlocked = false;
    try {
      void parent.document.body;
    } catch {
      parentBlocked = true;
    }
    try {
      localStorage.setItem("escape", "x");
    } catch {
      storageBlocked = true;
    }
    return { parentBlocked, storageBlocked };
  });
  assert.deepEqual(isolation, { parentBlocked: true, storageBlocked: true });
  checks.push("Actual generated frame cannot access parent DOM or storage");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(out, "generated-view-phone.png"),
    fullPage: true,
  });
  const overflow = await child.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2,
  );
  assert.equal(overflow, false, "phone frame must not horizontally overflow");
  checks.push("Generated view fits phone viewport");
  assert.deepEqual(network, ["https://app.test/work"]);
  assert.deepEqual(errors, []);
  const after = await api("/artifacts/" + aid);
  assert.equal(after.data.current_revision_id, artifact.current_revision_id);
  if (mode === "--save-stale") {
    const oldRevision = artifact.current_revision_id;
    const edited = structuredClone(view);
    edited.fallback +=
      " Human review note: keep this saved explorer as a draft; no booking is authorized.";
    const saved = await api("/artifacts/" + aid + "/save", {
      schema_version: "workagent/v1",
      request_id: randomUUID(),
      command_id: randomUUID(),
      expected_current_revision_id: oldRevision,
      body: edited,
    });
    assert.equal(saved.status, 200);
    assert.notEqual(saved.data.current_revision_id, oldRevision);
    const staleBefore = calls.length;
    await frame.getByRole("button", { name: /refresh saved data/i }).click();
    await expect.poll(() => calls.length).toBeGreaterThan(staleBefore);
    assert.equal(calls.at(-1).status, 404);
    await expect(frame.locator("body")).toContainText(
      /refused|stale|unavailable/i,
    );
    await expect(frame.locator("#status")).toContainText("not freshly loaded");
    await expect(frame.locator("#summary")).toContainText(
      "Previously loaded data only — refresh failed.",
    );
    await page.screenshot({
      path: path.join(out, "stale-view-refused.png"),
      fullPage: true,
    });
    checks.push(
      "Real human save makes the open frame stale; refresh is refused and retained results visibly say previously loaded, not freshly loaded",
    );
    const reopened = await api("/artifacts/" + aid);
    assert.equal(reopened.status, 200);
    assert.deepEqual(
      reopened.data.current_revision,
      saved.data.current_revision,
    );
    assert.deepEqual(reopened.data.current_revision.body.source, view.source);
    assert.equal(reopened.data.current_revision.body.fallback, edited.fallback);
    artifact = reopened.data;
    const reopenBefore = calls.length;
    await page.evaluate((v) => window.mountView(v), {
      revision: artifact.current_revision_id,
      body: artifact.current_revision.body,
    });
    await expect.poll(() => calls.length).toBeGreaterThan(reopenBefore);
    assert.equal(calls.at(-1).status, 200);
    await expect(
      page.getByRole("region", { name: "Readable saved fallback" }),
    ).toContainText("Human review note");
    checks.push(
      "Reopen retains exact generated source and human fallback edit; new revision broker succeeds",
    );
  }
  assert.deepEqual(network, ["https://app.test/work"]);
  assert.deepEqual(errors, []);
  const evidence = {
    scope:
      "Real saved live-model source through unchanged SandboxedView host plus real authenticated backend broker; isolated integration harness, not full product UI",
    artifact_id: aid,
    view_revision_id: artifact.current_revision_id,
    view_body_hash: artifact.current_revision.body_hash,
    checks,
    broker_calls: calls.map((c) => ({
      action: c.name,
      status: c.status,
      revision_id: c.response.revision_id || null,
    })),
    network,
    errors,
  };
  await fs.writeFile(
    path.join(out, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({ passed: checks.length, artifact_id: aid, checks }),
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
      .catch(() => {});
    await fs.writeFile(
      path.join(out, "failure.txt"),
      String(error) +
        "\n" +
        (await page
          .locator("body")
          .innerText()
          .catch(() => "")),
    );
  }
  throw error;
} finally {
  if (page)
    await page
      .context()
      .tracing.stop({ path: path.join(out, "trace.zip") })
      .catch(() => {});
  await browser.close();
}
