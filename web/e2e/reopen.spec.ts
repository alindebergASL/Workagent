import { expect, test } from "@playwright/test";
import { headers, noHorizontalScroll, readJourney, shot } from "./helpers";

/**
 * Runs after the demo runner has stopped and restarted the app process while
 * keeping the mock state directory. Mock mode only proves the UI reopens the
 * same ids; durable restart evidence belongs to Hermes's real services.
 */
test("reopen the same assignment and artifact after restart @reopen", async ({
  page,
  request,
}, info) => {
  const ids = readJourney();
  await page.goto("/");
  await expect(
    page.locator(`[data-assignment="${ids.assignment_id}"] .status`),
  ).toHaveText("Ready for review");
  await page.goto(`/assignments/${ids.assignment_id}`);
  await expect(page.locator(".status-line")).toContainText(
    "Ready for you to review",
  );
  await expect(page.getByRole("link", { name: "Open plan" })).toBeVisible();
  await shot(page, info, "15-reopen-assignment");
  await page.goto(
    `/assignments/${ids.assignment_id}/artifacts/${ids.plan_artifact_id}`,
  );
  await expect(page.locator(".save-state")).toHaveText(
    new RegExp(`Saved · revision ${ids.final_revision_sequence}`),
  );
  await expect(
    page.locator(".doc-card").getByText(ids.human_text),
  ).toBeVisible();
  await expect(
    page.locator(".doc-card").getByText(ids.protected_note),
  ).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, info, "16-reopen-artifact");

  const art = await (
    await request.get(
      `/api/mock/workspaces/ws_alex/artifacts/${ids.plan_artifact_id}`,
      { headers: headers() },
    )
  ).json();
  expect(art.accepted_revision_id).toBe(ids.final_revision_id);
  const human = await (
    await request.get(
      `/api/mock/workspaces/ws_alex/artifacts/${ids.plan_artifact_id}?revision_id=${ids.human_revision_id}`,
      { headers: headers() },
    )
  ).json();
  expect(human.accepted_revision.author.kind).toBe("human");
  expect(JSON.stringify(human.accepted_revision.body)).toContain(
    ids.human_text,
  );
});
