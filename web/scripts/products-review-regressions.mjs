#!/usr/bin/env node
/** Focused DOM regressions with explicit fixture transport; no server or provider. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { build } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {OperationComposer} from '@/components/OperationComposer';
import ProductPage from '@/app/conversations/[id]/artifacts/[artifactId]/page';
window.calls = [];
window.ambiguous = true;
window.refresh = async () => null;
const root = createRoot(document.getElementById('root'));
window.mount = (mode, ws='w', cid='c', version=7) => {
  window.scope = {ws,cid};
  root.render(mode === 'operation'
    ? <OperationComposer ws={ws} cid={cid} version={version} refresh={window.refresh}/>
    : mode === 'product' ? <ProductPage/> : <div>Navigation away</div>);
};
window.reads = {};
File.prototype.arrayBuffer = function() {
  return new Promise((resolve,reject) => {
    window.reads[this.name] = {resolve: text => resolve(new TextEncoder().encode(text).buffer), reject};
  });
};
`;
const mocks = {
  "@/lib/client/real-api": `
import {ApiError} from '@/lib/contract/errors';
export const conversationApi = {send: async (ws,cid,payload) => {
  window.calls.push({ws,cid,payload:structuredClone(payload)});
  if(window.holdNext) {
    window.holdNext = false;
    return new Promise((resolve,reject) => {
      window.finishHeld = (rejectDefinitively) => {
        if(rejectDefinitively) reject(new ApiError({code:'version_conflict',status:409,message:'Synthetic definitive rejection'}));
        else resolve({});
      };
    });
  }
  if(window.ambiguous) throw new ApiError({code:'transport',status:0,message:'Synthetic lost acknowledgement'});
  return {};
}};
export const client = {}; export const command = () => ({}); export const meta = () => ({});
export const unwrap = x => x; export const all = () => {throw new Error('Unexpected list call in DOM fixture');};`,
  "@/lib/client/hooks": "export const useResource = () => window.resource;",
  "@/lib/client/workspace":
    "export const useWorkspace = () => ({workspace:{id:window.scope.ws}});",
  "next/navigation":
    "export const useParams = () => ({id:window.scope.cid,artifactId:'a'}); export const useRouter = () => ({push:()=>{}});",
  "next/link":
    "import React from 'react'; export default function Link(p){return React.createElement('a',p);}",
  "@/components/ui":
    "import React from 'react'; export function ErrorNotice(){return React.createElement('p',{role:'alert'},'Synthetic read failure');}",
};
const bundle = await build({
  root: web,
  configFile: false,
  logLevel: "error",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "@": path.join(web, "src") } },
  oxc: { jsx: { runtime: "automatic" } },
  plugins: [
    {
      name: "review-fixtures",
      enforce: "pre",
      resolveId(id) {
        if (id === "review-entry" || id === path.join(web, "review-entry"))
          return "\0review-entry.tsx";
        // Vite resolves aliases before plugins; match both original and resolved paths.
        for (const key of Object.keys(mocks)) {
          if (
            id === key ||
            (key.startsWith("@/") && id === path.join(web, "src", key.slice(2)))
          )
            return "\0mock:" + key;
        }
      },
      load(id) {
        if (id === "\0review-entry.tsx") return entry;
        if (id.startsWith("\0mock:")) return mocks[id.slice(6)];
      },
    },
  ],
  build: {
    write: false,
    minify: false,
    lib: { entry: "review-entry", formats: ["iife"], name: "Review" },
  },
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
  (x) => x.type === "chunk",
).code;
const browser = await chromium.launch({
  headless: true,
  // Optional preinstalled browser for hosts that cannot download Playwright's own.
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
let passed = 0;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://products.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  async function load() {
    await page.goto("https://products.test/");
    await page.addScriptTag({ content: code });
  }
  async function mount(mode = "operation", ws = "w", cid = "c", version = 7) {
    await page.evaluate(
      (args) => window.mount(...args),
      [mode, ws, cid, version],
    );
    if (mode === "operation") {
      await page.locator("summary").click();
      await expect(page.getByLabel("Operation", { exact: true })).toBeEnabled();
    }
  }
  async function select(name) {
    await page.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("placeholder"),
    });
  }
  async function resolve(name, bytes) {
    await page.evaluate(([n, b]) => window.reads[n].resolve(b), [name, bytes]);
  }
  await load();
  await mount();
  await select("A.csv");
  await expect(
    page.getByRole("button", { name: "Run attached input" }),
  ).toBeDisabled();
  await select("B.csv");
  await resolve("B.csv", "B exact\r\nbytes");
  await resolve("A.csv", "wrong A bytes");
  await expect(
    page.getByText("Attached: B.csv", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run attached input" }).click();
  await expect(
    page.getByRole("button", { name: "Retry same operation" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Operation", { exact: true })).toBeDisabled();
  const initial = await page.evaluate(() => window.calls[0]);
  assert.equal(initial.payload.operation.input_csv, "B exact\r\nbytes");
  passed++;
  console.log("PASS attachment A/B race and pending-read admission guard");

  await load();
  await page.evaluate(() => window.mount("operation", "w", "c", 999));
  await page.locator("summary").click();
  await expect(
    page.getByRole("button", { name: "Retry same operation" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Operation", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry same operation" }).click();
  assert.deepEqual(await page.evaluate(() => window.calls[0]), initial);
  await page.evaluate(() => window.mount("away"));
  await expect(page.getByText("Navigation away")).toBeVisible();
  await mount("operation", "w", "other");
  await expect(
    page.getByRole("button", { name: "Run attached input" }),
  ).toBeDisabled();
  await page.evaluate(() => window.mount("operation", "w", "c", 1000));
  await page.locator("summary").click();
  await expect(
    page.getByRole("button", { name: "Retry same operation" }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.ambiguous = false;
  });
  await page.getByRole("button", { name: "Retry same operation" }).click();
  await expect(
    page.getByRole("button", { name: "Run attached input" }),
  ).toBeDisabled();
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), initial);
  passed++;
  console.log(
    "PASS reload/navigation scope and exact command/request/work-version replay",
  );

  await select("stale.csv");
  await page.getByLabel("Operation", { exact: true }).selectOption("run_wasm");
  await resolve("stale.csv", "not wasm");
  await expect(page.getByText("Attached: stale.csv")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Run attached input" }),
  ).toBeDisabled();
  passed++;
  console.log("PASS operator switch invalidates pending attachment");

  for (const rejectLate of [false, true]) {
    await load();
    await page.evaluate(() => sessionStorage.clear());
    await mount();
    await select("held-A.csv");
    await resolve("held-A.csv", "A exact bytes");
    await page.evaluate(() => {
      window.holdNext = true;
    });
    await page.getByRole("button", { name: "Run attached input" }).click();
    await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(1);
    await page.evaluate(() => window.mount("away"));
    await expect(page.getByText("Navigation away")).toBeVisible();
    await page.evaluate(() => {
      window.ambiguous = false;
      window.mount("operation", "w", "c", 8);
    });
    await page.locator("summary").click();
    await page.getByRole("button", { name: "Retry same operation" }).click();
    await expect(page.getByLabel("Operation", { exact: true })).toBeEnabled();
    await select("ambiguous-B.csv");
    await resolve("ambiguous-B.csv", "B exact bytes");
    await page.evaluate(() => {
      window.ambiguous = true;
    });
    await page.getByRole("button", { name: "Run attached input" }).click();
    await expect(
      page.getByRole("button", { name: "Retry same operation" }),
    ).toBeEnabled();
    const newer = await page.evaluate(() => window.calls.at(-1));
    assert.notEqual(
      newer.payload.command_id,
      (await page.evaluate(() => window.calls[0])).payload.command_id,
    );
    await page.evaluate(async (reject) => {
      window.finishHeld(reject);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }, rejectLate);
    await load();
    await page.evaluate(() => window.mount("operation", "w", "c", 9));
    await page.locator("summary").click();
    await expect(
      page.getByRole("button", { name: "Retry same operation" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Retry same operation" }).click();
    assert.deepEqual(await page.evaluate(() => window.calls[0]), newer);
    passed++;
    console.log(
      `PASS late ${rejectLate ? "definitive rejection" : "success"} cannot erase a newer ambiguous operation after navigation`,
    );
  }

  const hash = "0".repeat(64);
  const body = {
    kind: "tool",
    title: "Saved tool",
    code: '(module (func (export "total") (result i64) i64.const 1))',
    entrypoint: "total",
    arguments: [3],
    input_form: [
      {
        name: "quantity",
        label: "Quantity",
        type: "integer",
        minimum: -1000000000,
        maximum: 1000000000,
      },
    ],
    notes: [],
  };
  const artifact = {
    id: "a",
    workspace_id: "w",
    conversation_id: "c",
    assignment_id: null,
    current_revision_id: "r",
    current_revision: {
      id: "r",
      artifact_id: "a",
      revision_number: 1,
      body,
      body_hash: hash,
      author_kind: "worker",
      author_id: "worker",
      source_dependencies: [],
    },
  };
  const observation = {
    binding_state: "current_revision",
    current_scope: true,
    observation: {
      id: "o",
      workspace_id: "w",
      conversation_id: "c",
      artifact_id: "a",
      revision_id: "r",
      run_id: "run",
      body_hash: hash,
      operation_hash: hash,
      access_generation: 1,
      evidence_origin: "controlled_transport",
      output: {
        kind: "run_wasm",
        value: "1000000000000000001",
        entrypoint: "total",
        arguments: [],
        code_sha256: hash,
        input_sha256: hash,
        engine: "wasmtime-49.0.0",
        execution_observed: true,
        fuel_consumed: 1,
        fuel_limit: 50000,
        memory_limit_bytes: 1048576,
        host_imports: 0,
      },
    },
  };
  const latest = structuredClone(observation);
  latest.binding_state = "pending_proposal";
  latest.observation.id = "pending";
  latest.observation.revision_id = null;
  latest.observation.proposal_id = "p";
  latest.observation.output.value = "-1000000000000000001";
  const data = {
    artifact,
    proposals: [
      {
        id: "p",
        status: "pending",
        base_revision_id: "r",
        body,
        reason: "Explicit pending proposal fixture",
      },
    ],
    history: [artifact.current_revision],
    observations: { current: observation, latest },
    conversation: {
      conversation: {
        id: "c",
        title: "Fixture conversation",
        state: "open",
        work_version: 1,
        created_at: "",
        context_count: 0,
      },
      messages: [],
      turns: [],
      assignment_ids: [],
    },
    version: 1,
    open: true,
  };
  await page.evaluate((data) => {
    window.resource = {
      data,
      error: null,
      reconnecting: false,
      refresh: window.refresh,
    };
    window.mount("product");
  }, data);
  await expect(page.getByTestId("product-proposal")).toBeVisible();
  await expect(page.getByTestId("product-verification")).toHaveText(
    "Checked against this saved version.",
  );
  await expect(page.getByTestId("observed-return")).toHaveText([
    "1000000000000000001",
    "-1000000000000000001",
  ]);
  // Each observation states its own binding (inside "How this was checked").
  await expect(
    page.getByText("Checked against the proposed version, not your saved one."),
  ).toHaveCount(1);
  await expect(
    page.getByText("Checked against the current saved version."),
  ).toHaveCount(1);
  for (const value of ["9223372036854775807", "-9223372036854775808"]) {
    await page.evaluate((value) => {
      window.resource.data.observations.current.observation.output.value =
        value;
      window.mount("product");
    }, value);
    await expect(page.getByTestId("observed-return").first()).toHaveText(value);
  }
  passed++;
  console.log(
    "PASS signed i64 decimal rendering and saved verification plus pending output",
  );

  await page.getByLabel("Quantity", { exact: true }).fill("99");
  await page.getByLabel("Input 1 name", { exact: true }).fill("Discard me");
  await expect(
    page.getByRole("button", { name: "Save my edits", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard my changes" }).click();
  await expect(page.getByLabel("Input 1 name", { exact: true })).toHaveValue(
    "Quantity",
  );
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("3");
  await page.getByLabel("Quantity", { exact: true }).fill("3.5");
  await expect(
    page.getByRole("alert").filter({ hasText: "whole numbers" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard my changes" }).click();
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("3");
  passed++;
  console.log(
    "PASS same-base discard resets per-field tool inputs; invalid input stays out of the draft",
  );

  await page.evaluate(() => {
    window.resource = {
      data: null,
      error: new Error("read failed"),
      refresh: window.refresh,
    };
    window.mount("product");
  });
  await expect(
    page.getByText(
      "Authorized product unavailable. No saved state could be confirmed.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry product read" }),
  ).toBeEnabled();
  await expect(page.getByText("Loading authorized product…")).toHaveCount(0);
  passed++;
  console.log("PASS initial read failure is unavailable with explicit retry");
  assert.deepEqual(errors, []);
  console.log(
    `${passed} focused DOM regressions passed (fixture transport; no server/provider).`,
  );
} finally {
  await browser.close();
}
