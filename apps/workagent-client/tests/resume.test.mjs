import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, ProductCursor, ComposerDrafts } from '../src/resume.ts';
const reset = cursor => ({ kind: 'reset', cursor, events: [], works: [], snapshots: [] });
test('replay cursor advances only after application, rejects gaps and stale responses, accepts reset', () => {
  const cursor = new ProductCursor(); const initial = cursor.request();
  assert.equal(cursor.apply(initial, reset(4), () => {}), true);
  const failed = cursor.request();
  assert.throws(() => cursor.apply(failed, { ...reset(5), kind: 'events', events: [{ eventId: 5 }] }, () => { throw new Error('apply failed'); }));
  assert.equal(cursor.after, 4);
  assert.throws(() => cursor.apply(cursor.request(), { ...reset(6), kind: 'events', events: [{ eventId: 6 }] }, () => {}), /event_gap/);
  const old = cursor.request(), latest = cursor.request();
  assert.equal(cursor.apply(latest, reset(300), () => {}), true);
  assert.equal(cursor.apply(old, reset(5), () => { throw new Error('stale applied'); }), false);
  assert.equal(cursor.after, 300);
});
function storage() { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; }
test('unsent composers and attached source drafts survive reload and remain scoped to their work', () => {
  const disk = storage(), drafts = new ComposerDrafts(disk);
  drafts.write(null, { prompt: 'new work', sourceName: 'new.csv', sourceText: '1,2' });
  drafts.write('first', { prompt: 'steer first', sourceName: 'first.csv', sourceText: '3,4' });
  const reopened = new ComposerDrafts(disk);
  assert.equal(reopened.read(null).prompt, 'new work'); assert.equal(reopened.read('first').prompt, 'steer first');
  assert.equal(reopened.read('second').prompt, '');
  const sent = reopened.read('first');
  reopened.write('first', { ...sent, prompt: 'typed while sending' });
  assert.equal(reopened.clearIfUnchanged('first', sent), false);
  assert.equal(reopened.read('first').prompt, 'typed while sending');
  assert.equal(reopened.clearIfUnchanged(null, reopened.read(null)), true);
  assert.equal(reopened.read('first').sourceText, '3,4');
});
test('a lost admission acknowledgement retains command and source IDs across reload and later revisions', () => {
  const disk = storage(), drafts = new ComposerDrafts(disk), draft = { prompt: 'run once', sourceName: 'data', sourceText: 'synthetic' };
  let ids = 0; const makeId = () => `id-${++ids}`;
  const first = drafts.submission('work', draft, 1, makeId);
  const reopened = new ComposerDrafts(disk);
  assert.deepEqual(reopened.submission('work', draft, 2, makeId), first); assert.equal(ids, 2);
  assert.throws(() => reopened.submission('work', { ...draft, prompt: 'different' }, 2, makeId), /unresolved_send/);
  reopened.accepted('work', first.commandId); assert.equal(reopened.pending('work'), null);
});
test('navigation-refused event application keeps its cursor and retries the same committed mutation', () => {
  const cursor = new ProductCursor(); cursor.apply(cursor.request(), reset(4), () => {});
  let navigation = 1, installed = { id: 'B', contentRevision: 0 };
  const ticket = cursor.request(), requestedNavigation = navigation;
  // GET B was read before the mutation; its older snapshot opens during this poll.
  navigation++; installed = { id: 'B', contentRevision: 0 };
  const batch = { ...reset(5), kind: 'events', events: [{ eventId: 5 }], snapshots: [{ id: 'B', contentRevision: 1 }] };
  assert.equal(cursor.apply(ticket, batch, value => {
    if (requestedNavigation !== navigation) return false;
    installed = value.snapshots[0];
  }), false);
  assert.equal(cursor.after, 4, 'refused snapshots must not consume their replay cursor');
  assert.equal(installed.contentRevision, 0);
  const retryNavigation = navigation;
  assert.equal(cursor.apply(cursor.request(), batch, value => {
    if (retryNavigation !== navigation) return false;
    installed = value.snapshots[0];
  }), true);
  assert.equal(cursor.after, 5); assert.equal(installed.contentRevision, 1);
});
test('a refused initial snapshot reset leaves the initial cursor unset', () => {
  const cursor = new ProductCursor();
  assert.equal(cursor.apply(cursor.request(), reset(20), () => false), false);
  assert.equal(cursor.after, undefined);
  assert.equal(cursor.apply(cursor.request(), reset(20), () => {}), true);
});
// Exercise the actual admission handlers without sockets, database or providers.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
import { createHandler } from '../../workagent-server/src/http.mjs';
async function admissionFixture() {
  const root = await mkdtemp(join(tmpdir(), 'workagent-client-rejection-')), path = join(root, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const ws = new Workspace(new FileFixtureStore(path));
  const token = 'synthetic-client-rejection-access-key-32', origin = 'https://private.example.test';
  const handler = createHandler({ workspace: ws, owner: 'owner', token, origin, clientRoot: root });
  async function api(path, input) {
    const req = Readable.from([Buffer.from(JSON.stringify(input))]);
    Object.assign(req, { method: 'POST', url: `/api${path}`, headers: { 'content-type': 'application/json', origin, authorization: `Bearer ${token}` } });
    let status, result;
    await handler(req, { setHeader() {}, writeHead(code) { status = code; }, end(raw) { result = JSON.parse(raw); } });
    if (status >= 400) throw new ApiError(path, status, result.error);
    return result;
  }
  async function send(submission) {
    const { draft } = submission, sourceIds = [];
    if (draft.sourceText.trim()) sourceIds.push((await api('/sources', { commandId: submission.sourceCommandId, name: draft.sourceName, content: draft.sourceText, synthetic: true })).id);
    return api('/work/commands', { commandId: submission.commandId, kind: 'start', text: draft.prompt, sourceIds });
  }
  return { ws, send };
}
const validDraft = { prompt: 'Use synthetic input', sourceName: 'data.csv', sourceText: '1,2' };
for (const [name, change, endpoint] of [
  ['empty source name', { sourceName: '   ' }, '/sources'],
  ['oversized source name', { sourceName: 'n'.repeat(201) }, '/sources'],
  ['oversized source content', { sourceText: 'x'.repeat(200001) }, '/sources'],
  ['overlength prompt', { prompt: 'x'.repeat(50001) }, '/work/commands'],
]) {
  test(`confirmed invalid_text for ${name} releases only rejected IDs and permits correction`, async () => {
    const { ws, send } = await admissionFixture(), drafts = new ComposerDrafts(storage());
    let ids = 0; const makeId = () => `id-${++ids}`, bad = { ...validDraft, ...change };
    drafts.write(null, bad);
    const first = drafts.submission(null, bad, undefined, makeId);
    await assert.rejects(send(first), error => {
      assert.equal(error.status, 400); assert.equal(error.code, 'invalid_text'); assert.equal(error.path, endpoint);
      assert.equal(drafts.rejected(null, first.commandId, error), true);
      return true;
    });
    assert.equal(drafts.pending(null), null); assert.deepEqual(drafts.read(null), bad, 'validation must preserve the editable draft');
    assert.equal((await ws.list('owner')).length, 0);
    drafts.write(null, validDraft);
    const corrected = drafts.submission(null, validDraft, undefined, makeId);
    assert.notEqual(corrected.commandId, first.commandId);
    const result = await send(corrected); drafts.accepted(null, corrected.commandId);
    assert.equal((await ws.list('owner')).length, 1); assert.equal((await ws.get('owner', result.workId)).messages[0].text, validDraft.prompt);
  });
}
test('ambiguous, unrelated and untyped errors cannot release pending admission IDs', () => {
  const drafts = new ComposerDrafts(storage()); let ids = 0;
  const first = drafts.submission(null, validDraft, undefined, () => `id-${++ids}`);
  for (const error of [new Error('intent_conflict'), new Error('invalid_text'), new TypeError('Failed to fetch'),
    new ApiError('/work/commands', 500, 'invalid_text'), new ApiError('/work/commands', 400, 'unknown_error'),
    new ApiError('/work/commands', 409, 'command_conflict'), new ApiError('/work/commands', 403, 'source_access_denied'),
    new ApiError('/work/other/save', 400, 'invalid_text'), new ApiError('/sources', 409, 'intent_conflict')]) {
    assert.equal(drafts.rejected(null, first.commandId, error), false);
    assert.equal(drafts.pending(null).commandId, first.commandId);
  }
  assert.equal(drafts.rejected(null, 'unrelated-command', new ApiError('/work/commands', 400, 'invalid_text')), false);
  assert.equal(drafts.rejected(null, first.commandId, new ApiError('/work/commands', 409, 'intent_conflict')), true);
});
test('lost response after actual admission keeps exact IDs across reload and replays one work', async () => {
  const { ws, send } = await admissionFixture(), disk = storage(), drafts = new ComposerDrafts(disk);
  let ids = 0; const makeId = () => `id-${++ids}`;
  const first = drafts.submission(null, validDraft, undefined, makeId), accepted = await send(first);
  assert.equal(drafts.rejected(null, first.commandId, new TypeError('Lost response')), false);
  const reopened = new ComposerDrafts(disk), retry = reopened.submission(null, validDraft, undefined, makeId);
  assert.equal(retry.commandId, first.commandId); assert.equal(retry.sourceCommandId, first.sourceCommandId); assert.equal(ids, 2);
  assert.deepEqual(await send(retry), accepted); assert.equal((await ws.list('owner')).length, 1);
});

const docAttachment = { kind: 'document', workId: 'doc', documentId: 'doc', contentRevision: 2, segmentId: '', startOffset: 0, endOffset: 4, quote: '🌍\r ', title: 'Source', editorId: 'native-instance', selectionEpoch: 4, contentEpoch: 6 };
const docContext = { kind: 'document', workId: 'doc', documentId: 'doc', contentRevision: 3, segmentId: '', startOffset: 0, endOffset: 4 };
test('document editable attachment and immutable saved context survive reload separately and stay per-work', () => {
  const disk = storage(), drafts = new ComposerDrafts(disk), draft = { prompt: 'Explain', sourceName: 'Data', sourceText: '', selection: docAttachment };
  drafts.write('doc', draft); const submitted = drafts.submission('doc', draft, 0, () => 'id', docContext);
  const reload = new ComposerDrafts(disk);
  assert.deepEqual(reload.read('doc'), draft); assert.deepEqual(reload.pending('doc'), submitted);
  assert.equal(reload.pending('doc').selection.contentRevision, 3); assert.equal(reload.read('doc').selection.contentRevision, 2);
  assert.equal(reload.pending('other'), null); assert.equal(reload.read('other').selection, undefined);
});
test('send ownership survives sibling settlement without clearing a newer pending command', () => {
  const disk = storage(), a = new ComposerDrafts(disk), b = new ComposerDrafts(disk), draft = { prompt: 'Original', sourceName: '', sourceText: '', selection: docAttachment };
  a.write('doc', draft); const original = a.submission('doc', draft, 0, () => 'original', docContext);
  assert.deepEqual(b.pending('doc'), original); b.accepted('doc', original.commandId);
  const newer = b.submission('doc', { ...draft, prompt: 'New request' }, 1, () => 'newer', docContext);
  assert.deepEqual(a.submission('doc', draft, 1, () => assert.fail('new ID'), docContext), original);
  a.accepted('doc', original.commandId); assert.deepEqual(new ComposerDrafts(disk).pending('doc'), newer);
});
test('malformed/unsupported composer and pending storage is refused without overwriting retained bytes or issuing IDs', () => {
  const good = { prompt: 'Keep this message', sourceName: 'Source', sourceText: '' };
  for (const value of [null, [], { ...good, selection: {} }, { ...good, selection: { ...docAttachment, editorId: undefined } }, { ...good, selection: { ...docAttachment, kind: 'board' } }, { ...good, selection: { ...docAttachment, workId: 'other' } }]) {
    const disk = storage(), drafts = new ComposerDrafts(disk), raw = JSON.stringify(value);
    disk.setItem('workagent-composer:doc', raw); assert.throws(() => drafts.read('doc'), /invalid_composer_draft/);
    assert.throws(() => drafts.write('doc', good), /invalid_composer_draft/); assert.equal(disk.getItem('workagent-composer:doc'), raw);
  }
  for (const value of [null, {}, { commandId: 'old', sourceCommandId: 'source', draft: good }, { commandId: 'old', sourceCommandId: 'source', intentRevision: 0, draft: { ...good, selection: docAttachment } }, { commandId: 'old', sourceCommandId: 'source', intentRevision: 0, draft: good, selection: docContext }]) {
    const disk = storage(), drafts = new ComposerDrafts(disk), raw = JSON.stringify(value); drafts.write('doc', good);
    disk.setItem('workagent-composer:doc:send', raw); assert.throws(() => drafts.pending('doc'), /invalid_pending_send/);
    assert.throws(() => drafts.submission('doc', good, 0, () => assert.fail('new ID')), /invalid_pending_send/);
    assert.equal(disk.getItem('workagent-composer:doc:send'), raw); assert.deepEqual(drafts.read('doc'), good);
  }
});
