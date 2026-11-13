// Actual TSX event handlers and JSX with a hook fixture. No browser claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import { MaintenanceActions } from '../src/maintenance-actions.ts';
import { ApiError } from '../src/resume.ts';
import * as documents from '../../../packages/workagent-contract/document.mjs';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/DocumentExchange.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const storage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const preview = { filename: 'unknown.md', bytes: 30, encoding: 'UTF-8', sample: '# Literal source\nText', clipped: false };
function mount(disk, props) {
  let index = 0, effects = [], tree, dirty = true, mounted = true; const hooks = [], downloads = [], blobs = [];
  const react = {
    useState(initial) { const i = index++; hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, v => { if (mounted) { hooks[i].value = typeof v === 'function' ? v(hooks[i].value) : v; dirty = true; } }]; },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useEffect(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v, j) => !Object.is(v, hooks[i].deps[j]))) { hooks[i] = { deps, cleanup: hooks[i]?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  const module = { exports: {} }, document = { createElement: () => { const a = { click() { downloads.push({ href: this.href, download: this.download }); } }; return a; } };
  new Function('require', 'module', 'exports', 'localStorage', 'crypto', 'document', 'URL', code)(name => name === 'react' ? react : name === './maintenance-actions' ? { MaintenanceActions } : name.endsWith('/document.mjs') ? documents : require(name), module, module.exports, disk, { randomUUID }, document, { createObjectURL: blob => { blobs.push(blob); return 'blob:download'; }, revokeObjectURL() {} });
  const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
  const text = n => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : String(n ?? '');
  function render() { index = 0; dirty = false; tree = module.exports.DocumentExchange(props); const pending = effects; effects = []; pending.forEach(f => f()); }
  const flush = async () => { for (let i = 0; i < 8; i++) { if (dirty && mounted) render(); await new Promise(setImmediate); } };
  render();
  return { flush, downloads, blobs, text: () => text(tree),
    async choose(content = 'identifier,text\r\n0012,=1+1\r\n', name = 'unknown.md') { const file = new File([content], name); const input = nodes(tree).find(n => n.type === 'input' && n.props.type === 'file'); assert.ok(!input.props.disabled); input.props.onChange({ target: { files: [file], value: name } }); await flush(); },
    async click(label) { const button = nodes(tree).find(n => n.type === 'button' && text(n.props.children) === label); assert.ok(button, label); assert.ok(!button.props.disabled); button.props.onClick(); await flush(); },
    async update(next) { props = { ...props, ...next }; dirty = true; await flush(); },
    unmount() { mounted = false; hooks.forEach(h => h?.cleanup?.()); },
  };
}
for (const newerPending of [false, true]) test(`two live document consumers retain exact upload retry after another settles; newer pending ${newerPending}`, async () => {
  const disk = storage(), created = new Map(), calls = [], gate = deferred(); let attempts = 0, opened = 0;
  const props = { api: async (path, input) => {
    if (path.endsWith('/preview')) return preview;
    assert.equal(path, '/exchange/document/import'); calls.push(structuredClone(input)); attempts++;
    if (!created.has(input.commandId)) created.set(input.commandId, `doc-${created.size}`);
    if (attempts === 1) throw new Error('lost ACK after commit');
    if (newerPending && attempts === 3) return gate.promise;
    return { workId: created.get(input.commandId) };
  }, editor: () => { throw new Error('must not save or navigate'); }, work: null, onImported: async () => {}, onOpen: async () => { opened++; throw new Error('open failed'); } };
  const original = '\ufeffsku,text\r\n0012,"雪\n=1+1"\r\n';
  const a = mount(disk, props); await a.choose(original); await a.click('Import as new work');
  const b = mount(disk, props); await b.click('Retry unresolved Markdown / text import');
  const actions = new MaintenanceActions(disk, 'document-import'); assert.equal(actions.read(), null);
  let newer;
  if (newerPending) { await b.choose('new,upload'); await b.click('Import as new work'); newer = actions.read(); }
  await a.click('Retry unresolved Markdown / text import');
  assert.deepEqual(calls.at(-1), calls[0]); assert.equal(calls[0].base64, Buffer.from(original).toString('base64'));
  assert.equal(created.size, newerPending ? 2 : 1); assert.deepEqual(actions.read(), newer ?? null); assert.equal(opened, 0);
  if (newerPending) { assert.notEqual(newer.input.commandId, calls[0].commandId); gate.resolve({ workId: created.get(newer.input.commandId) }); await b.flush(); }
  else { await a.choose('new,upload'); await a.click('Import as new work'); assert.equal(created.size, 2); }
  a.unmount(); b.unmount();
  const reload = mount(disk, props); await reload.click('Open imported document'); assert.match(reload.text(), /open failed/);
  await reload.click('Open imported document'); assert.equal(opened, 2); assert.equal(created.size, 2); reload.unmount();
});
test('actual import UI previews before mutation, retains exact bytes/identity across reload, and opens only on request', async () => {
  const disk = storage(), calls = []; let open = 0, lists = 0, attempts = 0;
  const api = async (path, input) => { calls.push({ path, input }); if (path.endsWith('/preview')) return preview; if (++attempts === 1) throw new Error('lost acknowledgement'); return { workId: 'new' }; };
  const props = { api, editor: () => null, work: null, onImported: async () => { lists++; }, onOpen: async id => { assert.equal(id, 'new'); open++; } };
  let view = mount(disk, props); await view.choose(); assert.equal(calls.length, 1); assert.match(view.text(), /literally/); assert.match(view.text(), /Literal source/);
  await view.click('Import as new work'); const original = new MaintenanceActions(disk, 'document-import').read();
  assert.equal(original.input.base64, Buffer.from('identifier,text\r\n0012,=1+1\r\n').toString('base64')); assert.equal(open, 0); view.unmount();
  view = mount(disk, props); await view.click('Retry unresolved Markdown / text import');
  assert.deepEqual(calls[2], calls[1]); assert.equal(open, 0); assert.equal(lists, 1); assert.equal(new MaintenanceActions(disk, 'document-import').read(), null);
  await view.click('Open imported document'); assert.equal(open, 1); view.unmount();
});
for (const outcome of ['success', 'error']) test(`stale import ${outcome} after remount cannot settle a newer pending identity`, async () => {
  const disk = storage(), a = deferred(), b = deferred(); let calls = 0;
  const props = { api: async path => { if (path.endsWith('/preview')) return preview; calls++; if (calls === 1) return a.promise; if (calls === 2) return { workId: 'A' }; return b.promise; }, editor: () => null, work: null, onImported: async () => {}, onOpen: async () => {} };
  const old = mount(disk, props); await old.choose(); await old.click('Import as new work'); old.unmount();
  const view = mount(disk, props); await view.click('Retry unresolved Markdown / text import'); await view.choose('new,upload'); await view.click('Import as new work');
  const actions = new MaintenanceActions(disk, 'document-import'), pending = actions.read();
  if (outcome === 'success') a.resolve({ workId: 'A' }); else a.reject(new ApiError('/exchange/document/import', 400, 'invalid_csv_input'));
  await view.flush(); assert.deepEqual(actions.read(), pending); b.reject(new Error('offline')); await view.flush(); view.unmount();
});
test('document export waits for native commit, includes edited content, fences navigation and discloses style loss', async () => {
  for (const navigation of [false, true]) {
    const result = deferred(), native = { commit: () => result.promise }; let current = native;
    const view = mount(storage(), { api: async () => { throw new Error('export must not admit a job'); }, editor: () => current, work: { id: 'one', kind: 'document' }, onImported: async () => {}, onOpen: async () => {} });
    await view.click('Export document Markdown source'); assert.equal(view.downloads.length, 0);
    if (navigation) current = {};
    result.resolve(documents.blankDocument('one', 'Edited', '# Literal\nPending native edit'));
    await view.flush(); assert.equal(view.downloads.length, navigation ? 0 : 1);
    if (!navigation) { assert.equal(await view.blobs[0].text(), '# Literal\nPending native edit'); assert.match(view.text(), /formatting and page layout are omitted/); }
    view.unmount();
  }
});
