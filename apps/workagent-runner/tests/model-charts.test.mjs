// Actual installed DSH/tool dispatch and wire, with synthetic model transport.
// In-memory workspace and local session fixtures; no provider/network/DB calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { bootHost } from '../src/host.mjs';
import { requestBody } from '../src/wire.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { withCharts } from '../../../packages/workagent-contract/sheet-charts.mjs';
import { createSheetReader, escapedBytes, SHEET_READ_BYTES } from '../src/sheet-read.mjs';
const chart = (extra = {}) => ({ id: 'chart1', title: 'Fixture', type: 'bar', sheetId: 'sheet1', range: { startRow: 2, endRow: 5, startColumn: 3, endColumn: 5 }, ...extra });
const chartPatch = { cells: [], chartOps: [{ op: 'create', chart: chart() }] };
const read = () => ({ name: 'read_sheet' });
const edit = (patch = chartPatch, id) => ({ id, name: 'edit_sheet', args: { patch: JSON.stringify(patch) } });
const policy = { version: 3, pricingBasis: 'openrouter-key-budget-v1', route: 'typesafe/jev-router', maxRequestBytes: 1_000_000, maxOutputTokens: 32768, provider: { allow_fallbacks: false, require_parameters: true } };
async function runFixture(steps) {
  let state = initialState('owner');
  const store = { async read(fn) { return structuredClone(await fn(structuredClone(state))); }, async transaction(fn) { const draft = structuredClone(state), result = await fn(draft); state = draft; return structuredClone(result); } };
  const ws = new Workspace(store), { workId } = await ws.createBlank('owner', { commandId: 'blank', title: 'Fixture' });
  const mutations = [], results = [], mutate = ws.mutate.bind(ws); let host;
  ws.mutate = async (...args) => { mutations.push(structuredClone(args[2])); return mutate(...args); };
  class FixtureProvider extends LlmAdapter {
    wires = [];
    providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }; }
    async *stream(options) {
      const wire = requestBody(options, policy), index = this.wires.push(wire) - 1;
      const step = await steps[index]?.({ wire, ws, store, workId, host, results });
      const block = step ? { type: 'tool-call', id: step.id ?? `fixture-call-${index}`, name: step.name, arguments: JSON.stringify(step.args ?? {}) } : { type: 'text', text: 'Synthetic fixture done, not real model evidence.' };
      yield { type: 'block-start', index: 0, blockType: block.type };
      yield step ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments } : { type: 'text-delta', index: 0, text: block.text };
      yield { type: 'block-end', index: 0, block }; yield { type: 'finish', reason: { kind: step ? 'tool-calls' : 'stop' } };
    }
  }
  const provider = new FixtureProvider();
  host = await bootHost({ stateRoot: await mkdtemp(join(tmpdir(), 'model-charts-fixture-')), workspace: ws, principal: 'owner', provider });
  host.ctx.on('tools/result', (exec, result) => results.push({ callId: exec.callId, error: result.isError, text: result.content.filter(c => c.type === 'text').map(c => c.text).join('\n') }));
  try {
    await ws.command('owner', { commandId: 'ask', kind: 'continue', workId, expectedIntentRevision: 0, text: 'Synthetic tool qualification', sourceIds: [] });
    let error;
    try { await host.run(await ws.claim('owner')); } catch (e) { error = e; }
    return { ws, workId, mutations, results, wires: provider.wires, error, current: state.enabled ? await ws.get('owner', workId) : structuredClone(state.works[workId]) };
  } finally { await host.close(); }
}
test('DSH fixture: read-first, unknown arguments/patch keys, honest chart receipts and preserved proposal', async () => {
  const r = await runFixture([() => edit(), read,
    () => ({ ...edit(), args: { ...edit().args, expected: {} } }),
    () => edit({ ...chartPatch, resources: [] }), () => edit()]);
  assert.equal(r.error, undefined);
  assert.match(r.results[0].text, /read_sheet_required/);
  assert.match(r.results[2].text, /invalid_edit_arguments/); assert.match(r.results[3].text, /invalid_patch/);
  const receipt = JSON.parse(r.results[1].text);
  assert.match(receipt.chartEditing, /chartOps/); assert.match(receipt.chartEditing, /proposal/i);
  assert.match(r.wires[0].tools.find(t => t.function.name === 'edit_sheet').function.description, /chartOps/);
  assert.equal(JSON.parse(r.results[4].text).status, 'proposed');
  assert.equal(r.current.contentRevision, 1); assert.equal(r.current.proposals.length, 1);
  assert.deepEqual(r.current.proposals[0].patch, chartPatch);
});
for (const mode of ['cell', 'pending-chart', 'accepted-chart']) test(`DSH fixture duplicate native edit freezes original ${mode} identity after newer read`, async () => {
  const charts = mode !== 'cell';
  const p = charts ? chartPatch : { cells: [{ sheetId: 'sheet1', row: 10, column: 0, value: 7 }] };
  const same = () => edit(p, 'same-call'); let expected;
  const r = await runFixture([read, same, async ({ ws, workId, results }) => {
    if (mode === 'accepted-chart') {
      const pending = await ws.get('owner', workId);
      await ws.decide('owner', workId, JSON.parse(results[1].text).proposalId, { commandId: 'isolated-accept', decision: 'accept', expected: pending.expected });
    }
    const w = await ws.get('owner', workId); w.book.name = 'Later human save';
    await ws.save('owner', workId, { commandId: 'human', book: w.book, contentRevision: w.contentRevision, permissionRevision: 1 });
    expected = (await ws.get('owner', workId)).expected;
    return read();
  }, same, () => edit({ cells: [{ sheetId: 'sheet1', row: 11, column: 0, value: 9 }] }, 'same-call'),
  () => edit({ cells: [{ sheetId: 'sheet1', row: 12, column: 0, value: 3 }] }, 'fresh-call')]);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.mutations[0], r.mutations[1]);
  assert.deepEqual(JSON.parse(r.results[1].text), JSON.parse(r.results[3].text));
  assert.match(r.results[4].text, /command_conflict/);
  assert.deepEqual(r.mutations.at(-1).expected, expected);
  assert.equal(r.current.proposals.length, charts ? 1 : 0);
  assert.equal(r.current.book.name, 'Later human save');
});
for (const change of ['permission', 'revoke', 'cancel']) test(`DSH fixture refuses ${change} between read and chart edit`, async () => {
  const r = await runFixture([read, async ({ store, ws, workId }) => {
    if (change === 'permission') await store.transaction(s => { s.permissionRevision++; });
    if (change === 'revoke') await store.transaction(s => { s.enabled = false; });
    if (change === 'cancel') await ws.command('owner', { commandId: 'cancel', kind: 'cancel', workId, expectedIntentRevision: 1, sourceIds: [] });
    return edit();
  }]);
  assert.equal(r.mutations.length, 0); assert.equal(r.current.proposals.length, 0);
  assert.match(r.error?.message ?? '', change === 'revoke' ? /access_denied/ : /work_superseded/);
  assert.match(r.results[1].text, change === 'revoke' ? /access_denied/ : /work_superseded/);
});
test('bounded chart reads retain all eight definitions and exact A1 source descriptors with unknown formula results', async () => {
  const r = await runFixture([]), w = r.current;
  w.book = withCharts(w.book, Array.from({ length: 8 }, (_, i) => chart({ id: `chart${i}`, title: '\u0001'.repeat(160) })));
  w.book.sheets.sheet1.cellData = { 2: { 4: { f: '="Series"', v: 'UNTRUSTED', t: 1 } } };
  const reader = createSheetReader(w.id);
  for (const q of [undefined, { overview: true }, { sheetId: 'sheet1', range: { startRow: 2, endRow: 5, startColumn: 3, endColumn: 5 } }]) {
    const read = JSON.parse(reader(w, q && JSON.stringify(q)));
    assert.equal(read.charts.length, 8); assert.ok(escapedBytes(read) <= SHEET_READ_BYTES);
    assert.equal(read.charts[0].source.rangeA1, 'D3:F6'); assert.equal(read.charts[0].source.headerRangeA1, 'D3:F3');
    assert.deepEqual(read.charts[0].source.series, [{ headerCell: 'E3', dataRangeA1: 'E4:E6' }, { headerCell: 'F3', dataRangeA1: 'F4:F6' }]);
    assert.doesNotMatch(JSON.stringify(read), /UNTRUSTED/);
  }
});
