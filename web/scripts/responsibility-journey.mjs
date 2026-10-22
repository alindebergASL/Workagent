// A recorded hand-over gets a canonical responsibility (activated through the
// real API, as the runtime would), then is read and steered through the UI.
// Controlled stack only: no provider calls. Asserts nothing claims running
// work while execution isn't admitted.
// Usage (stack running, runtime env): node web/scripts/responsibility-journey.mjs <out-dir>
import { chromium, expect } from "@playwright/test";
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
  if (!r.ok) throw new Error(`${r.status} ${p}: ${JSON.stringify(json)}`);
  return json;
}
const cmd = () => ({
  schema_version: "workagent/v1",
  request_id: crypto.randomUUID(),
  command_id: crypto.randomUUID(),
});
const shot = (page, name) =>
  page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));

  // A conversation, then an explicit hand-over recorded through the UI.
  await page.goto(origin);
  await page
    .getByLabel("Message your agent")
    .fill("Help me run the volunteer briefing.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForURL(/\/conversations\/[^/?]+(?:\?[^#]*)?$/);
  const cid = new URL(page.url()).pathname.split("/").pop();
  await expect(page.locator(".msg-agent")).toHaveCount(1, { timeout: 15000 });
  await page.getByRole("button", { name: "Record a hand-over" }).click();
  await page.getByLabel("Done when").fill("The briefing is ready to send");
  await page.getByRole("button", { name: "Save paused hand-over" }).click();
  await expect(page.getByRole("heading", { name: "Handed over" })).toBeVisible({
    timeout: 15000,
  });
  const aid = (await api(`/conversations/${cid}`)).assignment_ids[0];

  // Before activation: no responsibility, the page reads as it did.
  await page.goto(`${origin}/assignments/${aid}`);
  await expect(page.getByText("Ownership at a glance")).toBeVisible();
  await expect(page.getByTestId("responsibility")).toHaveCount(0);

  // Activation through the generated route, as the runtime would record it.
  const assignment = await api(`/assignments/${aid}`);
  const activated = await api(`/assignments/${aid}/responsibility`, {
    ...cmd(),
    expected_work_version: assignment.work_version,
    current_outcome: "A draft briefing outline is saved.",
    next_action: {
      kind: "request_decision",
      description: "Decide who opens the doors.",
    },
    wait: { kind: "person", reason: "Asha to confirm the room." },
  });
  expect(activated.provider_execution_queued).toBe(false);
  expect(activated.lifecycle.execution_status).toBe("not_admitted");

  await page.reload();
  const panel = page.getByTestId("responsibility");
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel.getByRole("heading")).toHaveText(
    activated.lifecycle.state === "waiting_person"
      ? "Waiting for a person"
      : "Recorded as yours to carry forward",
  );
  await expect(page.getByTestId("responsibility-execution")).toHaveText(
    "Nothing is running for it right now.",
  );
  // The fuller account is a step away, and still claims no run.
  await expect(page.getByTestId("responsibility-why")).toHaveText(
    "It hasn’t been admitted to run, so nothing runs in the background for it.",
  );
  // No older claim that it can never run sits beside the record.
  await expect(page.getByText("can’t start work on my own")).toHaveCount(0);
  await expect(page.getByText("I own")).toHaveCount(0);
  // What it has done so far leads the page, in its own recorded words.
  await expect(page.getByTestId("responsibility-outcome")).toHaveText(
    "A draft briefing outline is saved.",
  );
  await expect(panel).toContainText("Decide who opens the doors.");
  await expect(panel).toContainText("Waiting on");
  await expect(panel).toContainText("Asha to confirm the room.");
  // One set of steering only; what finishes it is one line, not a card.
  await expect(page.getByRole("button", { name: "Stop…" })).toHaveCount(0);
  await expect(page.getByText("Ownership at a glance")).toHaveCount(0);
  await expect(page.getByTestId("done-when")).toHaveText(
    "Done when The briefing is ready to send",
  );
  await shot(page, "01-responsibility-desktop");
  await page.setViewportSize({ width: 390, height: 900 });
  await noOverflow(page);
  await shot(page, "02-responsibility-phone");
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Pause, then resume, through the canonical control route.
  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(panel.getByRole("heading")).toHaveText("Paused");
  expect(
    (await api(`/assignments/${aid}/responsibility`)).lifecycle.state,
  ).toBe("paused");
  await panel.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(panel.getByRole("heading")).not.toHaveText("Paused");
  await expect(page.getByTestId("responsibility-execution")).toContainText(
    "Nothing is running",
  );

  // Take it back: confirmed, recorded, and then nothing left to steer.
  await panel
    .getByRole("button", { name: "Take this back", exact: true })
    .click();
  await panel
    .getByRole("group", { name: "Confirm" })
    .getByRole("button", { name: "Take this back", exact: true })
    .click();
  await expect(panel.getByRole("heading")).toHaveText("You took this back");
  // Only the read-only "Check again" remains; nothing left to steer.
  await expect(
    panel.getByRole("button", { name: /^(Pause|Resume|Stop|Take this back)$/ }),
  ).toHaveCount(0);
  await expect(page.getByTestId("responsibility-execution")).toHaveText(
    "It’s back with you. Workagent isn’t holding it any more.",
  );
  const final = await api(`/assignments/${aid}/responsibility`);
  expect(final.lifecycle.state).toBe("taken_over");
  expect(final.provider_execution_queued).toBe(false);
  await shot(page, "03-responsibility-taken-back");

  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "responsibility.json"),
    JSON.stringify(
      {
        provider_calls: "not_performed",
        evidence_origin: "controlled_transport",
        conversation_id: cid,
        assignment_id: aid,
        activated_state: activated.lifecycle.state,
        final_state: final.lifecycle.state,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS responsibility read/steer through the real UI, no provider calls",
  );
} finally {
  await browser.close();
}
