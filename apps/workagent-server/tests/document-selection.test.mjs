// Deterministic durable file transactions and actual HTTP handler, no PG/network/model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
import { createHandler } from '../src/http.mjs';
import { blankDocument, documentSelectionText } from '../../../packages/workagent-contract/document.mjs';
const text = '  雪 🌍 é Ελληνικά العربية\nSecond paragraph\nKeep human wording.  ';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'document-selection-')), path = join(root, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), ws = new Workspace(store);
  const { workId } = await ws.createBlank('owner', { commandId: 'blank', kind: 'document', title: 'Body source' });
  const document = blankDocument(workId, 'Body source', text);
  document.body.textRuns = [{ st: 2, ed: 6, ts: { bl: 1 } }];
  await ws.save('owner', workId, { commandId: 'save', document, contentRevision: 1, permissionRevision: 1 });
  const selection = { kind: 'document', workId, documentId: workId, contentRevision: 2, segmentId: '', startOffset: 0, endOffset: document.body.dataStream.length - 1 };
  return { root, path, store, ws, workId, document, selection, state: async () => JSON.parse(await readFile(path, 'utf8')),
    ask: overrides => ({ commandId: 'ask', kind: 'continue', workId, expectedIntentRevision: 0, text: 'Explain this passage without editing.', sourceIds: [], selection: { ...selection, ...overrides } }) };
}
test('document context preserves native UTF-16, Unicode, whitespace, paragraph marks and formatting; replay is immutable', async () => {
  const f = await fixture(), input = f.ask();
  const result = await f.ws.command('owner', input);
  const admitted = await f.state();
  assert.equal(admitted.jobs.ask.selection.quote, f.document.body.dataStream.slice(0, -1));
  assert.deepEqual(admitted.works[f.workId].messages[0].selection, admitted.jobs.ask.selection);
  assert.equal(admitted.jobs.ask.selection.title, 'Body source');
  assert.deepEqual((await f.ws.get('owner', f.workId)).document, f.document);
  await f.ws.save('owner', f.workId, { commandId: 'later', document: blankDocument(f.workId, 'Later title', 'Later human text'), contentRevision: 2, permissionRevision: 1 });
  const reopened = new Workspace(new FileFixtureStore(f.path));
  assert.deepEqual(await reopened.command('owner', input), result);
  const job = await reopened.claim('owner'); assert.deepEqual(job.selection, admitted.jobs.ask.selection);
  assert.equal(job.selection.contentRevision, 2); assert.equal(job.work.contentRevision, 3);
  assert.equal(Object.keys((await f.state()).jobs).length, 1);
  await assert.rejects(() => reopened.command('owner', { ...input, selection: { ...input.selection, endOffset: 2 } }), /command_conflict/);
});
test('document admission rejects stale, wrong work/kind, forged and unsupported selections atomically', async () => {
  const f = await fixture(), before = await f.state();
  const bad = [ { kind: 'sheet' }, { kind: undefined }, { kind: 'board' }, { workId: 'other' }, { documentId: 'other' },
    { contentRevision: 1 }, { contentRevision: '2' }, { segmentId: 'header' }, { segmentId: undefined },
    { startOffset: -1 }, { startOffset: 1.5 }, { startOffset: '0' }, { startOffset: 2, endOffset: 2 },
    { startOffset: 6, endOffset: 4 }, { endOffset: 999 }, { endOffset: f.document.body.dataStream.length },
    { startOffset: 5 }, { endOffset: 5 }, { ranges: [] }, { quote: 'Forged text' }, { title: 'Forged title' },
    { sheetId: 'sheet1' }, { permission: 'overwrite' }, { range: { startOffset: 0, endOffset: 1 } } ];
  for (const selection of bad) {
    await assert.rejects(() => f.ws.command('owner', f.ask(selection)), /invalid_selection|invalid_document_selection|selection_conflict/);
    assert.deepEqual(await f.state(), before, JSON.stringify(selection));
  }
  await assert.rejects(() => f.ws.command('stranger', f.ask()), /access_denied/); assert.deepEqual(await f.state(), before);
  await assert.rejects(() => f.ws.command('owner', { ...f.ask(), workId: 'missing' }), /work_not_found/); assert.deepEqual(await f.state(), before);
  await assert.rejects(() => f.ws.command('owner', { ...f.ask(), kind: 'start' }), /invalid_selection/); assert.deepEqual(await f.state(), before);
});
test('document descriptor cannot select a sheet, and legacy sheet ranges cannot select a document', async () => {
  const f = await fixture(), { workId } = await f.ws.createBlank('owner', { commandId: 'sheet', title: 'Sheet' });
  const before = await f.state();
  await assert.rejects(() => f.ws.command('owner', { ...f.ask(), workId, selection: { ...f.selection, workId, documentId: workId, contentRevision: 1 } }), /invalid_document_selection/);
  await assert.rejects(() => f.ws.command('owner', { ...f.ask(), selection: { workId: f.workId, contentRevision: 2, sheetId: 'sheet1', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } } }), /invalid_selection/);
  assert.deepEqual(await f.state(), before);
});
test('selection limit refuses excess instead of truncating and rejects malformed native structure', async () => {
  const doc = blankDocument('large', 'Large', 'x'.repeat(10001));
  assert.equal(documentSelectionText(doc, { segmentId: '', startOffset: 0, endOffset: 10000 }).length, 10000);
  assert.throws(() => documentSelectionText(doc, { segmentId: '', startOffset: 0, endOffset: 10001 }), /invalid_document_selection/);
  doc.body.paragraphs = []; assert.throws(() => documentSelectionText(doc, { segmentId: '', startOffset: 0, endOffset: 2 }), /invalid_document_paragraphs/);
});
test('selected text edits retain whole-document human protection and acceptance', async () => {
  const f = await fixture(); await f.ws.command('owner', f.ask({ startOffset: 2, endOffset: 6 }));
  const w = await f.ws.get('owner', f.workId), changed = blankDocument(f.workId, 'Body source', 'Proposed replacement');
  const result = await f.ws.mutateDocument('owner', f.workId, { commandId: 'edit', expected: w.expected, document: changed });
  assert.equal(result.status, 'proposed');
  const proposed = await f.ws.get('owner', f.workId); assert.deepEqual(proposed.document, f.document); assert.equal(proposed.proposals[0].kind, 'document');
  await f.ws.decide('owner', f.workId, proposed.proposals[0].id, { commandId: 'accept', decision: 'accept', expected: proposed.expected });
  assert.deepEqual((await f.ws.get('owner', f.workId)).document, changed);
});
test('actual HTTP handler refuses forgery before dispatch and binds document source only on explicit send', async () => {
  const f = await fixture(), token = 'synthetic-token-at-least-32-characters', origin = 'https://private.example.test'; let wakes = 0;
  const handler = createHandler({ workspace: f.ws, owner: 'owner', token, origin, clientRoot: f.root, onCommand: () => wakes++ });
  async function post(input, authorized = true) {
    const req = Readable.from([Buffer.from(JSON.stringify(input))]); Object.assign(req, { url: '/api/work/commands', method: 'POST', headers: { origin, 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${token}` } : {}) } });
    let status, value; await handler(req, { setHeader() {}, writeHead(c) { status = c; }, end(b) { value = JSON.parse(b); } }); return { status, value };
  }
  const before = await f.state();
  assert.equal((await post(f.ask(), false)).status, 401);
  assert.equal((await post(f.ask({ quote: 'forged' }))).status, 400); assert.equal(wakes, 0); assert.deepEqual(await f.state(), before);
  const sent = await post(f.ask()); assert.equal(sent.status, 202); assert.equal(wakes, 1);
  assert.deepEqual(await post(f.ask()), sent); assert.equal(wakes, 1);
});
