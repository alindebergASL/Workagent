// HTTP integration with disposable file fixtures; no database or model access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/http.mjs';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
const token = 'synthetic-test-access-key-at-least-32-characters';
test('HTTP fixture: authenticated command → native-shaped save → reopen; no anonymous work access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workagent-http-fixture-')), path = join(root, 'data.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const origin = 'https://private.example.test';
  const callbacks = [];
  const server = createServer({ workspace, owner: 'owner', token, origin, clientRoot: root, onCommand: (...args) => callbacks.push(args) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data, cookie) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(data) });
  try {
    assert.equal((await fetch(url + '/api/work')).status, 401);
    const login = await post('/api/session', { token }); assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const source = await (await post('/api/sources', { commandId: 'src', name: 'Synthetic', content: 'Name,Quantity\nCedar,7', synthetic: true }, cookie)).json();
    const input = { commandId: 'first', kind: 'start', text: 'Compare these supplies', sourceIds: [source.id] };
    const admitted = await (await post('/api/work/commands', input, cookie)).json();
    assert.deepEqual(await (await post('/api/work/commands', input, cookie)).json(), admitted);
    assert.deepEqual(callbacks, [[admitted.workId, 'start', admitted.intentRevision]]);
    let w = await (await fetch(`${url}/api/work/${admitted.workId}`, { headers: { Cookie: cookie } })).json();
    w.book.sheets.sheet1.cellData = { 0: { 0: { v: 7, t: 2 } }, 1: { 0: { f: '=A1*3' } } };
    const saved = await post(`/api/work/${w.id}/save`, { commandId: 'saved', book: w.book, contentRevision: w.contentRevision, permissionRevision: w.expected.permissionRevision }, cookie); assert.equal(saved.status, 200);
    const reopened = await (await fetch(`${url}/api/work/${w.id}`, { headers: { Cookie: cookie } })).json();
    assert.equal(reopened.book.sheets.sheet1.cellData[1][0].f, '=A1*3'); assert.equal(reopened.contentRevision, 1);
    assert.equal((await fetch(`${url}/api/work/${w.id}`)).status, 401);
    assert.equal((await fetch(`${url}/api/work/${w.id}/save`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://foreign.test', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
