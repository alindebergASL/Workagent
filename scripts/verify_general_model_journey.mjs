// Actual browser, no forged product replies. Provider HTTP alone is synthetic.
// Invoke via verify_general_model_journey.py, which provisions a NEW isolated DB.
import { chromium, expect } from '../web/node_modules/@playwright/test/index.mjs';
import { readFile, writeFile, open } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [output, envFile, phase] = process.argv.slice(2);
if (!output || !envFile) throw new Error('Run with the Python orchestrator; output/env required');
const out = path.resolve(output), origin = 'http://127.0.0.1:3000';
const base = origin + '/api/domain/v1/workspaces/local-workspace';
const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
const [CSV_ASK, CSV_REV, TOOL_ASK, TOOL_REV] = manifest.prompts;
const E = manifest.expected, N = manifest.notes;
const save = (name, data) => writeFile(path.join(out, name), JSON.stringify(data, null, 2) + '\n', {mode: 0o600});
const report = {mode: 'actual_browser_api_postgresql_same_worker_synthetic_http_transport',
  live_provider_calls: 0, model_intelligence: 'NOT TESTED', M3_M4_M5: 'NOT IMPLEMENTED / NOT TESTED',
  requests: [], steps: [], screenshots: [], page_errors: [], external_requests: []};
const headers = {'X-Workagent-Client': 'local-ui'};
async function get(p) {
  const r = await fetch(base + p, {headers});
  expect(r.status, p).toBe(200); return r.json();
}
async function all(p) {
  let items = [], cursor, seen = new Set();
  do {
    const d = await get(p + (p.includes('?') ? '&' : '?') + 'limit=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    items.push(...d.items); cursor = d.next_cursor;
    if (cursor) { expect(seen.has(cursor)).toBe(false); seen.add(cursor); }
  } while (cursor);
  return items;
}
const browser = await chromium.launch({headless: true, args: ['--no-sandbox'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH} : {})});
const contexts = [], pages = [];
let worker, workerLog;
async function pageFor(name) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
  contexts.push({context, name});
  await context.tracing.start({screenshots: true, snapshots: true, sources: true});
  const page = await context.newPage(); pages.push(page);
  page.on('pageerror', e => report.page_errors.push({page: name, message: e.message}));
  page.on('request', req => {
    if (req.method() === 'POST' && req.url().startsWith(base))
      report.requests.push({page: name, path: new URL(req.url()).pathname, body: req.postDataJSON()});
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      report.external_requests.push(url.origin); return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  return page;
}
async function shot(page, name) {
  await page.screenshot({path: path.join(out, name + '.png'), fullPage: true});
  report.screenshots.push(name + '.png');
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function ready(cid, count) {
  await expect.poll(async () => (await get('/conversations/' + cid)).messages.filter(m => m.author_kind === 'assistant').length,
    {timeout: 30000, message: 'Same GeneralWorker must publish the real admitted turn'}).toBe(count);
  const d = await get('/conversations/' + cid);
  expect(d.assignment_ids).toEqual([]);
  expect(d.runs).toHaveLength(count);
  for (const r of d.runs) { expect(r.profile).toBe('general-responses-v1'); expect(r.state).toBe('ready'); }
  for (const t of d.turns) { expect(t.provider_observation).toBe('received'); expect(t.evidence_origin).toBe('synthetic_provider_receipt'); }
  const msg = d.messages.filter(m => m.author_kind === 'assistant').at(-1);
  const product = msg.result.results.find(x => x.kind === 'table' || x.kind === 'tool');
  expect(product).toBeTruthy();
  const observation = await get('/observations/' + product.observation_id);
  expect(observation.observation.evidence_origin).toBe('local_tool');
  expect(observation.observation.model_selection.attempt_id).toBe(msg.model_receipt);
  report.steps.push({cid, product, observation, conversation: d});
  await save('progress.json', report);
  return {d, product, observation, artifact: await get('/artifacts/' + product.artifact_id)};
}
const exactTarget = a => ({artifact_id: a.id, revision_id: a.current_revision_id, body_hash: a.current_revision.body_hash});
async function openProduct(page, kind) {
  await page.getByRole('link', {name: 'Open ' + kind + ' product', exact: true}).click({timeout: 20000});
  await page.waitForURL(/\/conversations\/[^/]+\/artifacts\/[^/?]+$/);
  await expect(page.getByTestId('product-verification')).toHaveText('Checked against this saved version.');
}
async function saveEdits(page, id) {
  const before = await get('/artifacts/' + id);
  await page.getByRole('button', {name: 'Save my edits', exact: true}).click();
  await expect(page.getByText('Your edits are saved. Recalculate or run it to check them.', {exact: true})).toBeVisible();
  await expect(page.getByTestId('product-verification')).toHaveText('This saved version hasn’t been checked yet.');
  const a = await get('/artifacts/' + id);
  expect(a.current_revision_id).not.toBe(before.current_revision_id);
  expect(a.current_revision.author_kind).toBe('human');
  return a;
}
async function reply(page, text, saved) {
  const peek = page.locator('.agent-pane');
  await peek.getByLabel('Reply about this work', {exact: true}).fill(text);
  await peek.getByRole('button', {name: 'Send', exact: true}).click();
  await expect(peek.locator('.msg-person', {hasText: text})).toHaveCount(1);
  const req = report.requests.filter(r => r.path.endsWith('/messages') && r.body.text === text);
  expect(req).toHaveLength(1); expect(req[0].body.operation ?? null).toBeNull();
  expect(req[0].body.target).toEqual(exactTarget(saved));
}
async function pendingAndAccept(page, cid, id, saved, result, name) {
  await expect(page.getByTestId('product-proposal')).toBeVisible({timeout: 20000});
  const proposal = (await all('/artifacts/' + id + '/proposals')).find(p => p.id === result.product.proposal_id);
  expect(proposal.status).toBe('pending'); expect(proposal.base_revision_id).toBe(saved.current_revision_id);
  expect((await get('/artifacts/' + id)).current_revision_id).toBe(saved.current_revision_id);
  expect(result.observation.binding_state).toBe('pending_proposal');
  await shot(page, name + '-pending-product');
  // Leave the work. Rediscover through Home AND its actual authorized workspace Space.
  await page.goto(origin);
  const card = page.locator(`section.decision-card[data-artifact="${id}"]`);
  await expect(card).toContainText('A proposed version is ready', {timeout: 20000});
  await shot(page, name + '-home-decision');
  await page.goto(origin + '/spaces/' + saved.workspace_id);
  const row = page.locator(`a.work-row[data-artifact="${id}"]`);
  await expect(row).toHaveAttribute('data-decision', 'pending', {timeout: 20000});
  await shot(page, name + '-space-decision');
  await row.click();
  await page.waitForURL(`${origin}/conversations/${cid}/artifacts/${id}`);
  await expect(page.getByTestId('product-proposal')).toBeVisible();
  await page.getByRole('button', {name: 'Apply proposed version', exact: true}).click();
  await expect(page.getByTestId('product-verification')).toHaveText('Checked against this saved version.');
  const decided = (await all('/artifacts/' + id + '/proposals')).find(p => p.id === proposal.id);
  expect(decided.status).toBe('accepted');
  const current = await get('/artifacts/' + id);
  expect(current.current_revision.body_hash).toBe(proposal.body_hash);
  expect((await get('/observations/' + result.product.observation_id)).binding_state).toBe('current_revision');
  await page.goto(origin);
  const made = page.getByText(/^Made in your conversations · \d+$/);
  await expect(made).toBeVisible();
  if (!(await made.evaluate(el => el.closest('details').open))) await made.click();
  const currentRow = page.locator(`a.work-row[data-artifact="${id}"]`);
  await expect(currentRow).toHaveAttribute('data-decision', 'none', {timeout: 20000});
  await currentRow.click();
  await page.waitForURL(`${origin}/conversations/${cid}/artifacts/${id}`);
  await expect(page.getByTestId('product-verification')).toHaveText('Checked against this saved version.');
  return {proposal, current};
}
async function download(page, name) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download saved file', exact: true}).click();
  const d = await pending; await d.saveAs(path.join(out, name));
  return readFile(path.join(out, name), 'utf8');
}
async function stopWorker() {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGTERM'); await once(worker, 'exit');
  }
  if (workerLog) { await workerLog.close(); workerLog = null; }
}
try {
  if (phase === '--reopen') {
    const old = JSON.parse(await readFile(path.join(out, 'browser-result.json'), 'utf8'));
    const page = await pageFor('restart');
    for (const kind of ['csv', 'tool']) {
      const item = old.products[kind];
      await page.goto(origin + '/spaces/local-workspace');
      await page.locator(`a.work-row[data-artifact="${item.id}"]`).click({timeout: 20000});
      await expect(page.getByLabel('Your notes (one per line)')).toHaveValue(N[kind]);
      await expect(page.getByTestId('product-verification')).toHaveText('Checked against this saved version.');
      if (kind === 'tool') await expect(page.getByTestId('observed-return')).toHaveText(E.tool_shipping);
      else await expect(page.getByLabel('Row 2 unit_price', {exact: true})).toHaveValue('12.495');
      expect((await get('/artifacts/' + item.id)).current_revision_id).toBe(item.current_revision_id);
      await shot(page, 'restart-' + kind);
    }
    expect(report.requests).toEqual([]); expect(report.page_errors).toEqual([]);
    report.passed = true; await save('restart.json', report);
  } else {
    const csv = await pageFor('csv'), tool = await pageFor('tool');
    const ids = {}, releases = {}, created = {};
    for (const [kind, page, ask] of [['csv', csv, CSV_ASK], ['tool', tool, TOOL_ASK]]) {
      let signalCreated;
      created[kind] = new Promise(resolve => {signalCreated = resolve;});
      const barrier = new Promise(resolve => {releases[kind] = resolve;});
      // The only response interception: pass through real create, hold its UNCHANGED
      // response until the operator installs authority for these exact two IDs.
      await page.route(base + '/conversations', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const response = await route.fetch(); expect(response.status()).toBe(201);
        const actual = await response.json(); ids[kind] = actual.id; signalCreated();
        await barrier; await route.fulfill({response});
      });
      await page.goto(origin);
      await page.getByLabel('Message your agent').fill(ask);
      if (kind === 'csv') {
        await page.getByLabel('Attach a file', {exact: true}).setInputFiles(path.join(root, 'fixtures/general-work/invoices.csv'));
        await expect(page.getByRole('button', {name: 'Remove invoices.csv', exact: true})).toBeVisible();
      }
      await page.getByRole('button', {name: 'Send', exact: true}).click();
      await Promise.race([created[kind], new Promise((_, reject) => setTimeout(() => reject(new Error('Real Home conversation create not observed')), 20000).unref())]);
    }
    expect(Object.values(ids)).toHaveLength(2); expect(new Set(Object.values(ids)).size).toBe(2);
    await save('conversation-ids.json', ids);
    const python = path.join(root, 'backend/.venv/bin/python');
    const argv = [path.join(root, 'scripts/verify_general_model_journey.py'), '--env', envFile, '--output', out];
    const installed = spawnSync(python, [...argv, '--install'], {cwd: root, env: process.env, encoding: 'utf8'});
    await writeFile(path.join(out, 'operator.log'), installed.stdout + installed.stderr);
    expect(installed.status, installed.stderr).toBe(0);
    workerLog = await open(path.join(out, 'worker.log'), 'w', 0o600);
    releases.csv();
    await csv.waitForURL(origin + '/conversations/' + ids.csv);
    // Delayed synthetic count response forces an unknown observation. The UI
    // must recover through reads, never manual refresh or a replacement send.
    await expect(csv.locator('[data-state="queued"]')).toBeVisible();
    worker = spawn(python, [...argv, '--consume'], {cwd: root, env: process.env, stdio: ['ignore', workerLog.fd, workerLog.fd]});
    await expect(csv.locator('[data-state="outcome_unknown"]')).toBeVisible({timeout: 10000});
    const first = await ready(ids.csv, 1);
    expect(first.observation.observation.output.reported_sum).toBe(E.initial_reported);
    expect(first.observation.observation.output.expected_sum).toBe(E.initial_calculated);
    expect(first.observation.observation.output.discrepancies).toEqual(['B']);
    await openProduct(csv, 'table');
    await shot(csv, '01-csv-initial-desktop');
    await csv.getByLabel('Row 2 unit_price', {exact: true}).fill('12.495');
    await csv.getByLabel('Row 2 note', {exact: true}).fill(N.row);
    await csv.getByLabel('Your notes (one per line)').fill(N.csv);
    // Unsaved work AND a future reply survive phone pane switches and reload.
    await csv.setViewportSize({width: 390, height: 844});
    await csv.getByRole('button', {name: 'Conversation', exact: true}).click();
    await csv.getByLabel('Reply about this work', {exact: true}).fill(CSV_REV);
    await csv.getByRole('button', {name: 'Work', exact: true}).click();
    await expect(csv.getByLabel('Row 2 unit_price', {exact: true})).toHaveValue('12.495');
    await csv.reload();
    await expect(csv.getByLabel('Your notes (one per line)')).toHaveValue(N.csv);
    await csv.getByRole('button', {name: 'Conversation', exact: true}).click();
    await expect(csv.getByLabel('Reply about this work', {exact: true})).toHaveValue(CSV_REV);
    await csv.getByRole('button', {name: 'Work', exact: true}).click();
    const csvSaved = await saveEdits(csv, first.artifact.id);
    expect(csvSaved.current_revision.body.rows[1].unit_price).toBe('12.495');
    expect(csvSaved.current_revision.body.rows[1].note).toBe(N.row);
    await shot(csv, '02-csv-human-save-390');
    await csv.setViewportSize({width: 1440, height: 1000});
    await reply(csv, CSV_REV, csvSaved);
    const second = await ready(ids.csv, 2);
    expect(second.observation.observation.output.expected_sum).toBe(E.revised_total);
    const table = await pendingAndAccept(csv, ids.csv, first.artifact.id, csvSaved, second, '03-csv');
    expect(table.current.current_revision.body.rounding).toBe('ROUND_HALF_EVEN');
    expect(table.current.current_revision.body.rows[1].calculated_total).toBe(E.revised_b);
    expect(table.current.current_revision.body.rows[1].difference).toBe(E.revised_difference);
    expect(table.current.current_revision.body.notes).toEqual([N.csv]);
    const exportedCSV = await download(csv, 'reconciled.csv');
    expect(exportedCSV).toContain(E.revised_b); expect(exportedCSV).toContain(N.row);
    releases.tool();
    await tool.waitForURL(origin + '/conversations/' + ids.tool);
    const third = await ready(ids.tool, 1);
    expect(third.observation.observation.output.value).toBe(E.tool_initial);
    await openProduct(tool, 'tool');
    await expect(tool.getByTestId('observed-return')).toHaveText(E.tool_initial);
    await shot(tool, '04-tool-initial-desktop');
    await tool.getByLabel('Your notes (one per line)').fill(N.tool);
    const toolSaved = await saveEdits(tool, third.artifact.id);
    await reply(tool, TOOL_REV, toolSaved);
    const fourth = await ready(ids.tool, 2);
    expect(fourth.observation.observation.output.value).toBe(E.tool_shipping);
    const calc = await pendingAndAccept(tool, ids.tool, third.artifact.id, toolSaved, fourth, '05-tool');
    expect(calc.current.current_revision.body.code).not.toBe(toolSaved.current_revision.body.code);
    expect(calc.current.current_revision.body.input_form).toHaveLength(3);
    expect(calc.current.current_revision.body.notes).toEqual([N.tool]);
    await expect(tool.getByTestId('observed-return')).toHaveText(E.tool_shipping);
    expect(await download(tool, 'calculator.wat')).toBe(calc.current.current_revision.body.code);
    // Continue inspecting/working after reopen without consuming a forbidden fifth turn.
    for (const width of [390, 320]) {
      for (const [kind, page, value] of [['csv', csv, table.current], ['tool', tool, calc.current]]) {
        await page.setViewportSize({width, height: 844});
        await expect(page.getByLabel('Your notes (one per line)')).toHaveValue(N[kind]);
        await page.getByLabel('Your notes (one per line)').fill(N[kind] + '\nUnsent working draft');
        await page.getByRole('button', {name: 'Conversation', exact: true}).click();
        await page.getByLabel('Reply about this work', {exact: true}).fill('Draft only: continue reviewing this saved result.');
        await noOverflow(page); await shot(page, `${kind}-conversation-${width}`);
        await page.getByRole('button', {name: 'Work', exact: true}).click();
        await expect(page.getByLabel('Your notes (one per line)')).toHaveValue(N[kind] + '\nUnsent working draft');
        await page.getByRole('button', {name: 'Discard my changes', exact: true}).click();
        await expect(page.getByLabel('Your notes (one per line)')).toHaveValue(N[kind]);
        if (kind === 'tool') await expect(page.getByTestId('observed-return')).toHaveText(E.tool_shipping);
        await noOverflow(page); await shot(page, `${kind}-work-${width}`);
        expect((await get('/artifacts/' + value.id)).current_revision_id).toBe(value.current_revision_id);
      }
    }
    const posts = report.requests.filter(r => r.path.endsWith('/messages'));
    expect(posts).toHaveLength(4);
    expect(posts.map(r => r.body.text)).toEqual([CSV_ASK, CSV_REV, TOOL_ASK, TOOL_REV]);
    expect(posts[0].body.attachments).toHaveLength(1);
    expect(posts[2].body.attachments ?? []).toEqual([]);
    for (const p of posts) expect(p.body.operation ?? null).toBeNull();
    const listing = await all('/conversations'); expect(new Set(listing.map(c => c.id))).toEqual(new Set(Object.values(ids)));
    expect(await all('/assignments')).toEqual([]);
    report.products = {csv: table.current, tool: calc.current};
    report.history = {};
    for (const [kind, art, saved] of [['csv', table.current, csvSaved], ['tool', calc.current, toolSaved]]) {
      const history = await all('/artifacts/' + art.id + '/history');
      report.history[kind] = history;
      expect(history.some(rev => rev.id === saved.current_revision_id)).toBe(true);
    }
    expect(report.page_errors).toEqual([]); expect(report.external_requests).toEqual([]);
    report.passed = true; report.ui_turns = posts.length; report.conversation_ids = ids;
    await save('browser-result.json', report);
  }
  console.log('PASS: ' + (phase === '--reopen' ? 'read-only process restart' : 'four actual UI turns, synthetic selection, actual local execution'));
} catch (error) {
  report.passed = false; report.error = String(error.stack ?? error);
  for (const [i, page] of pages.entries()) {
    try { await shot(page, `failure-${i}`); } catch { /* preserve primary error */ }
  }
  await save(phase === '--reopen' ? 'restart-failure.json' : 'browser-failure.json', report);
  throw error;
} finally {
  await stopWorker();
  for (const {context, name} of contexts) {
    await context.tracing.stop({path: path.join(out, name + '-trace.zip')});
  }
  await browser.close();
}
