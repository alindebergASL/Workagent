// Installed Univer 1.4 ConditionalFormattingService resource, not computed styles.
import { Fault, id } from './index.mjs';
export const CONDITIONAL_RESOURCE = 'SHEET_CONDITIONAL_FORMATTING_PLUGIN';
export const CONDITIONAL_SCOPE = 'Native conditional formatting supports numeric/text highlights (fill, font color, bold, italic, underline and strike-through), two/three-color scales, data bars and built-in 3/4/5-icon sets. Finish rules with Submit before saving. Numeric thresholds are bounded by ±9,007,199,254,740,991; percent/percentile thresholds by 0–100. Scales and bars also support minimum/maximum. Crossed scale points retain their colors; ties use the first authored point. Empty cells have no scale; constant minimum/maximum ranges use the minimum color. Bars support signed colors, solid/gradient fills and show/hide value. They scale between ordered bounds with a proportional zero axis inside or at the nearest edge. Equal nonzero bounds fill at or beyond the bound away from zero; zero/empty cells have no bar. Icons support built-in family choices, reversal, no-icon bands and show/hide value. Numeric/percent/percentile boundaries use > or >=, descend with their icons, and prefer the first matching authored band at ties; the last row is the fallback. Text, booleans and blanks have no icon. Formula/custom thresholds, external icons, charts and out-of-range quick presets are refused; use the native rule editor. XLSX/CSV export cannot yet preserve conditional rules; your native sheet is kept.';
const bad = () => { throw new Fault('unsupported_conditional_formatting', 400); };
// Exact installed 1.4 registry names/counts; no externally supplied image content.
export const CONDITIONAL_ICON_FAMILIES = Object.freeze({
  '3Arrows': 3, '3ArrowsGray': 3, '4Arrows': 4, '4ArrowsGray': 4, '5Arrows': 5, '5ArrowsGray': 5,
  '3Triangles': 3, '3TrafficLights1': 3, '3Signs': 3, '3TrafficLights2': 3, '4RedToBlack': 4,
  '4TrafficLights': 4, '3Symbols': 3, '3Symbols2': 3, '3Flags': 3, '4Rating': 4,
  '5Rating': 5, '5Quarters': 5, '_5Felling': 5, '5Boxes': 5, '3Stars': 3,
});
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
// Native 1.4.0 panel emits contiguous indices and retains an unused numeric
// value on min/max. Presets omit that value. Both are safe SDK representations.
function validateScale(rule) {
  object(rule, ['type', 'config']);
  if (!Array.isArray(rule.config) || ![2, 3].includes(rule.config.length)) bad();
  const previous = new Map();
  for (const [index, point] of rule.config.entries()) {
    object(point, ['index', 'color', 'value']);
    if (point.index !== index || !color(point.color)) bad();
    object(point.value, ['type', 'value']);
    const { type, value } = point.value;
    if (!['min', 'max', 'num', 'percent', 'percentile'].includes(type)) bad();
    if (type === 'min' && index !== 0 || type === 'max' && index !== rule.config.length - 1) bad();
    if (value !== undefined || !['min', 'max'].includes(type)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) bad();
      if (['percent', 'percentile'].includes(type) && (value < 0 || value > 100)) bad();
    }
    // Compare like thresholds, including nonadjacent endpoints. Mixed types
    // depend on live cell values; native integration sorts point/color pairs together.
    if (previous.has(type) && value < previous.get(type)) bad();
    previous.set(type, value);
  }
}
// The native panel retains unused numeric min/max values; the facade/presets
// can omit colors and flags. Explicit unknown fields and nonbooleans still refuse.
function validateBar(rule) {
  object(rule, ['type', 'config', 'isShowValue']);
  if (rule.isShowValue !== undefined && typeof rule.isShowValue !== 'boolean') bad();
  object(rule.config, ['min', 'max', 'positiveColor', 'nativeColor', 'isGradient']);
  const c = rule.config;
  if (c.isGradient !== undefined && typeof c.isGradient !== 'boolean') bad();
  for (const key of ['positiveColor', 'nativeColor']) if (c[key] !== undefined && !color(c[key])) bad();
  for (const key of ['min', 'max']) {
    object(c[key], ['type', 'value']);
    const { type, value } = c[key];
    if (![key, 'num', 'percent', 'percentile'].includes(type)) bad();
    if (value !== undefined || type !== key) {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) bad();
      if (['percent', 'percentile'].includes(type) && (value < 0 || value > 100)) bad();
    }
  }
  if (c.min.type === c.max.type && c.min.value > c.max.value) bad();
}
function validateIcons(rule) {
  object(rule, ['type', 'config', 'isShowValue']);
  if (rule.isShowValue !== undefined && typeof rule.isShowValue !== 'boolean') bad();
  if (!Array.isArray(rule.config) || ![3, 4, 5].includes(rule.config.length)) bad();
  for (const [index, point] of rule.config.entries()) {
    object(point, ['operator', 'value', 'iconType', 'iconId']);
    if (typeof point.iconType !== 'string') bad();
    if (point.iconType === 'EMPTY_ICON_TYPE') { if (point.iconId !== '') bad(); }
    else if (!Object.hasOwn(CONDITIONAL_ICON_FAMILIES, point.iconType)
      || typeof point.iconId !== 'string' || !/^[0-4]$/.test(point.iconId)
      || +point.iconId >= CONDITIONAL_ICON_FAMILIES[point.iconType]) bad();
    // The last native row is the fallback, not a third/fourth/fifth boundary.
    // Both panel factories and the facade retain inert metadata there. Validate
    // it too: the quick menu's percent=MAX_SAFE_INTEGER is not a valid percent.
    const operators = index === rule.config.length - 1
      ? ['greaterThan', 'greaterThanOrEqual', 'lessThanOrEqual'] : ['greaterThan', 'greaterThanOrEqual'];
    if (!operators.includes(point.operator)) bad();
    object(point.value, ['type', 'value']);
    const { type, value } = point.value;
    if (!['num', 'percent', 'percentile'].includes(type) || typeof value !== 'number'
      || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) bad();
    if (type !== 'num' && (value < 0 || value > 100)) bad();
  }
}
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
      object(rule);
      if (rule.type === 'colorScale') validateScale(rule);
      else if (rule.type === 'dataBar') validateBar(rule);
      else if (rule.type === 'iconSet') validateIcons(rule);
      else {
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
      }
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
