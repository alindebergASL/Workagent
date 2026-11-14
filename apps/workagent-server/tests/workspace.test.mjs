import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../src/workspace.mjs';
import { initialState, PostgresStore } from '../src/store.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
import { applyPatch, blankWorkbook, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CONTROL_RESOURCE, controlAt } from '../../../packages/workagent-contract/sheet-controls.mjs';
import { Readable } from 'node:stream';
import { createHandler } from '../src/http.mjs';
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'workagent-fixture-')), path = join(dir, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), ws = new Workspace(store);
  const command = { commandId: 'start1', kind: 'start', text: 'Compare these synthetic materials', sourceIds: [] };
  const started = await ws.command('owner', command);
  return { ws, store, path, command, wid: started.workId };
}
const patch = value => ({ cells: [{ sheetId: 'sheet1', row: 0, column: 0, value }] });
const checkbox = (formula1, formula2) => ({ uid: 'check', type: 'checkbox', formula1, formula2,
  ranges: [{ startRow: 10, endRow: 11, startColumn: 4, endColumn: 5 }] });
function checkboxBook(rule = checkbox('1', '0')) {
  const book = blankWorkbook('synthetic-checkbox');
  book.sheetOrder.push('other'); book.sheets.other = { ...structuredClone(book.sheets.sheet1), id: 'other', name: 'Other' };
  book.resources = [{ name: CONTROL_RESOURCE, data: JSON.stringify({ sheet1: [rule] }) }];
  book.sheets.sheet1.cellData = { 10: { 4: { s: { bl: 1 } } } };
  return book;
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
test('authoritative checkbox Booleans use numeric states only inside the effective control, without mutating inputs', () => {
  for (const aliases of [[undefined, undefined], ['1', '0'], ['TRUE', 'FALSE'], ['true', 'false']]) {
    const book = freeze(checkboxBook(checkbox(...aliases))), before = JSON.stringify(book);
    const cells = [];
    for (const sheetId of ['sheet1', 'other']) for (const row of [9, 10, 11, 12]) for (const column of [3, 4, 5, 6]) {
      cells.push({ sheetId, row, column, value: (row + column) % 2 === 0 });
    }
    const input = freeze({ cells }), raw = JSON.stringify(input), result = applyPatch(book, input);
    for (const c of cells) {
      const controlled = c.sheetId === 'sheet1' && c.row >= 10 && c.row <= 11 && c.column >= 4 && c.column <= 5;
      const cell = result.sheets[c.sheetId].cellData[c.row][c.column];
      assert.equal(cell.v, controlled ? Number(c.value) : c.value); assert.equal(cell.t, controlled ? 2 : 3);
    }
    assert.deepEqual(result.sheets.sheet1.cellData[10][4].s, { bl: 1 });
    assert.deepEqual(result.resources, book.resources);
    assert.equal(JSON.stringify(book), before); assert.equal(JSON.stringify(input), raw);
  }
  const other = checkboxBook(); other.resources[0].data = JSON.stringify({ other: [checkbox()] });
  const result = applyPatch(other, { cells: ['sheet1', 'other'].map(sheetId => ({ sheetId, row: 10, column: 4, value: false })) });
  assert.equal(result.sheets.sheet1.cellData[10][4].v, false);
  assert.equal(result.sheets.other.cellData[10][4].v, 0);
});
test('checkbox patches preserve formulas, nulls, strings, numbers and final duplicate-cell writes', () => {
  const book = checkboxBook(), target = { sheetId: 'sheet1', row: 10, column: 4 };
  for (const value of [null, '', 'FALSE', 'TRUE', '0', '1', '=1+1', 0, 1, 7]) {
    const cell = applyPatch(book, { cells: [{ ...target, value: true }, { ...target, value }] }).sheets.sheet1.cellData[10][4];
    assert.equal(cell.v, value); assert.equal(cell.t, typeof value === 'number' ? 2 : 1);
    assert.equal(cell.f, undefined);
  }
  const cell = applyPatch(book, { cells: [{ ...target, value: true, formula: '=1+1' }] }).sheets.sheet1.cellData[10][4];
  assert.equal(cell.f, '=1+1'); assert.equal(cell.v, undefined); assert.equal(cell.t, undefined);
  const edge = checkboxBook({ ...checkbox(), ranges: [{ startRow: 9999, endRow: 9999, startColumn: 199, endColumn: 199 }] });
  edge.sheets.sheet1.rowCount = 10000; edge.sheets.sheet1.columnCount = 200;
  assert.equal(applyPatch(edge, { cells: [{ sheetId: 'sheet1', row: 9999, column: 199, value: false }] }).sheets.sheet1.cellData[9999][199].v, 0);
});
test('last overlapping native control wins; empty checkbox formulas are refused without inventing a state', () => {
  const check = checkbox('1', '0'), list = { ...checkbox(), uid: 'list', type: 'list', formula1: '["Ready"]' };
  const input = { cells: [{ sheetId: 'sheet1', row: 10, column: 4, value: true }] };
  for (const rules of [[check, list], [list, check]]) {
    const book = checkboxBook(); book.resources[0].data = JSON.stringify({ sheet1: rules });
    assert.equal(controlAt(book, 'sheet1', 10, 4).uid, rules.at(-1).uid);
    const cell = applyPatch(book, input).sheets.sheet1.cellData[10][4];
    assert.equal(cell.v, rules.at(-1).type === 'checkbox' ? 1 : true);
  }
  for (const aliases of [['', ''], ['', '0'], ['1', ''], ['yes', 'no']]) for (const value of [true, false]) {
    const book = freeze(checkboxBook(checkbox(...aliases)));
    assert.throws(() => applyPatch(book, { cells: [{ ...input.cells[0], value }] }), e => e.code === 'unsupported_sheet_controls' && e.status === 400);
  }
});
test('offline Workspace checkbox proposals retain raw identity and protection through retry, stale acceptance and revocation', async () => {
  const { ws, wid, store, path } = await setup(), original = await ws.get('owner', wid);
  const book = checkboxBook(); book.id = wid;
  await ws.save('owner', wid, { commandId: 'checkbox-save', book, contentRevision: original.contentRevision, permissionRevision: 1 });
  const before = await ws.get('owner', wid);
  const input = freeze({ commandId: 'checkbox-model', expected: before.expected, patch: { cells: [
    { sheetId: 'sheet1', row: 10, column: 4, value: true }, { sheetId: 'other', row: 10, column: 4, value: false },
  ] } });
  const proposed = await ws.mutate('owner', wid, input);
  assert.equal(proposed.status, 'proposed'); assert.deepEqual(await ws.mutate('owner', wid, input), proposed);
  const pending = await ws.get('owner', wid);
  assert.deepEqual(pending.book, before.book); assert.deepEqual(pending.proposals[0].patch, input.patch);
  assert.ok(pending.humanCells.includes('sheet1:10:4'));
  const accept = freeze({ commandId: 'checkbox-accept', decision: 'accept', expected: pending.expected });
  const accepted = await ws.decide('owner', wid, proposed.proposalId, accept);
  const bytes = await readFile(path, 'utf8');
  assert.deepEqual(await ws.decide('owner', wid, proposed.proposalId, accept), accepted);
  assert.deepEqual(await ws.mutate('owner', wid, input), proposed);
  assert.equal(await readFile(path, 'utf8'), bytes);
  const current = await ws.get('owner', wid);
  assert.equal(current.book.sheets.sheet1.cellData[10][4].v, 1);
  assert.equal(current.book.sheets.other.cellData[10][4].v, false);
  assert.deepEqual(current.proposals[0].patch, input.patch);
  await assert.rejects(ws.mutate('owner', wid, { ...input, patch: { cells: [{ ...input.patch.cells[0], value: 1 }] } }), /command_conflict/);
  const next = await ws.mutate('owner', wid, { ...input, commandId: 'checkbox-next', expected: current.expected });
  const unprotected = await ws.mutate('owner', wid, { commandId: 'ordinary-boolean', expected: current.expected, patch: { cells: [{ sheetId: 'other', row: 0, column: 0, value: true }] } });
  assert.equal(unprotected.status, 'applied');
  const changed = await readFile(path, 'utf8');
  await assert.rejects(ws.decide('owner', wid, next.proposalId, { commandId: 'stale-checkbox', decision: 'accept', expected: current.expected }), /proposal_conflict/);
  assert.equal(await readFile(path, 'utf8'), changed);
  await store.transaction(s => { s.permissionRevision++; s.enabled = false; });
  const revoked = await readFile(path, 'utf8');
  await assert.rejects(ws.decide('owner', wid, next.proposalId, { ...accept, commandId: 'revoked-checkbox' }), /access_denied/);
  await assert.rejects(ws.mutate('owner', wid, { ...input, commandId: 'revoked-write' }), /access_denied/);
  assert.equal(await readFile(path, 'utf8'), revoked);
});
test('ambiguous checkbox acceptance refuses the whole patch and leaves proposal, revisions and retry identity unchanged', async () => {
  const { ws, wid, path } = await setup(), original = await ws.get('owner', wid);
  const book = checkboxBook(checkbox('', '')); book.id = wid;
  await ws.save('owner', wid, { commandId: 'empty-control', book, contentRevision: original.contentRevision, permissionRevision: 1 });
  const before = await ws.get('owner', wid);
  const input = { commandId: 'ambiguous-model', expected: before.expected, patch: { cells: [
    { sheetId: 'other', row: 0, column: 0, value: 42 }, { sheetId: 'sheet1', row: 10, column: 4, value: true },
  ] } };
  const proposed = await ws.mutate('owner', wid, input), bytes = await readFile(path, 'utf8');
  const accept = { commandId: 'ambiguous-accept', decision: 'accept', expected: before.expected };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(ws.decide('owner', wid, proposed.proposalId, accept), e => e.code === 'unsupported_sheet_controls' && e.status === 400);
    assert.equal(await readFile(path, 'utf8'), bytes);
  }
  assert.deepEqual(await ws.mutate('owner', wid, input), proposed);
  const pending = await ws.get('owner', wid);
  assert.equal(pending.proposals[0].status, 'pending'); assert.deepEqual(pending.proposals[0].patch, input.patch);
  assert.deepEqual(pending.book, before.book); assert.deepEqual(pending.expected, before.expected);
});
function commandRoute(ws, onCommand) {
  const token = 'synthetic-test-access-key-at-least-32-characters', origin = 'https://private.example.test';
  const handle = createHandler({ workspace: ws, owner: 'owner', token, origin, clientRoot: tmpdir(), onCommand });
  return async input => {
    const req = Readable.from([Buffer.from(JSON.stringify(input))]);
    Object.assign(req, { method: 'POST', url: '/api/work/commands', headers: { 'content-type': 'application/json', origin, authorization: `Bearer ${token}` } });
    let status, result;
    await handle(req, { setHeader() {}, writeHead(code) { status = code; }, end(raw) { result = JSON.parse(raw); } });
    assert.equal(status, 202);
    return result;
  };
}
test('command route without listener: replayed start has no callback or execution effect', async () => {
  const { ws, command, wid, path } = await setup(), job = await ws.claim('owner');
  const calls = [], submit = commandRoute(ws, (...args) => calls.push(args));
  const before = await readFile(path, 'utf8');
  const result = await submit(command);
  assert.deepEqual(result, { workId: wid, commandId: command.commandId, intentRevision: 1 });
  assert.equal(calls.length, 0);
  assert.equal(await readFile(path, 'utf8'), before);
  await ws.finish('owner', job, [], 'ready');
  assert.equal((await ws.get('owner', wid)).status, 'ready');
});
test('command route without listener: repeated continuation and older replay cannot cancel newer work', async () => {
  const { ws, command, wid, path } = await setup(), original = await ws.claim('owner');
  const calls = [], submit = commandRoute(ws, (...args) => calls.push(args));
  const next = { commandId: 'continue1', kind: 'continue', workId: wid, expectedIntentRevision: 1, text: 'New direction', sourceIds: [] };
  const accepted = await submit(next);
  assert.equal(calls.length, 1);
  assert.deepEqual(await submit(next), accepted);
  assert.equal(calls.length, 1, 'duplicate continuation must not wake or cancel execution');
  await ws.finish('owner', original, [], 'ready');
  const continued = await ws.claim('owner');
  const newer = await submit({ ...next, commandId: 'continue2', expectedIntentRevision: 2, text: 'Latest direction' });
  await ws.finish('owner', continued, [], 'ready');
  const latest = await ws.claim('owner'), before = await readFile(path, 'utf8');
  assert.equal(calls.length, 2);
  assert.deepEqual(await submit(next), accepted);
  assert.equal((await submit(command)).intentRevision, 1);
  assert.equal(calls.length, 2, 'old commands must not interrupt the latest job');
  assert.equal(await readFile(path, 'utf8'), before);
  assert.equal((await ws.get('owner', wid)).intentRevision, newer.intentRevision);
  await ws.finish('owner', latest, [], 'ready');
  assert.equal((await ws.get('owner', wid)).status, 'ready');
});
test('command route without listener: explicit cancel completes as stopped even when DSH returns normally', async () => {
  const { ws, wid, path } = await setup(), job = await ws.claim('owner');
  const calls = [], submit = commandRoute(ws, (...args) => calls.push(args));
  const cancel = { commandId: 'cancel', kind: 'cancel', workId: wid, expectedIntentRevision: 1, sourceIds: [] };
  const result = await submit(cancel);
  assert.equal((await ws.get('owner', wid)).status, 'cancellation_requested');
  await ws.finish('owner', job, [], 'ready');
  assert.equal((await ws.get('owner', wid)).status, 'stopped');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).jobs[job.id].status, 'stopped');
  assert.equal(await ws.claim('owner'), null);
  assert.deepEqual(await submit(cancel), result);
  assert.equal(calls.length, 1);
});
async function human(ws, wid, value, commandId = 'save1') {
  const w = await ws.get('owner', wid);
  return ws.save('owner', wid, { commandId, contentRevision: w.contentRevision, permissionRevision: w.expected.permissionRevision, book: applyPatch(w.book, patch(value)) });
}
test('fixture: duplicate command is stable, conflicting reuse and foreign principal denied', async () => {
  const { ws, command, wid, path } = await setup();
  assert.equal((await ws.command('owner', command)).workId, wid);
  await assert.rejects(ws.command('owner', { ...command, text: 'different' }), /command_conflict/);
  await assert.rejects(ws.command('intruder', command), /access_denied/);
  await assert.rejects(ws.get('intruder', wid), /access_denied/);
  assert.equal(Object.keys(JSON.parse(await readFile(path)).jobs).length, 1);
});
test('fixture: inaccessible source cannot admit a work or outbox row', async () => {
  const { ws, path } = await setup(); const before = await readFile(path, 'utf8');
  await assert.rejects(ws.command('owner', { commandId: 'denied', kind: 'start', text: 'use stolen data', sourceIds: ['foreign'] }), /source_access_denied/);
  assert.equal(await readFile(path, 'utf8'), before);
  await assert.rejects(ws.source('owner', { commandId: 'source1', name: 'private', content: 'data', synthetic: false }), /synthetic_data_required/);
});
test('fixture: human edit between agent read and authoritative commit survives; proposal acceptance revalidates', async () => {
  const { ws, wid } = await setup(); const read = await ws.get('owner', wid);
  await human(ws, wid, 42);
  const proposed = await ws.mutate('owner', wid, { commandId: 'agent1', expected: read.expected, patch: patch(99) });
  assert.equal(proposed.status, 'proposed');
  const current = await ws.get('owner', wid); assert.equal(current.book.sheets.sheet1.cellData[0][0].v, 42);
  await human(ws, wid, 47, 'save2');
  await assert.rejects(ws.decide('owner', wid, proposed.proposalId, { commandId: 'accept1', decision: 'accept', expected: current.expected }), /proposal_conflict/);
  assert.equal((await ws.get('owner', wid)).book.sheets.sheet1.cellData[0][0].v, 47);
});
test('fixture: fresh human-cell proposal can be reviewed and accepted exactly once', async () => {
  const { ws, wid } = await setup(); await human(ws, wid, 'human'); const w = await ws.get('owner', wid);
  const p = await ws.mutate('owner', wid, { commandId: 'a1', expected: w.expected, patch: patch('reviewed') });
  const input = { commandId: 'accept1', decision: 'accept', expected: w.expected };
  assert.deepEqual(await ws.decide('owner', wid, p.proposalId, input), await ws.decide('owner', wid, p.proposalId, input));
  assert.equal((await ws.get('owner', wid)).book.sheets.sheet1.cellData[0][0].v, 'reviewed');
});
test('fixture: native-shaped values, formulas and styles survive store reopen and conflicting save retains current content', async () => {
  const { ws, wid, path } = await setup(); const w = await ws.get('owner', wid);
  const book = applyPatch(w.book, { cells: [{ sheetId: 'sheet1', row: 0, column: 0, value: 3 }, { sheetId: 'sheet1', row: 1, column: 0, value: null, formula: '=A1*2' }] });
  book.styles = { title: { bl: 1 } }; book.sheets.sheet1.cellData[0][0].s = 'title';
  await ws.save('owner', wid, { commandId: 'save', book, contentRevision: 0, permissionRevision: 1 });
  const reopened = new Workspace(new FileFixtureStore(path)); assert.deepEqual((await reopened.get('owner', wid)).book, book);
  await assert.rejects(reopened.save('owner', wid, { commandId: 'stale', book: w.book, contentRevision: 0, permissionRevision: 1 }), /save_conflict/);
  assert.deepEqual((await reopened.get('owner', wid)).book, book);
});
test('shared formula result refresh does not acquire human ownership; a formula edit still does', async () => {
  const { ws, wid, store } = await setup();
  await store.transaction(s => {
    s.works[wid].book.sheets.sheet1.cellData = { 0: { 0: { v: 10, t: 2 }, 1: { f: '=$A$1*2', si: 'group', v: 20, t: 2 } }, 1: { 1: { si: 'group', v: 20, t: 2 } } };
  });
  const before = await ws.get('owner', wid);
  await ws.mutate('owner', wid, { commandId: 'change-input', expected: before.expected, patch: patch(15) });
  const current = await ws.get('owner', wid), cells = current.book.sheets.sheet1.cellData;
  assert.equal(cells[0][1].v, undefined); assert.equal(cells[1][1].v, undefined);
  cells[0][1].v = cells[1][1].v = 30; cells[0][1].t = cells[1][1].t = 2;
  await ws.save('owner', wid, { commandId: 'cache-only', book: current.book, contentRevision: current.contentRevision, permissionRevision: 1 });
  const refreshed = await ws.get('owner', wid); assert.deepEqual(refreshed.humanCells, []);
  refreshed.book.sheets.sheet1.cellData[1][1] = { f: '=A1*3', v: 45, t: 2 };
  await ws.save('owner', wid, { commandId: 'human-formula', book: refreshed.book, contentRevision: refreshed.contentRevision, permissionRevision: 1 });
  assert.deepEqual((await ws.get('owner', wid)).humanCells, ['sheet1:1:1']);
});
test('style-table edits protect literal, formula and shared-formula cells without treating style ID changes as edits', async () => {
  const { ws, wid, store } = await setup();
  await store.transaction(s => {
    const book = s.works[wid].book;
    book.styles = { original: { bl: 1 } };
    book.sheets.sheet1.cellData = { 0: { 0: { v: 10, t: 2, s: 'original' }, 1: { f: '=A1*2', si: 'group', v: 20, t: 2, s: 'original' }, 2: { si: 'group', v: 20, t: 2, s: 'original' } } };
  });
  const before = await ws.get('owner', wid);
  before.book.styles.equivalent = { bl: 1 };
  for (const cell of Object.values(before.book.sheets.sheet1.cellData[0])) cell.s = 'equivalent';
  await ws.save('owner', wid, { commandId: 'same-style', book: before.book, contentRevision: before.contentRevision, permissionRevision: 1 });
  const same = await ws.get('owner', wid); assert.deepEqual(same.humanCells, []);
  same.book.styles.equivalent.it = 1;
  await ws.save('owner', wid, { commandId: 'changed-style', book: same.book, contentRevision: same.contentRevision, permissionRevision: 1 });
  assert.deepEqual((await ws.get('owner', wid)).humanCells, ['sheet1:0:0', 'sheet1:0:1', 'sheet1:0:2']);
});
test('formula cache invalidation keeps the original workbook cap on the resulting content', async () => {
  const { ws, wid } = await setup(), { book } = await ws.get('owner', wid);
  book.sheets.sheet1.cellData = { 0: { 0: { v: 1, t: 2 }, 1: { f: '=REPT("x",20000)', v: 'x'.repeat(20000), t: 1 } } };
  book.padding = '';
  book.padding = 'p'.repeat(3_999_900 - JSON.stringify(book).length);
  assert.equal(JSON.stringify(validateWorkbook(book)).length, 3_999_900);
  const admitted = applyPatch(book, patch('y'.repeat(20000)));
  assert.ok(JSON.stringify(admitted).length <= 4_000_000);
  assert.equal(admitted.sheets.sheet1.cellData[0][1].v, undefined);
  assert.throws(() => applyPatch(book, { cells: [...patch('y'.repeat(20000)).cells, { sheetId: 'sheet1', row: 2, column: 0, value: 'z'.repeat(20000) }] }), /invalid_workbook/);
  assert.equal(book.sheets.sheet1.cellData[0][1].v.length, 20000, 'rejected patch leaves retained input intact');
});
test('fixture: intent and permission revisions checked in commit, not just read', async () => {
  const { ws, wid, store } = await setup(); const old = await ws.get('owner', wid);
  await ws.command('owner', { commandId: 'steer', kind: 'continue', workId: wid, expectedIntentRevision: old.intentRevision, sourceIds: [], text: 'change direction' });
  assert.equal((await ws.mutate('owner', wid, { commandId: 'stale-agent', expected: old.expected, patch: patch(4) })).status, 'proposed');
  await store.transaction(s => { s.permissionRevision++; s.enabled = false; });
  await assert.rejects(ws.mutate('owner', wid, { commandId: 'revoked', expected: old.expected, patch: patch(5) }), /access_denied/);
});
test('fixture: concurrent writes serialize; cancelled work cannot accept a proposal', async () => {
  const { ws, wid } = await setup(); const w = await ws.get('owner', wid);
  const results = await Promise.all([1, 2].map(value => ws.mutate('owner', wid, { commandId: `a${value}`, expected: w.expected, patch: patch(value) })));
  assert.deepEqual(results.map(x => x.status), ['applied', 'proposed']);
  await ws.command('owner', { commandId: 'cancel', kind: 'cancel', workId: wid, expectedIntentRevision: w.intentRevision, sourceIds: [] });
  const now = await ws.get('owner', wid);
  await assert.rejects(ws.decide('owner', wid, results[1].proposalId, { commandId: 'accept', decision: 'accept', expected: now.expected }), /proposal_conflict/);
});
test('fixture: restart marks interrupted work and never requeues an uncertain model call', async () => {
  const { ws, wid, path } = await setup(); await ws.claim('owner');
  const reopened = new Workspace(new FileFixtureStore(path)); await reopened.recover('owner');
  assert.equal((await reopened.get('owner', wid)).status, 'interrupted'); assert.equal(await reopened.claim('owner'), null);
});
test('SQL contract fixture: PostgreSQL locks before application and rolls back on rejected mutation', async () => {
  const statements = []; let released = false;
  const client = { query: async (sql) => { statements.push(sql); return { rows: sql.startsWith('SELECT data') ? [{ data: initialState('owner') }] : [] }; }, release() { released = true; } };
  const store = new PostgresStore({ connect: async () => client }, 'owner');
  await assert.rejects(store.transaction(() => { throw new Error('denied'); }), /denied/);
  assert.deepEqual(statements, ['BEGIN', 'SELECT data FROM workagent_b01.workspace WHERE id = $1 FOR UPDATE', 'ROLLBACK']); assert.equal(released, true);
});

