import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, ".local/evidence/fault-regressions");
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
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
      headers: {
        "X-Workagent-Client": "local-ui",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const data = await r.json();
  expect(r.status, JSON.stringify({ path: p, data })).toBe(status);
  return data;
};
const advance = (run) =>
  JSON.parse(
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
      { cwd: path.join(root, "backend"), env: process.env, encoding: "utf8" },
    ),
  );
const ready = async () => {
  const refs = (await api("/sources")).items.map((s) => ({
    source_id: s.id,
    external_version: s.external_version,
    observed_at: s.observed_at,
  }));
  const command = {
    ...cmd(),
    goal: "Independent fault regression",
    completion_criteria: ["Private plan"],
    selected_source_refs: refs,
  };
  const created = await api("/assignments", command, 202);
  advance(created.run.id);
  const a = await api("/assignments/" + created.assignment.id);
  const art = await api("/artifacts/" + a.artifact_ids[0]);
  return {
    a,
    art,
    command,
    created,
    url: origin + `/assignments/${a.id}/artifacts/${art.id}`,
  };
};
const propose = async (x) => {
  const q = await api(
    "/artifacts/" + x.art.id + "/request-revision",
    {
      ...cmd(),
      base_revision_id: x.art.current_revision_id,
      expected_work_version: x.a.work_version,
      instruction: "Explicit review only",
    },
    202,
  );
  return advance(q.run.id);
};
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  // Optional preinstalled browser for hosts that cannot download Playwright's own.
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const results = {};
const freshPage = () =>
  browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  // R3: refresh reactivates polling without a navigation, reload or mocked response.
  {
    const x = await ready();
    const p = await freshPage();
    await p.goto(x.url);
    await p
      .getByRole("button", { name: "Request revision", exact: true })
      .click();
    await p
      .getByLabel("What should change?")
      .fill("Observe normal revision completion");
    await p.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(
      p.getByText("A revision is being drafted", { exact: true }),
    ).toBeVisible();
    const queued = await api("/assignments/" + x.a.id);
    advance(queued.run_ids.at(-1));
    // The finished proposal arrives as an actionable decision, without a reload.
    await expect(
      p.getByRole("button", { name: "Apply proposal", exact: true }),
    ).toBeVisible({ timeout: 12000 });
    results.polling_restarts = { passed: true, without_reload: true };
    await p.screenshot({
      path: path.join(out, "polling-completed.png"),
      fullPage: true,
    });
    await p.close();
  }
  // R1: a restored stale draft cannot silently replace a newer protected note.
  {
    const x = await ready();
    const p = await freshPage();
    await p.goto(x.url);
    await p.getByRole("button", { name: "Edit", exact: true }).click();
    await p
      .getByLabel("Paragraph recommendation", { exact: true })
      .fill("MY UNSAVED DRAFT");
    await expect
      .poll(() =>
        p.evaluate(() =>
          Object.values(sessionStorage).join(" ").includes("MY UNSAVED DRAFT"),
        ),
      )
      .toBe(true);
    const body = structuredClone(x.art.current_revision.body);
    body.blocks.find((b) => b.block_id === "protected-0").text =
      "NEWER HUMAN PROTECTED WEDNESDAY CHANGE";
    const saved = await api("/artifacts/" + x.art.id + "/save", {
      ...cmd(),
      expected_current_revision_id: x.art.current_revision_id,
      body,
    });
    await p.reload();
    await p
      .getByRole("button", { name: "Resume editing", exact: true })
      .click();
    await expect(
      p.getByText("A newer version was saved while you were editing", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      p.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    expect((await api("/artifacts/" + x.art.id)).current_revision_id).toBe(
      saved.current_revision_id,
    );
    await p
      .getByRole("button", {
        name: "Continue my draft on top of the current version",
        exact: true,
      })
      .click();
    // Even explicit continuation must recheck a later concurrent save.
    body.blocks.find((b) => b.block_id === "protected-0").text =
      "THIRD HUMAN PROTECTED CHANGE";
    const third = await api("/artifacts/" + x.art.id + "/save", {
      ...cmd(),
      expected_current_revision_id: saved.current_revision_id,
      body,
    });
    await p.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    const final = await api("/artifacts/" + x.art.id);
    expect(final.current_revision_id).toBe(third.current_revision_id);
    expect(
      final.current_revision.body.blocks.find(
        (b) => b.block_id === "protected-0",
      ).text,
    ).toBe("THIRD HUMAN PROTECTED CHANGE");
    results.restored_draft = {
      passed: true,
      base: x.art.current_revision_id,
      preserved: third.current_revision_id,
      explicit_continuation_still_checks_cas: true,
    };
    await p.screenshot({
      path: path.join(out, "restored-draft-protected.png"),
      fullPage: true,
    });
    await p.close();
  }
  // R2: a real post-commit lost 202 is retried with identical command/base/work version.
  {
    const x = await ready();
    const p = await freshPage();
    await p.goto(x.url);
    await p
      .getByRole("button", { name: "Request revision", exact: true })
      .click();
    await p.getByLabel("What should change?").fill("Exactly one revision run");
    const sent = [];
    await p.route("**/request-revision", async (route) => {
      sent.push(route.request().postDataJSON());
      if (sent.length === 1) {
        const real = await route.fetch();
        expect(real.status()).toBe(202);
        await route.abort("failed");
      } else await route.continue();
    });
    await p.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Send request", exact: true }),
    ).toBeEnabled();
    await expect(p.getByLabel("What should change?")).toBeDisabled();
    await p.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(
      p.getByText("A revision is being drafted", { exact: true }),
    ).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    const state = await api("/assignments/" + x.a.id);
    expect(state.run_ids.length - x.a.run_ids.length).toBe(1);
    results.revision_response_loss = {
      passed: true,
      command_id: sent[0].command_id,
      revision_run_count: 1,
    };
    await p.close();
  }
  // R4: full resolution intent survives failure before save, after save and after dismiss.
  for (const phase of [
    "before-save",
    "after-save-commit",
    "after-dismiss-commit",
  ]) {
    const x = await ready();
    const run = await propose(x);
    const p = await freshPage();
    await p.goto(x.url);
    await p
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    await p
      .getByLabel("Paragraph recommendation", { exact: true })
      .fill("HUMAN RESOLVED BODY " + phase);
    const saves = [],
      dismisses = [];
    await p.route("**/save", async (route) => {
      saves.push(route.request().postDataJSON());
      if (saves.length === 1 && phase !== "after-dismiss-commit") {
        if (phase === "after-save-commit") {
          const r = await route.fetch();
          expect(r.status()).toBe(200);
        }
        await route.abort("failed");
      } else await route.continue();
    });
    await p.route("**/dismiss", async (route) => {
      dismisses.push(route.request().postDataJSON());
      if (dismisses.length === 1 && phase === "after-dismiss-commit") {
        const r = await route.fetch();
        expect(r.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await p
      .getByRole("button", { name: "Save resolution", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Retry the same save", exact: true }),
    ).toBeVisible();
    if (phase === "after-save-commit") {
      await p
        .getByRole("button", { name: "Check the saved version", exact: true })
        .click();
      await expect(
        p.getByText(
          /Your text is saved, but the proposal resolution is not confirmed/,
        ),
      ).toBeVisible();
    }
    await p
      .getByRole("button", { name: "Retry the same save", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();
    const art = await api("/artifacts/" + x.art.id);
    const proposals = (await api("/artifacts/" + x.art.id + "/proposals"))
      .items;
    expect(art.current_revision.revision_number).toBe(2);
    expect(
      art.current_revision.body.blocks.find(
        (b) => b.block_id === "recommendation",
      ).text,
    ).toBe("HUMAN RESOLVED BODY " + phase);
    expect(proposals.find((p) => p.id === run.proposal_id).status).toBe(
      "dismissed",
    );
    expect(saves).toHaveLength(2);
    expect(saves[0].command_id).toBe(saves[1].command_id);
    expect(saves[0].body).toEqual(saves[1].body);
    if (dismisses.length === 2)
      expect(dismisses[0].command_id).toBe(dismisses[1].command_id);
    expect(dismisses.length).toBeGreaterThan(0);
    results["resolution_" + phase] = {
      passed: true,
      save_command: saves[0].command_id,
      dismiss_command: dismisses[0].command_id,
      revision_number: 2,
      proposal_status: "dismissed",
    };
    await p.close();
  }
  // R2 decision controls also freeze IDs and expectations after pre-dispatch loss.
  for (const [operation, label] of [
    ["dismiss", "Keep current version"],
    ["accept", "Apply proposal"],
  ]) {
    const x = await ready();
    const run = await propose(x);
    const p = await freshPage();
    await p.goto(x.url);
    const sent = [];
    await p.route("**/" + operation, async (route) => {
      sent.push(route.request().postDataJSON());
      if (sent.length === 1) await route.abort("failed");
      else await route.continue();
    });
    await p.getByRole("button", { name: label, exact: true }).click();
    await expect(
      p.getByRole("button", { name: label, exact: true }),
    ).toBeEnabled();
    await p.getByRole("button", { name: label, exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[0].command_id).toBe(sent[1].command_id);
    expect(sent[0].expected_current_revision_id).toBe(
      sent[1].expected_current_revision_id,
    );
    const status = (
      await api("/artifacts/" + x.art.id + "/proposals")
    ).items.find((p) => p.id === run.proposal_id).status;
    expect(status).toBe(operation === "accept" ? "accepted" : "dismissed");
    results["decision_" + operation] = {
      passed: true,
      command_id: sent[0].command_id,
    };
    await p.close();
  }
  // R5/R6: drift is not revocation; historical dependencies cannot be labeled latest evidence.
  {
    const x = await ready();
    const python = path.join(root, "backend/.venv/bin/python");
    const helper = path.join(root, "web/scripts/source-drift.py");
    execFileSync(python, [helper, "apply"], { env: process.env });
    try {
      const receipt = await api(
        "/assignments",
        { ...x.command, request_id: crypto.randomUUID() },
        202,
      );
      expect(receipt).toEqual(x.created);
      const conflict = await api(
        "/assignments",
        { ...x.command, goal: "Changed intent" },
        409,
      );
      expect(conflict.code).toBe("command_conflict");
      const p = await freshPage();
      await p.goto(x.url);
      await p.getByRole("button", { name: "Sources", exact: true }).click();
      const card = p.locator("#source-SG-F1");
      await expect(card).toContainText("current @review-v2");
      await expect(card).toContainText("Work observed @1");
      await expect(card).toContainText(
        "Historical source bytes are unavailable",
      );
      await expect(card).toContainText("not evidence used by artifacts");
      await expect(card).toContainText(
        "This current version is not evidence for a saved result",
      );
      await expect(card.locator("pre")).toContainText("review_latest_only");
      results.source_drift = {
        passed: true,
        recorded_version: "1",
        latest_version: "review-v2",
        exact_replay: true,
        changed_intent_conflicts: true,
        historical_bytes_substituted: false,
      };
      await p.screenshot({
        path: path.join(out, "source-drift-labelled.png"),
        fullPage: true,
      });
      await p.close();
    } finally {
      execFileSync(python, [helper, "restore"], { env: process.env });
    }
  }
  console.log(
    JSON.stringify({
      result: "PASS",
      case_count: Object.keys(results).length,
      results,
    }),
  );
} finally {
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify(
      { case_count: Object.keys(results).length, results },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
}
