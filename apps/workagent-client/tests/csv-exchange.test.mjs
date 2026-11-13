// Actual TSX event handlers and JSX with a hook fixture. No browser claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import { MaintenanceActions } from '../src/maintenance-actions.ts';
import { ApiError } from '../src/resume.ts';
import * as csv from '../../../packages/workagent-contract/csv.mjs';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/CsvExchange.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const storage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const preview = { filename: 'unknown.csv', bytes: 30, encoding: 'UTF-8', rows: 2, columns: 2, raggedRows: 0, sample: [['identifier', 'text'], ['0012', '=1+1']] };
function mount(disk, props) {
  let index = 0, effects = [], tree, dirty = true, mounted = true; const hooks = [], downloads = [], blobs = [];
  const react = {
    useState(initial) { const i = index++; hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, v => { if (mounted) { hooks[i].value = typeof v === 'function' ? v(hooks[i].value) : v; dirty = true; } }]; },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useEffect(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v, j) => !Object.is(v, hooks[i].deps[j]))) { hooks[i] = { deps, cleanup: hooks[i]?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  const module = { exports: {} }, document = { createElement: () => { const a = { click() { downloads.push({ href: this.href, download: this.download }); } }; return a; } };
  new Function('require', 'module', 'exports', 'localStorage', 'crypto', 'document', 'URL', code)(name => name === 'react' ? react : name === './maintenance-actions' ? { MaintenanceActions } : name.endsWith('/csv.mjs') ? csv : require(name), module, module.exports, disk, { randomUUID }, document, { createObjectURL: blob => { blobs.push(blob); return 'blob:download'; }, revokeObjectURL() {} });
  const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
  const text = n => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : String(n ?? '');
  function render() { index = 0; dirty = false; tree = module.exports.CsvExchange(props); const pending = effects; effects = []; pending.forEach(f => f()); }
  const flush = async () => { for (let i = 0; i < 8; i++) { if (dirty && mounted) render(); await new Promise(setImmediate); } };
  render();
  return { flush, downloads, blobs, text: () => text(tree),
    async choose(content = 'identifier,text\r\n0012,=1+1\r\n', name = 'unknown.csv') { const file = new File([content], name); const input = nodes(tree).find(n => n.type === 'input' && n.props.type === 'file'); assert.ok(!input.props.disabled); input.props.onChange({ target: { files: [file], value: name } }); await flush(); },
    async click(label) { const button = nodes(tree).find(n => n.type === 'button' && text(n.props.children) === label); assert.ok(button, label); assert.ok(!button.props.disabled); button.props.onClick(); await flush(); },
    async update(next) { props = { ...props, ...next }; dirty = true; await flush(); },
    unmount() { mounted = false; hooks.forEach(h => h?.cleanup?.()); },
  };
}
test('actual import UI previews before mutation, retains exact bytes/identity across reload, and opens only on request', async () => {
  const disk = storage(), calls = []; let open = 0, lists = 0, attempts = 0;
  const api = async (path, input) => { calls.push({ path, input }); if (path.endsWith('/preview')) return preview; if (++attempts === 1) throw new Error('lost acknowledgement'); return { workId: 'new' }; };
  const props = { api, editor: () => null, work: null, onImported: async () => { lists++; }, onOpen: async id => { assert.equal(id, 'new'); open++; } };
  let view = mount(disk, props); await view.choose(); assert.equal(calls.length, 1); assert.match(view.text(), /literal text/); assert.match(view.text(), /0012/);
  await view.click('Import as new work'); const original = new MaintenanceActions(disk, 'csv-import').read();
  assert.equal(original.input.base64, Buffer.from('identifier,text\r\n0012,=1+1\r\n').toString('base64')); assert.equal(open, 0); view.unmount();
  view = mount(disk, props); await view.click('Retry unresolved CSV import');
  assert.deepEqual(calls[2], calls[1]); assert.equal(open, 0); assert.equal(lists, 1); assert.equal(new MaintenanceActions(disk, 'csv-import').read(), null);
  await view.click('Open imported sheet'); assert.equal(open, 1); view.unmount();
});
for (const outcome of ['success', 'error']) test(`stale import ${outcome} after remount cannot settle a newer pending identity`, async () => {
  const disk = storage(), a = deferred(), b = deferred(); let calls = 0;
  const props = { api: async path => { if (path.endsWith('/preview')) return preview; calls++; if (calls === 1) return a.promise; if (calls === 2) return { workId: 'A' }; return b.promise; }, editor: () => null, work: null, onImported: async () => {}, onOpen: async () => {} };
  const old = mount(disk, props); await old.choose(); await old.click('Import as new work'); old.unmount();
  const view = mount(disk, props); await view.click('Retry unresolved CSV import'); await view.choose('new,upload'); await view.click('Import as new work');
  const actions = new MaintenanceActions(disk, 'csv-import'), pending = actions.read();
  if (outcome === 'success') a.resolve({ workId: 'A' }); else a.reject(new ApiError('/exchange/csv/import', 400, 'invalid_csv_input'));
  await view.flush(); assert.deepEqual(actions.read(), pending); b.reject(new Error('offline')); await view.flush(); view.unmount();
});
test('actual export button consumes native calculated CSV and downloads it without server saves', async () => {
  const disk = storage(), csvResult = { csv: '"name","value"\r\n"雪",-5\r\n', sheetName: 'Selected tab', rows: 2, columns: 2, neutralized: 0, unknown: 0 }; let exports = 0;
  const native = { exportCsv: async () => { exports++; return csvResult; } };
  const view = mount(disk, { api: async () => { throw new Error('Export must not invoke API'); }, editor: () => native, work: { id: 'current' }, onImported: async () => {}, onOpen: async () => {} });
  await view.click('Export selected sheet CSV'); assert.equal(exports, 1); assert.deepEqual(view.downloads, [{ href: 'blob:download', download: 'Selected tab.csv' }]);
  assert.equal(await view.blobs[0].text(), csvResult.csv); assert.match(view.text(), /does not save to the server/); assert.match(view.text(), /formulas are lost/); view.unmount();
});
test('export failure or navigation during pending native calculation makes no download', async () => {
  for (const navigation of [false, true]) {
    const result = deferred(), native = { exportCsv: () => result.promise }; let current = native;
    const view = mount(storage(), { api: async () => {}, editor: () => current, work: { id: 'one' }, onImported: async () => {}, onOpen: async () => {} });
    await view.click('Export selected sheet CSV');
    if (navigation) { current = {}; result.resolve({ csv: 'old', sheetName: 'Old' }); } else result.reject(new Error('Calculation timeout'));
    await view.flush(); assert.equal(view.downloads.length, 0); view.unmount();
  }
});
test('saved sheet commands use the existing durable identity across navigation/reload and conflict responses', () => {
  const disk = storage(), path = '/work/one/save', save = new MaintenanceActions(disk, 'sheet-save:one');
  const first = save.prepare('save', path, { book: { id: 'one' }, contentRevision: 1, permissionRevision: 1 }, () => 'save-A');
  assert.deepEqual(new MaintenanceActions(disk, 'sheet-save:one').prepare('save', path, { book: { changed: true } }, () => 'save-B'), first);
  assert.equal(new MaintenanceActions(disk, 'sheet-save:two').read(), null);
  save.rejected(new Error('lost acknowledgement'), first); assert.deepEqual(save.read(), first);
  save.accepted(first); const second = save.prepare('save', path, { contentRevision: 2 }, () => 'save-B'); save.accepted(first); assert.deepEqual(save.read(), second);
  save.rejected(new ApiError(path, 409, 'save_conflict'), second); assert.equal(save.read(), null);
});
