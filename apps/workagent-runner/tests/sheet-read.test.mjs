// Local fixtures only. No provider, browser, database, native calculation or cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankWorkbook, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CHART_RESOURCE, withCharts } from '../../../packages/workagent-contract/sheet-charts.mjs';
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
  assert.deepEqual([...first.cells, ...next.cells].map(c => c.address), Array.from({ length: 140 }, (_, row) => `A${row + 1}`));
  assert.equal(new Set([...first.cells, ...next.cells].map(c => `${c.row}:${c.column}`)).size, 140);
  assert.deepEqual(parse(reader, w, { cursor: first.nextCursor }), next, 'same cursor is repeatable');
  const other = parse(reader, w, { sheetId: 'other', range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 }, expected: first.expected });
  assert.equal(other.complete, true); assert.equal(other.rangeStoredCells, 2); assert.equal(other.rangeAbsentCells, 4);
  assert.equal(other.cells[0].cell.v, undefined); assert.ok(other.cells[0].cell.f);
  assert.equal(other.cells[1].cell.v, undefined); assert.equal(other.cells[1].cell.si, 'shared');
  const overview = parse(reader, w, { overview: true });
  assert.equal(overview.complete, true); assert.equal(overview.workbookComplete, false); assert.deepEqual(overview.cells, []);
});

test('A1 addresses identify absolute sparse coordinates across column boundaries and offset ranges', () => {
  const w = fixture(), sheet = w.book.sheets.sheet1;
  sheet.rowCount = 10000; sheet.columnCount = 200;
  sheet.cellData = { 0: { 0: { v: 'first' }, 25: { v: 'last single letter' }, 26: { v: 'first double letter' } },
    2: { 25: { v: 21 }, 26: { v: 43 } }, 9: { 51: { v: false }, 52: { f: '=Z3+AA3', v: 999 } }, 9999: { 199: { v: 'last' } } };
  const reader = createSheetReader(w.id), all = parse(reader, w, { sheetId: 'sheet1' });
  assert.deepEqual(all.cells.map(c => [c.row, c.column, c.address]),
    [[0, 0, 'A1'], [0, 25, 'Z1'], [0, 26, 'AA1'], [2, 25, 'Z3'], [2, 26, 'AA3'], [9, 51, 'AZ10'], [9, 52, 'BA10'], [9999, 199, 'GR10000']]);
  const page = parse(reader, w, { sheetId: 'sheet1', range: { startRow: 2, endRow: 9, startColumn: 25, endColumn: 52 } });
  assert.deepEqual(page.cells.map(c => [c.address, c.cell]), [['Z3', { v: 21 }], ['AA3', { v: 43 }], ['AZ10', { v: false }], ['BA10', { f: '=Z3+AA3' }]]);
  assert.equal(page.rangeStoredCells, 4); assert.equal(page.rangeAbsentCells, 220);
  assert.equal(page.complete, true); assert.equal(page.workbookComplete, false);
});

