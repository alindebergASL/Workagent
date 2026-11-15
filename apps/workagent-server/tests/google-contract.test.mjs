import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDocument, validateDocument } from '../../../packages/workagent-contract/document.mjs';
import { validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { createGoogleAdapter, createSimulatedGoogleAdapter, prepareGoogleDocDelivery, validateGoogleSheetPreview } from '../src/google-adapter.mjs';
const doc = () => blankDocument('source_doc', 'Delivery title', 'Hello 🦉\nSecond paragraph');
const fixture = () => ({ spreadsheetId: 'example', properties: { title: 'Typed values' }, sheets: [{ properties: { sheetId: 9, title: 'Data', sheetType: 'GRID', gridProperties: { rowCount: 10, columnCount: 6 } }, data: [{ rowData: [{ values: [{ userEnteredValue: { stringValue: '0012' } }, { userEnteredValue: { numberValue: 12.5 } }, { userEnteredValue: { boolValue: false } }, {}, { userEnteredValue: { stringValue: '=1+1' } }] }] }] }] });
const parse = (response, overrides = {}) => validateGoogleSheetPreview({ response, spreadsheetId: 'example', previewId: 'preview', ranges: [{ sheetTitle: 'Data', range: 'A1:F2' }], ...overrides });
const errorCode = code => e => e.code === code;

test('literal scalar types survive native validation; missing values are absent', () => {
  const book = parse(fixture()); assert.deepEqual(validateWorkbook(book), book);
  assert.deepEqual(book.sheets.google_9.cellData[0], { 0: { v: '0012', t: 1 }, 1: { v: 12.5, t: 2 }, 2: { v: false, t: 3 }, 4: { v: '=1+1', t: 1 } });
  assert.equal(book.sheets.google_9.cellData[1], undefined);
});
test('multiple selected tabs and nonzero source coordinates retained', () => {
  const source = fixture(), second = structuredClone(source.sheets[0]); second.properties.sheetId = 10; second.properties.title = "O'Brien";
  second.data[0].startRow = 2; second.data[0].startColumn = 1; second.data[0].rowData = [{ values: [{ userEnteredValue: { boolValue: true } }] }]; source.sheets.push(second);
  const book = parse(source, { ranges: [{ sheetTitle: 'Data', range: 'A1:F2' }, { sheetTitle: "O'Brien", range: 'B3:C3' }] });
  assert.deepEqual(book.sheetOrder, ['google_9', 'google_10']); assert.deepEqual(book.sheets.google_10.cellData[2][1], { v: true, t: 3 });
});
for (const [label, change] of [
  ['formula with believable cache', s => { s.sheets[0].data[0].rowData[0].values[0] = { userEnteredValue: { formulaValue: '=SUM(B1:B2)' }, effectiveValue: { numberValue: 999 } }; }],
  ['effective value without authored value', s => { s.sheets[0].data[0].rowData[0].values[0] = { effectiveValue: { numberValue: 999 } }; }],
  ['formatted value without grid', s => { delete s.sheets[0].data; }],
  ['merge', s => { s.sheets[0].merges = [{}]; }],
  ['chart', s => { s.sheets[0].charts = [{}]; }],
  ['date number format', s => { s.sheets[0].data[0].rowData[0].values[1].userEnteredFormat = { numberFormat: { type: 'DATE' } }; }],
  ['rich text', s => { s.sheets[0].data[0].rowData[0].values[0].textFormatRuns = [{}]; }],
  ['checkbox', s => { s.sheets[0].data[0].rowData[0].values[0].dataValidation = { condition: { type: 'BOOLEAN' } }; }],
  ['unsafe number', s => { s.sheets[0].data[0].rowData[0].values[0] = { userEnteredValue: { numberValue: 1e99 } }; }],
  ['malformed union', s => { s.sheets[0].data[0].rowData[0].values[0].userEnteredValue.boolValue = true; }],
  ['overlong cell', s => { s.sheets[0].data[0].rowData[0].values[0].userEnteredValue.stringValue = 'x'.repeat(20001); }],
  ['duplicate tab identity', s => { s.sheets.push(structuredClone(s.sheets[0])); }],
  ['mismatched response id', s => { s.spreadsheetId = 'other'; }],
  ['wrong grid origin', s => { s.sheets[0].data[0].startColumn = 1; }],
]) test(`refuses ${label} instead of partial adoption`, () => { const source = fixture(); change(source); assert.throws(() => parse(source), errorCode('google_unsupported_sheet')); });
test('bounds and A1 parsing fail before HTTP', async () => {
  const adapter = createSimulatedGoogleAdapter({ origin: 'http://127.0.0.1:12345' });
  for (const range of ['A:A', 'A1:GS2', 'A1:A10001', 'A1:GR10000', 'A0:B1', 'B2:A1']) await assert.rejects(adapter.previewSheet({ spreadsheetId: 'example', ranges: [{ sheetTitle: 'Data', range }] }), e => ['invalid_google_ranges','google_range_bounds'].includes(e.code));
  for (const spreadsheetId of ['../token', 't.0', 'id/path', 'id?query', 'id#fragment']) await assert.rejects(adapter.previewSheet({ spreadsheetId, ranges: [] }), errorCode('invalid_google_id'));
});
test('documented t.0 tab ID is unchanged in insert and authoritative readback (mocked transport contract)', async t => {
  // Parent-supplied official example, not retrieved here:
  // https://developers.google.com/workspace/docs/api/samples/output-json
  const calls = [], returnedTabIds = [], plan = prepareGoogleDocDelivery(doc()); let inserted = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname, body = options.body && JSON.parse(options.body);
    calls.push({ path, method: options.method, body });
    let data;
    if (path === '/v1/documents' && options.method === 'POST') data = { documentId: 'fixture_doc', title: plan.title };
    else if (path === '/v1/documents/fixture_doc' && options.method === 'GET') {
      assert.equal(new URL(url).searchParams.get('includeTabsContent'), 'true');
      returnedTabIds.push('t.0');
      data = { documentId: 'fixture_doc', title: plan.title, revisionId: inserted ? 'revision_after' : 'revision_before', tabs: [{ tabProperties: { tabId: 't.0' }, documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: (inserted ? plan.text : '') + '\n' } }] } }] } } }] };
    } else if (path === '/v1/documents/fixture_doc:batchUpdate' && options.method === 'POST') {
      assert.deepEqual(body, { requests: [{ insertText: { location: { index: 1, tabId: 't.0' }, text: plan.text } }], writeControl: { requiredRevisionId: 'revision_before' } });
      inserted = true; data = { documentId: 'fixture_doc', replies: [{}] };
    } else assert.fail('unexpected request');
    const response = Response.json(data); Object.defineProperty(response, 'url', { value: String(url) }); return response;
  });
  const adapter = createSimulatedGoogleAdapter({ origin: 'http://127.0.0.1:12345', credentials: { accessToken: 'SIMULATED_CONTRACT' } });
  const result = await adapter.executeDocDelivery(plan, { operationId: 'dotted_tab', recordEffect: { async reserve() {}, async record() {} } });
  assert.equal(result.outcome, 'verified'); assert.equal(result.tabId, 't.0'); assert.equal(result.readbackRevisionId, 'revision_after');
  assert.deepEqual(returnedTabIds, ['t.0', 't.0']); assert.deepEqual(calls.map(c => c.method), ['POST', 'GET', 'POST', 'GET']);
});
test('plain native preparation has stable action digest and no mutations', () => {
  const input = doc(), before = structuredClone(input), plan = prepareGoogleDocDelivery(input);
  assert.equal(plan.text, 'Hello 🦉\nSecond paragraph'); assert.equal(plan.digest, prepareGoogleDocDelivery(input).digest); assert.deepEqual(input, before); assert.deepEqual(validateDocument(input), input); assert.ok(Object.isFrozen(plan));
});
for (const [label, mutate] of [
  ['bold', d => { d.body.textRuns = [{ st: 0, ed: 5, ts: { bl: 1 } }]; }],
  ['list', d => { d.body.paragraphs[0].bullet = { listId: 'list', listType: 'BULLET_LIST', nestingLevel: 0 }; }],
  ['paragraph styling', d => { d.body.paragraphs[0].paragraphStyle = { horizontalAlign: 2 }; }],
  ['page size', d => { d.documentStyle.pageSize.width = 999; }],
]) test(`native ${label} refused before delivery`, () => { const d = doc(); mutate(d); assert.throws(() => prepareGoogleDocDelivery(d), errorCode('google_plain_text_required')); });
test('Docs stripping and malformed unicode refused before create', () => {
  for (const content of ['', '\uE000', '\ud800']) assert.throws(() => prepareGoogleDocDelivery(blankDocument('source', 'Title', content)), errorCode('google_unsupported_document_text'));
});
test('simulation credential and origin boundaries are structural', () => {
  for (const origin of ['https://127.0.0.1:1234', 'http://localhost:1234', 'http://127.0.0.1:1234/path', 'http://user:pass@127.0.0.1:1234', 'http://example.com:1234', 'http://127.0.0.1:1234/?x=y']) assert.throws(() => createSimulatedGoogleAdapter({ origin }), errorCode('invalid_simulation_origin'));
  assert.throws(() => createSimulatedGoogleAdapter({ origin: 'http://127.0.0.1:1234', credentials: { accessToken: 'real-token-must-never-leave' } }), errorCode('invalid_credential_kind'));
  assert.throws(() => createGoogleAdapter({ credentials: { accessToken: 'SIMULATED_ACCESS' } }), errorCode('invalid_credential_kind'));
  assert.equal(createGoogleAdapter().provenance.connectionVerified, false);
});
test('missing token and journal fail closed; tampered preparation cannot create', async () => {
  const a = createSimulatedGoogleAdapter({ origin: 'http://127.0.0.1:12345' });
  await assert.rejects(a.previewSheet({ spreadsheetId: 'example', ranges: [{ sheetTitle: 'Data', range: 'A1:B2' }] }), errorCode('google_token_missing'));
  const plan = prepareGoogleDocDelivery(doc());
  await assert.rejects(a.executeDocDelivery(plan), errorCode('google_effect_journal_required'));
  await assert.rejects(a.executeDocDelivery({ ...plan, text: 'changed' }), errorCode('invalid_google_delivery_plan'));
  await assert.rejects(a.executeDocDelivery(plan, { recordEffect: { async reserve() {}, async record() {} } }), e => e.code === 'google_token_missing' && e.outcome === 'not_started');
});
