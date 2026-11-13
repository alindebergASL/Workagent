import { CONTROL_RESOURCE, controlCells, sheetControls } from '../../../packages/workagent-contract/sheet-controls.mjs';
import { requireSheet } from '../../../packages/workagent-contract/document.mjs';
import { randomUUID } from 'node:crypto';
import { Fault, id, text, validateWorkbook, withoutFormulaResults } from '../../../packages/workagent-contract/index.mjs';
import { authorize, dedup, digest, event, work } from './workspace.mjs';
export const XLSX_BYTES = 2_000_000;
function decode(input, importing) {
  if (!input || Object.keys(input).some(k => !['commandId', 'filename', 'base64', 'synthetic'].includes(k)) || input.synthetic !== true) throw new Fault('invalid_xlsx_input', 400);
  text(input.filename, 200);
  if (!/\.xlsx$/i.test(input.filename) || /[\x00-\x1f\x7f]/.test(input.filename)) throw new Fault('choose_xlsx_file', 400);
  if (importing) id(input.commandId);
  if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(XLSX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) throw new Fault('invalid_xlsx_bytes', 400);
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.length > XLSX_BYTES || bytes.toString('base64') !== input.base64) throw new Fault('invalid_xlsx_bytes', 400);
  return bytes;
}
function validated(result, filename) {
  if (!Array.isArray(result.warnings) || result.warnings.length > 100 || result.warnings.some(w => typeof w !== 'string' || w.length > 500)) throw new Fault('invalid_xlsx_result', 400);
  const book = validateWorkbook({ ...result.book, name: filename });
  return { ...result, book: withoutFormulaResults(book) };
}
function importedHumanCells(book) {
  const anchors = new Set(); let mergedArea = 0, stored = 0, mergeCount = 0;
  for (const sid of book.sheetOrder) {
    const sheet = book.sheets[sid];
    for (const [r, cells] of Object.entries(sheet.cellData ?? {})) for (const c of Object.keys(cells)) {
      if (++stored > 50_000) throw new Fault('invalid_xlsx_result', 400);
      anchors.add(`${sid}:${r}:${c}`);
    }
    const merges = sheet.mergeData ?? [];
    if (!Array.isArray(merges) || (mergeCount += merges.length) > 1000) throw new Fault('invalid_xlsx_result', 400);
    for (const {startRow, endRow, startColumn, endColumn} of merges) {
      if (![startRow, endRow, startColumn, endColumn].every(Number.isSafeInteger)
        || startRow < 0 || startRow > endRow || endRow >= Math.min(sheet.rowCount, 10_000)
        || startColumn < 0 || startColumn > endColumn || endColumn >= Math.min(sheet.columnCount, 200)) throw new Fault('invalid_xlsx_result', 400);
      mergedArea += (endRow-startRow+1)*(endColumn-startColumn+1);
      if (mergedArea > 50_000) throw new Fault('invalid_xlsx_result', 400);
      for (let r=startRow; r<=endRow; r++) for (let c=startColumn; c<=endColumn; c++) anchors.add(`${sid}:${r}:${c}`);
    }
  }
  for (const anchor of controlCells(book).keys()) anchors.add(anchor);
  return [...anchors];
}
export class XlsxExchange {
  constructor({ workspace, files, worker }) { this.store = workspace.store; this.files = files; this.worker = worker; }
  async grant(principal, expected, workId) {
    return this.store.transaction(s => {
      authorize(s, principal); if (workId) requireSheet(work(s, workId));
      if (expected !== undefined && s.permissionRevision !== expected) throw new Fault('access_changed', 403);
      return s.permissionRevision;
    });
  }
  async preview(principal, input) {
    const grant = await this.grant(principal), bytes = decode(input, false);
    const result = validated(await this.worker.run({ op: 'import', base64: input.base64 }), input.filename);
    await this.grant(principal, grant);
    return { filename: input.filename, bytes: bytes.length, cells: result.cells, warnings: result.warnings, sheets: result.book.sheetOrder.map(key => {
      const sheet = result.book.sheets[key];
      return { name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount, sample: Object.entries(sheet.cellData).slice(0, 8).map(([r, cells]) => ({ row: +r + 1, values: Object.entries(cells).slice(0, 12).map(([c, cell]) => ({ column: +c + 1, value: String(cell.f ?? cell.v ?? '').slice(0, 200) })) })) };
    }) };
  }
  async import(principal, input) {
    const grant = await this.grant(principal), bytes = decode(input, true), command = { operation: 'xlsx-import', ...input };
    const replay = await this.store.transaction(s => {
      authorize(s, principal); const old = s.commands[input.commandId];
      if (old && old.hash !== digest(command)) throw new Fault('command_conflict');
      return old?.result ?? null;
    });
    if (replay) return replay;
    const { book, warnings } = validated(await this.worker.run({ op: 'import', base64: input.base64 }), input.filename);
    const humanCells = importedHumanCells(book);
    await this.grant(principal, grant);
    const blob = await this.files.writeOriginal(principal, bytes, 'xlsx');
    return this.store.transaction(s => {
      authorize(s, principal);
      return dedup(s, input.commandId, command, () => {
        if (s.permissionRevision !== grant) throw new Fault('access_changed', 403);
        const workId = randomUUID(), original = { id: randomUUID(), format: 'xlsx', filename: input.filename, encoding: 'XLSX (ZIP/XML)', size: blob.bytes, hash: blob.hash, owner: principal, warnings };
        book.id = workId;
        // Resource ranges may carry a workbook identity. Rebind only the
        // validated control resource, never opaque plugin data.
        const controls = sheetControls(book);
        for (const rules of Object.values(controls)) for (const rule of rules) for (const range of rule.ranges) {
          if (range.unitId !== undefined) range.unitId = workId;
        }
        const resource = book.resources?.find(r => r.name === CONTROL_RESOURCE);
        if (resource) resource.data = JSON.stringify(controls);
        validateWorkbook(book);
        const w = { id: workId, book, original, contentRevision: 1, intentRevision: 0, cancellationEpoch: 0, messages: [], proposals: [], humanCells, sourceIds: [], status: 'ready' };
        s.works[workId] = w; event(s, w, 'human_imported');
        return { workId, original, contentRevision: 1 };
      });
    });
  }
  async export(principal, input) {
    const grant = await this.grant(principal, undefined, id(input?.workId));
    if (Object.keys(input).some(k => !['workId', 'book'].includes(k))) throw new Fault('invalid_xlsx_input', 400);
    const book = withoutFormulaResults(validateWorkbook(input.book));
    if (book.id !== input.workId) throw new Fault('invalid_workbook', 400);
    if (Object.values(sheetControls(book)).some(rules => rules.some(rule => rule.type !== 'list'))) throw new Fault('xlsx_controls_not_supported', 400);
    const result = await this.worker.run({ op: 'export', book });
    await this.grant(principal, grant, input.workId);
    decode({ filename: 'export.xlsx', base64: result.base64, synthetic: true }, false);
    return { ...result, filename: book.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180) + '.xlsx' };
  }
}
