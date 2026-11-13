// In-memory transaction fixtures; no PostgreSQL, HTTP or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
class MemoryStore { constructor(state) { this.state = state; } async transaction(fn) { const next = structuredClone(this.state); const out = await fn(next); this.state = next; return structuredClone(out); } }
test('document create, first draft, human save, stale proposal and revision-bound accept', async () => {
  const store = new MemoryStore(initialState('owner')), ws = new Workspace(store);
  const input = { commandId: 'new-doc', title: 'Brief', kind: 'document' };
  const made = await ws.createBlank('owner', input);
  assert.deepEqual(await ws.createBlank('owner', input), made);
  let w = await ws.get('owner', made.workId);
  assert.equal(w.kind, 'document'); assert.equal(w.book, undefined); assert.equal(w.intentRevision, 0);
  const draft = blankDocument(w.id, 'Brief', 'First draft');
  assert.equal((await ws.mutateDocument('owner', w.id, { commandId: 'model', expected: w.expected, document: draft })).status, 'applied');
  w = await ws.get('owner', w.id);
  const human = blankDocument(w.id, 'Human title', 'Human correction');
  await ws.save('owner', w.id, { commandId: 'save', document: human, contentRevision: w.contentRevision, permissionRevision: 1 });
  const p = await ws.mutateDocument('owner', w.id, { commandId: 'stale', expected: w.expected, document: draft });
  assert.equal(p.status, 'proposed');
  w = await ws.get('owner', w.id); assert.deepEqual(w.document, human);
  await ws.decide('owner', w.id, p.proposalId, { commandId: 'accept', decision: 'accept', expected: w.expected });
  assert.deepEqual((await ws.get('owner', w.id)).document, draft);
});
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileFixtureStore } from './support/file-fixture.mjs';
import { OwnedFiles, hashBytes } from '../src/owned-files.mjs';
import { DocumentExchange } from '../src/document-exchange.mjs';
import { CsvExchange } from '../src/exchange.mjs';
import { XlsxExchange } from '../src/xlsx-exchange.mjs';
import { Maintenance } from '../src/responsibilities.mjs';
import { documentText, validateDocument } from '../../../packages/workagent-contract/document.mjs';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
const malformedNative = [
  ['documentStyle null', d => d.documentStyle = null],
  ['documentStyle array', d => d.documentStyle = []],
  ['body null', d => d.body = null],
  ['body array', d => d.body = []],
  ['paragraphs null', d => d.body.paragraphs = null],
  ['textRuns null', d => d.body.textRuns = null],
  ['sections null', d => d.body.sectionBreaks = null],
  ['resources null', d => d.resources = null],
  ['resources object', d => d.resources = {}],
  ['resource sparse', d => d.resources = Array(1)],
  ['run sparse', d => d.body.textRuns = Array(1)],
  ['pageSize null', d => d.documentStyle.pageSize = null],
  ['pageSize array', d => d.documentStyle.pageSize = []],
  ['pageSize width', d => d.documentStyle.pageSize.width = -1],
  ['margin type', d => d.documentStyle.marginTop = '72'],
  ['paragraph null', d => d.body.paragraphs[0] = null],
  ['paragraphStyle null', d => d.body.paragraphs[0].paragraphStyle = null],
  ['paragraphStyle array', d => d.body.paragraphs[0].paragraphStyle = []],
  ['paragraph tabs', d => d.body.paragraphs[0].paragraphStyle = { tabStops: {} }],
  ['paragraph indent', d => d.body.paragraphs[0].paragraphStyle = { indentStart: null }],
  ['text run null', d => d.body.textRuns = [null]],
  ['text style array', d => d.body.textRuns = [{ st: 0, ed: 1, ts: [] }]],
  ['text style size', d => d.body.textRuns = [{ st: 0, ed: 1, ts: { fs: -3 } }]],
  ['text style color', d => d.body.textRuns = [{ st: 0, ed: 1, ts: { cl: [] } }]],
  ['section null', d => d.body.sectionBreaks = [null]],
  ['section columns', d => d.body.sectionBreaks[0].columnProperties = {}],
  ['resource null', d => d.resources = [null]],
  ['resource array', d => d.resources = [[]]],
  ['resource shape', d => d.resources = [{ name: 'DOC_WORD_STYLES_PLUGIN', data: {} }]],
  ...['sheetOrder', 'sheets', 'book', 'name', 'styles'].flatMap(k => [[], null, {}].map(v => [`foreign ${k}:${JSON.stringify(v)}`, d => d[k] = v])),
];
for (const [label, change] of malformedNative) test(`native document refuses ${label} before save, mutation or proposal commit`, async () => {
  const store = new MemoryStore(initialState('owner')), ws = new Workspace(store);
  const { workId } = await ws.createBlank('owner', { commandId: 'new', title: 'Native', kind: 'document' });
  const w = await ws.get('owner', workId), candidate = blankDocument(workId, 'Native', 'Text'); change(candidate);
  const fault = e => e instanceof Fault && e.status === 400;
  assert.throws(() => validateDocument(candidate), fault);
  const before = structuredClone(store.state);
  await assert.rejects(ws.save('owner', workId, { commandId: 'save', document: candidate, contentRevision: 1, permissionRevision: 1 }), fault);
  await assert.rejects(ws.mutateDocument('owner', workId, { commandId: 'mutate', document: candidate, expected: w.expected }), fault);
  assert.deepEqual(store.state, before);
  // Retained malformed proposal is refused atomically at acceptance too.
  store.state.works[workId].proposals.push({ id: 'bad', kind: 'document', status: 'pending', expected: w.expected, patch: { document: candidate } });
  const proposed = structuredClone(store.state);
  await assert.rejects(ws.decide('owner', workId, 'bad', { commandId: 'accept', decision: 'accept', expected: w.expected }), fault);
  assert.deepEqual(store.state, proposed);
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'documents-')), path = join(root, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), ws = new Workspace(store), files = new OwnedFiles(root);
  return { store, ws, files, exchange: new DocumentExchange({ workspace: ws, files }) };
}
test('document binding, access, grant, cancellation, source ownership and sheet-only controls', async () => {
  const { ws, store, files } = await fixture();
  const { workId } = await ws.createBlank('owner', { commandId: 'new', title: 'Doc', kind: 'document' });
  const w = await ws.get('owner', workId);
  await assert.rejects(ws.get('outsider', workId), /access_denied/);
  await assert.rejects(ws.save('owner', workId, { commandId: 'save-wrong', document: blankDocument('other'), contentRevision: 1, permissionRevision: 1 }), /workbook_identity/);
  await assert.rejects(ws.mutateDocument('owner', workId, { commandId: 'wrong', document: blankDocument('other'), expected: w.expected }), /document_identity/);
  await assert.rejects(ws.mutate('owner', workId, { commandId: 'sheet-edit', expected: w.expected, patch: { cells: [] } }), /sheet_required/);
  await assert.rejects(ws.command('owner', { commandId: 'source', kind: 'continue', workId, expectedIntentRevision: 0, text: 'Help', sourceIds: ['not-owned'] }), /source_access_denied/);
  await assert.rejects(ws.command('owner', { commandId: 'selection', kind: 'continue', workId, expectedIntentRevision: 0, text: 'Help', sourceIds: [], selection: { workId, sheetId: 'sheet1', contentRevision: 1, range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } } }), /invalid_selection/);
  const xlsx = new XlsxExchange({ workspace: ws, files, worker: { run() { assert.fail('document must not enter XLSX conversion'); } } });
  await assert.rejects(xlsx.export('owner', { workId }), /sheet_required/);
  const maintenance = new Maintenance({ workspace: ws, files });
  const source = await maintenance.publish('owner', { commandId: 'publish', name: 'Source', content: '{"value":2}', synthetic: true });
  await assert.rejects(maintenance.create('owner', workId, { commandId: 'maintain', sourceId: source.id, field: 'value', target: { sheetId: 'sheet1', row: 0, column: 0 }, intervalSeconds: 60, expected: w.expected }), /sheet_required/);
  await store.transaction(s => { s.permissionRevision++; });
  await assert.rejects(ws.save('owner', workId, { commandId: 'grant', document: w.document, contentRevision: 1, permissionRevision: 1 }), /save_conflict/);
  const p = await ws.mutateDocument('owner', workId, { commandId: 'stale-grant', document: blankDocument(workId, 'Draft', 'Candidate'), expected: w.expected });
  assert.equal(p.status, 'proposed');
  await ws.command('owner', { commandId: 'cancel', kind: 'cancel', workId, expectedIntentRevision: 0, sourceIds: [] });
  const stopped = await ws.get('owner', workId);
  await assert.rejects(ws.decide('owner', workId, p.proposalId, { commandId: 'accept-stale', decision: 'accept', expected: stopped.expected }), /proposal_conflict|work_cancelled/);
  assert.equal((await ws.get('owner', workId)).document.body.dataStream, '\r\n');
});
test('serialized human save wins over model mutation; newer human revision prevents proposal acceptance', async () => {
  const { ws } = await fixture();
  const { workId } = await ws.createBlank('owner', { commandId: 'new', title: 'Doc', kind: 'document' });
  const w = await ws.get('owner', workId), human = blankDocument(workId, 'Doc', 'Human'), candidate = blankDocument(workId, 'Doc', 'Model');
  const [saved, proposed] = await Promise.all([
    ws.save('owner', workId, { commandId: 'human', document: human, contentRevision: 1, permissionRevision: 1 }),
    ws.mutateDocument('owner', workId, { commandId: 'model', document: candidate, expected: w.expected }),
  ]);
  assert.equal(proposed.status, 'proposed'); assert.equal(saved.contentRevision, 2);
  const before = await ws.get('owner', workId);
  await ws.save('owner', workId, { commandId: 'newer', document: blankDocument(workId, 'Doc', 'Newer human'), contentRevision: 2, permissionRevision: 1 });
  await assert.rejects(ws.decide('owner', workId, proposed.proposalId, { commandId: 'accept', decision: 'accept', expected: before.expected }), /proposal_conflict/);
  const current = await ws.get('owner', workId);
  await assert.rejects(ws.decide('owner', workId, proposed.proposalId, { commandId: 'accept-current', decision: 'accept', expected: current.expected }), /proposal_conflict/);
  assert.equal(documentText(current.document), 'Newer human');
});
test('literal UTF-8 Markdown import owns exact original bytes, retries one identity and reopens edited export', async () => {
  const { ws, store, files, exchange } = await fixture();
  const bytes = Buffer.from('\ufeff# Title\r\n\r\n**literal** <script>no execution</script>\r\nUnicode 🌍\r\n');
  const input = { commandId: 'import', filename: 'brief.md', base64: bytes.toString('base64'), synthetic: true };
  const preview = await exchange.preview('owner', input); assert.match(preview.policy, /literally/);
  const made = await exchange.import('owner', input); assert.deepEqual(await exchange.import('owner', input), made);
  const w = await ws.get('owner', made.workId); assert.equal(w.humanDocument, true); assert.equal(w.intentRevision, 0);
  assert.equal(w.original.hash, hashBytes(bytes));
  const originals = new CsvExchange({ workspace: ws, files });
  assert.deepEqual((await originals.original('owner', w.id, w.original.id)).bytes, bytes);
  await assert.rejects(originals.original('outsider', w.id, w.original.id), /access_denied/);
  await assert.rejects(exchange.import('owner', { ...input, filename: 'changed.md' }), /command_conflict/);
  const next = blankDocument(w.id, 'Edited', documentText(w.document) + 'Added paragraph');
  await ws.save('owner', w.id, { commandId: 'save', document: next, contentRevision: 1, permissionRevision: 1 });
  const reopened = await exchange.import('owner', { ...input, commandId: 'reopen', base64: Buffer.from(documentText(next)).toString('base64') });
  assert.equal(documentText((await ws.get('owner', reopened.workId)).document), documentText(next));
  await store.transaction(s => { assert.equal(Object.keys(s.jobs).length, 0); assert.equal(Object.keys(s.works).length, 2); });
  assert.deepEqual((await originals.original('owner', w.id, w.original.id)).bytes, bytes);
});
test('unknown objects, hidden fields, malformed paragraphs/runs and invalid UTF-8 are refused', async () => {
  const { exchange } = await fixture();
  assert.throws(() => validateDocument(blankDocument('doc', '')), /invalid_document_title/);
  for (const change of [d => d.body.textRuns = [{ st: 0, ed: 2, ts: { hidden: true } }], d => d.body.tables = [{ startIndex: 0 }], d => d.headers = { hidden: { body: { dataStream: 'secret' } } }, d => d.body.paragraphs = [], d => d.body.textRuns = [{ st: 0, ed: 999, ts: { bl: 1 } }], d => d.resources = [{ name: 'unknown', data: 'hidden' }]]) {
    const d = blankDocument('doc', 'Title', 'Text'); change(d); assert.throws(() => validateDocument(d), /unsupported_document|invalid_document/);
  }
  await assert.rejects(exchange.preview('owner', { filename: 'bad.md', base64: Buffer.from([0xc0,0x80]).toString('base64'), synthetic: true }), /document_utf8_required/);
});
