import { randomUUID } from 'node:crypto';
import { id, withoutFormulaResults } from '../../../packages/workagent-contract/index.mjs';

// Budget the JSON string as it appears inside tool events / provider messages,
// including its second layer of escaping. The existing whole-request guard stays.
export const SHEET_READ_BYTES = 24_000;
export const SHEET_READ_CELLS = 128;
export const escapedBytes = value => Buffer.byteLength(JSON.stringify(JSON.stringify(value)));
const own = (object, key) => Object.hasOwn(object ?? {}, key);
const fail = code => { throw new Error(code); };
function keys(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(k => !allowed.includes(k))) fail(code);
}
const revisionKeys = ['contentRevision', 'intentRevision', 'permissionRevision', 'cancellationEpoch'];
function sameRevision(a, b) { return revisionKeys.every(k => a[k] === b[k]); }
function rangeFor(sheet, range) {
  if (range === undefined) return { startRow: 0, endRow: sheet.rowCount - 1, startColumn: 0, endColumn: sheet.columnCount - 1 };
  const names = ['startRow', 'endRow', 'startColumn', 'endColumn'];
  keys(range, names, 'invalid_read_range');
  if (names.some(k => !Number.isSafeInteger(range[k]) || range[k] < 0)
      || range.startRow > range.endRow || range.startColumn > range.endColumn
      || range.endRow >= sheet.rowCount || range.endColumn >= sheet.columnCount) fail('invalid_read_range');
  return { ...range };
}
function entries(sheet) {
  const result = [];
  for (const [r, row] of Object.entries(sheet.cellData ?? {})) for (const [c, cell] of Object.entries(row)) {
    if (!/^(0|[1-9]\d*)$/.test(r) || !/^(0|[1-9]\d*)$/.test(c)
        || +r >= sheet.rowCount || +c >= sheet.columnCount) fail('invalid_saved_cell_address');
    result.push({ row: +r, column: +c, cell });
  }
  return result.sort((a, b) => a.row - b.row || a.column - b.column);
}
function cellContent(cell) {
  // Native formula/shared-formula identity survives; untrusted caches do not.
  const fields = cell?.f || cell?.si ? ['f', 'si'] : ['v', 't', 'p'];
  return Object.fromEntries(fields.filter(k => own(cell, k)).map(k => [k, cell[k]]));
}

