import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = Number(process.env["WORKAGENT_E2E_PORT"] ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const STATE_DIR =
  process.env["WORKAGENT_MOCK_STATE_DIR"] ??
  path.join(process.cwd(), ".workagent-mock", "e2e");
// The demo runner starts and restarts the server itself (restart/reopen evidence).
const EXTERNAL_SERVER = process.env["WORKAGENT_E2E_EXTERNAL_SERVER"] === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/e2e-report.json" }],
  ],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
      ? {
          launchOptions: {
            executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"],
          },
        }
      : {}),
  },
  webServer: EXTERNAL_SERVER
    ? undefined
    : {
        command: `pnpm start --hostname 127.0.0.1 --port ${PORT}`,
        url: `${BASE}/api/mock/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          WORKAGENT_MOCK_STAGE_MS:
            process.env["WORKAGENT_MOCK_STAGE_MS"] ?? "700",
          WORKAGENT_MOCK_PROPOSAL_MS:
            process.env["WORKAGENT_MOCK_PROPOSAL_MS"] ?? "600000",
          WORKAGENT_MOCK_STATE_DIR: STATE_DIR,
          WORKAGENT_MOCK_CONTROL: "1",
        },
      },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "narrow",
      use: { ...devices["Pixel 7"], viewport: { width: 320, height: 640 } },
    },
  ],
});
