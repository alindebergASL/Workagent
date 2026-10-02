import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const output = path.join(root, ".local/evidence/agent-first");
await mkdir(output, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const headers = {
  "X-Workagent-Client": "local-ui",
  "Content-Type": "application/json",
};
const api = async (p) => {
  const r = await fetch(
    origin + "/api/domain/v1/workspaces/local-workspace" + p,
    { headers },
  );
  expect(r.ok).toBe(true);
  return r.json();
};
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
});
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const human =
  "Keep Wednesday 14:00–15:00 for method drafting; do not trade this block for either team’s review.";
const screenshot = async (name) => {
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  ).toBe(false);
  await p.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: true,
  });
};
async function surfaceStates(state, label) {
  const observed = {};
  await p.goto(origin);
  const card = p.locator(
    `.decision-card:has(a[href^="/assignments/${state.assignment_id}"]), a.work-row[href^="/assignments/${state.assignment_id}"]`,
  );
  await expect(card).toBeAttached();
  for (const disclosure of await p.locator("details.since-group").all())
    if (!(await disclosure.evaluate((e) => e.open)))
      await disclosure.locator("summary").click();
  await expect(card).toContainText(new RegExp(label, "i"));
  observed.agent = await card.innerText();
  await p.goto(origin + "/spaces/local-workspace");
  const space = p.locator(
    `a.work-row[href^="/assignments/${state.assignment_id}"]`,
  );
  await expect(space).toContainText(new RegExp(label, "i"));
  observed.spaces = await space.innerText();
  await p.goto(origin + "/assignments/" + state.assignment_id);
  await expect(p.locator("header .status-line")).toContainText(
    new RegExp(label, "i"),
  );
  observed.responsibility = await p.locator("header .status-line").innerText();
  return observed;
}
try {
  if (process.argv.includes("--reopen")) {
    const state = JSON.parse(
      await readFile(path.join(output, "state.json"), "utf8"),
    );
    await p.goto(origin + state.artifact_url);
    await expect(p.getByText(human, { exact: true })).toBeVisible();
    await expect(p.locator("header .status").first()).toHaveText(
      "Approved revision",
    );
    const art = await api("/artifacts/" + state.artifact_id);
    expect(art.current_revision_id).toBe(state.approved_revision_id);
    expect(art.current_revision.body_hash).toBe(state.approved_body_hash);
    expect(
      art.current_revision.body.blocks.find((b) => b.block_id === "next-action")
        .checked,
    ).toBe(true);
    const props = await api("/artifacts/" + state.artifact_id + "/proposals");
    expect(props.items.find((x) => x.id === state.proposal_id).status).toBe(
      "accepted",
    );
    await screenshot("07-approved-reopened-desktop");
    await p.setViewportSize({ width: 390, height: 844 });
    await screenshot("08-approved-reopened-mobile");
    const surfaces = await surfaceStates(state, "Approved revision");
    await screenshot("09-reopened-responsibility-mobile");
    await writeFile(
      path.join(output, "restart.json"),
      JSON.stringify(
        {
          passed: true,
          same_assignment: state.assignment_id,
          same_revision: art.current_revision_id,
          same_body_hash: art.current_revision.body_hash,
          proposal_status: "accepted",
          surfaces,
          errors,
        },
        null,
        2,
      ) + "\n",
    );
    expect(errors).toEqual([]);
    console.log(
      "PASS: approved human-preserving work reopens after API/web restart; Agent/Spaces/responsibility/artifact agree",
    );
  } else {
    const goal =
      "Carry forward my private intake review; preserve Wednesday planning. " +
      crypto.randomUUID().slice(0, 8);
    await p.goto(origin);
    await p.getByLabel("Message your agent").fill(goal);
    await p.getByRole("button", { name: /^Your context/ }).click();
    for (const title of [
      "Personal intake review log",
      "Method notebook",
      "Personal working plan",
    ])
      await p.getByLabel(title, { exact: false }).check();
    await screenshot("01-delegation-desktop");
    const sent = [];
    let receipt;
    await p.route("**/assignments", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      sent.push(route.request().postDataJSON());
      if (sent.length === 1) {
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        receipt = await response.json();
        await route.abort("failed");
      } else await route.continue();
    });
    await p.getByRole("button", { name: "Start work", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Retry the same request", exact: true }),
    ).toBeVisible();
    await expect(p.getByLabel("Message your agent")).toBeDisabled();
    await p
      .getByRole("button", { name: "Retry the same request", exact: true })
      .click();
    await p.waitForURL(/\/assignments\/[^/]+$/);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    const assignmentId = p.url().split("/").pop();
    expect(assignmentId).toBe(receipt.assignment.id);
    let assignment = await api("/assignments/" + assignmentId);
    expect(assignment.state).toBe("queued");
    expect(assignment.run_ids).toHaveLength(1);
    advance(assignment.run_ids[0]);
    await expect(
      p.getByRole("link", { name: "Open plan", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await p.getByRole("link", { name: "Open plan", exact: true }).click();
    await p.waitForURL(/\/artifacts\/[^/]+$/);
    const artifactUrl = new URL(p.url()).pathname,
      artifactId = p.url().split("/").pop();
    await expect(p.getByText(/4 of 8 usable personal cases/)).toBeVisible();
    await screenshot("02-artifact-desktop");
    const before = await api("/artifacts/" + artifactId);
    await p.getByRole("button", { name: "Edit", exact: true }).click();
    await p.getByLabel("Paragraph protected-0", { exact: true }).fill(human);
    await p
      .getByRole("checkbox", {
        name: /Mark done: Choose the next personal case/,
      })
      .check();
    await p.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(p.locator(".save-state")).toContainText("revision 2");
    const saved = await api("/artifacts/" + artifactId);
    expect(saved.current_revision.author_kind).toBe("human");
    expect(
      saved.current_revision.body.blocks.find(
        (b) => b.block_id === "protected-0",
      ).text,
    ).toBe(human);
    const state = {
      goal,
      assignment_id: assignmentId,
      artifact_id: artifactId,
      artifact_url: artifactUrl,
      human_revision_id: saved.current_revision_id,
      human_body_hash: saved.current_revision.body_hash,
      initial_revision_id: before.current_revision_id,
    };
    await surfaceStates(state, "Ready for review");
    await p.getByRole("link", { name: "Open plan", exact: true }).click();
    await p.setViewportSize({ width: 390, height: 844 });
    await expect(p.getByText(human, { exact: true })).toBeVisible();
    await p
      .locator(".working-switch")
      .getByRole("button", { name: "Agent", exact: true })
      .click();
    await expect(p.locator(".working-agent")).toBeVisible();
    await expect(p.locator(".working-document")).toBeHidden();
    await p
      .getByLabel("What should change?")
      .fill(
        "Preserve my protected Wednesday note and checked next action; add a bounded follow-up reminder.",
      );
    await screenshot("03-mobile-revision-request");
    await p.getByRole("button", { name: "Send request", exact: true }).click();
    await p.getByRole("button", { name: "Agent", exact: true }).click();
    await expect(
      p.getByText("A revision is being drafted", { exact: false }),
    ).toBeVisible();
    assignment = await api("/assignments/" + assignmentId);
    expect(assignment.state).toBe("queued");
    const revisionRun = assignment.run_ids.at(-1);
    await surfaceStates(state, "Queued");
    await p.getByRole("link", { name: "Open plan", exact: true }).click();
    advance(revisionRun);
    await expect(
      p.getByRole("button", { name: "Apply proposal", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const props = await api("/artifacts/" + artifactId + "/proposals");
    const proposal = props.items.find((x) => x.status === "pending");
    expect(proposal.base_revision_id).toBe(saved.current_revision_id);
    expect(
      proposal.body.blocks.find((b) => b.block_id === "protected-0").text,
    ).toBe(human);
    expect(
      proposal.body.blocks.find((b) => b.block_id === "next-action").checked,
    ).toBe(true);
    await surfaceStates(state, "proposed change");
    await p.goto(origin + artifactUrl);
    await expect(
      p.getByRole("button", { name: "Apply proposal", exact: true }),
    ).toBeVisible();
    await screenshot("04-review-proposal-mobile");
    await p
      .getByRole("button", { name: "Apply proposal", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();
    await expect(p.locator("header .status").first()).toHaveText(
      "Approved revision",
    );
    await expect(p.getByText(human, { exact: true })).toBeVisible();
    await screenshot("05-approved-mobile");
    const approved = await api("/artifacts/" + artifactId);
    expect(approved.current_revision.parent_revision_id).toBe(
      saved.current_revision_id,
    );
    expect(approved.current_revision.revision_number).toBe(3);
    expect(
      approved.current_revision.body.blocks.find(
        (b) => b.block_id === "protected-0",
      ).text,
    ).toBe(human);
    expect(
      approved.current_revision.body.blocks.find(
        (b) => b.block_id === "next-action",
      ).checked,
    ).toBe(true);
    const recorded = (
      await api("/artifacts/" + artifactId + "/proposals")
    ).items.find((x) => x.id === proposal.id);
    expect(recorded.status).toBe("accepted");
    expect(recorded.accepted_revision_id).toBe(approved.current_revision_id);
    expect((await api("/assignments/" + assignmentId)).state).toBe("ready");
    const history = await api("/artifacts/" + artifactId + "/history");
    expect(
      history.items.find((x) => x.id === saved.current_revision_id).body_hash,
    ).toBe(saved.current_revision.body_hash);
    await p.setViewportSize({ width: 1440, height: 1000 });
    await screenshot("06-approved-desktop");
    const surfaces = await surfaceStates(state, "Approved revision");
    expect(errors).toEqual([]);
    await writeFile(
      path.join(output, "state.json"),
      JSON.stringify(
        {
          ...state,
          result: "PASS",
          mode: "real_browser_api_postgresql_deterministic_fixture",
          approved_revision_id: approved.current_revision_id,
          approved_body_hash: approved.current_revision.body_hash,
          proposal_id: proposal.id,
          proposal_status: recorded.status,
          backend_preparation_state: "ready",
          surfaces,
          delegation_response_loss: {
            same_command: true,
            assignment_count: 1,
            initial_run_count: 1,
          },
          mobile_work_ask_switch: true,
          errors,
        },
        null,
        2,
      ) + "\n",
    );
    await writeFile(
      path.join(output, "approved-artifact.json"),
      JSON.stringify(approved, null, 2) + "\n",
    );
    await writeFile(
      path.join(output, "approved-proposal.json"),
      JSON.stringify(recorded, null, 2) + "\n",
    );
    console.log(
      "PASS: real delegation (including lost 202) -> artifact -> human edit -> mobile proposal -> approval; all surfaces agree",
    );
  }
} finally {
  await browser.close();
}
