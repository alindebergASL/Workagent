import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
// Exercise the actual App's import navigation and durable save consumer. Hook/native
// handles and asynchronous transactions are fixtures; persistence orchestration
// and callbacks below are real client code. This does not qualify browser IDB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { blankWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { DraftFence } from '../src/drafts.ts';
import * as resume from '../src/resume.ts';
import { MaintenanceActions } from '../src/maintenance-actions.ts';
import { artifactStore, artifactFixture, FixtureArtifactStorage, draftRaw, saveActions } from './artifact-storage-fixture.mjs';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const disk = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const work = id => ({ id, book: blankWorkbook(id, id), expected: { contentRevision: 1, permissionRevision: 1, intentRevision: 0, cancellationEpoch: 0 }, contentRevision: 1, intentRevision: 0, eventSequence: 1, status: 'ready', messages: [], proposals: [] });
function mount(storage, fetcher) {
  const downloads = [];
  let root, index = 0, effects = [], tree, dirty = true, mounted = true; const hooks = [];
  const PdfExport = () => null, DocxExchange = () => null, DocumentEditor = () => null, DocumentExchange = () => null, NativeEditor = () => null, CsvExchange = () => null, XlsxExchange = () => null;
  const react = {
    useState(initial) { const i = index++; hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { if (mounted) { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; dirty = true; } }]; },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useCallback(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v, j) => v !== hooks[i].deps[j])) hooks[i] = { deps, fn }; return hooks[i].fn; },
    useEffect(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v, j) => v !== hooks[i].deps[j])) { hooks[i] = { deps, cleanup: hooks[i]?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'localStorage', 'document', 'window', 'fetch', 'crypto', 'setTimeout', 'clearTimeout', 'URL', code)(name => {
    if (name === 'react') return react;
    if (name === 'react-dom/client') return { createRoot: () => ({ render: element => { root = element.type; } }) };
    if (name === './DocxExchange') return { DocxExchange };
    if (name === './PdfExport') return { PdfExport };
    if (name === './DocumentExchange') return { DocumentExchange };
    if (name === './DocumentEditor') return { DocumentEditor };
    if (name === './NativeEditor') return { NativeEditor };
    if (name === './XlsxExchange') return { XlsxExchange };
    if (name === './CsvExchange') return { CsvExchange };
    if (name === './MaintenancePanel') return { MaintenancePanel: () => null };
    if (name === './drafts') return { DraftFence };
    if (name === './resume') return resume;
    if (name === './artifact-storage') return { ArtifactStorage: FixtureArtifactStorage };
    if (name === './maintenance-actions') return { MaintenanceActions };
    if (name.endsWith('.css')) return {};
    return require(name);
  }, module, module.exports, storage, { getElementById: () => ({}), createElement: () => ({ click() {} }) }, { addEventListener() {}, removeEventListener() {} }, fetcher, { randomUUID }, () => 1, () => {}, { createObjectURL: blob => { downloads.push(blob); return 'blob:fixture'; }, revokeObjectURL() {} });
  const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
  const text = n => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : String(n ?? '');
  function render() { index = 0; dirty = false; tree = root(); const pending = effects; effects = []; pending.forEach(f => f()); }
  const flush = async () => { for (let i = 0; i < 10; i++) { if (dirty && mounted) render(); await new Promise(setImmediate); } };
  render();
  return { elements: () => nodes(tree), downloads, async until(predicate) { for (let i = 0; i < 200; i++) { await flush(); if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail(text(tree)); }, docx: () => nodes(tree).find(n => n.type === DocxExchange).props, doc: () => nodes(tree).find(n => n.type === DocumentEditor)?.props, documents: () => nodes(tree).find(n => n.type === DocumentExchange).props, flushSync: render, flush, text: () => text(tree), exchange: () => nodes(tree).find(n => n.type === CsvExchange).props, xlsx: () => nodes(tree).find(n => n.type === XlsxExchange).props,
    async click(label) { const button = nodes(tree).find(n => n.type === 'button' && text(n.props.children) === label); assert.ok(button, label); assert.ok(!button.props.disabled); button.props.onClick(); await flush(); },
    titleValue: () => nodes(tree).find(n => n.props['aria-label'] === 'New work name').props.value,
    async title(value) { nodes(tree).find(n => n.props['aria-label'] === 'New work name').props.onChange({ target: { value } }); await flush(); },
    async open(id) { nodes(tree).find(n => n.type === 'select' && n.props['aria-label'] === 'Saved work').props.onChange({ target: { value: id } }); await flush(); },
    native: () => nodes(tree).find(n => n.type === NativeEditor)?.props,
    messageValue: () => nodes(tree).find(n => n.props.id === 'prompt').props.value,
    async message(value) { nodes(tree).find(n => n.props.id === 'prompt').props.onChange({ target: { value } }); await flush(); },
    async send() { nodes(tree).find(n => n.type === 'form' && n.props.className === 'composer').props.onSubmit({ preventDefault() {} }); await flush(); },
    async save() { const button = nodes(tree).find(n => n.type === 'button' && text(n.props.children) === 'Save sheet'); assert.ok(!button.props.disabled); button.props.onClick(); await flush(); },
    unmount() { mounted = false; hooks.forEach(h => h?.cleanup?.()); },
  };
}
function server(handler) {
  const works = { old: work('old'), imported: work('imported') }, calls = [];
  return { works, calls, fetch: async (path, options) => {
    const input = options.body ? JSON.parse(options.body) : undefined; calls.push({ path, input });
    let result;
    if (path === '/api/work') result = Object.values(works).map(w => ({ id: w.id, title: w.id, status: w.status }));
    else if (path === '/api/events') result = { kind: 'reset', cursor: 1, events: [], works: [], snapshots: [] };
    else if (input && (path.endsWith('/save') || path === '/api/work/commands' || path === '/api/work/blank')) result = await handler(path, input, works);
    else result = works[path.split('/').at(-1)];
    return { ok: true, status: 200, json: async () => structuredClone(result) };
  } };
}
function attach(view) {
  let book = structuredClone(view.native().book);
  let selected = { workId: book.id, sheetId: 'sheet1', sheetName: 'Sheet 1', rangeLabel: 'A1:B2', range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } }, epoch = 0;
  const handle = { save: () => structuredClone(book), commit: async () => structuredClone(book), isEditing: () => false, selection: () => structuredClone(selected), selectionEpoch: () => epoch };
  view.native().onReady(handle);
  return { handle, select(changes) { selected = { ...selected, ...changes }; epoch++; }, edit(v) { book.sheets.sheet1.cellData = { 0: { 0: { v, t: 1 } } }; view.native().onEdit(structuredClone(book)); } };
}
for (const newerPending of [false, true]) test(`two live blank consumers keep one retry identity after another settles it; newer pending ${newerPending}`, async () => {
  const storage = disk(), created = new Map(), gate = deferred(); let attempts = 0;
  const api = server((path, input, works) => {
    assert.equal(path, '/api/work/blank'); attempts++;
    if (!created.has(input.commandId)) { const id = `blank-${created.size}`; created.set(input.commandId, id); works[id] = work(id); }
    if (attempts === 1) throw new Error('lost ACK after commit');
    if (newerPending && attempts === 3) return gate.promise;
    return { workId: created.get(input.commandId) };
  });
  const a = mount(storage, api.fetch); await a.flush(); await a.title('One intended blank'); await a.click('Create blank spreadsheet');
  const b = mount(storage, api.fetch); await b.flush(); await b.click('Retry blank creation');
  const actions = new MaintenanceActions(storage, 'blank-sheet'); assert.equal(actions.read(), null);
  let newer;
  if (newerPending) { await b.title('Deliberate second blank'); await b.click('Create blank spreadsheet'); newer = actions.read(); }
  await a.click('Retry blank creation');
  const calls = api.calls.filter(c => c.path === '/api/work/blank');
  assert.deepEqual(calls.at(-1), calls[0], 'visible Retry uses its original body and command');
  assert.equal(created.size, newerPending ? 2 : 1); assert.deepEqual(actions.read(), newer ?? null);
  if (newerPending) { assert.notEqual(newer.input.commandId, calls[0].input.commandId); gate.resolve({ workId: created.get(newer.input.commandId) }); await b.flush(); }
  else { await a.title('Deliberate second blank'); await a.click('Create blank spreadsheet'); assert.equal(created.size, 2); }
  a.unmount(); b.unmount();
  const reload = mount(storage, api.fetch); await reload.flush(); await reload.click('Open created work');
  assert.equal(reload.native().book.id, 'blank-1'); assert.equal(created.size, 2); reload.unmount();
});
for (const format of ['exchange', 'xlsx', 'docx']) test(`${format} opening preserves unsaved native draft and composer; a save in flight prevents switching`, async () => {
  const storage = disk(), pending = deferred(), api = server(() => pending.promise), view = mount(storage, api.fetch);
  await view.flush(); await view.open('old'); const native = attach(view); native.edit('unsaved human'); await view.message('unsent human message'); await view.flush();
  await view[format]().onOpen('imported'); await view.flush(); assert.equal(view.native().book.id, 'imported');
  assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.sheets.sheet1.cellData[0][0].v, 'unsaved human');
  await view.open('old'); assert.equal(view.native().book.sheets.sheet1.cellData[0][0].v, 'unsaved human'); attach(view); assert.equal(view.messageValue(), 'unsent human message');
  await view.save(); await view[format]().onOpen('imported'); await view.flush(); assert.equal(view.native().book.id, 'old'); assert.match(view.text(), /Wait for the current save/);
  pending.resolve({ contentRevision: 2, permissionRevision: 1 }); await view.flush(); view.unmount();
});
test('actual App lost save acknowledgement survives reload and rebases newer edits after exact retry', async () => {
  const storage = disk(); let saves = 0;
  const api = server((path, input, works) => { saves++; if (saves === 1) { works.old = { ...works.old, book: input.book, contentRevision: 2, eventSequence: 2, expected: { ...works.old.expected, contentRevision: 2 } }; throw new Error('lost acknowledgement'); } return { contentRevision: 2, permissionRevision: 1 }; });
  let view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view); native.edit('first saved edit'); await view.flush(); await view.save();
  const first = await saveActions(storage, 'old').read(); assert.ok(first); native.edit('newer unsaved edit'); await view.flush(); view.unmount();
  view = mount(storage, api.fetch); await view.flush(); await view.open('old'); attach(view); await view.save();
  const posted = api.calls.filter(c => c.path.endsWith('/save')); assert.equal(posted.length, 2); assert.deepEqual(posted[1], posted[0]);
  assert.equal(await saveActions(storage, 'old').read(), null);
  const draft = JSON.parse(await draftRaw(storage, 'old')); assert.equal(draft.revision, 2); assert.equal(draft.book.sheets.sheet1.cellData[0][0].v, 'newer unsaved edit'); view.unmount();
});
test('actual App late acknowledgement cannot remove a newer save identity or recovery draft after reload', async () => {
  const storage = disk(), late = deferred(), next = deferred(); let count = 0;
  const api = server(() => { count++; return count === 1 ? late.promise : count === 2 ? { contentRevision: 2, permissionRevision: 1 } : next.promise; });
  const old = mount(storage, api.fetch); await old.flush(); await old.open('old'); attach(old).edit('A'); await old.flush(); await old.save(); old.unmount();
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); let native = attach(view); await view.save();
  native.edit('B'); await view.flush(); await view.save(); const actions = saveActions(storage, 'old'), pending = await actions.read(), recovery = await draftRaw(storage, 'old');
  assert.ok(pending); late.resolve({ contentRevision: 2, permissionRevision: 1 }); await view.flush(); assert.deepEqual(await actions.read(), pending); assert.equal(await draftRaw(storage, 'old'), recovery);
  next.reject(new Error('offline')); await view.flush(); view.unmount();
});

