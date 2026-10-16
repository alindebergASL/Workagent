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
  await expect(page.locator(".work-row")).toHaveCount(5);
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
  // No worker runs in this stack: the service's own check says so, and the
  // waiting message says it's waiting, never that a reply is being written.
  await expect(page.locator(".space-view")).toContainText(
    "Your latest message is waiting. Workagent isn’t running right now.",
    { timeout: 15000 },
  );
  await expect(page.locator(".space-view")).not.toContainText(
    "Workagent is replying",
  );
  pass(
    "a reply carries the selected work's exact saved version; the waiting turn shows as waiting, not as done or as being answered",
  );

  // What the service says about running work, shown where the work is: the
  // real check (no worker here), then each state it can report. Drafts and
  // the chosen work stay put while it's re-read; nothing is disabled by it.
  {
    const line = page.getByTestId("execution-line");
    await expect(line).toHaveAttribute("data-execution", "unavailable");
    await expect(line).toContainText("You can read and edit your work");
    const turnSays = page.locator(
      ".working-agent [data-testid=turn-execution]",
    );
    await expect(turnSays.last()).toContainText("isn’t running right now");
    await expect(page.locator(".working-agent .thread")).not.toContainText(
      "Replying…",
    );
    const runId = (await api(`/conversations/${cid}`)).body.turns.at(-1).run_id;
    const execUrl = new RegExp(`/workspaces/${ws}/execution$`);
    let reply = null;
    await page.route(execUrl, (route) =>
      reply === "fail"
        ? route.abort("failed")
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              workspace_id: ws,
              checked_at: new Date().toISOString(),
              last_progress_at: null,
              ...reply,
            }),
          }),
    );
    const recheck = () =>
      page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await box.fill("Draft kept while status changes");
    const states = [
      [
        {
          state: "awaiting_provider",
          can_advance_authorized_work: true,
          runs: [{ run_id: runId, state: "awaiting_provider" }],
        },
        "working",
        "Waiting for the model’s answer.",
      ],
      [
        {
          state: "recovering",
          can_advance_authorized_work: true,
          runs: [{ run_id: runId, state: "recovering" }],
        },
        "working",
        "Picking this up again after an interruption.",
      ],
      [
        {
          state: "blocked",
          can_advance_authorized_work: false,
          runs: [
            {
              run_id: runId,
              state: "blocked",
              failure_category: "authority_or_budget",
            },
          ],
        },
        "blocked",
        "reached the limit it’s allowed for this",
      ],
    ];
    for (const [status, lineState, turnText] of states) {
      reply = status;
      await recheck();
      await expect(line).toHaveAttribute("data-execution", lineState, {
        timeout: 15000,
      });
      await expect(turnSays.last()).toContainText(turnText);
      await expect(box).toHaveValue("Draft kept while status changes");
      await expect(about).toContainText("About: Workshop plan");
    }
    // Ready, with a result waiting for the person elsewhere: nothing to say,
    // and nothing stops them.
    reply = {
      state: "waiting_for_person",
      can_advance_authorized_work: true,
      runs: [],
    };
    await recheck();
    await expect(line).toHaveCount(0, { timeout: 15000 });
    await expect(send).toBeEnabled();
    // The check itself failing is said as that, not as running or stopped.
    reply = "fail";
    await page.reload();
    await expect(line).toHaveAttribute("data-execution", "unknown", {
      timeout: 15000,
    });
    await expect(line).toContainText(
      "Couldn’t check whether Workagent is running",
    );
    await page.unroute(execUrl);
    await recheck();
    await expect(line).toHaveAttribute("data-execution", "unavailable", {
      timeout: 15000,
    });
    await expect(box).toHaveValue("Draft kept while status changes");
    // The full conversation says the same.
    const chosenAt = page.url();
    await page.goto(`${origin}/conversations/${cid}?workspace=${ws}`);
    await expect(page.getByTestId("execution-line")).toHaveAttribute(
      "data-execution",
      "unavailable",
      { timeout: 15000 },
    );
    await expect(
      page.locator("[data-testid=turn-execution]").last(),
    ).toContainText("isn’t running right now");
    await page.goto(chosenAt);
    await expect(about).toContainText("About: Workshop plan", {
      timeout: 15000,
    });
    await expect(box).toHaveValue("Draft kept while status changes", {
      timeout: 15000,
    });
    await box.fill("");
    pass(
      "what's running is the service's own check: no worker reads as not running, never replying; waiting on the model, recovering and a limit each say so on the waiting turn; a ready service says nothing; a failed check says only that; drafts and the chosen work stay put",
    );
  }

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
  // Back on the project, the work the person left is still the chosen one.
  assert.equal(new URL(page.url()).searchParams.get("work"), budgetId);
  await expect(item(budgetId)).toHaveAttribute("aria-pressed", "true", {
    timeout: 15000,
  });
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
  // Gone from the document; only the offer to undo names it.
  await expect
    .poll(() =>
      page
        .locator(".doc-editable textarea")
        .evaluateAll((els) => els.some((e) => e.value === "Temporary line")),
    )
    .toBe(false);
  await expect(page.getByTestId("undo-remove")).toContainText("Temporary line");
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
  // A note Workagent kept (quoting the person) isn't shown as theirs: on the
  // work page, where history shows who added it, it says Workagent; beside
  // the project, where that isn't read, it says only "Note".
  {
    const sup = ids.supplier;
    await page.goto(
      `${origin}/conversations/${sup.conversation_id}/artifacts/${sup.findings_id}?workspace=${sup.workspace}`,
    );
    const kept = page.locator('.doc-editable .doc-block[data-note="true"]');
    await expect(kept).toContainText("Note from Workagent", {
      timeout: 15000,
    });
    await expect(kept).not.toContainText("Your note");
    await expect(kept.locator("textarea")).toHaveValue(
      "You asked for: under EUR 700, delivered within two weeks.",
    );
    // Workagent's proposal to the person's own corrected version says exactly
    // what it would change, beside what's saved, and that it replaces their
    // edit there; their own correction elsewhere isn't touched.
    const proposal = page.getByTestId("product-proposal");
    await expect(proposal).toContainText("A proposed version is ready");
    await expect(proposal.getByTestId("proposal-changes")).toContainText(
      "Renames it “Findings so far: the 10-day option”; adds or rewrites 2 parts; takes out or replaces 1 part",
    );
    await expect(proposal.getByTestId("proposal-replaces-yours")).toBeVisible();
    // What changed, item by item, quoting the proposal (read from the two
    // saved bodies, not the proposer's account of itself). The note it keeps
    // is Workagent's, so nothing claims the person's notes are kept.
    await expect(
      proposal.getByTestId("proposal-items").locator("li"),
    ).toHaveText([
      "Rewrites a part as “Lark & Co can deliver in 6 days; Northprint says 10 days is possible for EUR 40 more.”",
      "Adds “Decide by Friday so printing can start on Monday.”",
    ]);
    await expect(proposal.getByTestId("proposal-your-notes")).toHaveCount(0);
    // The decision comes first: what's proposed, by name, a one-line summary
    // and Apply/Keep, in one phone screen; the full comparison is a step away.
    // The saved version keeps its own title until the proposal is applied.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Findings so far",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    // However long the change, the full comparison never stands between the
    // summary and the decision, and is folded until asked for.
    const order = await proposal.evaluate((card) => {
      const apply = [...card.querySelectorAll("button")].find((b) =>
        b.textContent.includes("Apply proposed version"),
      );
      const diff = card.querySelector(".diff");
      return {
        applyFirst: Boolean(
          diff &&
          apply.compareDocumentPosition(diff) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        diffShown: Boolean(
          diff &&
          !diff.closest("details:not([open])") &&
          diff.checkVisibility(),
        ),
        applyAt:
          apply.getBoundingClientRect().bottom -
          card.getBoundingClientRect().top,
      };
    });
    assert.ok(order.applyFirst, "the full comparison comes before Apply");
    assert.ok(!order.diffShown, "the full comparison is open by default");
    assert.ok(
      order.applyAt <= 700,
      `Apply is ${Math.round(order.applyAt)}px into the proposal on a phone`,
    );
    await expect(proposal.getByTestId("proposal-name")).toHaveText(
      "Proposed: Findings so far: the 10-day option",
    );
    const compare = proposal.getByTestId("proposal-compare");
    await expect(compare).not.toHaveAttribute("open", "");
    await proposal.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(out, "08c-proposal-compact-phone.png"),
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await compare.locator("summary").click();
    const diff = proposal.locator(".diff");
    await expect(diff.locator('[data-added="true"]')).toContainText([
      "Northprint says 10 days is possible for EUR 40 more.",
      "Decide by Friday so printing can start on Monday.",
    ]);
    await expect(diff.locator('[data-removed="true"]')).toContainText([
      "the others need two to three weeks.",
    ]);
    await expect(diff).not.toContainText("late twice last October");
    await expect(
      proposal.getByRole("button", { name: "Apply proposed version" }),
    ).toBeEnabled();
    await proposal.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(out, "08b-proposal-against-your-edit.png"),
    });
    await page.goto(
      `${origin}/spaces/${sup.workspace}/work/${sup.conversation_id}?work=${sup.findings_id}`,
    );
    const inline = page.locator('.space-work .doc-block[data-note="true"]');
    await expect(inline.locator(".doc-note-label")).toHaveText("Note", {
      timeout: 15000,
    });
  }
  pass(
    "a person adds their own note to the agent's document, removes a part they added, saves, and the note reads back as theirs; a note Workagent kept is never shown as the person's",
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

  // What a view reads is changed with the app's own controls beside it, not
  // through the view: the saved priority is a person's version of the table,
  // the view is pointed at it and reads it, and both survive reopening; the
  // reply is about the view's new version. A lost acknowledgement replays the
  // same command; a change made elsewhere meanwhile is refused, not overwritten.
  {
    const sup = ids.supplier;
    const P = sup.priorities_id;
    const C = sup.compare_id;
    const supApi = `${origin}/api/domain/v1/workspaces/${sup.workspace}`;
    const read = async (aid) =>
      (await fetch(`${supApi}/artifacts/${aid}`, { headers })).json();
    const spaceAt = `${origin}/spaces/${sup.workspace}/work/${sup.conversation_id}?work=${C}`;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(spaceAt);
    const viewFrame = page.frameLocator(".space-work iframe");
    const best = viewFrame.locator("#list li").first();
    await expect(best).toContainText("Best fit: Lark & Co", { timeout: 20000 });
    await expect(viewFrame.locator("#saved")).toContainText("50% on price");
    const inputs = page.getByTestId("view-inputs");
    const weight = () => inputs.getByLabel(/Weight on price/);
    await expect(weight()).toHaveValue("50");
    const saves = [];
    const onSave = (r) => {
      if (r.method() === "POST" && /\/artifacts\/[^/]+\/save$/.test(r.url()))
        saves.push({ url: r.url(), body: r.postDataJSON() });
    };
    page.on("request", onSave);
    // The change is kept while the person looks at other work.
    await weight().fill("100");
    await item(sup.evidence_id).click();
    await item(C).click();
    await expect(weight()).toHaveValue("100");
    // Saving the table lands; the view's update loses its acknowledgement.
    const viewSave = new RegExp(`/artifacts/${C}/save$`);
    await page.route(viewSave, async (route) => {
      const r = await route.fetch();
      assert.ok(r.ok(), "the view update itself landed");
      return route.abort("failed");
    });
    await inputs
      .getByRole("button", { name: "Save and update the view" })
      .click();
    const outcome = page.getByTestId("view-inputs-outcome");
    await expect(outcome).toContainText("Updating the view wasn’t confirmed", {
      timeout: 15000,
    });
    await page.unroute(viewSave);
    await page.reload();
    await inputs.getByRole("button", { name: "Update the view again" }).click();
    await expect(outcome).toContainText("The view now reads", {
      timeout: 15000,
    });
    const viewSaves = saves.filter((x) => viewSave.test(x.url));
    assert.equal(viewSaves.length, 2, "one update, replayed once");
    assert.equal(viewSaves[0].body.command_id, viewSaves[1].body.command_id);
    // The same command and body; only the per-attempt request id differs.
    const sameUpdate = (b) => ({ ...b, request_id: undefined });
    assert.deepEqual(
      sameUpdate(viewSaves[0].body),
      sameUpdate(viewSaves[1].body),
    );
    await expect(best).toContainText("Best fit: Quayside Press", {
      timeout: 15000,
    });
    await expect(viewFrame.locator("#saved")).toContainText("100% on price");
    // The records: a person's version of the table, and the view reading it.
    const pr = await read(P);
    assert.equal(pr.current_revision.author_kind, "human");
    assert.equal(pr.current_revision.body.rows[0].cells[0].value, 100);
    const cv = await read(C);
    const binding = cv.current_revision.body.bindings.find(
      (b) => b.artifact_id === P,
    );
    assert.equal(binding.revision_id, pr.current_revision_id);
    assert.equal(
      saves.filter((x) => x.url.endsWith(`/artifacts/${P}/save`)).length,
      1,
    );
    // Reopened, it still reads the saved priority; a reply is about the
    // view's new version.
    await page.goto(spaceAt);
    await expect(best).toContainText("Best fit: Quayside Press", {
      timeout: 20000,
    });
    await expect(weight()).toHaveValue("100");
    await expect(
      page.locator(`.space-work[data-artifact-id="${C}"]`),
    ).toHaveAttribute("data-revision-id", cv.current_revision_id);
    await expect(about).toContainText("About: Supplier comparison");
    await shot(page, "10-view-inputs-saved");
    // Changed elsewhere meanwhile: the save is refused and the change kept.
    await weight().fill("20");
    const elsewhere = structuredClone(pr.current_revision.body);
    elsewhere.rows[0].cells[0].value = 70;
    const other = await fetch(`${supApi}/artifacts/${P}/save`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        schema_version: "workagent/v1",
        request_id: crypto.randomUUID(),
        command_id: crypto.randomUUID(),
        expected_current_revision_id: pr.current_revision_id,
        body: elsewhere,
      }),
    });
    assert.equal(other.status, 200, await other.text());
    await inputs
      .getByRole("button", { name: "Save and update the view" })
      .click();
    await expect(outcome).toContainText("changed elsewhere", {
      timeout: 15000,
    });
    await expect(weight()).toHaveValue("20");
    assert.equal(
      (await read(P)).current_revision.body.rows[0].cells[0].value,
      70,
    );
    await inputs.getByRole("button", { name: "Discard my change" }).click();
    await expect(weight()).toHaveValue("70");
    // The view now reads an older priority; it's pointed at the saved one here.
    await page.getByRole("button", { name: "Refresh this project" }).click();
    await inputs
      .getByRole("button", { name: "Use the latest saved versions" })
      .click();
    await expect(viewFrame.locator("#saved")).toContainText("70% on price", {
      timeout: 15000,
    });
    // On a phone the control fits and works the same way.
    await page.setViewportSize({ width: 390, height: 844 });
    await weight().scrollIntoViewIfNeeded();
    await expect(weight()).toBeInViewport();
    await noOverflow(page);
    await shot(page, "10-view-inputs-390");
    await page.setViewportSize({ width: 1440, height: 1000 });
    page.off("request", onSave);
    pass(
      "beside a view, the app's own control changes what it reads: the change survives switching work, a lost acknowledgement replays the same update, the view reads the saved value, it survives reopening and the reply is about the new version; a change made elsewhere is refused with the draft kept",
    );
  }

  // Something only this tab holds (an unsaved edit on a work page, or a
  // change beside a view) is asked about before the tab closes; with nothing
  // unsaved, it closes without asking.
  {
    const sup = ids.supplier;
    const tabContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const tab = await tabContext.newPage();
    const asked = [];
    tab.on("dialog", (d) => {
      asked.push(d.type());
      return d.dismiss();
    });
    const tryClose = async () => {
      const before = asked.length;
      await tab.close({ runBeforeUnload: true });
      await expect
        .poll(() => asked.length > before || tab.isClosed())
        .toBe(true);
      return asked.length > before;
    };
    await tab.goto(
      `${origin}/conversations/${cid}/artifacts/${planId}?workspace=${ws}`,
    );
    const adder = tab.getByRole("group", { name: "Add to the document" });
    await expect(adder).toBeVisible({ timeout: 15000 });
    await adder.getByRole("button", { name: "Paragraph" }).click();
    await tab.keyboard.type("Not saved yet");
    assert.equal(await tryClose(), true, "an unsaved edit asks before closing");
    assert.deepEqual(asked, ["beforeunload"]);
    assert.equal(tab.isClosed(), false);
    await tab
      .getByRole("button", { name: /^Remove paragraph: Not saved yet/ })
      .click();
    await tab.goto(
      `${origin}/spaces/${sup.workspace}/work/${sup.conversation_id}?work=${sup.compare_id}`,
    );
    const weight = tab.getByTestId("view-inputs").getByLabel(/Weight on price/);
    await expect(weight).toBeVisible({ timeout: 15000 });
    const was = await weight.inputValue();
    // A real click first: the browser only asks before closing a page the
    // person has interacted with since it loaded. Then wait until the change
    // is shown as unsaved, so the guard is in place before closing.
    await weight.click();
    await weight.fill(was === "40" ? "45" : "40");
    await expect(
      tab
        .getByTestId("view-inputs")
        .getByRole("button", { name: "Discard my change" }),
    ).toBeVisible();
    assert.equal(await tryClose(), true, "a change beside a view asks too");
    await tab
      .getByTestId("view-inputs")
      .getByRole("button", { name: "Discard my change" })
      .click();
    assert.equal(await tryClose(), false, "nothing unsaved: it just closes");
    assert.equal(tab.isClosed(), true);
    await tabContext.close();
    pass(
      "an unsaved edit on a work page or beside a view asks before the tab closes; with nothing unsaved it closes without asking",
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
    "Using the saved quotes.",
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
  // What it reads is named once, beside the work; the view's own line only
  // says whether that's current.
  await expect(page.locator(".space-work .view-trust-line")).toContainText(
    "reads the current saved version",
  );
  await expect(page.locator(".space-work .view-trust-line")).not.toContainText(
    "Supplier evidence",
  );
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
  // Back at full width, the frame fits its content again: a view made tall
  // on a phone doesn't stay tall.
  await expect
    .poll(
      async () =>
        (await page.locator(".space-work iframe").boundingBox())?.height ?? 0,
      { timeout: 10000 },
    )
    .toBeLessThan(360);
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
  await expect(page.locator(".space-work .view-binding")).toContainText(
    "changed since this view was made",
    { timeout: 15000 },
  );
  // It's pointed at the edited quotes right here, through the app's own
  // control, and reads them.
  await page
    .getByTestId("view-inputs")
    .getByRole("button", { name: "Use the latest saved versions" })
    .click();
  await expect(page.getByTestId("view-inputs-outcome")).toContainText(
    "The view now reads the latest saved versions.",
    { timeout: 15000 },
  );
  await expect(
    page.frameLocator(".space-work iframe").locator("#list"),
  ).toContainText("€480", { timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  pass(
    "an investigation's comparison runs in place on the saved quotes; after a resize to 390 and 320 it is painted where the person scrolls to it and weighs by keyboard; weighing it saves nothing; what it reads and what reads a table are one click away; after a human edit it says it's behind and is pointed at the new quotes in place",
  );

  // From a model view on its own page, what it reads opens in the trusted
  // editor for that work, and going back returns to the project with that
  // work chosen. Something it reads that can't be read now is named, not
  // linked: a link would only lead to "not available".
  {
    const prioritiesRead = new RegExp(
      `/api/domain/v1/workspaces/${sup.workspace}/artifacts/${sup.priorities_id}$`,
    );
    await page.route(prioritiesRead, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 404,
            json: {
              code: "not_found_or_not_authorized",
              message: "Not found.",
              request_id: "injected",
            },
          })
        : route.continue(),
    );
    await page.goto(
      `${origin}/conversations/${sup.conversation_id}/artifacts/${sup.compare_id}?workspace=${sup.workspace}`,
    );
    const gone = page.locator('.view-binding[data-state="unavailable"]');
    await expect(gone).toContainText("not available", { timeout: 20000 });
    await expect(gone.getByRole("link")).toHaveCount(0);
    const source = page
      .locator('.view-binding:not([data-state="unavailable"])')
      .getByRole("link", { name: "Supplier evidence" });
    await expect(source).toHaveAttribute(
      "href",
      `/conversations/${sup.conversation_id}/artifacts/${sup.evidence_id}?workspace=${sup.workspace}`,
    );
    await page.unroute(prioritiesRead);
    await source.click();
    await page.waitForURL(new RegExp(`/artifacts/${sup.evidence_id}`));
    // The trusted editor for the source, not another view of it.
    await expect(
      page.getByRole("region", { name: "Editable table" }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("link", { name: /^← / }).first().click();
    await page.waitForURL(
      new RegExp(
        `/spaces/${sup.workspace}/work/${sup.conversation_id}\\?work=${sup.evidence_id}`,
      ),
    );
    await expect(
      page.locator(`.space-work-item[data-artifact="${sup.evidence_id}"]`),
    ).toHaveAttribute("aria-pressed", "true", { timeout: 15000 });
    pass(
      "from a view's own page, what it reads opens in its editor and back returns with that work chosen; an unreadable source is named, not linked",
    );
  }

  // A one-column table of long steps reads where it's edited: each step
  // shows whole, as wide as the work allows, with no scrolling inside a
  // cell, on desktop and on a phone. Editing one still saves explicitly and
  // the saved step comes back whole.
  {
    const sec = ids.second;
    const checklistUrl = `${origin}/conversations/${sec.conversation_id}/artifacts/${sec.checklist_id}?workspace=${sec.workspace}`;
    const fits = () =>
      page.evaluate(() => {
        const region = document.querySelector(
          '[role="region"][aria-label="Editable table"]',
        );
        const boxes = [...region.querySelectorAll("textarea")];
        return {
          region: region.getBoundingClientRect().width,
          steps: boxes.map((t) => ({
            width: t.getBoundingClientRect().width,
            hidden: t.scrollHeight - t.clientHeight,
          })),
        };
      });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(checklistUrl);
    const step2 = page
      .getByRole("region", { name: "Editable table" })
      .locator("textarea")
      .nth(1);
    await expect(step2).toBeVisible({ timeout: 15000 });
    let m = await fits();
    assert.equal(m.steps.length, 3);
    for (const st of m.steps) {
      assert.ok(
        st.hidden <= 1,
        `a step scrolls inside its cell: ${st.hidden}px hidden`,
      );
      assert.ok(
        st.width >= m.region * 0.6,
        `a step uses ${Math.round(st.width)}px of ${Math.round(m.region)}px`,
      );
    }
    await shot(page, "12-long-steps-desktop");
    // A step is named by its place, not by its own text, which would change
    // its name while the person types.
    await expect(step2).toHaveAttribute("aria-label", "Row 2 Step");
    await expect(page.locator(".result-headline")).toHaveText(
      "3 rows · 1 column",
    );
    const longer =
      (await step2.inputValue()) +
      " If the totals differ, note the difference on the sheet and tell the studio manager the same day.";
    await step2.fill(longer);
    m = await fits();
    assert.ok(m.steps[1].hidden <= 1, "an edited step grows to stay readable");
    // Notes, one per line, read whole too.
    const notesBox = page.getByLabel("Notes (one per line)", { exact: true });
    const notes = [
      "Paper sheets are in the top drawer of the welcome desk.",
      "Use a blue pen so the entries are easy to read later.",
      "The studio manager keeps the spare laptop charger.",
      "Ask the second volunteer to count the totals.",
      "Shred the sheet once the entries are checked.",
    ].join("\n");
    await notesBox.fill(notes);
    assert.ok(
      (await notesBox.evaluate((t) => t.scrollHeight - t.clientHeight)) <= 1,
      "notes scroll inside their box",
    );
    await page
      .getByRole("button", { name: "Save my edits", exact: true })
      .click();
    await expect(page.getByText("Your edits are saved.")).toBeVisible({
      timeout: 15000,
    });
    await page.reload();
    await expect(step2).toHaveValue(longer, { timeout: 15000 });
    await expect(notesBox).toHaveValue(notes);
    assert.ok(
      (await notesBox.evaluate((t) => t.scrollHeight - t.clientHeight)) <= 1,
      "saved notes reopen whole",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    m = await fits();
    for (const st of m.steps)
      assert.ok(
        st.hidden <= 1,
        `on a phone a step scrolls inside: ${st.hidden}px`,
      );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "no sideways scroll on a phone",
    );
    await shot(page, "12-long-steps-phone");
    // An edit at the top of a long editor keeps its save in view: the
    // person never has to hunt below the fold to keep what they changed.
    const step1 = page
      .getByRole("region", { name: "Editable table" })
      .locator("textarea")
      .first();
    await step1.scrollIntoViewIfNeeded();
    await step1.fill(`${await step1.inputValue()} Use a pen, not pencil.`);
    const saveNow = page.getByRole("button", {
      name: "Save my edits",
      exact: true,
    });
    await expect(saveNow).toBeVisible();
    assert.ok(
      await saveNow.evaluate((b) => {
        const r = b.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      }),
      "the save is out of view after an edit at the top",
    );
    await expect(page.getByTestId("unsaved-bar")).toContainText(
      "not saved yet",
    );
    // The viewport as the person sees it (a full-page capture unsticks it).
    await page.screenshot({ path: path.join(out, "12-unsaved-bar-phone.png") });
    // Ctrl/Cmd+S saves, the same explicit save as the button.
    const pen = await step1.inputValue();
    await step1.press("Control+s");
    await expect(page.getByText("Your edits are saved.")).toBeVisible({
      timeout: 15000,
    });
    await expect(saveNow).toHaveCount(0);
    await page.reload();
    await expect(step1).toHaveValue(pen, { timeout: 15000 });
    await page.setViewportSize({ width: 1440, height: 1000 });
    pass(
      "a table of long steps and its notes read whole where they're edited, on desktop and phone; an edited step grows, saves explicitly and comes back whole",
    );
  }

  // One piece of work with what belongs to it. A table with a proposed
  // change shows its saved version and the change as two tabs; a single
  // changed value reads Saved → Proposed; the decision stays explicit on
  // the work's own page. A view shows the saved work it reads as a tab, and
  // a draft beside the view survives switching. Plain work stays one surface.
  {
    const kit = ids.kit;
    const kitSpace = `${origin}/spaces/${kit.workspace}/work/${kit.conversation_id}?work=${kit.loans_id}`;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(kitSpace);
    const card = page.locator(".space-work");
    const tab = (name) => card.getByRole("tab", { name, exact: true });
    await expect(tab("Saved version")).toBeVisible({ timeout: 15000 });
    await expect(tab("Changes · 1")).toBeVisible();
    await expect(tab("Saved version")).toHaveAttribute("aria-selected", "true");
    await expect(card.locator(".space-proposal")).toContainText(
      "A proposed change is waiting for your review.",
    );
    await card.getByRole("button", { name: "See the change" }).click();
    await expect(tab("Changes · 1")).toHaveAttribute("aria-selected", "true");
    const change = card.getByTestId("work-change");
    await expect(change.getByTestId("saved-proposed")).toContainText(
      "Lantern · Loan (days)",
    );
    await expect(change.locator(".sp-saved")).toContainText("3");
    await expect(change.locator(".sp-proposed")).toContainText("2");
    await expect(change).toContainText(
      "Your saved version stays until you apply the change.",
    );
    await expect(
      card.getByRole("region", { name: "Lending desk" }),
    ).toBeHidden();
    // Keyboard moves between tabs; the choice comes back after a reload.
    await tab("Changes · 1").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(tab("Saved version")).toHaveAttribute("aria-selected", "true");
    await expect(tab("Saved version")).toBeFocused();
    await page.keyboard.press("End");
    await expect(tab("Changes · 1")).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(tab("Changes · 1")).toHaveAttribute("aria-selected", "true", {
      timeout: 15000,
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(200);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `the work's tabs scroll sideways at ${width}`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // The decision is on the work's own page, with the same comparison.
    await change.getByRole("link", { name: "Review and decide" }).click();
    await page.waitForURL(new RegExp(`/artifacts/${kit.loans_id}`));
    await expect(page.getByTestId("saved-proposed").first()).toContainText(
      "Lantern · Loan (days)",
      { timeout: 15000 },
    );
    await shot(page, "14-saved-proposed-work-page");

    // A view: what it reads is a tab; a draft beside the view survives.
    await page.goto(
      `${origin}/spaces/${sup.workspace}/work/${sup.conversation_id}?work=${sup.compare_id}`,
    );
    await expect(tab("View")).toBeVisible({ timeout: 15000 });
    await expect(tab("Sources")).toBeVisible();
    const weightInput = card
      .getByTestId("view-inputs")
      .getByLabel(/Weight on price/);
    await expect(weightInput).toBeVisible({ timeout: 15000 });
    const was = await weightInput.inputValue();
    const typed = was === "35" ? "36" : "35";
    await weightInput.fill(typed);
    await tab("Sources").click();
    const sources = card.getByTestId("work-sources");
    await expect(sources).toContainText("Supplier evidence");
    await expect(sources).toContainText("Priorities");
    // Only the chosen tab's panel shows.
    await expect(card.getByTestId("view-inputs")).toBeHidden();
    await expect(
      sources.getByRole("link", { name: "Open to edit" }).first(),
    ).toHaveAttribute("href", /\/artifacts\//);
    await shot(page, "14-view-sources-tab");
    await tab("View").click();
    await expect(sources).toBeHidden();
    await expect(weightInput).toHaveValue(typed);
    await card
      .getByTestId("view-inputs")
      .getByRole("button", { name: "Discard my change" })
      .click();
    await expect(weightInput).toHaveValue(was);

    // Plain work, with nothing proposed and nothing it reads: no tabs.
    await page.goto(`${origin}/spaces/${ws}/work/${cid}?work=${planId}`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.getByRole("tablist")).toHaveCount(0);
    pass(
      "a piece of work shows its saved version, what it reads and what's proposed as tabs only when there's more than one; one changed value reads Saved → Proposed; drafts survive switching",
    );
  }

  // A wide table (six typed columns, one a long note) stays inside the work
  // pane: the page never scrolls sideways, each row's own controls stay in
  // view, the table says when columns are out of view, and the last column
  // can be reached, edited and saved.
  {
    const sec = ids.kit;
    const loansUrl = `${origin}/conversations/${sec.conversation_id}/artifacts/${sec.loans_id}?workspace=${sec.workspace}`;
    const noPageScroll = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(loansUrl);
    const grid = page.getByRole("region", { name: "Editable table" });
    await expect(grid).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(300);
    assert.ok(await noPageScroll(), "the page scrolls sideways at 1440");
    const inView = async (loc) => {
      const [g, b] = await Promise.all([grid.boundingBox(), loc.boundingBox()]);
      return b.x >= g.x - 1 && b.x + b.width <= g.x + g.width + 1;
    };
    for (const name of ["Lantern", "Repair bag", "Display stand"])
      assert.ok(
        await inView(grid.getByRole("button", { name: `Remove ${name}` })),
        `${name}'s Remove is out of view`,
      );
    const overflows = await grid.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1,
    );
    // Every column fits: the long notes go on their own line under each row.
    assert.equal(overflows, false, "some columns are out of view at 1440");
    await expect(page.getByTestId("table-scroll-cue")).toHaveCount(0);
    for (const name of ["Lantern", "Repair bag", "Display stand"]) {
      const n = grid.getByLabel(`${name} Notes`, { exact: true });
      assert.ok(await inView(n), `${name}'s note is out of view`);
      assert.ok(
        (await n.evaluate((t) => t.scrollHeight - t.clientHeight)) <= 1,
        `${name}'s note scrolls inside`,
      );
    }
    // Short values show whole in their boxes, not cut off at a fixed width.
    const clipped = await grid.evaluate((el) =>
      [...el.querySelectorAll('td[data-type="text"]:not([data-long]) input')]
        .filter((i) => i.scrollWidth > i.clientWidth + 1)
        .map((i) => i.value),
    );
    assert.deepEqual(clipped, [], "short values are cut off in their boxes");
    await shot(page, "13-wide-table-desktop");
    const note = grid.getByLabel("Repair bag Notes", { exact: true });
    await note.scrollIntoViewIfNeeded();
    assert.ok(await inView(note), "the last column can't be brought into view");
    const kept = `${await note.inputValue()} Count the screwdrivers twice.`;
    await note.fill(kept);
    await page
      .getByRole("button", { name: "Save my edits", exact: true })
      .click();
    await expect(page.getByText("Your edits are saved.")).toBeVisible({
      timeout: 15000,
    });
    await page.reload();
    await expect(note).toHaveValue(kept, { timeout: 15000 });
    assert.ok(await noPageScroll(), "the saved wide table widens the page");
    await page.goto(
      `${origin}/spaces/${sec.workspace}/work/${sec.conversation_id}?work=${sec.loans_id}`,
    );
    await expect(page.locator(".space-work .flex-table")).toBeVisible({
      timeout: 15000,
    });
    assert.ok(await noPageScroll(), "the project page scrolls sideways");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(loansUrl);
    await expect(grid).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(300);
    assert.ok(await noPageScroll(), "the page scrolls sideways at 390");
    await shot(page, "13-wide-table-phone");
    await page.setViewportSize({ width: 1440, height: 1000 });
    pass(
      "a wide table stays inside the work pane: no sideways page scroll, row controls in view, out-of-view columns said, the last column edited and saved",
    );
  }

  // Removing a row or a part of a document can be undone in one click: it
  // comes back where it was, and nothing is left unsaved.
  {
    const kit = ids.kit;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(
      `${origin}/conversations/${kit.conversation_id}/artifacts/${kit.loans_id}?workspace=${kit.workspace}`,
    );
    const grid = page.getByRole("region", { name: "Editable table" });
    const items = () =>
      grid
        .locator('input[aria-label$=" Item"]')
        .evaluateAll((els) => els.map((e) => e.value));
    await expect(grid).toBeVisible({ timeout: 15000 });
    const rows = await items();
    await grid.getByRole("button", { name: "Remove Repair bag" }).click();
    await expect(page.getByTestId("undo-remove")).toContainText("Repair bag");
    assert.deepEqual(
      await items(),
      rows.filter((x) => x !== "Repair bag"),
    );
    await page
      .getByTestId("undo-remove")
      .getByRole("button", { name: "Undo" })
      .click();
    assert.deepEqual(await items(), rows);
    await expect(
      page.getByRole("button", { name: "Save my edits", exact: true }),
    ).toHaveCount(0);

    await page.goto(
      `${origin}/conversations/${cid}/artifacts/${planId}?workspace=${ws}`,
    );
    const parts = () =>
      page
        .locator(".doc-editable textarea")
        .evaluateAll((els) => els.map((e) => e.value));
    await expect(page.locator(".doc-editable textarea").first()).toBeVisible({
      timeout: 15000,
    });
    const before = await parts();
    assert.ok(before.length >= 2);
    await page.locator(".doc-editable .doc-remove").nth(1).click();
    await expect(page.getByTestId("undo-remove")).toContainText(
      before[1].slice(0, 20),
    );
    assert.equal((await parts()).length, before.length - 1);
    await page
      .getByTestId("undo-remove")
      .getByRole("button", { name: "Undo" })
      .click();
    assert.deepEqual(await parts(), before);
    await expect(
      page.getByRole("button", { name: "Save my edits", exact: true }),
    ).toHaveCount(0);
    pass(
      "a removed row or part comes back where it was with one Undo, leaving nothing unsaved",
    );
  }

  // Home says what changed since this device last showed it: proposals
  // waiting and work Workagent saved, from saved records, never the person's
  // own saves, never the decision already shown in full. A first visit says
  // nothing; a reload keeps the list; "Got it" clears it for good. The
  // marker is per device, so an earlier visit is stood in for by setting it
  // back before the fixture's work was made.
  {
    const home = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const tab = await home.newPage();
    const homeErrors = [];
    tab.on("pageerror", (e) => homeErrors.push(e.message));
    const homeURL = `${origin}/?workspace=${ws}`;
    const since = tab.getByTestId("since-you-left");
    const rows = tab.locator(".work-row[data-artifact]");
    await tab.goto(homeURL);
    await expect(rows.first()).toBeAttached({ timeout: 15000 });
    // Home is one agent's view: work from another space is here too, and
    // opens in its own space.
    const kitRow = tab.locator(
      `.work-row[data-artifact="${ids.kit.loans_id}"]`,
    );
    await expect(kitRow).toBeAttached({ timeout: 15000 });
    await expect(kitRow).toHaveAttribute(
      "href",
      new RegExp(`workspace=${ids.kit.workspace}`),
    );
    await expect(tab.getByTestId("home-unreadable")).toHaveCount(0);
    await expect
      .poll(() =>
        tab.evaluate((k) => localStorage.getItem(k), "workagent:seen:home"),
      )
      .not.toBeNull();
    await expect(since).toHaveCount(0);

    await tab.evaluate(() => {
      localStorage.setItem("workagent:seen:home", "2000-01-01T00:00:00Z");
      sessionStorage.clear();
    });
    await tab.reload();
    await expect(since).toBeVisible({ timeout: 15000 });
    const entries = await since.locator("li").evaluateAll((lis) =>
      lis.map((li) => ({
        id: li.dataset.artifact,
        text: li.querySelector("a").textContent,
        href: li.querySelector("a").getAttribute("href"),
      })),
    );
    assert.ok(entries.length >= 1 && entries.length <= 4, entries.length);
    const lead = await tab
      .locator(".decision-card[data-artifact]")
      .evaluateAll((els) => els[0]?.dataset.artifact ?? null);
    for (const e of entries) {
      assert.match(
        e.text,
        /^(A proposed version of “.+” is waiting for you|Workagent saved a new version of “.+”)$/,
      );
      assert.match(e.href, new RegExp(`/artifacts/${e.id}`));
      assert.notEqual(e.id, lead, "the decision shown in full isn't repeated");
      const note = await tab
        .locator(`.work-row[data-artifact="${e.id}"]`)
        .first()
        .textContent();
      if (e.text.startsWith("Workagent saved"))
        assert.ok(!note.includes("Last saved by you"), e.text);
      else assert.ok(note.includes("Decision needed"), e.text);
    }
    await expect(since).not.toContainText(/accepted|is ready to use|now fits/i);
    // The greeting says, in one line, what changed and what needs the
    // person; the entry comes first; recent work is one step away.
    const saved = entries.filter((e) =>
      e.text.startsWith("Workagent saved"),
    ).length;
    const lede = tab.locator(".lede");
    if (saved)
      await expect(lede).toContainText(
        saved === 1
          ? "Workagent saved a new version of one piece of work since you left."
          : "since you left.",
      );
    await expect(lede).not.toContainText(/done|accepted|ready to use/i);
    assert.ok(
      await tab.evaluate(
        () =>
          document
            .querySelector(".composer, form")
            .compareDocumentPosition(
              document.querySelector('[data-testid="since-you-left"]'),
            ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      "the entry comes before what changed",
    );
    const pick = tab.getByTestId("pick-up").locator("a");
    const picks = await pick.count();
    assert.ok(picks >= 1 && picks <= 3, `pick-up shows ${picks}`);
    for (let i = 0; i < picks; i++)
      assert.match(
        await pick.nth(i).getAttribute("href"),
        /\/conversations\/[^/]+\/artifacts\/[^/?]+/,
      );
    await shot(tab, "10-since-you-left");

    // A reload keeps the list; the work opens from it.
    await tab.reload();
    await expect(since.locator("li")).toHaveCount(entries.length, {
      timeout: 15000,
    });
    await since.locator("li a").first().click();
    await tab.waitForURL(new RegExp(`/artifacts/${entries[0].id}`));
    await tab.goBack();
    await expect(since).toBeVisible({ timeout: 15000 });

    // On a phone it fits.
    await tab.setViewportSize({ width: 390, height: 844 });
    await noOverflow(tab);
    await tab.screenshot({
      path: path.join(out, "10b-since-you-left-phone.png"),
    });

    // "Got it" clears it in this tab and the next.
    await since.getByRole("button", { name: "Got it" }).click();
    await expect(since).toHaveCount(0);
    await expect(tab.locator(".lede")).not.toContainText("since you left");
    await tab.reload();
    await expect(rows.first()).toBeAttached({ timeout: 15000 });
    await expect(since).toHaveCount(0);
    const next = await home.newPage();
    await next.goto(homeURL);
    await expect(next.locator(".work-row[data-artifact]").first()).toBeAttached(
      { timeout: 15000 },
    );
    await expect(next.getByTestId("since-you-left")).toHaveCount(0);
    assert.deepEqual(homeErrors, []);
    await home.close();
    pass(
      "Home says what changed since this device last showed it, in its greeting line and a short list: a proposal waiting or work Workagent saved, each opening the work; the entry comes first and recent work is one step away; the person's own saves and the decision shown in full aren't repeated; a first visit says nothing; it survives a reload, fits a phone, and Got it clears it",
    );
  }

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
