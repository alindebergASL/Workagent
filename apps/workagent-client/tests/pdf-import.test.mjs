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
const code = ts.transpileModule(readFileSync(new URL('../src/PdfExchange.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const uploads = new Map();
const pdfUpload = { put: async (key, bytes) => { uploads.set(key, bytes); }, get: async key => { if (!uploads.has(key)) throw new Error('missing retained upload'); return uploads.get(key); } };
const storage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const preview = { filename: 'unknown.pdf', bytes: 30, encoding: 'UTF-8', sample: '# Literal source\nText', clipped: false, paragraphs: 2, pages: 2, previewHash: 'a'.repeat(64), warnings: ['Fixture loss warning'] };
function mount(disk, props) {
  let index = 0, effects = [], tree, dirty = true, mounted = true; const hooks = [], downloads = [], blobs = [];
  const react = {
    useState(initial) { const i = index++; hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, v => { if (mounted) { hooks[i].value = typeof v === 'function' ? v(hooks[i].value) : v; dirty = true; } }]; },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useEffect(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v, j) => !Object.is(v, hooks[i].deps[j]))) { hooks[i] = { deps, cleanup: hooks[i]?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  const module = { exports: {} }, document = { createElement: () => { const a = { click() { downloads.push({ href: this.href, download: this.download }); } }; return a; } };
  new Function('require', 'module', 'exports', 'localStorage', 'crypto', 'document', 'URL', code)(name => name === 'react' ? react : name === './pdf-import-storage' ? { pdfUpload } : name === './PdfExport' ? { PdfExport: () => null } : name === './maintenance-actions' ? { MaintenanceActions } : name.endsWith('/document.mjs') ? documents : require(name), module, module.exports, disk, { randomUUID }, document, { createObjectURL: blob => { blobs.push(blob); return 'blob:download'; }, revokeObjectURL() {} });
  const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
  const text = n => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : String(n ?? '');
  function render() { index = 0; dirty = false; tree = module.exports.PdfExchange(props); const pending = effects; effects = []; pending.forEach(f => f()); }
  const flush = async () => { for (let i = 0; i < 8; i++) { if (dirty && mounted) render(); await new Promise(setImmediate); } };
  render();
  return { flush, downloads, blobs, text: () => text(tree),
    async choose(content = 'identifier,text\r\n0012,=1+1\r\n', name = 'unknown.pdf') { const file = new File([content], name); const input = nodes(tree).find(n => n.type === 'input' && n.props.type === 'file'); assert.ok(!input.props.disabled); input.props.onChange({ target: { files: [file], value: name } }); await flush(); },
    async click(label) { const button = nodes(tree).find(n => n.type === 'button' && text(n.props.children) === label); assert.ok(button, label); assert.ok(!button.props.disabled); button.props.onClick(); await flush(); },
    async update(next) { props = { ...props, ...next }; dirty = true; await flush(); },
    unmount() { mounted = false; hooks.forEach(h => h?.cleanup?.()); },
  };
}
for (const duringStorage of [false, true]) test(`two tabs never substitute B for A's displayed preview; conflict during storage ${duringStorage}`, async () => {
  const disk = storage(), calls = [], gate = deferred(); let bAttempts = 0;
  const props = { api: async (path, input) => {
    if (path.endsWith('/preview')) return { ...preview, filename: input.filename, sample: input.filename + ' preview', previewHash: Buffer.from(input.base64).toString('hex') };
    calls.push(structuredClone(input));
    if (input.filename === 'B.pdf' && ++bAttempts === 1) throw new Error('unknown outcome');
    return { workId: input.filename };
  }, editor: () => assert.fail('must not touch current editor'), work: null, onImported: async () => {}, onOpen: async () => assert.fail('no automatic open') };
  const a = mount(disk, props), b = mount(disk, props), actions = new MaintenanceActions(disk, 'pdf-import');
  const originalPut = pdfUpload.put;
  try {
    await a.choose('A immutable bytes', 'A.pdf'); await b.choose('B immutable bytes 雪', 'B.pdf');
    if (duringStorage) {
      pdfUpload.put = async (key, bytes) => { if (bytes === Buffer.from('A immutable bytes').toString('base64')) await gate.promise; await originalPut(key, bytes); };
      await a.click('Import as new work');
    }
    await b.click('Import as new work'); const pendingB = actions.read();
    assert.equal(calls.length, 1); const originalB = structuredClone(calls[0]);
    if (duringStorage) { gate.resolve(); await a.flush(); }
    else await a.click('Import as new work');
    assert.equal(calls.length, 1, 'A Import must dispatch neither B nor a fresh command');
    assert.deepEqual(actions.read(), pendingB); assert.match(a.text(), /Another unresolved request.*B.pdf/); assert.match(a.text(), /A.pdf preview/);
    await a.click('Retry unresolved PDF import: B.pdf');
    assert.equal(calls.length, 2); assert.deepEqual(calls[1], originalB);
    assert.equal(calls[1].base64, Buffer.from('B immutable bytes 雪').toString('base64'));
    assert.equal(actions.read(), null); assert.match(a.text(), /A.pdf preview/);
    await a.click('Import as new work');
    assert.equal(calls.length, 3); assert.equal(calls[2].filename, 'A.pdf');
    assert.equal(calls[2].base64, Buffer.from('A immutable bytes').toString('base64')); assert.notEqual(calls[2].commandId, originalB.commandId);
  } finally { pdfUpload.put = originalPut; a.unmount(); b.unmount(); }
});
test('unknown pending commands are neither dispatched nor cleared', async () => {
  const disk = storage(), actions = new MaintenanceActions(disk, 'pdf-import');
  const pending = actions.prepare('unknown', '/unknown', { filename: 'unknown.pdf' }, randomUUID);
  const view = mount(disk, { api: () => assert.fail('unknown dispatch'), editor: () => null, work: null, onImported: async () => {}, onOpen: async () => {} });
  await view.click('Retry unresolved PDF import: unknown.pdf');
  assert.match(view.text(), /Unrecognized pending request retained/); assert.deepEqual(actions.read(), pending); view.unmount();
});
for (const newerPending of [false, true]) test(`two live document consumers retain exact upload retry after another settles; newer pending ${newerPending}`, async () => {
  const disk = storage(), created = new Map(), calls = [], gate = deferred(); let attempts = 0, opened = 0;
  const props = { api: async (path, input) => {
    if (path.endsWith('/preview')) return { ...preview, previewHash: Buffer.from(JSON.stringify(input ?? {})).toString('hex') };
    assert.equal(path, '/exchange/pdf/import'); calls.push(structuredClone(input)); attempts++;
    if (!created.has(input.commandId)) created.set(input.commandId, `doc-${created.size}`);
    if (attempts === 1) throw new Error('lost ACK after commit');
    if (newerPending && attempts === 3) return gate.promise;
    return { workId: created.get(input.commandId) };
  }, editor: () => { throw new Error('must not save or navigate'); }, work: null, onImported: async () => {}, onOpen: async () => { opened++; throw new Error('open failed'); } };
  const original = '\ufeffsku,text\r\n0012,"雪\n=1+1"\r\n';
  const a = mount(disk, props); await a.choose(original); await a.click('Import as new work');
  const b = mount(disk, props); await b.click('Retry unresolved PDF import: unknown.pdf');
  const actions = new MaintenanceActions(disk, 'pdf-import'); assert.equal(actions.read(), null);
  let newer;
  if (newerPending) { await b.choose('new,upload'); await b.click('Import as new work'); newer = actions.read(); }
  await a.click('Retry unresolved PDF import: unknown.pdf');
  assert.deepEqual(calls.at(-1), calls[0]); assert.equal(calls[0].base64, Buffer.from(original).toString('base64'));
  assert.equal(created.size, newerPending ? 2 : 1); assert.deepEqual(actions.read(), newer ?? null); assert.equal(opened, 0);
  if (newerPending) { assert.notEqual(newer.input.commandId, calls[0].commandId); gate.resolve({ workId: created.get(newer.input.commandId) }); await b.flush(); }
  else { await a.choose('new,upload'); await a.click('Import as new work'); assert.equal(created.size, 2); }
  a.unmount(); b.unmount();
  const reload = mount(disk, props); await reload.click('Open imported PDF text document'); assert.match(reload.text(), /open failed/);
  await reload.click('Open imported PDF text document'); assert.equal(opened, 2); assert.equal(created.size, 2); reload.unmount();
});
test('actual import UI previews before mutation, retains exact bytes/identity across reload, and opens only on request', async () => {
  const disk = storage(), calls = []; let open = 0, lists = 0, attempts = 0;
  const api = async (path, input) => { calls.push({ path, input }); if (path.endsWith('/preview')) return { ...preview, previewHash: Buffer.from(JSON.stringify(input ?? {})).toString('hex') }; if (++attempts === 1) throw new Error('lost acknowledgement'); return { workId: 'new' }; };
  const props = { api, editor: () => null, work: null, onImported: async () => { lists++; }, onOpen: async id => { assert.equal(id, 'new'); open++; } };
  let view = mount(disk, props); await view.choose(); assert.equal(calls.length, 1); assert.match(view.text(), /No OCR/); assert.match(view.text(), /Literal source/);
  await view.click('Import as new work'); const original = new MaintenanceActions(disk, 'pdf-import').read();
  assert.equal(original.input.base64, undefined); assert.equal(await pdfUpload.get(original.input.previewHash), Buffer.from('identifier,text\r\n0012,=1+1\r\n').toString('base64')); assert.equal(open, 0); view.unmount();
  view = mount(disk, props); await view.click('Retry unresolved PDF import: unknown.pdf');
  assert.deepEqual(calls[2], calls[1]); assert.equal(open, 0); assert.equal(lists, 1); assert.equal(new MaintenanceActions(disk, 'pdf-import').read(), null);
  await view.click('Open imported PDF text document'); assert.equal(open, 1); view.unmount();
});
for (const outcome of ['success', 'error']) test(`stale import ${outcome} after remount cannot settle a newer pending identity`, async () => {
  const disk = storage(), a = deferred(), b = deferred(); let calls = 0;
  const props = { api: async (path, input) => { if (path.endsWith('/preview')) return { ...preview, previewHash: Buffer.from(JSON.stringify(input ?? {})).toString('hex') }; calls++; if (calls === 1) return a.promise; if (calls === 2) return { workId: 'A' }; return b.promise; }, editor: () => null, work: null, onImported: async () => {}, onOpen: async () => {} };
  const old = mount(disk, props); await old.choose(); await old.click('Import as new work'); old.unmount();
  const view = mount(disk, props); await view.click('Retry unresolved PDF import: unknown.pdf'); await view.choose('new,upload'); await view.click('Import as new work');
  const actions = new MaintenanceActions(disk, 'pdf-import'), pending = actions.read();
  if (outcome === 'success') a.resolve({ workId: 'A' }); else a.reject(new ApiError('/exchange/pdf/import', 400, 'invalid_csv_input'));
  await view.flush(); assert.deepEqual(actions.read(), pending); b.reject(new Error('offline')); await view.flush(); view.unmount();
});

test('PDF retry storage failure prevents dispatch; typed OCR refusal shows no adoption action', async () => {
 const disk=storage();let calls=0;
 const props={api:async (path)=>{calls++;if(path.endsWith('/preview'))return preview;throw Error('must not send');},editor:()=>{throw Error('must not touch editor');},work:null,onImported:async()=>{},onOpen:async()=>{}};
 const old=pdfUpload.put;pdfUpload.put=async()=>{throw Error('device storage full');};
 const view=mount(disk,props);await view.choose('pdf','test.pdf');await view.click('Import as new work');
 assert.equal(calls,1);assert.match(view.text(),/device storage full/);assert.equal(new MaintenanceActions(disk,'pdf-import').read(),null);view.unmount();pdfUpload.put=old;
 const refused=mount(storage(),{...props,api:async()=>{throw new ApiError('/exchange/pdf/preview',400,'pdf_ocr_not_supported');}});
 await refused.choose();assert.match(refused.text(),/Scanned PDFs require OCR/);assert.ok(!refused.text().includes('Import as new work'));refused.unmount();
});
test('per-page refusal discloses blank-page restriction and image-text loss without adoption', async () => {
  const view = mount(storage(), { api: async () => { throw new ApiError('/exchange/pdf/preview', 400, 'pdf_page_without_text'); }, editor: () => null, work: null, onImported: async () => {}, onOpen: async () => {} });
  await view.choose();
  assert.match(view.text(), /At least one page has no Unicode letter or number/);
  assert.match(view.text(), /blank or scanned-only pages/);
  assert.match(view.text(), /Text inside images is omitted even on pages that also have a text layer/);
  assert.ok(!view.text().includes('Import as new work')); view.unmount();
});