test('normal composer after import admits only the explicit continuation with imported-work identity', async () => {
  const storage = disk(), api = server((path, input) => { assert.equal(path, '/api/work/commands'); return { workId: input.workId }; });
  const view = mount(storage, api.fetch); await view.flush(); await view.open('imported'); attach(view);
  assert.equal(api.calls.filter(c => c.path === '/api/work/commands').length, 0);
  await view.message('Explain my corrected quantities'); await view.send();
  const commands = api.calls.filter(c => c.path === '/api/work/commands'); assert.equal(commands.length, 1);
  assert.equal(commands[0].input.kind, 'continue'); assert.equal(commands[0].input.workId, 'imported'); assert.equal(commands[0].input.expectedIntentRevision, 0);
  assert.equal(commands[0].input.text, 'Explain my corrected quantities'); assert.deepEqual(commands[0].input.sourceIds, []); view.unmount();
});

for (const editA of [false, true]) for (const order of ['A-first', 'B-first']) test(`same-command ACK ${order} cannot ${editA ? 'rewrite' : 'delete'} newer recovery across two live consumers and reload`, async () => {
  const storage = disk(), first = deferred(), second = deferred(); let count = 0;
  const api = server((path, input, works) => {
    if (path === '/api/work/commands') return { workId: input.workId };
    count++;
    works.old = { ...works.old, book: input.book, contentRevision: count <= 2 ? 2 : 3, eventSequence: count <= 2 ? 2 : 3 };
    return count === 1 ? first.promise : count === 2 ? second.promise : { contentRevision: 3, permissionRevision: 2 };
  });
  const a = mount(storage, api.fetch); await a.flush(); await a.open('old'); const nativeA = attach(a); nativeA.edit('A'); await a.flush(); await a.save();
  if (editA) { nativeA.edit('A edited during await'); await a.flush(); }
  const b = mount(storage, api.fetch); await b.flush(); await b.open('old'); const native = attach(b); native.edit('B'); await b.flush(); await b.save();
  const posted = api.calls.filter(c => c.path.endsWith('/save')); assert.deepEqual(posted[0].input, posted[1].input);
  const ack = { contentRevision: 2, permissionRevision: 2 };
  if (order === 'A-first') { first.resolve(ack); await a.flush(); } else { second.resolve(ack); await b.flush(); }
  assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.sheets.sheet1.cellData[0][0].v, 'B');
  // Further typing while the other consumer's response is still held.
  native.edit('B newer'); await b.flush();
  if (order === 'A-first') { second.resolve(ack); await b.flush(); } else { first.resolve(ack); await a.flush(); }
  const recovery = JSON.parse(await draftRaw(storage, 'old'));
  assert.equal(recovery.book.sheets.sheet1.cellData[0][0].v, 'B newer'); assert.equal(recovery.revision, 2); assert.equal(recovery.permission, 2);
  assert.match(b.text(), /Unsaved changes/); a.unmount(); b.unmount();
  const reload = mount(storage, api.fetch); await reload.flush(); await reload.open('old'); attach(reload);
  assert.equal(reload.native().book.sheets.sheet1.cellData[0][0].v, 'B newer'); await reload.save();
  const last = api.calls.filter(c => c.path.endsWith('/save')).at(-1).input;
  assert.equal(last.contentRevision, 2); assert.equal(last.permissionRevision, 2); assert.notEqual(last.commandId, posted[0].input.commandId);
  assert.equal(await draftRaw(storage, 'old'), null); reload.unmount();
});

test('late duplicate ACK after a newer command settled cannot resurrect recovery or rewind the live base', async () => {
  const storage = disk(), late = deferred(); let count = 0;
  const api = server((path, input, works) => {
    count++; const revision = count <= 2 ? 2 : count;
    works.old = { ...works.old, book: input.book, contentRevision: revision, eventSequence: revision, expected: { ...works.old.expected, permissionRevision: revision } };
    return count === 1 ? late.promise : { contentRevision: revision, permissionRevision: revision };
  });
  const a = mount(storage, api.fetch); await a.flush(); await a.open('old'); attach(a).edit('A'); await a.flush(); await a.save();
  const b = mount(storage, api.fetch); await b.flush(); await b.open('old'); const native = attach(b); native.edit('B'); await b.flush(); await b.save(); await b.save();
  assert.equal(await draftRaw(storage, 'old'), null);
  late.resolve({ contentRevision: 2, permissionRevision: 2 }); await a.flush();
  assert.equal(await draftRaw(storage, 'old'), null);
  native.edit('C'); await b.flush(); await b.save();
  const last = api.calls.filter(c => c.path.endsWith('/save')).at(-1).input;
  assert.equal(last.contentRevision, 3); assert.equal(last.permissionRevision, 3); a.unmount(); b.unmount();
});

// Actual installed formula engine; only hooks and response delivery are fixtures.
const sdkRequire = createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
const core = sdkRequire('@univerjs/core'), { FUniver } = sdkRequire('@univerjs/core/facade');
sdkRequire('@univerjs/sheets/facade'); sdkRequire('@univerjs/engine-formula/facade'); sdkRequire('@univerjs/sheets-formula/facade');
test('actual SDK calculation between App save and ACK is Saved and continuation needs no extra save', async () => {
  const storage = disk(), gate = deferred(), api = server((path, input, works) => {
    if (path === '/api/work/commands') return { workId: input.workId };
    works.old = { ...works.old, book: input.book, contentRevision: 2, eventSequence: 2 }; return gate.promise;
  });
  api.works.old.book.sheets.sheet1.cellData = { 0: { 0: { v: 1, t: 2 }, 1: { f: '=A1*2', si: 'shared' } }, 1: { 1: { si: 'shared' } } };
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old');
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: {} } });
  univer.registerPlugin(sdkRequire('@univerjs/sheets').UniverSheetsPlugin);
  univer.registerPlugin(sdkRequire('@univerjs/engine-formula').UniverFormulaEnginePlugin);
  univer.registerPlugin(sdkRequire('@univerjs/sheets-formula').UniverSheetsFormulaPlugin);
  const sdk = FUniver.newAPI(univer), book = sdk.createWorkbook(structuredClone(view.native().book));
  try {
    await sdk.getFormula().onCalculationResultApplied(4000);
    view.native().onReady({ save: () => structuredClone(book.save()), commit: async () => structuredClone(book.save()), isEditing: () => false });
    book.getActiveSheet().getRange('A1').setValue(10); view.native().onEdit(structuredClone(book.save())); view.flushSync(); await view.save();
    const submitted = api.calls.find(c => c.path.endsWith('/save')).input.book;
    assert.equal(submitted.sheets.sheet1.cellData[0][1].v, 2);
    await sdk.getFormula().onCalculationResultApplied(4000); assert.equal(book.save().sheets.sheet1.cellData[0][1].v, 20);
    gate.resolve({ contentRevision: 2, permissionRevision: 1 }); await view.flush();
    assert.doesNotMatch(view.text(), /Unsaved changes/); assert.equal(await draftRaw(storage, 'old'), null);
    await view.message('Continue with my saved quantities'); await view.send();
    assert.equal(api.calls.filter(c => c.path.endsWith('/save')).length, 1);
    assert.equal(api.calls.filter(c => c.path === '/api/work/commands').length, 1);
  } finally { view.unmount(); await new Promise(r => setTimeout(r, 1100)); univer.dispose(); }
});
for (const [label, change] of Object.entries({
  formula: b => { b.sheets.sheet1.cellData[0][1].f = '=A1*3'; },
  sharedFormula: b => { b.sheets.sheet1.cellData[0][1].si = 'different'; },
  style: b => { b.sheets.sheet1.cellData[0][1].s = { bg: { rgb: '#ff0000' } }; },
  literal: b => { b.sheets.sheet1.cellData[0][0].v = 'changed'; },
  literalType: b => { b.sheets.sheet1.cellData[0][0].t = 2; },
  format: b => { b.styles = { human: { n: { pattern: '0.00' } } }; },
  range: b => { b.sheets.sheet1.mergeData = [{ startRow: 2, endRow: 3, startColumn: 0, endColumn: 1 }]; },
})) test(`ACK content comparison preserves a newer ${label} even without another edit callback`, async () => {
  const storage = disk(), gate = deferred(), api = server(() => gate.promise), view = mount(storage, api.fetch);
  await view.flush(); await view.open('old'); const native = attach(view); native.edit('A'); await view.flush();
  const book = native.handle.save(); book.sheets.sheet1.cellData[0][1] = { f: '=A1*2', v: 2, t: 2 };
  view.native().onReady({ save: () => structuredClone(book), commit: async () => structuredClone(book), isEditing: () => false });
  await view.save(); change(book); gate.resolve({ contentRevision: 2, permissionRevision: 1 }); await view.flush();
  assert.match(view.text(), /Unsaved changes/); assert.deepEqual(JSON.parse(await draftRaw(storage, 'old')).book, book); view.unmount();
});

