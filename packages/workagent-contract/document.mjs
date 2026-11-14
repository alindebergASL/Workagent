import { Fault, id, text } from './index.mjs';
export const DOCUMENT_LIMIT = 200000;
export const DOCUMENT_POLICY = 'UTF-8 text / Markdown source, kept literally as editable paragraphs. Markdown syntax is not rendered. UTF-8 BOM is omitted from editable text. Line endings normalize to LF on export; the original bytes remain downloadable. Text / Markdown export omits native formatting, list markers, list structure and page layout. Use Word export to retain supported lists.';
export const workKind = w => w.kind ?? 'sheet';
export const workTitle = w => workKind(w) === 'document' ? w.document.title : w.book.name;
export function requireSheet(w) { if (workKind(w) !== 'sheet') throw new Fault('sheet_required', 400); return w; }
export function blankDocument(workId, title = 'Untitled document', content = '') {
  if (typeof content !== 'string' || content.length > DOCUMENT_LIMIT || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) throw new Fault('invalid_document_text', 400);
  const dataStream = content.replace(/\r\n?|\n/g, '\r') + '\r\n';
  return { id: workId, title, documentStyle: { pageSize: { width: 794, height: 1123 }, marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72 }, body: { dataStream, paragraphs: [...dataStream.matchAll(/\r/g)].map(m => ({ startIndex: m.index })), textRuns: [], sectionBreaks: [{ startIndex: dataStream.length - 1 }] } };
}
// Shapes follow the installed 1.4.0 native paragraph/inline-style snapshots.
// Keep every accepted field; reject unsupported content instead of flattening it.
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const invalid = () => { throw new Fault('invalid_document_structure', 400); };
const number = (min = -100000, max = 100000) => v => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) invalid(); };
const integer = (min = 0, max = 100000) => v => { number(min, max)(v); if (!Number.isSafeInteger(v)) invalid(); };
const string = v => { if (typeof v !== 'string' || v.length > DOCUMENT_LIMIT) invalid(); };
const boolean = v => { if (typeof v !== 'boolean') invalid(); };
const bit = integer(0, 1), enumeration = integer(0, 32);
const nullable = check => v => { if (v !== null) check(v); };
const array = check => v => { if (!Array.isArray(v) || v.length > 10000) invalid(); for (const item of v) check(item); };
const emptyObject = v => { if (!object(v) || Object.keys(v).length) throw new Fault('unsupported_document_structure', 400); };
const emptyArray = v => { if (!Array.isArray(v) || v.length) throw new Fault('unsupported_document_structure', 400); };
const emptyString = v => { if (v !== '') throw new Fault('unsupported_document_structure', 400); };
function shape(v, fields, required = []) {
  if (!object(v)) invalid();
  for (const k of required) if (v[k] === undefined) invalid();
  for (const [k, x] of Object.entries(v)) {
    if (!Object.hasOwn(fields, k)) throw new Fault('unsupported_document_structure', 400);
    if (x !== undefined) fields[k](x);
  }
}
const color = v => shape(v, { rgb: nullable(string), th: enumeration });
const decoration = v => shape(v, { s: bit, c: bit, cl: color, t: enumeration }, ['s']);
const unit = v => shape(v, { v: number(), u: enumeration }, ['v']);
const textStyle = v => shape(v, {
  ff: nullable(string), eastAsiaFontFamily: nullable(string), fs: number(0.1, 1000), it: bit, bl: bit,
  ul: decoration, bbl: decoration, st: decoration, ol: decoration, bg: nullable(color), cl: nullable(color), va: nullable(enumeration),
  lang: string, altLang: string, kerning: number(0), caps: boolean, smallCaps: boolean,
  sc: number(), pos: number(), sa: number(), hidden: v => { if (v !== false) throw new Fault('unsupported_document_structure', 400); },
});
const border = v => shape(v, { color, width: number(0), dashStyle: enumeration, padding: number(0) }, ['color', 'width', 'dashStyle']);
const paragraphStyle = v => shape(v, {
  textStyle, paragraphMarkTextStyle: textStyle, headingId: string, namedStyleType: enumeration, outlineLevel: integer(0, 9),
  horizontalAlign: enumeration, direction: enumeration, lineSpacing: number(0), spacingRule: enumeration,
  defaultTabStop: number(0), indentFirstLine: unit, hanging: unit, indentStart: unit, indentEnd: unit, spaceAbove: unit, spaceBelow: unit,
  tabStops: array(v => shape(v, { offset: number(), alignment: enumeration, leader: enumeration, clear: boolean }, ['offset', 'alignment'])),
  borderBetween: border, borderTop: border, borderBottom: border, borderLeft: border, borderRight: border,
  shading: v => shape(v, { backgroundColor: color }, ['backgroundColor']),
  fontAlign: v => { if (!['auto','top','center','baseline','bottom'].includes(v)) invalid(); },
  ...Object.fromEntries(['eastAsianLineBreak','hangingPunctuation','topLinePunct','snapToGrid','beforeAutoSpacing','afterAutoSpacing','contextualSpacing','keepLines','keepNext','pageBreakBefore','wordWrap','widowControl','suppressHyphenation'].map(k => [k, bit])),
});
const listKey = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(v) || ['__proto__','constructor','prototype'].includes(v)) invalid(); };
const bullet = v => shape(v, { listId: listKey, listType: listKey, nestingLevel: integer(0, 8), startNumber: integer(0, 999999), textStyle }, ['listId','listType','nestingLevel']);
const listLevel = v => shape(v, {
  paragraphProperties: paragraphStyle, bulletAlignment: integer(0, 4), glyphFormat: v => { string(v); if (v.length > 100) invalid(); },
  textStyle, startNumber: integer(0, 999999), glyphType: integer(0, 60),
  glyphSymbol: v => { string(v); if (v.length > 16) invalid(); }, isLegal: boolean,
}, ['bulletAlignment','glyphFormat','startNumber']);
const lists = v => {
  if (!object(v) || Object.keys(v).length > 1000) invalid();
  for (const [key, value] of Object.entries(v)) {
    listKey(key);
    shape(value, { listType: listKey, nestingLevel: levels => { if (!Array.isArray(levels) || !levels.length || levels.length > 9) invalid(); levels.forEach(listLevel); } }, ['listType','nestingLevel']);
  }
};
// The installed 1.4.0 renderer merges these implicit presets with doc.lists.
// startNumber is a zero-based offset: native 0 displays Word's start value 1.
// Mirrored from the installed 1.4 preset factories; verified against the SDK
// in docx-native tests. Custom definitions replace (not merge) a preset.
const standardListLevel = (type, depth) => {
  if (!['BULLET_LIST','ORDER_LIST','ORDER_LIST_1','ORDER_LIST_2','ORDER_LIST_3','ORDER_LIST_4','ORDER_LIST_5'].includes(type) || (type === 'ORDER_LIST_2' && depth > 6)) return null;
  const glyphType = type === 'ORDER_LIST_2' ? 2 : [['ORDER_LIST_3','ORDER_LIST_4'].includes(type) ? 4 : type === 'ORDER_LIST_5' ? 3 : 2, type === 'ORDER_LIST_4' ? 2 : 5, 7][depth % 3];
  return { bulletAlignment: 1, startNumber: 0,
    glyphFormat: type === 'BULLET_LIST' ? ` %${depth + 1}` : type === 'ORDER_LIST_2' ? Array.from({ length: depth + 1 }, (_, i) => `%${i + 1}.`).join('') : `%${depth + 1}${type === 'ORDER_LIST_1' ? ')' : '.'}`,
    ...(type === 'BULLET_LIST' ? { glyphSymbol: ['●','○','■'][depth % 3] } : { glyphType }),
    paragraphProperties: { hanging: { v: 21 }, indentStart: { v: 21 * (depth + 1) } } };
};
export function documentListDefinition(doc, item) {
  const template = doc.lists?.[item.listType], depth = item.nestingLevel;
  const get = n => template ? template.nestingLevel?.[n] : standardListLevel(item.listType, n);
  const level = get(depth);
  const fail = () => { throw new Fault('unsupported_document_list', 400); };
  if (!Number.isInteger(depth) || depth < 0 || depth > 8 || !level || (template && !['BULLET_LIST','ORDER_LIST'].includes(template.listType))) fail();
  const check = (l, n) => {
    if (!l || l.bulletAlignment !== 1 || l.isLegal === true) fail();
    if (l.glyphSymbol) {
      if (l.glyphType !== undefined || !['●','•','○','■','▪'].includes(l.glyphSymbol) || ![` %${n + 1}`, `%${n + 1}`].includes(l.glyphFormat)) fail();
    } else if (![2,3,4,5,6,7].includes(l.glyphType) || ![`%${n + 1}.`, `%${n + 1})`, Array.from({ length: n + 1 }, (_, i) => `%${i + 1}.`).join('')].includes(l.glyphFormat)) fail();
  };
  check(level, depth);
  // Referenced ancestors affect visible markers even when no paragraph uses
  // their level. Do not silently reinterpret unknown or bullet placeholders.
  if (!level.glyphSymbol) for (const ref of level.glyphFormat.matchAll(/%([1-9])/g)) {
    const n = Number(ref[1]) - 1, ancestor = get(n); check(ancestor, n);
    if (ancestor.glyphSymbol) fail();
  }
  return { kind: level.glyphSymbol ? 'BULLET_LIST' : 'ORDER_LIST', level };
}
const pageFields = {
  pageSize: v => shape(v, { width: number(0.1), height: number(0.1) }, ['width', 'height']),
  ...Object.fromEntries(['marginTop','marginBottom','marginLeft','marginRight','marginHeader','marginFooter'].map(k => [k, number(0)])),
  pageOrient: enumeration, documentFlavor: enumeration, pageNumberStart: integer(),
  ...Object.fromEntries(['defaultHeaderId','defaultFooterId','evenPageHeaderId','evenPageFooterId','firstPageHeaderId','firstPageFooterId'].map(k => [k, emptyString])),
  evenAndOddHeaders: bit, useFirstPageHeaderFooter: bit,
  renderConfig: v => shape(v, { verticalAlign: enumeration, horizontalAlign: enumeration, centerAngle: number(-360, 360), vertexAngle: number(-360, 360), isRotateNonEastAsian: bit, background: color, wrapStrategy: enumeration, cellValueType: enumeration, isRenderStyle: bit, zeroWidthParagraphBreak: bit, shapeTextOpticalVerticalAlign: bit, lineWrapTolerance: number(0) }),
};
const documentStyle = v => shape(v, {
  ...pageFields, textStyle, defaultParagraphStyle: paragraphStyle, defaultTabStop: number(0), characterSpacingControl: enumeration,
  paragraphLineGapDefault: number(0), consecutiveHyphenLimit: integer(), hyphenationZone: number(0),
  ...Object.fromEntries(['useFELayout','splitPageBreakAndParagraphMark','balanceSingleByteDoubleByteWidth','adjustLineHeightInTable','spaceWidthEastAsian','autoHyphenation','doNotHyphenateCaps'].map(k => [k, bit])),
});
const section = v => shape(v, {
  ...pageFields, startIndex: integer(0, DOCUMENT_LIMIT + 2), sectionId: string, charSpace: number(), linePitch: number(0), gridType: enumeration,
  columnProperties: array(v => shape(v, { width: number(0.1), paddingEnd: number(0) }, ['width','paddingEnd'])),
  columnSeparatorType: enumeration, contentDirection: enumeration, sectionType: enumeration, sectionTypeNext: enumeration, textDirection: enumeration,
});
export function validateDocument(doc) {
  let serialized;
  try { serialized = JSON.stringify(doc); } catch { throw new Fault('invalid_document', 400); }
  if (!object(doc) || !serialized || serialized.length > 2_000_000) throw new Fault('invalid_document', 400);
  id(doc.id);
  try { text(doc.title, 200); } catch { throw new Fault('invalid_document_title', 400); }
  shape(doc, {
    id: string, title: string, body: v => { if (!object(v)) invalid(); }, documentStyle,
    locale: string, appVersion: string, revision: integer(), rev: integer(), disabled: boolean,
    zoomRatio: number(0.01, 100), documentFlavor: enumeration,
    settings: v => shape(v, { zoomRatio: number(0.01, 100) }),
    lists,
    ...Object.fromEntries(['tableSource','drawings','headers','footers','notes','noteSettings','footnotes','endnotes'].map(k => [k, emptyObject])),
    drawingsOrder: emptyArray, headerFooterDrawingsOrder: emptyArray,
    resources: v => {
      if (!Array.isArray(v) || [...v].some(r => !object(r) || Object.keys(r).some(k => !['name','data'].includes(k)) || !['DOC_OBJECT_PERMISSION_PLUGIN','DOC_WORD_STYLES_PLUGIN','DOC_NOTE_PLUGIN'].includes(r.name) || !['', '[]', '{}'].includes(r.data))) throw new Fault('unsupported_document_resources', 400);
    },
  }, ['body','documentStyle']);
  const body = doc.body, stream = body.dataStream;
  if (typeof stream !== 'string' || stream.length > DOCUMENT_LIMIT + 2 || new TextEncoder().encode(stream.slice(0, -2)).length > DOCUMENT_LIMIT || !stream.endsWith('\r\n') || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(stream) || stream.slice(0,-1).includes('\n')) throw new Fault('invalid_document_body', 400);
  shape(body, {
    dataStream: () => {},
    paragraphs: array(v => shape(v, { startIndex: integer(0, DOCUMENT_LIMIT), paragraphStyle, paragraphId: string, bullet }, ['startIndex'])),
    textRuns: array(v => shape(v, { st: integer(0, DOCUMENT_LIMIT), ed: integer(0, DOCUMENT_LIMIT + 1), ts: textStyle }, ['st','ed','ts'])),
    sectionBreaks: array(section),
    ...Object.fromEntries(['customRanges','customDecorations','customBlocks','tables','customParagraphs','customTable','customSectionBreaks'].map(k => [k, emptyArray])),
  }, ['paragraphs']);
  const paragraphs = body.paragraphs;
  if (JSON.stringify(paragraphs.map(p => p.startIndex)) !== JSON.stringify([...stream.matchAll(/\r/g)].map(m => m.index))) throw new Fault('invalid_document_paragraphs', 400);
  const listTypes = new Map();
  for (const p of paragraphs) if (p.bullet) {
    documentListDefinition(doc, p.bullet);
    const old = listTypes.get(p.bullet.listId);
    if (old && old !== p.bullet.listType) throw new Fault('unsupported_document_list', 400);
    listTypes.set(p.bullet.listId, p.bullet.listType);
  }
  let previous = 0;
  for (const r of body.textRuns ?? []) {
    if (r.st < previous || r.ed <= r.st || r.ed > stream.length - 1) throw new Fault('invalid_document_runs', 400);
    previous = r.ed;
  }
  if (body.sectionBreaks !== undefined && (body.sectionBreaks.length !== 1 || body.sectionBreaks[0].startIndex !== stream.length - 1)) throw new Fault('unsupported_document_sections', 400);
  return structuredClone(doc);
}
export function documentText(doc) { return validateDocument(doc).body.dataStream.slice(0, -2).replace(/\r/g, '\n'); }

export const DOCUMENT_SELECTION_LIMIT = 10000;
// Native UTF-16 offsets, end exclusive. Keep paragraph marks and whitespace
// literally; the final section sentinel (LF) is not selectable body text.
export function documentSelectionText(doc, range) {
  const stream = validateDocument(doc).body.dataStream;
  const { startOffset: start, endOffset: end, segmentId } = range ?? {};
  const splitsPair = n => n > 0 && n < stream.length && /[\uD800-\uDBFF]/.test(stream[n - 1]) && /[\uDC00-\uDFFF]/.test(stream[n]);
  if (segmentId !== '' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end <= start || end > stream.length - 1 || end - start > DOCUMENT_SELECTION_LIMIT
    || splitsPair(start) || splitsPair(end)) throw new Fault('invalid_document_selection', 400);
  return stream.slice(start, end);
}
