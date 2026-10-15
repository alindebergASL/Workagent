// Real HTTP APIs + production browser + actual PTY. No mocked browser fetches.
// The only controlled layer is the explicit synthetic model fixture transport.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
const directory = process.argv[2];
const root = path.resolve("..");
const py = path.join(root, "backend/.venv/bin/python");
const fixture = JSON.parse(readFileSync(path.join(directory, "fixture.json")));
const ws = fixture.workspace;
const evidence = [];
function control(action, id, variant) {
  const r = spawnSync(
    py,
    [
      "space_fixture.py",
      action,
      ...(id ? [id] : []),
      "--directory",
      directory,
      ...(variant ? ["--variant", variant] : []),
    ],
    { cwd: path.join(root, "backend"), env: process.env, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  evidence.push({ fixture_action: action, result: JSON.parse(r.stdout) });
}
function cli(action, args = [], allowFailure = false) {
  const r = spawnSync(py, ["-m", "workagent.operator_tui", action, ...args], {
    cwd: path.join(root, "backend"),
    env: process.env,
    encoding: "utf8",
  });
  if (!allowFailure) assert.equal(r.status, 0, r.stderr);
  const data =
    r.status === 0
      ? JSON.parse(r.stdout)
      : JSON.parse(r.stderr.slice(r.stderr.lastIndexOf("{")));
  evidence.push({
    client: "TUI HTTP command",
    action,
    args,
    status: r.status,
    result: data,
  });
  return data;
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// This intercept forwards and retains the REAL API response. It installs a NEW
// synthetic fixture grant for this exact just-created conversation before its
// first prompt is admitted. No response body is fabricated or replaced.
await page.route(
  "**/api/domain/v1/workspaces/*/conversations",
  async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    if (response.status() === 201)
      control("activate", (await response.json()).id);
    await route.fulfill({ response });
  },
);
try {
  await page.goto(fixture.web);
  const prompt = page.getByPlaceholder(/Ask, think aloud/).first();
  await prompt.fill(
    "Help me turn a synthetic service-design practice into a clear offer for independent studios: audience, outcome, boundaries, pilot scope and a demand-validation approach. Keep it realistic, no weekend work or revenue promises.",
  );
  const admission = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/conversations\/[^/]+\/messages$/.test(new URL(r.url()).pathname),
  );
  await page.getByRole("button", { name: /Send/ }).first().click();
  const first = await (await admission).json();
  assert.ok(first.run?.id);
  const cid = first.conversation.id;
  control("work", first.run.id);
  const area = cli("area", [cid]);
  assert.equal(area.conversation.work_area.origin, "agent");
  assert.equal(area.conversation.work_area.identified_by_run_id, first.run.id);
  const aid = area.artifact_ids[0];
  assert.ok(aid);
  const spaceURL = `${fixture.web}/spaces/${ws}/work/${cid}`;
  await page.goto(spaceURL);
  await expect(
    page.getByRole("heading", {
      name: "Synthetic service launch",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Develop a bounded offer/).first()).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Synthetic service launch offer",
      exact: true,
    }),
  ).toBeVisible();
  // Regression: the Space must expose canonical content, not only links.
  const surface = page.getByRole("region", {
    name: "Saved Space work",
    exact: true,
  });
  await expect(
    surface.getByText(/A two-week service design pilot/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open persistent Space" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(directory, "space-desktop.png"),
    fullPage: true,
  });
  await page.goto(`${fixture.web}/conversations/${cid}/artifacts/${aid}`);
  await expect(
    page.getByRole("heading", {
      name: "Synthetic service launch offer",
      exact: true,
    }),
  ).toBeVisible();
  let artifact = cli("artifact", [aid]);
  const exact = [
    aid,
    artifact.current_revision_id,
    artifact.current_revision.body_hash,
  ];
  // Human edit through browser, then exact saved target through TUI HTTP.
  const textareas = page.locator("textarea");
  await expect(textareas.first()).toBeVisible();
  const humanField = page
    .locator("textarea")
    .filter({ hasText: "Human constraints:" });
  await humanField.fill(
    "Human constraints: NEVER offer weekend support. Keep this exact sentence.",
  );
  await page
    .getByRole("button", { name: "Save my edits", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save my edits", exact: true }),
  ).toHaveCount(0);
  artifact = cli("artifact", [aid]);
  assert.notEqual(artifact.current_revision_id, exact[1]);
  // An editor-only draft must not leak into the read-only Space or be erased
  // by editing its goal. The Space chat draft is independent of both.
  const draftText =
    "Human constraints: NEVER offer weekend support. Keep this exact sentence. Unsent editor-only draft.";
  await humanField.fill(draftText);
  await page.goto(spaceURL);
  await expect(surface.getByText(/Keep this exact sentence/)).toBeVisible();
  await expect(surface.getByText(/Unsent editor-only draft/)).toHaveCount(0);
  await page
    .getByLabel("Continue the conversation", { exact: true })
    .fill("Unsent Space chat draft");
  await page
    .getByRole("button", { name: "Edit Space goal", exact: true })
    .click();
  const goalField = page.getByLabel("Goal", { exact: true });
  await goalField.fill(
    "Develop a bounded offer and validate demand before launch; human-scoped goal",
  );
  await page
    .getByText("Conversation history and activity", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh conversation", exact: true })
    .click();
  await expect(goalField).toHaveValue(
    "Develop a bounded offer and validate demand before launch; human-scoped goal",
  );
  await page.getByRole("button", { name: "Save Space", exact: true }).click();
  await expect(goalField).toHaveCount(0);
  await expect(
    page.getByLabel("Continue the conversation", { exact: true }),
  ).toHaveValue("Unsent Space chat draft");
  await expect(surface.getByText(/Keep this exact sentence/)).toBeVisible();
  assert.equal(
    cli("artifact", [aid]).current_revision_id,
    artifact.current_revision_id,
  );
  await page.goto(`${fixture.web}/conversations/${cid}/artifacts/${aid}`);
  await expect(
    page.locator("textarea").filter({ hasText: "Human constraints:" }),
  ).toHaveValue(draftText);
  await page
    .getByRole("button", { name: "Discard my changes", exact: true })
    .click();
  evidence.push({
    goal_edit_refresh_stable: true,
    saved_content_preserved: true,
    editor_draft_preserved: true,
    space_chat_draft_preserved: true,
  });
  const saved = [
    aid,
    artifact.current_revision_id,
    artifact.current_revision.body_hash,
  ];
  // Stale exact target cannot be admitted; no worker is run for this command.
  const stale = cli(
    "follow",
    [cid, "This stale edit must be rejected", "--target", ...exact],
    true,
  );
  assert.match(stale.error, /version_conflict/);
  const follow = cli("follow", [
    cid,
    "Make the pilot one week, preserve the saved human constraints",
    "--target",
    ...saved,
  ]);
  assert.equal(follow.receipt.run.state, "queued");
  assert.equal(follow.receipt.message.target.body_hash, saved[2]);
  control("work", follow.receipt.run.id, "one-week");
  await page.goto(spaceURL);
  await expect(
    surface.getByText("1 pending proposal to review", { exact: true }),
  ).toBeVisible();
  await expect(surface.getByText(/Keep this exact sentence/)).toBeVisible();
  await page
    .getByRole("link", {
      name: "Edit, review or refine this version",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply proposed version", exact: true }),
  ).toBeVisible();
  const proposal = cli("proposals", [aid]).items.find(
    (p) => p.status === "pending",
  );
  assert.ok(
    proposal.body.blocks.some((b) =>
      b.text.includes("Keep this exact sentence."),
    ),
  );
  await page.screenshot({
    path: path.join(directory, "proposal-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: path.join(directory, "proposal-mobile.png"),
    fullPage: true,
  });
  const apply = page.getByRole("button", {
    name: "Apply proposed version",
    exact: true,
  });
  await expect(apply).toBeVisible();
  const bounds = await apply.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 321);
  await apply.click();
  await expect(
    page.getByRole("button", { name: "Apply proposed version", exact: true }),
  ).toHaveCount(0);
  artifact = cli("artifact", [aid]);
  assert.ok(artifact.current_revision.body.blocks[0].text.includes("one-week"));
  assert.ok(
    artifact.current_revision.body.blocks.some((b) =>
      b.text.includes("Keep this exact sentence."),
    ),
  );
  // The accepted canonical content, not only a link/count, survives leaving
  // and reopening the Space on desktop and 320px. Chat is secondary/untargeted.
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(spaceURL);
    await expect(
      surface.getByText(/one-week service design pilot/),
    ).toBeVisible();
    await expect(surface.getByText(/Keep this exact sentence/)).toBeVisible();
    await expect(page.getByText(/no artifact is targeted/)).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Conversation", exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByLabel("Continue the conversation", { exact: true }),
    ).toBeVisible();
    const workBox = await surface.boundingBox();
    const chatBox = await page
      .getByRole("region", { name: "Space conversation", exact: true })
      .boundingBox();
    assert.ok(workBox.y < chatBox.y);
    assert.ok(workBox.x >= 0 && workBox.x + workBox.width <= width + 1);
    await page.screenshot({
      path: path.join(directory, `accepted-space-${width}.png`),
      fullPage: true,
    });
  }
  evidence.push({
    accepted_content_visible_on_space: [1440, 320],
    human_sentence_preserved_on_space: true,
    work_before_chat: true,
  });
  // A second proposal is dismissed through the same TUI HTTP command path.
  const next = cli("follow", [
    cid,
    "Compare a three-day pilot without replacing saved work",
    "--target",
    aid,
    artifact.current_revision_id,
    artifact.current_revision.body_hash,
  ]);
  control("work", next.receipt.run.id, "three-day");
  const p2 = cli("proposals", [aid]).items.find((p) => p.status === "pending");
  cli("dismiss", [p2.id, aid, artifact.current_revision_id]);
  assert.equal(
    cli("artifact", [aid]).current_revision_id,
    artifact.current_revision_id,
  );
  cli("history", [aid]);
  cli("run", [next.receipt.run.id]);
  const detail = cli("show", [cid]);
  const observation = detail.messages
    .flatMap((m) => m.result?.results ?? [])
    .find((r) => r.observation_id);
  cli("observation", [observation.observation_id]);
  // Multiple canonical artifacts: select the table and read its next action
  // at 320px without horizontal scrolling, then return to the saved document.
  const tableTurn = cli("follow", [
    cid,
    "Create a separate synthetic next-actions table",
  ]);
  control("work", tableTurn.receipt.run.id, "table");
  const multiple = cli("show", [cid]);
  assert.equal(multiple.artifact_ids.length, 2);
  const tableId = multiple.artifact_ids.find((id) => id !== aid);
  await page.goto(spaceURL);
  await page
    .getByRole("combobox", { name: "Work to read" })
    .selectOption(tableId);
  const nextAction = surface.getByText(
    "Interview three prospective clients before quoting a fixed fee.",
    { exact: true },
  );
  await expect(nextAction).toBeVisible();
  const nextBox = await nextAction.boundingBox();
  assert.ok(
    nextBox.x >= 0 && nextBox.x + nextBox.width <= 321,
    JSON.stringify(nextBox),
  );
  const mobileWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(
    mobileWidths.scroll <= mobileWidths.client,
    JSON.stringify(mobileWidths),
  );
  await page.screenshot({
    path: path.join(directory, "table-space-320.png"),
    fullPage: true,
  });
  await page.getByRole("combobox", { name: "Work to read" }).selectOption(aid);
  await expect(surface.getByText(/Keep this exact sentence/)).toBeVisible();
  evidence.push({
    multiple_artifact_selection: true,
    mobile_table_next_action_bounds: nextBox,
    mobileWidths,
  });
  // Actual PTY action creates a queued prompt, with navigation + resize + quit.
  control("pty", cid);
  const pending = cli("show", [cid]).turns.find((t) => t.state === "queued");
  assert.ok(pending);
  cli("cancel", [cid]);
  assert.equal(cli("run", [pending.run_id]).state, "cancelled");
  await page.goto(`${fixture.web}/spaces`);
  await expect(
    page.getByRole("link", { name: /Synthetic service launch/ }).first(),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /Synthetic service launch/ })
    .first()
    .click();
  await expect(page).toHaveURL(spaceURL);
  await expect(page.getByText(/Develop a bounded offer/).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Work to read" }).selectOption(aid);
  await expect(
    page.getByRole("link", {
      name: "Synthetic service launch offer",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(directory, "reopen-mobile.png"),
    fullPage: true,
  });
  await page.goto(`${fixture.web}/spaces`);
  await page.getByRole("button", { name: "New Space", exact: true }).click();
  await page
    .getByLabel("Space title", { exact: true })
    .fill("Human-created workflow");
  await page
    .getByLabel("Goal", { exact: true })
    .fill("Prepare a reusable weekly offer review");
  await page
    .getByRole("combobox", { name: "Space kind", exact: true })
    .selectOption("workflow");
  await page.getByRole("button", { name: "Create Space", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Human-created workflow", exact: true }),
  ).toBeVisible();
  const manualId = new URL(page.url()).pathname.split("/").at(-1);
  assert.equal(cli("area", [manualId]).conversation.work_area.origin, "human");
  await page.goBack();
  await expect(page).toHaveURL(`${fixture.web}/spaces`);
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Human-created workflow", exact: true }),
  ).toBeVisible();
  const created = cli("create", [
    "TUI project",
    "Inspect the shared project boundary",
    "project",
  ]);
  const promoted = cli("promote", [
    created.receipt.id,
    "TUI edited title",
    "Human-scoped goal",
    "workflow",
  ]);
  assert.equal(promoted.readback.conversation.work_area.kind, "workflow");
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(widths.scroll <= widths.client, JSON.stringify(widths));
  evidence.push({
    mobile_widths: widths,
    browser_back_forward: "passed",
    manual_creation: manualId,
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(directory, "journey.json"),
    JSON.stringify(
      {
        status: "passed",
        controlled: true,
        model_usefulness: "not evaluated",
        conversation_id: cid,
        artifact_id: aid,
        space_url: spaceURL,
        evidence,
      },
      null,
      2,
    ),
  );
  console.log("CONTROLLED real-API browser / HTTP TUI / PTY journey passed");
} catch (error) {
  writeFileSync(
    path.join(directory, "journey-failure.json"),
    JSON.stringify(
      { error: String(error), url: page.url(), evidence, errors },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: path.join(directory, "failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
