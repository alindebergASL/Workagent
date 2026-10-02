#!/usr/bin/env node
/**
 * Frontend portion of the S1 demonstration, MOCK MODE ONLY.
 *
 *   cd web && pnpm demo:s1
 *
 * 1. builds the app, 2. starts it against a disposable mock state directory,
 * 3. runs the browser journey on desktop and mobile, 4. stops the process and
 * starts it again with the same state directory, 5. reopens the assignment,
 * 6. writes handoffs/frontend/evidence/report.json with pass/fail/not_observed.
 *
 * It does not run against Hermes's API, PostgreSQL or a live model, so every
 * real-app and live-runtime row stays "not_observed".
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const evidenceDir =
  process.env["WORKAGENT_EVIDENCE_DIR"] ??
  path.resolve(appDir, "../handoffs/frontend/evidence");
const stateDir = path.join(appDir, ".workagent-mock", "demo");
const port = Number(process.env["WORKAGENT_E2E_PORT"] ?? 3100);
const base = `http://127.0.0.1:${port}`;

fs.rmSync(stateDir, { recursive: true, force: true });
fs.mkdirSync(evidenceDir, { recursive: true });

const env = {
  ...process.env,
  NEXT_PUBLIC_WORKAGENT_API_BASE: "/api/mock",
  WORKAGENT_MOCK_STATE_DIR: stateDir,
  WORKAGENT_MOCK_STAGE_MS: "700",
  WORKAGENT_MOCK_PROPOSAL_MS: "600000",
  WORKAGENT_MOCK_CONTROL: "1",
  WORKAGENT_E2E_EXTERNAL_SERVER: "1",
  WORKAGENT_E2E_PORT: String(port),
  WORKAGENT_EVIDENCE_DIR: evidenceDir,
};

function log(msg) {
  console.log(`[demo-s1] ${msg}`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: appDir,
    stdio: "inherit",
    env,
    ...opts,
  });
  return r.status ?? 1;
}

async function waitFor(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function assertPortFree() {
  try {
    await fetch(`${base}/api/mock/health`);
  } catch {
    return;
  }
  throw new Error(
    `something is already answering on ${base}; stop it first so the evidence is about this run`,
  );
}

async function startServer(label) {
  await assertPortFree();
  // Spawn the Next binary directly so SIGTERM reaches the server process itself.
  const nextBin = path.join(appDir, "node_modules", ".bin", "next");
  // Own process group so the stop signal reaches the server child the CLI forks.
  const child = spawn(
    nextBin,
    ["start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  const logFile = fs.createWriteStream(
    path.join(evidenceDir, `server-${label}.log`),
  );
  child.stdout.pipe(logFile);
  child.stderr.pipe(logFile);
  const ok = await waitFor(`${base}/api/mock/health`, 60_000);
  if (!ok) throw new Error("server did not start");
  log(`server ${label} up (pid ${child.pid})`);
  return child;
}

async function stopServer(child) {
  const signal = (sig) => {
    try {
      process.kill(-child.pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {}
    }
  };
  await new Promise((resolve) => {
    child.once("exit", resolve);
    signal("SIGTERM");
    setTimeout(() => signal("SIGKILL"), 5000);
  });
  // Confirm the process is really gone: the health endpoint must stop answering.
  const t0 = Date.now();
  let down = false;
  while (Date.now() - t0 < 15_000) {
    try {
      await fetch(`${base}/api/mock/health`);
    } catch {
      down = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!down)
    throw new Error(
      "server still answering after stop; restart evidence would be invalid",
    );
  log(`server stopped (pid ${child.pid}); health endpoint confirmed down`);
  return { pid: child.pid, stopped_at: new Date().toISOString() };
}

const report = {
  mode: "mock",
  generated_at: new Date().toISOString(),
  contract: "frontend-provisional-0.1",
  notice:
    "Mock-mode frontend evidence only. Real-app and live-runtime rows are not observed here.",
  checks: [],
};
function check(id, title, result, evidence) {
  report.checks.push({ id, title, mode: "mock", result, evidence });
}

let exitCode = 0;
try {
  log("building");
  if (run("pnpm", ["build"]) !== 0) throw new Error("build failed");

  let server = await startServer("1");
  const pid1 = server.pid;
  log("journey: desktop + mobile + narrow");
  const journey = run("pnpm", [
    "exec",
    "playwright",
    "test",
    "--grep",
    "@journey",
  ]);
  check(
    "journey",
    "Start → inspect → edit → save → stale proposal → resolution (desktop, mobile, 320px)",
    journey === 0 ? "pass" : "fail",
    "e2e/journey.spec.ts, screenshots 01–14 per project",
  );
  const stop1 = await stopServer(server);

  server = await startServer("2");
  log("reopen after process restart (mock state directory retained)");
  const reopen = run("pnpm", [
    "exec",
    "playwright",
    "test",
    "--grep",
    "@reopen",
  ]);
  check(
    "reopen",
    "Reopen the same assignment/artifact after app process restart",
    reopen === 0 ? "pass" : "fail",
    `e2e/reopen.spec.ts, screenshots 15–16; process ${pid1} stopped at ${stop1.stopped_at} (health down), process ${server.pid} started; mock state file retained, not a database`,
  );
  await stopServer(server);

  check(
    "real_api",
    "Same journey against Hermes's real API and PostgreSQL",
    "not_observed",
    "No shared contract or service on the remote at the time of this run",
  );
  check(
    "live_runtime",
    "Live model/runtime behavior",
    "not_observed",
    "Not exercised by the frontend demo",
  );
  exitCode = journey === 0 && reopen === 0 ? 0 : 1;
} catch (e) {
  check("runner", "Demo runner", "fail", String(e));
  exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(evidenceDir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  log(
    `report written to ${path.join(evidenceDir, "report.json")} (exit ${exitCode})`,
  );
}
process.exit(exitCode);
