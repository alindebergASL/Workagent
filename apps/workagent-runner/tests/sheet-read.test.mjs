// Local fixtures only. No provider, browser, database, native calculation or cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { createSheetReader, escapedBytes, SHEET_READ_BYTES, SHEET_READ_CELLS } from '../src/sheet-read.mjs';

function fixture() {
  const w = { id: 'owned', book: blankWorkbook('owned'), humanCells: [], expected: { contentRevision: 4, intentRevision: 1, permissionRevision: 1, cancellationEpoch: 0 } };
  for (let r = 0; r < 140; r++) w.book.sheets.sheet1.cellData[r] = { 0: { v: `row ${r}`, t: 1 } };
  w.book.sheetOrder.push('other');
  w.book.sheets.other = { id: 'other', name: 'Other tab', rowCount: 200, columnCount: 5, cellData: { 0: { 0: { f: '=SUM(\'Sheet 1\'!A1:A5)', v: 9999, t: 2 }, 1: { si: 'shared', v: 8888, t: 2 } } } };
  w.humanCells = ['sheet1:139:0', 'other:0:0'];
  return w;
}
const parse = (reader, w, q) => {
  const raw = reader(w, q === undefined ? undefined : JSON.stringify(q));
  const value = JSON.parse(raw);
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) <= SHEET_READ_BYTES);
  assert.ok(escapedBytes(value) <= SHEET_READ_BYTES);
  return value;
};

test('small native book retains complete old shape, strips formula caches, never mutates source', () => {
  const w = fixture(); w.book.sheetOrder = ['other']; delete w.book.sheets.sheet1;
  const original = structuredClone(w), read = parse(createSheetReader(w.id), w);
  assert.equal(read.workbookComplete, true); assert.equal(read.complete, true);
  assert.equal(read.book.sheets.other.cellData[0][0].f, '=SUM(\'Sheet 1\'!A1:A5)');
  assert.equal(read.book.sheets.other.cellData[0][0].v, undefined);
  assert.equal(read.book.sheets.other.cellData[0][1].v, undefined);
  assert.deepEqual(read.protectedCells, w.humanCells); assert.deepEqual(w, original);
});

test('sparse continuation covers exact range with no duplicate cells, full-map leak or false full-book claim', () => {
  const w = fixture(), reader = createSheetReader(w.id), first = parse(reader, w);
  assert.equal(first.cells.length, SHEET_READ_CELLS); assert.equal(first.complete, false);
  assert.equal(first.workbookComplete, false); assert.equal(first.protectedCells, undefined);
  assert.equal(first.overview.storedCells, 142); assert.equal(first.overview.formulaCells, 2);
  assert.deepEqual(first.overview.sheets.map(s => s.id), ['sheet1', 'other']);
  assert.equal(first.cells.some(c => c.humanProtected), false);
  const next = parse(reader, w, { cursor: first.nextCursor });
  assert.equal(next.complete, true); assert.equal(next.nextCursor, null); assert.equal(next.startStoredCell, 128);
  assert.equal(next.cells.at(-1).humanProtected, true);
  assert.equal(new Set([...first.cells, ...next.cells].map(c => `${c.row}:${c.column}`)).size, 140);
  assert.deepEqual(parse(reader, w, { cursor: first.nextCursor }), next, 'same cursor is repeatable');
  const other = parse(reader, w, { sheetId: 'other', range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 }, expected: first.expected });
  assert.equal(other.complete, true); assert.equal(other.rangeStoredCells, 2); assert.equal(other.rangeAbsentCells, 4);
  assert.equal(other.cells[0].cell.v, undefined); assert.ok(other.cells[0].cell.f);
  assert.equal(other.cells[1].cell.v, undefined); assert.equal(other.cells[1].cell.si, 'shared');
  const overview = parse(reader, w, { overview: true });
  assert.equal(overview.complete, true); assert.equal(overview.workbookComplete, false); assert.deepEqual(overview.cells, []);
});

test('attached selection guides a fresh bounded default but does not constrain navigation', () => {
  const w = fixture(), range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
  const reader = createSheetReader(w.id, { workId: w.id, sheetId: 'other', contentRevision: 4, range });
  const selected = parse(reader, w); assert.equal(selected.sheetId, 'other'); assert.equal(selected.cells.length, 1);
  assert.equal(parse(reader, w, { sheetId: 'sheet1' }).sheetId, 'sheet1');
  w.expected.contentRevision++;
  assert.equal(parse(reader, w).sheetId, 'sheet1', 'stale selection does not silently bind current coordinates');
});

