// Fault and recovery cases for a recorded responsibility, on the real UI,
// API and PostgreSQL with controlled transport (no provider calls). Faults
// are injected in the browser with network routes: denied, failed, delayed
// and lost-acknowledgement reads and writes. Usage (stack running, runtime
// env): node web/scripts/responsibility-recovery.mjs <out-dir>
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(process.argv[2]);
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
  const json = await r.json();
  return { status: r.status, body: json };
}
const cmd = () => ({
  schema_version: "workagent/v1",
  request_id: crypto.randomUUID(),
  command_id: crypto.randomUUID(),
});
const shot = (page, name) =>
  page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
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
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Two conversation hand-overs: one stays without a responsibility.
  async function handover(goal) {
    await page.goto(origin);
    await page.getByLabel("Message your agent").fill(goal);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForURL(/\/conversations\/[^/?]+$/);
    const cid = page.url().split("/").pop();
    await expect(page.locator(".msg-agent")).toHaveCount(1, {
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Record a hand-over" }).click();
    await page.getByLabel("Done when").fill("It is ready");
    await page.getByRole("button", { name: "Save paused hand-over" }).click();
    await expect(
      page.getByRole("heading", { name: "Handed over" }),
    ).toBeVisible({ timeout: 15000 });
    const id = (await api(`/conversations/${cid}`)).body.assignment_ids[0];
    cids[id] = cid;
    return id;
  }
  const cids = {};
  const plain = await handover("Keep the volunteer list tidy.");
  const aid = await handover("Help me run the volunteer briefing.");
  const late = await handover("Sort the donation receipts.");
  const respURL = `**/assignments/${aid}/responsibility`;
  const controlURL = `**/assignments/${aid}/responsibility/control`;

  // F4: confirmed absence is the service's documented answer, and only
  // then are the older controls offered; no perpetual retry of absence.
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith(`/assignments/${plain}/responsibility`)) reads++;
  });
  await page.goto(`${origin}/assignments/${plain}`);
  await expect(page.getByRole("button", { name: "Stop…" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("responsibility")).toHaveCount(0);
  const absent = await api(`/assignments/${plain}/responsibility`);
  assert.equal(absent.body.code, "unsupported_operation");
  await page.waitForTimeout(8000);
  assert.ok(reads <= 2, `absence re-read ${reads} times in 8s`);
  pass(
    "confirmed absence shows the older controls; absence isn't retried rapidly",
  );

  // F4: denied, failed and delayed reads never fall back to older controls.
  for (const [name, handler] of [
    [
      "denied",
      (route) =>
        route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            code: "not_found_or_not_authorized",
            message: "Not found or not authorized.",
            next_action: "Return to Work Home.",
            request_id: "fixture",
          }),
        }),
    ],
    [
      "unauthenticated",
      (route) =>
        route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            code: "unauthenticated",
            message: "Sign in.",
            next_action: "Sign in again.",
            request_id: "fixture",
          }),
        }),
    ],
    ["transport", (route) => route.abort("failed")],
  ]) {
    await page.route(`**/assignments/${plain}/responsibility`, handler);
    await page.goto(`${origin}/assignments/${plain}`);
    await expect(
      page.getByTestId(
        name === "transport"
          ? "responsibility-unknown"
          : "responsibility-denied",
      ),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Stop…" })).toHaveCount(0);
    await expect(page.getByText("I own")).toHaveCount(0);
    await page.unroute(`**/assignments/${plain}/responsibility`);
    pass(`${name} read offers no fallback steering`);
  }
  await page.route(`**/assignments/${plain}/responsibility`, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.goto(`${origin}/assignments/${plain}`);
  await expect(page.getByTestId("responsibility-loading")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop…" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop…" })).toBeVisible({
    timeout: 15000,
  });
  await page.unroute(`**/assignments/${plain}/responsibility`);
  pass("a delayed read offers no controls until absence is confirmed");

  // R1: an earlier "none here" that can't be re-read isn't current absence.
  // The older claims and controls go until a fresh read says "none" again.
  const reread = (id) =>
    page.waitForResponse(
      (r) => r.url().endsWith(`/assignments/${id}/responsibility`),
      { timeout: 20000 },
    );
  const staleAbsence = async (id) => {
    await page.goto(`${origin}/assignments/${id}`);
    await expect(page.getByRole("button", { name: "Stop…" })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByText("nothing has been admitted to run").first(),
    ).toBeVisible();
    await page.route(`**/assignments/${id}/responsibility`, (route) =>
      route.abort("failed"),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("responsibility-unknown")).toContainText(
      "When last read at",
      { timeout: 15000 },
    );
    await expect(page.getByRole("button", { name: "Stop…" })).toHaveCount(0);
    await expect(
      page.getByText("nothing has been admitted to run"),
    ).toHaveCount(0);
    await expect(page.getByText("I own")).toHaveCount(0);
    await page.unroute(`**/assignments/${id}/responsibility`);
  };
  await staleAbsence(plain);
  await shot(page, "r1-stale-absence");
  const back = reread(plain);
  await page
    .getByTestId("responsibility-unknown")
    .getByRole("button", { name: "Check again" })
    .click();
  await back;
  await expect(page.getByRole("button", { name: "Stop…" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("responsibility-unknown")).toHaveCount(0);
  pass("stale absence holds older controls; a fresh absence brings them back");

  await staleAbsence(late);
  const l0 = (await api(`/assignments/${late}`)).body;
  const lact = await api(`/assignments/${late}/responsibility`, {
    ...cmd(),
    expected_work_version: l0.work_version,
    current_outcome: "Receipts are sorted by month.",
    next_action: { kind: "continue_work", description: "Total each month." },
  });
  assert.equal(lact.status, 201, JSON.stringify(lact.body));
  await page
    .getByTestId("responsibility-unknown")
    .getByRole("button", { name: "Check again" })
    .click();
  await expect(page.getByTestId("responsibility")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("button", { name: "Stop…" })).toHaveCount(0);
  await expect(page.getByTestId("responsibility")).toContainText(
    "Receipts are sorted by month.",
  );
  pass("stale absence recovers to a responsibility activated meanwhile");

  // Activation by the runtime shows up on an open page without a reload (F3).
  await page.goto(`${origin}/assignments/${aid}`);
  await expect(page.getByRole("button", { name: "Stop…" })).toBeVisible({
    timeout: 15000,
  });
  const a0 = (await api(`/assignments/${aid}`)).body;
  const act = await api(`/assignments/${aid}/responsibility`, {
    ...cmd(),
    expected_work_version: a0.work_version,
    current_outcome: "A draft outline is saved.",
    next_action: { kind: "continue_work", description: "Draft the agenda." },
  });
  assert.equal(act.status, 201, JSON.stringify(act.body));
  const panel = page.getByTestId("responsibility");
  await expect(panel).toBeVisible({ timeout: 25000 });
  await expect(page.getByRole("button", { name: "Stop…" })).toHaveCount(0);
  await expect(page.getByText("can’t start work on my own")).toHaveCount(0);
  await expect(page.getByTestId("responsibility-execution")).toHaveText(
    "Not admitted to run: nothing runs in the background for it right now.",
  );
  pass("activation appears on an open page; older claims and controls go");

  // External control changes are re-read without user action (F3).
  const ext = async (operation) => {
    const v = (await api(`/assignments/${aid}/responsibility`)).body.assignment
      .work_version;
    const r = await api(`/assignments/${aid}/responsibility/control`, {
      ...cmd(),
      expected_work_version: v,
      operation,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  await ext("pause");
  await expect(panel.getByRole("heading")).toHaveText("Paused", {
    timeout: 10000,
  });
  await ext("resume");
  await expect(panel.getByRole("heading")).not.toHaveText("Paused", {
    timeout: 10000,
  });
  pass("pause and resume made elsewhere appear without a reload");

  // A failing re-read keeps a labelled snapshot and holds steering; it
  // recovers when reads succeed again.
  await page.route(respURL, (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByTestId("responsibility-observed")).toContainText(
    "Can’t reach the service",
    { timeout: 15000 },
  );
  await expect(panel.getByRole("button", { name: "Pause" })).toBeDisabled();
  await page.unroute(respURL);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByTestId("responsibility-observed")).toContainText(
    "Read at",
    { timeout: 15000 },
  );
  await expect(panel.getByRole("button", { name: "Pause" })).toBeEnabled();
  pass(
    "a failing re-read is labelled stale and holds steering until it recovers",
  );

  // F5: a lost acknowledgement keeps the exact command, survives a reload,
  // blocks other choices, and a retry sends the same command once.
  const sent = [];
  await page.route(controlURL, async (route) => {
    sent.push(route.request().postDataJSON());
    if (sent.length === 1) {
      await route.fetch(); // committed on the server...
      await route.abort("failed"); // ...but the reply is lost
    } else await route.continue();
  });
  await panel.getByRole("button", { name: "Pause" }).click();
  await expect(panel).toContainText("Your request to pause wasn’t confirmed");
  await expect(
    panel.getByRole("button", { name: "Take this back" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(panel).toContainText(
    "Your request to pause wasn’t confirmed before this page reloaded",
    { timeout: 15000 },
  );
  await expect(panel.getByRole("button", { name: "Resume" })).toHaveCount(0);
  await shot(page, "01-unconfirmed-after-reload");
  await panel.getByRole("button", { name: "Retry: pause" }).click();
  await expect(panel).toContainText("The service confirmed the pause.", {
    timeout: 15000,
  });
  await expect(panel.getByRole("heading")).toHaveText("Paused");
  assert.equal(sent.length, 2);
  assert.equal(sent[1].command_id, sent[0].command_id);
  assert.equal(sent[1].operation, "pause");
  assert.equal(sent[1].expected_work_version, sent[0].expected_work_version);
  await page.unroute(controlURL);
  pass(
    "lost acknowledgement: same command across reload, no other choice, one effect",
  );

  // Successful command with a failed re-read: the reply is shown, labelled.
  await page.route(respURL, (route) =>
    route.request().method() === "GET"
      ? route.abort("failed")
      : route.continue(),
  );
  await panel.getByRole("button", { name: "Resume" }).click();
  await expect(panel).toContainText(
    "I couldn’t re-read its current state, so what’s shown is the service’s reply.",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("responsibility-observed")).toContainText(
    "From the service’s reply; not re-read yet.",
  );
  await expect(panel.getByRole("button", { name: "Pause" })).toBeDisabled();
  await page.unroute(respURL);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(panel.getByRole("button", { name: "Pause" })).toBeEnabled({
    timeout: 15000,
  });
  pass("confirmed command with a failed re-read is labelled, steering held");

  // CAS conflict: never rebased and resent; truthful about the re-read.
  for (const reread of [true, false]) {
    const freeze = (await api(`/assignments/${aid}/responsibility`)).body;
    let mode = "freeze"; // then "live" (re-read works) or "down" (it fails)
    await page.route(respURL, (route) => {
      if (route.request().method() !== "GET") return route.continue();
      if (mode === "freeze")
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(freeze),
        });
      return mode === "live" ? route.continue() : route.abort("failed");
    });
    await ext("pause"); // changed elsewhere; the page keeps the old read
    await ext("resume");
    const posts = [];
    await page.route(controlURL, async (route) => {
      posts.push(route.request().postDataJSON());
      mode = reread ? "live" : "down";
      await route.continue();
    });
    await panel.getByRole("button", { name: "Pause" }).click();
    await expect(panel).toContainText(
      reread
        ? "This changed since you looked. Its current state is shown now"
        : "This changed since you looked, and I couldn’t re-read its current state.",
      { timeout: 15000 },
    );
    await page.waitForTimeout(1000);
    assert.equal(posts.length, 1, "a conflict is never resent");
    await page.unroute(controlURL);
    await page.unroute(respURL);
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByTestId("responsibility-observed")).toContainText(
      "Read at",
      { timeout: 15000 },
    );
    pass(`CAS conflict with ${reread ? "a successful" : "a failed"} re-read`);
  }

  // Take it back through the confirmation; nothing is left to steer.
  await page.reload();
  const takeBack = panel.getByRole("button", {
    name: "Take this back",
    exact: true,
  });
  await takeBack.click();
  await panel.getByRole("button", { name: "Don’t take this back" }).click();
  await expect(takeBack).toBeVisible();
  await expect(panel.getByRole("heading")).not.toHaveText("You took this back");
  await takeBack.click();
  await panel
    .getByRole("group", { name: "Confirm" })
    .getByRole("button", { name: "Take this back", exact: true })
    .click();
  await expect(panel.getByRole("heading")).toHaveText("You took this back", {
    timeout: 15000,
  });
  await expect(
    panel.getByRole("button", { name: /Pause|Resume|Stop/ }),
  ).toHaveCount(0);
  await expect(page.getByTestId("responsibility-execution")).toHaveText(
    "It’s back with you. Workagent isn’t holding it any more.",
  );
  await shot(page, "02-taken-back");
  pass(
    "dismissing a confirmation sends nothing; take-back leaves nothing to steer",
  );

  // F1: a runtime continuation request is never "You" and its state sits
  // under its own request, for every turn state (responses injected into the
  // real conversation read; no runtime execution happens here).
  const cid = cids[aid];
  const wakeOrigin = {
    kind: "responsibility_wake",
    assignment_id: aid,
    wake_id: "wake-fixture",
    work_version: 3,
  };
  for (const state of [
    "queued",
    "responding",
    "failed",
    "unavailable",
    "outcome_unknown",
    "cancelled",
    "replied",
  ]) {
    await page.route(`**/api/domain/**/conversations/${cid}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const real = await (await route.fetch()).json();
      const human = real.messages[0];
      const run = real.runs[0];
      real.messages.push({
        ...human,
        id: "msg-wake",
        run_id: "run-wake",
        sequence: real.messages.length + 1,
        author_kind: "system",
        evidence_origin: "runtime",
        text: "Continue the hand-over: confirm the room booking.",
        responsibility_origin: wakeOrigin,
      });
      real.runs.push({ ...run, id: "run-wake" });
      real.turns = [
        ...(real.turns ?? []),
        {
          run_id: "run-wake",
          state,
          reason: `Fixture continuation ${state}`,
          profile: "general-responses-v1",
          evidence_origin: "unverified",
          provider_observation: "not_observed",
          responsibility_origin: wakeOrigin,
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(real),
      });
    });
    await page.goto(`${origin}/conversations/${cid}`);
    const req = page.locator("#run-run-wake");
    await expect(req.getByTestId("runtime-request")).toBeVisible({
      timeout: 15000,
    });
    await expect(req).not.toContainText("You:");
    await expect(
      req.getByRole("link", { name: "Open the hand-over" }),
    ).toHaveAttribute("href", `/assignments/${aid}`);
    // The person's own first message is still theirs.
    await expect(page.locator(".msg-person").first()).toContainText("You:");
    if (state === "replied")
      await expect(req.locator(".msg-pending")).toHaveCount(0);
    else
      await expect(req.locator(".msg-pending")).toHaveAttribute(
        "data-state",
        state,
      );
    if (state === "queued") await shot(page, "03-runtime-request-queued");
    await page.unroute(`**/api/domain/**/conversations/${cid}`);
  }
  pass("runtime continuation requests: labelled, anchored, every turn state");

  // F2: every execution status worded truthfully, with its bound run.
  for (const [status, expected] of [
    ["not_admitted", "Not admitted to run"],
    ["queued", "Queued isn’t the same as started."],
    ["running", "Running isn’t the same as done."],
    ["settled", "it isn’t accepted, and the goal isn’t marked done."],
    ["blocked", "Some work may already have happened"],
  ]) {
    await page.route(respURL, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const real = await (await route.fetch()).json();
      real.lifecycle.state = "active";
      real.lifecycle.execution_status = status;
      real.lifecycle.run_id = status === "not_admitted" ? null : "run-wake";
      real.provider_execution_queued = status === "queued";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(real),
      });
    });
    await page.goto(`${origin}/assignments/${aid}`);
    const exec = page.getByTestId("responsibility-execution");
    await expect(exec).toContainText(expected, { timeout: 15000 });
    if (status === "not_admitted")
      await expect(page.getByTestId("responsibility-run")).toHaveCount(0);
    else
      await expect(page.getByTestId("responsibility-run")).toHaveAttribute(
        "href",
        `/conversations/${cid}#run-run-wake`,
      );
    await expect(page.getByText("can’t start work on my own")).toHaveCount(0);
    await expect(page.getByText("isn’t available yet")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Stop…" })).toHaveCount(0);
    if (status === "running") await shot(page, "04-execution-running");
    await page.unroute(respURL);
  }
  pass("execution statuses worded without overclaiming, linked to their run");

  // Leaving the route stops its reads.
  await page.goto(`${origin}/`);
  let after = 0;
  page.on("request", (r) => {
    if (r.url().includes("/responsibility")) after++;
  });
  await page.waitForTimeout(6000);
  assert.equal(after, 0, "reads stop when the page is left");
  pass("reads stop when the route changes");

  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "responsibility-recovery.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `${report.cases.length} responsibility recovery cases passed (controlled; no provider calls).`,
  );
} finally {
  await browser.close();
}
