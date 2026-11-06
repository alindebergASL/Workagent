// The Connections page on the real UI, API and PostgreSQL with the
// synthetic connector (no provider, no network, no real account): connect,
// cancel and revoke by keyboard keep the keyboard beside what happened and
// say what happened; the page passes axe in light and dark, fits a phone,
// and its controls (and the More menu that leads to it) are full-size there.
// Usage (stack running): node web/scripts/connections-journey.mjs <out-dir> <axe.min.js>
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const out = path.resolve(process.argv[2]);
const axe = await readFile(process.argv[3], "utf8");
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const report = { provider_calls: "not_performed", cases: [] };
const pass = (name) => {
  report.cases.push(name);
  console.log("PASS", name);
};
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
});
const focused = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "body";
    if (a.classList.contains("connector-state")) return "row-state";
    return a.textContent.trim();
  });
const axeRun = (page) =>
  page.evaluate(async () =>
    (
      await window.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
        },
      })
    ).violations.map((v) => `${v.id} (${v.nodes.length})`),
  );

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/connections`);
  const start = page.getByTestId("connector-start");
  const status = page.getByTestId("connector-outcome");
  await expect(start).toBeVisible({ timeout: 30000 });

  await start.press("Enter");
  await expect.poll(() => focused(page)).toBe("Review before connecting");
  await page.getByRole("button", { name: "Cancel" }).press("Enter");
  await expect.poll(() => focused(page)).toBe("Connect synthetic library");
  await expect(status).toContainText("Nothing was connected");
  pass(
    "opening the connection step moves the keyboard to it; cancelling returns it to Connect and says nothing was connected",
  );

  await start.press("Enter");
  await expect.poll(() => focused(page)).toBe("Review before connecting");
  const confirm = page.getByRole("button", {
    name: "Confirm synthetic connection",
  });
  await confirm.press("Enter");
  // Busy, not disabled: the pressed control keeps focus while it sends.
  expect(["Connecting…", "row-state"]).toContain(await focused(page));
  await expect.poll(() => focused(page), { timeout: 15000 }).toBe("row-state");
  await expect(status).toContainText("Connected: Synthetic library");
  pass(
    "confirming keeps focus while it sends, then moves it to the new connection's state and announces it",
  );

  for (const colorScheme of ["light", "dark"])
    for (const width of [1440, 390, 320]) {
      const p = await browser.newPage({
        viewport: { width, height: 1000 },
        colorScheme,
      });
      await p.goto(`${origin}/connections`);
      await expect(p.locator(".connector-row").first()).toBeVisible({
        timeout: 20000,
      });
      await p.addScriptTag({ content: axe });
      assert.deepEqual(await axeRun(p), [], `axe ${colorScheme} ${width}`);
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `no horizontal scroll at ${width}`,
      );
      if (width < 800) {
        const more = p.locator(".topbar-more > summary");
        await more.click();
        const small = await p.evaluate(() =>
          [
            ...document.querySelectorAll(
              "[data-testid=connector-panel] button, .topbar-more > summary, .topbar-more-panel .nav-link",
            ),
          ]
            .filter((b) => {
              const h = b.getBoundingClientRect().height;
              return h > 0 && h < 44;
            })
            .map((b) => b.textContent.trim().slice(0, 30)),
        );
        assert.deepEqual(small, [], `44px targets at ${width}`);
      }
      await p.screenshot({
        path: path.join(out, `connections-${colorScheme}-${width}.png`),
        fullPage: true,
      });
      await p.close();
    }
  pass(
    "with a connection listed, the page passes axe in light and dark at 1440/390/320, fits without sideways scroll, and its buttons and the More menu are 44px on a phone",
  );

  const revoke = page.getByRole("button", { name: "Revoke access" }).first();
  await revoke.press("Enter");
  await expect.poll(() => focused(page), { timeout: 15000 }).toBe("row-state");
  await expect(status).toContainText("Local access revoked");
  pass(
    "revoking from the keyboard keeps focus on that connection's state and announces the revocation",
  );
  assert.deepEqual(errors, [], "no page errors");
} finally {
  await writeFile(
    path.join(out, "connections-journey.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
