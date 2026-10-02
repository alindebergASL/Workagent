/**
 * Intake next-action outcome evidence against the real API and PostgreSQL.
 * Mutations go through the domain API, the deterministic fixture worker and,
 * for managed-run states, `intake_synthetic.py` (backend trusted seams with an
 * explicitly synthetic attempt; nothing is sent to any provider). The browser
 * only reads, checks every surface agrees, and captures 1440/390/320 px.
 *
 * Usage (stack running without the dispatcher, disposable env sourced):
 *   node web/scripts/intake-states.mjs <out-dir>            # initial phase
 *   node web/scripts/intake-states.mjs <out-dir> --reopen   # after API/web restart
 */
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.argv[2] ?? path.join(root, ".local/evidence/intake"),
);
const reopen = process.argv.includes("--reopen");
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
const python = path.join(root, "backend/.venv/bin/python");
const advance = (run) =>
  execFileSync(
    python,
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
const synthetic = (...args) =>
  JSON.parse(
    execFileSync(
      python,
      [path.join(root, "web/scripts/intake_synthetic.py"), ...args],
      {
        cwd: root,
        env: process.env,
      },
    ).toString(),
  );
const latestRun = (a) =>
  a.responsibility.runs.find(
    (r) => r.run_id === a.responsibility.latest_run_id,
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

/** Open a page, let it settle, optionally interact, check no horizontal scroll, capture each width. */
async function capture(name, url, prepare) {
  for (const [label, viewport] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + url);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    if (prepare) await prepare(page, label);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      `${name} ${label}: no horizontal scroll`,
    ).toBe(false);
    // Full-page capture pins sticky bars mid-page; render them in flow for the image only.
    await page.addStyleTag({
      content: ".action-bar,.sticky-actions{position:static !important}",
    });
    await page.screenshot({
      path: path.join(out, `${name}-${label}.png`),
      fullPage: true,
    });
    await page.close();
  }
}

const openGroups = async (page) => {
  for (const d of await page.locator("details.since-group").all())
    if (!(await d.evaluate((e) => e.open))) await d.locator("summary").click();
};
const showAgent = async (page) => {
  const toggle = page.locator(".working-switch");
  if (await toggle.isVisible())
    await toggle.getByRole("button", { name: "Agent", exact: true }).click();
};

/** The same label on Agent (Home), Spaces and the assignment page. */
async function surfaces(id, label) {
  const page = await browser.newPage({ viewport: sizes.desktop });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/");
  await openGroups(page);
  await expect(
    page.locator(`[data-assignment="${id}"] .status`).first(),
  ).toHaveText(label);
  await page.goto(origin + "/spaces/local-workspace");
  await expect(
    page.locator(`.work-row[data-assignment="${id}"] .status`),
  ).toHaveText(label);
  await page.goto(origin + "/assignments/" + id);
  await expect(page.locator("header .status").first()).toHaveText(label);
  const line = await page.locator("header .status-line").innerText();
  await page.close();
  return line;
}

