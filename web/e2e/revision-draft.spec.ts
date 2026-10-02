import { expect, test, type Page } from "@playwright/test";
import { control, headers, noHorizontalScroll, shot } from "./helpers";

const DRAFT = "Add a default owner so no case is saved blank.";

/** Phones show one pane at a time; the revision form lives in the Agent pane. */
async function showAgent(page: Page): Promise<void> {
  await expect(page.locator(".doc-card")).toBeVisible();
  const toggle = page.locator(".working-switch");
  if (await toggle.isVisible()) {
    await toggle.getByRole("button", { name: "Agent", exact: true }).click();
    await expect(page.locator(".working-agent")).toBeVisible();
  }
}

async function showWork(page: Page): Promise<void> {
  const toggle = page.locator(".working-switch");
  if (await toggle.isVisible()) {
    await toggle.getByRole("button", { name: "Work", exact: true }).click();
    await expect(page.locator(".working-agent")).toBeHidden();
  }
}

test("Keep for later collapses the revision form and keeps the draft @journey", async ({
  page,
  request,
}, info) => {
  test.setTimeout(90_000);
  await control(request, "reset");
  await page.goto("/");
  await page.getByRole("button", { name: /Try the intake example/ }).click();
  await page.getByRole("button", { name: "Start work" }).click();
  await page.waitForURL(/\/assignments\/asg_\d+$/);
  await page
    .getByRole("link", { name: "Open plan" })
    .click({ timeout: 30_000 });
  await page.waitForURL(/\/artifacts\/[^/]+$/);
  const artifactId = page.url().split("/").pop()!;
  await showAgent(page);

  // Open, type, then keep for later: the form closes and the text is kept.
  await page.getByRole("button", { name: "Ask for a revision" }).click();
  await page.getByLabel("What should change?").fill(DRAFT);
  await page.getByRole("button", { name: "Keep for later" }).click();
  await expect(page.getByLabel("What should change?")).toHaveCount(0);
  const resume = page.getByRole("button", { name: "Resume your request" });
  await expect(resume).toBeVisible();
  await expect(resume).toBeFocused();
  await expect(
    page.getByText("Your unsent request is kept here."),
  ).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, info, "21-revision-kept-for-later");

  // Switching panes on a phone keeps it too; resuming restores the exact text.
  await showWork(page);
  await showAgent(page);
  await resume.click();
  await expect(page.getByLabel("What should change?")).toHaveValue(DRAFT);
  await expect(page.getByLabel("What should change?")).toBeFocused();
  await shot(page, info, "22-revision-resumed");

  // An unconfirmed send keeps its exact command: collapsing and resuming
  // shows the same error, and retrying replays the same command once.
  const sent: string[] = [];
  await page.route("**/artifacts/*/request-revision", async (route) => {
    sent.push(
      (route.request().postDataJSON() as { command_id: string }).command_id,
    );
    if (sent.length === 1) return route.abort("connectionrefused");
    return route.continue();
  });
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Couldn’t reach the service")).toBeVisible();
  await expect(page.getByLabel("What should change?")).toBeDisabled();
  await page.getByRole("button", { name: "Keep for later" }).click();
  await expect(page.getByLabel("What should change?")).toHaveCount(0);
  await expect(
    page.getByText(
      "Your last send wasn’t confirmed. Resume to retry the same request.",
    ),
  ).toBeVisible();
  await shot(page, info, "23-revision-unconfirmed-kept");
  await page.getByRole("button", { name: "Resume your request" }).click();
  await expect(page.getByLabel("What should change?")).toHaveValue(DRAFT);
  await expect(page.getByText("Couldn’t reach the service")).toBeVisible();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByLabel("What should change?")).toHaveCount(0);
  // Phones return to the document after a send; the request waits for review.
  await showAgent(page);
  await expect(
    page.getByRole("button", { name: "Ask for a revision" }),
  ).toBeDisabled();
  await page.unroute("**/artifacts/*/request-revision");
  expect(sent, "the retry replays the frozen command").toHaveLength(2);
  expect(sent[1]).toBe(sent[0]);
  const art = await (
    await request.get(`/api/mock/workspaces/ws_alex/artifacts/${artifactId}`, {
      headers: headers(),
    })
  ).json();
  expect(art.pending_proposal, "one proposal from the request").toBeTruthy();
});
