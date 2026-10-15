#!/usr/bin/env node
// Actual React hooks and presentation in Chromium; synthetic transport only.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const vr = createRequire(require.resolve("vitest/package.json"));
const { build } = await import(pathToFileURL(vr.resolve("vite")).href);
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Home from '@/app/page';
import {SpaceWork} from '@/components/WorkAreas';
import {useHolds} from '@/lib/client/responsibility';
import {adaptivePresentation} from '@/lib/adaptive-presentation';
import {turnProgress} from '@/lib/contract/natural';
import fixture from '${path.join(web, "test/fixtures/recording-turn.json")}';
window.mode='absent';window.calls=[];window.scope={ws:'w',ids:['a']};
window.space={ws:'w',id:'c',artifactIds:['a'],versionKey:'v1'};
window.revision='r1';
window.item={id:'a',title:'Synthetic venue responsibility',conversation_id:'c',state:'paused',lifecycle:'paused',needs_review_artifact_ids:[],responsibility:null};
window.detail=()=>({assignment:{...window.item,goal:'Synthetic venue responsibility',work_version:3},lifecycle:{state:window.mode==='closed'?'taken_over':'active',execution_status:window.mode==='running'?'running':'not_admitted',outcome_status:'unverified',dependencies:[],review_required:false,check_in_due:false,current_outcome:'Synthetic',next_action:{kind:'continue_work',description:'Synthetic'},wait:null}});
function Holds(){const r=useHolds(window.scope.ws,window.scope.ids);return <pre id="holds">{JSON.stringify(r.holds)}</pre>}
const root=createRoot(document.getElementById('root'));
window.mount=(kind='holds')=>root.render(kind==='space'?<SpaceWork {...window.space}/>:kind==='home'?<Home/>:<Holds/>);
window.unmount=()=>root.render(null);
window.present=()=>adaptivePresentation('replied',turnProgress(fixture));
`;
const mocks = {
  "@/lib/client/real-api": `import {ApiError} from '@/lib/contract/errors';
 export const client={GET:async(path,options)=>{window.calls.push({method:'GET',path,ws:options.params.path.workspace_id,aid:options.params.path.artifact_id});
 if(path.includes('/artifacts/')){
 if(path.endsWith('/proposals'))return {items:[],next_cursor:null};
 const id=options.params.path.artifact_id;
 return {id,current_revision_id:window.revision,current_revision:{body:{kind:'file',title:'Saved '+id,content:'Content '+window.revision}}};}
 if(window.mode==='absent')throw new ApiError({code:'unsupported_operation',status:409,message:'Synthetic absence'});
 if(window.mode==='denied')throw new ApiError({code:'not_found_or_not_authorized',status:404,message:'Synthetic denial'});
 if(window.mode==='error')throw new ApiError({code:'transport',status:0,message:'Synthetic outage'});
 return window.detail();},POST:()=>{throw new Error('FORBIDDEN WRITE')}};
 export const unwrap=x=>x;export const meta=()=>({});export const command=()=>({});
 export const all=async fetch=>(await fetch()).items;
 export const rawAssignment=async()=>({...window.item,goal:'Synthetic venue responsibility'});`,
  "@/lib/client/api":
    "export const API_MODE='real';export const newCommandId=()=>crypto.randomUUID();",
  "@/lib/client/workspace":
    "export const useWorkspace=()=>({workspace:{id:window.scope.ws},zone:'UTC'});",
  "@/lib/client/overview":
    "export const useWorkOverview=()=>({data:[window.item],loading:false});",
  "@/lib/client/conversation-work":
    "export const useConversationWork=()=>({data:[]});",
  "@/components/Composer": "export const Composer=()=>null;",
  "@/components/ConversationWorkRow":
    "export const ConversationWorkRow=()=>null;",
  "next/link":
    "import React from 'react';export default function Link(p){return React.createElement('a',p);}",
  "next/navigation":
    "export const useRouter=()=>({push:()=>{throw new Error('Unexpected navigation')}});",
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
      name: "bounded-fixtures",
      enforce: "pre",
      resolveId(id, importer) {
        if (id === "review-entry" || id === path.join(web, "review-entry"))
          return "\0review-entry.tsx";
        if (id.startsWith(".") && importer && !importer.startsWith("\0"))
          id = path.resolve(path.dirname(importer), id);
        if (id.startsWith(path.join(web, "src") + "/"))
          id =
            "@/" +
            id
              .slice(path.join(web, "src").length + 1)
              .replace(/\.(tsx?|jsx?)$/, "");
        if (Object.hasOwn(mocks, id)) return "\0mock:" + id;
        return null;
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
    lib: { entry: "review-entry", formats: ["iife"], name: "review" },
    rolldownOptions: { external: [] },
  },
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
  (o) => o.type === "chunk",
).code;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
async function run(name, fn) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", (route) => route.abort());
  try {
    await page.clock.install();
    await page.setContent(
      '<html><head></head><body><div id="root"></div></body></html>',
    );
    for (const style of ["globals", "agent-first", "foundations", "products"])
      await page.addStyleTag({
        content: readFileSync(
          path.join(web, `src/styles/${style}.css`),
          "utf8",
        ),
      });
    await page.addScriptTag({ content: code });
    await fn(page);
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(() => window.calls.some((x) => x.method !== "GET")),
      false,
    );
    results.push({ name, passed: true });
  } catch (e) {
    results.push({
      name,
      passed: false,
      error: String(e).slice(0, 2000),
      browserErrors: errors,
    });
  } finally {
    await page.close();
  }
}
try {
  await run(
    "SpaceWork reads settle and explicit changes refresh",
    async (p) => {
      const counts = () =>
        p.evaluate(() => ({
          artifacts: window.calls.filter((x) =>
            x.path.endsWith("/{artifact_id}"),
          ).length,
          proposals: window.calls.filter((x) => x.path.endsWith("/proposals"))
            .length,
        }));
      const settle = async () => {
        await delay(300);
        const first = await counts();
        await delay(300);
        const second = await counts();
        console.log(
          JSON.stringify({ probe: "SpaceWork unchanged props", first, second }),
        );
        assert.deepEqual(
          second,
          first,
          "unchanged props must not continuously reread",
        );
        assert.ok(first.artifacts > 0 && first.artifacts === first.proposals);
        return second;
      };
      await p.evaluate(() => window.mount("space"));
      await expect(p.locator('[data-artifact-id="a"]')).toHaveAttribute(
        "data-revision-id",
        "r1",
      );
      const initial = await settle();
      assert.ok(
        initial.artifacts <= 2,
        "bounded initial load plus explicit refresh",
      );
      await p.evaluate(() => {
        window.space.artifactIds = ["a"];
        window.mount("space");
      });
      assert.deepEqual(
        await settle(),
        initial,
        "same values with new array must not reread",
      );
      await p.evaluate(() => {
        window.revision = "r2";
        window.space.versionKey = "v2";
        window.mount("space");
      });
      await expect(p.locator('[data-artifact-id="a"]')).toHaveAttribute(
        "data-revision-id",
        "r2",
      );
      const version = await settle();
      assert.deepEqual(version, {
        artifacts: initial.artifacts + 1,
        proposals: initial.proposals + 1,
      });
      await p.evaluate(() => {
        window.space.artifactIds = ["b"];
        window.mount("space");
      });
      await expect(p.locator('[data-artifact-id="b"]')).toHaveAttribute(
        "data-revision-id",
        "r2",
      );
      const artifact = await settle();
      assert.deepEqual(artifact, {
        artifacts: version.artifacts + 1,
        proposals: version.proposals + 1,
      });
      await p.evaluate(() => {
        window.revision = "r3";
      });
      await p.getByRole("button", { name: "Refresh saved work" }).click();
      await expect(p.locator('[data-artifact-id="b"]')).toHaveAttribute(
        "data-revision-id",
        "r3",
      );
      const manual = await settle();
      assert.deepEqual(manual, {
        artifacts: artifact.artifacts + 1,
        proposals: artifact.proposals + 1,
      });
      await p.evaluate(() => {
        window.space.ws = "other";
        window.revision = "r4";
        window.mount("space");
      });
      await expect(p.locator('[data-artifact-id="b"]')).toHaveAttribute(
        "data-revision-id",
        "r4",
      );
      await settle();
      assert.equal(await p.evaluate(() => window.calls.at(-1).ws), "other");
      await p.evaluate(() => window.unmount());
      const stopped = await counts();
      await delay(300);
      assert.deepEqual(await counts(), stopped);
    },
  );
  await run(
    "R1 historic receipt makes no present ownership or execution claim",
    async (p) => {
      const v = await p.evaluate(() => window.present());
      assert.doesNotMatch(v.note, /Workagent holds|nothing runs for it yet/);
      assert.match(v.note, /At recording/);
    },
  );
  await run(
    "R2 actual hook discovers absent-only activation with unchanged IDs",
    async (p) => {
      await p.evaluate(() => window.mount());
      await expect(p.locator("#holds")).toContainText("absent", {
        timeout: 2000,
      });
      await p.evaluate(() => (window.mode = "active"));
      await p.clock.fastForward(15001);
      await expect(p.locator("#holds")).toContainText("ready", {
        timeout: 2000,
      });
      assert.equal(await p.evaluate(() => window.calls.length), 2);
    },
  );
  await run(
    "R2 absent reread failure becomes unknown not current absence",
    async (p) => {
      await p.evaluate(() => window.mount());
      await expect(p.locator("#holds")).toContainText("absent", {
        timeout: 2000,
      });
      await p.evaluate(() => (window.mode = "error"));
      await p.clock.fastForward(15001);
      await expect(p.locator("#holds")).toContainText('"lastAbsent":true', {
        timeout: 2000,
      });
      await expect(p.locator("#holds")).not.toContainText('"kind":"absent"');
    },
  );
  for (const mode of ["closed", "denied"])
    await run("R2 " + mode + " only stops polling", async (p) => {
      await p.evaluate((m) => {
        window.mode = m;
        window.mount();
      }, mode);
      await expect(p.locator("#holds")).toContainText(
        mode === "closed" ? "ready" : "denied",
        { timeout: 2000 },
      );
      await p.clock.fastForward(45001);
      assert.equal(await p.evaluate(() => window.calls.length), 1);
    });
  for (const mode of ["closed", "denied", "error", "running", "absent"])
    await run(
      "R3 Home intro does not infer authority from coarse paused: " + mode,
      async (p) => {
        await p.evaluate((m) => {
          window.mode = m;
          window.mount("home");
        }, mode);
        await expect(p.locator(".lede")).toBeVisible({ timeout: 2000 });
        assert.doesNotMatch(
          await p.locator(".lede").innerText(),
          /recorded and waiting|mine to carry|Nothing runs for them/,
        );
        if (mode === "closed")
          await expect(p.locator("body")).toContainText("You took this back");
        for (const width of [1280, 390, 320]) {
          await p.setViewportSize({ width, height: 900 });
          assert.ok(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            "horizontal overflow " + width,
          );
        }
        if (mode === "closed")
          await p.screenshot({
            path: process.env.REVIEW_SCREENSHOT,
            fullPage: true,
          });
      },
    );
  await run("hook retains read cap twenty", async (p) => {
    await p.evaluate(() => {
      window.mode = "active";
      window.scope.ids = Array.from({ length: 25 }, (_, i) => "a" + i);
      window.mount();
    });
    await expect(p.locator("#holds")).toContainText("ready", { timeout: 2000 });
    assert.equal(await p.evaluate(() => window.calls.length), 20);
  });
} finally {
  await browser.close();
}
writeFileSync(
  process.env.REVIEW_RESULT,
  JSON.stringify(
    {
      kind: "real-Chromium-React-synthetic-transport",
      providerCalls: 0,
      cases: results,
      passed: results.every((r) => r.passed),
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => !r.passed)) process.exitCode = 1;
