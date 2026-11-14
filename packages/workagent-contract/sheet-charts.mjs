import { Fault, id } from './index.mjs';
export const CHART_RESOURCE = 'SHEET_WORKAGENT_CHARTS_PLUGIN';
export const CHART_LIMITS = Object.freeze({ charts: 8, points: 100, series: 4 });
export const CHART_SCOPE = 'Workagent chart panel: bar and line charts, up to 8 charts, 100 data rows and 4 numeric series each. First row supplies series names; first column supplies labels. Blanks, errors and non-numbers are gaps, not zero. All rows are included, even hidden rows. Charts are saved with this sheet, not embedded Univer drawings. Cell-only paste and autofill (including copy-down/right) update fixed source cells with native Undo/Redo. They must stay within sheet bounds and avoid merged cells. While charts exist, tab structure, row/column insertion/deletion/moves, range moves, sorting, merging and cut are refused. Copy/paste or fill touching dropdown/checkbox or conditional-formatting rules, object/file paste, cross-workbook cell copies and changing a previous paste/fill mode remain unsupported; direct cell edits and external cell text paste remain available. XLSX chart export is unavailable; CSV loses charts.';
const bad = () => { throw new Fault('invalid_sheet_charts', 400); };
function object(v, keys) { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) bad(); }
export function sheetCharts(book) {
  const resource = book.resources?.find(r => r.name === CHART_RESOURCE);
  if (!resource) return [];
  try { return JSON.parse(resource.data); } catch { bad(); }
}
export function validateCharts(book, charts = sheetCharts(book)) {
  if (!Array.isArray(charts) || charts.length > CHART_LIMITS.charts) bad();
  const ids = new Set();
  for (const chart of charts) {
    object(chart, ['id', 'title', 'type', 'sheetId', 'range']);
    id(chart.id); id(chart.sheetId);
    if (ids.has(chart.id)) bad(); ids.add(chart.id);
    if (typeof chart.title !== 'string' || chart.title.length > 160 || !['bar', 'line'].includes(chart.type)) bad();
    const sheet = Object.hasOwn(book.sheets, chart.sheetId) && book.sheets[chart.sheetId];
    if (!book.sheetOrder.includes(chart.sheetId) || !sheet) bad();
    const r = chart.range;
    object(r, ['startRow', 'endRow', 'startColumn', 'endColumn']);
    if (!['startRow', 'endRow', 'startColumn', 'endColumn'].every(k => Number.isSafeInteger(r[k]) && r[k] >= 0)
      || r.endRow <= r.startRow || r.endColumn <= r.startColumn || r.endRow >= sheet.rowCount || r.endColumn >= sheet.columnCount
      || r.endRow - r.startRow > CHART_LIMITS.points || r.endColumn - r.startColumn > CHART_LIMITS.series) bad();
    // Merged values have ambiguous rectangular series/label semantics.
    if ((sheet.mergeData ?? []).some(m => m.startRow <= r.endRow && m.endRow >= r.startRow && m.startColumn <= r.endColumn && m.endColumn >= r.startColumn)) bad();
  }
  return charts;
}
export function withCharts(book, charts) {
  validateCharts(book, charts);
  return { ...book, resources: [...(book.resources ?? []).filter(r => r.name !== CHART_RESOURCE), { name: CHART_RESOURCE, data: JSON.stringify(charts) }] };
}
export function chartRangeLabel(r) {
  const col = n => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  return `${col(r.startColumn)}${r.startRow + 1}:${col(r.endColumn)}${r.endRow + 1}`;
}
export function parseChartRange(value) {
  const m = /^\s*([A-Za-z]{1,2})([1-9]\d{0,4}):([A-Za-z]{1,2})([1-9]\d{0,4})\s*$/.exec(value);
  if (!m) throw new Error('Enter a bounded range such as A1:C10 (header row and label column included).');
  const col = s => [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return { startRow: +m[2] - 1, endRow: +m[4] - 1, startColumn: col(m[1]), endColumn: col(m[3]) };
}
// Caller supplies fresh native cells after successful calculation, never persisted caches.
export function chartData(chart, cellAt) {
  const r = chart.range, labels = [], series = [];
  const label = (cell, fallback) => {
    const v = cell?.p?.body?.dataStream?.replace(/\r\n$/, '') ?? cell?.v;
    return v == null || v === '' ? fallback : String(v).slice(0, 200);
  };
  for (let c = r.startColumn + 1; c <= r.endColumn; c++) series.push({ name: label(cellAt(r.startRow, c), `Series ${c-r.startColumn}`), values: [], missing: [] });
  for (let row = r.startRow + 1; row <= r.endRow; row++) {
    labels.push(label(cellAt(row, r.startColumn), `(row ${row + 1})`));
    for (let i = 0; i < series.length; i++) {
      const cell = cellAt(row, r.startColumn + i + 1), v = cell?.v;
      const valid = (cell?.t == null || cell.t === 2) && typeof v === 'number' && Number.isFinite(v);
      series[i].values.push(valid ? v : null);
      series[i].missing.push(valid ? null : cell?.t === 4 ? 'error' : v == null || v === '' ? 'blank' : 'non-number');
    }
  }
  return { labels, series };
}
// Normalize before subtraction: opposing values near MAX_VALUE cannot overflow.
export function chartScale(data) {
  const values = data.series.flatMap(s => s.values).filter(v => v !== null);
  const scale = Math.max(1, ...values.map(v => Math.abs(v)));
  const low = Math.min(0, ...values.map(v => v / scale)), high = Math.max(0, ...values.map(v => v / scale));
  return { min: low * scale, max: high * scale, y: v => 180 - (high === low ? 0 : (v / scale - low) / (high - low)) * 160 };
}