// One reader per running job. Opaque cursors are never interpreted as paths,
// selectors or authority; another job cannot use them, including in the same work.
export function createSheetReader(workId, selection) {
  const cursors = new Map();
  return function read(w, query) {
    if (w.id !== workId) fail('read_work_mismatch');
    let q = {};
    if (query !== undefined) {
      if (typeof query !== 'string') fail('invalid_read_query');
      try { q = JSON.parse(query); } catch { fail('invalid_read_query'); }
    }
    keys(q, ['sheetId', 'range', 'cursor', 'expected', 'overview'], 'invalid_read_query');
    if (own(q, 'expected')) {
      keys(q.expected, revisionKeys, 'invalid_read_revision');
      if (revisionKeys.some(k => !Number.isSafeInteger(q.expected[k]) || q.expected[k] < 0)) fail('invalid_read_revision');
      if (!sameRevision(q.expected, w.expected)) fail('read_revision_changed_restart');
    }
    if (own(q, 'overview') && typeof q.overview !== 'boolean') fail('invalid_read_query');
    if (own(q, 'range') && !own(q, 'sheetId')) fail('read_range_requires_sheet');
    let state;
    if (own(q, 'cursor')) {
      if (Object.keys(q).length !== 1 || typeof q.cursor !== 'string' || !cursors.has(q.cursor)) fail('invalid_read_cursor');
      state = cursors.get(q.cursor);
      if (!sameRevision(state.expected, w.expected)) fail('read_cursor_stale_restart');
    }
    if (own(q, 'sheetId')) {
      id(q.sheetId);
      if (!w.book.sheetOrder.includes(q.sheetId) || !own(w.book.sheets, q.sheetId)) fail('read_sheet_not_found');
    }
    if (q.overview && (own(q, 'sheetId') || own(q, 'range'))) fail('invalid_read_query');
    const tabs = w.book.sheetOrder.map(sid => {
      const sheet = w.book.sheets[sid], cells = entries(sheet);
      return { sheet, cells, info: { id: sid, name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount,
        storedCells: cells.length, populatedCells: cells.filter(({ cell: c }) => c?.f || c?.si || c?.p?.body?.dataStream || c?.v != null && c.v !== '').length,
        formulaCells: cells.filter(({ cell: c }) => c?.f || c?.si).length,
        usedRange: cells.length ? { startRow: cells[0].row, endRow: cells.at(-1).row,
          startColumn: cells.reduce((n, c) => Math.min(n, c.column), Infinity), endColumn: cells.reduce((n, c) => Math.max(n, c.column), 0) } : null } };
    });
    const overview = { id: w.book.id, name: w.book.name, sheets: tabs.map(t => t.info),
      storedCells: tabs.reduce((n, t) => n + t.info.storedCells, 0),
      populatedCells: tabs.reduce((n, t) => n + t.info.populatedCells, 0),
      formulaCells: tabs.reduce((n, t) => n + t.info.formulaCells, 0), protectedCellCount: w.humanCells.length };
    const base = { expected: w.expected, overview, formulaResults: 'unknown; persisted formula caches omitted',
      limits: { escapedContentBytes: SHEET_READ_BYTES, storedCellsPerPage: SHEET_READ_CELLS } };
    // Preserve the old shape only when the entire response, including native
    // metadata and the protection map, fits the same byte budget.
    if (!Object.keys(q).length && overview.storedCells <= SHEET_READ_CELLS && w.humanCells.length <= SHEET_READ_CELLS) {
      const full = { ...base, book: withoutFormulaResults(w.book), protectedCells: w.humanCells, complete: true, workbookComplete: true, nextCursor: null };
      if (escapedBytes(full) <= SHEET_READ_BYTES) return JSON.stringify(full);
    }
    const result = { ...base, workbookComplete: false, complete: false,
      omissions: ['Workbook/tab/cell formatting and other native metadata are omitted; cell content includes v/t/p or f/si only.',
        'Protection is reported only for returned cells. All authoritative human protections still apply to edits.',
        'Sparse pages contain stored cells only. Unreturned cells are not inferred values. Follow nextCursor until complete, or read another sheetId/range.',
        'To combine independent reads at one snapshot, pass the exact expected object. Revision changes require a fresh read; do not combine stale pages.'],
      cells: [], nextCursor: null };
    if (q.overview) return JSON.stringify({ ...result, complete: true, coverage: 'overview only; no cells' });
    const selected = selection?.workId === workId && selection.contentRevision === w.expected.contentRevision
      && w.book.sheetOrder.includes(selection.sheetId) ? selection : null;
    const sheetId = state?.sheetId ?? q.sheetId ?? selected?.sheetId ?? w.book.sheetOrder[0];
    const tab = tabs.find(t => t.info.id === sheetId);
    const range = state?.range ?? rangeFor(tab.sheet, own(q, 'range') ? q.range : !q.sheetId ? selected?.range : undefined);
    const cells = tab.cells.filter(c => c.row >= range.startRow && c.row <= range.endRow && c.column >= range.startColumn && c.column <= range.endColumn);
    const protectedCells = new Set(w.humanCells);
    let index = state?.index ?? 0, offset = state?.offset ?? 0;
    result.sheetId = sheetId; result.range = range;
    result.rangeStoredCells = cells.length;
    result.rangeAbsentCells = (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) - cells.length;
    result.startStoredCell = index;
    // Reserve a real-sized continuation token while measuring candidate pages.
    const nextCursor = randomUUID(); result.nextCursor = nextCursor;
    while (index < cells.length && result.cells.length < SHEET_READ_CELLS) {
      const c = cells[index], content = cellContent(c.cell);
      const entry = { row: c.row, column: c.column, humanProtected: protectedCells.has(`${sheetId}:${c.row}:${c.column}`), cell: content };
      if (!offset && escapedBytes({ ...result, cells: [...result.cells, entry] }) <= SHEET_READ_BYTES) {
        result.cells.push(entry); index++; continue;
      }
      if (result.cells.length) break;
      // An individual cell can exceed the page budget. Return lossless chunks
      // of its JSON, explicitly NOT a complete value/formula. No invented cells.
      const serialized = JSON.stringify(content);
      const fragment = end => ({ row: c.row, column: c.column, humanProtected: entry.humanProtected,
        fragment: { encoding: 'cell-content-json', offset, totalCodeUnits: serialized.length, text: serialized.slice(offset, end), complete: end === serialized.length } });
      let low = offset, high = serialized.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (escapedBytes({ ...result, cells: [fragment(mid)] }) <= SHEET_READ_BYTES) low = mid; else high = mid - 1;
      }
      if (low < serialized.length && /[\uD800-\uDBFF]/.test(serialized[low - 1])) low--;
      if (low === offset) fail('read_metadata_exceeds_limit');
      result.cells.push(fragment(low)); offset = low;
      if (offset === serialized.length) { index++; offset = 0; }
      break;
    }
    result.complete = index === cells.length;
    if (result.complete) result.nextCursor = null;
    else cursors.set(nextCursor, { expected: { ...w.expected }, sheetId, range, index, offset });
    if (escapedBytes(result) > SHEET_READ_BYTES) fail('read_metadata_exceeds_limit');
    return JSON.stringify(result);
  };
}
