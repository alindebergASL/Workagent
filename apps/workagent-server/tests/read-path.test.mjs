// Synthetic query/JSON costs only: no PostgreSQL, credentials, model or native editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresStore, initialState } from '../src/store.mjs';
import { Workspace } from '../src/workspace.mjs';
import { Maintenance } from '../src/responsibilities.mjs';
import { createHandler } from '../src/http.mjs';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
import { workload } from '../../workagent-client/tests/sheet-scale-fixture.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const token = 'synthetic-read-fixture-token-at-least-32-characters';
function state(populated = 1000) {
  const s = initialState('owner');
  const common = { contentRevision: 1, intentRevision: 0, cancellationEpoch: 0, messages: [], proposals: [], humanCells: [], sourceIds: [], status: 'ready' };
  s.works.large = { ...common, id: 'large', book: { ...workload(populated), id: 'large' } };
  s.works.small = { ...common, id: 'small', kind: 'document', document: blankDocument('small', 'Small document', 'Human text'), humanDocument: true };
  s.ownedSources.mine = { id: 'mine', owner: 'owner', name: 'Synthetic source', revision: 1, status: 'active', fields: ['units'] };
  s.ownedSources.foreign = { id: 'foreign', owner: 'other', name: 'Private other source', revision: 1, status: 'active', fields: ['secret'] };
  return s;
}
function queryFixture(seed) {
  let committed = JSON.stringify(seed);
  const calls = [], writes = [];
  const select = (sql, args) => {
    calls.push(sql); assert.equal(args[0], 'owner');
    return { rows: [{ data: JSON.parse(committed) }] };
  };
  const pool = {
    async query(sql, args) { assert.match(sql, /^SELECT /); assert.doesNotMatch(sql, /FOR UPDATE/); return select(sql, args); },
    async connect() {
      let pending;
      return { async query(sql, args) {
        if (sql.startsWith('SELECT')) return select(sql, args);
        calls.push(sql);
        if (sql.startsWith('UPDATE')) { assert.equal(args[0], 'owner'); pending = args[1]; writes.push(Buffer.byteLength(pending)); }
        if (sql === 'COMMIT' && pending !== undefined) committed = pending;
        return { rows: [] };
      }, release() {} };
    },
  };
  const store = new PostgresStore(pool, 'owner'), workspace = new Workspace(store);
  const maintenance = new Maintenance({ workspace });
  let accountingReads = 0;
  const handler = createHandler({ workspace, maintenance, owner: 'owner', token, origin: 'https://private.test', clientRoot: tmpdir(), accounting: { async status() { return { reads: ++accountingReads }; } } });
  async function get(url, authorized = true) {
    const req = Readable.from([]); Object.assign(req, { method: 'GET', url, headers: authorized ? { authorization: `Bearer ${token}` } : {} });
    let status, body;
    await handler(req, { setHeader() {}, writeHead(code) { status = code; }, end(raw) { body = JSON.parse(raw); } });
    return { status, body };
  }
  return { pool, store, workspace, maintenance, get, calls, writes, raw: () => committed };
}

test('lightweight read profile: canonical 100k workbook causes no write transactions', async t => {
  const f = queryFixture(state(100_000)), before = hash(f.raw()), measurements = [];
  for (const route of ['/api/owned-sources', '/api/work/small', '/api/work', '/api/events?after=0', '/api/accounting']) {
    const count = f.calls.length, writes = f.writes.length, start = performance.now();
    const response = await f.get(route);
    assert.equal(response.status, 200);
    measurements.push({ route, ms: +(performance.now() - start).toFixed(2), statements: f.calls.length - count, writes: f.writes.length - writes });
    if (route === '/api/owned-sources') assert.deepEqual(response.body.map(s => s.id), ['mine']);
    if (route === '/api/work/small') assert.equal(response.body.document.body.dataStream, 'Human text\r\n');
    if (route === '/api/events?after=0') assert.deepEqual(response.body.snapshots, []);
  }
  t.diagnostic(JSON.stringify({ synthetic: true, populatedCells: 100000, stateBytes: Buffer.byteLength(f.raw()), serializedUpdateBytes: f.writes.reduce((a, b) => a + b, 0), measurements }));
  assert.equal(hash(f.raw()), before, 'GETs must preserve every retained field');
  assert.equal(f.writes.length, 0, 'GETs must never serialize/write the workspace');
  assert.ok(measurements.every(m => m.statements === 1), 'one fresh SELECT per GET');
});

test('reads retain full reset snapshots, detach results and observe another store write/revocation', async () => {
  const f = queryFixture(state()), writer = new PostgresStore(f.pool, 'owner');
  const original = await f.workspace.get('owner', 'large');
  const reset = await f.workspace.events('owner');
  assert.equal(reset.kind, 'reset'); assert.equal(reset.cursor, 0);
  assert.equal(hash(reset.snapshots.find(w => w.id === 'large').book), hash(original.book));
  reset.snapshots[0].book.name = 'client mutation';
  assert.equal(hash((await f.workspace.get('owner', 'large')).book), hash(original.book));
  await assert.rejects(f.workspace.get('intruder', 'small'), /access_denied/);
  await assert.rejects(f.maintenance.sources('intruder'), /access_denied/);
  assert.equal((await f.get('/api/work', false)).status, 401);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const write = writer.transaction(async s => {
    s.works.small.document.body.dataStream = 'Committed human edit\r\n';
    s.works.small.contentRevision++; s.permissionRevision++;
    s.ownedSources.mine.status = 'revoked'; s.ownedSources.mine.revision++;
    entered.resolve(); await release.promise;
  });
  await entered.promise;
  assert.equal((await f.workspace.get('owner', 'small')).contentRevision, 1, 'no dirty read');
  release.resolve(); await write;
  const fresh = await f.workspace.get('owner', 'small');
  assert.equal(fresh.document.body.dataStream, 'Committed human edit\r\n');
  assert.equal(fresh.contentRevision, 2); assert.equal(fresh.expected.permissionRevision, 2);
  assert.equal((await f.maintenance.sources('owner'))[0].status, 'revoked');
  assert.equal((await f.get('/api/accounting')).body.reads, 1);
  assert.equal((await f.get('/api/accounting')).body.reads, 2, 'financial status is fresh');
  await writer.transaction(s => { s.enabled = false; });
  for (const route of ['/api/work', '/api/work/small', '/api/events', '/api/owned-sources', '/api/accounting']) assert.equal((await f.get(route)).status, 403, route);
});

test('file read fixture waits for prior commit, never persists callback edits, and sees reopened writes', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'workagent-read-')), 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const write = store.transaction(async s => { s.permissionRevision = 2; entered.resolve(); await release.promise; });
  await entered.promise;
  const read = store.read(s => { s.enabled = false; return s.permissionRevision; });
  release.resolve(); await write; assert.equal(await read, 2);
  assert.equal(JSON.parse(await readFile(path)).enabled, true);
  await new FileFixtureStore(path).transaction(s => { s.permissionRevision = 3; });
  assert.equal(await store.read(s => s.permissionRevision), 3);
});
