// Real transport regression: lost acknowledgement/reload and exact i64 readback.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  // Optional preinstalled browser for hosts that cannot download Playwright's own.
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const headers = { "X-Workagent-Client": "local-ui" };
try {
  const page = await browser.newPage();
  await page.goto(origin);
  await page
    .getByLabel("Message your agent")
    .fill(
      "Verify exact integer tool readback and replay after a lost acknowledgement.",
    );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForURL(/\/conversations\/[^/?]+$/);
  const cid = page.url().split("/").pop();
  await expect(page.locator(".msg-agent")).toHaveCount(1, { timeout: 15000 });
  const endpoint = `${origin}/api/domain/v1/workspaces/local-workspace/conversations/${cid}/messages`;
  const payloads = [];
  let admission;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    payloads.push(route.request().postData());
    if (payloads.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      admission = await response.json();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByText("Run a local operation", { exact: true }).click();
  await page.getByLabel("Operation", { exact: true }).selectOption("run_wasm");
  await page.getByLabel("Attach WAT file").setInputFiles({
    name: "exact-i64.wat",
    mimeType: "text/plain",
    buffer: Buffer.from(
      '(module (func (export "total") (param i64 i64) (result i64) i64.const 9007199254740993))',
    ),
  });
  await expect(
    page.getByText("Attached: exact-i64.wat", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run attached input", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry same operation", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByText("Run a local operation", { exact: true }).click();
  await expect(page.getByLabel("Operation", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry same operation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Run attached input", exact: true }),
  ).toBeDisabled();
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toBe(payloads[0]);
  await page
    .getByRole("link", { name: "Open tool product", exact: true })
    .click({ timeout: 15000 });
  await page.waitForURL(/\/artifacts\/[^/?]+$/);
  await expect(page.getByTestId("observed-return")).toHaveText(
    "9007199254740993",
  );
  await expect(page.getByTestId("product-verification")).toHaveText(
    "Current saved revision verified",
  );
  const artifactURL = page.url();
  const getConversation = async () => {
    const response = await fetch(
      `${origin}/api/domain/v1/workspaces/local-workspace/conversations/${cid}`,
      { headers },
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const initial = await getConversation();
  expect(initial.runs).toHaveLength(2); // one general turn, one operation, no duplicate admission
  await page
    .getByRole("button", { name: "Run saved tool", exact: true })
    .click();
  await page.waitForURL(new RegExp(`/conversations/${cid}$`));
  await page
    .getByRole("link", { name: "Open tool proposed change", exact: true })
    .click({ timeout: 15000 });
  await expect(page.getByTestId("product-proposal")).toBeVisible();
  await expect(page.getByTestId("product-verification")).toHaveText(
    "Current saved revision verified",
  );
  await expect(page.getByTestId("observed-return").first()).toHaveText(
    "9007199254740993",
  );
  await page.screenshot({
    path: path.join(out, "saved-and-proposed-exact-i64.png"),
    fullPage: true,
  });
  const final = await getConversation();
  expect(final.runs).toHaveLength(3);
  expect(final.assignment_ids).toEqual([]);
  const report = {
    passed: true,
    mode: "real-api-postgresql-continuous-controlled-worker",
    conversation_id: cid,
    artifact_url: artifactURL,
    exact_return: "9007199254740993",
    byte_identical_retry: true,
    admission,
    runs: final.runs.map((r) => ({
      id: r.id,
      state: r.state,
      profile: r.profile,
    })),
  };
  await writeFile(
    path.join(out, "readback.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