test('actual App blank action survives lost ACK/reload, stays separate, and opens with native draft/composer preserved', async () => {
  const storage = disk(); let creates = 0;
  const api = server((path, input, works) => {
    assert.equal(path, '/api/work/blank'); creates++; works.blank = work('blank'); works.blank.book.name = input.title;
    if (creates === 1) throw new Error('lost blank acknowledgement');
    return { workId: 'blank', contentRevision: 1 };
  });
  let view = mount(storage, api.fetch); await view.flush(); await view.open('old'); attach(view).edit('human draft'); await view.message('Keep this unsent message');
  await view.title('My blank workbook'); await view.click('Create blank spreadsheet');
  assert.equal(view.native().book.id, 'old'); assert.ok(new MaintenanceActions(storage, 'blank-sheet').read()); view.unmount();
  view = mount(storage, api.fetch); await view.flush(); assert.equal(view.titleValue(), 'My blank workbook'); await view.open('old'); attach(view); await view.click('Retry blank creation');
  assert.deepEqual(api.calls.filter(c => c.path === '/api/work/blank')[0], api.calls.filter(c => c.path === '/api/work/blank')[1]);
  assert.equal(view.native().book.id, 'old'); assert.equal(storage.getItem('workagent-blank:created'), 'blank');
  assert.equal(api.calls.filter(c => c.path === '/api/work/commands').length, 0);
  await view.click('Open created work'); assert.equal(view.native().book.id, 'blank'); assert.equal(view.native().book.name, 'My blank workbook');
  await view.open('old'); assert.equal(view.native().book.sheets.sheet1.cellData[0][0].v, 'human draft');
  assert.equal(new resume.ComposerDrafts(storage).read('old').prompt, 'Keep this unsent message'); view.unmount();
});
test('blank saved work remains findable after opening is blocked by an in-flight save', async () => {
  const storage = disk(), gate = deferred(), api = server((path, input, works) => {
    if (path === '/api/work/blank') { works.blank = work('blank'); return { workId: 'blank' }; }
    return gate.promise;
  });
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); attach(view).edit('keep draft'); await view.flush(); await view.save();
  await view.click('Create blank spreadsheet'); await view.click('Open created work');
  assert.equal(view.native().book.id, 'old'); assert.match(view.text(), /Wait for the current save/); assert.equal(storage.getItem('workagent-blank:created'), 'blank');
  gate.reject(new Error('offline')); await view.flush(); view.unmount();
  const reload = mount(storage, api.fetch); await reload.flush(); await reload.click('Open created work'); assert.equal(reload.native().book.id, 'blank'); reload.unmount();
});
test('actual App opt-in selection includes pending human edits through saved revision; ordinary requests stay unscoped', async () => {
  const storage = disk(), api = server((path, input, works) => {
    if (path.endsWith('/save')) { works.old = { ...works.old, book: input.book, contentRevision: 2, eventSequence: 2 }; return { contentRevision: 2, permissionRevision: 1 }; }
    return { workId: input.workId };
  });
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view); native.edit('=formula-looking literal');
  await view.click('Attach selected cells'); assert.match(view.text(), /Sheet 1.*A1:B2/); await view.message('Explain these cells'); await view.send();
  const command = api.calls.find(c => c.path === '/api/work/commands').input;
  assert.equal(command.selection.workId, 'old'); assert.equal(command.selection.contentRevision, 2); assert.equal(command.selection.sheetId, 'sheet1');
  assert.equal(api.calls.find(c => c.path.endsWith('/save')).input.book.sheets.sheet1.cellData[0][0].v, '=formula-looking literal');
  assert.equal(api.calls.findIndex(c => c.path.endsWith('/save')) < api.calls.findIndex(c => c.path === '/api/work/commands'), true);
  attach(view); await view.message('A whole-work question'); await view.send();
  assert.equal(api.calls.filter(c => c.path === '/api/work/commands').at(-1).input.selection, undefined); view.unmount();
});
for (const change of ['range', 'tab', 'away-and-back', 'editor', 'newer-revision']) test(`actual App refuses ${change} during asynchronous commit/save without retargeting selection`, async () => {
  const storage = disk(), gate = deferred(), api = server((path, input, works) => {
    if (path.endsWith('/save')) { works.old = { ...works.old, book: input.book, contentRevision: change === 'newer-revision' ? 3 : 2, eventSequence: 3 }; return { contentRevision: 2, permissionRevision: 1 }; }
    return { workId: input.workId };
  });
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view); native.edit('pending edit');
  native.handle.commit = async () => { await gate.promise; return native.handle.save(); };
  await view.click('Attach selected cells'); await view.message('Explain selected data'); await view.send();
  if (change === 'range') native.select({ rangeLabel: 'C1', range: { startRow: 0, endRow: 0, startColumn: 2, endColumn: 2 } });
  if (change === 'tab') native.select({ sheetId: 'different', sheetName: 'Different' });
  if (change === 'away-and-back') { native.select({ sheetId: 'different' }); native.select({ sheetId: 'sheet1' }); }
  if (change === 'editor') attach(view);
  gate.resolve(); await view.flush(); assert.equal(api.calls.filter(c => c.path === '/api/work/commands').length, 0);
  assert.equal(new resume.ComposerDrafts(storage).read('old').prompt, 'Explain selected data'); assert.match(view.text(), /changed|latest edit/); view.unmount();
});
test('selection send lost ACK replays exact descriptor and IDs after reload even if current selection moved; newer message stays', async () => {
  const storage = disk(); let sends = 0; const gate = deferred();
  const api = server((path, input) => { sends++; if (sends === 1) throw new Error('lost send ACK'); return gate.promise; });
  let view = mount(storage, api.fetch); await view.flush(); await view.open('old'); attach(view);
  await view.click('Attach selected cells'); await view.message('Explain A1:B2'); await view.send(); view.unmount();
  view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view); native.select({ sheetId: 'different', sheetName: 'Different' });
  await view.send(); await view.message('My newer message'); gate.resolve({ workId: 'old' }); await view.flush();
  const calls = api.calls.filter(c => c.path === '/api/work/commands'); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.equal(new resume.ComposerDrafts(storage).read('old').prompt, 'My newer message'); assert.equal(new resume.ComposerDrafts(storage).pending('old'), null); view.unmount();
});
test('attachment persists per work and refuses a changed range before saving; removal permits whole-work requests', async () => {
  const storage = disk(), api = server((path, input) => ({ workId: input.workId }));
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view);
  await view.click('Attach selected cells'); await view.message('Which cells?'); native.select({ sheetId: 'other' }); await view.send();
  assert.equal(api.calls.filter(c => c.path === '/api/work/commands').length, 0); assert.match(view.text(), /Attach the intended range again/);
  await view.click('Remove selection'); await view.send(); assert.equal(api.calls.find(c => c.path === '/api/work/commands').input.selection, undefined);
  view.unmount();
});

