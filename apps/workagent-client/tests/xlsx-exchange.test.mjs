// Actual TSX event handlers and JSX with a hook fixture. No browser claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import { MaintenanceActions } from '../src/maintenance-actions.ts';
import { ApiError } from '../src/resume.ts';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/XlsxExchange.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const storage = () => { const map = new Map(); return { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const preview = { filename: 'unknown.xlsx', bytes: 30, cells: 4, warnings: ['Fixture fidelity warning'], sheets: [{name:'Inputs',rows:200,columns:26,sample:[{row:1,values:[{column:1,value:'0012'}]}]}] };
function mount(disk, props) {
  let index = 0, effects = [], tree, dirty = true, mounted = true; const hooks = [], downloads = [], blobs = [];
  const react = {
    useState(initial) { const i = index++; hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, v => { if (mounted) { hooks[i].value = typeof v === 'function' ? v(hooks[i].value) : v; dirty = true; } }]; },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useEffect(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v, j) => !Object.is(v, hooks[i].deps[j]))) { hooks[i] = { deps, cleanup: hooks[i]?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  const module = { exports: {} }, document = { createElement: () => { const a = { click() { downloads.push({ href: this.href, download: this.download }); } }; return a; } };
  new Function('require', 'module', 'exports', 'localStorage', 'crypto', 'document', 'URL', code)(name => name === 'react' ? react : name === './maintenance-actions' ? { MaintenanceActions } : require(name), module, module.exports, disk, { randomUUID }, document, { createObjectURL: blob => { blobs.push(blob); return 'blob:download'; }, revokeObjectURL() {} });
  const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
  const text = n => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : String(n ?? '');
  function render() { index = 0; dirty = false; tree = module.exports.XlsxExchange(props); const pending = effects; effects = []; pending.forEach(f => f()); }
  const flush = async () => { for (let i = 0; i < 8; i++) { if (dirty && mounted) render(); await new Promise(setImmediate); } };
  render();
  return { flush, downloads, blobs, text: () => text(tree),
    async choose(content = 'identifier,text\r\n0012,=1+1\r\n', name = 'unknown.xlsx') { const file = new File([content], name); const input = nodes(tree).find(n => n.type === 'input' && n.props.type === 'file'); assert.ok(!input.props.disabled); input.props.onChange({ target: { files: [file], value: name } }); await flush(); },
    async click(label) { const button = nodes(tree).find(n => n.type === 'button' && text(n.props.children) === label); assert.ok(button, label); assert.ok(!button.props.disabled); button.props.onClick(); await flush(); },
    async update(next) { props = { ...props, ...next }; dirty = true; await flush(); },
    unmount() { mounted = false; hooks.forEach(h => h?.cleanup?.()); },
  };
}
for (const newerPending of [false, true]) test(`two live XLSX consumers retain exact upload retry after another settles; newer pending ${newerPending}`, async () => {
  const disk = storage(), created = new Map(), calls = [], gate = deferred(); let attempts = 0, opened = 0;
  const props = { api: async (path, input) => {
    if (path.endsWith('/preview')) return preview;
    assert.equal(path, '/exchange/xlsx/import'); calls.push(structuredClone(input)); attempts++;
    if (!created.has(input.commandId)) created.set(input.commandId, `xlsx-${created.size}`);
    if (attempts === 1) throw new Error('lost ACK after commit');
    if (newerPending && attempts === 3) return gate.promise;
    return { workId: created.get(input.commandId) };
  }, editor: () => { throw new Error('must not save or navigate'); }, work: null, onImported: async () => {}, onOpen: async () => { opened++; throw new Error('open failed'); } };
  const original = '\ufeffsku,text\r\n0012,"雪\n=1+1"\r\n';
  const a = mount(disk, props); await a.choose(original); await a.click('Import XLSX as new work');
  const b = mount(disk, props); await b.click('Retry unresolved XLSX import');
  const actions = new MaintenanceActions(disk, 'xlsx-import'); assert.equal(actions.read(), null);
  let newer;
  if (newerPending) { await b.choose('new,upload'); await b.click('Import XLSX as new work'); newer = actions.read(); }
  await a.click('Retry unresolved XLSX import');
  assert.deepEqual(calls.at(-1), calls[0]); assert.equal(calls[0].base64, Buffer.from(original).toString('base64'));
  assert.equal(created.size, newerPending ? 2 : 1); assert.deepEqual(actions.read(), newer ?? null); assert.equal(opened, 0);
  if (newerPending) { assert.notEqual(newer.input.commandId, calls[0].commandId); gate.resolve({ workId: created.get(newer.input.commandId) }); await b.flush(); }
  else { await a.choose('new,upload'); await a.click('Import XLSX as new work'); assert.equal(created.size, 2); }
  a.unmount(); b.unmount();
  const reload = mount(disk, props); await reload.click('Open imported XLSX'); assert.match(reload.text(), /open failed/);
  await reload.click('Open imported XLSX'); assert.equal(opened, 2); assert.equal(created.size, 2); reload.unmount();
});
test('actual import UI previews before mutation, retains exact bytes/identity across reload, and opens only on request', async () => {
  const disk = storage(), calls = []; let open = 0, lists = 0, attempts = 0;
  const api = async (path, input) => { calls.push({ path, input }); if (path.endsWith('/preview')) return preview; if (++attempts === 1) throw new Error('lost acknowledgement'); return { workId: 'new' }; };
  const props = { api, editor: () => null, work: null, onImported: async () => { lists++; }, onOpen: async id => { assert.equal(id, 'new'); open++; } };
  let view = mount(disk, props); await view.choose(); assert.equal(calls.length, 1); assert.match(view.text(), /Typed text/); assert.match(view.text(), /0012/);
  assert.match(view.text(), /Bounded literal inline-list dropdowns preserve choices/);
  assert.match(view.text(), /Native checkboxes still prevent XLSX export/);
  assert.match(view.text(), /Reference\/name\/custom validation is not retained or evaluated/);
  await view.click('Import XLSX as new work'); const original = new MaintenanceActions(disk, 'xlsx-import').read();
  assert.equal(original.input.base64, Buffer.from('identifier,text\r\n0012,=1+1\r\n').toString('base64')); assert.equal(open, 0); view.unmount();
  view = mount(disk, props); await view.click('Retry unresolved XLSX import');
  assert.deepEqual(calls[2], calls[1]); assert.equal(open, 0); assert.equal(lists, 1); assert.equal(new MaintenanceActions(disk, 'xlsx-import').read(), null);
  await view.click('Open imported XLSX'); assert.equal(open, 1); view.unmount();
});
for (const outcome of ['success', 'error']) test(`stale import ${outcome} after remount cannot settle a newer pending identity`, async () => {
  const disk = storage(), a = deferred(), b = deferred(); let calls = 0;
  const props = { api: async path => { if (path.endsWith('/preview')) return preview; calls++; if (calls === 1) return a.promise; if (calls === 2) return { workId: 'A' }; return b.promise; }, editor: () => null, work: null, onImported: async () => {}, onOpen: async () => {} };
  const old = mount(disk, props); await old.choose(); await old.click('Import XLSX as new work'); old.unmount();
  const view = mount(disk, props); await view.click('Retry unresolved XLSX import'); await view.choose('new,upload'); await view.click('Import XLSX as new work');
  const actions = new MaintenanceActions(disk, 'xlsx-import'), pending = actions.read();
  if (outcome === 'success') a.resolve({ workId: 'A' }); else a.reject(new ApiError('/exchange/xlsx/import', 400, 'invalid_csv_input'));
  await view.flush(); assert.deepEqual(actions.read(), pending); b.reject(new Error('offline')); await view.flush(); view.unmount();
});

test('actual XLSX export consumer commits pending edit, sends all tabs, downloads real bytes without autosave', async () => {
  const book={id:'current',sheetOrder:['one','two'],sheets:{one:{cellData:{}},two:{cellData:{0:{0:{v:'pending'}}}}}}; let commits=0; const calls=[];
  const native={commit:async()=>{commits++;return book;}};
  const view=mount(storage(),{api:async(path,input)=>{calls.push({path,input});assert.equal(path,'/exchange/xlsx/export');return {base64:btoa('PK fixture'),filename:'Current.xlsx',warnings:['Caches unknown']};},editor:()=>native,work:{id:'current'},onImported:async()=>{},onOpen:async()=>{}});
  await view.click('Export all tabs XLSX'); assert.equal(commits,1);assert.deepEqual(calls,[{path:'/exchange/xlsx/export',input:{workId:'current',book}}]);
  assert.equal(await view.blobs[0].text(),'PK fixture');assert.equal(view.downloads[0].download,'Current.xlsx');assert.match(view.text(),/without saving to the server/); view.unmount();
});
test('XLSX export refuses download after navigation and refuses uncommitted cell', async()=>{
  for(const navigation of [true,false]) {
    const gate=deferred(),native={commit:()=>gate.promise};let current=native,calls=0;
    const view=mount(storage(),{api:async()=>{calls++;},editor:()=>current,work:{id:'current'},onImported:async()=>{},onOpen:async()=>{}});
    await view.click('Export all tabs XLSX'); if(navigation){current={};gate.resolve({id:'current'});}else gate.reject(new Error('Finish current cell'));
    await view.flush();assert.equal(calls,0);assert.equal(view.downloads.length,0);view.unmount();
  }
});
test('XLSX local quota includes other drafts and refusal creates no import effect', async()=>{
  const disk=storage(); disk.setItem('workagent-human-draft','x'.repeat(4_000_000));let imports=0;
  const view=mount(disk,{api:async(path)=>{if(path.endsWith('/preview'))return preview;imports++;},editor:()=>null,work:null,onImported:async()=>{},onOpen:async()=>{}});
  await view.choose();await view.click('Import XLSX as new work');assert.equal(imports,0);assert.match(view.text(),/storage is full/);assert.equal(new MaintenanceActions(disk,'xlsx-import').read(),null);view.unmount();
});
