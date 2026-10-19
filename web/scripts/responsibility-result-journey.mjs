// A responsibility that has prepared work reads result-first, through the
// real UI, API and PostgreSQL: what it did, what it prepared (opening each at
// its canonical conversation address), then what happens next and the
// steering, with lifecycle machinery a step away. Desktop and phone.
//
// Data: web/scripts/responsibility_result_fixture.py (real follow-through
// with the backend tests' synthetic provider transport; no live model).
// Usage: node web/scripts/responsibility-result-journey.mjs <out-dir> <rids.json>
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const out = path.resolve(process.argv[2]);
const r = JSON.parse(await readFile(process.argv[3], "utf8"));
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
const page_ = `${origin}/assignments/${r.assignment_id}?workspace=${r.workspace}`;
const noOverflow = async (page) =>
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "no horizontal scroll",
  );

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(page_);
  const prepared = page.getByTestId("responsibility-prepared");
  await expect(prepared.getByRole("link")).toHaveCount(2, { timeout: 20000 });

  // What it did, in its own recorded words, leads the page.
  await expect(page.getByTestId("responsibility-outcome")).toHaveText(
    "Prepared a brief and a second checklist. No external outcome claimed.",
  );
  // Then what it prepared, each opening where it lives.
  for (const aid of r.outputs)
    await expect(
      prepared.locator(
        `a[href="/conversations/${r.conversation_id}/artifacts/${aid}?workspace=${r.workspace}"]`,
      ),
    ).toHaveCount(1);
  await expect(prepared).toContainText("Readiness brief");
  await expect(prepared).toContainText("Readiness checklist");
  // Result before lifecycle: the prepared work comes before the panel.
  const panel = page.getByTestId("responsibility");
  assert.ok(
    await prepared.evaluate(
      (a, b) =>
        Boolean(
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      await panel.elementHandle(),
    ),
    "prepared work precedes the steering panel",
  );
  // No storage wording, no empty "Saved work" section, no repeated state.
  await expect(page.getByText("Saved in its conversation")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Saved work" })).toHaveCount(
    0,
  );
  await expect(page.getByText("Handed to Workagent")).toHaveCount(0);
  pass(
    "the page leads with what it did and what it prepared, each opening where it lives",
  );

  // What happens next, and the steering, in one place.
  await expect(panel.getByRole("heading")).toHaveText(/^Checks back /);
  await expect(page.getByTestId("responsibility-next")).toContainText(
    "Check the bound inputs later and improve the next preparation step.",
  );
  for (const name of ["Pause", "Stop", "Take this back"])
    await expect(
      panel.getByRole("button", { name, exact: true }),
    ).toBeEnabled();
  await expect(panel.getByTestId("responsibility-tell")).toHaveAttribute(
    "href",
    `/conversations/${r.conversation_id}?workspace=${r.workspace}`,
  );
  // Machinery a step away, still truthful.
  const details = panel.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(panel.getByTestId("responsibility-execution")).toHaveText(
    "Nothing is running for it right now.",
  );
  await expect(page.getByTestId("done-when")).toHaveText(
    "Done when Independently verified outcome, not a prepared document",
  );
  pass(
    "what happens next and the steering sit together; run state and finish line are in Details",
  );
  await page.screenshot({
    path: path.join(out, "01-result-first-desktop.png"),
    fullPage: true,
  });

  // Opening a prepared result reaches the work itself.
  await prepared.getByRole("link", { name: /Readiness brief/ }).click();
  await page.waitForURL(/\/conversations\/[^/]+\/artifacts\//);
  await expect(
    page.getByRole("heading", { level: 1, name: "Readiness brief" }),
  ).toBeVisible({ timeout: 20000 });
  pass("opening a prepared result reaches the work");

  // Home keeps track of it; it isn't listed as needing the person.
  await page.goto(`${origin}/`);
  const held = page
    .locator(".since-holding")
    .locator(`[data-assignment="${r.assignment_id}"]`);
  await expect(held).toHaveCount(1, { timeout: 20000 });
  await expect(
    page
      .locator(".since-ready")
      .locator(`[data-assignment="${r.assignment_id}"]`),
  ).toHaveCount(0);
  pass("Home keeps track of it rather than listing it as needing you");

  for (const width of [390, 320]) {
    const phone = await browser.newPage({ viewport: { width, height: 844 } });
    await phone.goto(page_);
    await expect(
      phone.getByTestId("responsibility-prepared").getByRole("link"),
    ).toHaveCount(2, { timeout: 20000 });
    await noOverflow(phone);
    await phone.screenshot({
      path: path.join(out, `02-result-first-${width}.png`),
      fullPage: true,
    });
    await phone.close();
  }
  pass("phone widths read result-first with no horizontal scroll");
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
