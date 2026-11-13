export class Fault extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
export const id = value => {
  if (typeof value !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(value) || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Fault('invalid_id', 400);
  return value;
};
export const text = (value, max = 50000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Fault('invalid_text', 400);
  return value;
};
export const revision = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Fault('invalid_revision', 400);
  return value;
};
export function validateWorkbook(book) {
  if (!book || typeof book !== 'object' || JSON.stringify(book).length > 4_000_000) throw new Fault('invalid_workbook', 400);
  id(book.id); text(book.name, 200);
  if (!Array.isArray(book.sheetOrder) || book.sheetOrder.length < 1 || book.sheetOrder.length > 20 || new Set(book.sheetOrder).size !== book.sheetOrder.length) throw new Fault('invalid_sheets', 400);
  for (const key of book.sheetOrder) {
    id(key); const sheet = book.sheets?.[key];
    if (!sheet || sheet.id !== key) throw new Fault('invalid_sheet', 400);
    text(sheet.name, 100);
    if (!Number.isInteger(sheet.rowCount) || sheet.rowCount < 1 || sheet.rowCount > 10000 || !Number.isInteger(sheet.columnCount) || sheet.columnCount < 1 || sheet.columnCount > 200) throw new Fault('sheet_bounds', 400);
    for (const [row, cells] of Object.entries(sheet.cellData ?? {})) {
      if (!/^\d+$/.test(row) || +row >= sheet.rowCount) throw new Fault('cell_bounds', 400);
      for (const col of Object.keys(cells)) if (!/^\d+$/.test(col) || +col >= sheet.columnCount) throw new Fault('cell_bounds', 400);
    }
  }
  return structuredClone(book);
}
// Owner-save provenance only. Coordinates are row * 200 + column, matching
// workbook bounds; sparse numbers avoid carrying a second workbook in recovery.
export function validateFormatEdits(value, book) {
  if (value === undefined) return undefined; // Legacy clients have unknown provenance.
  const bad = () => { throw new Fault('invalid_format_edits', 400); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 20) bad();
  let count = 0;
  for (const [sid, cells] of Object.entries(value)) {
    const sheet = Object.hasOwn(book.sheets, sid) && book.sheets[sid];
    if (!book.sheetOrder.includes(sid) || !sheet || !Array.isArray(cells) || (count += cells.length) > 100000) bad();
    let last = -1;
    for (const cell of cells) {
      if (!Number.isSafeInteger(cell) || cell <= last || cell < 0 || Math.floor(cell / 200) >= sheet.rowCount || cell % 200 >= sheet.columnCount) bad();
      last = cell;
    }
  }
  return value;
}
export function blankWorkbook(workId, title = 'Working sheet') {
  return { id: workId, name: title, appVersion: '1.4.0', locale: 'enUS', styles: {}, sheetOrder: ['sheet1'], sheets: { sheet1: { id: 'sheet1', name: 'Sheet 1', rowCount: 200, columnCount: 26, cellData: {}, defaultColumnWidth: 110, defaultRowHeight: 24 } } };
}
export function validatePatch(patch) {
  if (!patch || !Array.isArray(patch.cells) || patch.cells.length > 2000) throw new Fault('invalid_patch', 400);
  if (patch.title !== undefined) text(patch.title, 200);
  if (patch.addSheets !== undefined && (!Array.isArray(patch.addSheets) || patch.addSheets.length > 10)) throw new Fault('invalid_sheets', 400);
  for (const sheet of patch.addSheets ?? []) { id(sheet.id); text(sheet.name, 100); }
  for (const c of patch.cells) {
    id(c.sheetId);
    if (!Number.isInteger(c.row) || c.row < 0 || c.row >= 10000 || !Number.isInteger(c.column) || c.column < 0 || c.column >= 200) throw new Fault('cell_bounds', 400);
    if (c.value !== null && !['string', 'number', 'boolean'].includes(typeof c.value)) throw new Fault('invalid_cell', 400);
    if (typeof c.value === 'string' && c.value.length > 20000 || typeof c.value === 'number' && !Number.isFinite(c.value)) throw new Fault('invalid_cell', 400);
    if (c.formula !== undefined && (typeof c.formula !== 'string' || !c.formula.startsWith('=') || c.formula.length > 4000)) throw new Fault('invalid_formula', 400);
  }
  return structuredClone(patch);
}
export function withoutFormulaResults(book) {
  const result = structuredClone(book);
  // No server-side dependency graph or cache provenance: results can depend on
  // other sheets and shared-formula anchors. Keep formula identity and style.
  for (const sheet of Object.values(result.sheets)) for (const row of Object.values(sheet.cellData ?? {})) for (const cell of Object.values(row)) {
    if (cell?.f || cell?.si) { delete cell.v; delete cell.t; }
  }
  return result;
}
export function applyPatch(book, patch) {
  // Omit derived results until the native engine calculates again; readers
  // must not mistake a pre-patch cached value for the current result.
  const result = withoutFormulaResults(book);
  if (patch.title) result.name = patch.title;
  for (const s of patch.addSheets ?? []) {
    if (result.sheets[s.id]) throw new Fault('sheet_exists');
    result.sheetOrder.push(s.id);
    result.sheets[s.id] = { ...s, rowCount: 200, columnCount: 26, cellData: {} };
  }
  for (const c of patch.cells) {
    const sheet = result.sheets[c.sheetId];
    if (!sheet) throw new Fault('sheet_not_found', 404);
    sheet.rowCount = Math.max(sheet.rowCount, c.row + 1); sheet.columnCount = Math.max(sheet.columnCount, c.column + 1);
    sheet.cellData ??= {}; sheet.cellData[c.row] ??= {};
    const cell = { ...(sheet.cellData[c.row][c.column] ?? {}), v: c.value };
    delete cell.f; delete cell.si; delete cell.p;
    if (c.formula) { cell.f = c.formula; delete cell.v; delete cell.t; }
    else { cell.t = typeof c.value === 'number' ? 2 : typeof c.value === 'boolean' ? 3 : 1; }
    sheet.cellData[c.row][c.column] = cell;
  }
  return validateWorkbook(result);
}
export const anchor = c => `${c.sheetId}:${c.row}:${c.column}`;
