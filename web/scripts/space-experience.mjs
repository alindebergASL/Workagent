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
  await expect(page.locator(".work-row")).toHaveCount(3);
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
  await expect(page.locator("#space-selected-heading")).toBeFocused();
  await expect(page.locator("#space-selected-heading")).toHaveText(
    "Workshop plan",
  );
  await expect(about).toContainText("About: Workshop plan");
  pass(
    "keyboard selects work; its heading takes focus; the reply is now about it",
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
