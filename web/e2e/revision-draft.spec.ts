import { expect, test, type Page } from "@playwright/test";
import { control, headers, noHorizontalScroll, shot } from "./helpers";

const DRAFT = "Add a default owner so no case is saved blank.";

/** Phones show one pane at a time; the conversation is the second pane. */
async function showAgent(page: Page): Promise<void> {
  await expect(page.locator(".doc-card")).toBeVisible();
  const toggle = page.locator(".working-switch");
  if (await toggle.isVisible()) {
    await toggle
      .getByRole("button", { name: "Conversation", exact: true })
      .click();
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

test("An unsent request survives pane switches and a reload @journey", async ({
  page,
  request,
}, info) => {
  test.setTimeout(90_000);
  await control(request, "reset");
  await page.goto("/");
  await page.getByRole("button", { name: /Try the intake example/ }).click();
  await page.getByRole("button", { name: "Take it from here" }).click();
  await page.waitForURL(/\/assignments\/asg_\d+$/);
  await page
    .getByRole("link", { name: "Open plan" })
    .click({ timeout: 30_000 });
  await page.waitForURL(/\/artifacts\/[^/]+$/);
  const artifactId = page.url().split("/").pop()!;
  await showAgent(page);

  // The conversation opens with the person's own request and what was saved.
  const thread = page.getByRole("list", {
    name: "Conversation about this work",
  });
  await expect(thread.locator(".msg-person").first()).toContainText(
    "Start with my own intake log",
  );
  await expect(thread.locator(".msg-agent").first()).toContainText(
    "I prepared the working plan",
  );

  // Typing is kept across pane switches (both panes stay mounted) and a reload.
  await page.getByLabel("What should change?").fill(DRAFT);
  await showWork(page);
  await showAgent(page);
  await expect(page.getByLabel("What should change?")).toHaveValue(DRAFT);
  await page.reload();
  await showAgent(page);
  await expect(page.getByLabel("What should change?")).toHaveValue(DRAFT);
  await noHorizontalScroll(page);
  await shot(page, info, "21-conversation-draft-kept");

  // An unconfirmed send keeps its exact command; retrying replays it once.
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
  await expect(
    page.getByText(
      "Your last send wasn’t confirmed. Sending again replays the same request.",
    ),
  ).toBeVisible();
  await shot(page, info, "23-revision-unconfirmed-kept");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByLabel("What should change?")).toHaveValue("");
  // Phones return to the document after a send; the request joins the thread.
  await showAgent(page);
  await expect(thread.locator(".msg-person").last()).toHaveText(
    `You: ${DRAFT}`,
  );
  await expect(
    page.getByRole("button", { name: "Send request" }),
  ).toBeDisabled();
  expect(sent, "the retry replays the frozen command").toHaveLength(2);
  expect(sent[1]).toBe(sent[0]);
  const art = await (
    await request.get(`/api/mock/workspaces/ws_alex/artifacts/${artifactId}`, {
      headers: headers(),
    })
  ).json();
  expect(art.pending_proposal, "one proposal from the request").toBeTruthy();
});
