// Explicit PostgreSQL protocol/transaction and socket fixtures. Exercises the real
// PostgresStore, Workspace, simulator and HTTP handlers, not a live database/socket.
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { initialState, PostgresStore } from '../../src/store.mjs';
import { Workspace } from '../../src/workspace.mjs';
import { GoogleExchange } from '../../src/google-exchange.mjs';
import { createGoogleSimulator } from '../../src/google-simulation.mjs';
export const token = 'synthetic-owner-credential-at-least-32-characters';
export const peerToken = 'synthetic-peer-credential-at-least-32-characters';
export const accounts = [{ id: 'peer', name: 'Simulated workspace peer', token: peerToken }];
export const origin = 'http://127.0.0.1:12345';
export function storeFixture() {
  let state = initialState('owner'), tail = Promise.resolve(), locked = false;
  const fixture = { fail: undefined, committed: () => structuredClone(state), get locked() { return locked; } };
  const pool = {
    async query(sql) { assert.match(sql, /^SELECT data/); return { rows: [{ data: structuredClone(state) }] }; },
    async connect() {
      const before = tail; let unlock; tail = new Promise(r => { unlock = r; }); await before; locked = true;
      let next;
      return { async query(sql, values) {
        if (sql === 'BEGIN') { next = structuredClone(state); return {}; }
        if (sql.includes('FOR UPDATE')) return { rows: [{ data: next }] };
        if (sql.startsWith('UPDATE')) { next = JSON.parse(values[1]); fixture.fail?.(next); return {}; }
        if (sql === 'COMMIT') { state = next; return {}; }
        if (sql === 'ROLLBACK') return {};
        assert.fail('unexpected SQL');
      }, release() { locked = false; unlock(); } };
    },
  };
  fixture.store = new PostgresStore(pool, 'owner'); return fixture;
}
export async function handlerRequest(handler, path, { input, bearer = token, method = input ? 'POST' : 'GET', headers = {} } = {}) {
  const req = Readable.from(input === undefined ? [] : [Buffer.from(JSON.stringify(input))]);
  Object.assign(req, { url: path, method, headers: { origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json', ...headers } });
  const res = new EventEmitter(); let status, value;
  Object.assign(res, { setHeader() {}, writeHead(s) { status = s; }, end(raw) { value = JSON.parse(raw); this.writableEnded = true; } });
  await handler(req, res); return { status, value };
}
export function integrationFixture(t) {
  const pg = storeFixture(), workspace = new Workspace(pg.store, { peers: accounts }), sim = createGoogleSimulator();
  // Dispatch actual simulator handler through an explicit socket fixture. The
  // separate google-exchange-http suite uses actual loopback fetch/listen.
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(pg.locked, false, 'No workspace transaction may span provider HTTP');
    assert.equal(new URL(url).origin, origin);
    return new Promise((resolve, reject) => {
      const req = Readable.from(options.body ? [Buffer.from(options.body)] : []), res = new EventEmitter();
      Object.assign(req, { url: new URL(url).pathname + new URL(url).search, method: options.method, headers: options.headers, socket: { destroy() { res.destroyed = true; reject(new TypeError('simulated lost acknowledgement')); } } });
      Object.assign(res, { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(s, headers) { this.statusCode = s; Object.assign(this.headers, headers); this.headersSent = true; }, end(raw) {
        this.emit('finish'); const response = new Response(raw, { status: this.statusCode, headers: this.headers }); Object.defineProperty(response, 'url', { value: String(url) }); resolve(response);
      } });
      sim.server.listeners('request')[0](req, res).catch(reject);
    });
  });
  const restart = () => new GoogleExchange({ workspace: new Workspace(pg.store, { peers: accounts }), simulation: true, origin, credentialsFor: account => sim.issue(account) });
  return { ...pg, pg, workspace, sim, exchange: restart(), restart, writes: () => sim.events.filter(e => e.method === 'POST' && e.path !== '/token') };
}
export async function setup(f, kind = 'document') {
  const { workId } = await f.workspace.createBlank('owner', { commandId: 'blank', title: 'Current native work', kind });
  const connection = await f.exchange.connect('owner', { commandId: 'alice', account: 'alice', connectionGeneration: 0 });
  return { workId, contentRevision: 1, permissionRevision: 1, connectionGeneration: connection.generation };
}
