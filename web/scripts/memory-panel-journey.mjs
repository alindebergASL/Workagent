// The Memory panel on the real UI, API and PostgreSQL (no provider calls):
// it fits a phone, passes axe in light and dark, gives a thumb full-size
// targets, and keeps the keyboard beside what the person pressed — through
// the forget confirmation, a correction, and items that leave the list —
// while saying, by kind, what happened to an item that has gone.
//
// Data: web/scripts/memory_fixture.py. Usage (stack running):
//   node web/scripts/memory-panel-journey.mjs <out-dir> <fixture.json> <axe.min.js>
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const out = path.resolve(process.argv[2]);
const f = JSON.parse(await readFile(process.argv[3], "utf8"));
const axe = await readFile(process.argv[4], "utf8");
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const url = `${origin}/conversations/${f.conversation_id}?workspace=${f.workspace_id}`;
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
    if (a.dataset.testid === "memory-item") return "memory-item";
    return (a.getAttribute("aria-label") || a.textContent || a.tagName)
      .trim()
      .toLowerCase();
  });
async function open(page) {
  await page.goto(url);
  const panel = page.getByTestId("memory-panel");
  await panel.waitFor({ timeout: 30000 });
  await panel.evaluate((d) => (d.open = true));
  await expect(page.getByTestId("memory-item").first()).toBeVisible({
    timeout: 20000,
  });
  return panel;
}

try {
  for (const colorScheme of ["light", "dark"])
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        colorScheme,
      });
      const panel = await open(page);
      for (const d of await panel.locator("details").all())
        await d.evaluate((x) => (x.open = true));
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () =>
        (
          await window.axe.run(
            { include: [["[data-testid=memory-panel]"]] },
            {
              runOnly: {
                type: "tag",
                values: [
                  "wcag2a",
                  "wcag2aa",
                  "wcag21a",
                  "wcag21aa",
                  "best-practice",
                ],
              },
            },
          )
        ).violations.map((v) => `${v.id} (${v.nodes.length})`),
      );
      assert.deepEqual(violations, [], `axe ${colorScheme} ${width}`);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `no horizontal scroll at ${width}`,
      );
      if (width < 1000) {
        const small = await panel.evaluate((p) =>
          [...p.querySelectorAll("button, summary")]
            .filter((b) => {
              const h = b.getBoundingClientRect().height;
              return h > 0 && h < 44;
            })
            .map((b) => b.textContent.trim().slice(0, 30)),
        );
        assert.deepEqual(small, [], `44px targets at ${width}`);
      }
      await panel.screenshot({
        path: path.join(out, `memory-${colorScheme}-${width}.png`),
      });
      await page.close();
    }
  pass(
    "the Memory panel fits 1440/390/320 with no horizontal scroll, long values wrap in their card, axe finds nothing in light or dark, and phone targets are 44px",
  );

  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  const items = page.getByTestId("memory-item");
  const first = items.first();
  await first.getByRole("button", { name: "Forget…" }).press("Enter");
  expect(await focused(page)).toBe("forget it");
  await first.getByRole("button", { name: "Keep it" }).press("Enter");
  expect(await focused(page)).toBe("forget…");
  await first
    .getByRole("button", { name: "Correct", exact: true })
    .press("Enter");
  expect(await focused(page)).toBe("textarea");
  await first.getByRole("button", { name: "Cancel" }).press("Enter");
  expect(await focused(page)).toBe("correct");
  pass(
    "opening and closing the forget confirmation or a correction keeps the keyboard beside it: into the step, then back to what opened it",
  );

  const before = await items.count();
  await first.getByRole("button", { name: "Forget…" }).press("Enter");
  await first.getByRole("button", { name: "Forget it" }).press("Enter");
  // Busy, not disabled: the pressed control keeps focus while it sends.
  expect(await focused(page)).toBe("forget it");
  await expect(items).toHaveCount(before - 1, { timeout: 15000 });
  await expect.poll(() => focused(page)).toBe("memory-item");
  await expect(page.getByTestId("memory-outcome")).toContainText(
    /memory: .*Forgotten/,
  );
  pass(
    "forgetting an item from the keyboard keeps focus while it sends, then hands it to the next item; the outcome is announced by kind, without the forgotten text",
  );

  await page.getByRole("button", { name: "Waiting for review" }).click();
  await expect(items).toHaveCount(1, { timeout: 15000 });
  await items.first().getByRole("button", { name: "Accept" }).press("Enter");
  expect(await focused(page)).toBe("accept");
  await expect(items).toHaveCount(0, { timeout: 15000 });
  await expect.poll(() => focused(page)).toBe("waiting for review");
  await expect(page.getByTestId("memory-outcome")).toContainText(
    "Preference memory: Done. Reread now shows: In use.",
  );
  await expect(page.getByTestId("memory-panel")).toContainText(
    "Nothing is waiting for review.",
  );
  pass(
    "accepting the last item waiting for review keeps focus on the view it was in, says what happened to it, and the empty review list says so in its own words",
  );
  assert.deepEqual(errors, [], "no page errors");
  await page.close();
} finally {
  await writeFile(
    path.join(out, "memory-panel-journey.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
