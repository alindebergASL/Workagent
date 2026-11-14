import { blankDocument } from '../../../../packages/workagent-contract/document.mjs';

// Synthetic native snapshot: offsets count UTF-16 code units, including CRs.
export function titleDocument(id) {
  const d = blankDocument(id, 'Original Cafe\u0301', 'Cafe\u0301 / Café 🌍 漢字\r\rSecond e\u0301 / é 🚀\r\rEnd');
  Object.assign(d, { locale: 'enUS', appVersion: '1.4.0', revision: 7, rev: 3, disabled: false, zoomRatio: 1.25,
    settings: { zoomRatio: 1.1 }, tableSource: {}, drawings: {}, drawingsOrder: [], headers: {}, footers: {}, notes: {},
    headerFooterDrawingsOrder: [], resources: [{ name: 'DOC_WORD_STYLES_PLUGIN', data: '{}' }, { name: 'DOC_NOTE_PLUGIN', data: '[]' }, { name: 'DOC_OBJECT_PERMISSION_PLUGIN', data: '' }] });
  d.documentStyle.textStyle = { ff: 'Noto Serif', eastAsiaFontFamily: 'Noto Sans CJK', fs: 13, cl: { rgb: '#123456' } };
  d.documentStyle.defaultParagraphStyle = { spaceAbove: { v: 8 }, tabStops: [] };
  d.body.textRuns = [{ st: 0, ed: 5, ts: { bl: 1, it: 0, ul: { s: 1, cl: { rgb: '#654321' } }, lang: 'fr' } }];
  d.body.paragraphs[0].paragraphStyle = { indentStart: { v: 21 }, keepNext: 1, tabStops: [{ offset: 42, alignment: 1 }] };
  d.body.paragraphs[0].bullet = { listId: 'retained-list', listType: 'custom', nestingLevel: 0, startNumber: 4 };
  d.body.paragraphs[2].bullet = { listId: 'retained-list', listType: 'custom', nestingLevel: 1, startNumber: 2 };
  d.lists = { custom: { listType: 'ORDER_LIST', nestingLevel: [0, 1].map(n => ({ bulletAlignment: 1, glyphType: 2, glyphFormat: n ? '%1.%2.' : '%1.', startNumber: 0, textStyle: { fs: 12 }, paragraphProperties: { hanging: { v: 21 } } })) } };
  for (const k of ['customRanges', 'customDecorations', 'customBlocks', 'tables', 'customParagraphs', 'customTable', 'customSectionBreaks']) d.body[k] = [];
  d.body.sectionBreaks[0].columnProperties = [];
  return d;
}
