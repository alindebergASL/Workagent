import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate as settle } from 'node:timers/promises';

// Execute the actual client with only the browser boundary replaced. This does
// not replace or test the DSH engine; its real host tests remain separate.
async function client({ draft } = {}) {
  let state = { sessionId: 'workshop', version: 1, humanText: 'Saved human choice', text: 'Saved human choice', generatedText: 'Scripted recommendation', status: 'ready', budget: { alternatives: [] }, fixtureLabel: 'Fixture' };
  const nodes = new Map();
  const element = () => ({ hidden: false, value: '', textContent: '', children: [], append(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; }, focus() {}, click() { return this.onclick?.(); } });
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  $('#editor').hidden = true;
  const stored = new Map(draft === undefined ? [] : [['workagent-dsh-draft-workshop', draft]]);
  const listeners = new Map(); const connections = []; const requests = [];
  let holdRead;
  const globals = {
    document: { querySelector: $, createElement: element, activeElement: null },
    window: { addEventListener(name, listener) { listeners.set(name, listener); } },
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    EventSource: class {
      constructor(url) { this.url = url; this.closed = false; connections.push(this); }
      close() { this.closed = true; }
    },
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === '/api/work' && holdRead) { const pending = holdRead; holdRead = null; await pending; }
      if (path === '/api/edit') {
        const body = JSON.parse(options.body);
        if (body.version !== state.version) return { ok: false, status: 409, json: async () => ({ error: 'This result changed. Reload before saving your edit.' }) };
        state = { ...state, version: state.version + 1, humanText: body.text, text: body.text };
      }
      return { ok: true, json: async () => structuredClone(state) };
    },
  };
  const source = await readFile(new URL('../client/app.js', import.meta.url), 'utf8');
  await runInNewContext(`(async () => {\n${source}\n})()`, globals);
  return { $, stored, connections, requests,
    async event(name) { listeners.get(name)?.(); await settle(); },
    async refresh() { connections.at(-1).onmessage?.(); await settle(); },
    advance() { state = { ...state, version: state.version + 1 }; },
    holdRead(promise) { holdRead = promise; },
  };
}

test('draft labels survive restoration and server refresh; stale saves retain draft and original edit version', async () => {
  const app = await client({ draft: 'Unsubmitted Unicode 🧭 draft' });
  assert.equal(app.$('#editor').hidden, false);
  assert.match(app.$('#save-state').textContent, /Unsaved draft/);
  app.advance(); await app.refresh();
  assert.equal(app.$('#text').value, 'Unsubmitted Unicode 🧭 draft');
  assert.match(app.$('#save-state').textContent, /Unsaved draft/);
  await app.$('#editor').onsubmit({ preventDefault() {} });
  assert.match(app.$('#error').textContent, /Reload/);
  assert.equal(JSON.parse(app.requests.at(-1).options.body).version, 1);
  assert.equal(app.stored.get('workagent-dsh-draft-workshop'), 'Unsubmitted Unicode 🧭 draft');
  assert.match(app.$('#save-state').textContent, /Unsaved draft/);
  app.$('#cancel').click();
  assert.equal(app.$('#save-state').textContent, 'Your edits are saved');
  app.$('#edit').click(); app.$('#text').value = 'A new saved choice'; app.$('#text').oninput();
  assert.match(app.$('#save-state').textContent, /Unsaved draft/);
  await app.$('#editor').onsubmit({ preventDefault() {} });
  assert.equal(app.$('#editor').hidden, true);
  assert.equal(app.$('#result').textContent, 'A new saved choice');
  assert.equal(app.$('#save-state').textContent, 'Your edits are saved');
  assert.equal(app.stored.size, 0);
});
test('page restoration reconnects once through follow snapshot without clobbering an active draft', async () => {
  const app = await client();
  app.$('#edit').click(); app.$('#text').value = 'Keep this active draft'; app.$('#text').oninput();
  const first = app.connections[0];
  const read = Promise.withResolvers(); app.holdRead(read.promise);
  first.onmessage();
  await app.event('pagehide');
  assert.equal(first.closed, true);
  read.resolve(); await settle();
  assert.equal(app.connections.length, 1, 'a read completing while hidden must not reopen the stream');
  app.advance(); await app.event('pageshow');
  assert.equal(app.connections.length, 2);
  assert.equal(app.connections[1].url, '/api/follow');
  assert.equal(app.connections.filter(connection => !connection.closed).length, 1);
  await app.event('pageshow');
  assert.equal(app.connections.length, 2, 'duplicate pageshow must not create duplicate followers');
  assert.equal(app.$('#text').value, 'Keep this active draft');
  assert.match(app.$('#save-state').textContent, /Unsaved draft/);
  await app.$('#editor').onsubmit({ preventDefault() {} });
  assert.equal(JSON.parse(app.requests.at(-1).options.body).version, 1, 'pageshow must not refresh the draft edit version');
  assert.match(app.$('#error').textContent, /Reload/);
});
