import { blankDocument } from '../../../../packages/workagent-contract/document.mjs';
export const glyphs = ['●', '•', '○', '■', '▪'];
export function listDocument({ long = false, largeNumbers = false } = {}) {
  const lines = ['雪🌍雪🌍 Before', 'AlphaFirst 雪🌍', 'AlphaSecond 🌍雪', 'PlainBetween 雪🌍'];
  glyphs.forEach((_, i) => lines.push(`Bullet${i} 🌍雪🌍雪`));
  lines.push('AlphaThird', 'BetaFive', 'BetaSix', 'AlphaNine', 'AlphaTen', 'LargeStart', 'LargeNext', 'MillionStart', '雪🌍 After');
  if (long) for (let i = 0; i < 90; i++) lines.push(`Wrapped${i} ` + 'flowing text keeps its order and wraps across the page '.repeat(12) + `Tail${i}`);
  const doc = blankDocument('doc', 'PDF lists', lines.join('\n'));
  const item = (index, listId, listType = 'ORDER_LIST', startNumber) => {
    doc.body.paragraphs[index].bullet = { listId, listType, nestingLevel: 0, ...(startNumber === undefined ? {} : { startNumber }) };
  };
  item(1, 'alpha'); item(2, 'alpha'); item(9, 'alpha');
  item(10, 'beta', 'decimalFive'); item(11, 'beta', 'decimalFive'); item(12, 'alpha', 'ORDER_LIST', 8); item(13, 'alpha');
  // Preserve the original renderer failures explicitly; ordinary typography and
  // glyph qualification must also run independently of unsupported numbers.
  item(14, 'large', 'ORDER_LIST', largeNumbers ? 999998 : 998); item(15, 'large'); item(16, 'million', 'ORDER_LIST', largeNumbers ? 999999 : 999);
  doc.lists = { decimalFive: { listType: 'ORDER_LIST', nestingLevel: [
    { bulletAlignment: 1, startNumber: 4, glyphFormat: '%1.', glyphType: 2, textStyle: { fs: 14 } },
  ] } };
  glyphs.forEach((glyphSymbol, i) => {
    const key = `bullet${i}`;
    doc.lists[key] = { listType: 'BULLET_LIST', nestingLevel: [{ bulletAlignment: 1, startNumber: 0, glyphFormat: ' %1', glyphSymbol,
      textStyle: { fs: 12 + i, ...(i === 1 ? { bl: 1, it: 1, ul: { s: 1 } } : {}) },
      paragraphProperties: { indentStart: { v: 28 }, hanging: { v: 28 } } },
      // Unused stock levels remain valid native state; they are not active PDF content.
      { bulletAlignment: 1, startNumber: 0, glyphFormat: '%2.', glyphType: 4 }] };
    item(4 + i, key, key);
  });
  const st = doc.body.paragraphs[0].startIndex + 1;
  doc.body.textRuns = [{ st, ed: st + 10, ts: { bl: 1, it: 1, ul: { s: 1 }, fs: 17.5, cl: { rgb: '#224466' } } }];
  doc.body.paragraphs[2].paragraphStyle = { textStyle: { it: 1, fs: 12 } };
  doc.body.paragraphs[9].bullet.textStyle = { bl: 1, ul: { s: 1 } };
  if (long) for (let i = 18; i < lines.length; i++) item(i, 'wrapping');
  return doc;
}

export function numberedDocument(start, { continuation = false, split = false, restart, distinct = false, template = false } = {}) {
  const d = blankDocument('doc', 'Number boundary', continuation ? 'First\nPlain\nNext' : 'First');
  const key = template ? 'custom' : 'ORDER_LIST';
  d.body.paragraphs[0].bullet = { listId: 'a', listType: key, nestingLevel: 0, ...(template ? {} : { startNumber: start - 1 }) };
  if (template) d.lists = { custom: { listType: 'ORDER_LIST', nestingLevel: [{ bulletAlignment: 1, startNumber: start - 1, glyphFormat: '%1.', glyphType: 2 }] } };
  if (continuation) {
    d.body.paragraphs[2].bullet = { listId: distinct ? 'b' : 'a', listType: key, nestingLevel: 0, ...(restart === undefined ? {} : { startNumber: restart - 1 }) };
    if (split) d.body.paragraphs[2].paragraphStyle = { textStyle: { fs: 17.5, it: 1, bl: 1 } };
  }
  return d;
}

export function overhangDocument({ inheritance = 'run', bodySize = 200, markerSize = 11, wrapped = false } = {}) {
  const d = blankDocument('doc', 'Body overhang', wrapped ? 'Small first words ' + 'A '.repeat(30) : 'A');
  d.body.paragraphs[0].bullet = { listId: 'a', listType: 'BULLET_LIST', nestingLevel: 0, textStyle: { fs: markerSize, it: 0 } };
  const style = { fs: bodySize, it: 1 };
  if (inheritance === 'document') d.documentStyle.textStyle = style;
  else if (inheritance === 'default') d.documentStyle.defaultParagraphStyle = { textStyle: style };
  else if (inheritance === 'paragraph') d.body.paragraphs[0].paragraphStyle = { textStyle: style };
  else d.body.textRuns = [{ st: wrapped ? 18 : 0, ed: d.body.paragraphs[0].startIndex, ts: style }];
  return d;
}

