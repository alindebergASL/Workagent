// Installed Univer 1.4 ConditionalFormattingService resource, not computed styles.
import { Fault, id } from './index.mjs';
export const CONDITIONAL_RESOURCE = 'SHEET_CONDITIONAL_FORMATTING_PLUGIN';
export const CONDITIONAL_SCOPE = 'Conditional formatting supports numeric comparisons and literal text matches in bounded ranges, with fill, font color, bold, italic, underline and strike-through. Finish the native rule with Done before saving. Color scales, formula rules, icons, bars and other advanced rules are not supported. Conditional rules cannot yet be exported to XLSX or CSV; your native sheet is kept.';
const bad = () => { throw new Fault('unsupported_conditional_formatting', 400); };
const color = value => {
  if (typeof value !== 'string' || value.length > 32) return false;
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return true;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value);
  return !!rgb && rgb.slice(1).every(v => +v <= 255);
};
const object = (v, keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    || Object.keys(v).some(k => ['__proto__', 'prototype', 'constructor'].includes(k) || keys && !keys.includes(k))) bad();
};
export function conditionalRules(book) {
  const raw = book.resources?.find(r => r.name === CONDITIONAL_RESOURCE)?.data;
  try { return raw ? JSON.parse(raw) : {}; } catch { bad(); }
}
export function validateConditionalRules(book, data = conditionalRules(book)) {
  object(data); let rules = 0, ranges = 0, area = 0;
  for (const [sid, list] of Object.entries(data)) {
    id(sid); const sheet = book.sheets[sid];
    // Univer retains an empty bucket after deleting a sheet. It contains no
    // rule or ownership payload; nonempty or malformed orphans remain invalid.
    if (!book.sheetOrder.includes(sid) && !Object.hasOwn(book.sheets, sid) && Array.isArray(list) && !list.length) continue;
    if (!book.sheetOrder.includes(sid) || !sheet || !Array.isArray(list) || (rules += list.length) > 256) bad();
    const ids = new Set();
    for (const entry of list) {
      object(entry, ['cfId', 'ranges', 'stopIfTrue', 'rule']);
      id(entry.cfId); if (ids.has(entry.cfId)) bad(); ids.add(entry.cfId);
      if (typeof entry.stopIfTrue !== 'boolean') bad();
      const rule = entry.rule;
      object(rule, ['type', 'subType', 'operator', 'value', 'style']);
      if (rule.type !== 'highlightCell') bad();
      if (rule.subType === 'number') {
        if (['between', 'notBetween'].includes(rule.operator)) {
          if (!Array.isArray(rule.value) || rule.value.length !== 2 || rule.value.some(v => typeof v !== 'number' || !Number.isFinite(v)) || rule.value[0] > rule.value[1]) bad();
        } else if (!['equal', 'notEqual', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual'].includes(rule.operator) || typeof rule.value !== 'number' || !Number.isFinite(rule.value)) bad();
      } else if (rule.subType === 'text') {
        if (!['beginsWith', 'endsWith', 'containsText', 'notContainsText', 'equal', 'notEqual', 'containsBlanks', 'notContainsBlanks', 'containsErrors', 'notContainsErrors'].includes(rule.operator)) bad();
        if (rule.value !== undefined && (typeof rule.value !== 'string' || rule.value.length > 200)) bad();
        if (['beginsWith', 'endsWith', 'containsText', 'notContainsText', 'equal', 'notEqual'].includes(rule.operator) && typeof rule.value !== 'string') bad();
      } else bad();
      object(rule.style, ['bg', 'cl', 'bl', 'it', 'ul', 'st']);
      for (const k of ['bg', 'cl']) if (rule.style[k] !== undefined) {
        object(rule.style[k], ['rgb']);
        if (!color(rule.style[k].rgb)) bad();
      }
      for (const k of ['bl', 'it']) if (rule.style[k] !== undefined && ![0, 1].includes(rule.style[k])) bad();
      for (const k of ['ul', 'st']) if (rule.style[k] !== undefined) { object(rule.style[k], ['s']); if (![0, 1].includes(rule.style[k].s)) bad(); }
      if (!Array.isArray(entry.ranges) || !entry.ranges.length || (ranges += entry.ranges.length) > 1000) bad();
      for (const r of entry.ranges) {
        object(r, ['startRow', 'endRow', 'startColumn', 'endColumn', 'rangeType', 'startAbsoluteRefType', 'endAbsoluteRefType', 'unitId', 'sheetId']);
        if (!['startRow', 'endRow', 'startColumn', 'endColumn'].every(k => Number.isSafeInteger(r[k]) && r[k] >= 0)
          || r.startRow > r.endRow || r.startColumn > r.endColumn || r.endRow >= sheet.rowCount || r.endColumn >= sheet.columnCount) bad();
        if (r.rangeType !== undefined && r.rangeType !== 0 || r.unitId !== undefined && r.unitId !== book.id || r.sheetId !== undefined && r.sheetId !== sid) bad();
        for (const k of ['startAbsoluteRefType', 'endAbsoluteRefType']) if (r[k] !== undefined && ![0, 1, 2, 3].includes(r[k])) bad();
        if ((area += (r.endRow-r.startRow+1)*(r.endColumn-r.startColumn+1)) > 100000) bad();
      }
    }
  }
  return { rules, ranges, area };
}
const stable = v => JSON.stringify(v, (_k, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value);
// Per-cell ordered author intent. Priority matters; SDK IDs alone do not.
export function conditionalCells(book) {
  const cells = new Map();
  for (const [sid, rules] of Object.entries(conditionalRules(book))) for (const entry of rules) {
    const meaning = stable({ rule: entry.rule, stopIfTrue: entry.stopIfTrue });
    for (const r of entry.ranges) for (let row=r.startRow;row<=r.endRow;row++) for(let column=r.startColumn;column<=r.endColumn;column++) {
      const key = `${sid}:${row}:${column}`;
      cells.set(key, `${cells.get(key) ?? ''}\n${meaning}`);
    }
  }
  return cells;
}
export function conditionalAt(book, sid, row, column) {
  return (conditionalRules(book)[sid] ?? []).some(rule => rule.ranges.some(r => row >= r.startRow && row <= r.endRow && column >= r.startColumn && column <= r.endColumn));
}
export const hasConditionalRules = book => Object.values(conditionalRules(book)).some(rules => rules.length);