test('owner format provenance is bounded, additive, immutable under retry, and cannot erase protection', async () => {
  const { ws, wid } = await setup(), before = await ws.get('owner', wid);
  before.book.sheets.sheet1.cellData = { 0: { 0: { f: '=1+1', v: 2, t: 2, s: { n: { pattern: '0.00' } } } } };
  const input = { commandId: 'provenance', book: before.book, contentRevision: before.contentRevision, permissionRevision: 1, formatEdits: { sheet1: [0] } };
  for (const formatEdits of [null, [], { missing: [0] }, { sheet1: [-1] }, { sheet1: [0, 0] }, { sheet1: [1, 0] }, { sheet1: [26] }, { sheet1: [40000] }, { sheet1: [0.5] }, { sheet1: Array(100001).fill(0) }]) {
    await assert.rejects(ws.save('owner', wid, { ...input, formatEdits }), /invalid_format_edits/);
  }
  const saved = await ws.save('owner', wid, input);
  assert.deepEqual(await ws.save('owner', wid, input), saved);
  await assert.rejects(ws.save('owner', wid, { ...input, formatEdits: {} }), /command_conflict/);
  await ws.save('owner', wid, { ...input, commandId: 'cache-only', contentRevision: saved.contentRevision, formatEdits: {} });
  assert.deepEqual((await ws.get('owner', wid)).humanCells, ['sheet1:0:0']);
  await assert.rejects(ws.save('intruder', wid, { ...input, commandId: 'intruder' }), /access_denied/);
});