test('selection changing while the save ACK is held refuses admission and preserves newer typing', async () => {
  const storage = disk(), gate = deferred(), api = server((path, input, works) => {
    if (path.endsWith('/save')) { works.old = { ...works.old, book: input.book, contentRevision: 2, eventSequence: 2 }; return gate.promise; }
    return { workId: input.workId };
  });
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view); native.edit('save me');
  await view.click('Attach selected cells'); await view.message('Explain A1:B2'); await view.send();
  assert.equal(api.calls.filter(c => c.path.endsWith('/save')).length, 1);
  native.select({ sheetId: 'another-tab' }); await view.message('New unsent thought');
  gate.resolve({ contentRevision: 2, permissionRevision: 1 }); await view.flush();
  assert.equal(api.calls.filter(c => c.path === '/api/work/commands').length, 0); assert.equal(new resume.ComposerDrafts(storage).read('old').prompt, 'New unsent thought');
  assert.match(view.text(), /selection changed while saving/); view.unmount();
});
test('new blank acknowledgement never navigates away from edits/messages made during creation', async () => {
  const storage = disk(), gate = deferred(), api = server((path, input, works) => { works.blank = work('blank'); return gate.promise; });
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view);
  await view.click('Create blank spreadsheet'); native.edit('newer edit'); await view.message('Newer unsent message');
  gate.resolve({ workId: 'blank' }); await view.flush();
  assert.equal(view.native().book.id, 'old'); assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.sheets.sheet1.cellData[0][0].v, 'newer edit');
  assert.equal(new resume.ComposerDrafts(storage).read('old').prompt, 'Newer unsent message'); assert.equal(api.calls.filter(c => c.path === '/api/work/commands').length, 0); view.unmount();
});
const docWork = id => { const { book, ...w } = work(id); return { ...w, kind: 'document', document: blankDocument(id, id) }; };
function attachDoc(view) {
  let data = structuredClone(view.doc().document);
  const handle = { save: () => structuredClone(data), commit: async () => structuredClone(data), isEditing: () => false };
  view.doc().onReady(handle);
  return { handle, edit(value) { data = blankDocument(data.id, data.title, value); view.doc().onEdit(structuredClone(data)); } };
}
for (const firstAck of ['A', 'B']) test(`document App same-command ACK ${firstAck}-first preserves newer consumer recovery and composer`, async () => {
  const storage = disk(), aAck = deferred(), bAck = deferred(); let saves = 0;
  const api = server(() => ++saves === 1 ? aAck.promise : bAck.promise); api.works.old = docWork('old');
  const a = mount(storage, api.fetch); await a.flush(); await a.open('old'); attachDoc(a).edit('A'); await a.flush(); await a.click('Save document');
  const b = mount(storage, api.fetch); await b.flush(); await b.open('old'); attachDoc(b).edit('B newer'); await b.message('Unsent document message'); await b.click('Save document');
  const posts = api.calls.filter(c => c.path.endsWith('/save')); assert.deepEqual(posts[0], posts[1]); assert.equal(posts[0].input.book, undefined); assert.equal(posts[0].input.document.body.dataStream, 'A\r\n');
  const ack = { contentRevision: 2, permissionRevision: 1 };
  if (firstAck === 'A') { aAck.resolve(ack); await a.flush(); bAck.resolve(ack); await b.flush(); }
  else { bAck.resolve(ack); await b.flush(); aAck.resolve(ack); await a.flush(); }
  const recovery = JSON.parse(await draftRaw(storage, 'old')); assert.equal(recovery.book.body.dataStream, 'B newer\r\n'); assert.equal(recovery.revision, 2);
  a.unmount(); b.unmount();
  const reload = mount(storage, api.fetch); await reload.flush(); await reload.open('old'); assert.equal(reload.doc().document.body.dataStream, 'B newer\r\n'); assert.equal(reload.messageValue(), 'Unsent document message'); reload.unmount();
});
test('document App preserves native draft across sheet navigation, refuses stale native callbacks and never attaches sheet selection', async () => {
  const storage = disk(), api = server(() => { throw new Error('unexpected write'); }); api.works.old = docWork('old');
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const stale = view.doc(), doc = attachDoc(view); doc.edit('Document human text'); await view.message('Document composer');
  assert.doesNotMatch(view.text(), /Attach selected cells/); assert.equal(view.exchange().work, null); assert.equal(view.xlsx().work, null);
  await view.open('imported'); const sheet = attach(view); sheet.edit('Sheet human text'); await view.message('Sheet composer');
  stale.onReady(doc.handle); stale.onEdit(blankDocument('old', 'Wrong', 'Stale callback'));
  await view.open('old'); assert.equal(view.doc().document.body.dataStream, 'Document human text\r\n'); assert.equal(view.messageValue(), 'Document composer');
  attachDoc(view); await view.open('imported'); assert.equal(view.native().book.sheets.sheet1.cellData[0][0].v, 'Sheet human text'); assert.equal(view.messageValue(), 'Sheet composer'); view.unmount();
});
test('document blank retry retains original kind/title/identity after sibling clears storage', async () => {
  const storage = disk(), created = new Map(); let count = 0;
  const api = server((path, input, works) => {
    assert.equal(path, '/api/work/blank'); assert.equal(input.kind, 'document');
    if (!created.has(input.commandId)) { const id = `doc-${created.size}`; created.set(input.commandId, id); works[id] = docWork(id); }
    if (++count === 1) throw new Error('lost ACK');
    return { workId: created.get(input.commandId) };
  });
  const a = mount(storage, api.fetch); await a.flush(); await a.title('A document'); await a.click('New document');
  const b = mount(storage, api.fetch); await b.flush(); await b.click('Retry blank creation'); await a.click('Retry blank creation');
  const calls = api.calls.filter(c => c.path === '/api/work/blank'); assert.deepEqual(calls[2], calls[0]); assert.equal(created.size, 1);
  await a.click('Open created work'); assert.equal(a.doc().document.id, 'doc-0'); a.unmount(); b.unmount();
});
test('document App refuses a native instance disposed while commit is pending before dispatch', async () => {
  const storage = disk(), gate = deferred(), api = server(() => { throw new Error('stale commit must never dispatch'); }); api.works.old = docWork('old');
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attachDoc(view); native.edit('Human draft');
  native.handle.commit = () => gate.promise; await view.flush(); await view.click('Save document'); view.doc().onReady(null);
  gate.resolve(native.handle.save()); await view.flush();
  assert.equal(api.calls.filter(c => c.path.endsWith('/save')).length, 0); assert.match(view.text(), /editor changed while finishing/);
  assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.body.dataStream, 'Human draft\r\n'); view.unmount();
});

test('large draft Save dispatches despite the reproduced localStorage quota', async () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      const size = [...values].reduce((sum, [k, v]) => sum + (k === key ? 0 : k.length + v.length), key.length + value.length);
      if (size > 5_000_000) throw new DOMException('localStorage quota exceeded', 'QuotaExceededError');
      values.set(key, value);
    },
    removeItem: key => values.delete(key),
  };
  storage.setItem('existing-origin-data', 'x'.repeat(12_000));
  const gate = deferred(), api = server(() => gate.promise), view = mount(storage, api.fetch);
  await view.flush(); await view.open('old'); attach(view).edit('x'.repeat(2_681_000)); await view.flush(); await view.save();
  assert.equal(api.calls.filter(c => c.path.endsWith('/save')).length, 1, view.text());
  gate.reject(new Error('lost ACK')); await view.flush(); view.unmount();
});

for (const kind of ['sheet', 'document']) test(`async fixture: ${kind} Save waits for durable pending completion; double Save/Send and new edits keep one exact attempt`, async () => {
  const storage = disk(), tx = artifactFixture(storage), storageGate = deferred(), ack = deferred(); let blocked = false;
  const api = server((path, input, works) => {
    assert.ok(tx.rows.get('save:old')?.value, 'pending payload committed before HTTP');
    works.old = { ...works.old, ...(kind === 'document' ? { document: input.document } : { book: input.book }), contentRevision: 2, eventSequence: 2 };
    return ack.promise;
  });
  if (kind === 'document') api.works.old = docWork('old');
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = kind === 'document' ? attachDoc(view) : attach(view); native.edit('captured'); await view.flush();
  tx.complete = async (key, slot) => { if (key === 'save:old' && slot.value && !blocked) { blocked = true; await storageGate.promise; } };
  await view.click(kind === 'document' ? 'Save document' : 'Save sheet'); await view.click(kind === 'document' ? 'Save document' : 'Save sheet');
  await view.message('Continue'); await view.send(); await view.send();
  assert.equal(api.calls.filter(c => c.input).length, 0); assert.equal(tx.rows.get('save:old')?.value ?? null, null);
  native.edit('newer during storage'); await view.flush(); storageGate.resolve(); await view.flush();
  assert.equal(api.calls.filter(c => c.path.endsWith('/save')).length, 1);
  ack.resolve({ contentRevision: 2, permissionRevision: 1 }); await view.flush();
  assert.equal(api.calls.filter(c => c.path === '/api/work/commands').length, 0); assert.equal(view.messageValue(), 'Continue');
  const recovered = JSON.parse(await draftRaw(storage, 'old')); assert.equal(recovered.revision, 2);
  assert.equal(kind === 'document' ? recovered.book.body.dataStream : recovered.book.sheets.sheet1.cellData[0][0].v, kind === 'document' ? 'newer during storage\r\n' : 'newer during storage');
  assert.match(view.text(), /Unsaved changes/); view.unmount();
});

