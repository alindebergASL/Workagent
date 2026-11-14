// Synthetic in-memory qualification only; no database, HTTP or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace, commitEditorPatch } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { applyPatch, blankWorkbook, validatePatch, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { sheetCharts, withCharts, CHART_RESOURCE } from '../../../packages/workagent-contract/sheet-charts.mjs';
import { CONTROL_RESOURCE } from '../../../packages/workagent-contract/sheet-controls.mjs';
import { CONDITIONAL_RESOURCE } from '../../../packages/workagent-contract/conditional-formatting.mjs';
const chart = (extra = {}) => ({ id: 'chart1', title: 'Revenue', type: 'bar', sheetId: 'sheet1', range: { startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 }, ...extra });
const create = c => ({ op: 'create', chart: c });
const update = c => ({ op: 'update', chart: c });
const del = id => ({ op: 'delete', id });
const patch = (...chartOps) => ({ cells: [], chartOps });
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
function book() {
  const b = blankWorkbook('book');
  b.styles = { bold: { bl: 1 } };
  b.sheets.sheet1.tabColor = '#aabbcc';
  b.sheets.sheet1.cellData = { 0: { 0: { v: 'Label', t: 1, s: 'bold' }, 1: { f: '="Revenue"', v: 'UNTRUSTED', t: 1 } }, 1: { 1: { f: '=2*3', v: 999, t: 2, s: 'bold' } } };
  b.resources = [{ name: CONTROL_RESOURCE, data: JSON.stringify({ sheet1: [{ uid: 'check', type: 'checkbox', ranges: [{ startRow: 10, endRow: 10, startColumn: 0, endColumn: 0 }] }] }) }, { name: CONDITIONAL_RESOURCE, data: JSON.stringify({ sheet1: [{ cfId: 'highlight', stopIfTrue: false, ranges: [{ startRow: 1, endRow: 4, startColumn: 1, endColumn: 1 }], rule: { type: 'highlightCell', subType: 'number', operator: 'greaterThan', value: 5, style: { bg: { rgb: '#ff0000' } } } }] }) }];
  return b;
}
test('shared applyPatch creates, replaces and deletes chart definitions atomically, preserving native content/resources and raw input', () => {
  const before = freeze(book()), input = freeze({ cells: [{ sheetId: 'sheet1', row: 10, column: 0, value: true }], chartOps: [create(chart())] });
  const next = applyPatch(before, input);
  assert.deepEqual(sheetCharts(next), [chart()]);
  assert.equal(next.sheets.sheet1.cellData[10][0].v, 1);
  assert.equal(next.sheets.sheet1.cellData[1][1].f, '=2*3');
  assert.equal(next.sheets.sheet1.cellData[1][1].v, undefined);
  assert.equal(before.sheets.sheet1.cellData[1][1].v, 999);
  assert.deepEqual(next.styles, before.styles); assert.equal(next.sheets.sheet1.tabColor, '#aabbcc');
  assert.deepEqual(next.resources.filter(r => r.name !== CHART_RESOURCE), before.resources);
  const changed = chart({ type: 'line', title: 'New title' });
  const second = applyPatch(next, patch(update(changed)));
  assert.deepEqual(sheetCharts(second), [changed]);
  assert.deepEqual(sheetCharts(applyPatch(second, patch(del('chart1')))), []);
  validateWorkbook(second); assert.equal(input.cells[0].value, true);
});
test('chart sources validate against resulting workbook including new sheets and expanded cells', () => {
  const p = { addSheets: [{ id: 'new', name: 'New source' }], cells: [{ sheetId: 'new', row: 201, column: 1, value: 9 }], chartOps: [create(chart({ sheetId: 'new', range: { startRow: 199, endRow: 201, startColumn: 0, endColumn: 1 } }))] };
  assert.equal(sheetCharts(applyPatch(book(), p))[0].sheetId, 'new');
});
test('bad chart and mixed patches refuse without mutating input; strict keys, identities, conflicts, caps, bounds and merges', () => {
  const base = freeze(withCharts(book(), [chart()])), original = JSON.stringify(base);
  const bad = [patch(create(chart())), patch(update(chart({ id: 'missing' }))), patch(del('missing')), patch(del('__proto__')),
    patch(del('chart1'), create(chart())), patch(update(chart()), update(chart())), patch({ op: 'delete', id: 'chart1', chart: chart() }),
    patch({ op: 'upsert', chart: chart() }), patch(create({ ...chart({ id: 'c2' }), extra: true })),
    patch(create(chart({ id: 'c2', type: 'pie' }))), patch(create(chart({ id: 'c2', range: { startRow: 0, endRow: 101, startColumn: 0, endColumn: 2 } }))),
    patch(create(chart({ id: 'c2', range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 5 } }))),
    patch(create(chart({ id: 'c2', range: { startRow: 199, endRow: 200, startColumn: 0, endColumn: 1 } }))),
    patch(...Array.from({ length: 8 }, (_, i) => create(chart({ id: `new${i}` })))),
    { cells: [], resources: [] }, { cells: [{ sheetId: 'sheet1', row: 1, column: 0, value: 2, extra: 1 }] },
    { cells: [], addSheets: [{ id: 'n', name: 'N', resources: [] }] }, patch(null), patch({ op: 'create', chart: null }), { cells: [], chartOps: null }];
  for (const p of bad) {
    const input = freeze({ ...p, cells: [...p.cells, { sheetId: 'sheet1', row: 3, column: 3, value: 123 }] }), bytes = JSON.stringify(input);
    assert.throws(() => applyPatch(base, input), undefined, JSON.stringify(p));
    assert.equal(JSON.stringify(base), original); assert.equal(JSON.stringify(input), bytes);
  }
  const merged = book(); merged.sheets.sheet1.mergeData = [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }];
  assert.throws(() => applyPatch(merged, patch(create(chart()))));
  assert.throws(() => validatePatch(patch(...Array.from({ length: 17 }, (_, i) => del(`c${i}`)))));
});
async function setup() {
  let state = initialState('owner');
  const store = { async read(fn) { return structuredClone(await fn(structuredClone(state))); }, async transaction(fn) { const draft = structuredClone(state); const result = await fn(draft); state = draft; return structuredClone(result); } };
  const ws = new Workspace(store), { workId } = await ws.createBlank('owner', { commandId: 'blank', title: 'Chart fixture' });
  const b = withCharts(book(), [chart()]); b.id = workId;
  await ws.save('owner', workId, { commandId: 'human', book: b, contentRevision: 1, permissionRevision: 1 });
  return { ws, store, workId, state: () => structuredClone(state) };
}
test('Workspace chart/mixed proposals preserve human definitions and exact retry identity; isolated accept/reject are atomic and idempotent', async () => {
  const { ws, workId, state } = await setup(), before = await ws.get('owner', workId);
  const p = freeze({ cells: [{ sheetId: 'sheet1', row: 10, column: 0, value: false }], chartOps: [update(chart({ title: 'Model title' })), create(chart({ id: 'new' }))] });
  const input = { commandId: 'model', expected: before.expected, patch: p };
  const proposed = await ws.mutate('owner', workId, input); assert.equal(proposed.status, 'proposed');
  assert.deepEqual(await ws.mutate('owner', workId, input), proposed);
  const pending = await ws.get('owner', workId);
  assert.deepEqual(pending.book, before.book); assert.equal(pending.contentRevision, before.contentRevision);
  assert.deepEqual(pending.proposals[0].patch, p); assert.equal(pending.proposals[0].reason, 'chart_definition');
  assert.deepEqual(pending.proposals[0].chartChanges[0].before.chart, chart());
  assert.equal(pending.proposals[0].chartChanges[0].after.chart.title, 'Model title');
  const accept = { commandId: 'accept', expected: pending.expected, decision: 'accept' };
  const accepted = await ws.decide('owner', workId, proposed.proposalId, accept), after = state();
  assert.deepEqual(await ws.decide('owner', workId, proposed.proposalId, accept), accepted);
  assert.deepEqual(await ws.mutate('owner', workId, input), proposed); assert.deepEqual(state(), after);
  await assert.rejects(ws.mutate('owner', workId, { ...input, patch: patch(del('chart1')) }), /command_conflict/);
  const current = await ws.get('owner', workId); assert.equal(current.book.sheets.sheet1.cellData[10][0].v, 0);
  const removal = await ws.mutate('owner', workId, { commandId: 'remove', expected: current.expected, patch: patch(del('chart1')) });
  const reject = { commandId: 'reject', decision: 'reject', expected: current.expected };
  assert.equal((await ws.decide('owner', workId, removal.proposalId, reject)).status, 'rejected');
  assert.equal((await ws.decide('owner', workId, removal.proposalId, reject)).status, 'rejected');
  assert.deepEqual((await ws.get('owner', workId)).book, current.book);
  const removal2 = await ws.mutate('owner', workId, { commandId: 'remove2', expected: current.expected, patch: patch(del('chart1')) });
  await ws.decide('owner', workId, removal2.proposalId, { ...accept, commandId: 'accept2', expected: current.expected });
  assert.deepEqual(sheetCharts((await ws.get('owner', workId)).book).map(c => c.id), ['new']);
});
for (const change of ['human', 'permission', 'intent', 'cancel']) test(`Workspace chart proposal refuses stale acceptance after ${change}`, async () => {
  const { ws, store, workId } = await setup(), before = await ws.get('owner', workId);
  const p = await ws.mutate('owner', workId, { commandId: 'model', expected: before.expected, patch: patch(update(chart({ title: 'Model' }))) });
  if (change === 'human') await ws.save('owner', workId, { commandId: 'human2', book: withCharts(before.book, [chart({ title: 'Human new title' })]), contentRevision: before.contentRevision, permissionRevision: 1 });
  if (change === 'permission') await store.transaction(s => { s.permissionRevision++; });
  if (change === 'intent' || change === 'cancel') await ws.command('owner', { commandId: 'steer', kind: change === 'cancel' ? 'cancel' : 'continue', workId, expectedIntentRevision: before.intentRevision, sourceIds: [], text: 'New direction' });
  const current = await ws.get('owner', workId);
  await assert.rejects(ws.decide('owner', workId, p.proposalId, { commandId: 'accept', decision: 'accept', expected: current.expected }), /proposal_conflict/);
  assert.deepEqual((await ws.get('owner', workId)).book, current.book);
});
test('Workspace validates before proposing, denies revoked access, protects direct commit and keeps old cell-only behavior', async () => {
  const { ws, store, workId, state } = await setup(), before = await ws.get('owner', workId), original = state();
  await assert.rejects(ws.mutate('owner', workId, { commandId: 'bad', expected: before.expected, patch: { cells: [{ sheetId: 'sheet1', row: 15, column: 1, value: 7 }], chartOps: [del('missing')] } }));
  assert.deepEqual(state(), original);
  await store.transaction(s => { const w = s.works[workId]; assert.equal(commitEditorPatch(s, w, patch(update(chart())), before.expected).status, 'protected'); });
  const ordinary = await ws.mutate('owner', workId, { commandId: 'cell', expected: before.expected, patch: { cells: [{ sheetId: 'sheet1', row: 15, column: 1, value: true }] } });
  assert.equal(ordinary.status, 'applied');
  const current = await ws.get('owner', workId); assert.equal(current.book.sheets.sheet1.cellData[15][1].v, true);
  await store.transaction(s => { s.enabled = false; });
  await assert.rejects(ws.mutate('owner', workId, { commandId: 'revoked', expected: current.expected, patch: patch(del('chart1')) }), /access_denied/);
});

