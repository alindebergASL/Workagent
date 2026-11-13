import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactStorage, IndexedPayloadTransactions } from '../src/artifact-storage.ts';
import { AsyncPayloadTransactions } from './artifact-storage-fixture.mjs';
import { ApiError } from '../src/resume.ts';
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const disk = () => { const rows = new Map(); return { getItem: k => rows.get(k) ?? null, setItem: (k, v) => rows.set(k, v), removeItem: k => rows.delete(k) }; };
const input = { book: { id: 'one', sheets: {} }, contentRevision: 1, permissionRevision: 1 };
const pendingKey = 'workagent-maintenance:sheet-save:one:pending';
const draftKey = 'workagent-draft:one';
const legacySave = JSON.stringify({ key: 'save', path: '/work/one/save', input: { ...input, commandId: 'installed-command' } });

// Scripted IDB event-order driver, NOT an IndexedDB implementation. It tests
// the production adapter's completion/abort/error handling; Parent owns browser proof.
function idbEvents() {
  const transactions = [], rows = new Map(); let opens = 0, closed = 0, putError;
  const db = {
    createObjectStore() {}, close() { closed++; },
    transaction(name, mode, options) {
      assert.equal(name, 'payloads'); assert.equal(mode, 'readwrite'); assert.equal(options.durability, 'strict');
      const staged = new Map();
      const tx = {
        objectStore() { return {
          get(key) { const request = {}; queueMicrotask(() => { request.result = structuredClone(rows.get(key)); request.onsuccess(); }); return request; },
          put(value, key) { if (putError) throw putError; staged.set(key, structuredClone(value)); },
        }; },
        abort() { queueMicrotask(() => tx.onabort()); },
        complete() { for (const [key, value] of staged) rows.set(key, value); tx.oncomplete(); },
        fail(error) { tx.error = error; tx.onerror(); tx.onabort(); },
      }; transactions.push(tx); return tx;
    },
  };
  const factory = { open(name, version) { assert.equal(name, 'workagent-artifacts'); assert.equal(version, 1); opens++; const request = { result: db }; queueMicrotask(() => { request.onupgradeneeded(); request.onsuccess(); }); return request; } };
  return { factory, transactions, rows, db, get opens() { return opens; }, get closed() { return closed; }, setPutError(error) { putError = error; } };
}

test('production IDB adapter waits for transaction complete after request success', async () => {
  const driver = idbEvents(), transactions = new IndexedPayloadTransactions(() => driver.factory); let finished = false;
  const writing = transactions.change('draft:one', slot => { slot.value = { id: '1', raw: 'native' }; return 'done'; }).then(value => { finished = true; return value; });
  await tick(); assert.equal(finished, false); assert.equal(driver.rows.size, 0);
  driver.transactions[0].complete(); assert.equal(await writing, 'done'); assert.equal(driver.rows.get('draft:one').value.raw, 'native');
  driver.db.onversionchange(); assert.equal(driver.closed, 1);
  const next = transactions.change('draft:one', slot => slot.value); await tick(); assert.equal(driver.opens, 2); driver.transactions[1].complete(); assert.equal((await next).raw, 'native');
});
for (const abort of [true, false]) test(`production IDB multi-key settlement is atomic at transaction completion; abort ${abort}`, async () => {
  const driver = idbEvents(), transactions = new IndexedPayloadTransactions(() => driver.factory);
  const save = { value: { id: 'command', raw: 'exact request' }, retired: ['legacy-save'] };
  const draft = { value: { id: 'draft', raw: 'revision 1 B' }, retired: ['legacy-draft'] };
  driver.rows.set('save:one', save); driver.rows.set('draft:one', draft);
  let finished = false;
  const settling = transactions.changeMany(['save:one', 'draft:one'], slots => {
    assert.deepEqual(slots, [save, draft]); slots[0].value = null; slots[1].value = { id: 'rebased', raw: 'revision 2 B' };
  }).then(() => { finished = true; });
  const rejected = abort ? assert.rejects(settling, /aborted/) : null;
  await tick(); assert.equal(driver.transactions.length, 1); assert.equal(finished, false);
  assert.deepEqual(driver.rows.get('save:one'), save); assert.deepEqual(driver.rows.get('draft:one'), draft);
  if (abort) { driver.transactions[0].abort(); await rejected; assert.deepEqual(driver.rows.get('save:one'), save); assert.deepEqual(driver.rows.get('draft:one'), draft); }
  else { driver.transactions[0].complete(); await settling; assert.equal(driver.rows.get('save:one').value, null); assert.equal(driver.rows.get('draft:one').value.raw, 'revision 2 B'); }
});
for (const mode of ['abort-after-request-success', 'quota-on-put']) test(`production IDB adapter rejects ${mode} without claiming durability`, async () => {
  const driver = idbEvents(), transactions = new IndexedPayloadTransactions(() => driver.factory);
  if (mode === 'quota-on-put') driver.setPutError(new DOMException('full', 'QuotaExceededError'));
  const write = transactions.change('draft:one', slot => { slot.value = { id: '1', raw: 'native' }; });
  const rejected = assert.rejects(write, mode === 'quota-on-put' ? /full/ : /aborted/);
  await tick(); if (mode !== 'quota-on-put') driver.transactions[0].abort(); await rejected; assert.equal(driver.rows.size, 0);
});
test('production IDB adapter exposes open denial, unavailable API, and blocked upgrade; retries can reopen', async () => {
  let mode = 'denied', closed = 0;
  const factory = { open() {
    if (mode === 'missing') throw new ReferenceError('indexedDB unavailable');
    const request = { error: new DOMException('denied', 'SecurityError'), result: { close() { closed++; } } };
    queueMicrotask(() => { if (mode === 'blocked') { request.onblocked(); request.onsuccess(); } else request.onerror(); }); return request;
  } };
  const transactions = new IndexedPayloadTransactions(() => factory);
  await assert.rejects(transactions.change('x', () => {}), /denied/);
  mode = 'missing'; await assert.rejects(transactions.change('x', () => {}), /unavailable/);
  mode = 'blocked'; await assert.rejects(transactions.change('x', () => {}), /blocked/); assert.equal(closed, 1);
});