try {
  if (reopen) {
    const state = JSON.parse(
      await readFile(path.join(out, "state.json"), "utf8"),
    );
    // Approved document: same revision and readback after restart.
    const a = await api("/assignments/" + state.assignment_id);
    expect(latestRun(a).state).toBe("readback_verified");
    const art = await api("/artifacts/" + state.artifact_id);
    expect(art.current_revision_id).toBe(state.approved_revision_id);
    await surfaces(state.assignment_id, "Approved revision");
    await capture(
      "11-reopened-approved-artifact",
      state.artifact_url,
      async (page) => {
        await expect(page.locator("header .status").first()).toHaveText(
          "Approved revision",
        );
      },
    );
    // Unknown outcome: still unknown, nothing resent, no new run admitted.
    const u = await api("/assignments/" + state.unknown_id);
    expect(latestRun(u).state).toBe("outcome_unknown");
    expect(u.run_ids).toEqual(state.unknown_run_ids);
    await surfaces(state.unknown_id, "Waiting to confirm");
    await capture("12-reopened-unknown", "/assignments/" + state.unknown_id);
    await writeFile(
      path.join(out, "restart.json"),
      JSON.stringify(
        {
          passed: true,
          same_revision: art.current_revision_id,
          approved_state: latestRun(a).state,
          unknown_state: latestRun(u).state,
          unknown_run_ids_unchanged: true,
          errors,
        },
        null,
        2,
      ) + "\n",
    );
    expect(errors).toEqual([]);
    console.log(
      "PASS: approved readback and unknown outcome reopen unchanged after API/web restart",
    );
  } else {
    // 1. Prepared next action (fixture worker, real API/PostgreSQL).
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
      goal: "Handle this intake. Work out the next move, prepare it, and ask me where my judgment is needed.",
      completion_criteria: [
        "Prepare a next-action document that names the missing information and the judgment needed.",
      ],
      selected_source_refs: pick,
    });
    const id = created.assignment.id;
    advance(created.run.id);
    let a = await api("/assignments/" + id);
    expect(latestRun(a).state).toBe("prepared");
    expect(a.responsibility.underlying_action_performed).toBe(false);
    const plan = (
      await Promise.all(a.artifact_ids.map((x) => api("/artifacts/" + x)))
    ).find((x) => /plan/i.test(x.current_revision.body.title));
    const artifactUrl = `/assignments/${id}/artifacts/${plan.id}`;
    await surfaces(id, "Ready for review");
    await capture("01-prepared-home", "/");
    await capture(
      "02-prepared-assignment",
      "/assignments/" + id,
      async (page) => {
        await page.getByText("What review means").click();
        await expect(page.locator(".status-more")).toContainText(
          "hasn’t been carried out",
        );
      },
    );

    // 2. A specific decision: human edit, then a proposal bound to its exact base.
    const human = "Keep Wednesday 14:00–15:00 for method drafting.";
    const body = structuredClone(plan.current_revision.body);
    body.blocks = body.blocks.map((b) =>
      b.block_id === "protected-0" ? { ...b, text: human } : b,
    );
    const saved = await api(`/artifacts/${plan.id}/save`, {
      ...cmd(),
      expected_current_revision_id: plan.current_revision_id,
      body,
    });
    const queued = await api(`/artifacts/${plan.id}/request-revision`, {
      ...cmd(),
      expected_work_version: (await api("/assignments/" + id)).work_version,
      base_revision_id: saved.current_revision_id,
      instruction:
        "Name the one owner decision I need to make before the next eight cases.",
    });
    advance(queued.run?.id ?? (await api("/assignments/" + id)).run_ids.at(-1));
    a = await api("/assignments/" + id);
    const decision = latestRun(a);
    expect(decision.state).toBe("decision_required");
    expect(decision.question.base_revision_id).toBe(saved.current_revision_id);
    await surfaces(id, "Decision needed");
    await capture("03-decision-home", "/");
    await capture("04-decision-artifact", artifactUrl, async (page) => {
      await expect(page.locator("header .status").first()).toHaveText(
        "Decision needed",
      );
      await expect(page.locator(".decision-question")).toHaveText(
        decision.question.prompt,
      );
    });

    // 3. Exact accepted revision, read back.
    await api(`/proposals/${decision.question.proposal_id}/accept`, {
      ...cmd(),
      expected_current_revision_id: decision.question.base_revision_id,
    });
    a = await api("/assignments/" + id);
    const approved = latestRun(a);
    expect(approved.state).toBe("readback_verified");
    expect(approved.underlying_action_performed).toBe(false);
    const line = await surfaces(id, "Approved revision");
    expect(line).toContain("confirmed by reading it back");
    await capture(
      "05-approved-assignment",
      "/assignments/" + id,
      async (page) => {
        await page.getByText("What I checked").click();
        await expect(
          page.getByRole("list", { name: "Document checks" }),
        ).toContainText("Based on the exact revision you saw");
        await expect(
          page.getByText("The next action itself hasn’t been carried out."),
        ).toBeVisible();
      },
    );
    await capture("06-approved-artifact", artifactUrl, showAgent);
    const art = await api("/artifacts/" + plan.id);

    // 4. Managed run with no installed consumer: waiting, nothing sent.
    const grant = synthetic("grant");
    const waiting = synthetic(
      "managed",
      "--goal",
      "Prepare the next move for the second intake case.",
    );
    expect(
      latestRun(await api("/assignments/" + waiting.assignment_id)).blocker,
    ).toBe("consumer_unavailable");
    await surfaces(waiting.assignment_id, "Agent not connected");
    await capture(
      "07-waiting-assignment",
      "/assignments/" + waiting.assignment_id,
    );

    // 5. Provider outcome unknown (synthetic attempt marked unknown): no retry control.
    const unknown = synthetic(
      "managed",
      "--goal",
      "Prepare the next move for the third intake case.",
      "--unknown",
    );
    const u = await api("/assignments/" + unknown.assignment_id);
    expect(latestRun(u).state).toBe("outcome_unknown");
    await surfaces(unknown.assignment_id, "Waiting to confirm");
    await capture(
      "08-unknown-assignment",
      "/assignments/" + unknown.assignment_id,
      async (page) => {
        await expect(
          page.getByRole("button", { name: "Check again" }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: /retry|send/i }),
        ).toHaveCount(0);
        await page.getByRole("button", { name: "Check again" }).click();
        await expect(page.locator("header .status").first()).toHaveText(
          "Waiting to confirm",
        );
        await page.getByText("What I checked").click();
        await expect(
          page.getByText(/not a live run|not verified/i).first(),
        ).toBeVisible();
      },
    );
    await capture("09-home-all-states", "/", openGroups);
    await capture("10-spaces-all-states", "/spaces/local-workspace");

    await writeFile(
      path.join(out, "state.json"),
      JSON.stringify(
        {
          mode: "real_ui_api_postgresql; fixture compute; synthetic provider attempt for the unknown state; no provider calls",
          assignment_id: id,
          artifact_id: plan.id,
          artifact_url: artifactUrl,
          approved_revision_id: art.current_revision_id,
          decision_question: decision.question,
          approved_outcome: approved,
          waiting_id: waiting.assignment_id,
          waiting_outcome: latestRun(
            await api("/assignments/" + waiting.assignment_id),
          ),
          unknown_id: unknown.assignment_id,
          unknown_run_ids: u.run_ids,
          unknown_outcome: latestRun(u),
          grant_id: grant.grant_id,
          errors,
        },
        null,
        2,
      ) + "\n",
    );
    expect(errors).toEqual([]);
    console.log(
      "PASS: prepared, exact decision, readback-verified approval, waiting and unknown agree on Agent/Spaces/assignment",
    );
  }
} finally {
  await browser.close();
}
