// Self-describing work (#13) through the real UI, API, PostgreSQL and the
// normal continuous controlled consumer. Work is published with the
// contract's own `publish_artifact` operation (no model); the browser then
// edits, saves, reopens and drives an agent-made view through the broker.
//   node flexible-journey.mjs <out> create   then, after a restart,
//   node flexible-journey.mjs <out> reopen
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(process.argv[2]);
const phase = process.argv[3] ?? "create";
await mkdir(out, { recursive: true });
const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const root = origin + "/api/domain/v1/workspaces";
const base = root + "/local-workspace";
const headers = {
  "X-Workagent-Client": "local-ui",
  "Content-Type": "application/json",
};
async function api(p, body, url = base) {
  const r = await fetch(url + p, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${p}: ${JSON.stringify(json)}`);
  return json;
}
const cmd = () => ({
  schema_version: "workagent/v1",
  request_id: crypto.randomUUID(),
  command_id: crypto.randomUUID(),
});

/** Publish one body through the controlled consumer; wait for its artifact. */
async function publish(cid, text, body, target = {}) {
  const before = await api(`/conversations/${cid}`);
  await api(`/conversations/${cid}/messages`, {
    ...cmd(),
    expected_work_version: before.conversation.work_version,
    text,
    operation: {
      kind: "publish_artifact",
      body,
      artifact_id: null,
      base_revision_id: null,
      ...target,
    },
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const d = await api(`/conversations/${cid}`);
    const results = d.messages
      .filter((m) => m.sequence > before.messages.length)
      .flatMap((m) => m.result?.results ?? [])
      .filter((r) => r.kind !== "text");
    if (results.length) return results.at(-1);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Publication did not complete");
}

// A volunteer rota: types, a unit, a choice list and one read-only column.
const rota = {
  kind: "structured_table",
  version: "structured-table/v1",
  title: "Saturday volunteer rota",
  fields: [
    {
      key: "ref",
      label: "Ref",
      type: "text",
      editable: false,
      unit: null,
      scale: null,
      enum: null,
    },
    {
      key: "name",
      label: "Volunteer",
      type: "text",
      editable: true,
      unit: null,
      scale: null,
      enum: null,
    },
    {
      key: "shift",
      label: "Shift",
      type: "enum",
      editable: true,
      unit: null,
      scale: null,
      enum: ["Morning", "Afternoon", "Evening"],
    },
    {
      key: "hours",
      label: "Hours",
      type: "integer",
      editable: true,
      unit: "hours",
      scale: null,
      enum: null,
    },
    {
      key: "travel",
      label: "Travel allowance",
      type: "decimal",
      editable: true,
      unit: "GBP",
      scale: 2,
      enum: null,
    },
    {
      key: "confirmed",
      label: "Confirmed",
      type: "boolean",
      editable: true,
      unit: null,
      scale: null,
      enum: null,
    },
  ],
  rows: [
    ["v1", "Asha", "Morning", 3, "4.50", true],
    ["v2", "Ben", "Afternoon", 4, "0.00", false],
    ["v3", "Chidi", "Evening", 2, null, true],
  ].map(([ref, name, shift, hours, travel, confirmed]) => ({
    row_id: ref,
    cells: [
      { field_key: "ref", value: ref },
      { field_key: "name", value: name },
      { field_key: "shift", value: shift },
      { field_key: "hours", value: hours },
      { field_key: "travel", value: travel },
      { field_key: "confirmed", value: confirmed },
    ],
  })),
  notes: ["Synthetic rota for testing."],
};

// An agent-made view over the rota: local filtering plus hostile probes
// whose outcomes it writes into its own page for the test to read.
const viewSource = {
  html: `<main><h1>Who is on, and for how long</h1>
<label>Minimum hours <input id="min" type="number" value="0"></label>
<button id="refresh" type="button">Refresh saved rota</button>
<p id="state">Waiting for saved data.</p><p id="count"></p><ul id="list"></ul>
<p id="attempts"></p></main>`,
  css: "main{padding:12px}#state{color:#555}",
  js: `const $=(id)=>document.getElementById(id);let rows=[];const attempts=[];
const show=()=>{$("attempts").textContent=attempts.slice().sort().join(" ");};
function render(){const min=Number($("min").value||0);const shown=rows.filter(r=>(r.hours??0)>=min);
$("list").replaceChildren(...shown.map(r=>{const li=document.createElement("li");li.textContent=r.name+" · "+r.shift+" · "+r.hours+"h";return li;}));
$("count").textContent=shown.length+" of "+rows.length+" volunteers";}
async function load(){try{const r=await workagent.request("read",{});
rows=r.body.rows.map(row=>Object.fromEntries(row.cells.map(c=>[c.field_key,c.value])));
$("state").textContent="Read saved revision "+r.revision_id;render();}
catch(e){$("state").textContent="Read failed: "+e.message;}}
$("min").addEventListener("input",render);$("refresh").addEventListener("click",load);
workagent.ready().then(load);
fetch("https://example.com/leak").then(()=>attempts.push("fetch:ok"),()=>attempts.push("fetch:blocked")).finally(show);
workagent.request("approve",{}).then(()=>attempts.push("approve:ok"),e=>attempts.push("approve:"+e.message)).finally(show);
workagent.request("read",{artifact_id:"anything"}).then(()=>attempts.push("target:ok"),()=>attempts.push("target:refused")).finally(show);
try{parent.document.title;attempts.push("parent:ok");}catch(e){attempts.push("parent:blocked");}
try{localStorage.length;attempts.push("storage:ok");}catch(e){attempts.push("storage:blocked");}
show();`,
};

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
    ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
    : {}),
});
const errors = [];
const report = {
  mode: "actual-ui-api-postgresql-continuous-controlled-worker",
  provider_calls: "not_performed",
  phase,
  screenshots: [],
};
const shot = async (page, name) => {
  await page.screenshot({
    path: path.join(out, name + ".png"),
    fullPage: true,
  });
  report.screenshots.push(name + ".png");
};
const noOverflow = async (page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
const cellOf = (body, rowId, key) =>
  body.rows
    .find((r) => r.row_id === rowId)
    .cells.find((c) => c.field_key === key).value;

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const frame = () =>
    page.frameLocator("iframe.sandboxed-view, .sandboxed-view iframe");
  const ids =
    phase === "create"
      ? {}
      : JSON.parse(await readFile(path.join(out, "ids.json"), "utf8"));

  if (phase === "create") {
    // An ordinary conversation, started from Home like any other.
    await page.goto(origin);
    await page
      .getByLabel("Message your agent")
      .fill("Help me organise Saturday's volunteers.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForURL(/\/conversations\/[^/?]+$/);
    const cid = page.url().split("/").pop();
    await expect(page.locator(".msg-agent")).toHaveCount(1, { timeout: 15000 });
    ids.cid = cid;

    // 1. A structured table, rendered and edited by its declared fields.
    const table = await publish(cid, "Make the rota an editable table.", rota);
    ids.table = table.artifact_id;
    await page.reload();
    await page
      .getByRole("link", { name: "Open table product", exact: true })
      .click({ timeout: 15000 });
    await page.waitForURL(/\/artifacts\/[^/?]+$/);
    await expect(page.getByTestId("product-verification")).toHaveText(
      "Draft made by Workagent. Its shape was checked; what it says hasn’t been verified.",
    );
    const grid = page.getByRole("region", { name: "Editable table" });
    for (const h of [
      "Ref",
      "Volunteer",
      "Shift",
      "Hours",
      "Travel allowance (GBP)",
      "Confirmed",
    ])
      await expect(
        grid.getByRole("columnheader", { name: h, exact: true }),
      ).toBeVisible();
    // Read-only cells are text, not inputs.
    await expect(page.getByLabel("Asha Ref", { exact: true })).toHaveCount(0);
    await expect(grid).toContainText("v1");
    await page.getByLabel("Ben Hours", { exact: true }).fill("4.5");
    await expect(page.getByLabel("Ben Hours", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(
      page.getByRole("button", { name: "Save my edits" }),
    ).toBeDisabled();
    await page.getByLabel("Ben Hours", { exact: true }).fill("6");
    await page.getByLabel("Ben Travel allowance", { exact: true }).fill("2.5");
    await page.getByLabel("Ben Confirmed", { exact: true }).selectOption("yes");
    await page
      .getByLabel("Chidi Shift", { exact: true })
      .selectOption("Morning");
    // Notes typed key by key keep their spaces and line breaks.
    const notes = page.getByLabel("Notes (one per line)", { exact: true });
    await notes.focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await notes.pressSequentially("Bring hi-vis vests");
    await page.keyboard.press("Enter");
    await notes.pressSequentially("Keys from Asha ");
    const typedNotes =
      "Synthetic rota for testing.\nBring hi-vis vests\nKeys from Asha ";
    await expect(notes).toHaveValue(typedNotes);
    // An unsaved draft survives a reload.
    await page.reload();
    await expect(notes).toHaveValue(typedNotes);
    await expect(page.getByLabel("Ben Hours", { exact: true })).toHaveValue(
      "6",
    );
    await page
      .getByRole("button", { name: "Save my edits", exact: true })
      .click();
    await expect(
      page.getByText("Your edits are saved.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("product-verification")).toHaveText(
      "Saved by you. Nothing checks this automatically.",
    );
    const saved = (await api(`/artifacts/${ids.table}`)).current_revision;
    expect(saved.author_kind).toBe("human");
    expect(cellOf(saved.body, "v2", "hours")).toBe(6);
    expect(cellOf(saved.body, "v2", "travel")).toBe("2.50");
    expect(cellOf(saved.body, "v2", "confirmed")).toBe(true);
    expect(cellOf(saved.body, "v3", "shift")).toBe("Morning");
    expect(cellOf(saved.body, "v1", "ref")).toBe("v1");
    expect(saved.body.notes).toEqual([
      "Synthetic rota for testing.",
      "Bring hi-vis vests",
      "Keys from Asha",
    ]);
    expect(saved.body.rows.map((r) => r.row_id)).toEqual(["v1", "v2", "v3"]);
    await shot(page, "01-table-saved");
    await page.setViewportSize({ width: 390, height: 900 });
    await noOverflow(page);
    await shot(page, "02-table-phone");
    await page.setViewportSize({ width: 1440, height: 1000 });

    // 2. A revision from Workagent is a proposal, never a silent save.
    const proposed = structuredClone(saved.body);
    proposed.rows.push({
      row_id: "v4",
      cells: proposed.fields.map((f) => ({
        field_key: f.key,
        value: {
          ref: "v4",
          name: "Dana",
          shift: "Evening",
          hours: 2,
          travel: "1.00",
          confirmed: false,
        }[f.key],
      })),
    });
    const proposal = await publish(cid, "Add Dana to the evening.", proposed, {
      artifact_id: ids.table,
      base_revision_id: saved.id,
    });
    expect(proposal.proposal_id).toBeTruthy();
    await page.reload();
    const card = page.getByTestId("product-proposal");
    await expect(card).toContainText("1 row added");
    expect((await api(`/artifacts/${ids.table}`)).current_revision_id).toBe(
      saved.id,
    );
    await card.getByRole("button", { name: "Apply proposed version" }).click();
    await expect(
      page.getByText("The proposed version is now your saved version."),
    ).toBeVisible();
    const accepted = (await api(`/artifacts/${ids.table}`)).current_revision;
    expect(accepted.body.rows.map((r) => r.row_id)).toEqual([
      "v1",
      "v2",
      "v3",
      "v4",
    ]);
    expect(cellOf(accepted.body, "v2", "hours")).toBe(6);

    // 3. A document, in the same conversation, through the same path.
    const doc = await publish(cid, "Write the briefing checklist.", {
      title: "Volunteer briefing",
      blocks: [
        {
          block_id: "h",
          kind: "heading",
          text: "Before doors open",
          checked: null,
        },
        {
          block_id: "c1",
          kind: "checklist",
          text: "Hand out lanyards",
          checked: false,
        },
        {
          block_id: "p",
          kind: "paragraph",
          text: "Meet at the side entrance.",
          checked: null,
        },
      ],
    });
    ids.doc = doc.artifact_id;
    await page.goto(`${origin}/conversations/${cid}/artifacts/${ids.doc}`);
    await page.getByLabel("Mark done: Hand out lanyards").check();
    await page
      .getByRole("button", { name: "Save my edits", exact: true })
      .click();
    await expect(
      page.getByText("Your edits are saved.", { exact: true }),
    ).toBeVisible();
    const savedDoc = (await api(`/artifacts/${ids.doc}`)).current_revision.body;
    expect(savedDoc.blocks.find((b) => b.block_id === "c1").checked).toBe(true);
    expect(savedDoc.blocks.map((b) => b.block_id)).toEqual(["h", "c1", "p"]);

    // 4. An agent-made view bound to the exact saved rota.
    const workspace = (await api("", undefined, root)).items.find(
      (w) => w.id === "local-workspace",
    );
    const view = await publish(cid, "Show me who is on and for how long.", {
      kind: "custom_view",
      version: "custom-view/v1",
      title: "Rota explorer",
      source: viewSource,
      fallback:
        "Asha (morning, 3h), Ben (afternoon, 6h), Chidi (morning, 2h), Dana (evening, 2h).",
      access_generation: workspace.access_generation,
      bindings: [
        {
          name: "rota",
          artifact_id: ids.table,
          revision_id: accepted.id,
          body_hash: accepted.body_hash,
        },
      ],
      actions: [
        {
          name: "read",
          kind: "read_binding",
          binding: "rota",
          payload_schema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
    });
    ids.view = view.artifact_id;
    ids.rota_revision_for_view = accepted.id;
    await page.goto(`${origin}/conversations/${cid}/artifacts/${ids.view}`);
    await expect(page.getByText("· current saved version")).toBeVisible();
    await expect(frame().locator("#state")).toHaveText(
      `Read saved revision ${accepted.id}`,
    );
    await expect(frame().locator("#count")).toHaveText("4 of 4 volunteers");
    await expect(frame().locator("#list")).toContainText(
      "Ben · Afternoon · 6h",
    );
    // Interaction stays local to the view.
    await frame().locator("#min").fill("3");
    await expect(frame().locator("#count")).toHaveText("2 of 4 volunteers");
    // Hostile probes inside the generated code were all refused.
    await expect(frame().locator("#attempts")).toHaveText(
      "approve:This view can’t do that. fetch:blocked parent:blocked storage:blocked target:refused",
    );
    await expect(page.getByTestId("view-refusal")).toHaveText(
      "The view asked for something it isn’t allowed to.",
    );
    expect(page.url()).toContain(`/artifacts/${ids.view}`);
    await shot(page, "03-view-reading");

    // 5. A person saves the rota: the view can no longer read it, the
    // service refuses, and the shell (not the view) says so.
    await page.goto(`${origin}/conversations/${cid}/artifacts/${ids.table}`);
    await page.getByLabel("Asha Hours", { exact: true }).fill("5");
    await page
      .getByRole("button", { name: "Save my edits", exact: true })
      .click();
    await expect(
      page.getByText("Your edits are saved.", { exact: true }),
    ).toBeVisible();
    await page.goto(`${origin}/conversations/${cid}/artifacts/${ids.view}`);
    await expect(
      page.getByText("· changed since this view was made"),
    ).toBeVisible();
    await expect(frame().locator("#state")).toContainText("Read failed");
    // One explanation, from the shell: the work moved on.
    await expect(
      page.getByText(
        "What this view reads has been saved since it was made, so it can’t read it any more.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("view-problem")).toHaveCount(0);
    await shot(page, "04-view-stale");
    // Rebinding is an explicit human save of the view.
    await page
      .getByRole("button", { name: "Use the latest saved versions" })
      .click();
    await expect(
      page.getByText("The view now reads the latest saved versions."),
    ).toBeVisible();
    await expect(page.getByText("· current saved version")).toBeVisible();
    await expect(frame().locator("#list")).toContainText("Asha · Morning · 5h");
    const rebound = (await api(`/artifacts/${ids.view}`)).current_revision;
    expect(rebound.author_kind).toBe("human");
    expect(rebound.body.source).toEqual({ ...viewSource });
    ids.view_revision = rebound.id;

    // 6. Home lists the conversation's work by what it is.
    await page.goto(origin);
    for (const id of [ids.table, ids.doc, ids.view])
      await expect(page.locator(`[data-artifact="${id}"]`).first()).toBeVisible(
        { timeout: 20000 },
      );
    await expect(
      page.locator(`[data-artifact="${ids.view}"]`).first(),
    ).toContainText("Interactive view");
    await shot(page, "05-home");
    await writeFile(path.join(out, "ids.json"), JSON.stringify(ids, null, 2));
  } else {
    // After every process restarted: the same saved work, and the view
    // reads the same exact revision through the broker again.
    await page.goto(`${origin}/conversations/${ids.cid}/artifacts/${ids.view}`);
    await expect(page.getByText("· current saved version")).toBeVisible();
    await expect(frame().locator("#list")).toContainText("Asha · Morning · 5h");
    expect((await api(`/artifacts/${ids.view}`)).current_revision_id).toBe(
      ids.view_revision,
    );
    await page.getByText("Readable version", { exact: true }).first().click();
    await expect(page.locator(".view-fallback").first()).toContainText(
      "Ben (afternoon, 6h)",
    );
    await page.goto(
      `${origin}/conversations/${ids.cid}/artifacts/${ids.table}`,
    );
    await expect(page.getByLabel("Ben Hours", { exact: true })).toHaveValue(
      "6",
    );
    await expect(page.getByLabel("Dana Shift", { exact: true })).toHaveValue(
      "Evening",
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${origin}/conversations/${ids.cid}/artifacts/${ids.view}`);
    await expect(frame().locator("#count")).toHaveText("4 of 4 volunteers");
    await noOverflow(page);
    await shot(page, "06-view-phone-after-restart");
  }
  expect(errors).toEqual([]);
  report.page_errors = errors;
  report.ids = ids;
  await writeFile(
    path.join(out, `flexible-${phase}.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `PASS flexible ${phase}: real UI/API/PostgreSQL, zero provider calls`,
  );
} finally {
  await browser.close();
}