test('revision and job/work isolation refuse stale, foreign or forged continuations', () => {
  const w = fixture(), reader = createSheetReader(w.id), page = parse(reader, w);
  assert.throws(() => createSheetReader(w.id)(w, JSON.stringify({ cursor: page.nextCursor })), /invalid_read_cursor/);
  assert.throws(() => reader({ ...w, id: 'foreign' }), /read_work_mismatch/);
  for (const key of Object.keys(w.expected)) {
    const changed = { ...w, expected: { ...w.expected, [key]: w.expected[key] + 1 } };
    assert.throws(() => reader(changed, JSON.stringify({ cursor: page.nextCursor })), /read_cursor_stale_restart/);
    assert.throws(() => reader(changed, JSON.stringify({ sheetId: 'other', expected: page.expected })), /read_revision_changed_restart/);
  }
});

test('invalid selectors, unknown fields, bounds and prototype/path tricks refuse explicitly', () => {
  const w = fixture(), reader = createSheetReader(w.id);
  for (const q of [null, [], 2, { unknown: true }, { workId: 'foreign' }, { sheetId: 'missing' }, { sheetId: '__proto__' }, { sheetId: 'constructor' }, { sheetId: '../sheet1' },
    { range: {} }, { sheetId: 'sheet1', range: null }, { sheetId: 'sheet1', range: {} },
    { sheetId: 'sheet1', range: { startRow: -1, endRow: 1, startColumn: 0, endColumn: 1 } },
    { sheetId: 'sheet1', range: { startRow: 0.5, endRow: 1, startColumn: 0, endColumn: 1 } },
    { sheetId: 'sheet1', range: { startRow: 2, endRow: 1, startColumn: 0, endColumn: 1 } },
    { sheetId: 'sheet1', range: { startRow: 0, endRow: 200, startColumn: 0, endColumn: 1 } },
    { sheetId: 'sheet1', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 26 } },
    { sheetId: 'sheet1', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0, extra: 0 } },
    { expected: {} }, { expected: { ...w.expected, extra: 0 } }, { overview: 'yes' }, { overview: true, sheetId: 'other' },
    { cursor: '../foreign' }, { cursor: null }]) assert.throws(() => reader(w, JSON.stringify(q)), undefined, JSON.stringify(q));
  assert.throws(() => reader(w, '{"__proto__":{"sheetId":"other"}}'), /invalid_read_query/);
  assert.throws(() => reader(w, '{'), /invalid_read_query/);
  const page = parse(reader, w);
  assert.throws(() => reader(w, JSON.stringify({ cursor: page.nextCursor, sheetId: 'other' })), /invalid_read_cursor/);
});

test('huge Unicode/escaped cell content is explicitly fragmented, lossless and never a cached formula value', () => {
  const w = fixture(); w.book.sheetOrder = ['sheet1'];
  const value = '雪🌍"\\\n\u0000'.repeat(11000);
  w.book.sheets.sheet1.cellData = { 0: { 0: { v: value, t: 1, custom: 'omitted native metadata'.repeat(10000) } }, 1: { 0: { f: '=A1', v: 'DO NOT LEAK'.repeat(20000), t: 1 } } };
  w.book.styles = { huge: 'formatting'.repeat(100000) };
  w.humanCells = Array.from({ length: 10000 }, (_, i) => `sheet1:${i}:0`);
  const reader = createSheetReader(w.id); let page = parse(reader, w), assembled = '', fragments = 0;
  while (true) {
    assert.equal(page.protectedCells, undefined); assert.equal(page.book, undefined);
    assert.ok(!JSON.stringify(page).includes('DO NOT LEAK'));
    for (const entry of page.cells) if (entry.row === 0) {
      assert.equal(entry.cell, undefined); assert.equal(entry.fragment.offset, assembled.length);
      assert.ok(!/[\uD800-\uDBFF]$/.test(entry.fragment.text));
      assembled += entry.fragment.text; fragments++;
      if (entry.fragment.complete) assert.deepEqual(JSON.parse(assembled), { v: value, t: 1 });
    } else { assert.deepEqual(entry.cell, { f: '=A1' }); }
    if (!page.nextCursor) break;
    page = parse(reader, w, { cursor: page.nextCursor });
  }
  assert.ok(fragments > 1); assert.deepEqual(JSON.parse(assembled), { v: value, t: 1 });
  assert.equal(page.complete, true);
});

test('large native metadata alone falls back to a useful bounded read', () => {
  const w = fixture(); w.book.sheets.sheet1.cellData = { 0: { 0: { v: 'retained', custom: 'x'.repeat(500000) } } };
  w.book.styles = { blob: 'x'.repeat(500000) };
  const page = parse(createSheetReader(w.id), w);
  assert.equal(page.book, undefined); assert.equal(page.cells[0].cell.v, 'retained');
  assert.equal(page.cells[0].cell.custom, undefined); assert.ok(page.omissions.length);
});
