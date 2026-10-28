import { defineConfig, devices } from "@playwright/test";

// B3.0b live-proof run against the already-running production server on
// 127.0.0.1:3199 (never a mock, never a managed webServer).
const BASE = "http://127.0.0.1:3199";
const OUT =
  process.env["B30B_PROOF_DIR"] ??
  "/home/ubuntu/workagent-continuation-20261026/.local/batch3/b30b/web-proof";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /b30b-proof\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  outputDir: `${OUT}/test-output`,
  reporter: [["list"], ["json", { outputFile: `${OUT}/e2e-report.json` }]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    acceptDownloads: true,
  },
  projects: [
    {
      name: "w1440",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "w390",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "w320",
      use: { ...devices["Pixel 7"], viewport: { width: 320, height: 640 } },
    },
  ],
});
