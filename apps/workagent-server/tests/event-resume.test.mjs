import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
import { createHandler } from '../src/http.mjs';
async function setup() {
  const path = join(await mkdtemp(join(tmpdir(), 'workagent-events-')), 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), ws = new Workspace(store);
  const start = commandId => ws.command('owner', { commandId, kind: 'start', text: commandId, sourceIds: [] });
  return { ws, store, start };
}
test('committed replay is ordered, idempotent and snapshots share its watermark', async () => {
  const { ws, start } = await setup(); const first = await start('first'), second = await start('second');
  const initial = await ws.events('owner');
  assert.equal(initial.kind, 'reset'); assert.equal(initial.cursor, 2); assert.equal(initial.snapshots.length, 2);
  await ws.command('owner', { commandId: 'stop', kind: 'cancel', workId: first.workId, expectedIntentRevision: 1, sourceIds: [] });
  const delta = await ws.events('owner', 2);
  assert.equal(delta.kind, 'events'); assert.deepEqual(delta.events.map(e => e.eventId), [3]);
  assert.deepEqual(delta.snapshots.map(w => w.id), [first.workId]); assert.equal(delta.snapshots[0].status, 'stopped');
  assert.equal(delta.works.find(w => w.id === second.workId).status, 'queued');
  assert.deepEqual(await ws.events('owner', 2), delta);
  assert.deepEqual((await ws.events('owner', 3)).events, []);
});
test('expired, future and missing cursors reset against snapshot; retained history is not deleted', async () => {
  const { ws, store, start } = await setup(); await start('first');
  await store.transaction(s => { const template = s.events[0]; s.events = Array.from({ length: 300 }, (_, i) => ({ ...template, eventId: i + 1 })); s.sequence = 300; });
  assert.equal((await ws.events('owner', 0)).kind, 'reset');
  assert.equal((await ws.events('owner', 301)).kind, 'reset');
  assert.equal((await ws.events('owner', 299)).kind, 'events');
  assert.equal(await store.transaction(s => s.events.length), 300);
  await store.transaction(s => { s.events = s.events.filter(e => e.eventId !== 299); });
  assert.equal((await ws.events('owner', 298)).kind, 'reset');
  await assert.rejects(ws.events('owner', -1), /invalid_cursor/);
});
test('events route binds principal before replay or reset and refuses revoked owner without data', async () => {
  const { ws, store, start } = await setup(); await start('private');
  const token = 'synthetic-private-event-token-at-least-32', origin = 'https://private.example.test';
  const handler = createHandler({ workspace: ws, owner: 'owner', token, origin, clientRoot: tmpdir() });
  async function get(headers = {}, url = '/api/events?after=0') {
    const req = Readable.from([]); Object.assign(req, { method: 'GET', url, headers }); let status, body;
    await handler(req, { setHeader() {}, writeHead(code) { status = code; }, end(raw) { body = JSON.parse(raw); } }); return { status, body };
  }
  assert.deepEqual(await get(), { status: 401, body: { error: 'access_denied' } });
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await get(headers)).status, 200);
  assert.equal((await get(headers, '/api/events?after=not-a-cursor')).status, 400);
  await assert.rejects(ws.events('intruder'), /access_denied/);
  await store.transaction(s => { s.enabled = false; });
  assert.deepEqual(await get(headers), { status: 403, body: { error: 'access_denied' } });
});

test('accounting status is authenticated, revocation-aware and reads only the selected mode', async () => {
  const { ws, store } = await setup(); const token = 'synthetic-private-account-token-at-least-32'; let reads = 0;
  const handler = createHandler({ workspace: ws, owner: 'owner', token, origin: 'https://private.example.test', clientRoot: tmpdir(), accounting: { async status() { reads++; return { mode: 'openrouter', providerReportedCostUsd: 0.001, keySnapshotReservesFunds: false }; } } });
  async function get(authorized) {
    const req = Readable.from([]); Object.assign(req, { method: 'GET', url: '/api/accounting', headers: authorized ? { authorization: `Bearer ${token}` } : {} }); let status, body;
    await handler(req, { setHeader() {}, writeHead(code) { status = code; }, end(raw) { body = JSON.parse(raw); } }); return { status, body };
  }
  assert.equal((await get(false)).status, 401); assert.equal(reads, 0);
  assert.equal((await get(true)).body.providerReportedCostUsd, 0.001); assert.equal(reads, 1);
  await store.transaction(s => { s.enabled = false; });
  assert.equal((await get(true)).status, 403); assert.equal(reads, 1);
});