// Reused by native SDK checks and Parent's isolated LibreOffice/Poppler proof.
export const nestedWordCases = [
  { name: 'nonreferencing child', input: {items:[[90,1],[90,0],[90,1]],overrides:{}}, expected:['b.','4.','b.'] },
  { name: 'shared counter with Plain', expected: ['3.','b.','3.b.i.','c.','4.','e.','5.','b.','5.b.i.'] },
  { name: 'ancestor reset after subtree restart', input: { items: [[90,0],[90,1],[91,1],[90,1],[91,1],[91,0],[91,1],[90,1],[90,0],[91,1],[90,1]] }, expected: ['3.','b.','e.','f.','g.','4.','b.','c.','5.','b.','c.'] },
  { name: 'skipped ancestors', input: { items: [[90,2],[90,1],[90,0],[90,1]], overrides: {} }, expected: ['3.b.i.','c.','4.','b.'] },
  { name: 'independent identities', input: { items: [[90,0],[90,1],[91,0],[91,1],[90,0],[90,1],[91,0],[91,1]], independent: true }, expected: ['3.','b.','3.','e.','4.','b.','4.','b.'] },
  { name: 'nonreferencing skipped leaf', input: { items: [[90,2],[90,1],[90,0],[90,1]], overrides: {}, leaf_pattern: '%3.' }, expected: ['i.','c.','4.','b.'] },
];
export function nestedNativeCases() {
  const cases = [];
  const add = (name, type, depths, expected, starts = {}) => {
    const document = blankDocument('doc', name, depths.map((_, i) => `Item${i}`).join('\n'));
    document.body.paragraphs.forEach((p, i) => { p.bullet = { listId: 'main', listType: type, nestingLevel: depths[i], ...(starts[i] === undefined ? {} : { startNumber: starts[i] }) }; });
    cases.push({ name, document, expected }); return document;
  };
  add('partial outdent restart', 'ORDER_LIST_2', [2,1,0,1], ['1.1.6.','1.2.','2.','2.1.'], {0:5});
  for (const [type, cycle] of [['ORDER_LIST',['1.','a.','i.']], ['ORDER_LIST_1',['1)','a)','i)']], ['ORDER_LIST_3',['A.','a.','i.']], ['ORDER_LIST_4',['A.','1.','i.']], ['ORDER_LIST_5',['01.','a.','i.']], ['BULLET_LIST',['●','○','■']]]) {
    add(type, type, Array.from({length:9}, (_, i) => i), Array.from({length:9}, (_, i) => cycle[i%3]));
  }
  add('hierarchical preset', 'ORDER_LIST_2', [0,1,2,3,4,5,6], Array.from({length:7}, (_, i) => '1.'.repeat(i+1)));
  const styled = add('definition marker and wrapped body', 'custom', [0,1,2,1,0,1,2], ['03.','BB.','03.BB.iv.','CC.','04.','BB.','04.BB.iv.']);
  styled.lists = { custom: { listType: 'ORDER_LIST', nestingLevel: [
    { bulletAlignment:1, startNumber:2, glyphType:3, glyphFormat:'%1.', textStyle:{ fs:14, cl:{rgb:'#880000'} }, paragraphProperties:{indentStart:{v:21},hanging:{v:21}} },
    { bulletAlignment:1, startNumber:27, glyphType:4, glyphFormat:'%2.', textStyle:{ fs:16, bl:1 }, paragraphProperties:{indentStart:{v:42},hanging:{v:21}} },
    { bulletAlignment:1, startNumber:3, glyphType:7, glyphFormat:'%1.%2.%3.', textStyle:{ fs:18, it:1 }, paragraphProperties:{indentStart:{v:63},hanging:{v:21}} },
  ] } };
  const wrapped = add('deep wrapping', 'BULLET_LIST', [8], ['■']);
  const text = 'DeepStart ' + 'wrapped text stays inside the page '.repeat(50) + 'DeepEnd';
  wrapped.body.dataStream = text + '\r\n'; wrapped.body.paragraphs[0].startIndex = text.length; wrapped.body.sectionBreaks = [{startIndex:text.length+1}];
  for (const [type, start, expected] of [['ORDER_LIST',32766,'32767.'],['ORDER_LIST_5',32766,'32767.'],['ORDER_LIST_3',27,'BB.']]) add(`bounded ${type}`, type, [0], [expected], {0:start});
  const roman = add('maximum Roman counter', 'roman', [0], ['M'.repeat(32)+'DCCLXVII.'], {0:32766});
  roman.lists = {roman:{listType:'ORDER_LIST',nestingLevel:[{bulletAlignment:1,startNumber:0,glyphType:6,glyphFormat:'%1.',textStyle:{fs:6}}]}};
  return cases;
}