for (const failure of ['draft', 'save']) test(`async fixture: ${failure} transaction abort prevents dispatch and navigation; Download draft remains usable`, async () => {
  const storage = disk(), tx = artifactFixture(storage), api = server(() => assert.fail('no dispatch')), view = mount(storage, api.fetch);
  await view.flush(); await view.open('old'); const native = attach(view);
  tx.complete = async key => { if (key === `${failure}:old`) throw new DOMException('transaction aborted', 'AbortError'); };
  native.edit('recover this'); await view.flush(); await view.save();
  assert.equal(api.calls.filter(c => c.path.endsWith('/save')).length, 0); assert.match(view.text(), /Browser draft storage could not finish/); assert.match(view.text(), /Unsaved changes/);
  await view.click('Download draft'); const exported = JSON.parse(await view.downloads[0].text()); assert.equal(exported.sheets.sheet1.cellData[0][0].v, 'recover this');
  if (failure === 'draft') { await view.open('imported'); await view.open(''); assert.equal(view.native().book.id, 'old'); }
  tx.complete = async () => {}; await view.open('imported'); assert.equal(view.native().book.id, 'imported');
  assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.sheets.sheet1.cellData[0][0].v, 'recover this'); view.unmount();
});

test('async fixture: opening waits for draft writes and a later edit cancels stale navigation', async () => {
  const storage = disk(), tx = artifactFixture(storage), gate = deferred(), api = server(() => assert.fail('no dispatch')), view = mount(storage, api.fetch);
  await view.flush(); await view.open('old'); const native = attach(view);
  tx.complete = () => gate.promise;
  native.edit('first'); await view.open('imported'); assert.equal(view.native().book.id, 'old');
  native.edit('newest'); gate.resolve(); await view.flush(); assert.equal(view.native().book.id, 'old');
  assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.sheets.sheet1.cellData[0][0].v, 'newest'); view.unmount();
});
test('async fixture: late storage read cannot install a stale cross-work open', async () => {
  const storage = disk(), tx = artifactFixture(storage), gate = deferred(), api = server(() => assert.fail('no dispatch')), view = mount(storage, api.fetch);
  await view.flush(); await view.open('old'); attach(view);
  tx.complete = async key => { if (key === 'draft:imported') await gate.promise; };
  await view.open('imported'); await view.open('old'); gate.resolve(); await view.flush(); assert.equal(view.native().book.id, 'old'); view.unmount();
});

for (const mode of ['abort', 'edit', 'navigate', 'success']) test(`async fixture: Open saved version ${mode} archives durably before releasing the draft`, async () => {
  const storage = disk(), tx = artifactFixture(storage), gate = deferred(), api = server(() => { throw new Error('offline'); }), view = mount(storage, api.fetch);
  await view.flush(); await view.open('old'); const native = attach(view); native.edit('keep recovery'); await view.flush();
  await view.save(); // gives access to recovery controls, keeps exact pending Save
  const before = await draftRaw(storage, 'old');
  tx.complete = async key => { if (key.startsWith('recovery:')) await gate.promise; };
  await view.click('Open saved version'); assert.equal(tx.rows.get('draft:old').value.raw, before); assert.match(view.text(), /Unsaved changes/);
  if (mode === 'edit') native.edit('typed during archive');
  if (mode === 'navigate') await view.open('imported');
  if (mode === 'abort') gate.reject(new DOMException('full', 'QuotaExceededError')); else gate.resolve();
  await view.flush();
  if (mode === 'abort') {
    assert.equal(await draftRaw(storage, 'old'), before); assert.match(view.text(), /Browser draft storage could not finish/);
    await view.click('Download draft'); assert.equal(JSON.parse(await view.downloads[0].text()).sheets.sheet1.cellData[0][0].v, 'keep recovery');
  } else {
    const archived = [...tx.rows].filter(([key]) => key.startsWith('recovery:')); assert.equal(archived.length, 1); assert.equal(JSON.parse(archived[0][1].value.raw).book.sheets.sheet1.cellData[0][0].v, 'keep recovery');
    if (mode === 'edit') { assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.sheets.sheet1.cellData[0][0].v, 'typed during archive'); assert.match(view.text(), /Unsaved changes/); }
    else if (mode === 'navigate') { assert.equal(view.native().book.id, 'imported'); assert.ok(await draftRaw(storage, 'old')); }
    else { assert.equal(await draftRaw(storage, 'old'), null); assert.ok(await artifactStore(storage).readSave('old'), 'opening saved version does not discard unresolved request'); }
  }
  view.unmount();
});

test('async fixture: a new native edit during held draft cleanup stays dirty and durable at the accepted revision', async () => {
  const storage = disk(), tx = artifactFixture(storage), gate = deferred(), api = server(() => ({ contentRevision: 2, permissionRevision: 1 })), view = mount(storage, api.fetch);
  await view.flush(); await view.open('old'); const native = attach(view); native.edit('submitted'); await view.flush();
  tx.complete = async (key, slot) => { if (key === 'draft:old' && slot.value === null) await gate.promise; };
  await view.save(); native.edit('typed during cleanup'); await view.flush(); gate.resolve(); await view.flush();
  assert.match(view.text(), /Unsaved changes/); const draft = JSON.parse(await draftRaw(storage, 'old')); assert.equal(draft.book.sheets.sheet1.cellData[0][0].v, 'typed during cleanup'); assert.equal(draft.revision, 2); view.unmount();
});

test('legacy draft and unresolved document Save adopt through actual App; exact original body survives reload', async () => {
  const storage = disk(), api = server(() => { throw new Error('lost ACK'); }); api.works.old = docWork('old');
  const document = blankDocument('old', 'Legacy document', 'Legacy body'), legacy = new MaintenanceActions(storage, 'sheet-save:old').prepare('save', '/work/old/save', { document, contentRevision: 1, permissionRevision: 1 }, () => 'installed-command');
  const newer = blankDocument('old', 'Legacy document', 'Newer legacy draft');
  storage.setItem('workagent-draft:old', JSON.stringify({ book: newer, revision: 1, permission: 1 }));
  let view = mount(storage, api.fetch); await view.flush(); await view.open('old'); await view.until(() => view.doc()); attachDoc(view); await view.click('Save document'); view.unmount();
  view = mount(storage, api.fetch); await view.flush(); await view.open('old'); await view.until(() => view.doc()); attachDoc(view); await view.click('Save document');
  const calls = api.calls.filter(c => c.path.endsWith('/save')); assert.equal(calls.length, 2); assert.deepEqual(calls[0].input, legacy.input); assert.deepEqual(calls[1], calls[0]);
  assert.equal(storage.getItem('workagent-maintenance:sheet-save:old:pending'), null); assert.equal(storage.getItem('workagent-draft:old'), null);
  assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.body.dataStream, 'Newer legacy draft\r\n'); view.unmount();
});

test('installed-size legacy sheet draft opens and Saves without another localStorage payload', async () => {
  const storage = disk(), tx = artifactFixture(storage), api = server(() => ({ contentRevision: 2, permissionRevision: 1 }));
  const book = blankWorkbook('old', 'Operations Scale Check'); book.sheets.sheet1.cellData = { 0: { 0: { v: 'x'.repeat(2_681_000), t: 1 } } };
  const legacy = JSON.stringify({ book, revision: 1, permission: 1 }); storage.setItem('workagent-draft:old', legacy);
  const write = storage.setItem; storage.setItem = (key, value) => { assert.ok(value.length < 10_000, 'large payload must never go to localStorage'); write(key, value); };
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); await view.until(() => view.native()); attach(view);
  assert.equal(tx.rows.get('draft:old').value.raw, legacy); assert.equal(storage.getItem('workagent-draft:old'), null);
  await view.save(); assert.equal(api.calls.filter(c => c.path.endsWith('/save')).length, 1); assert.equal(await artifactStore(storage).readSave('old'), null); assert.equal(await artifactStore(storage).readDraft('old'), null); view.unmount();
});

test('Save from a stale tab cannot replace an independent newer recovery draft before dispatch', async () => {
  const storage = disk(), api = server(() => { throw new Error('lost ACK'); });
  const a = mount(storage, api.fetch); await a.flush(); await a.open('old'); attach(a).edit('A'); await a.flush(); await a.save();
  const b = mount(storage, api.fetch); await b.flush(); await b.open('old'); attach(b).edit('B newer'); await b.flush();
  const original = await artifactStore(storage).readSave('old'); await a.save();
  assert.equal(api.calls.filter(c => c.path.endsWith('/save')).length, 1); assert.match(a.text(), /Another tab has a newer recovery draft/);
  assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.sheets.sheet1.cellData[0][0].v, 'B newer'); assert.deepEqual(await artifactStore(storage).readSave('old'), original);
  await a.open('imported'); assert.equal(a.native().book.id, 'old');
  assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.sheets.sheet1.cellData[0][0].v, 'B newer');
  a.unmount(); b.unmount();
});

test('async fixture: abort while settling an ACK keeps exact pending identity for reload retry', async () => {
  const storage = disk(), tx = artifactFixture(storage), accepted = new Map(); let attempts = 0;
  const api = server((path, input, works) => {
    attempts++; accepted.set(input.commandId, input); works.old = { ...works.old, book: input.book, contentRevision: 2, eventSequence: 2 };
    return { contentRevision: 2, permissionRevision: 1 };
  });
  let view = mount(storage, api.fetch); await view.flush(); await view.open('old'); attach(view).edit('exact body'); await view.flush();
  tx.complete = async (key, slot) => { if (attempts && key === 'save:old' && slot.value === null) throw new DOMException('aborted', 'AbortError'); };
  await view.save(); assert.match(view.text(), /Browser draft storage could not finish/); assert.match(view.text(), /Unsaved changes/); view.unmount();
  tx.complete = async () => {};
  view = mount(storage, api.fetch); await view.flush(); await view.open('old'); attach(view); await view.save();
  const calls = api.calls.filter(c => c.path.endsWith('/save')); assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]); assert.equal(accepted.size, 1); assert.equal(await artifactStore(storage).readSave('old'), null); view.unmount();
});