test('async fixture: simultaneous prepare has one exact durable Save identity', async () => {
  const tx = new AsyncPayloadTransactions(), storage = disk(), a = new ArtifactStorage(storage, tx), b = new ArtifactStorage(storage, tx), gate = deferred();
  tx.complete = () => gate.promise;
  const first = a.prepareSave('one', input, () => 'first'), second = b.prepareSave('one', { ...input, book: { id: 'one', changed: true } }, () => 'second');
  await tick(); assert.equal(tx.rows.size, 0); gate.resolve(); assert.deepEqual(await first, await second);
  const reload = new ArtifactStorage(storage, tx); assert.deepEqual(await reload.readSave('one'), await first);
});
for (const key of [draftKey, pendingKey]) test(`legacy ${key}: adoption abort retains original; replacement commits before retirement`, async () => {
  const storage = disk(), tx = new AsyncPayloadTransactions(), store = new ArtifactStorage(storage, tx), gate = deferred(), entered = deferred();
  const raw = key === pendingKey ? legacySave : JSON.stringify({ book: { id: 'one' }, revision: 1, permission: 1 }); storage.setItem(key, raw);
  const read = () => key === pendingKey ? store.readSave('one') : store.readDraft('one');
  tx.complete = () => { entered.resolve(); return gate.promise; }; const result = read(), rejected = assert.rejects(result, /artifact_storage_unavailable/);
  await entered.promise; assert.equal(storage.getItem(key), raw); gate.reject(new Error('transaction aborted')); await rejected;
  assert.equal(storage.getItem(key), raw); assert.equal(tx.rows.size, 0);
  tx.complete = async () => {}; const adopted = await read(); assert.equal(key === pendingKey ? adopted.record.raw : adopted.raw, raw); assert.equal(storage.getItem(key), null);
});
test('legacy tombstones prevent re-adoption after settlement even when local removal was denied', async () => {
  const storage = disk(), tx = new AsyncPayloadTransactions(), store = new ArtifactStorage(storage, tx);
  storage.setItem(pendingKey, legacySave); storage.setItem(draftKey, 'native'); storage.removeItem = () => { throw new Error('denied'); };
  const save = await store.readSave('one'), draft = await store.readDraft('one');
  assert.equal(save.request.input.commandId, 'installed-command'); await store.accepted('one', save); await store.replaceDraft('one', draft, null);
  const reload = new ArtifactStorage(storage, tx); assert.equal(await reload.readSave('one'), null); assert.equal(await reload.readDraft('one'), null);
  assert.equal(storage.getItem(pendingKey), legacySave); assert.equal(storage.getItem(draftKey), 'native');
});
test('legacy conflict preserves both unresolved identities and a changed legacy record is never retired', async () => {
  const storage = disk(), tx = new AsyncPayloadTransactions(), store = new ArtifactStorage(storage, tx);
  const first = await store.prepareSave('one', input, () => 'new-client'); storage.setItem(pendingKey, legacySave);
  await assert.rejects(store.readSave('one'), /legacy_artifact_conflict/); assert.equal(storage.getItem(pendingKey), legacySave); assert.deepEqual(tx.rows.get('save:one').value, first.record);
  const other = disk(), t = new AsyncPayloadTransactions(), s = new ArtifactStorage(other, t); other.setItem(pendingKey, legacySave);
  t.complete = async () => { other.setItem(pendingKey, legacySave.replace('installed-command', 'newer-legacy')); };
  await s.readSave('one'); assert.match(other.getItem(pendingKey), /newer-legacy/);
});
test('matching-only settlement protects newer draft, pending command, and another work', async () => {
  const store = new ArtifactStorage(disk(), new AsyncPayloadTransactions());
  const first = await store.prepareSave('one', input, () => 'a'), a = await store.writeDraft('one', 'A'), b = await store.writeDraft('one', 'B');
  assert.equal((await store.replaceDraft('one', a, null)).matched, false); assert.deepEqual(await store.readDraft('one'), b);
  await store.accepted('one', first); const next = await store.prepareSave('one', input, () => 'b');
  assert.equal(await store.accepted('one', first), false); assert.deepEqual(await store.readSave('one'), next);
  assert.equal(await store.accepted('two', next), false); assert.deepEqual(await store.readSave('one'), next); assert.equal(await store.readDraft('two'), null);
});
test('atomic Save settlement retains foreign drafts and pending commands byte-for-byte', async () => {
  const store = new ArtifactStorage(disk(), new AsyncPayloadTransactions());
  const first = await store.prepareSave('one', input, () => 'a'), owned = await store.writeDraft('one', 'A'), foreign = await store.writeDraft('one', 'foreign B');
  assert.deepEqual(await store.settleSave('one', first, owned, 'rebased A'), { accepted: true, matched: false, value: null });
  assert.deepEqual(await store.readDraft('one'), foreign); assert.deepEqual(await store.readSave('one'), first);
  await store.accepted('one', first); const newer = await store.prepareSave('one', input, () => 'newer');
  assert.equal((await store.settleSave('one', first, foreign, null)).accepted, false);
  assert.deepEqual(await store.readDraft('one'), foreign); assert.deepEqual(await store.readSave('one'), newer);
});
test('legacy atomic settlement abort retains both originals; committed tombstones prevent resurrection', async () => {
  const storage = disk(), tx = new AsyncPayloadTransactions(), store = new ArtifactStorage(storage, tx);
  storage.setItem(pendingKey, legacySave); storage.setItem(draftKey, 'human B'); storage.removeItem = () => { throw new Error('denied'); };
  const save = await store.readSave('one'), draft = await store.readDraft('one');
  tx.complete = async key => { if (key === 'draft:one') throw new Error('abort rebase'); };
  await assert.rejects(store.settleSave('one', save, draft, 'rebased B'), /artifact_storage_unavailable/);
  assert.equal(tx.rows.get('save:one').value.raw, legacySave); assert.equal(tx.rows.get('draft:one').value.raw, 'human B');
  assert.equal(storage.getItem(pendingKey), legacySave); assert.equal(storage.getItem(draftKey), 'human B');
  tx.complete = async () => {}; await store.settleSave('one', save, draft, 'rebased B');
  const reload = new ArtifactStorage(storage, tx); assert.equal(await reload.readSave('one'), null); assert.equal((await reload.readDraft('one')).raw, 'rebased B');
});
test('definitive refusals settle only their command; ambiguous and access failures retain exact retry', async () => {
  const store = new ArtifactStorage(disk(), new AsyncPayloadTransactions()), save = await store.prepareSave('one', input, () => 'a');
  for (const error of [new Error('lost ACK'), new ApiError('/work/one/save', 403, 'access_denied'), new ApiError('/work/other/save', 400, 'invalid')]) {
    await store.rejected('one', error, save); assert.deepEqual(await store.readSave('one'), save);
  }
  await store.rejected('one', new ApiError('/work/one/save', 409, 'save_conflict'), save); assert.equal(await store.readSave('one'), null);
});
test('malformed and foreign legacy Save records stay retained without a replacement command', async () => {
  for (const raw of ['{', legacySave.replace('/work/one/save', '/work/other/save')]) {
    const storage = disk(), tx = new AsyncPayloadTransactions(), store = new ArtifactStorage(storage, tx); storage.setItem(pendingKey, raw);
    await assert.rejects(store.prepareSave('one', input, () => assert.fail('new ID')), /invalid_pending_save/);
    assert.equal(storage.getItem(pendingKey), raw); assert.equal(tx.rows.size, 0);
  }
});
