import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../src/workspace.mjs';
import { initialState, PostgresStore } from '../src/store.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
import { applyPatch, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
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