test('async fixture: pending native input during Save storage awaits stays dirty after acknowledgement', async () => {
  const storage = disk(), tx = artifactFixture(storage), gate = deferred(), api = server(() => ({ contentRevision: 2, permissionRevision: 1 })), view = mount(storage, api.fetch);
  await view.flush(); await view.open('old'); const native = attach(view); native.edit('captured'); await view.flush();
  tx.complete = async (key, slot) => { if (key === 'save:old' && slot.value) await gate.promise; };
  await view.save(); native.handle.isEditing = () => true; gate.resolve(); await view.flush();
  assert.match(view.text(), /Unsaved changes/); assert.ok(await artifactStore(storage).readDraft('old'));
  assert.equal(api.calls.filter(c => c.path.endsWith('/save')).length, 1); view.unmount();
});

for (const target of ['imported', '']) test(`async navigation to ${target || 'new work'} keeps native input that begins during draft persistence`, async () => {
  const storage = disk(), tx = artifactFixture(storage), gate = deferred(), api = server(() => assert.fail('no dispatch')); api.works.old = docWork('old');
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attachDoc(view); native.edit('Before pending paste'); await view.flush();
  tx.complete = async key => { if (key === 'draft:old') await gate.promise; };
  await view.open(target); native.handle.isEditing = () => true; gate.resolve(); await view.flush();
  assert.equal(view.doc()?.document.id, 'old', 'pending native input must retain its editor');
  assert.match(view.text(), /finishing/); assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.body.dataStream, 'Before pending paste\r\n'); view.unmount();
});

for (const kind of ['sheet', 'document']) for (const interruption of ['abort', 'crash']) test(`review regression: ${kind} ACK ${interruption} before durable rebase retains original retry and newer human draft`, async () => {
  const storage = disk(), tx = artifactFixture(storage), ack = deferred(), boundary = deferred(), release = deferred(), accepted = new Map();
  const api = server((path, input, works) => {
    if (!accepted.has(input.commandId)) {
      assert.equal(input.contentRevision, works.old.contentRevision, 'new commands must use the current server revision');
      const revision = works.old.contentRevision + 1;
      accepted.set(input.commandId, { contentRevision: revision, permissionRevision: 1 });
      works.old = { ...works.old, ...(kind === 'sheet' ? { book: input.book } : { document: input.document }), contentRevision: revision, eventSequence: revision };
    }
    return accepted.size === 1 && api.calls.filter(c => c.path.endsWith('/save')).length === 1 ? ack.promise : accepted.get(input.commandId);
  });
  if (kind === 'document') api.works.old = docWork('old');
  const edit = view => kind === 'sheet' ? attach(view) : attachDoc(view);
  const save = view => kind === 'sheet' ? view.save() : view.click('Save document');
  const value = draft => kind === 'sheet' ? draft.book.sheets.sheet1.cellData[0][0].v : draft.book.body.dataStream;
  let view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = edit(view);
  native.edit('submitted A'); await view.flush(); await save(view); const original = await artifactStore(storage).readSave('old');
  native.edit('newer B'); await view.flush();
  tx.complete = async (key, slot) => {
    if (key === 'draft:old' && slot.value && JSON.parse(slot.value.raw).revision === 2) {
      boundary.resolve();
      if (interruption === 'crash') await release.promise;
      throw new DOMException('rebase transaction interrupted', 'AbortError');
    }
  };
  ack.resolve({ contentRevision: 2, permissionRevision: 1 }); await view.flush();
  await Promise.race([boundary.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('rebase boundary not reached')), 1000))]);
  let reopened = storage;
  if (interruption === 'crash') {
    // A fresh process sees committed rows only, not the suspended transaction or
    // the old App refs/queue. Abort the abandoned connection after taking its disk image.
    reopened = disk(); artifactFixture(reopened).rows = structuredClone(tx.rows);
    view.unmount(); release.resolve(); await view.flush();
  } else { assert.match(view.text(), /Browser draft storage could not finish/); view.unmount(); }
  tx.complete = async () => {};
  assert.deepEqual(await artifactStore(reopened).readSave('old'), original, 'ACK must not retire retry before draft durability');
  assert.equal(value(JSON.parse(await draftRaw(reopened, 'old'))), kind === 'sheet' ? 'newer B' : 'newer B\r\n');
  view = mount(reopened, api.fetch); await view.flush(); await view.open('old'); edit(view); await save(view);
  const posts = api.calls.filter(c => c.path.endsWith('/save'));
  assert.equal(posts.length, 2); assert.deepEqual(posts[1], posts[0]); assert.equal(accepted.size, 1, 'retry has no duplicate server effect');
  const rebased = JSON.parse(await draftRaw(reopened, 'old')); assert.equal(rebased.revision, 2); assert.equal(value(rebased), kind === 'sheet' ? 'newer B' : 'newer B\r\n');
  assert.equal(await artifactStore(reopened).readSave('old'), null);
  await save(view); assert.equal(accepted.size, 2); assert.equal(api.calls.filter(c => c.path.endsWith('/save')).at(-1).input.contentRevision, 2);
  assert.equal(await draftRaw(reopened, 'old'), null); view.unmount();
});

for (const injection of ['pending-settlement', 'before-ACK']) test(`review regression: C queued behind held B at ${injection} survives at acknowledged revision`, async () => {
  const storage = disk(), tx = artifactFixture(storage), ack = deferred(), draftGate = deferred(); let injected = false, heldB = false;
  const api = server((path, input, works) => {
    assert.equal(input.contentRevision, works.old.contentRevision);
    const revision = works.old.contentRevision + 1;
    works.old = { ...works.old, book: input.book, contentRevision: revision, eventSequence: revision };
    return revision === 2 ? ack.promise : { contentRevision: revision, permissionRevision: 1 };
  });
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view);
  native.edit('submitted A'); await view.flush(); await view.save();
  tx.complete = async (key, slot) => {
    if (injection === 'pending-settlement' && key === 'save:old' && !slot.value && !injected) { injected = true; native.edit('B during settlement'); }
    if (key === 'draft:old' && slot.value && JSON.parse(slot.value.raw).book.sheets.sheet1.cellData[0][0].v === 'B during settlement') { heldB = true; await draftGate.promise; }
  };
  if (injection === 'before-ACK') { injected = true; native.edit('B during settlement'); await view.flush(); }
  ack.resolve({ contentRevision: 2, permissionRevision: 1 }); await view.flush();
  assert.equal(injected, true, 'injection seam must execute'); assert.equal(heldB, true, 'B must actually be held');
  native.edit('C behind B'); await view.flush(); draftGate.resolve(); await view.flush();
  const recovered = JSON.parse(await draftRaw(storage, 'old'));
  assert.equal(recovered.book.sheets.sheet1.cellData[0][0].v, 'C behind B'); assert.equal(recovered.revision, 2);
  assert.equal(await artifactStore(storage).readSave('old'), null); assert.match(view.text(), /Unsaved changes/); view.unmount();
  const reload = mount(storage, api.fetch); await reload.flush(); await reload.open('old'); assert.doesNotMatch(reload.text(), /saved work changed/);
  attach(reload); await reload.save(); assert.equal(api.calls.filter(c => c.path.endsWith('/save')).at(-1).input.contentRevision, 2);
  assert.equal(await draftRaw(storage, 'old'), null); reload.unmount();
});

test('review regression: native input starting during atomic ACK commit keeps the editor dirty', async () => {
  const storage = disk(), tx = artifactFixture(storage), gate = deferred(); let entered = false;
  const api = server((path, input, works) => {
    assert.equal(input.contentRevision, works.old.contentRevision);
    const revision = works.old.contentRevision + 1;
    works.old = { ...works.old, book: input.book, contentRevision: revision, eventSequence: revision };
    return { contentRevision: revision, permissionRevision: 1 };
  });
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view);
  native.edit('A'); await view.flush();
  tx.complete = async (key, slot) => { if (key === 'save:old' && !slot.value) { entered = true; await gate.promise; } };
  await view.save(); assert.equal(entered, true); native.handle.isEditing = () => true;
  gate.resolve(); await view.flush(); assert.match(view.text(), /Unsaved changes/);
  native.handle.isEditing = () => false; native.edit('B after pending input'); await view.flush();
  assert.equal(JSON.parse(await draftRaw(storage, 'old')).revision, 2);
  await view.save(); assert.equal(api.calls.filter(c => c.path.endsWith('/save')).at(-1).input.contentRevision, 2); view.unmount();
});