test('inclusive 100-row/4-series limit and eight-chart replacement batch validate the final state, not intermediate count', () => {
  const b = withCharts(book(), Array.from({ length: 8 }, (_, i) => chart({ id: `old${i}` })));
  const ops = [
    ...Array.from({ length: 8 }, (_, i) => create(chart({ id: `new${i}`, range: { startRow: 0, endRow: 100, startColumn: 0, endColumn: 4 } }))),
    ...Array.from({ length: 8 }, (_, i) => del(`old${i}`)),
  ];
  const result = applyPatch(freeze(b), freeze(patch(...ops)));
  assert.equal(sheetCharts(result).length, 8); assert.equal(sheetCharts(result)[7].id, 'new7');
  assert.deepEqual(result.resources.filter(r => r.name !== CHART_RESOURCE), b.resources.filter(r => r.name !== CHART_RESOURCE));
});
test('mixed patches also roll back valid chart operations when a cell or new sheet is invalid', () => {
  const b = freeze(book()), before = JSON.stringify(b);
  for (const extra of [{ cells: [{ sheetId: 'missing', row: 0, column: 0, value: 1 }] },
    { cells: [{ sheetId: 'sheet1', row: 1, column: 0, value: {}, formula: '=1' }] },
    { addSheets: [{ id: 'same', name: 'One' }, { id: 'same', name: 'Two' }] }]) {
    assert.throws(() => applyPatch(b, freeze({ ...patch(create(chart())), ...extra })));
    assert.equal(JSON.stringify(b), before);
  }
});
test('human chart edits before an old read proposes are preserved; the captured definition describes the current saved revision', async () => {
  const { ws, workId } = await setup(), old = await ws.get('owner', workId);
  const human = chart({ title: 'New human definition', type: 'line' });
  await ws.save('owner', workId, { commandId: 'later-human', contentRevision: old.contentRevision, permissionRevision: 1, book: withCharts(old.book, [human]) });
  const result = await ws.mutate('owner', workId, { commandId: 'old-model', expected: old.expected, patch: patch(del('chart1')) });
  assert.equal(result.status, 'proposed');
  const current = await ws.get('owner', workId), proposal = current.proposals[0];
  assert.deepEqual(sheetCharts(current.book), [human]);
  assert.deepEqual(proposal.originalExpected, old.expected); assert.deepEqual(proposal.expected, current.expected);
  assert.deepEqual(proposal.chartChanges[0].before.chart, human);
  await ws.decide('owner', workId, result.proposalId, { commandId: 'keep', decision: 'reject', expected: current.expected });
  assert.deepEqual(sheetCharts((await ws.get('owner', workId)).book), [human]);
});

test('legacy saved cell-only proposal without chart fields still accepts and retries with checkbox normalization', async () => {
  const { ws, store, workId } = await setup(), before = await ws.get('owner', workId);
  await store.transaction(s => s.works[workId].proposals.push({ id: 'legacy', status: 'pending', reason: 'human_edit', expected: before.expected,
    patch: { cells: [{ sheetId: 'sheet1', row: 10, column: 0, value: true }] } }));
  const accept = { commandId: 'legacy-accept', decision: 'accept', expected: before.expected };
  const accepted = await ws.decide('owner', workId, 'legacy', accept);
  assert.deepEqual(await ws.decide('owner', workId, 'legacy', accept), accepted);
  const current = await ws.get('owner', workId);
  assert.equal(current.book.sheets.sheet1.cellData[10][0].v, 1);
  assert.deepEqual(current.book.resources, before.book.resources);
  assert.equal(current.proposals[0].patch.cells[0].value, true);
});
