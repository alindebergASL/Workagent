import { requireSheet } from '../../../packages/workagent-contract/document.mjs';
import { Fault } from '../../../packages/workagent-contract/index.mjs';

// Resolve only against the owned workbook inside command admission. Client labels,
// cell contents and purported source/overwrite permissions are never authoritative.
export function bindSelection(w, selection, kind) {
  if (kind !== 'continue' || !selection || selection.workId !== w.id) throw new Fault('invalid_selection', 400);
  if (!Number.isSafeInteger(selection.contentRevision) || selection.contentRevision !== w.contentRevision) throw new Fault('selection_conflict');
  requireSheet(w);
  const sheet = w.book.sheetOrder.includes(selection.sheetId) && w.book.sheets[selection.sheetId];
  const r = selection.range;
  if (!sheet || !r || !['startRow', 'endRow', 'startColumn', 'endColumn'].every(k => Number.isSafeInteger(r[k]) && r[k] >= 0)
    || Object.keys(r).length !== 4 || selection.ranges !== undefined
    || r.startRow > r.endRow || r.startColumn > r.endColumn || r.endRow >= sheet.rowCount || r.endColumn >= sheet.columnCount
    || (r.endRow - r.startRow + 1) * (r.endColumn - r.startColumn + 1) > 2000) throw new Fault('invalid_selection', 400);
  const cells = [];
  for (let row = r.startRow; row <= r.endRow; row++) for (let column = r.startColumn; column <= r.endColumn; column++) {
    const c = sheet.cellData?.[row]?.[column];
    // Univer BOOLEAN (3) uses numeric 0/1; NUMBER (2) must remain numeric.
    // Match CSV's native boolean handling without interpreting text or caches.
    const value = c?.t === 3 && (c.v === 0 || c.v === 1 || typeof c.v === 'boolean') ? Boolean(c.v) : c?.v ?? null;
    cells.push({ row, column, ...(c?.f ? { formula: c.f } : c?.si ? { sharedFormula: c.si } : { value }), ...(c?.p?.body?.dataStream ? { text: c.p.body.dataStream } : {}) });
  }
  const col = n => { let label = ''; for (n++; n; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label; return label; };
  const bound = { workId: w.id, contentRevision: w.contentRevision, sheetId: sheet.id, sheetName: sheet.name, range: { ...r }, rangeLabel: `${col(r.startColumn)}${r.startRow + 1}:${col(r.endColumn)}${r.endRow + 1}`, cells };
  if (Buffer.byteLength(JSON.stringify(bound), 'utf8') > 200000) throw new Fault('invalid_selection', 400);
  return bound;
}