test('review regression: foreign draft at ACK keeps exact retry until its owning reload can settle', async () => {
  const storage = disk(), ack = deferred(), receipts = new Map();
  const api = server((path, input, works) => {
    if (!receipts.has(input.commandId)) {
      assert.equal(input.contentRevision, works.old.contentRevision);
      const revision = works.old.contentRevision + 1; receipts.set(input.commandId, { contentRevision: revision, permissionRevision: 1 });
      works.old = { ...works.old, book: input.book, contentRevision: revision, eventSequence: revision };
    }
    return api.calls.filter(c => c.path.endsWith('/save')).length === 1 ? ack.promise : receipts.get(input.commandId);
  });
  const a = mount(storage, api.fetch); await a.flush(); await a.open('old'); attach(a).edit('A'); await a.flush(); await a.save();
  const b = mount(storage, api.fetch); await b.flush(); await b.open('old'); attach(b).edit('foreign B'); await b.flush();
  const pending = await artifactStore(storage).readSave('old'), foreign = await artifactStore(storage).readDraft('old');
  ack.resolve({ contentRevision: 2, permissionRevision: 1 }); await a.flush();
  assert.deepEqual(await artifactStore(storage).readSave('old'), pending); assert.deepEqual(await artifactStore(storage).readDraft('old'), foreign);
  assert.match(a.text(), /Another tab has a newer recovery draft/); a.unmount(); b.unmount();
  const reload = mount(storage, api.fetch); await reload.flush(); await reload.open('old'); attach(reload); await reload.save();
  assert.deepEqual(api.calls.filter(c => c.path.endsWith('/save'))[1].input, pending.request.input); assert.equal(receipts.size, 1);
  const recovered = JSON.parse(await draftRaw(storage, 'old')); assert.equal(recovered.revision, 2); assert.equal(recovered.book.sheets.sheet1.cellData[0][0].v, 'foreign B');
  await reload.save(); assert.equal(receipts.size, 2); assert.equal(await draftRaw(storage, 'old'), null); reload.unmount();
});

// Keep tests below the prefix consumed by native-document App fixtures.
for (const [errorCode, status, message] of [
  ['request_too_large', 'blocked', 'This request reached a technical size limit before the next model call was sent. Your saved work is safe. Send a narrower request to continue.'],
  ['execution_interrupted_check_receipt', 'interrupted', 'Work was interrupted. Your saved sheet is safe. The operator must check any uncertain model request before retrying.'],
]) test(`App displays ${errorCode} accurately without replaying the command`, async () => {
  const api = server(() => assert.fail('rendering an error must not submit a command'));
  Object.assign(api.works.old, { status, errorCode });
  const view = mount(disk(), api.fetch);
  try {
    await view.flush(); await view.open('old');
    assert.ok(view.text().includes(message));
    assert.equal(view.text().includes(errorCode === 'request_too_large' ? 'uncertain model request' : 'technical size limit'), false);
    assert.equal(api.calls.some(call => call.input), false);
  } finally { view.unmount(); }
});

for (const abort of [false, true]) test(`format provenance survives lost ACK, reload, newer format and atomic settlement abort=${abort}`, async () => {
  const storage = disk(); let saves = 0;
  const api = server((path, input, works) => {
    saves++;
    if (saves === 1) {
      works.old = { ...works.old, book: input.book, contentRevision: 2, eventSequence: 2, expected: { ...works.old.expected, contentRevision: 2 } };
      throw new Error('lost acknowledgement');
    }
    return { contentRevision: saves < (abort ? 4 : 3) ? 2 : 3, permissionRevision: 1 };
  });
  const attachFormatting = view => {
    const props = view.native(), book = structuredClone(props.book), formats = structuredClone(props.formatEdits ?? {});
    props.onReady({ save: () => structuredClone(book), commit: async () => structuredClone(book), isEditing: () => false, formatEdits: () => structuredClone(formats) });
    return column => {
      book.sheets.sheet1.cellData[0] ??= {}; book.sheets.sheet1.cellData[0][column] = { f: '=1+1', s: { n: { pattern: '0.00%' } } };
      formats.sheet1 = [...new Set([...(formats.sheet1 ?? []), column])].sort((a, b) => a - b);
      props.onEdit(structuredClone(book));
    };
  };
  let view = mount(storage, api.fetch); await view.flush(); await view.open('old');
  const format = attachFormatting(view); format(0); await view.flush(); await view.save();
  const original = await saveActions(storage, 'old').read(); assert.deepEqual(original.input.formatEdits, { sheet1: [0] });
  format(1); await view.flush(); view.unmount();
  view = mount(storage, api.fetch); await view.flush(); await view.open('old'); attachFormatting(view);
  assert.deepEqual(view.native().formatEdits, { sheet1: [0, 1] });
  if (abort) artifactFixture(storage).complete = async (key, slot) => { if (key === 'save:old' && slot.value === null) throw new Error('abort settlement'); };
  await view.save();
  if (abort) {
    assert.deepEqual(await saveActions(storage, 'old').read(), original);
    assert.deepEqual(JSON.parse(await draftRaw(storage, 'old')).formatEdits, { sheet1: [0, 1] });
    artifactFixture(storage).complete = async () => {};
    await view.save();
  }
  const posted = api.calls.filter(c => c.path.endsWith('/save'));
  for (const call of posted) assert.deepEqual(call.input, original.input, 'exact original body including provenance');
  assert.equal(await saveActions(storage, 'old').read(), null);
  const draft = JSON.parse(await draftRaw(storage, 'old'));
  assert.equal(draft.revision, 2); assert.deepEqual(draft.formatEdits, { sheet1: [0, 1] });
  await view.save();
  const last = api.calls.filter(c => c.path.endsWith('/save')).at(-1).input;
  assert.notEqual(last.commandId, original.input.commandId); assert.equal(last.contentRevision, 2); assert.deepEqual(last.formatEdits, { sheet1: [0, 1] });
  assert.equal(await draftRaw(storage, 'old'), null); view.unmount();
});

test('Open saved version archives live formatting provenance with the complete native draft', async () => {
  const storage = disk(), api = server(() => assert.fail('no Save')), view = mount(storage, api.fetch);
  await view.flush(); await view.open('old');
  const props = view.native(), book = structuredClone(props.book);
  book.sheets.sheet1.cellData = { 0: { 0: { v: 3, s: { bl: 1 } } } };
  props.onReady({ save: () => structuredClone(book), commit: async () => structuredClone(book), isEditing: () => false, formatEdits: () => ({ sheet1: [0] }) });
  props.onEdit(book); await view.flush();
  // Trigger the existing recovery controls without dispatching a Save.
  await view.open('imported'); await view.open('old');
  const current = view.native(); current.onReady({ save: () => structuredClone(book), commit: async () => structuredClone(book), isEditing: () => false, formatEdits: () => ({ sheet1: [0] }) });
  // A saved revision conflict exposes Open saved version.
  api.works.old.contentRevision = 2;
  await view.open('imported'); await view.open('old');
  view.native().onReady({ save: () => structuredClone(book), commit: async () => structuredClone(book), isEditing: () => false, formatEdits: () => ({ sheet1: [0] }) });
  await view.click('Open saved version');
  const entries = [...artifactFixture(storage).rows].filter(([key]) => key.startsWith('recovery:old:'));
  assert.equal(entries.length, 1);
  const archived = JSON.parse(entries[0][1].value.raw);
  assert.deepEqual(archived.formatEdits, { sheet1: [0] }); assert.deepEqual(archived.book, book);
  view.unmount();
});


// Navigation regressions stay below the prefix evaluated by document fixtures.
const composerNodes = view => {
  const all = view.elements(), named = label => all.find(n => n.props['aria-label'] === label)?.props;
  const button = label => all.find(n => n.type === 'button' && n.props.children === label)?.props;
  return {
    prompt: all.find(n => n.props.id === 'prompt').props,
    sourceName: named('Source name'), sourceText: named('Source text'),
    file: all.find(n => n.type === 'input' && n.props.type === 'file').props,
    form: all.find(n => n.props.className === 'composer').props,
    navigation: named('Saved work'), send: button('Send'),
    attach: button('Attach selected cells'), remove: button('Remove selection'), restore: button('Restore unresolved send'),
  };
};
const messageDraft = prompt => ({ prompt, sourceName: `${prompt} source`, sourceText: `${prompt} data` });
for (const phase of ['preservation', 'GET', 'draft read', 'save read']) test(`composer navigation blocks editing and stale actions through ${phase}, retaining separate drafts`, async () => {
  const storage = disk(), drafts = new resume.ComposerDrafts(storage), gate = deferred();
  const selection = { workId: 'old', sheetId: 'sheet1', sheetName: 'Sheet 1', rangeLabel: 'A1:B2', range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }, contentRevision: 1 };
  const source = { ...messageDraft('Source message'), selection }, destination = messageDraft('Destination message');
  drafts.write('old', source); drafts.write('imported', destination);
  const pending = drafts.submission('old', source, 0, randomUUID, selection);
  const api = server(() => assert.fail('navigation must not POST')); let hold = false, reached = false;
  const view = mount(storage, async (path, options) => {
    if (hold && phase === 'GET' && path === '/api/work/imported') { reached = true; await gate.promise; }
    return api.fetch(path, options);
  });
  await view.flush(); await view.open('old'); const previous = view.native(), native = attach(view);
  native.edit('retained native draft'); await view.flush();
  artifactFixture(storage).complete = async key => {
    if (hold && key === ({ preservation: 'draft:old', 'draft read': 'draft:imported', 'save read': 'save:imported' })[phase]) { reached = true; await gate.promise; }
  };
  const stale = composerNodes(view); hold = true;
  // Start navigation and call still-rendered handlers before the next render.
  stale.navigation.onChange({ target: { value: 'imported' } });
  stale.prompt.onChange({ target: { value: 'wrong immediate edit' } });
  await stale.form.onSubmit({ preventDefault() {} });
  stale.attach.onClick(); stale.remove.onClick(); stale.restore.onClick();
  await view.flush(); assert.equal(reached, true);
  const blocked = composerNodes(view);
  assert.equal(blocked.form['aria-busy'], true); assert.match(view.text(), /Loading work/);
  for (const key of ['prompt', 'sourceName', 'sourceText', 'file', 'send', 'attach', 'remove', 'restore']) assert.equal(blocked[key].disabled, true, key);
  for (const key of ['prompt', 'sourceName', 'sourceText']) blocked[key].onChange({ target: { value: 'wrong delayed edit' } });
  await blocked.file.onChange({ target: { files: [{ size: 1, name: 'wrong', text: () => assert.fail('disabled file handler read') }] } });
  await blocked.form.onSubmit({ preventDefault() {} }); blocked.attach.onClick();
  await view.flush(); assert.equal(view.messageValue(), source.prompt);
  assert.deepEqual(drafts.read('old'), source); assert.deepEqual(drafts.read('imported'), destination);
  assert.deepEqual(drafts.pending('old'), pending); assert.equal(api.calls.filter(c => c.input).length, 0);
  gate.resolve(); await view.flush();
  assert.equal(view.native().book.id, 'imported'); assert.equal(view.messageValue(), destination.prompt);
  assert.equal(composerNodes(view).prompt.disabled, false); assert.equal(composerNodes(view).form['aria-busy'], false);
  // Settled composer stays usable through native disposal/readiness callbacks.
  previous.onReady(null); await view.message('destination typing before mount'); attach(view);
  await view.message('destination typing after mount');
  assert.deepEqual(drafts.read('old'), source); assert.deepEqual(drafts.read('imported'), { ...destination, prompt: 'destination typing after mount' });
  assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.sheets.sheet1.cellData[0][0].v, 'retained native draft');
  await view.open('old'); assert.equal(view.messageValue(), source.prompt); assert.deepEqual(drafts.read('old'), source); view.unmount();
});

