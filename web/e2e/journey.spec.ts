import { expect, test } from "@playwright/test";
import {
  control,
  headers,
  noHorizontalScroll,
  shot,
  writeJourney,
  type JourneyIds,
} from "./helpers";

const PROTECTED_NOTE = "Keep Wednesday 14:00–15:00 for method drafting.";
const HUMAN_TEXT =
  "Review each new case with the checklist at the point of intake, and note who asked for it.";

test.describe("S1 journey (mock mode)", () => {
  test.describe.configure({ mode: "serial" });

  test("start → inspect → edit → save → stale proposal → resolve @journey", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(120_000);
    await control(request, "reset");

    // ---- Work Home: empty state ----
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Good to see you." }),
    ).toBeVisible();
    await expect(
      page.getByText(/hand over something you’d like finished/),
    ).toBeVisible();
    await expect(page.getByText(/I’m handling/)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Take it from here" }),
    ).toBeDisabled();
    await noHorizontalScroll(page);
    await shot(page, info, "01-home-empty");

    // Conversation isn't connected yet: sending says so, sends nothing and keeps the text.
    await page
      .getByLabel("Message your agent")
      .fill("Draft a plan from nothing");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByText(/I can’t reply in conversation yet/),
    ).toBeVisible();
    await expect(page.getByLabel("Message your agent")).toHaveValue(
      "Draft a plan from nothing",
    );
    await shot(page, info, "01b-home-conversation-unavailable");

    // Handing over without context asks for it (the deployed API requires a source).
    await page.getByRole("button", { name: "Take it from here" }).click();
    await expect(page.getByText("Records this work may use")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByLabel("Message your agent")).toHaveValue(
      "Draft a plan from nothing",
    );

    await page.getByRole("button", { name: /Try the intake example/ }).click();
    await expect(page.getByLabel("Message your agent")).toHaveValue(
      /intake log/,
    );
    await expect(
      page.getByRole("button", { name: "Your context · 3 sources" }),
    ).toBeVisible();
    await shot(page, info, "02-home-filled");
    await page.getByRole("button", { name: "Take it from here" }).click();

    // ---- Assignment: queued/working → ready ----
    await page.waitForURL(/\/assignments\/asg_\d+$/);
    const assignmentId = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /intake log/i,
    );
    const status = page.locator(".status-line");
    await expect(status).toContainText(/I’m on it/);
    await shot(page, info, "03-assignment-working");
    await expect(page.getByRole("link", { name: "Open plan" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(status).toContainText("Ready for you to review");
    await expect(page.locator(".status-more")).toContainText(
      "Preparation is not approval",
    );
    await expect(page.locator("header .status").first()).toHaveText(
      "Ready for review",
    );
    await expect(page.getByText(/I’m on it/)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Recommendation" }),
    ).toBeVisible();
    await expect(page.getByText(/4 of 8 cases \(50%\)/)).toBeVisible();
    await expect(
      page.locator('section[aria-labelledby="saved-title"] .work-row'),
    ).toHaveCount(3);
    await noHorizontalScroll(page);
    await shot(page, info, "04-assignment-ready");

    // Sources drawer with focus return.
    await page.getByText("What I checked", { exact: true }).click();
    const sourcesBtn = page.getByRole("button", { name: "Open sources" });
    await sourcesBtn.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Personal intake review log")).toBeVisible();
    await expect(
      dialog
        .locator("#source-SG-F2")
        .getByText("Used by: Analysis, Working plan, Intake review checklist"),
    ).toBeVisible();
    await shot(page, info, "05-assignment-sources");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(sourcesBtn).toBeFocused();

    // Activity is available on demand.
    await page.getByText("What happened", { exact: true }).click();
    await expect(
      page.getByText("Assignment created from 3 selected sources."),
    ).toBeVisible();

    // ---- Artifact: read ----
    await page.getByRole("link", { name: "Open plan" }).click();
    await page.waitForURL(/\/artifacts\/art_\d+$/);
    const planId = page.url().split("/").pop()!;
    await expect(
      page.getByRole("heading", { level: 1, name: "Working plan" }),
    ).toBeVisible();
    await expect(
      page.locator(".doc-card").getByText(PROTECTED_NOTE),
    ).toBeVisible();
    await expect(page.locator(".save-state")).toHaveText(/Saved · revision 1/);
    await noHorizontalScroll(page);
    await shot(page, info, "06-artifact-read");

    // Source marker opens the Sources sheet at that source.
    await page.locator(".mark", { hasText: "SG-F7" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText("Personal working plan"),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // ---- Request an agent revision based on revision 1 (held by the mock) ----
    await page.getByRole("button", { name: "Request revision" }).click();
    await page
      .getByLabel("What should change?")
      .fill("Add a default owner so no case is saved blank.");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("A revision is being drafted")).toBeVisible();

    // ---- Human edit and save (revision 2) ----
    await page.getByRole("button", { name: "Edit" }).click();
    const target = page.getByLabel("List item pl-s2");
    await expect(target).toBeVisible();
    await target.fill(HUMAN_TEXT);
    await expect(page.locator(".save-state")).toHaveText("Unsaved changes");
    await shot(page, info, "07-artifact-editing");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".save-state")).toHaveText(/Saved · revision 2/);
    await expect(
      page.locator(".notice").getByText("Saved as revision 2."),
    ).toBeVisible();
    await expect(page.locator(".doc-card").getByText(HUMAN_TEXT)).toBeVisible();
    await expect(
      page.locator(".doc-card").getByText(PROTECTED_NOTE),
    ).toBeVisible();
    await shot(page, info, "08-artifact-saved");

    // Server readback of the human save.
    const art = await (
      await request.get(`/api/mock/workspaces/ws_alex/artifacts/${planId}`, {
        headers: headers(),
      })
    ).json();
    expect(art.accepted_revision.sequence).toBe(2);
    expect(art.accepted_revision.author.kind).toBe("human");
    const humanRevisionId: string = art.accepted_revision_id;
    const proposalId1: string = art.pending_proposal.id;
    expect(art.pending_proposal.status).toBe("generating");

    // ---- Release the stale proposal: CAS fails, both bodies retained ----
    await control(request, "release-proposal", { proposal_id: proposalId1 });
    await page.reload();
    await expect(
      page.getByText("Decision needed", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Current saved version" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Agent proposal based on revision 1/ }),
    ).toBeVisible();
    const currentPane = page.locator('.conflict-pane[data-role="current"]');
    const proposalPane = page.locator('.conflict-pane[data-role="proposal"]');
    await expect(currentPane.getByText(HUMAN_TEXT)).toBeVisible();
    await expect(proposalPane.getByText(HUMAN_TEXT)).toHaveCount(0);
    await expect(proposalPane.getByText("Proposed change")).toBeVisible();
    await expect(currentPane.getByText(PROTECTED_NOTE)).toBeVisible();
    // Revision numbers in view; exact identifiers on demand.
    await expect(
      page.locator(".conflict-pane header .ids").first(),
    ).toContainText("Revision 2");
    await page.getByText("Revision details", { exact: true }).click();
    await expect(page.locator(".decision-card .ids")).toContainText(
      humanRevisionId,
    );
    await noHorizontalScroll(page);
    await shot(page, info, "09-artifact-conflict");

    const after = await (
      await request.get(`/api/mock/workspaces/ws_alex/artifacts/${planId}`, {
        headers: headers(),
      })
    ).json();
    expect(
      after.accepted_revision_id,
      "accepted pointer unchanged by the stale proposal",
    ).toBe(humanRevisionId);
    expect(after.pending_proposal.status).toBe("conflicted");
    expect(
      after.pending_proposal.body,
      "proposal body retained",
    ).not.toBeNull();

    // Keyboard-only: the default primary action keeps the current version.
    await page.getByRole("button", { name: "Keep current version" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(page.locator(".save-state")).toHaveText(/Saved · revision 2/);
    await expect(page.locator(".doc-card").getByText(HUMAN_TEXT)).toBeVisible();

    // History keeps the declined proposal and allows viewing an old revision without restoring it.
    await page.getByRole("button", { name: "History" }).click();
    const hist = page.getByRole("dialog");
    await expect(hist.getByText("Revision 2 · current")).toBeVisible();
    await expect(hist.getByText("Kept current version instead")).toBeVisible();
    await shot(page, info, "10-artifact-history");
    await hist.getByRole("button", { name: "View this revision" }).click();
    await expect(
      page.getByText(/Viewing revision 1 \(not the current version\)/),
    ).toBeVisible();
    await expect(page.locator(".doc-card").getByText(HUMAN_TEXT)).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await page.getByRole("link", { name: "Show current version" }).click();
    await expect(page.locator(".doc-card").getByText(HUMAN_TEXT)).toBeVisible();

    // ---- Second proposal, deliberate resolution with an intervening save ----
    await page.getByRole("button", { name: "Request revision" }).click();
    await page
      .getByLabel("What should change?")
      .fill("Shorten the weekly steps.");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("A revision is being drafted")).toBeVisible();
    const art2 = await (
      await request.get(`/api/mock/workspaces/ws_alex/artifacts/${planId}`, {
        headers: headers(),
      })
    ).json();
    const proposalId2: string = art2.pending_proposal.id;
    // Human saves revision 3 first (via the API, as if from another tab) so the proposal is stale.
    const body3 = art2.accepted_revision.body.map(
      (b: { id: string; text: string }) =>
        b.id === "pl-s3" ? { ...b, text: "Record time spent per review." } : b,
    );
    const save3 = await request.post(
      `/api/mock/workspaces/ws_alex/artifacts/${planId}/revisions`,
      {
        headers: headers(),
        data: {
          command_id: `e2e-save3-${Date.now()}`,
          expected_current_revision_id: art2.accepted_revision_id,
          body: body3,
        },
      },
    );
    expect(save3.ok()).toBeTruthy();
    await control(request, "release-proposal", { proposal_id: proposalId2 });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /Agent proposal based on revision 2/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(
      page.getByRole("heading", { name: "Your resolution" }),
    ).toBeVisible();
    const resolveField = page.getByLabel("Paragraph pl-p2");
    await resolveField.fill(
      "Use an owner-and-next-action check on the next eight personal practice cases, with a default owner of me.",
    );
    await shot(page, info, "11-artifact-resolve");

    // Another save intervenes (revision 4) before the resolution is saved.
    const art3 = await (
      await request.get(`/api/mock/workspaces/ws_alex/artifacts/${planId}`, {
        headers: headers(),
      })
    ).json();
    const body4 = art3.accepted_revision.body.map(
      (b: { id: string; text: string }) =>
        b.id === "pl-s1"
          ? {
              ...b,
              text: "Add owner and next-action fields to the intake log today.",
            }
          : b,
    );
    const save4 = await request.post(
      `/api/mock/workspaces/ws_alex/artifacts/${planId}/revisions`,
      {
        headers: headers(),
        data: {
          command_id: `e2e-save4-${Date.now()}`,
          expected_current_revision_id: art3.accepted_revision_id,
          body: body4,
        },
      },
    );
    expect(save4.ok()).toBeTruthy();

    await page.getByRole("button", { name: "Save resolution" }).click();
    await expect(
      page.getByText("A newer version was saved while you were editing"),
    ).toBeVisible();
    await expect(page.getByLabel("Paragraph pl-p2")).toHaveValue(
      /default owner of me/,
    );
    await shot(page, info, "12-artifact-resolve-intervened");
    await page
      .getByRole("button", {
        name: "Continue my draft on top of the current version",
      })
      .click();
    await page.getByRole("button", { name: "Save resolution" }).click();
    await expect(page.locator(".save-state")).toHaveText(/Saved · revision 5/);
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(page.locator(".doc-card").getByText(HUMAN_TEXT)).toBeVisible();
    await expect(
      page.locator(".doc-card").getByText(PROTECTED_NOTE),
    ).toBeVisible();
    await expect(
      page.locator(".doc-card").getByText(/default owner of me/),
    ).toBeVisible();
    await shot(page, info, "13-artifact-resolved");

    const fin = await (
      await request.get(`/api/mock/workspaces/ws_alex/artifacts/${planId}`, {
        headers: headers(),
      })
    ).json();
    expect(fin.accepted_revision.sequence).toBe(5);
    expect(fin.pending_proposal).toBeNull();
    const history = await (
      await request.get(
        `/api/mock/workspaces/ws_alex/artifacts/${planId}/history`,
        { headers: headers() },
      )
    ).json();
    expect(
      history.proposals.map((p: { status: string }) => p.status).sort(),
    ).toEqual(["accepted", "declined"]);
    expect(history.revisions).toHaveLength(5);

    // Home shows the resumable assignment.
    await page.goto("/");
    // Prepared work keeps its review route; nothing claims to be in progress.
    await expect(
      page.locator(`[data-assignment="${assignmentId}"] .status`),
    ).toHaveText("Ready for review");
    await expect(
      page.getByRole("link", { name: "Open prepared work" }),
    ).toBeVisible();
    await expect(page.getByText(/I’m handling/)).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Review the change" }),
    ).toHaveCount(0);
    await shot(page, info, "14-home-resume");

    const ids: JourneyIds = {
      assignment_id: assignmentId,
      plan_artifact_id: planId,
      human_revision_id: humanRevisionId,
      human_revision_sequence: 2,
      human_text: HUMAN_TEXT,
      protected_note: PROTECTED_NOTE,
      final_revision_id: fin.accepted_revision_id,
      final_revision_sequence: 5,
      proposal_ids: [proposalId1, proposalId2],
      recorded_at: new Date().toISOString(),
    };
    writeJourney(ids);
  });

  test("protected lookups and command replay @journey", async ({
    page,
    request,
  }) => {
    // Indistinguishable not-found/not-authorized for a foreign principal and for a missing id.
    const foreign = await request.get(
      `/api/mock/workspaces/ws_alex/assignments/asg_0001`,
      { headers: { "x-workagent-principal": "someone_else" } },
    );
    const missing = await request.get(
      `/api/mock/workspaces/ws_alex/assignments/asg_9999`,
      { headers: headers() },
    );
    expect(foreign.status()).toBe(404);
    expect(missing.status()).toBe(404);
    expect((await foreign.json()).error.code).toBe(
      "not_found_or_not_authorized",
    );
    expect((await missing.json()).error.code).toBe(
      "not_found_or_not_authorized",
    );

    // The UI shows the same safe message with a next action.
    await page.goto("/assignments/asg_9999");
    await expect(
      page.getByText("This item isn’t available to you"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to agent" }).last(),
    ).toBeVisible();

    // Command replay: same id + same payload → same result; different payload → command_conflict.
    const cmd = {
      command_id: `e2e-cmd-${Date.now()}`,
      goal: "Replay test",
      selected_source_refs: [{ id: "SG-F2", version: "1" }],
      completion_criteria: [],
    };
    const a = await request.post(`/api/mock/workspaces/ws_alex/assignments`, {
      headers: headers(),
      data: cmd,
    });
    const b = await request.post(`/api/mock/workspaces/ws_alex/assignments`, {
      headers: headers(),
      data: cmd,
    });
    expect(a.status()).toBe(202);
    expect((await a.json()).assignment_id).toBe((await b.json()).assignment_id);
    const c = await request.post(`/api/mock/workspaces/ws_alex/assignments`, {
      headers: headers(),
      data: { ...cmd, goal: "Different" },
    });
    expect(c.status()).toBe(409);
    expect((await c.json()).error.code).toBe("command_conflict");
  });

  test("start error keeps the request; retry replays the same command; reconnect resumes @journey", async ({
    page,
    request,
  }, info) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Try the intake example/ }).click();
    const before = (
      (
        await (
          await request.get("/api/mock/workspaces/ws_alex/assignments", {
            headers: headers(),
          })
        ).json()
      ).items as unknown[]
    ).length;

    // The service is unreachable for the first attempt.
    let seen = 0;
    await page.route("**/api/mock/workspaces/*/assignments", async (route) => {
      if (route.request().method() === "POST" && seen++ === 0)
        return route.abort("connectionrefused");
      return route.continue();
    });
    await page.getByRole("button", { name: "Take it from here" }).click();
    await expect(page.getByText("Couldn’t reach the service")).toBeVisible();
    await expect(page.getByLabel("Message your agent")).toHaveValue(
      /intake log/,
    );
    await expect(
      page.getByRole("button", { name: "Your context · 3 sources" }),
    ).toBeVisible();
    await shot(page, info, "17-home-start-error");
    await expect(page.getByLabel("Message your agent")).toBeDisabled();
    await page.getByRole("button", { name: "Retry same request" }).click();
    await page.waitForURL(/\/assignments\/asg_\d+$/);
    const after = (
      (
        await (
          await request.get("/api/mock/workspaces/ws_alex/assignments", {
            headers: headers(),
          })
        ).json()
      ).items as unknown[]
    ).length;
    expect(
      after - before,
      "exactly one assignment created across the failed attempt and its retry",
    ).toBe(1);
    // The handler stays installed (it already passes everything through after
    // the first POST): changing interception patterns while the next page's
    // first read is in flight can leave that read unanswered.

    // Connection drops while working: the page keeps what it has, shows reconnecting, then resumes the same assignment.
    const assignmentId = page.url().split("/").pop()!;
    // Cut the connection only after the first read has landed: with no data yet
    // the page correctly shows an error, not "reconnecting".
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /intake log/i,
    );
    let offline = true;
    await page.route("**/api/mock/workspaces/*/assignments/*", (route) =>
      offline ? route.abort("connectionrefused") : route.continue(),
    );
    // Returning to the tab re-reads the assignment, whether or not it was still polling.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("Reconnecting…")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /intake log/i,
    );
    await shot(page, info, "18-assignment-reconnecting");
    offline = false;
    await expect(page.getByText("Reconnecting…")).toBeHidden({
      timeout: 30_000,
    });
    await expect(page.getByRole("link", { name: "Open plan" })).toBeVisible({
      timeout: 30_000,
    });
    expect(
      page.url().endsWith(`/assignments/${assignmentId}`),
      "same assignment after reconnect",
    ).toBeTruthy();
    const total = (
      (
        await (
          await request.get("/api/mock/workspaces/ws_alex/assignments", {
            headers: headers(),
          })
        ).json()
      ).items as unknown[]
    ).length;
    expect(total, "reconnect did not create another assignment").toBe(after);
  });
});
