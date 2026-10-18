// From a recorded responsibility to the work, through the real UI, API and
// PostgreSQL. Responsibilities are recorded beforehand by the real worker
// with the synthetic provider transport (web/scripts/rr_fixture.py): no live
// model, so this proves mechanics and presentation, not agency.
// Usage (stack running without a worker, runtime env):
//   node web/scripts/responsibility-recording-journey.mjs <out-dir> <ids.json>
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(process.argv[2]);
const ids = JSON.parse(await readFile(process.argv[3], "utf8"));
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const base = origin + "/api/domain/v1/workspaces/local-workspace";
const headers = {
  "X-Workagent-Client": "local-ui",
  "Content-Type": "application/json",
};
async function api(p, body) {
  const r = await fetch(base + p, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
}
const cmd = () => ({
  schema_version: "workagent/v1",
  request_id: crypto.randomUUID(),
  command_id: crypto.randomUUID(),
});
const report = { provider_calls: "not_performed", cases: [] };
const pass = (name) => {
  report.cases.push(name);
  console.log("PASS", name);
};
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const shot = (page, name) =>
  page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
const noOverflow = async (page) =>
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "no horizontal page scroll",
  );
const noDuplicateIds = async (page) =>
  assert.deepEqual(
    await page.evaluate(() => {
      const seen = new Set();
      const dup = [];
      for (const el of document.querySelectorAll("[id]")) {
        if (seen.has(el.id)) dup.push(el.id);
        else seen.add(el.id);
      }
      return dup;
    }),
    [],
  );
