// The real model-made venue table and view retained by the backend owner
// (evidence/flexible-work-13), republished unchanged through the controlled
// path into a fresh stack and used through the real UI. No model calls.
// The view's script hard-codes the original artifact/revision/hash, so those
// three strings (and nothing else) are swapped for the fresh records' ids.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const root = origin + "/api/domain/v1/workspaces";
const base = root + "/local-workspace";
const headers = {
  "X-Workagent-Client": "local-ui",
  "Content-Type": "application/json",
};
async function api(p, body, url = base) {
  const r = await fetch(url + p, {
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
async function publish(cid, text, body) {
  const before = await api(`/conversations/${cid}`);
  await api(`/conversations/${cid}/messages`, {
    ...cmd(),
    expected_work_version: before.conversation.work_version,
    text,
    operation: {
      kind: "publish_artifact",
      body,
      artifact_id: null,
      base_revision_id: null,
    },
  });
  for (const end = Date.now() + 30000; Date.now() < end;) {
    const d = await api(`/conversations/${cid}`);
    const r = d.messages
      .filter((m) => m.sequence > before.messages.length)
      .flatMap((m) => m.result?.results ?? [])
      .filter((x) => x.kind !== "text");
    if (r.length) return r.at(-1);
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error("Publication did not complete");
}
const evidence = async (name) =>
  JSON.parse(
    await readFile(path.join(repo, "evidence/flexible-work-13", name), "utf8"),
  ).revision;

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const errors = [];
const report = {
  provider_calls: "not_performed",
  source: "evidence/flexible-work-13",
  findings: [],
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const frame = page.frameLocator(".sandboxed-view iframe");
  const tableRev = await evidence("venues-current.json");
  const viewRev = await evidence("custom-view.json");

  await page.goto(origin);
  await page
    .getByLabel("Message your agent")
    .fill("Compare the venues for the volunteer social.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForURL(/\/conversations\/[^/?]+$/);
  const cid = page.url().split("/").pop();
  await expect(page.locator(".msg-agent")).toHaveCount(1, { timeout: 15000 });

  const table = await publish(cid, "Keep the venue comparison.", tableRev.body);
  const saved = (await api(`/artifacts/${table.artifact_id}`)).current_revision;
  expect(saved.body).toEqual(tableRev.body);

  // The model's own table, as people see and edit it.
  await page.goto(
    `${origin}/conversations/${cid}/artifacts/${table.artifact_id}`,
  );
  const grid = page.getByRole("region", { name: "Editable table" });
  await expect(grid.getByRole("columnheader")).toHaveCount(
    tableRev.body.fields.length + 1,
  );
  await expect(
    page.getByLabel("Willow Hall Hire cost (supplied fact)", { exact: true }),
  ).toHaveValue("350.00");
  await page.screenshot({
    path: path.join(out, "live-table.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(out, "live-table-phone.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // The model's own view, bound to the fresh table.
  const old = viewRev.body.bindings[0];
  const swap = (s) =>
    s
      .replaceAll(old.artifact_id, table.artifact_id)
      .replaceAll(old.revision_id, saved.id)
      .replaceAll(old.body_hash, saved.body_hash);
  const workspace = (await api("", undefined, root)).items.find(
    (w) => w.id === "local-workspace",
  );
  const body = structuredClone(viewRev.body);
  body.source = {
    html: body.source.html,
    css: body.source.css,
    js: swap(body.source.js),
  };
  body.bindings = [
    {
      ...old,
      artifact_id: table.artifact_id,
      revision_id: saved.id,
      body_hash: saved.body_hash,
    },
  ];
  body.access_generation = workspace.access_generation;
  const view = await publish(cid, "Let me explore the trade-offs.", body);
  await page.goto(
    `${origin}/conversations/${cid}/artifacts/${view.artifact_id}`,
  );
  await expect(page.getByText("· current saved version")).toBeVisible();
  const summary = frame.locator("#summary");
  await expect(summary).toContainText("0 matching venues of 4", {
    timeout: 15000,
  });
  await frame.locator("#budget").fill("350");
  await expect(summary).toContainText("2 matching venues of 4");
  await expect(frame.locator("#results")).toContainText("Willow Hall");
  await expect(frame.locator("#results")).toContainText("River Centre");
  await frame.locator("#budget").fill("300");
  await frame.locator("#stepfree").uncheck();
  await expect(frame.locator("#results")).toContainText("Station Loft");
  await page.screenshot({
    path: path.join(out, "live-view.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(out, "live-view-phone.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // A person saves the table, then rebinds the view from the shell.
  await page.goto(
    `${origin}/conversations/${cid}/artifacts/${table.artifact_id}`,
  );
  await page
    .getByLabel("River Centre Hire cost (supplied fact)", { exact: true })
    .fill("299");
  await page
    .getByRole("button", { name: "Save my edits", exact: true })
    .click();
  await expect(
    page.getByText("Your edits are saved.", { exact: true }),
  ).toBeVisible();
  await page.goto(
    `${origin}/conversations/${cid}/artifacts/${view.artifact_id}`,
  );
  await expect(
    page.getByText("· changed since this view was made"),
  ).toBeVisible();
  // The generated code checks the exact ids it was written with, so
  // repointing it would only make it refuse its own data. The shell says to
  // ask for an updated view instead of offering a rebind that can't work.
  await expect(page.getByTestId("view-pinned")).toContainText(
    "Ask in the conversation for an updated view.",
  );
  await expect(
    page.getByRole("button", { name: "Use the latest saved versions" }),
  ).toHaveCount(0);
  report.findings.push(
    "Generated view hard-codes its original artifact/revision/hash, so it cannot follow a human edit by rebinding; it needs a regenerated view.",
  );
  await page.screenshot({
    path: path.join(out, "live-view-after-table-edit.png"),
    fullPage: true,
  });

  expect(errors).toEqual([]);
  report.ids = { cid, table: table.artifact_id, view: view.artifact_id };
  await writeFile(
    path.join(out, "live-records.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS live records in the real app; finding:",
    report.findings[0],
  );
} finally {
  await browser.close();
}
