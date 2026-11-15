// Pure filesystem/constructor/transaction fakes. No filesystem/database opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/store.mjs';
import { NATIVE_UNIT } from '../src/native-collaboration.mjs';
import { nativeQualificationConfig, nativeDatabaseIdentity, inspectNativeStorage, provisionNativeStorage, openNativeStorage } from '../src/native-qualification-storage.mjs';
const env = { WORKAGENT_NATIVE_QUALIFICATION: 'synthetic-only', WORKAGENT_OWNER_ID: 'owner', WORKAGENT_AUTH_TOKEN: 'synthetic-owner-credential-at-least-32-characters', WORKAGENT_ORIGIN: 'http://127.0.0.1:8311', WORKAGENT_DATABASE_URL: 'postgresql://synthetic:DO-NOT-LOG@localhost/workagent_native_test', WORKAGENT_NATIVE_DATABASE_NAME: 'workagent_native_test', WORKAGENT_NATIVE_ROOT: '/private/native', WORKAGENT_NATIVE_SQLITE: '/private/native/content.sqlite', WORKAGENT_SYNTHETIC_ACCOUNTS_JSON: JSON.stringify([{ id: 'peer', name: 'Peer', token: 'synthetic-peer-credential-at-least-32-characters' }]) };
const pairID = 'a6d06e79-29b6-4c02-abed-723fb0fe7dc2', databaseID = 'database-fingerprint';
function fixture() {
  const config = nativeQualificationConfig(env), entries = new Map(), trace = [];
  let inode = 10, state = initialState('owner');
  function entry(path, directory, data = '') { const stat = { dev: 1, ino: inode++, uid: 1000, mode: directory ? 0o700 : 0o600, nlink: 1, size: data.length, isSymbolicLink: () => false, isDirectory: () => directory, isFile: () => !directory }; entries.set(path, { stat, data }); return stat; }
  entry('/', true); entry('/private', true);
  function find(path) { const v = entries.get(path); if (!v) throw Object.assign(Error('missing'), { code: 'ENOENT' }); return v; }
  const io = {
    async lstat(path) { return find(path).stat; },
    async readFile(path) { return find(path).data; },
    async readdir(path) { return [...entries.keys()].filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(k => k.slice(path.length + 1)); },
    async mkdir(path) { assert.equal(entries.has(path), false); trace.push('mkdir'); entry(path, true); },
    async open(path, flags) { assert.equal(flags, 'wx'); assert.equal(entries.has(path), false); trace.push('create-file'); entry(path, false); return { async close() {} }; },
    async writeFile(path, data, options) { assert.equal(options.flag, 'wx'); assert.equal(entries.has(path), false); trace.push('write-marker'); entry(path, false, data); },
  };
  const workspace = { store: { async read(fn) { return structuredClone(await fn(structuredClone(state))); }, async transaction(fn) { const next = structuredClone(state); const result = await fn(next); state = next; trace.push('transaction'); return result; } } };
  const args = { config, workspace, databaseID, io, uid: 1000, newID: () => pairID };
  const makeAdapter = () => { trace.push('constructor'); return { async dispose() { trace.push('dispose'); } }; };
  const createCollaboration = async options => { trace.push(options.allowCreate ? 'seed-permitted' : 'retained-only'); return { async close() {} }; };
  return { ...args, args, entries, trace, workspace, entry, makeAdapter, createCollaboration, mutate: fn => fn(state), open: () => openNativeStorage({ ...args, makeAdapter, createCollaboration }) };
}
test('all required config is validated before either writable store is reached; errors hide DSN/credentials', async () => {
  for (const key of Object.keys(env)) {
    const f = fixture(), bad = { ...env }; delete bad[key];
    await assert.rejects(async () => { const config = nativeQualificationConfig(bad); await openNativeStorage({ ...f.args, config, makeAdapter: f.makeAdapter }); }, e => !e.message.includes('DO-NOT-LOG') && !e.message.includes('postgresql://'));
    assert.deepEqual(f.trace, []);
  }
  for (const bad of [{ WORKAGENT_NATIVE_ROOT: 'relative' }, { WORKAGENT_NATIVE_SQLITE: '/foreign.sqlite' }, { WORKAGENT_PORT: 'NaN' }, { WORKAGENT_PORT: '65536' }, { WORKAGENT_NATIVE_DATABASE_NAME: 'installed' }, { WORKAGENT_SYNTHETIC_ACCOUNTS_JSON: 'DO-NOT-LOG' }]) assert.throws(() => nativeQualificationConfig({ ...env, ...bad }), e => !e.message.includes('DO-NOT-LOG'));
});
test('Parent provision creates only a fresh owned pair; startup/restart checks precede constructor', async () => {
  const f = fixture(); await provisionNativeStorage(f.args);
  assert.deepEqual(f.trace, ['mkdir', 'create-file', 'write-marker', 'transaction']);
  f.trace.length = 0; await f.open(); assert.deepEqual(f.trace, ['constructor', 'seed-permitted', 'transaction']);
  f.mutate(s => { s.nativeQualification.storage = Object.fromEntries(Object.entries(s.nativeQualification.storage).reverse()); }); // JSONB key order is immaterial.
  f.trace.length = 0; await f.open(); assert.deepEqual(f.trace, ['constructor', 'retained-only']);
  await assert.rejects(provisionNativeStorage(f.args), /already_exists/);
  assert.deepEqual(f.trace, ['constructor', 'retained-only']);
});
test('unmanaged, missing, foreign, moved, linked and mismatched files refuse without writes or constructor', async () => {
  const cases = [
    f => f.entries.delete('/private/native/qualification.json'),
    f => f.entries.delete('/private/native/content.sqlite'),
    f => { f.entries.get('/private').stat.isSymbolicLink = () => true; },
    f => { f.entries.get('/private/native/content.sqlite').stat.isSymbolicLink = () => true; },
    f => { f.entries.get('/private/native/content.sqlite').stat.ino++; },
    f => { f.entries.get('/private/native/content.sqlite').stat.nlink = 2; },
    f => { f.entries.get('/private/native').stat.mode = 0o777; },
    f => { f.entries.get('/private/native').stat.uid = 2000; },
    f => { f.entry('/private/native/content.sqlite-wal', false).isSymbolicLink = () => true; },
    f => { f.entry('/private/native/unknown-data', false); },
    f => { const marker = f.entries.get('/private/native/qualification.json'); const data = JSON.parse(marker.data); data.databaseID = 'foreign'; marker.data = JSON.stringify(data); },
    f => f.mutate(s => { s.nativeQualification.storage.pairID = 'foreign'; }),
    f => f.mutate(s => { delete s.works[NATIVE_UNIT].nativeIdentity; }),
    f => f.mutate(s => { s.owner = 'other-workspace'; }),
  ];
  for (const corrupt of cases) {
    const f = fixture(); await provisionNativeStorage(f.args); f.trace.length = 0; corrupt(f);
    await assert.rejects(f.open()); assert.deepEqual(f.trace, []);
  }
});
test('existing unmanaged root and old Workspace history are never retroactively adopted', async () => {
  const f = fixture(); f.entry('/private/native', true); f.entry('/private/native/content.sqlite', false, 'foreign-db-bytes');
  await assert.rejects(provisionNativeStorage(f.args)); assert.deepEqual(f.trace, []);
  const legacy = fixture(); legacy.mutate(s => { s.works[NATIVE_UNIT] = { nativeCollaboration: true }; });
  await assert.rejects(provisionNativeStorage(legacy.args)); assert.deepEqual(legacy.trace, []);
});
test('partial provisioning is retained and refuses rerun; writable-constructor failure does not mark ready', async () => {
  const f = fixture(); f.workspace.store.transaction = async () => { throw Error('db unavailable'); };
  await assert.rejects(provisionNativeStorage(f.args));
  assert.equal(f.entries.has('/private/native/content.sqlite'), true);
  f.trace.length = 0; await assert.rejects(provisionNativeStorage(f.args)); assert.deepEqual(f.trace, []);
  const good = fixture(); await provisionNativeStorage(good.args); good.trace.length = 0;
  await assert.rejects(openNativeStorage({ ...good.args, makeAdapter() { throw Error('secret DSN'); } }), /native_storage_open_failed/);
  assert.equal((await good.workspace.store.read(s => s.nativeQualification)).phase, 'provisioned');
  assert.deepEqual(good.trace, []);
});
test('database identity mismatch or query errors are read-only and redact driver messages', async () => {
  const config = nativeQualificationConfig(env);
  await assert.rejects(nativeDatabaseIdentity({ query: async () => ({ rows: [{ name: 'installed', oid: '1' }] }) }, config), /mismatch/);
  await assert.rejects(nativeDatabaseIdentity({ query: async () => { throw Error('postgresql://DO-NOT-LOG'); } }, config), e => e.message === 'native_database_identity_unavailable');
});
