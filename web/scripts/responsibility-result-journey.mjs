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
import { scopedHeaders } from "./lib/scope.mjs";

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
  // It's labelled as the latest recorded note, with the time from
  // this assignment's own observation in the conversation's work snapshot,
  // or "time not recorded"; it sits apart from what's prepared.
  const snap = await (
    await fetch(
      `${origin}/api/domain/v1/workspaces/${r.workspace}/work-snapshot?conversation_id=${r.conversation_id}`,
      {
        headers: await scopedHeaders(origin, {
          "X-Workagent-Client": "local-ui",
        }),
      },
    )
  ).json();
  const obs = snap.responsibility?.find(
    (x) => x.assignment_id === r.assignment_id,
  )?.historical_observation;
  const note = page.getByTestId("latest-note");
  await expect(note).toContainText("Latest recorded note");
  await expect(note).toHaveAttribute(
    "data-time",
    obs?.observed_at ? "known" : "unknown",
    { timeout: 15000 },
  );
  if (!obs?.observed_at) await expect(note).toContainText("time not recorded");
  await expect(prepared.getByTestId("latest-note")).toHaveCount(0);
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

  // The snapshot can't be read: the record's note stays, saying its time
  // couldn't be checked (not "not recorded"); no read time stands in.
  await page.route(/\/work-snapshot(\?|$)/, (route) => route.abort("failed"));
  await page.goto(page_);
  const unread = page.getByTestId("latest-note");
  await expect(unread).toHaveAttribute("data-time", "unchecked", {
    timeout: 20000,
  });
  await expect(unread).toContainText("time couldn’t be checked");
  await expect(page.getByTestId("responsibility-outcome")).toHaveText(
    "Prepared a brief and a second checklist. No external outcome claimed.",
  );
  await page.unroute(/\/work-snapshot(\?|$)/);
  pass(
    "the latest recorded note is labelled with its own observation's time, or time not recorded; an unreadable snapshot keeps the note, saying its time couldn't be checked, with no time borrowed; it sits apart from what's prepared",
  );

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

  // A long recorded outcome leads with its first sentence on a phone, so the
  // prepared work and the steering stay in view; the full text, uncertainty
  // included, is one click away, word for word. (Only the outcome text of
  // the real reads is lengthened, in the browser.)
  const LONG =
    "Prepared a brief and a second checklist from the bound inputs and saved both in the conversation. " +
    "Publication checked shape only; nobody has reviewed the wording, and no external outcome is claimed. " +
    "The next pass will compare both against the readiness criteria once they are supplied, and say what changed.";
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await phone.route(
    /\/assignments\/[^/]+\/responsibility(\?|$)/,
    async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.lifecycle.current_outcome = LONG;
      await route.fulfill({ response: res, json: body });
    },
  );
  // The note shown is the snapshot's own observation for this assignment
  // when there is one, so lengthen it there too, as the service would.
  await phone.route(/\/work-snapshot(\?|$)/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const x of body.responsibility ?? [])
      if (x.assignment_id === r.assignment_id && x.historical_observation)
        x.historical_observation.text = LONG;
    await route.fulfill({ response: res, json: body });
  });
  await phone.goto(page_);
  const outcome = phone.getByTestId("responsibility-outcome");
  await expect(outcome).toContainText(
    "Prepared a brief and a second checklist from the bound inputs and saved both in the conversation.",
    { timeout: 20000 },
  );
  await expect(outcome).not.toContainText("Publication checked shape only");
  const firstLink = phone
    .getByTestId("responsibility-prepared")
    .getByRole("link")
    .first();
  const box = await firstLink.boundingBox();
  assert.ok(
    box && box.y + box.height <= 844,
    "a prepared result is on the first screen",
  );
  const pause = await phone
    .getByTestId("responsibility")
    .getByRole("button", { name: "Pause", exact: true })
    .boundingBox();
  assert.ok(
    pause && pause.y + pause.height <= 844,
    "steering is on the first screen",
  );
  await phone.screenshot({ path: path.join(out, "03-long-outcome-390.png") });
  const toggle = phone.getByTestId("responsibility-outcome-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await phone.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(outcome).toContainText(LONG);
  await noOverflow(phone);
  await phone.screenshot({
    path: path.join(out, "04-long-outcome-expanded-390.png"),
  });
  await phone.close();
  pass(
    "a long outcome leads with its first sentence on a phone; all of it is one click away",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
