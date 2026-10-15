import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const cases = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const apiRequests = [];
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== "http://127.0.0.1:38471") return route.abort();
    if (u.pathname.startsWith("/api/")) {
      apiRequests.push({ method: route.request().method(), path: u.pathname });
      if (route.request().method() !== "GET") return route.abort();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"items":[]}',
      });
    }
    return route.continue();
  });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto("http://127.0.0.1:38471/activity");
    assert.equal(response.status(), 200);
    await expect(
      page.getByRole("heading", { name: "Activity", exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    assert.deepEqual(errors, []);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    cases.push({
      width,
      httpStatus: response.status(),
      activityRendered: true,
      browserErrors: [],
    });
  }
  assert.ok(apiRequests.every((r) => r.method === "GET"));
  writeFileSync(
    "../../frontend-production-smoke.json",
    JSON.stringify(
      {
        passed: true,
        cases,
        apiRequests,
        apiMode: "intercepted empty-workspace fixture; no backend or provider",
        providerCalls: 0,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(cases));
} finally {
  await browser.close();
}
