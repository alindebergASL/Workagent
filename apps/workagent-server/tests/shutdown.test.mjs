import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShutdown } from '../src/shutdown.mjs';
import { createServer } from '../src/http.mjs';
import { initialState } from '../src/store.mjs';
import { Workspace } from '../src/workspace.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
import { createDispatcher } from '../../workagent-runner/src/dispatch.mjs';

test('shutdown stops admission and cancellation immediately; joins both before host/leader/pool, once', async () => {
  const http = Promise.withResolvers(), dispatch = Promise.withResolvers(), events = [];
  const close = createShutdown({
    server: { drain() { events.push('http'); return http.promise; } },
    dispatcher: { close() { events.push('dispatch'); return dispatch.promise; } },
    host: { async close() { events.push('host'); } },
    leadership: { release() { events.push('leader'); } },
    pool: { async end() { events.push('pool'); } },
  });
  const first = close(); assert.equal(close(), first);
  assert.deepEqual(events, ['http', 'dispatch']);
  dispatch.resolve(); await new Promise(setImmediate);
  assert.deepEqual(events, ['http', 'dispatch']);
  http.resolve(); await first;
  assert.equal(close(), first);
  assert.deepEqual(events, ['http', 'dispatch', 'host', 'leader', 'pool']);
});

test('accepted save/start/cancel settle after disconnect before disposal; exact retries and queued recovery survive (file fixture)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workagent-shutdown-write-')), path = join(root, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const blank = await workspace.createBlank('owner', { commandId: 'blank', title: 'Human work' });
  const cancelWork = await workspace.command('owner', { commandId: 'old', kind: 'start', text: 'old', sourceIds: [] });
  const work = await workspace.get('owner', blank.workId);
  work.book.sheets.sheet1.cellData = { 0: { 0: { v: 'retained human edit', t: 1 } } };
  const save = { commandId: 'save', book: work.book, contentRevision: 1, permissionRevision: 1 };
  const start = { commandId: 'new', kind: 'start', text: 'durable new request', sourceIds: [] };
  const cancel = { commandId: 'cancel', kind: 'cancel', workId: cancelWork.workId, expectedIntentRevision: 1, sourceIds: [] };
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  let accepted = 0, disposed = false, released = false, ended = false, cancellations = 0, calls = 0;
  for (const method of ['save', 'admitCommand']) {
    const original = workspace[method].bind(workspace);
    workspace[method] = async (...args) => {
      if (++accepted === 3) entered.resolve();
      await gate.promise;
      assert.equal(disposed || released || ended, false, 'dependencies retained through accepted mutation');
      return original(...args);
    };
  }
  const host = {
    cancelAll() {},
    cancel() { assert.equal(disposed, false); cancellations++; },
    async run() { calls++; return []; },
    async close() {
      const state = JSON.parse(await readFile(path));
      assert.equal(state.works[blank.workId].book.sheets.sheet1.cellData[0][0].v, 'retained human edit');
      assert.equal(state.jobs.new.status, 'queued');
      assert.equal(state.works[cancelWork.workId].status, 'stopped');
      assert.equal(cancellations, 1);
      disposed = true;
    },
  };
  const dispatcher = createDispatcher({ workspace, principal: 'owner', host });
  const server = createServer({ workspace, owner: 'owner', token: 'synthetic-token-at-least-32-characters', origin: 'http://127.0.0.1', clientRoot: root,
    onCommand(workId, kind, revision) { if (kind !== 'start') host.cancel(workId, revision); dispatcher.wake(); } });
  // Exercise production request handling without a network listener. All three
  // clients are already disconnected: socket-close alone cannot prove settlement.
  const request = (url, input) => {
    const req = Readable.from([Buffer.from(JSON.stringify(input))]);
    Object.assign(req, { method: 'POST', url, headers: { authorization: 'Bearer synthetic-token-at-least-32-characters', origin: 'http://127.0.0.1', 'content-type': 'application/json' } });
    const res = Object.assign(new EventEmitter(), { destroyed: true, setHeader() {}, writeHead() {}, end() {} });
    server.emit('request', req, res);
  };
  request(`/api/work/${blank.workId}/save`, save);
  request('/api/work/commands', start); request('/api/work/commands', cancel);
  await entered.promise;
  server.close = callback => { queueMicrotask(callback); return server; };
  const close = createShutdown({ server, dispatcher, host, leadership: { release() { assert.ok(disposed); released = true; } }, pool: { async end() { assert.ok(released); ended = true; } } });
  const closing = close(); assert.equal(close(), closing);
  await new Promise(setImmediate); assert.equal(disposed, false);
  let rejectedStatus; const rejectedHeaders = {};
  server.emit('request', { method: 'POST' }, { setHeader(key, value) { rejectedHeaders[key] = value; }, writeHead(code, headers) { rejectedStatus = code; Object.assign(rejectedHeaders, headers); }, end(raw) { assert.deepEqual(JSON.parse(raw), { error: 'service_restarting' }); } });
  assert.equal(rejectedStatus, 503); assert.equal(accepted, 3);
  assert.equal(rejectedHeaders.Connection, 'close'); assert.equal(rejectedHeaders['Content-Type'], 'application/json');
  assert.equal(rejectedHeaders['Cache-Control'], 'no-store'); assert.equal(rejectedHeaders['X-Content-Type-Options'], 'nosniff');
  assert.equal(rejectedHeaders['Referrer-Policy'], 'no-referrer'); assert.match(rejectedHeaders['Content-Security-Policy'], /frame-ancestors 'none'/);
  gate.resolve(); await closing;
  assert.equal(ended, true); assert.equal(calls, 0);
  const reopened = new Workspace(new FileFixtureStore(path));
  const savedState = await readFile(path, 'utf8');
  assert.deepEqual(await reopened.save('owner', blank.workId, save), { contentRevision: 2, permissionRevision: 1 });
  assert.equal((await reopened.admitCommand('owner', start)).admitted, false);
  assert.equal((await reopened.admitCommand('owner', cancel)).admitted, false);
  assert.equal(await readFile(path, 'utf8'), savedState);
  await reopened.recover('owner', async () => ({ exists: false, uncertain: false, messages: [] }));
  assert.equal((await reopened.claim('owner')).id, 'new');
  assert.equal(await reopened.claim('owner'), null);
});

