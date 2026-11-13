// Univer 1.4 DataValidationResourceController: sheet ID -> ISheetDataValidationRule[].
import { Fault, id } from './index.mjs';
export const CONTROL_RESOURCE = 'SHEET_DATA_VALIDATION_PLUGIN';
const emptyResources = new Set(['SHEET_RANGE_PROTECTION_PLUGIN', 'SHEET_AuthzIoMockService_PLUGIN', 'SHEET_WORKSHEET_PROTECTION_PLUGIN', 'SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN', 'SHEET_DEFINED_NAME_PLUGIN', 'SHEET_RANGE_THEME_MODEL_PLUGIN']);
const bad = () => { throw new Fault('unsupported_sheet_controls', 400); };
function object(v, keys) { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => ['__proto__','prototype','constructor'].includes(k) || keys && !keys.includes(k))) bad(); }
export function sheetControls(book) {
  const resource = book.resources?.find(r => r.name === CONTROL_RESOURCE);
  return resource?.data ? JSON.parse(resource.data) : {};
}
export function validateSheetResources(book) {
  if (book.resources === undefined) return;
  if (!Array.isArray(book.resources) || book.resources.length > 16) bad();
  const names = new Set(); let rules = 0, area = 0, ranges = 0;
  for (const resource of book.resources) {
    object(resource, ['name','data']);
    if (names.has(resource.name) || typeof resource.data !== 'string' || resource.data.length > 500000) bad();
    names.add(resource.name);
    if (resource.name !== CONTROL_RESOURCE) {
      // These installed core plugins emit empty resources in supported books.
      // Refuse unsupported populated resources, never discard or pass them through.
      if (!emptyResources.has(resource.name) || !['','{}','[]'].includes(resource.data)) bad();
      continue;
    }
    let data; try { data = resource.data ? JSON.parse(resource.data) : {}; } catch { bad(); }
    object(data);
    for (const [sid, list] of Object.entries(data)) {
      id(sid); const sheet = book.sheets[sid];
      if (!book.sheetOrder.includes(sid) || !sheet || !Array.isArray(list) || (rules += list.length) > 256) bad();
      const ids = new Set();
      for (const rule of list) {
        object(rule, ['uid','type','ranges','formula1','formula2','allowBlank','showDropDown','showErrorMessage','error','errorTitle','errorStyle','showInputMessage','prompt','promptTitle','renderMode']);
        id(rule.uid); if (ids.has(rule.uid)) bad(); ids.add(rule.uid);
        if (!['list','checkbox'].includes(rule.type)) bad();
        for (const k of ['allowBlank','showDropDown','showErrorMessage','showInputMessage']) if (rule[k] !== undefined && typeof rule[k] !== 'boolean') bad();
        for (const k of ['error','errorTitle','prompt','promptTitle']) if (rule[k] !== undefined && (typeof rule[k] !== 'string' || rule[k].length > 500)) bad();
        for (const k of ['errorStyle','renderMode']) if (rule[k] !== undefined && ![0,1,2].includes(rule[k])) bad();
        if (rule.type === 'list') {
          let options; try { options = JSON.parse(rule.formula1); } catch { bad(); }
          if (!Array.isArray(options) || !options.length || options.length > 100 || options.some(v => typeof v !== 'string' || !v.length || v.length > 200)) bad();
          if (rule.formula2 !== undefined && (typeof rule.formula2 !== 'string' || rule.formula2.length > 1000 || rule.formula2.split(',').length > options.length || rule.formula2.split(',').some(v => v && !/^#[0-9a-fA-F]{6}$/.test(v)))) bad();
        } else if (![undefined,'','TRUE','true','1'].includes(rule.formula1) || ![undefined,'','FALSE','false','0'].includes(rule.formula2)) bad();
        if (!Array.isArray(rule.ranges) || !rule.ranges.length || (ranges += rule.ranges.length) > 1000) bad();
        for (const r of rule.ranges) {
          object(r, ['startRow','endRow','startColumn','endColumn','rangeType','startAbsoluteRefType','endAbsoluteRefType','unitId','sheetId']);
          if (!['startRow','endRow','startColumn','endColumn'].every(k => Number.isSafeInteger(r[k]) && r[k] >= 0) || r.startRow > r.endRow || r.startColumn > r.endColumn || r.endRow >= sheet.rowCount || r.endColumn >= sheet.columnCount) bad();
          if (r.rangeType !== undefined && r.rangeType !== 0 || r.unitId !== undefined && r.unitId !== book.id || r.sheetId !== undefined && r.sheetId !== sid) bad();
          for (const k of ['startAbsoluteRefType','endAbsoluteRefType']) if (r[k] !== undefined && ![0,1,2,3].includes(r[k])) bad();
          if ((area += (r.endRow-r.startRow+1)*(r.endColumn-r.startColumn+1)) > 100000) bad();
        }
      }
    }
  }
}
export function controlCells(book) {
  const cells = new Map();
  for (const [sid, rules] of Object.entries(sheetControls(book))) for (const rule of rules) {
    const { uid, ranges, ...meaning } = rule;
    const value = JSON.stringify(meaning, Object.keys(meaning).sort());
    for (const r of ranges) for (let row=r.startRow;row<=r.endRow;row++) for(let column=r.startColumn;column<=r.endColumn;column++) cells.set(`${sid}:${row}:${column}`, value);
  }
  return cells;
}
export function controlAt(book, sid, row, column) {
  return (sheetControls(book)[sid] ?? []).find(rule => rule.ranges.some(r => row >= r.startRow && row <= r.endRow && column >= r.startColumn && column <= r.endColumn));
}
