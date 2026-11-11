import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.mjs';

const base = fileURLToPath(new URL('../../../.local/dsh-slice/state/', import.meta.url));
test('new loopback client API retains human edits after restart and rejects stale writes', { timeout: 20000 }, async () => {
  const stateRoot = await mkdtemp(`${base}server-`);
  let app = await startServer({ stateRoot, port: 0 });
  const request = async (path, body, extraHeaders = {}) => fetch(app.origin + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body),
  });
  try {
    assert.match(await (await request('/')).text(), /scripted provider/);
    assert.equal((await request('/api/start', {}, { Origin: 'https://unrelated.invalid' })).status, 403);
    const started = await (await request('/api/start', {})).json();
    assert.ok(started.sessionId);
    await app.host.controller.wait({ sessionId: started.sessionId, timeoutMs: 5000 }, new AbortController().signal);
    const work = await (await request('/api/work')).json();
    assert.equal(work.status, 'ready', JSON.stringify(work));
    assert.deepEqual(work.budget.alternatives.map(x => x.totalCents), [76800, 71200]);
    const streamAbort = new AbortController();
    const stream = await fetch(app.origin + '/api/follow', { signal: streamAbort.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /refresh/);
    streamAbort.abort(); await reader.cancel().catch(() => {});
    const text = 'My choice is Harbor Workshop. Keep room for 8 extra participants.';
    const savedResponse = await request('/api/edit', { text, version: work.version });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal((await request('/api/edit', { text: 'stale edit', version: work.version })).status, 409);
    await app.close();
    app = await startServer({ stateRoot, port: 0 });
    const reopened = await (await request('/api/work')).json();
    assert.equal(reopened.text, text);
    assert.deepEqual(reopened.revisions, saved.revisions);
    assert.equal(reopened.version, saved.version);
    assert.equal(app.host.provider.requests.length, 0);
    assert.equal((await (await request('/api/start', {})).json()).sessionId, work.sessionId);
    console.log('client API: real retained budget; follow snapshot; saved human edit; stale-write conflict; restart restored');
  } finally { await app.close(); }
});
