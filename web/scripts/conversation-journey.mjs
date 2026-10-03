/**
 * B1 conversation through the actual UI, API and PostgreSQL. Turns advance
 * only through Hermes' controlled GeneralWorker batch (no provider, no
 * inference); replies are wiring receipts, never shown as model answers.
 *
 * Checks: source-free start from Home (two commands, draft kept until
 * admission); a queued turn reads as waiting, never replied; the worker's
 * reply appears with its test label; follow-up and steering (a new message
 * stops the unfinished turn); a stale version keeps the text; draft survives
 * reload; explicit hand-over records a paused, linked assignment that offers no
 * Resume; ending the conversation. Desktop and phone captures.
 *
 * Usage (stack running, runtime env): node web/scripts/conversation-journey.mjs <out-dir>
 */
import { chromium, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const base = `${origin}/api/domain/v1/workspaces/local-workspace`;
const headers = {
  "X-Workagent-Client": "local-ui",
  "Content-Type": "application/json",
};
const api = async (p, body) => {
  const r = await fetch(base + p, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};
const cmd = () => ({
  schema_version: "workagent/v1",
  request_id: crypto.randomUUID(),
  command_id: crypto.randomUUID(),
});
const worker = () =>
  JSON.parse(
    execFileSync(
      path.join(root, "backend/.venv/bin/python"),
      [
        "-m",
        "workagent.general_worker",
        "--controlled",
        "--workspace",
        "local-workspace",
      ],
      { cwd: path.join(root, "backend"), env: process.env, encoding: "utf8" },
    ),
  );

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const errors = [];
const record = { worker_batches: [] };
const shot = (page, name) =>
  page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
const noScroll = async (page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));

  // ---- Home: start talking, no sources ----
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "Good to see you." }),
  ).toBeVisible({
    timeout: 15000,
  });
  const first = "Help me think about how to plan next week.";
  await page.getByLabel("Message your agent").fill(first);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForURL(/\/conversations\/[^/?]+$/, { timeout: 15000 });
  const cid = page.url().split("/").pop();
  record.conversation_id = cid;
  const thread = page.getByRole("list", { name: "Conversation" });
  await expect(thread.locator(".msg-person").first()).toHaveText(
    `You: ${first}`,
  );
  await expect(
    page.getByText("Waiting for a reply. Nothing has been answered yet."),
  ).toBeVisible();
  await expect(page.locator(".msg-agent")).toHaveCount(0);
  let detail = (await api(`/conversations/${cid}`)).body;
  expect(detail.conversation.selected_source_refs).toEqual([]);
  expect(detail.runs.map((r) => r.state)).toEqual(["queued"]);
  expect(detail.assignment_ids).toEqual([]);
  await noScroll(page);
  await shot(page, "01-conversation-waiting-desktop");

  // The Home draft was cleared only after the message was admitted.
  await page.goto(origin);
  await expect(page.getByLabel("Message your agent")).toHaveValue("");
  await expect(page.getByRole("link", { name: "Conversations" })).toBeVisible();

  // ---- the controlled worker answers; the UI shows it with its label ----
  record.worker_batches.push(worker());
  await page.goto(`${origin}/conversations/${cid}`);
  await expect(thread.locator(".msg-agent")).toHaveCount(1, { timeout: 15000 });
  await expect(thread.locator(".msg-tag")).toHaveText("Test reply");
  await expect(page.getByText("Waiting for a reply.")).toHaveCount(0);
  detail = (await api(`/conversations/${cid}`)).body;
  const reply = detail.messages.find((m) => m.author_kind === "assistant");
  expect(reply.evidence_origin).toBe("controlled_transport");
  await expect(thread.locator(".msg-agent p")).toContainText(reply.text);
  await shot(page, "02-conversation-replied-desktop");

  // ---- follow-up, then steering: a newer message stops the unfinished turn ----
  const box = page.getByLabel("Continue the conversation");
  await box.fill("Keep it short.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(box).toHaveValue("");
  await expect(
    page.getByText("Waiting for a reply. Nothing has been answered yet."),
  ).toBeVisible();
  await expect(
    page.getByText(/Sending now replaces the reply in progress/),
  ).toBeVisible();
  await box.fill("Actually, focus on Monday.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Stopped before a reply. Your message is kept."),
  ).toBeVisible();
  record.worker_batches.push(worker());
  await expect(thread.locator(".msg-agent")).toHaveCount(2, { timeout: 15000 });
  detail = (await api(`/conversations/${cid}`)).body;
  record.run_states = detail.runs.map((r) => r.state);
  expect(record.run_states).toEqual(["ready", "cancelled", "ready"]);
  await shot(page, "03-conversation-steered-desktop");

  // ---- a stale version keeps the text and nothing is written ----
  await box.fill("Add Tuesday too.");
  const before = detail.messages.length;
  const other = await api(`/conversations/${cid}/messages`, {
    ...cmd(),
    expected_work_version: detail.conversation.work_version,
    text: "Sent from another tab.",
  });
  expect(other.status).toBe(202);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText(/This conversation changed since you looked/),
  ).toBeVisible();
  await expect(box).toHaveValue("Add Tuesday too.");
  expect((await api(`/conversations/${cid}`)).body.messages.length).toBe(
    before + 1,
  );
  // The unsent text survives a reload too.
  await page.reload();
  await expect(page.getByLabel("Continue the conversation")).toHaveValue(
    "Add Tuesday too.",
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Continue the conversation")).toHaveValue("");
  record.worker_batches.push(worker());

  // ---- explicit hand-over: recorded, paused, linked; no Resume ----
  await page.getByRole("button", { name: "Take it from here" }).click();
  await expect(
    page.getByRole("heading", { name: "Hand this over" }),
  ).toBeVisible();
  await page.getByLabel("Done when").fill("We’ve reviewed the plan together");
  await shot(page, "04-handover-desktop");
  await page.getByRole("button", { name: "Record hand-over" }).click();
  await expect(
    page.getByRole("heading", { name: "Handed over" }),
  ).toBeVisible();
  detail = (await api(`/conversations/${cid}`)).body;
  expect(detail.assignment_ids).toHaveLength(1);
  const aid = detail.assignment_ids[0];
  record.assignment_id = aid;
  const assignment = (await api(`/assignments/${aid}`)).body;
  expect(assignment.state).toBe("paused");
  expect(assignment.conversation_id).toBe(cid);
  expect(assignment.goal).toBe(first);
  await page.getByRole("link", { name: /Recorded hand-over/ }).click();
  await page.waitForURL(/\/assignments\//);
  await expect(page.locator("header .status").first()).toHaveText(
    "Handed over · not started",
  );
  await expect(page.getByRole("button", { name: "Resume" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "From a conversation ↗" }),
  ).toHaveAttribute("href", `/conversations/${cid}`);
  await expect(page.getByRole("button", { name: "Stop…" })).toBeVisible();
  await shot(page, "05-handover-assignment-desktop");

  // Home never presents it as being handled.
  await page.goto(origin);
  await expect(page.locator(`[data-assignment="${aid}"] .status`)).toHaveText(
    "Handed over · not started",
  );
  await expect(page.locator(".since-handling")).toHaveCount(0);
  await shot(page, "06-home-desktop");

  // ---- a second conversation from Home: "Take it from here" without context ----
  await page
    .getByLabel("Message your agent")
    .fill("Take the weekly review off my plate.");
  await page.getByRole("button", { name: "Take it from here" }).click();
  await page.waitForURL(/\/conversations\/[^/]+\?handover=1$/, {
    timeout: 15000,
  });
  await expect(
    page.getByRole("heading", { name: "Hand this over" }),
  ).toBeVisible();
  await expect(page.getByLabel("What to carry forward")).toHaveValue(
    "Take the weekly review off my plate.",
  );
  await page.getByRole("button", { name: "Not now" }).click();

  // ---- end the conversation ----
  await page.goto(`${origin}/conversations/${cid}`);
  await page.getByText("End this conversation").click();
  await page.getByRole("button", { name: "End…" }).click();
  await page.getByRole("button", { name: "End conversation" }).click();
  await expect(
    page.getByText("This conversation has ended. Its history is kept."),
  ).toBeVisible();
  expect((await api(`/conversations/${cid}`)).body.conversation.state).toBe(
    "cancelled",
  );
  await shot(page, "07-conversation-ended-desktop");

  // ---- phone ----
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(`${origin}/conversations`);
  await expect(phone.locator(`[data-conversation="${cid}"]`)).toContainText(
    "Ended",
  );
  await noScroll(phone);
  await shot(phone, "08-conversations-mobile");
  const open = (await api("/conversations")).body.items.find(
    (c) => c.id !== cid,
  );
  await phone.goto(`${origin}/conversations/${open.id}`);
  await phone
    .getByLabel("Continue the conversation")
    .fill("Start with the agenda.");
  await phone.getByRole("button", { name: "Send", exact: true }).click();
  await expect(phone.getByLabel("Continue the conversation")).toHaveValue("");
  record.worker_batches.push(worker());
  await expect(phone.locator(".msg-agent")).toHaveCount(1, { timeout: 15000 });
  await noScroll(phone);
  await shot(phone, "09-conversation-mobile");
  await phone.goto(`${origin}/conversations/${cid}`);
  await shot(phone, "10-conversation-ended-mobile");

  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        passed: true,
        mode: "actual_application_postgresql_controlled_transport",
        provider_inference_calls: 0,
        ...record,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS: real B1 conversation, steering, CAS, hand-over and end through the UI",
  );
} finally {
  await browser.close();
}