const row = (page, aid) => page.locator(`a.work-row[data-assignment="${aid}"]`);

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const sends = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/messages$/.test(new URL(r.url()).pathname))
      sends.push(r.url());
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const {
    waiting,
    active,
    no_explanation: quiet,
    other_workspace: other,
  } = ids;

  // Receipts and current records agree before anything changes.
  const receipt = (await api(`/conversations/${waiting.conversation_id}`)).body
    .runs;
  assert.ok(receipt, "conversation readable");
  const before = (
    await api(`/assignments/${waiting.assignment_id}/responsibility`)
  ).body;
  assert.equal(before.lifecycle.state, "waiting_person");
  assert.equal(before.lifecycle.execution_status, "not_admitted");

  // Home: canonical lifecycle decides the group and the words.
  await page.goto(origin);
  // Wait for the current records, not the first summary.
  for (const a of [waiting, active, quiet])
    await expect(row(page, a.assignment_id)).toHaveAttribute(
      "data-hold",
      "ready",
      { timeout: 15000 },
    );
  await expect(row(page, waiting.assignment_id)).toBeVisible();
  await expect(
    page
      .locator(".since-ready")
      .locator(`[data-assignment="${waiting.assignment_id}"]`),
  ).toHaveCount(1);
  await expect(row(page, waiting.assignment_id)).toContainText(
    "Keep the venue hand-off current",
  );
  await expect(row(page, waiting.assignment_id)).toContainText(
    "Waiting for a person",
  );
  await expect(row(page, waiting.assignment_id)).toContainText(
    "Nothing runs for it right now.",
  );
  // Each says what it's waiting on, or what it does next, from its record.
  await expect(
    row(page, waiting.assignment_id).getByTestId("hold-next"),
  ).toHaveText("The venue has not replied.");
  const holding = page.locator(".since-holding");
  await holding.locator("summary").click();
  await expect(
    holding.locator(`[data-assignment="${active.assignment_id}"]`),
  ).toContainText("Recorded as yours to carry forward");
  await expect(
    holding.locator(`[data-assignment="${active.assignment_id}"]`),
  ).not.toContainText(/Running|Working/);
  await expect(
    holding
      .locator(`[data-assignment="${active.assignment_id}"]`)
      .getByTestId("hold-next"),
  ).toHaveText("Next: Draft the first rota.");
  await expect(page.getByText("Track the other team budget")).toHaveCount(0);
  // Steering sits beside each held responsibility: say what to change in its
  // conversation (the reply box is ready, nothing is sent), or pause, resume
  // or stop it on its page.
  const steerOf = (aid) =>
    page
      .locator(`li:has(> a.work-row[data-assignment="${aid}"])`)
      .getByTestId("steer");
  for (const a of [waiting, active])
    await expect(steerOf(a.assignment_id)).toBeVisible();
  await noDuplicateIds(page);
  await shot(page, "01-home-desktop");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    await shot(page, `02-home-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const sendsBefore = sends.length;
  await steerOf(waiting.assignment_id)
    .getByRole("link", { name: /^Steer “Keep the venue hand-off current/ })
    .click();
  await page.waitForURL(
    new RegExp(`/conversations/${waiting.conversation_id}\\?.*#follow-up$`),
  );
  await expect(page.getByLabel("Continue the conversation")).toBeFocused({
    timeout: 15000,
  });
  assert.equal(sends.length, sendsBefore, "steering sends nothing by itself");
  await page.goBack();
  await page.locator(".since-holding summary").click();
  await steerOf(active.assignment_id)
    .getByRole("link", { name: /^Pause or stop “Prepare the volunteer rota/ })
    .click();
  await page.waitForURL(
    new RegExp(`/assignments/${active.assignment_id}\\?.*#responsibility$`),
  );
  await expect(page.getByTestId("responsibility")).toBeInViewport({
    timeout: 15000,
  });
  await expect(
    page.getByTestId("responsibility").getByRole("button", { name: "Pause" }),
  ).toBeVisible();
  await page.goto(origin);
  pass(
    "Home groups recorded responsibilities by their current lifecycle; held is not running; another workspace never appears; steering sits beside each one",
  );

  // The conversation: the receipt names the work and links to it; the turn
  // says a responsibility was recorded, never a calculation.
  await page.goto(`${origin}/conversations/${waiting.conversation_id}`);
  const rcpt = page.getByTestId("recording-receipt");
  await expect(rcpt).toHaveCount(1, { timeout: 15000 });
  const link = rcpt.getByRole("link", {
    name: "Keep the venue hand-off current",
  });
  await expect(link).toHaveAttribute(
    "href",
    `/assignments/${waiting.assignment_id}?workspace=local-workspace`,
  );
  await expect(rcpt).toContainText("Recorded as waiting for a person");
  await expect(page.getByTestId("turn-outcome")).toContainText(
    "Responsibility recorded",
  );
  await expect(page.getByText(/calculated/i)).toHaveCount(0);
  const handed = page.locator(
    `a.work-row[data-assignment="${waiting.assignment_id}"]`,
  );
  await expect(handed).toContainText("Keep the venue hand-off current");
  await expect(handed).toContainText("Waiting for a person");
  await expect(handed.getByTestId("hold-next")).toHaveText(
    "The venue has not replied.",
  );
  await expect(
    page.getByRole("link", {
      name: "Where it was recorded in this conversation",
    }),
  ).toHaveAttribute("href", `#run-${waiting.run_id}`);
  await expect(page.locator(`#run-${waiting.run_id}`)).toHaveCount(1);
  await noDuplicateIds(page);
  await shot(page, "03-conversation-receipt");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    await shot(page, `04-conversation-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Keyboard: the receipt link takes focus and opens the work with Enter.
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForURL(`**/assignments/${waiting.assignment_id}**`);
  pass(
    "the conversation shows a named receipt link, the recording (not a calculation), and the turn it came from; keyboard opens it",
  );

  // The work: current record, no document claims, no provenance guess.
  const panel = page.getByTestId("responsibility");
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel.getByRole("heading")).toHaveText("Waiting for a person");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Keep the venue hand-off current",
  );
  await expect(
    page.getByText("No documents or files are attached to it yet."),
  ).toBeVisible();
  await expect(page.getByText("No results were saved.")).toHaveCount(0);
  await page.getByText("What I checked", { exact: true }).click();
  await expect(page.getByText("No run is recorded for it.")).toBeVisible();
  await expect(page.getByText("not a live agent run")).toHaveCount(0);
  await shot(page, "05-work-desktop");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    await shot(page, `06-work-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  pass("the work page reads the current record: no document or run claims");

  // Take it back through the existing control; the receipt stays historical.
  await panel
    .getByRole("button", { name: "Take this back", exact: true })
    .click();
  await panel
    .getByRole("group", { name: "Confirm" })
    .getByRole("button", { name: "Take this back", exact: true })
    .click();
  await expect(panel.getByRole("heading")).toHaveText("You took this back");
  const after = (
    await api(`/assignments/${waiting.assignment_id}/responsibility`)
  ).body;
  assert.equal(after.lifecycle.state, "taken_over");
  const turn = (
    await api(`/conversations/${waiting.conversation_id}`)
  ).body.turns.find((t) => t.run_id === waiting.run_id);
  assert.equal(turn.responsibility_recording.state, "waiting_person");
  assert.equal(
    turn.responsibility_recording.work_version,
    before.assignment.work_version,
  );
  await page.goto(`${origin}/conversations/${waiting.conversation_id}`);
  await expect(page.getByTestId("recording-receipt")).toContainText(
    "Recorded as waiting for a person",
  );
  await expect(
    page.locator(`a.work-row[data-assignment="${waiting.assignment_id}"]`),
  ).toContainText("You took this back");
  await page.goto(origin);
  await expect(
    page
      .locator(".since-stopped")
      .locator(`[data-assignment="${waiting.assignment_id}"]`),
  ).toHaveCount(1, { timeout: 15000 });
  // Taken back: nothing left to steer.
  await expect(steerOf(waiting.assignment_id)).toHaveCount(0);
  pass(
    "taking it back changes the current record everywhere; the turn's receipt stays as recorded",
  );

  // Pause made elsewhere: Home follows the record, not the coarse state.
  const v = (await api(`/assignments/${active.assignment_id}/responsibility`))
    .body.assignment.work_version;
  const paused = await api(
    `/assignments/${active.assignment_id}/responsibility/control`,
    {
      ...cmd(),
      expected_work_version: v,
      operation: "pause",
    },
  );
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  await page.reload();
  await page.locator(".since-holding summary").click();
  await expect(row(page, active.assignment_id)).toContainText("Paused", {
    timeout: 15000,
  });
  pass("a pause made elsewhere shows on Home from the current record");

  // No final explanation: the receipt still shows, under the request.
  await page.goto(`${origin}/conversations/${quiet.conversation_id}`);
  const quietReceipt = page.getByTestId("recording-receipt");
  await expect(quietReceipt).toBeVisible({ timeout: 15000 });
  await expect(
    quietReceipt.getByRole("link", { name: "Follow up on the catering quote" }),
  ).toBeVisible();
  await expect(
    page.locator(`#run-${quiet.run_id}`).getByTestId("recording-receipt"),
  ).toHaveCount(1);
  pass("with no final explanation, the receipt shows under the request");

  // Unreadable and refused reads are said as such, never as "nothing here".
  for (const [name, handler, label] of [
    ["unknown", (r) => r.abort("failed"), "Couldn’t check"],
    [
      "denied",
      (r) =>
        r.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            code: "not_found_or_not_authorized",
            message: "Not found or not authorized.",
            next_action: "Return to Work Home.",
            request_id: "fixture",
          }),
        }),
      "Not available",
    ],
  ]) {
    await page.route(
      `**/assignments/${active.assignment_id}/responsibility`,
      handler,
    );
    await page.goto(origin);
    await expect(row(page, active.assignment_id)).toContainText(label, {
      timeout: 15000,
    });
    await page.unroute(`**/assignments/${active.assignment_id}/responsibility`);
    pass(`a ${name} read shows "${label}" on Home`);
  }

  // Another person's workspace: its work can't be opened here.
  const denied = await api(
    `/assignments/${other.assignment_id}/responsibility`,
  );
  assert.equal(denied.status, 404);
  await page.goto(`${origin}/assignments/${other.assignment_id}`);
  await expect(page.getByText("Track the other team budget")).toHaveCount(0);
  pass("another workspace's responsibility can't be read or opened");

  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "responsibility-recording.json"),
    JSON.stringify({ ...report, ids }, null, 2),
  );
} finally {
  await browser.close();
}