for (const failure of ['GET', 'draft read', 'preservation', 'snapshot']) test(`failed ${failure} navigation unblocks the unchanged source composer and native work`, async () => {
  const storage = disk(), drafts = new resume.ComposerDrafts(storage), gate = deferred();
  const source = { prompt: 'Keep source', sourceName: 'Pasted data', sourceText: '' };
  drafts.write('old', source); drafts.write('imported', messageDraft('Keep destination'));
  const api = server((path, input) => { assert.equal(path, '/api/work/commands'); return { workId: input.workId }; }); let fail = false;
  const view = mount(storage, async (path, options) => {
    if (fail && failure === 'GET' && path === '/api/work/imported') await gate.promise;
    return api.fetch(path, options);
  });
  await view.flush(); await view.open('old'); const native = attach(view);
  if (failure === 'preservation' || failure === 'snapshot') { native.edit('keep native'); await view.flush(); }
  const save = native.handle.save;
  if (failure === 'snapshot') native.handle.save = () => { throw new Error('snapshot refused'); };
  artifactFixture(storage).complete = async key => {
    if (fail && key === (failure === 'preservation' ? 'draft:old' : failure === 'draft read' ? 'draft:imported' : 'never')) await gate.promise;
  };
  fail = true; await view.open('imported');
  if (failure !== 'snapshot') { assert.equal(composerNodes(view).prompt.disabled, true); gate.reject(new Error('navigation failed')); await view.flush(); }
  assert.equal(view.native().book.id, 'old'); assert.equal(composerNodes(view).prompt.disabled, false);
  assert.equal(view.messageValue(), source.prompt); assert.match(view.text(), /navigation failed|Browser draft storage could not finish|snapshot refused/);
  fail = false; native.handle.save = save;
  await view.message('source can continue'); assert.equal(drafts.read('old').prompt, 'source can continue');
  assert.deepEqual(drafts.read('imported'), messageDraft('Keep destination'));
  if (failure === 'GET' || failure === 'draft read') { await view.click('Attach selected cells'); await view.send(); assert.equal(api.calls.filter(c => c.path === '/api/work/commands').length, 1); }
  else { native.edit('native can continue'); await view.flush(); assert.equal(JSON.parse(await draftRaw(storage, 'old')).book.sheets.sheet1.cellData[0][0].v, 'native can continue'); }
  view.unmount();
});

for (const order of ['stale-first', 'latest-first']) for (const staleFailure of [false, true]) test(`latest navigation owns composer unlock: ${order}, stale failure ${staleFailure}`, async () => {
  const storage = disk(), drafts = new resume.ComposerDrafts(storage), oldGate = deferred(), latestGate = deferred();
  drafts.write(null, messageDraft('New work draft')); drafts.write('old', messageDraft('Old draft')); drafts.write('imported', messageDraft('Latest draft'));
  const api = server(() => assert.fail('no POST')); let hold = true;
  const view = mount(storage, async (path, options) => {
    if (hold && path === '/api/work/old') await oldGate.promise;
    if (hold && path === '/api/work/imported') await latestGate.promise;
    return api.fetch(path, options);
  });
  await view.flush(); await view.open('old'); await view.open('imported');
  const staleDone = () => staleFailure ? oldGate.reject(new Error('obsolete navigation error')) : oldGate.resolve();
  if (order === 'stale-first') {
    staleDone(); await view.flush(); assert.equal(composerNodes(view).prompt.disabled, true);
    assert.equal(view.messageValue(), 'New work draft'); latestGate.resolve(); await view.flush();
  } else {
    latestGate.resolve(); await view.flush(); assert.equal(composerNodes(view).prompt.disabled, false);
    await view.message('latest typing'); staleDone(); await view.flush();
  }
  assert.equal(view.native().book.id, 'imported'); assert.equal(composerNodes(view).prompt.disabled, false);
  assert.doesNotMatch(view.text(), /obsolete navigation error|Loading work/);
  assert.deepEqual(drafts.read(null), messageDraft('New work draft')); assert.deepEqual(drafts.read('old'), messageDraft('Old draft'));
  hold = false; await view.open(''); assert.equal(view.native(), undefined); assert.equal(view.messageValue(), 'New work draft'); view.unmount();
});

test('New work supersedes a pending open and stays editable after its stale response', async () => {
  const storage = disk(), drafts = new resume.ComposerDrafts(storage), gate = deferred(), api = server(() => assert.fail('no POST'));
  drafts.write(null, messageDraft('Unsent new note')); drafts.write('old', messageDraft('Source'));
  const view = mount(storage, async (path, options) => { if (path === '/api/work/imported') await gate.promise; return api.fetch(path, options); });
  await view.flush(); await view.open('old'); attach(view); await view.open('imported'); await view.open('');
  assert.equal(view.native(), undefined); assert.equal(composerNodes(view).prompt.disabled, false); assert.equal(view.messageValue(), 'Unsent new note');
  await view.message('new typing'); gate.resolve(); await view.flush(); assert.equal(view.native(), undefined); assert.equal(view.messageValue(), 'new typing');
  assert.equal(drafts.read('old').prompt, 'Source'); view.unmount();
});

for (const outcome of ['success', 'abort', 'native edit']) test(`New work composer lock spans old draft preservation: ${outcome}`, async () => {
  const storage = disk(), drafts = new resume.ComposerDrafts(storage), gate = deferred(), api = server(() => assert.fail('no POST'));
  drafts.write(null, messageDraft('New note')); drafts.write('old', messageDraft('Old note'));
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view); native.edit('old native'); await view.flush();
  artifactFixture(storage).complete = async key => { if (key === 'draft:old') await gate.promise; };
  await view.open(''); assert.equal(composerNodes(view).prompt.disabled, true); await view.message('blocked');
  if (outcome === 'native edit') native.edit('newer native');
  if (outcome === 'abort') gate.reject(new Error('abort')); else gate.resolve();
  await view.flush(); assert.equal(composerNodes(view).prompt.disabled, false);
  assert.equal(view.messageValue(), outcome === 'success' ? 'New note' : 'Old note');
  assert.deepEqual(drafts.read(null), messageDraft('New note')); assert.deepEqual(drafts.read('old'), messageDraft('Old note'));
  await view.message('resumed typing'); assert.equal(drafts.read(outcome === 'success' ? null : 'old').prompt, 'resumed typing'); view.unmount();
});

test('source file read begun before navigation cannot attach after switching or cancellation', async () => {
  const storage = disk(), drafts = new resume.ComposerDrafts(storage), fileGate = deferred(), navigationGate = deferred(), api = server(() => assert.fail('no POST'));
  drafts.write(null, messageDraft('New note'));
  const view = mount(storage, async (path, options) => { if (path === '/api/work/imported') await navigationGate.promise; return api.fetch(path, options); });
  await view.flush();
  const reading = composerNodes(view).file.onChange({ target: { files: [{ size: 10, name: 'stale source', text: () => fileGate.promise }] } });
  await view.open('imported'); await view.open(''); fileGate.resolve('stale file'); await reading; navigationGate.resolve(); await view.flush();
  assert.deepEqual(drafts.read(null), messageDraft('New note')); assert.equal(view.messageValue(), 'New note'); view.unmount();
});