test('addresses and escaped overview metadata fit the byte cap before the cell-count limit', () => {
  const w = fixture(), value = 'x'.repeat(180);
  w.book.name = '雪"\\'.repeat(60);
  for (let row = 0; row < 140; row++) w.book.sheets.sheet1.cellData[row] = { 0: { v: value } };
  const reader = createSheetReader(w.id), cells = [];
  let page = parse(reader, w, { sheetId: 'sheet1' }), pages = 0;
  assert.ok(page.cells.length > 0 && page.cells.length < SHEET_READ_CELLS);
  while (true) {
    assert.equal(page.overview.name, w.book.name);
    assert.ok(page.cells.length <= SHEET_READ_CELLS);
    cells.push(...page.cells); pages++;
    if (!page.nextCursor) break;
    assert.ok(pages < 10);
    page = parse(reader, w, { cursor: page.nextCursor });
  }
  assert.equal(cells.length, 140); assert.ok(pages > 1);
  for (const [row, entry] of cells.entries()) {
    assert.equal(entry.row, row); assert.equal(entry.column, 0); assert.equal(entry.address, `A${row + 1}`);
    assert.deepEqual(entry.cell, { v: value });
  }
  const overview = parse(reader, w, { overview: true });
  assert.deepEqual(overview.cells, []); assert.equal(overview.overview.name, w.book.name);
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
  w.book.sheets.sheet1.columnCount = 60;
  w.book.sheets.sheet1.cellData = { 9: { 26: { v: value, t: 1, custom: 'omitted native metadata'.repeat(10000) } }, 20: { 52: { f: '=AA10', v: 'DO NOT LEAK'.repeat(20000), t: 1 } } };
  w.book.styles = { huge: 'formatting'.repeat(100000) };
  w.humanCells = Array.from({ length: 10000 }, (_, i) => `sheet1:${i}:0`);
  w.humanCells.push('sheet1:9:26');
  const reader = createSheetReader(w.id); let page = parse(reader, w), assembled = '', fragments = 0;
  while (true) {
    assert.equal(page.protectedCells, undefined); assert.equal(page.book, undefined);
    assert.ok(!JSON.stringify(page).includes('DO NOT LEAK'));
    for (const entry of page.cells) if (entry.row === 9) {
      assert.equal(entry.column, 26); assert.equal(entry.address, 'AA10'); assert.equal(entry.humanProtected, true);
      assert.equal(entry.cell, undefined); assert.equal(entry.fragment.offset, assembled.length);
      assert.ok(!/[\uD800-\uDBFF]$/.test(entry.fragment.text));
      assembled += entry.fragment.text; fragments++;
      if (entry.fragment.complete) assert.deepEqual(JSON.parse(assembled), { v: value, t: 1 });
    } else {
      assert.equal(entry.row, 20); assert.equal(entry.column, 52); assert.equal(entry.address, 'BA21');
      assert.deepEqual(entry.cell, { f: '=AA10' });
    }
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

const chart = (range, extra = {}) => ({ id: 'chart-1', title: 'Saved chart title', type: 'bar', sheetId: 'sheet1', range, ...extra });
const originRange = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };
const originSource = {
  rangeA1: 'A1:C4', headerRangeA1: 'A1:C1',
  labels: { headerCell: 'A1', dataRangeA1: 'A2:A4' }, seriesCount: 2,
  series: [{ headerCell: 'B1', dataRangeA1: 'B2:B4' }, { headerCell: 'C1', dataRangeA1: 'C2:C4' }],
};

test('chart read context explicitly includes both inclusive endpoints, all series and header coordinates in every read shape', () => {
  const w = { ...fixture(), book: withCharts(blankWorkbook('owned'), [chart(originRange)]), humanCells: ['sheet1:2:1'] };
  w.book.sheets.sheet1.cellData = { 0: { 0: { v: 'Label' }, 1: { v: 'Amount' }, 2: { f: '=A9', v: 'STALE HEADER', p: { body: { dataStream: 'STALE RICH HEADER' } } } },
    1: { 0: { v: 'One' }, 1: { v: 3 }, 2: { f: '=B2*2', v: 99999 } },
    2: { 1: { v: 4 } }, 3: { 2: { si: 'shared', v: 88888 } } };
  w.proposals = [{ id: 'retained-pending', status: 'pending' }];
  const original = structuredClone(w), reader = createSheetReader(w.id);
  for (const q of [undefined, { overview: true }, { sheetId: 'sheet1', range: originRange },
    { sheetId: 'sheet1', range: { startRow: 10, endRow: 10, startColumn: 0, endColumn: 0 } }]) {
    const result = parse(reader, w, q), { source, ...rawChart } = result.charts[0];
    assert.deepEqual(source, originSource); assert.deepEqual(rawChart, chart(originRange));
    assert.match(result.chartCoordinates, /zero-based.*inclusive/);
    assert.match(result.chartCoordinates, /header.*references.*not.*calculated/i);
    assert.match(result.chartEditing, /chartOps/); assert.match(result.chartEditing, /visible proposal, never applied until explicit human acceptance/);
    assert.doesNotMatch(JSON.stringify(source), /STALE HEADER|STALE RICH HEADER|99999|88888/);
    assert.doesNotMatch(JSON.stringify(result), /STALE HEADER|99999|88888/);
    if (result.book) assert.deepEqual(result.book.resources, original.book.resources);
    if (result.cells?.length) assert.equal(result.cells.find(c => c.address === 'B3').humanProtected, true);
  }
  assert.deepEqual(w, original, 'reads preserve resources, coordinates, protections and pending proposals');
});

test('chart source coordinates support offset ranges, AA columns, one through four series and 100 data rows', () => {
  const w = fixture(); w.book.sheets.sheet1.columnCount = 200;
  w.book = withCharts(w.book, [chart({ startRow: 4, endRow: 8, startColumn: 3, endColumn: 5 })]);
  const reader = createSheetReader(w.id);
  assert.deepEqual(parse(reader, w, { overview: true }).charts[0].source, {
    rangeA1: 'D5:F9', headerRangeA1: 'D5:F5', labels: { headerCell: 'D5', dataRangeA1: 'D6:D9' }, seriesCount: 2,
    series: [{ headerCell: 'E5', dataRangeA1: 'E6:E9' }, { headerCell: 'F5', dataRangeA1: 'F6:F9' }],
  });
  for (let count = 1; count <= 4; count++) {
    w.book = withCharts(w.book, [chart({ startRow: 4, endRow: 104, startColumn: 25, endColumn: 25 + count })]);
    const source = parse(reader, w, { overview: true }).charts[0].source;
    assert.equal(source.rangeA1, `Z5:${['AA', 'AB', 'AC', 'AD'][count - 1]}105`);
    assert.equal(source.headerRangeA1, `Z5:${['AA', 'AB', 'AC', 'AD'][count - 1]}5`);
    assert.deepEqual(source.labels, { headerCell: 'Z5', dataRangeA1: 'Z6:Z105' });
    assert.equal(source.seriesCount, count);
    assert.deepEqual(source.series, ['AA', 'AB', 'AC', 'AD'].slice(0, count).map(c => ({ headerCell: `${c}5`, dataRangeA1: `${c}6:${c}105` })));
  }
});

test('zero charts remain explicit and invalid chart bounds never acquire plausible source descriptors', () => {
  const w = fixture(), reader = createSheetReader(w.id);
  assert.deepEqual(parse(reader, w, { overview: true }).charts, []);
  for (const range of [{ ...originRange, endColumn: 0 }, { ...originRange, endColumn: 5 },
    { ...originRange, endRow: 101 }, { ...originRange, startRow: -1 }, { ...originRange, endColumn: 2.5 }]) {
    w.book.resources = [{ name: CHART_RESOURCE, data: JSON.stringify([chart(range)]) }];
    assert.throws(() => reader(w, JSON.stringify({ overview: true })), /invalid_sheet_charts/);
  }
});

test('eight charts with maximal Unicode metadata fit empty overview and preserve paged/fragmented cells within the byte cap', t => {
  const w = { ...fixture(), book: blankWorkbook('owned'), humanCells: [] };
  const unicode = '\uFFFF';
  w.book.id = 'w'.repeat(100); w.book.name = unicode.repeat(200); w.book.sheetOrder = []; w.book.sheets = {};
  for (let i = 0; i < 20; i++) {
    const sid = `s${i}`.padEnd(100, 'x'); w.book.sheetOrder.push(sid);
    w.book.sheets[sid] = { id: sid, name: unicode.repeat(100), rowCount: 10000, columnCount: 200, cellData: {} };
  }
  const sid = w.book.sheetOrder[0];
  w.book = withCharts(w.book, Array.from({ length: 8 }, (_, i) => chart(
    { startRow: 9899, endRow: 9999, startColumn: 195, endColumn: 199 },
    { id: `c${i}`.padEnd(100, 'x'), title: unicode.repeat(160), sheetId: sid })));
  validateWorkbook(w.book);
  const reader = createSheetReader(w.id), overview = parse(reader, w, { overview: true });
  assert.equal(overview.charts.length, 8); assert.deepEqual(overview.cells, []);
  for (const c of overview.charts) { assert.equal(c.source.seriesCount, 4); assert.equal(c.source.rangeA1, 'GN9900:GR10000'); }
  const escaped = structuredClone(w); escaped.book.name = '\uD800'.repeat(200);
  for (const sheet of Object.values(escaped.book.sheets)) sheet.name = '\u0000'.repeat(100);
  const escapedCharts = JSON.parse(escaped.book.resources[0].data).map(c => ({ ...c, title: '\uD800'.repeat(160) }));
  escaped.book = withCharts(escaped.book, escapedCharts); validateWorkbook(escaped.book);
  const escapedOverview = parse(reader, escaped, { overview: true });
  assert.deepEqual(escapedOverview.charts.map(({ source, ...raw }) => raw), escapedCharts);
  assert.deepEqual(escapedOverview.charts.map(c => c.source), overview.charts.map(c => c.source));
  assert.ok(escapedOverview.omissions.some(s => /display names.*omitted/.test(s)));
  const value = '雪🌍"\\\n'.repeat(3000);
  for (let row = 0; row < 140; row++) w.book.sheets[sid].cellData[row] = { 0: { v: row === 0 ? value : `row ${row}` } };
  const original = structuredClone(w); let page = parse(reader, w), assembled = '', ordinary = [], pages = 0;
  while (true) {
    assert.deepEqual(page.charts, overview.charts); assert.ok(page.cells.length <= SHEET_READ_CELLS);
    for (const c of page.cells) {
      if (c.fragment) { assert.equal(c.fragment.offset, assembled.length); assembled += c.fragment.text; }
      else ordinary.push(c);
    }
    pages++; assert.ok(pages < 100);
    if (!page.nextCursor) break;
    page = parse(reader, w, { cursor: page.nextCursor });
  }
  assert.ok(pages > 1); assert.deepEqual(JSON.parse(assembled), { v: value });
  assert.deepEqual(ordinary.map(c => c.address), Array.from({ length: 139 }, (_, i) => `A${i + 2}`));
  assert.equal(page.complete, true); assert.deepEqual(w, original);
  t.diagnostic(`Maximum Unicode overview ${escapedBytes(overview)} escaped bytes; escaped metadata overview ${escapedBytes(escapedOverview)}; ${pages} lossless cell pages.`);
});

test('chart descriptors add no cell scans or header evaluation to a bounded overview read', () => {
  const w = fixture(); let scans = 0, cellReads = 0;
  const cells = new Proxy(w.book.sheets.sheet1.cellData, { ownKeys(target) { scans++; return Reflect.ownKeys(target); },
    get(target, key) { cellReads++; return Reflect.get(target, key); } });
  w.book.sheets.sheet1.cellData = cells;
  const reader = createSheetReader(w.id); parse(reader, w, { overview: true });
  const baseline = { scans, cellReads }; scans = 0; cellReads = 0;
  w.book = withCharts(w.book, [chart(originRange)]);
  assert.deepEqual(parse(reader, w, { overview: true }).charts[0].source, originSource);
  assert.deepEqual({ scans, cellReads }, baseline);
});
