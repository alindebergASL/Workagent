import { workKind, documentSelectionText } from '../../../packages/workagent-contract/document.mjs';
import { Fault } from '../../../packages/workagent-contract/index.mjs';

export function cellAddress(row, column) {
  let label = '';
  for (column++; column; column = Math.floor((column - 1) / 26)) label = String.fromCharCode(65 + (column - 1) % 26) + label;
  return `${label}${row + 1}`;
}

// Resolve only against the owned workbook inside command admission. Client labels,
// cell contents and purported source/overwrite permissions are never authoritative.
export function bindSelection(w, selection, kind) {
  if (kind !== 'continue' || !selection || selection.workId !== w.id) throw new Fault('invalid_selection', 400);
  if (!Number.isSafeInteger(selection.contentRevision) || selection.contentRevision !== w.contentRevision) throw new Fault('selection_conflict');
  if (selection.kind === 'document') {
    if (workKind(w) !== 'document' || selection.documentId !== w.id || w.document?.id !== w.id
      || Object.keys(selection).some(k => !['kind', 'workId', 'documentId', 'contentRevision', 'segmentId', 'startOffset', 'endOffset'].includes(k))) throw new Fault('invalid_document_selection', 400);
    const quote = documentSelectionText(w.document, selection);
    return { kind: 'document', workId: w.id, documentId: w.document.id, contentRevision: w.contentRevision,
      segmentId: '', startOffset: selection.startOffset, endOffset: selection.endOffset, title: w.document.title, quote };
  }
  if (workKind(w) !== 'sheet' || (selection.kind !== undefined && selection.kind !== 'sheet')
    || ['documentId', 'segmentId', 'startOffset', 'endOffset', 'quote'].some(k => Object.hasOwn(selection, k))) throw new Fault('invalid_selection', 400);
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
  const bound = { workId: w.id, contentRevision: w.contentRevision, sheetId: sheet.id, sheetName: sheet.name, range: { ...r }, rangeLabel: `${cellAddress(r.startRow, r.startColumn)}:${cellAddress(r.endRow, r.endColumn)}`, cells };
  if (Buffer.byteLength(JSON.stringify(bound), 'utf8') > 200000) throw new Fault('invalid_selection', 400);
  return bound;
}
