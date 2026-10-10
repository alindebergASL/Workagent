#!/usr/bin/env node
/** Focused DOM regressions with explicit fixture transport; no server or provider. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import {useConversationReply} from '@/lib/client/conversation-reply';
function Reply({ws,cid,version}) {
  const reply = useConversationReply({wsId:ws,cid,version,refresh:window.refresh});
  return <><textarea aria-label="Test reply" value={reply.text} disabled={reply.sending || reply.uncertain} onChange={e=>reply.setText(e.target.value)}/>
    <button disabled={reply.sending} onClick={reply.send}>{reply.uncertain ? 'Retry reply' : 'Send reply'}</button></>;
}
window.calls = [];
window.ambiguous = true;
window.refresh = async () => null;
const root = createRoot(document.getElementById('root'));
window.mount = (mode, ws='w', cid='c', version=7) => {
  window.scope = {ws,cid};
  root.render(mode === 'operation'
    ? <OperationComposer ws={ws} cid={cid} version={version} refresh={window.refresh}/>
    : mode === 'product' ? <ProductPage/> : mode === 'reply' ? <Reply key={ws+cid} ws={ws} cid={cid} version={version}/> : <div>Navigation away</div>);
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
  // The product read is the fixture; the conversation pane beside it keeps
  // its initial record (no polling in the DOM fixture).
  "@/lib/client/hooks":
    "export const useResource = (key) => key && key.startsWith('peek:') ? (window.peek ?? {data:null,error:null,reconnecting:false,refresh:async()=>null}) : window.resource;",
  "@/lib/client/api": "export const newCommandId = () => crypto.randomUUID();",
  // Natural admission is a build switch; the fixture flips it per test.
  "@/lib/client/capabilities":
    "export const CAPABILITIES = { conversation: true, delegateWithoutContext: false, get naturalAdmission() { return Boolean(window.natural); } };",
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

  for (const rejectLate of [false, true]) {
    await load();
    await page.evaluate(() => sessionStorage.clear());
    await mount("reply");
    await page.getByLabel("Test reply").fill("Held reply A");
    await page.evaluate(() => {
      window.holdNext = true;
    });
    await page.getByRole("button", { name: "Send reply", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(1);
    const held = await page.evaluate(() => window.calls[0]);
    await mount("away");
    await expect(page.getByText("Navigation away")).toBeVisible();
    await page.evaluate(() => {
      window.ambiguous = false;
    });
    await mount("reply", "w", "c", 8);
    await page
      .getByRole("button", { name: "Retry reply", exact: true })
      .click();
    await expect(page.getByLabel("Test reply")).toHaveValue("");
    assert.deepEqual(await page.evaluate(() => window.calls[1]), held);
    await page.getByLabel("Test reply").fill("Newer reply B");
    await page.evaluate(() => {
      window.ambiguous = true;
    });
    await page.getByRole("button", { name: "Send reply", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Retry reply", exact: true }),
    ).toBeEnabled();
    const newer = await page.evaluate(() => window.calls.at(-1));
    assert.notEqual(newer.payload.command_id, held.payload.command_id);
    await page.evaluate(async (reject) => {
      window.finishHeld(reject);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }, rejectLate);
    await expect(page.getByLabel("Test reply")).toHaveValue("Newer reply B");
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem("workagent:conversation:c"),
      ),
      "Newer reply B",
    );
    assert.deepEqual(
      JSON.parse(
        await page.evaluate(() =>
          sessionStorage.getItem("workagent:pending:w:conversation:c:send"),
        ),
      ),
      newer.payload,
    );
    await load();
    await mount("reply", "w", "c", 999);
    await expect(page.getByLabel("Test reply")).toHaveValue("Newer reply B");
    await expect(page.getByLabel("Test reply")).toBeDisabled();
    await page
      .getByRole("button", { name: "Retry reply", exact: true })
      .click();
    assert.deepEqual(await page.evaluate(() => window.calls[0]), newer);
    passed++;
    console.log(
      `PASS late reply ${rejectLate ? "definitive rejection" : "success"} preserves newer draft and exact pending replay across reload`,
    );
  }
  await load();
  await page.evaluate(() => sessionStorage.clear());

  for (const retryFirst of [false, true]) {
    await load();
    await page.evaluate(() => sessionStorage.clear());
    await mount("reply");
    await page.evaluate((ambiguous) => {
      window.ambiguous = ambiguous;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("workagent:pending:"))
          throw new DOMException("full", "QuotaExceededError");
        return original.call(this, key, value);
      };
    }, retryFirst);
    await page.getByLabel("Test reply").fill("Quota-limited reply");
    await page.getByRole("button", { name: "Send reply", exact: true }).click();
    if (retryFirst) {
      await expect(
        page.getByRole("button", { name: "Retry reply", exact: true }),
      ).toBeEnabled();
      const first = await page.evaluate(() => window.calls[0]);
      await page.evaluate(() => {
        window.ambiguous = false;
      });
      await page
        .getByRole("button", { name: "Retry reply", exact: true })
        .click();
      assert.deepEqual(await page.evaluate(() => window.calls[1]), first);
    }
    await expect(page.getByLabel("Test reply")).toHaveValue("");
    await expect(page.getByLabel("Test reply")).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Send reply", exact: true }),
    ).toBeEnabled();
    passed++;
    console.log(
      `PASS quota-failed journal write resolves ${retryFirst ? "exact in-memory replay" : "successful reply"} without permanent lock`,
    );
  }

  await load();
  await page.evaluate(() => sessionStorage.clear());
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
  // Open the disclosure: bindings must be visible, not just present in the DOM.
  await page.getByText("How this was checked", { exact: true }).click();
  await expect(
    page.getByText("Checked against the proposed version, not your saved one."),
  ).toBeVisible();
  await expect(
    page.getByText("Checked against the current saved version."),
  ).toBeVisible();
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

  // A proposed tool version's result is shown with that version's inputs,
  // never the saved inputs; the saved card does not claim it.
  const proposedBody = structuredClone(body);
  proposedBody.arguments = [3, 1250, 500];
  proposedBody.input_form = [
    "Quantity",
    "Unit price cents",
    "Shipping cents",
  ].map((label, i) => ({
    ...body.input_form[0],
    name: `input_${i + 1}`,
    label,
  }));
  await page.evaluate(
    ({ data, proposedBody }) => {
      const d = structuredClone(data);
      d.proposals[0].body = proposedBody;
      d.proposals[0].body_hash = "b".repeat(64);
      d.observations.latest.observation.body_hash = "b".repeat(64);
      d.observations.latest.observation.output.value = "4250";
      d.observations.latest.observation.output.arguments = [3, 1250, 500];
      d.observations.current = null;
      window.resource = {
        data: d,
        error: null,
        reconnecting: false,
        refresh: window.refresh,
      };
      sessionStorage.clear();
      window.mount("away");
      window.mount("product");
    },
    { data, proposedBody },
  );
  await expect(page.locator(".result-headline")).toHaveText(
    "Not run on this saved version yet.",
  );
  await expect(page.locator(".result-card")).not.toContainText("4250");
  await expect(page.getByTestId("proposal-result")).toHaveText("Returns 4250");
  await expect(page.getByTestId("proposal-inputs")).toHaveText(
    "Quantity 3 · Unit price cents 1250 · Shipping cents 500",
  );
  await page.evaluate(() => {
    window.resource.data.observations.latest.observation.body_hash = "c".repeat(
      64,
    );
    window.mount("product");
  });
  await expect(page.getByTestId("product-proposal")).toContainText(
    "Not run yet.",
  );
  await expect(page.getByTestId("proposal-result")).toHaveCount(0);
  await page.evaluate((data) => {
    window.resource = {
      data,
      error: null,
      reconnecting: false,
      refresh: window.refresh,
    };
    sessionStorage.clear();
    window.mount("away");
    window.mount("product");
  }, data);
  passed++;
  console.log(
    "PASS proposed tool result is shown with its own inputs; the saved card never claims it",
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
  for (const invalid of ["value", "label"]) {
    if (invalid === "value")
      await page.getByLabel("Quantity", { exact: true }).fill("3.5");
    else await page.getByLabel("Input 1 name", { exact: true }).fill("");
    const errorText =
      invalid === "value" ? "whole numbers" : "Give every input a name";
    await expect(
      page.getByRole("alert").filter({ hasText: errorText }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save my edits", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Run saved tool", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Apply proposed version", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Your notes (one per line)", exact: true })
      .fill("Keep my note");
    await expect(
      page.getByRole("button", { name: "Save my edits", exact: true }),
    ).toBeDisabled();
    for (const reload of [false, true]) {
      if (reload) await load();
      else {
        await mount("away");
        await expect(page.getByText("Navigation away")).toBeVisible();
      }
      await page.evaluate((data) => {
        window.resource = {
          data,
          error: null,
          reconnecting: false,
          refresh: window.refresh,
        };
        window.mount("product");
      }, data);
      await expect(
        page.getByRole("alert").filter({ hasText: errorText }),
      ).toBeVisible();
      await expect(
        page.getByLabel(invalid === "value" ? "Quantity" : "Input 1 name", {
          exact: true,
        }),
      ).toHaveValue(invalid === "value" ? "3.5" : "");
      await expect(
        page.getByRole("textbox", {
          name: "Your notes (one per line)",
          exact: true,
        }),
      ).toHaveValue("Keep my note");
      await expect(
        page.getByRole("button", { name: "Save my edits", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", {
          name: "Apply proposed version",
          exact: true,
        }),
      ).toBeDisabled();
      const kept = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("workagent:product:w:c:a")),
      );
      assert.deepEqual(kept.body.arguments, [3]);
      assert.equal(kept.body.input_form[0].label, "Quantity");
    }
    await page.getByRole("button", { name: "Discard my changes" }).click();
    await expect(page.getByLabel("Input 1 name", { exact: true })).toHaveValue(
      "Quantity",
    );
    await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("3");
    await expect(
      page.getByRole("textbox", {
        name: "Your notes (one per line)",
        exact: true,
      }),
    ).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Run saved tool", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Apply proposed version", exact: true }),
    ).toBeEnabled();
    passed++;
    console.log(
      `PASS invalid tool ${invalid} persists across navigation/reload and gates save/run/apply without admitting invalid Body`,
    );
  }
  await page.getByLabel("Quantity", { exact: true }).fill("4");
  await expect(
    page.getByRole("button", { name: "Save my edits", exact: true }),
  ).toBeEnabled();
  assert.deepEqual(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("workagent:product:w:c:a")).body
          .arguments,
    ),
    [4],
  );
  await page.getByRole("button", { name: "Discard my changes" }).click();
  passed++;
  console.log("PASS same-base discard and immediate valid tool input edits");

  await mount("away");
  await expect(page.getByText("Navigation away")).toBeVisible();
  await page.evaluate(() => {
    const key = "workagent:product:w:c:a";
    const kept = JSON.parse(sessionStorage.getItem(key));
    kept.toolInputs = [{ name: "quantity", label: "Quantity", value: "9" }];
    sessionStorage.setItem(key, JSON.stringify(kept));
    window.mount("product");
  });
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("9");
  await expect(
    page.getByRole("alert").filter({ hasText: "unapplied inputs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save my edits", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Apply proposed version", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Run saved tool", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Quantity", { exact: true }).fill("4");
  await expect(
    page.getByRole("button", { name: "Save my edits", exact: true }),
  ).toBeEnabled();
  assert.deepEqual(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("workagent:product:w:c:a")).body
          .arguments,
    ),
    [4],
  );
  await page
    .getByRole("button", { name: "Discard my changes", exact: true })
    .click();
  passed++;
  console.log(
    "PASS restored unapplied raw inputs cannot silently use the last-valid Body; editing repairs them immediately",
  );

  // Replying beside the work: a lost acknowledgement keeps the exact command
  // under the conversation's own key, and retrying replays it unchanged.
  const reply = page.getByLabel("Reply about this work", { exact: true });
  await reply.fill("Beside the work");
  await page.evaluate(() => {
    window.calls.length = 0;
    window.ambiguous = true;
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Your last send wasn’t confirmed.", { exact: false }),
  ).toBeVisible();
  await expect(reply).toBeDisabled();
  const lost = await page.evaluate(() => window.calls[0]);
  assert.equal(lost.payload.text, "Beside the work");
  const stored = await page.evaluate(() =>
    sessionStorage.getItem(
      `workagent:pending:${window.scope.ws}:conversation:${window.scope.cid}:send`,
    ),
  );
  assert.deepEqual(JSON.parse(stored), lost.payload);
  await page.evaluate(() => {
    window.ambiguous = false;
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(reply).toHaveValue("");
  assert.deepEqual(await page.evaluate(() => window.calls[1]), lost);
  passed++;
  console.log(
    "PASS reply beside the work keeps and replays the exact unconfirmed send",
  );

  const tableData = structuredClone(data);
  tableData.artifact.current_revision.body = {
    kind: "table",
    title: "Edited invoices",
    source_csv: "",
    rounding: "ROUND_HALF_UP",
    columns: [
      "id",
      "quantity",
      "unit_price",
      "reported_total",
      "calculated_total",
      "difference",
      "check",
    ],
    rows: [
      {
        id: "A",
        quantity: "1",
        unit_price: "1.00",
        reported_total: "2.00",
        calculated_total: "1.00",
        difference: "0.00",
        check: "matched",
      },
    ],
    notes: [],
  };
  tableData.artifact.current_revision.author_kind = "human";
  tableData.proposals = [];
  tableData.observations = { current: null, latest: null };
  await mount("away");
  await expect(page.getByText("Navigation away")).toBeVisible();
  await page.evaluate((data) => {
    sessionStorage.removeItem("workagent:product:w:c:a");
    window.resource = {
      data,
      error: null,
      reconnecting: false,
      refresh: window.refresh,
    };
    window.mount("product");
  }, tableData);
  await expect(page.locator(".result-headline")).toHaveText(
    "These rows haven’t been checked yet.",
  );
  await expect(page.getByTestId("product-verification")).toHaveText(
    "This saved version hasn’t been checked yet.",
  );
  await expect(page.locator(".result-figures")).toHaveCount(0);
  const tableObservation = structuredClone(observation);
  tableObservation.observation.output = {
    kind: "reconcile_csv",
    reported_sum: "1.00",
    expected_sum: "1.00",
    discrepancies: [],
    formula: "quantity × unit_price",
    rounding: "ROUND_HALF_UP",
  };
  await page.evaluate((read) => {
    window.resource.data.artifact.current_revision.body.rows[0].reported_total =
      "1.00";
    window.resource.data.observations = { current: read, latest: read };
    window.mount("product");
  }, tableObservation);
  // Discard restores the newly read fixture body, eliminating the intentionally stale draft.
  await page.getByRole("button", { name: "Discard my changes" }).click();
  await expect(page.locator(".result-headline")).toHaveText(
    "The row matches its reported total.",
  );
  await expect(
    page.locator('.result-status[data-verified="true"]'),
  ).toBeVisible();
  await page.getByText("How this was checked", { exact: true }).click();
  await expect(
    page.getByText("Checked against the current saved version.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const mutation of ["hash", "revision", "scope", "stale"]) {
    await page.evaluate(
      ({ read, mutation }) => {
        window.resource.data.observations.current = structuredClone(read);
        window.resource.reconnecting = mutation === "stale";
        if (mutation === "hash")
          window.resource.data.observations.current.observation.body_hash =
            "1".repeat(64);
        if (mutation === "revision")
          window.resource.data.observations.current.observation.revision_id =
            "old";
        if (mutation === "scope")
          window.resource.data.observations.current.current_scope = false;
        window.mount("product");
      },
      { read: tableObservation, mutation },
    );
    await expect(page.locator(".result-headline")).toHaveText(
      "These rows haven’t been checked yet.",
    );
    await expect(
      page.locator('.result-status[data-verified="false"]'),
    ).toBeVisible();
  }
  await page.evaluate((read) => {
    const d = window.resource.data;
    const proposal = {
      id: "table-proposal",
      status: "pending",
      base_revision_id: "r",
      body: structuredClone(d.artifact.current_revision.body),
      body_hash: d.artifact.current_revision.body_hash,
      reason: "Checked proposal fixture",
    };
    const pending = structuredClone(read);
    pending.binding_state = "pending_proposal";
    pending.observation.id = "table-pending";
    pending.observation.revision_id = null;
    pending.observation.proposal_id = proposal.id;
    d.proposals = [proposal];
    d.observations = { current: null, latest: pending };
    window.resource.reconnecting = false;
    window.mount("product");
  }, tableObservation);
  await expect(page.locator(".result-headline")).toHaveText(
    "These rows haven’t been checked yet.",
  );
  await expect(
    page.getByTestId("product-proposal").locator(".decision-question"),
  ).toHaveText("The row matches its reported total.");
  await expect(
    page.getByText(
      "Checked against the proposed version, not your saved one.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.evaluate(() => {
    window.resource.data.observations.latest.observation.body_hash = "1".repeat(
      64,
    );
    window.mount("product");
  });
  await expect(
    page.getByTestId("product-proposal").locator(".decision-question"),
  ).toHaveText("These rows haven’t been checked yet.");
  passed++;
  console.log(
    "PASS table headline requires saved/proposal observation binding; retained columns never claim current matches",
  );

  // A table that isn't a reconciliation renders and edits generically: no
  // locked columns, no rounding or recalculation, and no check it can't do.
  await page.evaluate((base) => {
    window.stashedResource = window.resource;
    const d = structuredClone(base);
    d.artifact.current_revision.body = {
      kind: "table",
      title: "Workshop schedule",
      source_csv: "",
      rounding: "ROUND_HALF_UP",
      columns: ["day", "session", "owner", "check"],
      rows: [
        { day: "Mon", session: "Intro", owner: "Ana", check: "done" },
        { day: "Tue", session: "Lab", owner: "Ben", check: "" },
      ],
      notes: [],
    };
    d.proposals = [];
    d.observations = { current: null, latest: null };
    window.resource = {
      data: d,
      error: null,
      reconnecting: false,
      refresh: window.refresh,
    };
    window.mount("away");
  }, tableData);
  // Unmount first so the editor reads the new record, not its old draft.
  await expect(page.getByText("Navigation away")).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.clear();
    window.mount("product");
  });
  await expect(page.locator(".result-headline")).toHaveText(
    "2 rows · 4 columns",
  );
  await expect(page.getByTestId("product-verification")).toHaveText(
    "Saved. Nothing checks this table automatically.",
  );
  await expect(
    page.getByRole("region", { name: "Editable table" }),
  ).toBeVisible();
  const editable = page.getByRole("region", { name: "Editable table" });
  await expect(editable.locator("th")).toHaveText([
    "Day",
    "Session",
    "Owner",
    "Check",
  ]);
  await expect(editable.locator('td[data-derived="true"]')).toHaveCount(0);
  await expect(page.getByLabel("Row 1 check", { exact: true })).toHaveValue(
    "done",
  );
  await expect(page.getByLabel("Rounding")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Recalculate/ })).toHaveCount(
    0,
  );
  await page.getByLabel("Row 2 owner", { exact: true }).fill("Cleo");
  await expect(
    page.getByRole("button", { name: "Save my edits", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Save to keep your changes.")).toBeVisible();
  await page.getByRole("button", { name: "Discard my changes" }).click();
  await expect(page.getByLabel("Row 2 owner", { exact: true })).toHaveValue(
    "Ben",
  );
  await page.evaluate(() => {
    window.resource = window.stashedResource;
    window.mount("away");
  });
  await expect(page.getByText("Navigation away")).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.clear();
    window.mount("product");
  });
  passed++;
  console.log(
    "PASS a non-reconciliation table is fully editable with no recalculation or check claims",
  );

  // A proposal made from an earlier saved version says so in its primary
  // text, cannot be applied, and can be dismissed against the current one.
  await page.evaluate(() => {
    const d = window.resource.data;
    d.proposals[0].base_revision_id = "an-earlier-revision";
    window.mount("product");
  });
  const posts = [];
  await page.route("**/proposals/*/dismiss", async (route) => {
    posts.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  const card = page.getByTestId("product-proposal");
  await expect(card.getByRole("heading")).toHaveText(
    "This proposal is out of date",
  );
  await expect(
    card.getByRole("button", { name: "Apply proposed version" }),
  ).toHaveCount(0);
  await card.getByRole("button", { name: "Dismiss proposal" }).click();
  await expect(
    page.getByText("Proposal dismissed. Your saved version is unchanged."),
  ).toBeVisible();
  const current = await page.evaluate(
    () => window.resource.data.artifact.current_revision_id,
  );
  let post = posts.at(-1);
  assert.match(
    post.url,
    /\/v1\/workspaces\/w\/proposals\/table-proposal\/dismiss$/,
  );
  assert.equal(post.body.resolution, "dismiss");
  assert.equal(post.body.expected_current_revision_id, current);
  await page.evaluate(() => {
    const d = window.resource.data;
    d.proposals[0].base_revision_id = d.artifact.current_revision_id;
    window.mount("product");
  });
  await expect(card.getByRole("heading")).toHaveText(
    "A proposed version is ready",
  );
  await card.getByRole("button", { name: "Keep my current version" }).click();
  await expect(
    page.getByText("Kept your saved version. The proposal is closed."),
  ).toBeVisible();
  post = posts.at(-1);
  assert.equal(post.body.resolution, "keep_current");
  assert.equal(post.body.expected_current_revision_id, current);
  await page.unroute("**/proposals/*/dismiss");
  passed++;
  console.log(
    "PASS stale proposal is labelled, cannot be applied, and dismiss/keep-current send the current revision",
  );

  // The pane beside the work: a turn that settled before any waiting state
  // was seen still re-reads the work, once; unknown and reconnecting show.
  await page.evaluate(() => {
    window.refreshCount = 0;
    window.resource.refresh = async () => {
      window.refreshCount++;
      return null;
    };
    window.peek = undefined;
    window.mount("away");
    window.mount("product");
  });
  await page.evaluate(() => {
    const conv = structuredClone(window.resource.data.conversation);
    conv.turns.push({ run_id: "fast-run", state: "replied", reason: null });
    window.peek = {
      data: conv,
      error: null,
      reconnecting: false,
      refresh: async () => null,
    };
    window.mount("product");
  });
  await expect.poll(() => page.evaluate(() => window.refreshCount)).toBe(1);
  await page.evaluate(() => window.mount("product"));
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.refreshCount), 1);
  await page.evaluate(() => {
    const conv = structuredClone(window.peek.data);
    conv.turns.push({
      run_id: "unknown-run",
      state: "outcome_unknown",
      reason: "Lost",
    });
    window.peek = {
      data: conv,
      error: null,
      reconnecting: true,
      refresh: async () => null,
    };
    window.mount("product");
  });
  await expect(
    page.locator('.agent-pane [data-state="outcome_unknown"]'),
  ).toHaveText(
    "Couldn’t confirm whether this finished. Check the work before asking again.",
  );
  await expect(
    page.locator('.agent-pane [data-state="reconnecting"]'),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.refreshCount)).toBe(2);
  await page.evaluate(() => {
    window.peek = undefined;
    window.resource.refresh = window.refresh;
  });
  passed++;
  console.log(
    "PASS pane beside the work refreshes once for a fast-settled turn and shows unknown/reconnecting",
  );

  // Natural admission: a reply beside the work names the exact saved
  // version (never the unsaved working copy), and an unconfirmed reply
  // replays the same frozen target after the saved version moves on.
  await page.evaluate(() => {
    window.natural = true;
    window.calls.length = 0;
    window.ambiguous = true;
    sessionStorage.clear();
    window.mount("away");
    window.mount("product");
  });
  const saved = await page.evaluate(() => ({
    artifact_id: window.resource.data.artifact.id,
    revision_id: window.resource.data.artifact.current_revision_id,
    body_hash: window.resource.data.artifact.current_revision.body_hash,
  }));
  await page
    .getByLabel("Your notes (one per line)")
    .fill("Unsaved working note");
  await expect(
    page.getByText(
      "Your unsaved edits aren’t included. Replies work from your saved version.",
    ),
  ).toBeVisible();
  const peekReply = page.getByLabel("Reply about this work", { exact: true });
  await peekReply.fill("Use round-half-even on my saved table.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(peekReply).toBeDisabled();
  const sent = await page.evaluate(() => window.calls[0].payload);
  assert.deepEqual(sent.target, saved);
  assert.deepEqual(sent.attachments, []);
  assert.equal(sent.operation, undefined);
  await page.evaluate(() => {
    window.ambiguous = false;
    window.resource.data.artifact.current_revision_id = "a-newer-revision";
    window.mount("product");
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(peekReply).toHaveValue("");
  assert.deepEqual(await page.evaluate(() => window.calls[1].payload), sent);
  await page.evaluate(() => {
    window.natural = false;
    window.resource.data.artifact.current_revision_id = "r";
    sessionStorage.clear();
  });
  passed++;
  console.log(
    "PASS natural reply beside the work sends the exact saved target and replays it frozen",
  );

  // A model reply reads as text: emphasis and lists render, syntax and any
  // HTML stay inert, and a long reply opens with its first part.
  const markdownReply = [
    "**Result:** the calculator returned 4250 for 3*1250 + 500.",
    "",
    "- Quantity 3",
    "- Unit price `1250` cents",
    "",
    "<img src=x onerror=window.pwned=1>",
    "",
    ...Array.from(
      { length: 8 },
      (_, i) =>
        `Detail paragraph ${i + 1} with enough words to take up some room in the pane.`,
    ),
  ].join("\n");
  await page.evaluate((reply) => {
    window.pwned = 0;
    const conv = structuredClone(window.resource.data.conversation);
    conv.messages = [
      {
        id: "m1",
        author: "agent",
        text: reply,
        created_at: "",
        sequence: 1,
        run_id: "run",
        origin: "live_provider_receipt",
        products: [],
      },
    ];
    window.peek = {
      data: conv,
      error: null,
      reconnecting: false,
      refresh: async () => null,
    };
    window.mount("product");
  }, markdownReply);
  const agentMsg = page.locator(".agent-pane li.msg-agent");
  await expect(agentMsg.locator("strong").first()).toHaveText("Result:");
  await expect(agentMsg.locator("ul > li")).toHaveText([
    "Quantity 3",
    "Unit price 1250 cents",
  ]);
  await expect(agentMsg).toContainText("3*1250 + 500");
  await expect(agentMsg).not.toContainText("**");
  await expect(agentMsg.locator("img")).toHaveCount(0);
  await expect(agentMsg).toContainText("<img src=x onerror=window.pwned=1>");
  assert.equal(await page.evaluate(() => window.pwned), 0);
  await expect(agentMsg).not.toContainText("Detail paragraph 8");
  await agentMsg.getByRole("button", { name: "Show more" }).click();
  await expect(agentMsg).toContainText("Detail paragraph 8");
  await expect(
    agentMsg.getByRole("button", { name: "Show less" }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => {
    window.peek = undefined;
    window.mount("product");
  });
  passed++;
  console.log(
    "PASS model replies render as text (lists, emphasis, inert HTML) and long ones fold",
  );

  // Self-describing work (#13), using real model-created synthetic records
  // retained by the backend owner. Nothing here is specific to venues: the
  // assertions follow whatever fields and actions the records declare.
  const evidenceBody = (name) =>
    JSON.parse(
      readFileSync(
        path.join(web, "..", "evidence", "flexible-work-13", name),
        "utf8",
      ),
    ).revision;
  const tableRev = evidenceBody("venues-current.json");
  const viewRev = evidenceBody("custom-view.json");
  const flexData = (revision, extra = {}) => ({
    artifact: {
      id: "a",
      workspace_id: "w",
      conversation_id: "c",
      assignment_id: null,
      current_revision_id: revision.id,
      current_revision: { ...revision, artifact_id: "a" },
    },
    proposals: [],
    history: [{ ...revision, artifact_id: "a" }],
    observations: { current: null, latest: null },
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
    bound: {},
    ...extra,
  });
  // Writes go through the real client; the network answers per test.
  let flexPosts = [];
  let flexReply = () => ({ status: 500, json: {} });
  await page.route("**/v1/workspaces/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    const body = request.postDataJSON();
    flexPosts.push({ url: request.url(), body });
    const { status, json } = await flexReply(request.url(), body);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(json),
    });
  });
  const artifactAfterSave = async (id, body, hash) => {
    const next = await page.evaluate(() =>
      structuredClone(window.resource.data.artifact),
    );
    next.current_revision_id = id;
    next.current_revision = {
      ...next.current_revision,
      id,
      body,
      body_hash: hash,
      author_kind: "human",
    };
    return { status: 200, json: next };
  };
  async function showFlex(data) {
    flexPosts = [];
    await page.evaluate((data) => {
      sessionStorage.clear();
      window.resource = {
        data,
        error: null,
        reconnecting: false,
        refresh: window.refresh,
      };
      window.mount("away");
    }, data);
    // Separate steps, so React really unmounts the previous work.
    await page.evaluate(() => window.mount("product"));
  }

  {
    const table = tableRev.body;
    await showFlex(flexData(tableRev));
    // Headings come from each field's own label and unit.
    for (const f of table.fields)
      await expect(
        page
          .getByRole("region", { name: "Editable table" })
          .getByRole("columnheader", {
            name: f.unit ? `${f.label} (${f.unit})` : f.label,
            exact: true,
          }),
      ).toBeVisible();
    await expect(page.getByTestId("product-verification")).toHaveText(
      "Saved by you. Nothing checks this automatically.",
    );
    const dec = table.fields.find((f) => f.type === "decimal");
    const bool = table.fields.find((f) => f.type === "boolean");
    const textField = table.fields.find((f) => f.type === "text");
    const row = table.rows[1];
    const name = row.cells.find((c) => c.field_key === textField.key).value;
    const decInput = page.getByLabel(`${name} ${dec.label}`, { exact: true });
    // A value the service would refuse stays as typed, is marked, and
    // blocks saving; nothing invalid enters the saved body.
    await decInput.fill("12.3456789");
    await expect(decInput).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("alert").filter({ hasText: dec.label }),
    ).toContainText("decimal place");
    await expect(
      page.getByRole("button", { name: "Save my edits", exact: true }),
    ).toBeDisabled();
    await decInput.fill("199");
    await expect(decInput).not.toHaveAttribute("aria-invalid", "true");
    await page
      .getByLabel(`${name} ${bool.label}`, { exact: true })
      .selectOption("no");
    await page.getByRole("button", { name: "Add a row", exact: true }).click();
    await page
      .getByLabel(`Row ${table.rows.length + 1} ${textField.label}`, {
        exact: true,
      })
      .fill("Added by a person");
    // Survives leaving and coming back before saving.
    await page.evaluate(() => {
      window.mount("away");
    });
    await page.evaluate(() => window.mount("product"));
    // What the person typed is kept as typed; the body holds the normalized value.
    await expect(decInput).toHaveValue("199");
    flexReply = (url, body) =>
      artifactAfterSave("saved-2", body.body, "e".repeat(64));
    await page
      .getByRole("button", { name: "Save my edits", exact: true })
      .click();
    await expect(page.getByText("Your edits are saved.")).toBeVisible();
    const save = flexPosts[0];
    assert.match(save.url, /\/v1\/workspaces\/w\/artifacts\/a\/save$/);
    assert.equal(save.body.expected_current_revision_id, tableRev.id);
    const sent = save.body.body;
    assert.deepEqual(
      sent.fields.map((f) => f.key),
      table.fields.map((f) => f.key),
    );
    assert.deepEqual(
      sent.rows.slice(0, table.rows.length).map((r) => r.row_id),
      table.rows.map((r) => r.row_id),
    );
    const sentRow = sent.rows.find((r) => r.row_id === row.row_id);
    const cell = (r, k) => r.cells.find((c) => c.field_key === k).value;
    assert.equal(cell(sentRow, dec.key), `199.${"0".repeat(dec.scale)}`);
    assert.equal(cell(sentRow, bool.key), false);
    assert.equal(cell(sent.rows.at(-1), textField.key), "Added by a person");
    // Every other saved value is untouched.
    for (const r of table.rows)
      for (const c of r.cells)
        if (!(
          r.row_id === row.row_id && [dec.key, bool.key].includes(c.field_key)
        ))
          assert.deepEqual(
            cell(
              sent.rows.find((x) => x.row_id === r.row_id),
              c.field_key,
            ),
            c.value,
          );
    // On a phone each row reads as a labelled card, without sideways scroll.
    await page.addStyleTag({
      path: path.join(web, "src", "styles", "products.css"),
    });
    await page.setViewportSize({ width: 360, height: 800 });
    const td = page
      .getByLabel(`${name} ${dec.label}`, { exact: true })
      .locator("xpath=..");
    assert.equal(
      await td.evaluate((el) => getComputedStyle(el).display),
      "grid",
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  passed++;
  console.log(
    "PASS structured table edits by declared field type, refuses invalid values and saves exact identities",
  );

  {
    const view = viewRev.body;
    const binding = view.bindings[0];
    const action = view.actions[0];
    const tableArtifact = (rev) => ({
      view_revision_id: viewRev.id,
      access_generation: view.access_generation,
      binding: binding.name,
      artifact_id: binding.artifact_id,
      revision_id: rev.id,
      body_hash: rev.body_hash,
      body: rev.body,
    });
    const reply = tableArtifact({
      ...tableRev,
      id: binding.revision_id,
      body_hash: binding.body_hash,
    });
    flexReply = () => ({ status: 200, json: reply });
    await showFlex(
      flexData(viewRev, {
        bound: {
          [binding.artifact_id]: {
            revision_id: binding.revision_id,
            body_hash: binding.body_hash,
            title: tableRev.body.title,
          },
        },
      }),
    );
    await expect(page.getByText("· current saved version")).toBeVisible();
    const frame = page.frameLocator(`iframe[title="${view.title}"]`);
    await frame
      .getByRole("button", { name: /refresh/i })
      .first()
      .click();
    await expect.poll(() => flexPosts.length).toBeGreaterThan(0);
    const posts = [...flexPosts];
    for (const p of posts) {
      assert.match(p.url, /\/v1\/workspaces\/w\/artifacts\/a\/view-actions$/);
      const { request_id, ...rest } = p.body;
      assert.ok(request_id);
      assert.deepEqual(rest, {
        schema_version: "workagent/v1",
        view_revision_id: viewRev.id,
        view_body_hash: viewRev.body_hash,
        access_generation: view.access_generation,
        action: action.name,
        payload: {},
      });
    }
    await expect(page.getByTestId("view-problem")).toHaveCount(0);
    // The generated view itself got the saved rows (this record's own
    // status element; the app knows nothing about it).
    await expect(frame.locator("#status")).not.toContainText(
      "Waiting to read saved data",
    );
    // The generated view's own request bridge: undeclared actions and
    // payloads that try to name a target are refused before any call.
    const sandbox = page.frames().find((f) => f !== page.mainFrame());
    const refused = await sandbox.evaluate(async (name) => {
      const out = [];
      for (const [a, p] of [
        ["approve", {}],
        [name, { artifact_id: "other" }],
      ])
        out.push(
          await window.workagent.request(a, p).then(
            () => "ok",
            (e) => e.message,
          ),
        );
      return out;
    }, action.name);
    assert.deepEqual(refused, [
      "This view can’t do that.",
      "That didn’t work.",
    ]);
    // Nothing but the declared action with an empty payload ever left.
    for (const p of flexPosts) {
      assert.equal(p.body.action, action.name);
      assert.deepEqual(p.body.payload, {});
    }
    await expect(page.getByTestId("view-refusal")).toHaveText(
      "The view asked for something it isn’t allowed to.",
    );
    // A stale view: the service refuses, and the trusted shell says so
    // whatever the generated view itself shows.
    flexReply = () => ({
      status: 404,
      json: {
        code: "not_found_or_not_authorized",
        message: "Resource unavailable.",
        next_action: "Check your workspace and current access.",
        request_id: "r",
        details: {
          current_revision_id: null,
          current_version: null,
          fields: [],
          proposal_id: null,
        },
      },
    });
    await frame
      .getByRole("button", { name: /refresh/i })
      .first()
      .click();
    await expect(page.getByTestId("view-problem")).toContainText(
      "couldn’t read your saved work",
    );
    // The readable version is always one click away, as plain text.
    await page.getByText("Readable version", { exact: true }).first().click();
    await expect(page.locator(".view-fallback").first()).toHaveText(
      view.fallback,
    );
  }
  passed++;
  console.log(
    "PASS agent-made view reads only through declared actions bound to the saved revision; refusals come from the shell",
  );

  {
    // The real model-made view names its exact bound version in its own
    // code, so the shell won't offer to repoint it; it asks for a new view.
    const binding = viewRev.body.bindings[0];
    flexReply = () => ({
      status: 404,
      json: { code: "not_found_or_not_authorized" },
    });
    await showFlex(
      flexData(viewRev, {
        bound: {
          [binding.artifact_id]: {
            revision_id: "newer-table",
            body_hash: "d".repeat(64),
            title: tableRev.body.title,
          },
        },
      }),
    );
    await expect(page.getByTestId("view-pinned")).toContainText(
      "Ask in the conversation for an updated view.",
    );
    await expect(
      page.getByRole("button", { name: "Use the latest saved versions" }),
    ).toHaveCount(0);
  }
  {
    // A view whose code reads by binding name can be repointed.
    const viewRevLoose = structuredClone(viewRev);
    viewRevLoose.body.source.js = viewRevLoose.body.source.js
      .split(viewRev.body.bindings[0].artifact_id)
      .join("")
      .split(viewRev.body.bindings[0].revision_id)
      .join("")
      .split(viewRev.body.bindings[0].body_hash)
      .join("");
    const viewRev2 = viewRevLoose;
    const view = viewRev2.body;
    const binding = view.bindings[0];
    // The bound table moved on, so the service refuses the old view's reads.
    flexReply = (url, body) =>
      /\/save$/.test(url)
        ? artifactAfterSave("view-2", body.body, "c".repeat(64))
        : { status: 404, json: { code: "not_found_or_not_authorized" } };
    await showFlex(
      flexData(viewRev2, {
        bound: {
          [binding.artifact_id]: {
            revision_id: "newer-table",
            body_hash: "d".repeat(64),
            title: tableRev.body.title,
          },
        },
      }),
    );
    await expect(
      page.getByText("· changed since this view was made"),
    ).toBeVisible();
    // The view's own first read is refused; wait for that to settle.
    await expect
      .poll(() => flexPosts.some((p) => /view-actions$/.test(p.url)))
      .toBe(true);
    await expect(page.getByTestId("view-problem")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Use the latest saved versions" })
      .click();
    await expect(
      page.getByText("The view now reads the latest saved versions."),
    ).toBeVisible();
    const saves = flexPosts.filter((p) => /\/save$/.test(p.url));
    assert.equal(saves.length, 1);
    const [save] = saves;
    assert.match(save.url, /\/v1\/workspaces\/w\/artifacts\/a\/save$/);
    assert.equal(save.body.expected_current_revision_id, viewRev2.id);
    assert.deepEqual(save.body.body, {
      ...view,
      bindings: [
        { ...binding, revision_id: "newer-table", body_hash: "d".repeat(64) },
      ],
    });
  }
  passed++;
  console.log(
    "PASS a view whose bound work changed says so; it is repointed only by an explicit human save, and never when its code pins the old version",
  );
  await page.unroute("**/v1/workspaces/**");

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