async function subprocess(mode) {
  const root = await mkdtemp(join(tmpdir(), 'workagent-shutdown-http-')), eventPath = join(root, 'events.jsonl');
  await writeFile(eventPath, '');
  const child = spawn(process.execPath, [new URL('./support/shutdown-http.mjs', import.meta.url).pathname, mode, eventPath], {
    stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  const events = []; let stderr = '', forced = false, watchdog;
  const started = performance.now();
  const startup = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 8000);
  child.stderr.on('data', data => { stderr += data; });
  const collect = () => {
    const lines = readFileSync(eventPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines.slice(events.length)) {
      const event = JSON.parse(line); events.push(event);
      if (event.stage === 'ready') {
        clearTimeout(startup); child.kill('SIGTERM');
        // Disposable regression child only; production has no force-exit policy.
        watchdog = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 2000);
      }
      if (event.stage === 'signal' && event.count === 1) child.kill('SIGINT');
    }
  };
  const poll = setInterval(collect, 10);
  const [code, signal] = await once(child, 'close');
  clearInterval(poll); collect(); clearTimeout(startup); clearTimeout(watchdog);
  return { code, signal, forced, events, stderr, elapsedMs: Math.round(performance.now() - started) };
}

test('actual HTTP + installed pg-pool backlog: baseline strands clients; production drain returns all six full responses and exits naturally', { timeout: 20000 }, async t => {
  const baseline = await subprocess('baseline');
  if (baseline.events.some(e => e.stage === 'listen-denied')) {
    assert.equal(baseline.code, 77);
    t.skip('sandbox denies loopback listen; Parent must run this regression'); return;
  }
  assert.equal(baseline.forced, true, JSON.stringify(baseline));
  assert.equal(baseline.signal, 'SIGKILL');
  assert.ok(baseline.events.some(e => e.stage === 'shutdown.done'));
  assert.ok(!baseline.events.some(e => e.stage === 'responses.complete'));
  assert.ok(baseline.events.find(e => e.stage === 'pool.done').waiting > 0);
  const fixed = await subprocess('fixed');
  assert.equal(fixed.code, 0, JSON.stringify(fixed)); assert.equal(fixed.signal, null); assert.equal(fixed.forced, false);
  assert.equal(fixed.events.filter(e => e.stage === 'shutdown.done').length, 1);
  assert.equal(fixed.events.filter(e => e.stage === 'signal').length, 2);
  assert.equal(fixed.events.find(e => e.stage === 'responses.complete').count, 6);
  assert.equal(fixed.events.find(e => e.stage === 'pool.done').waiting, 0);
  t.diagnostic(JSON.stringify({ baseline, fixed }));
});
