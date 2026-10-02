import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const evidence = path.join(root, ".local/evidence");
await mkdir(evidence, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const headers = {
  "X-Workagent-Client": "local-ui",
  "Content-Type": "application/json",
};
const cmd = () => ({
  schema_version: "workagent/v1",
  request_id: crypto.randomUUID(),
  command_id: crypto.randomUUID(),
});
const api = async (p, body, status = 200) => {
  const r = await fetch(
    origin + "/api/domain/v1/workspaces/local-workspace" + p,
    {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const j = await r.json();
  if (r.status !== status)
    throw new Error(
      JSON.stringify({ path: p, status: r.status, expected: status, body: j }),
    );
  return j;
};
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = async (name) => {
  await page.screenshot({
    path: path.join(evidence, name + ".png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow, "No horizontal page overflow").toBe(false);
};
const advance = (run) => {
  if (!process.env.WORKAGENT_AUTOMATIC_DISPATCHER) {
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
  }
};
// Evaluator-released human edit only; never imported into privileged runtime context.
const human =
  "Keep Wednesday 14:00–15:00 for method drafting; do not trade this block for either team’s review.";
try {
  if (process.argv.includes("--reopen")) {
    const state = JSON.parse(
      await readFile(path.join(evidence, "state.json"), "utf8"),
    );
    await page.goto(origin + state.artifact_url);
    await expect(page.getByText(human, { exact: true })).toBeVisible();
    await expect(page.locator(".save-state")).toContainText("revision 2");
    const art = await api("/artifacts/" + state.artifact_id);
    expect(art.current_revision_id).toBe(state.human_revision_id);
    expect(art.current_revision.body_hash).toBe(state.human_body_hash);
    expect(
      art.current_revision.body.blocks.find((b) => b.block_id === "next-action")
        .checked,
    ).toBe(true);
    const proposals = await api(
      "/artifacts/" + state.artifact_id + "/proposals",
    );
    expect(
      proposals.items.find((p) => p.id === state.proposal_id).body_hash,
    ).toBe(state.proposal_hash);
    await shot("07-reopened-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await shot("08-reopened-mobile");
    await writeFile(
      path.join(evidence, "restart.json"),
      JSON.stringify(
        {
          mode: "actual_application_postgresql_fixture_compute",
          same_assignment: true,
          same_current_revision: true,
          same_body_hash: true,
          proposal_preserved: true,
          errors,
        },
        null,
        2,
      ) + "\n",
    );
    expect(errors).toEqual([]);
    console.log(
      "PASS: real UI reopened same PostgreSQL artifact after restart",
    );
  } else {
    const records = JSON.parse(
      await readFile(
        path.join(root, "fixtures/actor/solo-v0.1/initial_records.json"),
        "utf8",
      ),
    );
    const note = records.find((r) => r.id === "SG-F7").content.protected_note;
    await page.goto(origin);
    await expect(
      page.getByRole("heading", {
        name: "What would you like to move forward?",
      }),
    ).toBeVisible();
    await page
      .getByLabel("Tell me what you need")
      .fill(records.find((r) => r.id === "SG-F1").content.instruction);
    await page.getByText("Context · Choose sources", { exact: true }).click();
    for (const title of [
      "Personal intake review log",
      "Method notebook",
      "Personal working plan",
    ])
      await page.getByLabel(title, { exact: false }).check();
    await shot("01-home-connected");
    await page.getByRole("button", { name: "Start work", exact: true }).click();
    await page.waitForURL(/\/assignments\/[^/]+$/, { timeout: 20000 });
    const assignmentId = page.url().split("/").pop();
    let assignment = await api("/assignments/" + assignmentId);
    expect(
      assignment.selected_source_refs.map((r) => r.source_id).sort(),
    ).toEqual(["SG-F2", "SG-F3", "SG-F7"]);
    advance(assignment.run_ids[0]);
    await expect(
      page.getByRole("link", { name: "Open plan", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/4 of 8 usable personal cases/)).toBeVisible();
    await shot("02-assignment-ready");
    await page.getByRole("link", { name: "Open plan", exact: true }).click();
    await page.waitForURL(/\/artifacts\/[^/]+$/);
    const artifactUrl = new URL(page.url()).pathname;
    const artifactId = page.url().split("/").pop();
    await expect(page.getByText(note, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sources", exact: true }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Sources", exact: true })
        .locator("pre")
        .first(),
    ).toContainText("owner_recorded");
    await shot("09-supporting-sources");
    await page.keyboard.press("Escape");
    const initial = await api("/artifacts/" + artifactId);
    const baseId = initial.current_revision_id;
    await page
      .getByRole("button", { name: "Request revision", exact: true })
      .click();
    await page
      .getByLabel("What should change?")
      .fill(
        "Add an explicit next-step reminder without removing my protected note.",
      );
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await expect(
      page.getByText("A revision is being drafted", { exact: false }),
    ).toBeVisible();
    assignment = await api("/assignments/" + assignmentId);
    const revisionRun = assignment.run_ids.at(-1);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Paragraph protected-0", { exact: true }).fill(human);
    await page
      .getByRole("checkbox", {
        name: /Mark done: Choose the next personal case/,
      })
      .check();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.locator(".save-state")).toContainText("revision 2");
    await expect(page.getByText(human, { exact: true })).toBeVisible();
    await shot("03-human-saved");
    const saved = await api("/artifacts/" + artifactId);
    expect(saved.current_revision.author_kind).toBe("human");
    expect(
      saved.current_revision.body.blocks.find(
        (b) => b.block_id === "next-action",
      ).checked,
    ).toBe(true);
    expect(
      saved.current_revision.body.blocks.find(
        (b) => b.block_id === "protected-0",
      ).text,
    ).toBe(human);
    advance(revisionRun);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Current saved version", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const panes = {
      current: page.locator('.conflict-pane[data-role="current"]'),
      proposal: page.locator('.conflict-pane[data-role="proposal"]'),
    };
    await expect(panes.current.getByText(human, { exact: true })).toBeVisible();
    await expect(panes.proposal.getByText(human, { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("heading", { name: /Agent proposal based on revision 1/ }),
    ).toBeVisible();
    const proposals = await api("/artifacts/" + artifactId + "/proposals");
    const proposal = proposals.items.find((p) => p.base_revision_id === baseId);
    expect(proposal).toBeTruthy();
    const denial = await api(
      "/proposals/" + proposal.id + "/accept",
      { ...cmd(), expected_current_revision_id: saved.current_revision_id },
      409,
    );
    expect(denial.code).toBe("version_conflict");
    expect((await api("/artifacts/" + artifactId)).current_revision_id).toBe(
      saved.current_revision_id,
    );
    await shot("04-stale-proposal-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await shot("05-stale-proposal-mobile");
    await page
      .getByRole("button", { name: "Keep current version", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(
      page
        .getByRole("dialog", { name: "History", exact: true })
        .getByText("Kept current version instead", { exact: false }),
    ).toBeVisible();
    await shot("06-retained-history");
    await page.keyboard.press("Escape");
    assignment = await api("/assignments/" + assignmentId);
    const desired = "Review one personal intake case";
    const task = await api(
      "/assignments/" + assignmentId + "/tasks",
      {
        ...cmd(),
        owner_id: "local-human",
        desired_result: desired,
        expected_work_version: assignment.work_version,
      },
      201,
    );
    expect(task.verification).toBe("unresolved");
    const inspected = await api(
      "/tasks/" +
        task.task.id +
        "?expected_version=" +
        task.task.version +
        "&expected_desired_result=" +
        encodeURIComponent(desired),
    );
    expect(inspected.verification).toBe("verified_created");
    expect(inspected.inspection_id).toBeTruthy();
    const state = {
      mode: "actual_application_postgresql_fixture_compute",
      assignment_id: assignmentId,
      artifact_id: artifactId,
      artifact_url: artifactUrl,
      human_revision_id: saved.current_revision_id,
      human_body_hash: saved.current_revision.body_hash,
      proposal_id: proposal.id,
      proposal_hash: proposal.body_hash,
      task_id: task.task.id,
      task_inspection_id: inspected.inspection_id,
      errors,
    };
    await writeFile(
      path.join(evidence, "state.json"),
      JSON.stringify(state, null, 2) + "\n",
    );
    await writeFile(
      path.join(evidence, "saved-artifact.json"),
      JSON.stringify(saved, null, 2) + "\n",
    );
    await writeFile(
      path.join(evidence, "stale-proposal.json"),
      JSON.stringify(proposal, null, 2) + "\n",
    );
    await writeFile(
      path.join(evidence, "task-readback.json"),
      JSON.stringify(inspected, null, 2) + "\n",
    );
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ result: "PASS", ...state }));
  }
} finally {
  await browser.close();
}
