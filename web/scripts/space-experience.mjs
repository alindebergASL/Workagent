// A project Space through the real UI, API and PostgreSQL: what it's for,
// where it stands, its work, one conversation beside it, and what survives
// reloads, layout changes and lost connections. Example projects are written
// beforehand by the real worker with the synthetic provider transport
// (web/scripts/space_demo_fixture.py): no live model, so this proves mechanics
// and presentation, not agency or usefulness. Run without a worker
// (sends are admitted and stay queued); the build sets
// NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1 and NEXT_PUBLIC_WORKAGENT_DEMO_MODE=1.
// Usage: node web/scripts/space-experience.mjs <out-dir> <ids.json>
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(process.argv[2]);
const ids = JSON.parse(await readFile(process.argv[3], "utf8"));
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const ws = ids.workspace;
const base = `${origin}/api/domain/v1/workspaces/${ws}`;
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
const noOverflow = async (page) => {
  const wide = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth) return [];
    return [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 8)
      .map((el) => `${el.tagName}.${el.className}`);
  });
  assert.deepEqual(wide, [], "no horizontal page scroll");
};
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
// The share of an image's pixels that are dark (text, controls): about 0 for
// an empty box, well above it once a view is drawn.
const inkIn = async (png) => {
  const scratch = await browser.newPage();
  try {
    return await scratch.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i] + d[i + 1] + d[i + 2] < 384) dark++;
      return dark / (d.length / 4);
    }, png.toString("base64"));
  } finally {
    await scratch.close();
  }
};
// Words that would mean internal machinery leaked into the work itself.
const JARGON =
  /grant|schema|fixture|CONTROLLED|Model-selected|exact target|run_id|general Space chat|Agent identified|Human saved|Workspace context/;

