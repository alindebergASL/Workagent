// Work in a second workspace opens in that workspace, through the real UI,
// API and PostgreSQL. The person has two personal workspaces; the second is
// listed after the first, so anything that falls back to "the first personal
// workspace" reads the wrong one and shows authorized work as not available.
// Records come from web/scripts/space_demo_fixture.py (real worker, synthetic
// provider transport; no live model). Run without a worker: sends are
// admitted and stay queued. The build sets NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1.
// Usage: node web/scripts/workspace-routing.mjs <out-dir> <ids.json>
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(process.argv[2]);
const ids = JSON.parse(await readFile(process.argv[3], "utf8"));
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const first = ids.workspace;
const {
  workspace: second,
  conversation_id: projectId,
  artifact_id: scheduleId,
  assignment_ids: [handoverId],
  chat_id: chatId,
} = ids.second;
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

// Every record read or write, by the workspace it was sent to.
const RECORD =
  /\/api\/domain\/v1\/workspaces\/([^/]+)\/(conversations|assignments|artifacts|work-areas|observations)\b/;
const reads = [];
const posts = [];
const notAvailable = (page) =>
  expect(
    page
      .getByRole("alert")
      .filter({ hasText: /not available|isn’t available/i }),
  ).toBeVisible({ timeout: 15000 });

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => {
    const m = RECORD.exec(r.url());
    if (!m) return;
    reads.push({ ws: m[1], url: r.url(), method: r.method() });
    if (r.method() === "POST" && r.url().endsWith("/messages"))
      posts.push({ ws: m[1], ...JSON.parse(r.postData() ?? "{}") });
  });
  const since = () => {
    const at = reads.length;
    return () => reads.slice(at);
  };
  // The sidebar's "Your work" lists projects from every workspace the
  // person can open, on every page: that list read is the navigation, not
  // the page's records, so only it may go elsewhere.
  const navList = (r) =>
    r.method === "GET" && /\/work-areas\?limit=\d+$/.test(r.url);
  const onlyIn = (got, ws, what) => {
    const elsewhere = got().filter((r) => r.ws !== ws && !navList(r));
    assert.deepEqual(
      elsewhere,
      [],
      `${what}: every record read stays in ${ws}`,
    );
    assert.ok(got().length > 0, `${what}: records were read`);
  };

  // Choosing the workspace on Spaces, then opening its work from there.
  await page.goto(`${origin}/spaces`);
  await page
    .getByRole("main")
    .getByRole("link", { name: /^Personal work/ })
    .click();
  await page.waitForURL(`**/spaces/${second}`);
  let got = since();
  const workRow = page.locator(`a.work-row[data-artifact="${scheduleId}"]`);
  await expect(workRow).toHaveAttribute(
    "href",
    `/conversations/${projectId}/artifacts/${scheduleId}?workspace=${second}`,
    { timeout: 15000 },
  );
  await workRow.click();
  await expect(
    page.getByText("Doors at 10:00", { exact: false }).first(),
  ).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText(/not available|isn’t available/i)).toHaveCount(0);
  await expect(page.locator(".back-link")).toHaveText("← Spring open day");
  await shot(page, "01-work-in-second-workspace");
  onlyIn(got, second, "work opened from the Space");
  await page.reload();
  await expect(
    page.getByText("Doors at 10:00", { exact: false }).first(),
  ).toBeVisible({
    timeout: 15000,
  });
  pass(
    "work listed in the second workspace opens there, and stays there on reload",
  );

  // A hand-over listed in that workspace.
  await page.goto(`${origin}/spaces/${second}`);
  got = since();
  const handRow = page.locator(
    `a.work-row[href^="/assignments/${handoverId}"]`,
  );
  await expect(handRow).toHaveAttribute(
    "href",
    `/assignments/${handoverId}?workspace=${second}`,
    { timeout: 15000 },
  );
  await handRow.click();
  await expect(
    page.getByText("Get two volunteers for the welcome desk").first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".back-link")).toHaveText(
    "← Back to Personal work",
  );
  await expect(page.locator(".back-link")).toHaveAttribute(
    "href",
    `/spaces/${second}`,
  );
  await shot(page, "02-handover-in-second-workspace");
  onlyIn(got, second, "hand-over");
  pass("a hand-over in the second workspace opens there; back leads to it");

  // A plain conversation from its Conversations tab, then a reply from it
  // whose acknowledgement is lost: after a reload it replays exactly, in the
  // same workspace.
  await page.goto(`${origin}/spaces/${second}`);
  await page.getByRole("tab", { name: "Conversations" }).click();
  got = since();
  const chatRow = page.locator(`a[data-conversation="${chatId}"]`);
  await expect(chatRow).toHaveAttribute(
    "href",
    `/conversations/${chatId}?workspace=${second}`,
    { timeout: 15000 },
  );
  await chatRow.click();
  await expect(
    page.getByText("Eleven works well", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  const box = page.locator("#follow-up");
  const send = page.getByRole("button", { name: "Send", exact: true });
  const msgUrl = `**/conversations/${chatId}/messages`;
  await page.route(msgUrl, async (route) => {
    const r = await route.fetch();
    assert.ok(r.ok());
    return route.abort("failed");
  });
  await box.fill("And the second talk?");
  const before = posts.length;
  await send.click();
  await expect(
    page.getByText("wasn’t confirmed", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await page.unroute(msgUrl);
  await page.reload();
  await expect(
    page.getByText("Eleven works well", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText("wasn’t confirmed", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(send).toBeEnabled({ timeout: 15000 });
  await send.click();
  await expect(
    page.getByText("And the second talk?", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  const [lost, replay] = posts.slice(before);
  assert.equal(lost.ws, second);
  assert.equal(replay.ws, second);
  assert.equal(replay.command_id, lost.command_id);
  assert.equal(replay.text, lost.text);
  await shot(page, "03-conversation-in-second-workspace");
  onlyIn(got, second, "conversation");
  pass(
    "a conversation in the second workspace opens there; an unconfirmed send replays its exact command there after a reload",
  );

  // From the project's own page: the work, the full conversation, and the
  // hand-over it records.
  await page.goto(`${origin}/spaces/${second}/work/${projectId}`);
  got = since();
  await page
    .locator(`button.space-work-item[data-artifact="${scheduleId}"]`)
    .click();
  await page.getByRole("link", { name: "Open to edit" }).click();
  await expect(
    page.getByText("Doors at 10:00", { exact: false }).first(),
  ).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText(/not available|isn’t available/i)).toHaveCount(0);
  await page.goto(`${origin}/spaces/${second}/work/${projectId}`);
  await page.getByRole("link", { name: "Open the full conversation" }).click();
  await expect(
    page.getByText("Here’s a first schedule", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("link", { name: "Open the project" }),
  ).toHaveAttribute("href", `/spaces/${second}/work/${projectId}`);
  await page.locator(`a[data-assignment="${handoverId}"]`).click();
  await expect(
    page.getByText("Get two volunteers for the welcome desk").first(),
  ).toBeVisible({ timeout: 15000 });
  onlyIn(got, second, "project page and its links");
  pass(
    "from the project page, its work, full conversation and hand-over all open in its workspace",
  );

  // While the list of workspaces is still loading, a project page already
  // knows its workspace from its address: its links carry it at once.
  let releaseList;
  const listHeld = new Promise((r) => (releaseList = r));
  const isList = (url) => new URL(url).pathname.endsWith("/v1/workspaces");
  let listSeen = false;
  await page.route(isList, async (route) => {
    listSeen = true;
    await listHeld;
    await route.continue();
  });
  await page.goto(
    `${origin}/spaces/${second}/work/${projectId}?work=${scheduleId}`,
  );
  const openEdit = page.getByRole("link", { name: "Open to edit" });
  await expect(openEdit).toBeVisible({ timeout: 15000 });
  assert.ok(listSeen, "the workspace list was requested and is still held");
  await expect(openEdit).toHaveAttribute(
    "href",
    `/conversations/${projectId}/artifacts/${scheduleId}?workspace=${second}`,
  );
  await expect(
    page.getByRole("link", { name: "Open the full conversation" }),
  ).toHaveAttribute("href", `/conversations/${projectId}?workspace=${second}`);
  const listDone = page.waitForResponse((r) => isList(r.url()));
  releaseList();
  await listDone;
  await page.unroute(isList);
  pass(
    "before the workspace list loads, a project page's links already name its workspace",
  );

  // A workspace this person can't open is not available, and nothing is
  // read from it or from any other workspace instead.
  // Leave the previous page first, so its own polling can't be counted.
  await page.goto("about:blank");
  for (const named of ["isolated-workspace", "no-such-workspace"]) {
    got = since();
    await page.goto(`${origin}/conversations/${chatId}?workspace=${named}`);
    await notAvailable(page);
    await expect(page.getByText("Eleven works well")).toHaveCount(0);
    assert.deepEqual(
      got().filter((r) => !navList(r)),
      [],
      `nothing is read for ${named}`,
    );
    assert.ok(
      got().every((r) => r.ws !== named),
      `the sidebar doesn't read ${named} either`,
    );
  }
  await shot(page, "04-workspace-not-available");
  // An address that names no workspace keeps its earlier meaning: the
  // default one. Old work there still opens; work from elsewhere isn't
  // shown as if it were there.
  await page.goto(`${origin}/conversations/${ids.plain.conversation_id}`);
  await expect(
    page.getByText("About 15 minutes mid-morning", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });
  await page.goto(`${origin}/conversations/${chatId}`);
  await notAvailable(page);
  await page.goto(`${origin}/`);
  const firstLink = page
    .locator(`a.work-row[href*="workspace=${first}"]`)
    .first();
  await expect(firstLink).toBeVisible({ timeout: 15000 });
  pass(
    "an unopenable workspace is not available and reads nothing; addresses without one still mean the default workspace, whose links now name it",
  );

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const p2 = await phone.newPage();
  await p2.goto(
    `${origin}/conversations/${projectId}/artifacts/${scheduleId}?workspace=${second}`,
  );
  await expect(
    p2.getByText("Doors at 10:00", { exact: false }).first(),
  ).toBeVisible({
    timeout: 15000,
  });
  await shot(p2, "05-work-in-second-workspace-390");
  await phone.close();
  pass("a shared link to work in the second workspace opens on a phone");

  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "workspace-routing.json"),
    JSON.stringify({ ...report, ids: ids.second, first }, null, 2),
  );
} finally {
  await browser.close();
}
