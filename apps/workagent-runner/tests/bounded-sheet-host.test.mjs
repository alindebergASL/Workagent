// Actual installed DSH and actual streamOpenRouter/requestBody/byte guard.
// The SSE provider and accounting are LOCAL FIXTURES, never real-model proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootHost } from '../src/host.mjs';
import { OpenRouterProvider } from '../src/provider.mjs';
import { createDispatcher } from '../src/dispatch.mjs';
import { SHEET_READ_BYTES } from '../src/sheet-read.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
import { workload } from '../../workagent-client/tests/sheet-scale-fixture.mjs';

const policy = { version: 3, pricingBasis: 'openrouter-key-budget-v1', route: 'typesafe/jev-router', maxRequestBytes: 1_000_000, maxOutputTokens: 32768, provider: { allow_fallbacks: false, require_parameters: true } };
const read = query => ['read_sheet', query === undefined ? {} : { query: JSON.stringify(query) }];
const edit = cells => ['edit_sheet', { patch: JSON.stringify({ cells }) }];
const toolResult = wire => JSON.parse(wire.messages.findLast(m => m.role === 'tool').content);

function assertSnapshotEqual(actual, expected, label) {
  // Keep full strict equality, but never ask assert to format a 100k-cell diff.
  if (isDeepStrictEqual(actual, expected)) return;
  const paths = [];
  function visit(a, b, path) {
    if (paths.length >= 5 || Object.is(a, b)) return;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object'
        || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) { paths.push(path); return; }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (paths.length >= 5) break;
      if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) paths.push(`${path}.${key}`);
      else visit(a[key], b[key], `${path}.${key}`);
    }
  }
  visit(actual, expected, label);
  assert.fail(`${label} differs; first five paths at most: ${paths.join(', ') || label}`);
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'bounded-sheet-fixture-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const { workId } = await workspace.createBlank('owner', { commandId: 'blank', title: 'Bounded read fixture' });
  return { root, path, workspace, workId };
}
async function execute(f, step, { selection, policyOverride } = {}) {
  const wires = [], receipts = [], reserves = [], order = [];
  const accounting = {
    async policy() { return { policy: policyOverride ?? policy, policyHash: 'a'.repeat(64) }; },
    async reserve(r) { reserves.push(r); order.push('reserve'); return { ...r, durable: true, reservationId: `fixture-${reserves.length}` }; },
    async dispatch() { order.push('dispatch'); return { dispatched: true }; },
    async retain(r) { receipts.push(r); order.push('retain'); return { retained: true }; },
  };
  const fetchImpl = async (_url, request) => {
    order.push('fetch'); const wire = JSON.parse(request.body); wires.push(wire);
    assert.ok(Buffer.byteLength(request.body) <= (policyOverride ?? policy).maxRequestBytes);
    assert.deepEqual(wire.tools.map(t => t.function.name).sort(), ['edit_sheet', 'read_sheet']);
    const n = wires.length, tool = await step(n, wire);
    const delta = tool ? { tool_calls: [{ index: 0, id: `fixture-call-${n}`, function: { name: tool[0], arguments: JSON.stringify(tool[1]) } }] }
      : { content: 'Fixture lifecycle finished; this is not a real-model answer or calculation.' };
    const frames = [{ id: `fixture-generation-${n}`, model: 'fixture/bounded-read', choices: [{ index: 0, delta, finish_reason: tool ? 'tool_calls' : 'stop' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0 } }];
    return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n');
  };
  const provider = new OpenRouterProvider({ accounting, apiKey: 'fixture-not-a-credential', fetchImpl });
  const host = await bootHost({ stateRoot: f.root, workspace: f.workspace, principal: 'owner', provider });
  const dispatch = createDispatcher({ workspace: f.workspace, principal: 'owner', host });
  try {
    const w = await f.workspace.get('owner', f.workId);
    await f.workspace.command('owner', { commandId: 'ask', kind: 'continue', workId: f.workId, expectedIntentRevision: w.intentRevision,
      text: 'Exercise bounded sheet tool fixtures.', sourceIds: [], ...(selection ? { selection } : {}) });
    dispatch.wake(); await dispatch.idle();
    const job = JSON.parse(await readFile(f.path, 'utf8')).jobs.ask;
    const native = await host.inspect(job);
    return { wires, receipts, reserves, order, job, native, current: await f.workspace.get('owner', f.workId) };
  } finally { await dispatch.close(); await host.close(); }
}

test('100k fixture: selected default, cross-tab range continuation and dependencies traverse actual DSH/wire under 1 MB; off-page human edits still propose', { timeout: 120000 }, async t => {
  const f = await setup(), book = workload(100000); book.id = f.workId;
  await f.workspace.save('owner', f.workId, { commandId: 'seed', book, contentRevision: 1, permissionRevision: 1 });
  // JSON persistence normalizes the fixture generator's -0 to +0. Compare the
  // entire post-host book with the authoritative saved snapshot, not raw input.
  const seeded = await f.workspace.get('owner', f.workId);
  assert.ok(Object.is(book.sheets.inputs.cellData[0][7].v, -0));
  assert.ok(Object.is(seeded.book.sheets.inputs.cellData[0][7].v, 0));
  const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, reads = [];
  let expected;
  const result = await execute(f, (n, wire) => {
    if (n === 1) return read();
    if (n <= 5) {
      const page = toolResult(wire); reads.push(page);
      assert.equal(page.book, undefined); assert.equal(page.protectedCells, undefined);
      assert.equal(page.overview.populatedCells, 100000); assert.equal(page.overview.storedCells, 100002); assert.equal(page.overview.formulaCells, 14000);
      assert.ok(Buffer.byteLength(JSON.stringify(wire.messages.findLast(m => m.role === 'tool').content)) <= SHEET_READ_BYTES);
      expected ??= page.expected; assert.deepEqual(page.expected, expected);
      if (n === 2) {
        assert.equal(page.sheetId, 'summary'); assert.equal(page.cells.length, 1); assert.equal(page.complete, true);
        assert.equal(page.cells[0].address, 'A1'); assert.equal(page.cells[0].row, 0); assert.equal(page.cells[0].column, 0);
        assert.equal(page.cells[0].cell.f, '=SUM(Operations!B1:B4)'); assert.equal(page.cells[0].cell.v, undefined);
        return read({ sheetId: 'operations', range: { startRow: 0, endRow: 59, startColumn: 0, endColumn: 3 }, expected });
      }
      if (n === 3) {
        assert.equal(page.cells.find(c => c.row === 1 && c.column === 1).address, 'B2');
        assert.equal(page.complete, false); return read({ cursor: page.nextCursor });
      }
      if (n === 4) { assert.equal(page.complete, true); return read({ sheetId: 'inputs', range: { startRow: 0, endRow: 5, startColumn: 0, endColumn: 2 }, expected }); }
      if (n === 5) {
        assert.equal(page.cells.length, 18); assert.equal(page.cells[0].cell.v, 1);
        assert.equal(page.cells.find(c => c.row === 2 && c.column === 1).address, 'B3');
        return edit([{ sheetId: 'inputs', row: 7999, column: 9, value: 999 }]);
      }
    }
    assert.equal(toolResult(wire).status, 'proposed'); return null;
  }, { selection: { workId: f.workId, contentRevision: 2, sheetId: 'summary', range } });
  assert.equal(result.wires.length, 6); assert.equal(result.current.status, 'ready');
  assert.equal(result.current.contentRevision, 2); assert.equal(result.current.proposals[0].reason, 'human_edit');
  assertSnapshotEqual(result.current.book, seeded.book, 'book');
  assertSnapshotEqual(result.current.humanCells, seeded.humanCells, 'humanCells');
  assert.ok(result.current.humanCells.length >= 100000);
  assert.equal(reads[1].cells.length + reads[2].cells.length, 240);
  assert.equal(new Set([...reads[1].cells, ...reads[2].cells].map(c => `${c.row}:${c.column}`)).size, 240);
  assert.equal(result.receipts.length, 6); assert.equal(result.reserves.length, 6);
  assert.ok(result.receipts.every(r => r.outcome === 'received' && r.terminal));
  assert.deepEqual(result.order, Array(6).fill(['reserve', 'dispatch', 'fetch', 'retain']).flat());
  const nativeResults = result.native.events.filter(e => e.type === 'tool/result');
  assert.equal(nativeResults.length, 5);
  assert.ok(nativeResults.every(e => Buffer.byteLength(JSON.stringify(e)) < 32000));
  t.diagnostic(`Fixture only: wire bytes ${result.reserves.map(r => r.requestBytes).join(', ')}; max native tool event ${Math.max(...nativeResults.map(e => Buffer.byteLength(JSON.stringify(e))))} bytes; populated 100000/formulas 14000; no real inference.`);
});

test('actual DSH stale continuation refuses; fresh read pins revisions; intervening save produces stale proposal', { timeout: 20000 }, async () => {
  const f = await setup();
  const initial = await f.workspace.get('owner', f.workId);
  for (let r = 0; r < 140; r++) initial.book.sheets.sheet1.cellData[r] = { 0: { v: r } };
  await f.workspace.save('owner', f.workId, { commandId: 'seed', book: initial.book, contentRevision: 1, permissionRevision: 1 });
  const humanSave = async commandId => {
    const w = await f.workspace.get('owner', f.workId); w.book.name += ' changed';
    await f.workspace.save('owner', f.workId, { commandId, book: w.book, contentRevision: w.contentRevision, permissionRevision: 1 });
  };
  const result = await execute(f, async (n, wire) => {
    if (n === 1) return read();
    if (n === 2) { const cursor = toolResult(wire).nextCursor; await humanSave('during-pages'); return read({ cursor }); }
    if (n === 3) { assert.match(wire.messages.findLast(m => m.role === 'tool').content, /read_cursor_stale_restart/); return read({ sheetId: 'sheet1' }); }
    if (n === 4) { assert.equal(toolResult(wire).expected.contentRevision, 3); await humanSave('after-read'); return edit([{ sheetId: 'sheet1', row: 170, column: 1, value: 9 }]); }
    assert.equal(toolResult(wire).status, 'proposed'); return null;
  });
  assert.equal(result.current.contentRevision, 4); assert.equal(result.current.proposals[0].reason, 'revision_changed');
  assert.equal(result.current.proposals[0].originalExpected.contentRevision, 3);
  assert.equal(result.current.book.sheets.sheet1.cellData[170], undefined);
});

test('actual DSH refuses unknown top-level read arguments and foreign selectors without authorizing an edit', { timeout: 20000 }, async () => {
  const f = await setup();
  const result = await execute(f, (n, wire) => {
    if (n === 1) return ['read_sheet', { sheetId: 'foreign' }];
    if (n === 2) { assert.match(wire.messages.findLast(m => m.role === 'tool').content, /invalid_read_arguments/); return read({ sheetId: 'foreign' }); }
    if (n === 3) { assert.match(wire.messages.findLast(m => m.role === 'tool').content, /read_sheet_not_found/); return edit([{ sheetId: 'sheet1', row: 0, column: 0, value: 9 }]); }
    assert.match(wire.messages.findLast(m => m.role === 'tool').content, /read_sheet_required/); return null;
  });
  assert.equal(result.current.contentRevision, 1); assert.equal(result.current.proposals.length, 0);
});

test('actual byte guard blocks the next fixture call before reservation/dispatch and exposes a technical limit without replay', { timeout: 20000 }, async () => {
  const f = await setup(), w = await f.workspace.get('owner', f.workId);
  w.book.sheets.sheet1.cellData = { 0: { 0: { v: '雪"\\'.repeat(12000) } } };
  await f.workspace.save('owner', f.workId, { commandId: 'seed', book: w.book, contentRevision: 1, permissionRevision: 1 });
  const result = await execute(f, n => { assert.equal(n, 1, 'oversized next call must never reach fixture fetch'); return read(); },
    { policyOverride: { ...policy, maxRequestBytes: 8000 } });
  assert.equal(result.wires.length, 1); assert.equal(result.reserves.length, 1); assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0].outcome, 'received');
  assert.equal(result.current.status, 'blocked'); assert.equal(result.current.errorCode, 'request_too_large');
  assert.equal(result.current.contentRevision, 2); assert.equal(result.job.status, 'blocked');
  assert.equal(await f.workspace.claim('owner'), null, 'no automatic replay of original command');
});