const {
  conversation_id: cid,
  plan_id: planId,
  budget_id: budgetId,
} = ids.workshop;
const spaceUrl = `${origin}/spaces/${ws}/work/${cid}`;

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const posts = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      r.url().endsWith(`/conversations/${cid}/messages`)
    )
      posts.push(r.postDataJSON());
  });
  const box = page.getByLabel("Ask, or ask for a change", { exact: true });
  const send = page
    .locator(".peek-ask")
    .getByRole("button", { name: "Send", exact: true });
  const about = page.getByTestId("reply-about");
  const next = page.getByTestId("space-next");
  const item = (aid) =>
    page.locator(`.space-work-item[data-artifact="${aid}"]`);

  // Leave and return: Spaces lists projects by what they're for.
  await page.goto(`${origin}/spaces`);
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  const list = page.getByRole("region", { name: "Projects and workflows" });
  await expect(page.getByRole("link", { name: /Autumn workshop/ })).toBeVisible(
    { timeout: 15000 },
  );
  await expect(
    page.getByRole("link", { name: /Monthly newsletter/ }),
  ).toContainText("Ongoing workflow");
  // Each workspace's projects are listed, and each opens in its own workspace.
  await expect(page.locator(".work-row")).toHaveCount(4);
  await expect(
    page.getByRole("link", { name: /Spring open day/ }),
  ).toHaveAttribute(
    "href",
    `/spaces/${ids.second.workspace}/work/${ids.second.conversation_id}`,
  );
  assert.equal(list ? true : true, true);
  await shot(page, "01-spaces");
  await page.getByRole("link", { name: /Autumn workshop/ }).click();
  await page.waitForURL(`**/work/${cid}`);
  pass(
    "Spaces lists each project by name, purpose and kind; an ordinary chat isn't listed; the demonstration label shows",
  );

  // Purpose, where it stands and the next step, from the records.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Autumn workshop",
  );
  await expect(page.locator(".space-goal")).toContainText(
    "within a €9,000 budget",
  );
  await expect(next).toHaveText(
    "A change to “Budget” is waiting for your review.",
    { timeout: 15000 },
  );
  await expect(
    page.getByRole("link", { name: "Review the change to Budget" }),
  ).toHaveAttribute(
    "href",
    `/conversations/${cid}/artifacts/${budgetId}?workspace=${ws}`,
  );
  await expect(page.locator(".space-standing")).toContainText(
    "Get written confirmation of the venue booking",
  );
  await expect(page.locator(".space-standing")).toContainText(
    "Waiting for a person",
  );
  // Nothing is chosen for the person: a reply is about the whole project.
  await expect(item(budgetId)).toHaveAttribute("aria-pressed", "false");
  await expect(item(planId)).toHaveAttribute("aria-pressed", "false");
  await expect(about).toContainText("About: the whole project");
  await expect(page.getByTestId("choose-work")).toBeVisible();
  // A proposal made for an earlier version is outdated, not one to apply.
  await expect(item(planId)).toContainText("Outdated proposal");
  await expect(item(planId)).not.toContainText("Change to review");
  await expect(page.locator(".space-standing")).toContainText(
    "was made for an earlier version, so it can’t be applied as is",
  );
  await item(budgetId).click();
  await expect(item(budgetId)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".space-proposal")).toContainText(
    "It adds a row: Catering.",
  );
  await expect(about).toContainText("About: Budget");
  await item(planId).click();
  await expect(page.locator(".space-proposal-outdated")).toContainText(
    "earlier version of this work",
  );
  await expect(page.locator(".space-proposal")).toHaveCount(0);
  await item(budgetId).click();
  // Every control is a comfortable target (24px minimum), checked in layout.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll(".space-page button, .space-page a.btn")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => [el.textContent.trim(), el.getBoundingClientRect()])
      .filter(([, r]) => r.height < 24 || r.width < 24)
      .map(([t, r]) => `${t} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
  assert.deepEqual(small, [], "no control smaller than 24px");
  const text = await page.locator("main").innerText();
  assert.ok(!JARGON.test(text), `no internal wording: ${text.match(JARGON)}`);
  await noDuplicateIds(page);
  await shot(page, "02-space-desktop");
  pass(
    "the Space opens on its purpose, the next step and what needs the person, from saved records, with no internal wording; nothing is chosen for the person; an outdated proposal isn't offered to apply; every control is at least 24px",
  );

  // Keyboard: choose other work; the reply follows it; focus lands on it.
  await item(planId).focus();
  await page.keyboard.press("Enter");
  await expect(item(planId)).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(new RegExp(`work=${planId}`));
  // The chosen work opens in place under its own entry, once: focus stays on
  // the entry the person chose, which names the opened content.
  await expect(item(planId)).toBeFocused();
  await expect(item(planId)).toHaveAttribute("aria-controls", "space-selected");
  const opened = page.locator("#space-selected");
  await expect(opened).toBeVisible();
  await expect(opened).toHaveAttribute(
    "aria-labelledby",
    `space-item-${planId}`,
  );
  await expect(
    page
      .locator("li")
      .filter({ has: item(planId) })
      .locator("#space-selected"),
  ).toHaveCount(1);
  await expect(page.locator(".space-work.card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Workshop plan" }),
  ).toHaveCount(0);
  await expect(about).toContainText("About: Workshop plan");
  pass(
    "keyboard selects work; it opens once, in place under its entry, and focus stays there; the reply is now about it",
  );

  // A draft and the selection survive a reload.
  await box.fill("Move the show-and-tell to the morning of day two.");
  await page.reload();
  await expect(box).toHaveValue(
    "Move the show-and-tell to the morning of day two.",
    { timeout: 15000 },
  );
  await expect(item(planId)).toHaveAttribute("aria-pressed", "true");
  await expect(about).toContainText("About: Workshop plan");
  pass("a typed reply and the selected work survive a reload");

  // A background refresh finds the project's work list changed (here, the
  // same work in a new order) while re-reading that work is slow. The choice
  // stays the person's: sending waits, by any path, and nothing goes out
  // about "the whole project" in the meantime.
  {
    let releaseWork;
    const workReleased = new Promise((r) => (releaseWork = r));
    const artifactReads = "**/api/domain/**/artifacts/**";
    let held = 0;
    await page.route(artifactReads, async (route) => {
      if (route.request().method() === "GET") {
        held += 1;
        await workReleased;
      }
      return route.continue();
    });
    const detailReads = `**/work-areas/${cid}`;
    await page.route(detailReads, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.artifact_ids = [...body.artifact_ids].reverse();
      return route.fulfill({ response, json: body });
    });
    const sentBefore = posts.length;
    await page.getByRole("button", { name: "Refresh this project" }).click();
    // Wait until the re-read of the changed list is actually held.
    await expect.poll(() => held, { timeout: 15000 }).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await box.press("Control+Enter");
    await page.waitForTimeout(500);
    assert.equal(
      posts.length,
      sentBefore,
      "nothing sent while the choice is re-read",
    );
    await expect(page.locator('[data-state="paused"]')).toContainText(
      "Checking the work you chose",
    );
    await expect(send).toBeDisabled();
    await expect(about).toContainText("About: Workshop plan");
    await expect(box).toHaveValue(
      "Move the show-and-tell to the morning of day two.",
    );
    releaseWork();
    await expect(page.locator('[data-state="paused"]')).toHaveCount(0, {
      timeout: 15000,
    });
    await expect(about).toContainText("About: Workshop plan");
    await page.unroute(detailReads);
    await page.unroute(artifactReads);
    assert.equal(posts.length, sentBefore);
  }
  pass(
    "a background change to the work list while the chosen work is re-read keeps the choice: sending waits by button and keys, never falls back to the whole project",
  );

  // Sending names the selected work's exact saved version.
  const plan = (await api(`/artifacts/${planId}`)).body;
  let before = posts.length;
  await send.click();
  await expect(box).toHaveValue("", { timeout: 15000 });
  assert.equal(posts.length, before + 1);
  assert.deepEqual(posts.at(-1).target, {
    artifact_id: planId,
    revision_id: plan.current_revision_id,
    body_hash: plan.current_revision.body_hash,
  });
  await expect(page.locator(".space-view")).toContainText(
    /Your latest message is waiting for Workagent|Workagent is replying/,
    { timeout: 15000 },
  );
  pass(
    "a reply carries the selected work's exact saved version; the waiting turn shows as underway, not as done",
  );

  // About the whole project: no target.
  await page
    .getByRole("button", { name: /Stop replying about Workshop plan/ })
    .click();
  await expect(about).toContainText("About: the whole project");
  await expect(page).not.toHaveURL(/work=/);
  await box.fill("What's still undecided?");
  before = posts.length;
  await box.press("Control+Enter");
  await expect(box).toHaveValue("", { timeout: 15000 });
  assert.equal(posts.at(-1).target, null);
  pass(
    "clearing the selection makes the reply about the whole project; Ctrl+Enter sends it with no target",
  );

  // An unconfirmed send keeps what it was about, even if the selection changes.
  await item(budgetId).click();
  await expect(about).toContainText("About: Budget");
  let lose = true;
  const msgUrl = `**/conversations/${cid}/messages`;
  await page.route(msgUrl, async (route) => {
    if (!lose) return route.continue();
    lose = false;
    const r = await route.fetch();
    assert.ok(r.ok());
    return route.abort("failed");
  });
  await box.fill("Round the catering line to the nearest ten euros.");
  before = posts.length;
  await send.click();
  await expect(
    page.getByText("Your last send wasn’t confirmed.", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await item(planId).click();
  await expect(about).toContainText("About: Budget");
  await send.click();
  await expect(box).toHaveValue("", { timeout: 15000 });
  const [lost, replay] = posts.slice(before);
  assert.equal(replay.command_id, lost.command_id);
  assert.deepEqual(replay.target, lost.target);
  assert.equal(replay.target.artifact_id, budgetId);
  await page.unroute(msgUrl);
  await expect(about).toContainText("About: Workshop plan");
  pass(
    "an unconfirmed send shows and replays exactly what it was about, though the selection moved",
  );

  // Can't confirm the current state: nothing sends by any path; drafting goes on.
  const readUrl = `**/work-areas/${cid}`;
  await page.route(readUrl, (r) =>
    r.request().method() === "GET" ? r.abort("failed") : r.continue(),
  );
  await expect(page.locator('[data-state="reconnecting"]').first()).toBeVisible(
    { timeout: 15000 },
  );
  await box.fill("Held while offline");
  before = posts.length;
  await expect(send).toBeDisabled();
  await box.press("Control+Enter");
  await page.waitForTimeout(500);
  assert.equal(posts.length, before);
  await shot(page, "03-space-reconnecting");
  await page.unroute(readUrl);
  await expect(page.locator('[data-state="reconnecting"]')).toHaveCount(0, {
    timeout: 15000,
  });
  await page.waitForTimeout(2500);
  assert.equal(posts.length, before);
  await expect(box).toHaveValue("Held while offline");
  await box.fill("");
  pass(
    "while the project can't be re-read, sending is held by button and keys; reconnecting sends nothing by itself",
  );

  // The person names the project; an edit survives reload; a stale save is refused, not overwritten.
  await page.getByRole("button", { name: "Edit name and purpose" }).click();
  await page
    .getByLabel("What it’s for", { exact: true })
    .fill(
      "Run a two-day workshop for 40 people in Leeds, under €9,000, with a remote seat if affordable.",
    );
  // The project changes elsewhere while the draft is open, and only then
  // does the page reload: the restored draft must still be checked against
  // the version it started from, not the one read after the reload.
  const now = (await api(`/work-areas/${cid}`)).body.conversation;
  const meanwhile = await api(`/work-areas/${cid}`, {
    schema_version: "workagent/v1",
    request_id: crypto.randomUUID(),
    command_id: crypto.randomUUID(),
    expected_work_version: now.work_version,
    title: "Autumn workshop",
    goal: now.work_area.goal,
    kind: "project",
  });
  await page.reload();
  await expect(page.getByLabel("What it’s for", { exact: true })).toHaveValue(
    /remote seat if affordable/,
    { timeout: 15000 },
  );
  assert.equal(meanwhile.status, 200, JSON.stringify(meanwhile.body));
  // The re-read after the refusal is slow (held until released here), and the
  // person cancels, reopens and tries to save before it lands. That save must
  // not go out against the version already refused.
  const detailUrl = `**/work-areas/${cid}`;
  let release;
  const released = new Promise((r) => (release = r));
  let delayed = 0;
  await page.route(detailUrl, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    delayed += 1;
    await released;
    return route.continue();
  });
  const saves = [];
  const onSave = (r) => {
    if (
      r.request().method() === "POST" &&
      r.url().endsWith(`/work-areas/${cid}`)
    )
      saves.push(r.status());
  };
  page.on("response", onSave);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("This project changed since you started editing.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel("What it’s for", { exact: true })).toHaveValue(
    /remote seat if affordable/,
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Edit name and purpose" }).click();
  await page
    .getByLabel("What it’s for", { exact: true })
    .fill(
      "Run a two-day workshop for 40 people in Leeds, under €9,000, with a remote seat if affordable.",
    );
  const save = page.getByRole("button", { name: "Save", exact: true });
  // Try to save before the re-read lands, as a quick person would.
  await save.click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(500);
  assert.deepEqual(saves, [409], "no second save while the re-read is pending");
  await expect(page.getByTestId("area-rechecking")).toBeVisible();
  await expect(save).toBeDisabled();
  assert.ok(delayed >= 1, "the re-read was actually held");
  // Release the held re-read; later reads pass straight through.
  release();
  await expect(page.getByTestId("area-rechecking")).toHaveCount(0, {
    timeout: 15000,
  });
  await expect(page.getByLabel("What it’s for", { exact: true })).toHaveValue(
    /remote seat if affordable/,
  );
  await save.click();
  await expect(page.locator(".space-goal")).toContainText(
    "remote seat if affordable",
    { timeout: 15000 },
  );
  page.off("response", onSave);
  await page.unroute(detailUrl);
  assert.deepEqual(saves, [409, 200], "one refused save, then one that landed");
  const saved = (await api(`/work-areas/${cid}`)).body.conversation.work_area;
  assert.equal(saved.origin, "human");
  assert.match(saved.goal, /remote seat/);
  pass(
    "the purpose is the person's to edit; a draft survives reload; a stale save is refused with the text kept; saving waits for a slow re-read even across cancel and reopen, then lands once; the saved goal reads back",
  );

  // The real control: review and apply the proposed change; the Space follows the record.
  await page.getByRole("link", { name: "Review the change to Budget" }).click();
  await page.waitForURL(`**/artifacts/${budgetId}**`);
  await expect(
    page.getByRole("link", { name: "← Autumn workshop" }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Apply proposed version" }).click();
  await expect(
    page.getByRole("button", { name: "Apply proposed version" }),
  ).toHaveCount(0, { timeout: 15000 });
  await page.getByRole("link", { name: "← Autumn workshop" }).click();
  await page.waitForURL(`**/work/${cid}**`);
  await expect(next).toContainText("earlier version", { timeout: 15000 });
  await expect(page.locator(".space-standing")).toContainText(
    "Get written confirmation of the venue booking",
  );
  await expect(item(budgetId)).not.toContainText("Change to review");
  await item(budgetId).click();
  await expect(page.locator(".space-work")).toContainText("Catering");
  pass(
    "applying the change through the work's own control updates the Space: the review is gone and the next step moves on",
  );

  // Phone: work first; switching panes keeps the draft; "Ask about this" goes to the reply box.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(spaceUrl);
    await expect(item(planId)).toBeVisible({ timeout: 15000 });
    await expect(next).not.toContainText("Checking");
    await noOverflow(page);
    await shot(page, `04-space-${width}`);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await box.fill("Draft kept across panes");
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await expect(next).toBeVisible();
  await item(planId).click();
  await page.getByRole("button", { name: "Ask about this" }).click();
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("Draft kept across panes");
  await expect(about).toContainText("About: Workshop plan");
  await noOverflow(page);
  await shot(page, "05-space-390-conversation");
  await box.fill("");
  pass(
    "on a phone the work comes first; switching panes keeps the draft; Ask about this opens the reply box about that work",
  );

  // An answer shows the work it made, with one next step. Earlier mentions
  // of the same work are one line (a preview there would show today's
  // version, not that one's). How it ran is one "Details" per answer.
  for (const [w, h] of [
    [1440, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${origin}/conversations/${cid}?workspace=${ws}`);
    const cards = page.locator(".work-card");
    await expect(cards.first()).toBeVisible({ timeout: 15000 });
    const budgetCards = page.locator(`.work-card[data-artifact="${budgetId}"]`);
    const planCards = page.locator(`.work-card[data-artifact="${planId}"]`);
    await expect(budgetCards.last()).not.toHaveClass(/brief/);
    await expect(budgetCards.last()).toContainText("Venue, two days");
    await expect(budgetCards.first()).toHaveClass(/brief/);
    await expect(budgetCards.first().locator("table")).toHaveCount(0);
    await expect(planCards.last()).toContainText("Two days, 40 people");
    await expect(planCards.last()).toContainText("Not checked yet");
    await expect(planCards.first()).not.toContainText("Not checked yet");
    // Routine machinery is folded away; the receipt still says what was saved.
    await expect(page.getByText("At recording, the outcome")).toBeHidden();
    await expect(page.getByText("The message as recorded")).toHaveCount(0);
    await expect(
      page.getByText("Get written confirmation of the venue booking").first(),
    ).toBeVisible();
    const replies = page.locator(".msg-agent");
    const n = await replies.count();
    for (let i = 0; i < n; i++)
      await expect(
        replies.nth(i).locator("summary", { hasText: /./ }),
      ).toHaveCount(1);
    await noOverflow(page);
    await shot(page, `07-conversation-${w}`);
  }
  pass(
    "an answer shows the work it made with one next step; earlier mentions are one line; how it ran is one Details; it fits a phone",
  );

  // "Refresh conversation" re-reads the work the cards show, not only the
  // messages: a changed version, a refusal and a failed re-check each show,
  // with no new message, and the draft is kept.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/conversations/${cid}?workspace=${ws}`);
  const latestBudget = page
    .locator(`.work-card[data-artifact="${budgetId}"]`)
    .last();
  await expect(latestBudget).toContainText("Venue, two days", {
    timeout: 15000,
  });
  await page.locator("#follow-up").fill("Draft kept through refreshes");
  const budgetRead = new RegExp(`/artifacts/${budgetId}(\\?|$)`);
  let mode = "changed";
  let budgetReads = 0;
  await page.route(budgetRead, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    budgetReads++;
    if (mode === "failed") return route.abort("failed");
    if (mode === "denied")
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          code: "not_found_or_not_authorized",
          message: "Not found.",
          request_id: "synthetic-denial",
          next_action: "Check access.",
          details: {},
        }),
      });
    const r = await route.fetch();
    const body = await r.json();
    body.current_revision.body.title = "Budget (revised elsewhere)";
    return route.fulfill({ response: r, json: body });
  });
  const refreshBtn = page.getByRole("button", { name: "Refresh conversation" });
  await refreshBtn.click();
  await expect(latestBudget).toContainText("Budget (revised elsewhere)");
  assert.ok(budgetReads > 0, "an explicit refresh re-reads the work");
  mode = "denied";
  await refreshBtn.click();
  await expect(latestBudget.getByTestId("work-card-unavailable")).toBeVisible();
  await expect(latestBudget.locator("table")).toHaveCount(0);
  await expect(latestBudget).not.toContainText("Venue, two days");
  mode = "changed";
  await refreshBtn.click();
  await expect(latestBudget).toContainText("Venue, two days");
  mode = "failed";
  await refreshBtn.click();
  await expect(latestBudget.getByTestId("work-card-unconfirmed")).toBeVisible({
    timeout: 15000,
  });
  await expect(latestBudget).toContainText("Venue, two days");
  await page.unroute(budgetRead);
  await expect(page.locator("#follow-up")).toHaveValue(
    "Draft kept through refreshes",
  );
  // Mixed outcomes: one card's work is refused while a sibling's read (its
  // work, or its proposals) fails. The refused one shows nothing of itself;
  // the other stays as last read, said so. Both recover.
  const latestPlan = page
    .locator(`.work-card[data-artifact="${planId}"]`)
    .last();
  const deny = (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            code: "not_found_or_not_authorized",
            message: "Not found.",
            request_id: "synthetic-denial",
            next_action: "Check access.",
            details: {},
          }),
        })
      : route.continue();
  const fail = (route) =>
    route.request().method() === "GET"
      ? route.abort("failed")
      : route.continue();
  for (const sibling of [
    new RegExp(`/artifacts/${planId}(\\?|$)`),
    new RegExp(`/artifacts/${planId}/proposals`),
  ]) {
    await page.route(budgetRead, deny);
    await page.route(sibling, fail);
    await refreshBtn.click();
    await expect(latestBudget.getByTestId("work-card-unavailable")).toBeVisible(
      { timeout: 15000 },
    );
    await expect(latestBudget.locator("table")).toHaveCount(0);
    await expect(latestBudget).not.toContainText("Venue, two days");
    await expect(latestBudget).not.toContainText("Proposed:");
    await expect(latestBudget.getByTestId("work-card-unconfirmed")).toHaveCount(
      0,
    );
    await expect(latestPlan.getByTestId("work-card-unconfirmed")).toBeVisible();
    await expect(latestPlan).toContainText("Two days, 40 people");
    await page.unroute(budgetRead);
    await page.unroute(sibling);
    await refreshBtn.click();
    await expect(latestBudget).toContainText("Venue, two days", {
      timeout: 15000,
    });
    await expect(latestBudget.getByTestId("work-card-unavailable")).toHaveCount(
      0,
    );
    await expect(latestPlan.getByTestId("work-card-unconfirmed")).toHaveCount(
      0,
    );
  }
  // Within one card's pair of reads: a refusal of either read wins, whatever
  // order the two finish in, for 401 and 404 alike; the other read failing
  // first must not keep the old copy.
  const budgetProposals = new RegExp(`/artifacts/${budgetId}/proposals`);
  const refuseLater = (status, code) => async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await new Promise((r) => setTimeout(r, 150));
    return route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        code,
        message: "Refused.",
        request_id: "synthetic-refusal",
        next_action: "Check access.",
        details: {},
      }),
    });
  };
  for (const [status, code] of [
    [401, "unauthenticated"],
    [404, "not_found_or_not_authorized"],
  ])
    for (const [refusedRead, failedRead] of [
      [budgetRead, budgetProposals],
      [budgetProposals, budgetRead],
    ]) {
      await page.route(refusedRead, refuseLater(status, code));
      await page.route(failedRead, fail);
      await refreshBtn.click();
      await expect(
        latestBudget.getByTestId("work-card-unavailable"),
      ).toBeVisible({ timeout: 15000 });
      await expect(latestBudget).not.toContainText("Venue, two days");
      await expect(
        latestBudget.getByTestId("work-card-unconfirmed"),
      ).toHaveCount(0);
      await page.unroute(refusedRead);
      await page.unroute(failedRead);
      await refreshBtn.click();
      await expect(latestBudget).toContainText("Venue, two days", {
        timeout: 15000,
      });
    }
  // A refusal shows at once even while another read is still pending (this
  // work's proposals, or another work's), not when that read settles.
  const planProposals = new RegExp(`/artifacts/${planId}/proposals`);
  for (const pendingRead of [budgetProposals, planProposals]) {
    const held = [];
    await page.route(pendingRead, (route) =>
      route.request().method() === "GET" ? held.push(route) : route.continue(),
    );
    await page.route(budgetRead, deny);
    await refreshBtn.click();
    await expect.poll(() => held.length, { timeout: 15000 }).toBeGreaterThan(0);
    await expect(latestBudget.getByTestId("work-card-unavailable")).toBeVisible(
      { timeout: 2000 },
    );
    await expect(latestBudget).not.toContainText("Venue, two days");
    assert.ok(held.length > 0, "the other read is still pending");
    // Releasing the pending read later (here as a failure) changes nothing.
    for (const r of held.splice(0)) await r.abort("failed");
    await page.waitForTimeout(300);
    await expect(
      latestBudget.getByTestId("work-card-unavailable"),
    ).toBeVisible();
    await page.unroute(budgetRead);
    await page.unroute(pendingRead);
    await refreshBtn.click();
    await expect(latestBudget).toContainText("Venue, two days", {
      timeout: 15000,
    });
  }
  await page.locator("#follow-up").fill("");
  pass(
    "refreshing the conversation re-reads its work: a changed version, a refusal and a failed re-check each show, with no new message; a refusal beside a sibling's failed work or proposal read still removes the refused work; all recover; the draft is kept",
  );

  // A person can add their own note to a document the agent made, remove a
  // part they added, and the note is saved as theirs and reads back.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `${origin}/conversations/${cid}/artifacts/${planId}?workspace=${ws}`,
  );
  const adder = page.getByRole("group", { name: "Add to the document" });
  await expect(adder).toBeVisible({ timeout: 15000 });
  await adder.getByRole("button", { name: "Paragraph" }).click();
  await page.keyboard.type("Temporary line");
  await page
    .getByRole("button", { name: /^Remove paragraph: Temporary line/ })
    .click();
  await expect(page.getByText("Temporary line")).toHaveCount(0);
  await adder.getByRole("button", { name: "Your note" }).click();
  const NOTE =
    "Don’t pay the venue deposit until the refund terms are in writing.";
  await page.keyboard.type(NOTE);
  await expect(page.locator(":focus")).toHaveValue(NOTE);
  await page.getByRole("button", { name: "Save my edits" }).click();
  await expect(page.getByText("Your edits are saved.")).toBeVisible({
    timeout: 15000,
  });
  const noted = await api(`/artifacts/${planId}`);
  const blocks = noted.body.current_revision.body.blocks;
  assert.deepEqual(
    blocks.filter((b) => b.kind === "protected_note").map((b) => b.text),
    [NOTE],
  );
  assert.equal(
    blocks.some((b) => b.text === "Temporary line"),
    false,
  );
  assert.equal(noted.body.current_revision.author_kind, "human");
  await page.reload();
  const note = page.locator('.doc-editable .doc-block[data-note="true"]');
  await expect(note).toContainText("Your note");
  await expect(note.locator("textarea")).toHaveValue(NOTE);
  await noOverflow(page);
  await shot(page, "08-document-your-note");
  pass(
    "a person adds their own note to the agent's document, removes a part they added, saves, and the note reads back as theirs",
  );

  // A refusal of the chosen work ends what's shown of it at once: its running
  // view is removed and sending waits, even when another read of it or of
  // other work fails first, or never answers. The choice and the draft are
  // kept; only a fresh complete read brings it back. Another work's refusal
  // leaves the chosen one running; a failure alone keeps it, said so.
  {
    const sup = ids.supplier;
    const C = sup.compare_id;
    const E = sup.evidence_id;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(
      `${origin}/spaces/${sup.workspace}/work/${sup.conversation_id}?work=${C}`,
    );
    const supPosts = [];
    const onSupPost = (r) => {
      if (
        r.method() === "POST" &&
        r.url().endsWith(`/conversations/${sup.conversation_id}/messages`)
      )
        supPosts.push(r.url());
    };
    page.on("request", onSupPost);
    const frame = page.locator(".space-work iframe");
    const viewList = page.frameLocator(".space-work iframe").locator("#list");
    await expect(viewList).toContainText("Lark & Co", { timeout: 20000 });
    const refreshProject = page.getByRole("button", {
      name: "Refresh this project",
    });
    await box.fill("Draft kept through refusals");
    const read = (aid) => new RegExp(`/artifacts/${aid}(\\?|$)`);
    const proposals = (aid) => new RegExp(`/artifacts/${aid}/proposals`);
    const answer =
      (outcome, delay = 0) =>
      async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (outcome === "fail") return route.abort("failed");
        return route.fulfill({
          status: outcome,
          contentType: "application/json",
          body: JSON.stringify({
            code:
              outcome === 401
                ? "unauthenticated"
                : "not_found_or_not_authorized",
            message: "Refused.",
            request_id: "synthetic-refusal",
            next_action: "Check access.",
            details: {},
          }),
        });
      };
    const routed = [];
    const on = async (url, handler) => {
      routed.push(url);
      await page.route(url, handler);
    };
    const clear = async () => {
      for (const url of routed.splice(0)) await page.unroute(url);
    };
    const chosenRefused = async (timeout = 15000) => {
      await expect(page.getByTestId("chosen-unavailable")).toBeVisible({
        timeout,
      });
      await expect(frame).toHaveCount(0);
      await expect(
        page.locator(".space-work").getByRole("link", { name: "Open to edit" }),
      ).toHaveCount(0);
      await expect(page.locator('[data-state="paused"]')).toBeVisible();
      await expect(send).toBeDisabled();
      const before = supPosts.length;
      await box.press("Control+Enter");
      await page.waitForTimeout(300);
      assert.equal(supPosts.length, before, "nothing is sent");
      await expect(box).toHaveValue("Draft kept through refusals");
      assert.equal(new URL(page.url()).searchParams.get("work"), C);
    };
    const chosenBack = async () => {
      await clear();
      await refreshProject.click();
      await expect(viewList).toContainText("Lark & Co", { timeout: 15000 });
      await expect(page.getByTestId("chosen-unavailable")).toHaveCount(0);
      await expect(page.getByTestId("space-work-refused")).toHaveCount(0);
      await expect(send).toBeEnabled();
    };
    // The chosen work's own two reads: either refused, the other failing
    // first or after, for 401 and 404.
    for (const status of [401, 404])
      for (const [refusedRead, failedRead] of [
        [read(C), proposals(C)],
        [proposals(C), read(C)],
      ])
        for (const [refuseDelay, failDelay] of [
          [300, 0],
          [0, 300],
        ]) {
          await on(refusedRead, answer(status, refuseDelay));
          await on(failedRead, answer("fail", failDelay));
          await refreshProject.click();
          await chosenRefused();
          await chosenBack();
        }
    // Another work's read failing first doesn't hide the chosen one's refusal.
    for (const status of [401, 404]) {
      await on(proposals(E), answer("fail"));
      await on(read(C), answer(status, 300));
      await refreshProject.click();
      await chosenRefused();
      await chosenBack();
    }
    // A read that never answers (the chosen work's own, or another's) doesn't
    // delay the refusal.
    for (const pending of [proposals(C), proposals(E)]) {
      const held = [];
      await on(pending, (route) =>
        route.request().method() === "GET"
          ? held.push(route)
          : route.continue(),
      );
      await on(read(C), answer(404));
      await refreshProject.click();
      await expect
        .poll(() => held.length, { timeout: 15000 })
        .toBeGreaterThan(0);
      await chosenRefused(2000);
      await clear();
      for (const route of held) await route.abort("failed").catch(() => {});
      await chosenRefused();
      await chosenBack();
    }
    // Another work refused: it goes, with a note; the chosen view keeps running.
    await on(read(E), answer(404));
    await refreshProject.click();
    await expect(page.getByTestId("space-work-refused")).toBeVisible({
      timeout: 15000,
    });
    await expect(item(E)).toHaveCount(0);
    await expect(viewList).toContainText("Lark & Co");
    await expect(page.getByTestId("chosen-unavailable")).toHaveCount(0);
    await expect(send).toBeEnabled();
    await chosenBack();
    await expect(item(E)).toBeVisible();
    // A failure alone keeps the chosen work as last read, and says so.
    await on(proposals(C), answer("fail"));
    await refreshProject.click();
    await expect(
      page.getByText("Showing the work as last read", { exact: false }),
    ).toBeVisible({ timeout: 15000 });
    await expect(viewList).toContainText("Lark & Co");
    await expect(page.getByTestId("chosen-unavailable")).toHaveCount(0);
    await chosenBack();
    await box.fill("");
    page.off("request", onSupPost);
    assert.deepEqual(supPosts, [], "nothing was sent");
    pass(
      "a refusal of the chosen work removes its running view and holds sending at once, for 401 and 404, in either order, when another read fails first or never answers; the choice and draft stay; only a fresh read restores it; another work's refusal or a plain failure leaves it shown",
    );
  }

  // A materially different project, an investigation: the comparison the
  // agent made runs in place, reading the saved quotes at their exact
  // version; its weighting is the person's to adjust and saves nothing.
  // What it reads, and what reads a table, are one click away, in place. A
  // human edit to the quotes leaves the view behind, and it says so here.
  const sup = ids.supplier;
  const supBase = `${origin}/api/domain/v1/workspaces/${sup.workspace}`;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `${origin}/spaces/${sup.workspace}/work/${sup.conversation_id}?work=${sup.compare_id}`,
  );
  const viewFrame = page.frameLocator(".space-work iframe");
  await expect(viewFrame.locator("#list")).toContainText("Lark & Co", {
    timeout: 20000,
  });
  await expect(viewFrame.locator("#state")).toContainText(
    "Reading saved version",
  );
  await expect(viewFrame.locator("#list li").first()).toContainText(
    "Best fit:",
  );
  const writesBefore = posts.length;
  await viewFrame.locator("#weight").fill("100");
  await expect(viewFrame.locator("#list li").first()).toContainText(
    "Best fit: Quayside Press",
  );
  await viewFrame.locator("#weight").fill("0");
  await expect(viewFrame.locator("#list li").first()).toContainText(
    "Best fit: Lark & Co",
  );
  assert.equal(posts.length, writesBefore, "adjusting the view sends nothing");
  await expect(page.getByTestId("space-reads")).toContainText(
    "Supplier evidence",
  );
  await expect(page.getByText("View source")).toHaveCount(0);
  await shot(page, "09-investigation-view-in-place");
  // On a phone, after a resize from desktop, the same view is drawn and
  // usable where the person scrolls to it: its pixels are painted (not just
  // present in the frame's DOM), and the weighting still works by keyboard.
  // Chromium doesn't paint a cross-origin frame below the fold, so a
  // full-page capture taken before scrolling to it shows an empty box.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 700 });
    const frameBox = page.locator(".space-work iframe");
    await frameBox.scrollIntoViewIfNeeded();
    await expect(frameBox).toBeInViewport({ ratio: 0.9 });
    await expect(viewFrame.locator("#list")).toContainText("Lark & Co");
    await viewFrame.locator("#weight").focus();
    await viewFrame.locator("#weight").press("End");
    await expect(viewFrame.locator("#list li").first()).toContainText(
      "Best fit: Quayside Press",
    );
    await viewFrame.locator("#weight").press("Home");
    await expect(viewFrame.locator("#list li").first()).toContainText(
      "Best fit: Lark & Co",
    );
    assert.ok(
      (await inkIn(await frameBox.screenshot())) > 0.01,
      `the view is painted at ${width}px`,
    );
    await noOverflow(page);
    await page.screenshot({
      path: path.join(out, `09-investigation-view-${width}.png`),
    });
  }
  assert.equal(posts.length, writesBefore, "adjusting the view sends nothing");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByTestId("space-reads")
    .getByRole("button", { name: "Supplier evidence" })
    .click();
  await expect(
    page.locator(`.space-work-item[data-artifact="${sup.evidence_id}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("space-used-by")).toContainText(
    "Supplier comparison",
  );
  await expect(page.locator(".space-work.inline")).toContainText("Lark & Co");
  // The person changes a quote; the view, made for the earlier version,
  // says it's behind and where to update it, and offers no save here.
  const ev = await fetch(`${supBase}/artifacts/${sup.evidence_id}`, {
    headers,
  });
  const evBody = await ev.json();
  const edited = structuredClone(evBody.current_revision.body);
  edited.rows[1].cells.find((c) => c.field_key === "price").value = "480.00";
  const quoteSave = await fetch(
    `${supBase}/artifacts/${sup.evidence_id}/save`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        schema_version: "workagent/v1",
        request_id: crypto.randomUUID(),
        command_id: crypto.randomUUID(),
        expected_current_revision_id: evBody.current_revision_id,
        body: edited,
      }),
    },
  );
  assert.equal(quoteSave.status, 200, await quoteSave.text());
  await page
    .getByTestId("space-used-by")
    .getByRole("button", { name: "Supplier comparison" })
    .click();
  await page.getByRole("button", { name: "Refresh this project" }).click();
  await expect(page.getByTestId("view-update-elsewhere")).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", { name: "Use the latest saved versions" }),
  ).toHaveCount(0);
  await expect(page.locator(".space-work .view-binding")).toContainText(
    "changed since this view was made",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  pass(
    "an investigation's comparison runs in place on the saved quotes; after a resize to 390 and 320 it is painted where the person scrolls to it and weighs by keyboard; weighing it saves nothing; what it reads and what reads a table are one click away; after a human edit it says it's behind and where to update it",
  );

  // Unavailable and refused reads are said as such.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/spaces/${ws}/work/${ids.plain.conversation_id}`);
  await expect(
    page.getByText("This project isn’t available to you.", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await page.goto(`${origin}/spaces/${ws}/work/not-a-real-project`);
  await expect(
    page.getByText("This project isn’t available to you.", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await page.goto(`${origin}/conversations/${ids.plain.conversation_id}`);
  await expect(
    page.getByText("About 15 minutes mid-morning", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Keep as a project" }),
  ).toBeVisible();
  await shot(page, "06-plain-answer");
  await page.goto(`${origin}/conversations/${cid}`);
  await expect(
    page.getByRole("link", { name: "Open the project" }),
  ).toHaveAttribute("href", `/spaces/${ws}/work/${cid}`);
  pass(
    "a plain question gets its answer without becoming a project; an ordinary chat or unknown id isn't shown as one; a chat can be kept as one; a project's chat links back",
  );

  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "space-experience.json"),
    JSON.stringify({ ...report, ids }, null, 2),
  );
} finally {
  await browser.close();
}
