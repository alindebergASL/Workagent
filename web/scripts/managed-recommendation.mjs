/**
 * IR-L2 browser check against real records made by the actual Responses worker
 * (backend `workagent.responses_journey`: real PostgreSQL, product worker,
 * domain and broker; synthetic HTTPX transport; zero provider calls).
 *
 * The journey writes to its own workspace, so the browser's workspace LIST is
 * narrowed to that workspace; every other read is the real API. Checks that
 * the assignment shows the current managed group from the saved document
 * (not "Review the saved work"), that the footer makes no global fixture
 * claim, and captures 1440/390/320 px.
 *
 * Usage (stack running, env sourced): node web/scripts/managed-recommendation.mjs <journey.json> <out-dir>
 */
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const journey = JSON.parse(await readFile(process.argv[2], "utf8"));
const out = path.resolve(process.argv[3]);
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const ws = journey.workspace_id;
const base = `${origin}/api/domain/v1/workspaces/${ws}`;
const headers = { "X-Workagent-Client": "local-ui" };
const api = async (p) => {
  const r = await fetch(base + p, { headers });
  if (!r.ok) throw new Error(`${p} ${r.status}`);
  return r.json();
};

// Expected values from the saved (approved) document via the real API.
const assignment = await api("/assignments/" + journey.assignment_id);
const artifact = await api("/artifacts/" + assignment.artifact_ids[0]);
const blocks = artifact.current_revision.body.blocks;
const current = blocks.find((b) => b.block_id.startsWith("managed.current."));
const attempt = current.block_id.slice("managed.current.".length);
const text = (name, heading) =>
  blocks
    .find((b) => b.block_id === `managed.${name}.${attempt}`)
    .text.slice(heading.length + 2);
const expected = {
  summary: text("next-action", "Next action (proposed)"),
  evidence: text("source-basis", "Source basis").split("\n").filter(Boolean),
  missing: text("missing-information", "Missing information")
    .split("\n")
    .filter(Boolean),
  judgment: text("specific-judgment", "Specific judgment"),
  // The approved revision's group must be the revision run's, not the initial one.
  historical_groups: blocks.filter((b) =>
    b.block_id.startsWith("managed.current."),
  ).length,
};
const run = assignment.responsibility.runs.find(
  (r) => r.run_id === assignment.responsibility.latest_run_id,
);

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const sizes = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 },
  narrow: { width: 320, height: 640 },
};
const errors = [];
try {
  for (const [label, viewport] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(
      (url) => url.pathname === "/api/domain/v1/workspaces",
      async (route) => {
        const r = await route.fetch();
        const body = await r.json();
        body.items = body.items.filter((w) => w.id === ws);
        await route.fulfill({ response: r, json: body });
      },
    );
    await page.goto(`${origin}/assignments/${journey.assignment_id}`);
    const lead = page.locator(".result-lead");
    await expect(lead).toHaveText(expected.summary, { timeout: 15000 });
    await expect(lead).not.toHaveText("Review the saved work");
    for (const e of expected.evidence)
      await expect(
        page.locator(".result .evidence li", { hasText: e }),
      ).toHaveCount(1);
    await expect(page.locator(".result .decision-question")).toContainText(
      expected.judgment,
    );
    await page.getByText("What this doesn’t tell you").click();
    for (const m of expected.missing)
      await expect(page.getByText(m, { exact: true })).toBeVisible();
    const footer = await page.locator("footer.mode-line").innerText();
    expect(footer).not.toMatch(/fixture worker|not a live agent/i);
    await expect(page.locator("header .status").first()).toHaveText(
      "Approved revision",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.addStyleTag({
      content: ".action-bar,.sticky-actions{position:static !important}",
    });
    await page.screenshot({
      path: path.join(out, `assignment-${label}.png`),
      fullPage: true,
    });
    await page.getByRole("link", { name: "Open plan" }).click();
    await page.waitForURL(/\/artifacts\//);
    await expect(page.locator(".doc-card")).toContainText(expected.summary);
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(out, `artifact-${label}.png`),
      fullPage: true,
    });
    await page.close();
  }
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        passed: true,
        evidence_mode: journey.evidence_mode,
        provider_inference_calls: journey.provider_inference_calls,
        assignment_id: journey.assignment_id,
        approved_revision_id: journey.approved_revision_id,
        current_attempt: attempt,
        managed_groups_in_saved_document: expected.historical_groups,
        run_state: run.state,
        evidence_origin: run.execution?.evidence_origin ?? null,
        expected,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  expect(errors).toEqual([]);
  console.log(
    `PASS: assignment shows the current managed group (attempt ${attempt}) from the approved document; footer makes no fixture claim`,
  );
} finally {
  await browser.close();
}
