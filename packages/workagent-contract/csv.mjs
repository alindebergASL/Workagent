// CSV is data. No field becomes a formula, hyperlink, object key or instruction.
export const CSV_LIMITS = Object.freeze({ bytes: 1_000_000, rows: 10000, columns: 200, cells: 50000, field: 20000 });
export const CSV_POLICY = 'UTF-8 CSV; comma delimiter. Every field (including numbers, booleans and dates) imports as literal text. Leading zeros and whitespace are preserved. Ragged rows are padded with empty cells; empty files are refused. The first row is data, not special headers.';
export const CSV_LOSSES = 'CSV exports only the selected sheet’s values. Formatting, charts, comments, other tabs and formulas are lost. CSV has no cell types. Formula-like text is prefixed with an apostrophe for spreadsheet safety; this changes the exported text. Original bytes remain available separately.';
const fail = message => { throw new Error(message); };
export function parseCsv(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > CSV_LIMITS.bytes) fail('CSV exceeds the 1,000,000-byte limit.');
  let input; try { input = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('CSV must be valid UTF-8; no replacement or partial import was made.'); }
  if (!input.length) fail('CSV is empty. Choose a file with at least one field.');
  if (input.includes('\0')) fail('CSV contains a NUL byte; binary or damaged input is not supported.');
  const rows = []; let row = [], value = '', quoted = false, closed = false, atStart = true, columns = 0;
  const field = () => { if (value.length > CSV_LIMITS.field) fail('CSV field exceeds 20,000 characters.'); row.push(value); if (row.length > CSV_LIMITS.columns) fail('CSV exceeds 200 columns.'); value = ''; closed = false; atStart = true; };
  const record = () => { field(); columns = Math.max(columns, row.length); rows.push(row); row = []; if (rows.length > CSV_LIMITS.rows || rows.length * columns > CSV_LIMITS.cells) fail('CSV exceeds 10,000 rows or 50,000 rectangular cells.'); };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') { if (input[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else value += c;
    } else if (c === ',') field();
    else if (c === '\r' || c === '\n') { record(); if (c === '\r' && input[i + 1] === '\n') i++; }
    else if (c === '"' && atStart && !closed) { quoted = true; atStart = false; }
    else { if (closed || c === '"') fail('Malformed CSV quoting; nothing was imported.'); value += c; atStart = false; }
    if (value.length > CSV_LIMITS.field) fail('CSV field exceeds 20,000 characters.');
  }
  if (quoted) fail('CSV ends inside a quoted field; the file may be truncated.');
  if (row.length || value.length || closed || !/[\r\n]$/.test(input)) record();
  const raggedRows = rows.filter(r => r.length !== columns).length;
  for (const r of rows) while (r.length < columns) r.push('');
  return { rows, rowCount: rows.length, columns, raggedRows, encoding: bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 'UTF-8 with BOM' : 'UTF-8' };
}
export function csvWorkbook(parsed, workId, name) {
  const cellData = {};
  parsed.rows.forEach((row, r) => { cellData[r] = {}; row.forEach((v, c) => { cellData[r][c] = { v, t: 1 }; }); });
  return { id: workId, name, appVersion: '1.4.0', locale: 'enUS', styles: {}, sheetOrder: ['sheet1'], sheets: { sheet1: { id: 'sheet1', name: 'Imported CSV', rowCount: Math.max(200, parsed.rowCount), columnCount: Math.max(26, parsed.columns), cellData, defaultColumnWidth: 110, defaultRowHeight: 24 } } };
}
export function serializeCsv(book, sheetId) {
  const sheet = book.sheets?.[sheetId]; if (!sheet || !book.sheetOrder.includes(sheetId)) fail('Select a sheet before exporting.');
  let lastRow = -1, lastCol = -1, neutralized = 0, unknown = 0;
  for (const [r, cells] of Object.entries(sheet.cellData ?? {})) for (const [c, cell] of Object.entries(cells)) {
    if (cell && (cell.v != null || cell.f || cell.si || cell.p)) { lastRow = Math.max(lastRow, Number(r)); lastCol = Math.max(lastCol, Number(c)); }
  }
  if (lastRow >= CSV_LIMITS.rows || lastCol >= CSV_LIMITS.columns || (lastRow + 1) * (lastCol + 1) > CSV_LIMITS.cells) fail('Selected sheet exceeds the CSV limit of 10,000 rows, 200 columns or 50,000 rectangular cells.');
  const quote = value => '"' + value.replaceAll('"', '""') + '"';
  const lines = []; let size = 0;
  for (let r = 0; r <= lastRow; r++) {
    const fields = [];
    for (let c = 0; c <= lastCol; c++) {
      const cell = sheet.cellData?.[r]?.[c]; let v = cell?.v;
      if ((cell?.f || cell?.si) && v == null) { v = '#UNKNOWN!'; unknown++; }
      else if (cell?.p?.body?.dataStream && !(cell.f || cell.si)) v = cell.p.body.dataStream.replace(/\r\n$/, '');
      if (cell?.t === 3 && (v === 0 || v === 1 || typeof v === 'boolean')) v = v ? 'TRUE' : 'FALSE';
      if (typeof v === 'number') { if (!Number.isFinite(v)) fail('A cell has a non-finite value; export was refused.'); fields.push(String(v)); }
      else {
        let s = v == null ? '' : String(v);
        if (s.includes('\0')) fail('A cell contains NUL; binary text cannot be exported as supported CSV.');
        // Include ASCII controls, Unicode whitespace and invisible format prefixes.
        if (/^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(s)) { s = "'" + s; neutralized++; }
        if (s.length > CSV_LIMITS.field) fail('An exported field exceeds 20,000 characters.');
        fields.push(quote(s));
      }
    }
    const line = fields.join(',') + '\r\n'; size += new TextEncoder().encode(line).length;
    if (size > CSV_LIMITS.bytes) fail('CSV export exceeds 1,000,000 bytes; nothing was downloaded.');
    lines.push(line);
  }
  if (lastRow < 0) fail('The selected sheet is empty.');
  return { csv: lines.join(''), sheetName: sheet.name, neutralized, unknown, rows: lastRow + 1, columns: lastCol + 1 };
}
