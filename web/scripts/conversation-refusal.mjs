// A conversation the service won't answer in says so plainly, wherever the
// message was written: Home, the full conversation, and the pane beside the
// work. Nothing is sent, the draft stays, and a retry that can't change the
// outcome isn't offered. A conversation whose answers were turned off holds
// sending before anything is typed. Real UI, API and PostgreSQL with the
// service's default admission (no fixture turns): its refusals are real.
// The turned-off activation is injected into the conversation read only.
// No provider calls.
// Usage (stack running without WORKAGENT_FIXTURE_MODE, space fixture seeded):
//   node web/scripts/conversation-refusal.mjs <out-dir> <ids.json>
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const ids = JSON.parse(await readFile(process.argv[3], "utf8"));
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const ws = ids.workspace;
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
const NOT_SET_UP = "Workagent isn’t set up to answer here yet";
const RAW = /Operation cannot proceed|Review current state and authority/;

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const creates = [];
  const sends = [];
  page.on("response", (r) => {
    const p = new URL(r.url()).pathname;
    if (r.request().method() !== "POST") return;
    if (p.endsWith("/conversations")) creates.push(r.status());
    if (p.endsWith("/messages")) sends.push(r.status());
  });

  // Home: the conversation is made, its first message is refused.
  await page.goto(`${origin}/?workspace=${ws}`);
  const ask = page.getByLabel("Message your agent");
  const draft = "Draft the volunteer rota for Saturday.";
  await ask.fill(draft);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const alert = page.locator(".notice-error");
  await expect(alert).toContainText(NOT_SET_UP, { timeout: 15000 });
  await expect(alert).toContainText("Nothing was sent");
  await expect(alert).not.toContainText(RAW);
  await expect(ask).toHaveValue(draft);
  await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0);
  assert.ok(new URL(page.url()).pathname === "/");
  assert.deepEqual(sends, [422]);
  // Sending again reuses the conversation already made; no second one.
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => sends.length, { timeout: 15000 }).toBe(2);
  await expect(alert).toContainText(NOT_SET_UP);
  assert.equal(creates.length, 1);
  await page.screenshot({ path: path.join(out, "home-refused.png") });
  pass(
    "Home: a refused first message says the conversation isn't set up to answer, keeps the draft and offers no futile retry",
  );

  // The full conversation: the same refusal, the draft kept.
  const reads = [];
  page.on("response", async (r) => {
    const p = new URL(r.url()).pathname;
    if (
      r.request().method() === "GET" &&
      /\/conversations\/[^/]+$/.test(p) &&
      r.ok()
    )
      reads.push(p.split("/").pop());
  });
  await page.goto(`${origin}/conversations?workspace=${ws}`);
  await page
    .getByRole("link", { name: /Draft the volunteer rota/ })
    .first()
    .click();
  await page.waitForURL(/\/conversations\/[^/?]+/);
  const cid = new URL(page.url()).pathname.split("/").pop();
  const box = page.getByLabel("Continue the conversation");
  const send = page
    .locator(".conversation-ask")
    .getByRole("button", { name: "Send", exact: true });
  const follow = "Add a backup for the 2pm slot.";
  await box.fill(follow);
  const before = sends.length;
  await send.click();
  const pageAlert = page.locator(".conversation-ask").getByRole("alert");
  await expect(pageAlert).toContainText(NOT_SET_UP, { timeout: 15000 });
  await expect(pageAlert).not.toContainText(RAW);
  await expect(box).toHaveValue(follow);
  assert.deepEqual(sends.slice(before), [422]);
  await page.screenshot({ path: path.join(out, "conversation-refused.png") });
  pass(
    "the full conversation shows the same plain refusal and keeps the reply",
  );

  // Turned off: the notice is there before anything is typed; nothing sends.
  const readURL = `**/api/domain/**/conversations/${cid}`;
  await page.route(readURL, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const r = await route.fetch();
    const body = await r.json();
    body.conversation.model_activation = "revoked";
    return route.fulfill({ response: r, json: body });
  });
  await page.reload();
  await expect(page.getByTestId("answers-off")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("answers-off")).toContainText(
    "Answers are turned off for this conversation",
  );
  await expect(box).toHaveValue(follow);
  await expect(send).toBeDisabled();
  const held = sends.length;
  await box.press("Control+Enter");
  await page.evaluate(() =>
    document.querySelector(".conversation-ask").requestSubmit(),
  );
  await page.waitForTimeout(500);
  assert.equal(sends.length, held);
  await page.unroute(readURL);
  pass(
    "a conversation with answers turned off says so before typing and holds every send path",
  );

  // Beside the work: the pane's reply is refused the same way. The space
  // fixture's own conversations are activated, so the one above becomes a
  // project (still without answers turned on).
  const promoted = await page.evaluate(
    async ({ ws, cid }) => {
      const api = `/api/domain/v1/workspaces/${ws}`;
      const h = () => ({
        "content-type": "application/json",
        "x-workagent-client": "local-ui",
        "x-schema-version": "workagent/v1",
        "x-request-id": crypto.randomUUID(),
      });
      const now = await (
        await fetch(`${api}/conversations/${cid}`, { headers: h() })
      ).json();
      const r = await fetch(`${api}/work-areas/${cid}`, {
        method: "POST",
        headers: h(),
        body: JSON.stringify({
          schema_version: "workagent/v1",
          request_id: crypto.randomUUID(),
          command_id: crypto.randomUUID(),
          expected_work_version: now.conversation.work_version,
          title: "Volunteer rota",
          goal: "Staff the Saturday event with volunteers.",
          kind: "project",
        }),
      });
      return { ok: r.ok, body: await r.text() };
    },
    { ws, cid },
  );
  assert.ok(promoted.ok, promoted.body);
  await page.goto(`${origin}/spaces/${ws}/work/${cid}`);
  const peekBox = page.getByLabel("Ask, or ask for a change", { exact: true });
  await expect(peekBox).toBeEditable({ timeout: 15000 });
  await page.waitForLoadState("networkidle");
  const peekDraft = "Move the coffee break to 11.";
  await peekBox.fill(peekDraft);
  await expect(peekBox).toHaveValue(peekDraft);
  const peekBefore = sends.length;
  await page
    .locator(".peek-ask")
    .getByRole("button", { name: "Send", exact: true })
    .click();
  const peekAlert = page.locator(".peek-ask").getByRole("alert");
  await expect(peekAlert).toContainText(NOT_SET_UP, { timeout: 15000 });
  await expect(peekAlert).not.toContainText(RAW);
  await expect(peekBox).toHaveValue(peekDraft);
  assert.deepEqual(sends.slice(peekBefore), [422]);
  await page.screenshot({ path: path.join(out, "peek-refused.png") });
  pass("the pane beside the work shows the same refusal and keeps the reply");

  assert.deepEqual(errors, []);
  report.reads = reads.length;
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
