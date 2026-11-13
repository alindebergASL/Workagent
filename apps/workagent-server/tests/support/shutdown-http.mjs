// Actual HTTP and installed pg-pool scheduling; synthetic delayed database client.
// No PostgreSQL, provider, credentials, or retained runtime access.
import assert from 'node:assert/strict';
import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { EventEmitter, once } from 'node:events';
import pg from 'pg';
import { createServer } from '../../src/http.mjs';
import { createShutdown } from '../../src/shutdown.mjs';
import { Workspace } from '../../src/workspace.mjs';
import { PostgresStore, initialState } from '../../src/store.mjs';

const mark = (stage, data = {}) => appendFileSync(process.argv[3], JSON.stringify({ stage, ...data }) + '\n');
class DelayedClient extends EventEmitter {
  _queryable = true;
  connect(callback) { queueMicrotask(() => callback(null)); }
  query(_sql, _values, callback) { setTimeout(() => callback(null, { rows: [{ data: initialState('owner') }] }), 100); }
  end(callback) { queueMicrotask(() => { this.emit('end'); callback?.(); }); }
  ref() {}
  unref() {}
}
const pool = new pg.Pool({ Client: DelayedClient, max: 3 });
const leadership = await pool.connect();
const server = createServer({ workspace: new Workspace(new PostgresStore(pool, 'owner')), owner: 'owner',
  token: 'synthetic-token-at-least-32-characters', origin: 'http://127.0.0.1', clientRoot: '/tmp' });
try { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
catch (error) {
  if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
  mark('listen-denied', { code: error.code }); leadership.release(); await pool.end(); process.exitCode = 77;
}
if (!process.exitCode) {
  const responses = Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/api/work', agent: false,
      headers: { authorization: 'Bearer synthetic-token-at-least-32-characters' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk)); res.on('error', reject); res.on('aborted', () => reject(new Error('response_aborted')));
      res.on('end', () => {
        try { assert.equal(res.statusCode, 200); assert.equal(res.complete, true); assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), []); resolve(); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
  }));
  const allResponses = Promise.all(responses).then(() => mark('responses.complete', { count: responses.length }));
  const deadline = performance.now() + 2000;
  while (pool.waitingCount !== 4) {
    assert.ok(performance.now() < deadline, 'six accepted requests must saturate the two non-leader pool slots');
    await new Promise(setImmediate);
  }
  const timer = setInterval(() => {}, 1500);
  const dispatcher = { async close() { mark('dispatcher.done'); } };
  const host = { async close() { mark('host.done'); } };
  const end = pool.end.bind(pool);
  pool.end = async () => { await end(); mark('pool.done', { waiting: pool.waitingCount }); };
  let legacyShutdown;
  const close = process.argv[2] === 'baseline'
    ? () => legacyShutdown ??= (async () => { clearInterval(timer); server.close(); await dispatcher.close(); await host.close(); leadership.release(); await pool.end(); })()
    : createShutdown({ server, dispatcher, host, leadership, pool, timer });
  let first, signals = 0;
  function signal() {
    const current = close();
    if (first) assert.equal(current, first);
    else { first = current; void current.then(() => mark('shutdown.done')); }
    mark('signal', { count: ++signals });
  }
  process.on('SIGTERM', signal); process.on('SIGINT', signal);
  mark('ready');
  await allResponses;
}
