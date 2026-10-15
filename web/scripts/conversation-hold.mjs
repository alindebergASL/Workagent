// The full conversation holds sending while it can't confirm its current
// state: no send by the button, Ctrl+Enter, Cmd+Enter or form submission;
// drafting goes on; reconnecting sends nothing by itself; an unconfirmed
// send keeps its exact command for a deliberate replay. Real UI, API and
// PostgreSQL; read failures and a lost acknowledgement are injected in the
// browser. No provider calls (run with NOWORKER=1).
// Usage (stack running, runtime env): node web/scripts/conversation-hold.mjs <out-dir>
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const report = { provider_calls: "not_performed", cases: [] };
const pass = (name) => {
  report.cases.push(name);
  console.log("PASS", name);
};
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(origin);
  await page.getByLabel("Message your agent").fill("Plan the volunteer rota.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForURL(/\/conversations\/[^/?]+$/);
  const cid = new URL(page.url()).pathname.split("/").pop();
  const readURL = `**/api/domain/**/conversations/${cid}`;
  const postURL = `**/api/domain/**/conversations/${cid}/messages`;
  const posts = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname.endsWith(`/conversations/${cid}/messages`)
    )
      posts.push(r.postDataJSON());
  });

  const box = page.getByLabel("Continue the conversation");
  const send = page.locator(".conversation-ask").getByRole("button", {
    name: "Send",
    exact: true,
  });
  const notice = page.getByText("Connection lost.", { exact: false });
  const goStale = async () => {
    await page.route(readURL, (route) =>
      route.request().method() === "GET"
        ? route.abort("failed")
        : route.continue(),
    );
    await page.getByRole("button", { name: "Refresh conversation" }).click();
    await expect(notice).toBeVisible({ timeout: 15000 });
  };
  const reconnect = async () => {
    await page.unroute(readURL);
    await page.getByRole("button", { name: "Refresh conversation" }).click();
    await expect(notice).toHaveCount(0, { timeout: 15000 });
  };
  const tryAllPaths = async () => {
    await box.press("Control+Enter");
    await box.press("Meta+Enter");
    await page.evaluate(() =>
      document.querySelector(".conversation-ask").requestSubmit(),
    );
    await page.waitForTimeout(500);
  };

  // Stale: drafting continues, nothing sends by any path.
  await box.fill("Hold this while offline");
  const before = posts.length;
  await goStale();
  await expect(send).toBeDisabled();
  await expect(notice).toContainText("sending waits until it reconnects");
  await expect(
    page.locator("button", { hasText: "Run attached input" }),
  ).toBeDisabled();
  await box.fill("Hold this while offline, edited");
  await tryAllPaths();
  assert.equal(posts.length, before);
  await page.screenshot({
    path: path.join(out, "hold-stale.png"),
    fullPage: true,
  });
  pass(
    "stale: no send by button, Ctrl+Enter, Cmd+Enter or submit; drafting continues",
  );

  // Reconnecting sends nothing by itself; one deliberate send goes.
  await reconnect();
  await page.waitForTimeout(2500);
  assert.equal(posts.length, before);
  await expect(box).toHaveValue("Hold this while offline, edited");
  await send.click();
  await expect(box).toHaveValue("", { timeout: 15000 });
  assert.equal(posts.length, before + 1);
  assert.equal(posts.at(-1).text, "Hold this while offline, edited");
  pass("reconnecting sends nothing; one deliberate send after it");

  // An unconfirmed send keeps its exact identity through a stale period.
  let lose = true;
  await page.route(postURL, async (route) => {
    if (!lose) return route.continue();
    lose = false;
    const r = await route.fetch();
    assert.ok(r.ok());
    return route.abort("failed");
  });
  await box.fill("Exact replay please");
  const lostAt = posts.length;
  await send.click();
  await expect(
    page.getByText("Your last send wasn’t confirmed.", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await goStale();
  await expect(send).toBeDisabled();
  await page.evaluate(() =>
    document.querySelector(".conversation-ask").requestSubmit(),
  );
  await page.waitForTimeout(500);
  assert.equal(posts.length, lostAt + 1);
  await reconnect();
  await page.waitForTimeout(2500);
  assert.equal(posts.length, lostAt + 1);
  await send.click();
  await expect(box).toHaveValue("", { timeout: 15000 });
  assert.equal(posts.length, lostAt + 2);
  const [first, replay] = posts.slice(lostAt);
  assert.equal(replay.command_id, first.command_id);
  assert.equal(replay.expected_work_version, first.expected_work_version);
  assert.equal(replay.text, first.text);
  await page.unroute(postURL);
  pass("an unconfirmed send is held while stale and replays exactly after");

  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "conversation-hold.json"),
    JSON.stringify({ ...report, conversation_id: cid }, null, 2),
  );
} finally {
  await browser.close();
}
