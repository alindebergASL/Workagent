/**
 * Product-reset checkpoint 1 against the actual API and PostgreSQL (the
 * database retained by the canonical demo; no dispatcher, no provider).
 *
 * - The Home draft survives a reload before anything is sent (source-free
 *   conversation itself is covered by conversation-journey.mjs).
 * - Explicit delegation with chosen context creates real intake work.
 * - Ownership at a glance with real Pause / Resume / Stop (control endpoint),
 *   each checked against the API.
 * - The conversation beside the demo's document, built from its records.
 * - Desktop and phone captures, plus prototype/app side-by-side images.
 *
 * Usage (stack running): node web/scripts/reset-checkpoint.mjs <state.json> <out-dir> <prototype-dir>
 */
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const state = JSON.parse(await readFile(process.argv[2], "utf8"));
const out = path.resolve(process.argv[3]);
const proto = process.argv[4] ? path.resolve(process.argv[4]) : null;
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const base = `${origin}/api/domain/v1/workspaces/local-workspace`;
const api = async (p) => {
  const r = await fetch(base + p, {
    headers: { "X-Workagent-Client": "local-ui" },
  });
  if (!r.ok) throw new Error(`${p} ${r.status}`);
  return r.json();
};

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const sizes = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 },
};
const errors = [];
const checks = {};
const shot = async (page, name) => {
  await page.screenshot({
    path: path.join(out, `${name}.png`),
    fullPage: true,
  });
};
const noScroll = async (page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);

const goal = (await api(`/assignments/${state.assignment_id}`)).goal;
let created = null;

