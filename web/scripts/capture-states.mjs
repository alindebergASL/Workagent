/**
 * Matched screenshots of the same domain checkpoints, for before/after UI
 * comparison. Mutations go through the real API (and the fixture worker), so
 * the script runs unchanged against any UI version; the browser only navigates
 * and captures. Usage (stack running, env sourced):
 *   node web/scripts/capture-states.mjs <output-dir>
 * Checkpoints: prepared (awaiting inspection), proposal awaiting decision,
 * approved current revision.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.argv[2] ?? path.join(root, ".local/evidence/captures"),
);
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const headers = {
  "X-Workagent-Client": "local-ui",
  "Content-Type": "application/json",
};
const base = origin + "/api/domain/v1/workspaces/local-workspace";
const cmd = () => ({
  schema_version: "workagent/v1",
  request_id: crypto.randomUUID(),
  command_id: crypto.randomUUID(),
});
async function api(p, body) {
  const r = await fetch(base + p, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const advance = (run) =>
  execFileSync(
    path.join(root, "backend/.venv/bin/python"),
    [
      "-m",
      "workagent.fixture",
      "work",
      "--workspace",
      "local-workspace",
      "--run",
      run,
    ],
    { cwd: path.join(root, "backend"), env: process.env, stdio: "pipe" },
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
};
async function capture(name, url, prepare) {
  for (const [label, viewport] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport });
    await page.goto(origin + url);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    if (prepare) await prepare(page);
    const flow = await page.addStyleTag({
      content: ".action-bar,.sticky-actions{position:static !important}",
    });
    await page.screenshot({
      path: path.join(out, `${name}-${label}.png`),
      fullPage: true,
    });
    await flow.evaluate((el) => el.remove());
    await page.close();
  }
}

try {
  const records = (await api("/sources")).items;
  const pick = ["SG-F2", "SG-F3", "SG-F7"].map((id) => {
    const s = records.find((x) => x.id === id);
    return {
      source_id: s.id,
      external_version: s.external_version,
      observed_at: s.observed_at,
    };
  });
  const created = await api("/assignments", {
    ...cmd(),
    goal: "Start with my own intake log and notes. Help me decide one change to test, produce a reusable review checklist and give me a private working plan.",
    completion_criteria: [
      "Produce a private working plan and reusable checklist from the selected sources, preserving human notes and identifying evidence and uncertainty.",
    ],
    selected_source_refs: pick,
  });
  const assignmentId = created.assignment.id;
  advance(created.run.id);
  const assignment = await api("/assignments/" + assignmentId);
  const plan = (
    await Promise.all(
      assignment.artifact_ids.map((id) => api("/artifacts/" + id)),
    )
  ).find((a) => /plan/i.test(a.current_revision.body.title));
  const artifactUrl = `/assignments/${assignmentId}/artifacts/${plan.id}`;

  // 1. Prepared: awaiting inspection.
  await capture("01-home-prepared", "/");
  await capture("02-home-context-chosen", "/", async (page) => {
    const sample = page.getByRole("button", { name: /intake example/i });
    if (await sample.count()) await sample.first().click();
    await page.waitForTimeout(300);
  });
  await capture("03-assignment-prepared", `/assignments/${assignmentId}`);
  await capture("04-artifact-prepared", artifactUrl);

  // Human save, then a proposal based on it.
  const human =
    "Keep Wednesday 14:00–15:00 for method drafting; do not trade this block for either team’s review.";
  const body = structuredClone(plan.current_revision.body);
  body.blocks = body.blocks.map((b) =>
    b.block_id === "protected-0" ? { ...b, text: human } : b,
  );
  const saved = await api(`/artifacts/${plan.id}/save`, {
    ...cmd(),
    expected_current_revision_id: plan.current_revision_id,
    body,
  });
  const work = (await api("/assignments/" + assignmentId)).work_version;
  const queued = await api(`/artifacts/${plan.id}/request-revision`, {
    ...cmd(),
    expected_work_version: work,
    base_revision_id: saved.current_revision_id,
    instruction: "Add a reminder to compare the next eight cases on Friday.",
  });
  advance(
    queued.run?.id ??
      queued.run_id ??
      (await api("/assignments/" + assignmentId)).run_ids.at(-1),
  );

  // 2. Proposal awaiting a decision.
  await capture("05-home-decision", "/");
  await capture("06-artifact-decision", artifactUrl);

  // 3. Approved current revision.
  const pending = (await api(`/artifacts/${plan.id}/proposals`)).items.find(
    (p) => p.status === "pending",
  );
  await api(`/proposals/${pending.id}/accept`, {
    ...cmd(),
    expected_current_revision_id: saved.current_revision_id,
  });
  await capture("07-artifact-approved", artifactUrl);
  await capture("08-home-approved", "/");
  await capture("09-spaces-approved", "/spaces/local-workspace");
  console.log(
    JSON.stringify({
      result: "captured",
      out,
      assignmentId,
      artifactId: plan.id,
    }),
  );
} finally {
  await browser.close();
}
