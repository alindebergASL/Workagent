#!/usr/bin/env node
// Read-only browser proof of retained live-model work in the production app.
// This consumes actual saved artifacts; no provider call, fixture renderer or save.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "web/package.json"));
const { chromium, expect } = require("@playwright/test");
const out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN || "http://127.0.0.1:3161";
const ws = "flexible-proof";
const prefix = origin + "/api/domain/v1/workspaces/" + ws;
async function api(route) {
  const r = await fetch(prefix + route, {
    headers: { "X-Workagent-Client": "local-ui" },
  });
  assert.equal(r.status, 200);
  return r.json();
}
const keys = ["rainwater", "venues-current", "custom-view"];
const artifacts = {};
for (const key of keys) {
  const item = JSON.parse(
    await readFile(
      path.join(root, "evidence/flexible-work-13", key + ".json"),
      "utf8",
    ),
  );
  artifacts[key] = await api("/artifacts/" + item.artifact_id);
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {}),
});
const checks = [],
  errors = [],
  actions = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().endsWith("/view-actions"))
      actions.push({ status: r.status(), url: r.url() });
  });
  const url = (a) =>
    `${origin}/conversations/${a.conversation_id}/artifacts/${a.id}`;
  const table = artifacts["venues-current"];
  await page.goto(url(table));
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: table.current_revision.body.title,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel(
      "Willow Hall " +
        table.current_revision.body.fields.find((f) => f.key === "hire_cost")
          .label,
      { exact: true },
    ),
  ).toHaveValue("350.00");
  await expect(
    page.getByLabel(
      "Willow Hall " +
        table.current_revision.body.fields.find((f) => f.key === "venue_notes")
          .label,
      { exact: true },
    ),
  ).toHaveValue(
    "Human: ask Marta about a discount before any booking. Keep this note.",
  );
  await expect(page.getByTestId("product-verification")).toContainText(
    /hasn’t been verified|Nothing checks this automatically/,
  );
  await page.screenshot({
    path: path.join(out, "01-live-table-desktop.png"),
    fullPage: true,
  });
  checks.push(
    "Live-model structured table opens in normal editor with accepted human price/note and truthful verification status",
  );
  // Browser CSV export is from the saved facts, not unsaved DOM text.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download as CSV" }).click();
  const download = await downloadPromise;
  await download.saveAs(path.join(out, "venues.csv"));
  const csv = await readFile(path.join(out, "venues.csv"), "utf8");
  assert(csv.includes("350.00") && csv.includes("Human: ask Marta"));
  checks.push("Actual CSV download contains the saved human edits");
  const view = artifacts["custom-view"];
  await page.goto(url(view));
  await expect(page.getByText("· current saved version")).toBeVisible();
  await expect(page.locator(".view-trust")).toContainText(
    "hasn’t been verified",
  );
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#summary")).toContainText("0 matching venues");
  await frame.getByLabel(/budget/i).fill("350");
  await expect(frame.locator("#summary")).toContainText("2 matching venues");
  await expect(
    frame.getByRole("heading", { name: "Willow Hall", exact: true }),
  ).toBeVisible();
  await expect(
    frame.getByRole("heading", { name: "River Centre", exact: true }),
  ).toBeVisible();
  await expect(frame.locator("body")).toContainText(
    "Human: ask Marta about a discount before any booking. Keep this note.",
  );
  const before = actions.length;
  await frame.getByRole("button", { name: "Refresh saved data" }).click();
  await expect.poll(() => actions.length).toBeGreaterThan(before);
  assert.equal(actions.at(-1).status, 200);
  checks.push(
    "Actual model-authored source filters exact bound saved data and refreshes through production UI adapter",
  );
  await page.screenshot({
    path: path.join(out, "02-live-view-desktop.png"),
    fullPage: true,
  });
  const child = page.frames().find((f) => f !== page.mainFrame());
  assert(child);
  const beforeDenial = actions.length;
  const denial = await child.evaluate(async () => {
    try {
      await window.workagent.request("refresh_venues", {
        artifact_id: "arbitrary-target",
      });
      return false;
    } catch {
      return true;
    }
  });
  assert(denial);
  assert.equal(actions.length, beforeDenial);
  await expect(page.getByTestId("view-refusal")).toContainText(
    "isn’t allowed to",
  );
  checks.push(
    "Malformed target action is refused by trusted shell before HTTP",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url(view));
  await expect(frame.locator("#summary")).toContainText("0 matching venues");
  const size = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(size.scroll <= size.width + 2);
  await page.screenshot({
    path: path.join(out, "03-live-view-phone.png"),
    fullPage: true,
  });
  await page.getByText("Readable version", { exact: true }).first().click();
  await expect(page.locator(".view-fallback").first()).toContainText(
    view.current_revision.body.fallback,
  );
  checks.push(
    "Phone custom view has no horizontal overflow and readable fallback is available",
  );
  await page.goto(url(artifacts.rainwater));
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: artifacts.rainwater.current_revision.body.title,
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(out, "04-live-calculator-phone.png"),
    fullPage: true,
  });
  checks.push(
    "Other live-model goal reopens as a runnable tool in the same product, not a task-specific page",
  );
  await page.goto(origin);
  for (const a of Object.values(artifacts))
    await expect(page.locator(`[data-artifact="${a.id}"]`).first()).toBeVisible(
      { timeout: 20000 },
    );
  checks.push("Home exposes all three retained model-created work products");
  for (const a of Object.values(artifacts)) {
    const after = await api("/artifacts/" + a.id);
    assert.deepEqual(after.current_revision, a.current_revision);
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "verification.json"),
    JSON.stringify(
      {
        mode: "production_ui_real_api_retained_live_model_artifacts",
        provider_calls: 0,
        saved_mutations: 0,
        checks,
        actions,
        errors,
        artifacts: Object.fromEntries(
          Object.entries(artifacts).map(([k, a]) => [
            k,
            {
              id: a.id,
              revision_id: a.current_revision_id,
              body_hash: a.current_revision.body_hash,
            },
          ]),
        ),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} catch (e) {
  console.error(e);
  throw e;
} finally {
  await browser.close();
}