try {
  for (const [label, viewport] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (e) => errors.push(e.message));
    const writes = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/api/domain/"))
        writes.push(r.url());
    });

    // ---- Home from actual records ----
    await page.goto(origin);
    await expect(
      page.getByRole("heading", { name: "Good to see you." }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator(`[data-assignment="${state.assignment_id}"] .status`),
    ).toHaveText("Approved revision", { timeout: 15000 });
    await expect(page.locator(".lede")).not.toHaveText(/Checking/);
    await noScroll(page);
    // Approval saves a document; it is not goal completion, so nothing is "Done".
    await expect(page.locator(".since-approved summary")).toContainText(
      "Approved and saved",
    );
    await expect(
      page.locator(
        `.since-approved [data-assignment="${state.assignment_id}"]`,
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(".since-group summary", { hasText: /^Done/ }),
    ).toHaveCount(0);
    await shot(page, `01-home-${label}`);

    // ---- The draft survives a reload before anything is sent ----
    const message = "Help me think through how to plan next week.";
    const box = page.getByLabel("Message your agent");
    await box.fill(message);
    await page.reload();
    await expect(page.getByLabel("Message your agent")).toHaveValue(message);
    await expect(page.locator(".lede")).not.toHaveText(/Checking/);
    expect(writes, "typing and reloading write nothing").toEqual([]);

    // ---- With context chosen, "Take it from here" starts real work ----
    await page.getByRole("button", { name: /^Your context/ }).click();
    await expect(page.getByText("Records this work may use")).toBeVisible();
    await shot(page, `03-entry-context-${label}`);

    if (label === "desktop") {
      await page
        .locator(".context-panel .chip")
        .first()
        .locator("input")
        .check();
      await expect(
        page.getByRole("button", { name: "Your context · 1 source" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Take it from here" }).click();
      await page.waitForURL(/\/assignments\/[^/]+$/, { timeout: 15000 });
      created = page.url().split("/").pop();
      checks.delegated = (await api(`/assignments/${created}`)).state;
      // No dispatcher runs here, so the work stays queued: steerable.
      await expect(
        page.getByRole("heading", { name: "Ownership at a glance" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
      await shot(page, `04-responsibility-active-${label}`);

      await page.getByRole("button", { name: "Pause" }).click();
      await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
      await expect(page.locator("header .status").first()).toHaveText("Paused");
      checks.paused = (await api(`/assignments/${created}`)).state;
      expect(checks.paused).toBe("paused");
      await shot(page, `05-responsibility-paused-${label}`);

      await page.getByRole("button", { name: "Resume" }).click();
      await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
      checks.resumed = (await api(`/assignments/${created}`)).state;
      expect(checks.resumed).toBe("queued");

      await page.getByRole("button", { name: "Stop…" }).click();
      await page.getByRole("button", { name: "Stop work" }).click();
      await expect(page.locator("header .status").first()).toHaveText(
        "Stopped",
      );
      await expect(
        page.getByRole("button", { name: /Pause|Resume|Stop/ }),
      ).toHaveCount(0);
      checks.stopped = (await api(`/assignments/${created}`)).state;
      expect(checks.stopped).toBe("cancelled");
      await shot(page, `06-responsibility-stopped-${label}`);
    } else if (created) {
      await page.goto(`${origin}/assignments/${created}`);
      await expect(page.locator("header .status").first()).toHaveText(
        "Stopped",
      );
      await shot(page, `06-responsibility-stopped-${label}`);
    }

    // ---- Conversation beside the demo document, from its records ----
    await page.goto(origin + state.artifact_url);
    await expect(page.locator(".doc-card")).toBeVisible({ timeout: 15000 });
    const toggle = page.locator(".working-switch");
    if (await toggle.isVisible()) {
      await shot(page, `07-work-${label}`);
      await toggle
        .getByRole("button", { name: "Conversation", exact: true })
        .click();
    }
    const thread = page.getByRole("list", {
      name: "Conversation about this work",
    });
    await expect(thread.locator(".msg-person").first()).toHaveText(
      `You: ${goal}`,
    );
    await expect(thread).toContainText("You saved your edits as revision");
    await expect(thread).toContainText("You applied it as revision");
    checks[`thread_${label}`] = await thread.locator("li").allInnerTexts();
    await noScroll(page);
    await shot(page, `08-work-conversation-${label}`);
    await page.close();
  }

  // ---- Prototype and actual app, side by side ----
  const pairs = [
    ["01-home-desktop.png", "01-home-desktop.png", "Home"],
    [
      "09-responsibility-desktop.png",
      "04-responsibility-active-desktop.png",
      "Responsibility",
    ],
    [
      "02-pickup-desktop.png",
      "08-work-conversation-desktop.png",
      "Work beside conversation",
    ],
    ["home-mobile.png", "01-home-mobile.png", "Home · phone"],
    [
      "02b-pickup-conversation-mobile.png",
      "08-work-conversation-mobile.png",
      "Conversation · phone",
    ],
  ];
  if (proto)
    for (const [p, a, title] of pairs) {
      if (!existsSync(path.join(proto, p))) continue;
      const img = async (f) =>
        `data:image/png;base64,${(await readFile(f)).toString("base64")}`;
      const page = await browser.newPage({
        viewport: { width: 1800, height: 900 },
      });
      await page.setContent(`<!doctype html><body style="margin:0;font:14px system-ui;background:#fff;color:#202632">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px;align-items:start">
        <figure style="margin:0"><figcaption style="margin-bottom:8px">Prototype · ${title}</figcaption>
        <img style="width:100%;border:1px solid #e7eaf0" src="${await img(path.join(proto, p))}"></figure>
        <figure style="margin:0"><figcaption style="margin-bottom:8px">Actual app · real API + PostgreSQL · ${title}</figcaption>
        <img style="width:100%;border:1px solid #e7eaf0" src="${await img(path.join(out, a))}"></figure></div></body>`);
      await page.screenshot({
        path: path.join(out, `side-by-side-${a.replace(/^\d+-/, "")}`),
        fullPage: true,
      });
      await page.close();
    }

  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        passed: true,
        mode: "actual_application_postgresql_fixture_compute",
        provider_inference_calls: 0,
        demo_assignment_id: state.assignment_id,
        delegated_assignment_id: created,
        checks,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  expect(errors).toEqual([]);
  console.log(
    "PASS: source-free entry, real delegation and steering, and the conversation beside work on the actual service",
  );
} finally {
  await browser.close();
}
