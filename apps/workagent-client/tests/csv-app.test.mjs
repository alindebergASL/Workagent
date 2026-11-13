import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
// Exercise the actual App's import navigation and durable save consumer. Hook/native
// handles are fixtures; persistence and callbacks below are real client code.
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
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const disk = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const work = id => ({ id, book: blankWorkbook(id, id), expected: { contentRevision: 1, permissionRevision: 1, intentRevision: 0, cancellationEpoch: 0 }, contentRevision: 1, intentRevision: 0, eventSequence: 1, status: 'ready', messages: [], proposals: [] });
function mount(storage, fetcher) {
  let root, index = 0, effects = [], tree, dirty = true, mounted = true; const hooks = [];
  const PdfExport = () => null, DocxExchange = () => null, DocumentEditor = () => null, DocumentExchange = () => null, NativeEditor = () => null, CsvExchange = () => null, XlsxExchange = () => null;
  const react = {
    useState(initial) { const i = index++; hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { if (mounted) { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; dirty = true; } }]; },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useCallback(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v, j) => v !== hooks[i].deps[j])) hooks[i] = { deps, fn }; return hooks[i].fn; },
    useEffect(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v, j) => v !== hooks[i].deps[j])) { hooks[i] = { deps, cleanup: hooks[i]?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'localStorage', 'document', 'window', 'fetch', 'crypto', 'setTimeout', 'clearTimeout', code)(name => {
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
    if (name === './maintenance-actions') return { MaintenanceActions };
    if (name.endsWith('.css')) return {};
    return require(name);
  }, module, module.exports, storage, { getElementById: () => ({}) }, { addEventListener() {}, removeEventListener() {} }, fetcher, { randomUUID }, () => 1, () => {});
  const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
  const text = n => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : String(n ?? '');
  function render() { index = 0; dirty = false; tree = root(); const pending = effects; effects = []; pending.forEach(f => f()); }
  const flush = async () => { for (let i = 0; i < 10; i++) { if (dirty && mounted) render(); await new Promise(setImmediate); } };
  render();
  return { docx: () => nodes(tree).find(n => n.type === DocxExchange).props, doc: () => nodes(tree).find(n => n.type === DocumentEditor)?.props, documents: () => nodes(tree).find(n => n.type === DocumentExchange).props, flushSync: render, flush, text: () => text(tree), exchange: () => nodes(tree).find(n => n.type === CsvExchange).props, xlsx: () => nodes(tree).find(n => n.type === XlsxExchange).props,
    async click(label) { const button = nodes(tree).find(n => n.type === 'button' && text(n.props.children) === label); assert.ok(button, label); assert.ok(!button.props.disabled); button.props.onClick(); await flush(); },
    titleValue: () => nodes(tree).find(n => n.props['aria-label'] === 'New work name').props.value,
    async title(value) { nodes(tree).find(n => n.props['aria-label'] === 'New work name').props.onChange({ target: { value } }); await flush(); },
    async open(id) { nodes(tree).find(n => n.type === 'select' && n.props['aria-label'] === 'Saved work').props.onChange({ target: { value: id } }); await flush(); },
    native: () => nodes(tree).find(n => n.type === NativeEditor).props,
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
  assert.equal(JSON.parse(storage.getItem('workagent-draft:old')).book.sheets.sheet1.cellData[0][0].v, 'unsaved human');
  await view.open('old'); assert.equal(view.native().book.sheets.sheet1.cellData[0][0].v, 'unsaved human'); attach(view); assert.equal(view.messageValue(), 'unsent human message');
  await view.save(); await view[format]().onOpen('imported'); await view.flush(); assert.equal(view.native().book.id, 'old'); assert.match(view.text(), /Wait for the current save/);
  pending.resolve({ contentRevision: 2, permissionRevision: 1 }); await view.flush(); view.unmount();
});
test('actual App lost save acknowledgement survives reload and rebases newer edits after exact retry', async () => {
  const storage = disk(); let saves = 0;
  const api = server((path, input, works) => { saves++; if (saves === 1) { works.old = { ...works.old, book: input.book, contentRevision: 2, eventSequence: 2, expected: { ...works.old.expected, contentRevision: 2 } }; throw new Error('lost acknowledgement'); } return { contentRevision: 2, permissionRevision: 1 }; });
  let view = mount(storage, api.fetch); await view.flush(); await view.open('old'); const native = attach(view); native.edit('first saved edit'); await view.flush(); await view.save();
  const first = new MaintenanceActions(storage, 'sheet-save:old').read(); assert.ok(first); native.edit('newer unsaved edit'); await view.flush(); view.unmount();
  view = mount(storage, api.fetch); await view.flush(); await view.open('old'); attach(view); await view.save();
  const posted = api.calls.filter(c => c.path.endsWith('/save')); assert.equal(posted.length, 2); assert.deepEqual(posted[1], posted[0]);
  assert.equal(new MaintenanceActions(storage, 'sheet-save:old').read(), null);
  const draft = JSON.parse(storage.getItem('workagent-draft:old')); assert.equal(draft.revision, 2); assert.equal(draft.book.sheets.sheet1.cellData[0][0].v, 'newer unsaved edit'); view.unmount();
});
test('actual App late acknowledgement cannot remove a newer save identity or recovery draft after reload', async () => {
  const storage = disk(), late = deferred(), next = deferred(); let count = 0;
  const api = server(() => { count++; return count === 1 ? late.promise : count === 2 ? { contentRevision: 2, permissionRevision: 1 } : next.promise; });
  const old = mount(storage, api.fetch); await old.flush(); await old.open('old'); attach(old).edit('A'); await old.flush(); await old.save(); old.unmount();
  const view = mount(storage, api.fetch); await view.flush(); await view.open('old'); let native = attach(view); await view.save();
  native.edit('B'); await view.flush(); await view.save(); const actions = new MaintenanceActions(storage, 'sheet-save:old'), pending = actions.read(), recovery = storage.getItem('workagent-draft:old');
  assert.ok(pending); late.resolve({ contentRevision: 2, permissionRevision: 1 }); await view.flush(); assert.deepEqual(actions.read(), pending); assert.equal(storage.getItem('workagent-draft:old'), recovery);
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
  assert.equal(JSON.parse(storage.getItem('workagent-draft:old')).book.sheets.sheet1.cellData[0][0].v, 'B');
  // Further typing while the other consumer's response is still held.
  native.edit('B newer'); await b.flush();
  if (order === 'A-first') { second.resolve(ack); await b.flush(); } else { first.resolve(ack); await a.flush(); }
  const recovery = JSON.parse(storage.getItem('workagent-draft:old'));
  assert.equal(recovery.book.sheets.sheet1.cellData[0][0].v, 'B newer'); assert.equal(recovery.revision, 2); assert.equal(recovery.permission, 2);
  assert.match(b.text(), /Unsaved changes/); a.unmount(); b.unmount();
  const reload = mount(storage, api.fetch); await reload.flush(); await reload.open('old'); attach(reload);
  assert.equal(reload.native().book.sheets.sheet1.cellData[0][0].v, 'B newer'); await reload.save();
  const last = api.calls.filter(c => c.path.endsWith('/save')).at(-1).input;
  assert.equal(last.contentRevision, 2); assert.equal(last.permissionRevision, 2); assert.notEqual(last.commandId, posted[0].input.commandId);
  assert.equal(storage.getItem('workagent-draft:old'), null); reload.unmount();
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
  assert.equal(storage.getItem('workagent-draft:old'), null);
  late.resolve({ contentRevision: 2, permissionRevision: 2 }); await a.flush();
  assert.equal(storage.getItem('workagent-draft:old'), null);
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
    assert.doesNotMatch(view.text(), /Unsaved changes/); assert.equal(storage.getItem('workagent-draft:old'), null);
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
  assert.match(view.text(), /Unsaved changes/); assert.deepEqual(JSON.parse(storage.getItem('workagent-draft:old')).book, book); view.unmount();
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
  assert.equal(view.native().book.id, 'old'); assert.equal(JSON.parse(storage.getItem('workagent-draft:old')).book.sheets.sheet1.cellData[0][0].v, 'newer edit');
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
  const recovery = JSON.parse(storage.getItem('workagent-draft:old')); assert.equal(recovery.book.body.dataStream, 'B newer\r\n'); assert.equal(recovery.revision, 2);
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
  assert.equal(JSON.parse(storage.getItem('workagent-draft:old')).book.body.dataStream, 'Human draft\r\n'); view.unmount();
});
