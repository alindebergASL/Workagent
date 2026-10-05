// Real UI + normal continuous controlled consumer; never calls a kernel or manual worker.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const base = origin + "/api/domain/v1/workspaces/local-workspace";
const headers = {
  "X-Workagent-Client": "local-ui",
  "Content-Type": "application/json",
};
async function get(p) {
  const r = await fetch(base + p, { headers });
  expect(r.status).toBe(200);
  return r.json();
}
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  // Optional preinstalled browser for hosts that cannot download Playwright's own.
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const errors = [];
const report = {
  mode: "actual-ui-api-postgresql-continuous-controlled-worker",
  provider_calls: "not_observed",
  runs: [],
  screenshots: [],
};
const shot = async (page, name) => {
  await page.screenshot({
    path: path.join(out, name + ".png"),
    fullPage: true,
  });
  report.screenshots.push(name + ".png");
};
const noOverflow = async (page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  async function start(text) {
    await page.goto(origin);
    await page.getByLabel("Message your agent").fill(text);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForURL(/\/conversations\/[^/?]+$/);
    const cid = page.url().split("/").pop();
    await expect(page.locator(".msg-agent")).toHaveCount(1, { timeout: 15000 });
    return cid;
  }
  async function attach(kind, file) {
    await page.getByText("Run a local operation", { exact: true }).click();
    await page.getByLabel("Operation", { exact: true }).selectOption(kind);
    await page
      .getByLabel(kind === "run_wasm" ? "Attach WAT file" : "Attach CSV file")
      .setInputFiles(path.join(root, "fixtures/general-work", file));
    await expect(
      page.getByText("Attached: " + file, { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Run attached input", exact: true })
      .click();
  }
  const csvCid = await start("Reconcile my invoice CSV and preserve my notes.");
  report.csv_conversation = csvCid;
  await attach("reconcile_csv", "invoices.csv");
  await page
    .getByRole("link", { name: "Open table product", exact: true })
    .click({ timeout: 15000 });
  await page.waitForURL(/\/conversations\/[^/]+\/artifacts\/[^/?]+$/);
  const tableURL = page.url();
  const tableId = tableURL.split("/").pop();
  report.table_id = tableId;
  await expect(page.getByTestId("product-verification")).toHaveText(
    "Checked against this saved version.",
  );
  await expect(page.getByLabel("Row 2 reported_total")).toHaveValue("38.50");
  await expect(
    page.getByRole("region", { name: "Editable invoice table" }),
  ).toContainText("37.50");
  await page
    .getByLabel("Row 2 note", { exact: true })
    .fill("Human credit note retained");
  await page
    .getByLabel("Your notes (one per line)")
    .fill("Human review note retained");
  await page
    .getByLabel("Rounding", { exact: true })
    .selectOption("ROUND_HALF_EVEN");
  await page.reload();
  await expect(page.getByLabel("Row 2 note", { exact: true })).toHaveValue(
    "Human credit note retained",
  );
  await page
    .getByRole("button", { name: "Save my edits", exact: true })
    .click();
  await expect(
    page.getByText(
      "Your edits are saved. Recalculate or run it to check them.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByTestId("product-verification")).toHaveText(
    "This saved version hasn’t been checked yet.",
  );
  await shot(page, "01-table-human-save");
  await page
    .getByRole("button", { name: "Recalculate saved rows", exact: true })
    .click();
  await page.waitForURL(new RegExp("/conversations/" + csvCid + "$"));
  await page
    .getByRole("link", { name: "Open table proposed change", exact: true })
    .click({ timeout: 15000 });
  await expect(page.getByTestId("product-proposal")).toContainText(
    "Human review note retained",
  );
  await page
    .getByRole("button", { name: "Apply proposed version", exact: true })
    .click();
  await expect(page.getByTestId("product-verification")).toHaveText(
    "Checked against this saved version.",
  );
  await expect(page.getByLabel("Row 2 note", { exact: true })).toHaveValue(
    "Human credit note retained",
  );
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download saved file", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("reconciled.csv");
  await download.saveAs(path.join(out, "reconciled.csv"));
  const csv = await readFile(path.join(out, "reconciled.csv"), "utf8");
  expect(csv).toContain("37.50");
  expect(csv).toContain("Human credit note retained");
  await shot(page, "02-table-recalculated");
  await noOverflow(page);
  // Two browser pages retain exact bases; stale save must not overwrite newer human text.
  const other = await browser.newPage();
  await other.goto(tableURL);
  await other
    .getByLabel("Your notes (one per line)")
    .fill("Stale second-tab draft");
  await page.getByLabel("Your notes (one per line)").fill("Newest human note");
  await page
    .getByRole("button", { name: "Save my edits", exact: true })
    .click();
  await expect(
    page.getByText(
      "Your edits are saved. Recalculate or run it to check them.",
      { exact: true },
    ),
  ).toBeVisible();
  await other
    .getByRole("button", { name: "Save my edits", exact: true })
    .click();
  await expect(other.getByRole("alert").first()).toBeVisible();
  await expect(other.getByLabel("Your notes (one per line)")).toHaveValue(
    "Stale second-tab draft",
  );
  expect(
    (await get("/artifacts/" + tableId)).current_revision.body.notes,
  ).toEqual(["Newest human note"]);
  await other.close();
  const toolCid = await start(
    "Make and run a bounded integer-cents invoice tool.",
  );
  report.tool_conversation = toolCid;
  await attach("run_wasm", "invoice-total.wat");
  await page
    .getByRole("link", { name: "Open tool product", exact: true })
    .click({ timeout: 15000 });
  await page.waitForURL(/\/conversations\/[^/]+\/artifacts\/[^/?]+$/);
  const toolURL = page.url();
  const toolId = toolURL.split("/").pop();
  report.tool_id = toolId;
  await expect(page.getByTestId("observed-return")).toHaveText("3750");
  await page
    .getByLabel("Your notes (one per line)")
    .fill("Human: all amounts are cents");
  await page
    .getByLabel("WebAssembly text (WAT)")
    .fill(
      await readFile(
        path.join(
          root,
          "fixtures/general-work/invoice-total-with-shipping.wat",
        ),
        "utf8",
      ),
    );
  await setToolInputs(page, [
    ["Quantity", "3"],
    ["Unit price cents", "1250"],
    ["Shipping cents", "500"],
  ]);
  await page
    .getByRole("button", { name: "Save my edits", exact: true })
    .click();
  await expect(
    page.getByText(
      "Your edits are saved. Recalculate or run it to check them.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByTestId("product-verification")).toHaveText(
    "This saved version hasn’t been checked yet.",
  );
  await page
    .getByRole("button", { name: "Run saved tool", exact: true })
    .click();
  await page.waitForURL(new RegExp("/conversations/" + toolCid + "$"));
  await page
    .getByRole("link", { name: "Open tool proposed change", exact: true })
    .click({ timeout: 15000 });
  await expect(page.getByTestId("observed-return")).toHaveText("4250");
  await expect(page.getByTestId("product-verification")).toHaveText(
    "This saved version hasn’t been checked yet.",
  );
  await page
    .getByRole("button", { name: "Apply proposed version", exact: true })
    .click();
  await expect(page.getByTestId("product-verification")).toHaveText(
    "Checked against this saved version.",
  );
  await expect(page.getByLabel("Your notes (one per line)")).toHaveValue(
    "Human: all amounts are cents",
  );
  await shot(page, "03-tool-shipping");
  const watPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download saved file", exact: true })
    .click();
  const wat = await watPromise;
  await wat.saveAs(path.join(out, wat.suggestedFilename()));
  expect(await readFile(path.join(out, wat.suggestedFilename()), "utf8")).toBe(
    await readFile(
      path.join(root, "fixtures/general-work/invoice-total-with-shipping.wat"),
      "utf8",
    ),
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByTestId("observed-return")).toHaveText("4250");
    await noOverflow(page);
    await shot(page, `04-tool-${width}`);
    await page.goto(tableURL);
    await expect(page.getByLabel("Row 2 note", { exact: true })).toHaveValue(
      "Human credit note retained",
    );
    await noOverflow(page);
    await shot(page, `05-table-${width}`);
    await page.goto(toolURL);
  }
  // A fresh browser context has no draft cache; output/notes must reopen from service.
  const reopened = await browser.newPage();
  await reopened.goto(toolURL);
  await expect(reopened.getByTestId("observed-return")).toHaveText("4250");
  await expect(reopened.getByLabel("Your notes (one per line)")).toHaveValue(
    "Human: all amounts are cents",
  );
  await reopened.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const maliciousCid = await start(
    "Reject host imports instead of fabricating a tool result.",
  );
  report.rejected_conversation = maliciousCid;
  await page.getByText("Run a local operation", { exact: true }).click();
  await page.getByLabel("Operation", { exact: true }).selectOption("run_wasm");
  await page.getByLabel("Attach WAT file").setInputFiles({
    name: "malicious.wat",
    mimeType: "text/plain",
    buffer: Buffer.from(
      '(module (import "wasi_snapshot_preview1" "bad" (func)))',
    ),
  });
  await expect(
    page.getByText("Attached: malicious.wat", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run attached input", exact: true })
    .click();
  await expect(page.locator('[data-state="failed"]')).toContainText(
    "imports forbidden",
    { timeout: 15000 },
  );
  await expect(page.getByRole("link", { name: /Open tool/ })).toHaveCount(0);
  await shot(page, "06-rejected-tool");
  for (const cid of [csvCid, toolCid, maliciousCid]) {
    const d = await get("/conversations/" + cid);
    expect(d.assignment_ids).toEqual([]);
    report.runs.push(
      ...d.runs.map((r) => ({
        conversation: cid,
        id: r.id,
        state: r.state,
        profile: r.profile,
      })),
    );
  }
  report.table = await get("/artifacts/" + tableId);
  report.tool = await get("/artifacts/" + toolId);
  expect(errors).toEqual([]);
  report.page_errors = errors;
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      { passed: true, run_ids: report.runs, screenshots: report.screenshots },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

/** Fill the per-field tool inputs: one name and whole-number value each. */
async function setToolInputs(page, fields) {
  const rows = page.locator(".tool-input-row");
  while ((await rows.count()) > fields.length)
    await page
      .getByRole("button", { name: `Remove input ${await rows.count()}` })
      .click();
  while ((await rows.count()) < fields.length)
    await page
      .getByRole("button", { name: "Add an input", exact: true })
      .click();
  for (const [i, [label, value]] of fields.entries()) {
    await page.getByLabel(`Input ${i + 1} name`, { exact: true }).fill(label);
    await rows.nth(i).locator("input").nth(1).fill(value);
  }
  await expect(
    page
      .getByLabel("Input 1 name")
      .locator("xpath=ancestor::fieldset")
      .getByRole("alert"),
  ).toHaveCount(0);
}
