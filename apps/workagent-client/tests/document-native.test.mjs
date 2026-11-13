import * as documentContract from '../../../packages/workagent-contract/document.mjs';
// Installed SDK native commands + file-fixture authority; no browser, PG or inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
import { validateDocument, documentText } from '../../../packages/workagent-contract/document.mjs';
const require = createRequire(import.meta.resolve('@univerjs/preset-docs-core'));
const { Univer, LocaleType } = require('@univerjs/core'), { FUniver } = require('@univerjs/core/facade');
require('@univerjs/docs/facade');
function native(data) {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { enUS: {} } });
  univer.registerPlugin(require('@univerjs/engine-render').UniverRenderEnginePlugin);
  univer.registerPlugin(require('@univerjs/docs').UniverDocsPlugin);
  const api = FUniver.newAPI(univer);
  return { univer, api, doc: api.createDocument(data) };
}
test('installed built-in list commands preserve flat sequences, offsets, inline style and save/reopen', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'document-lists-')), 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const ws = new Workspace(new FileFixtureStore(path));
  const { workId } = await ws.createBlank('owner', { commandId: 'create', kind: 'document', title: 'Lists' });
  const f = native(blankDocument(workId, 'Lists', '雪 🌍 first\nsecond\nplain\nthird\nfourth\nbullet'));
  const core = require('@univerjs/core'), ui = require('@univerjs/docs-ui'), commands = f.univer.__getInjector().get(core.ICommandService);
  for (const c of [ui.ListOperationCommand, ui.ChangeListTypeCommand, ui.BulletListCommand, ui.OrderListCommand]) commands.registerCommand(c);
  const apply = (c, startOffset, endOffset) => assert.equal(commands.syncExecuteCommand(c.id, { docRange: [{ startOffset, endOffset, collapsed: false, segmentId: '' }] }), true);
  let saved;
  try {
    apply(ui.OrderListCommand, 0, 17); apply(ui.OrderListCommand, 24, 36); apply(ui.BulletListCommand, 37, 43);
    f.doc.getTextRange(0, 4).setTextStyle({ bl: 1 });
    saved = JSON.parse(JSON.stringify(f.doc.save())); validateDocument(saved);
    const p = saved.body.paragraphs;
    assert.deepEqual(p.map(p => p.startIndex), [10,17,23,29,36,43]);
    assert.equal(p[2].bullet, undefined); assert.equal(p[0].bullet.listId, p[1].bullet.listId);
    assert.notEqual(p[0].bullet.listId, p[3].bullet.listId); assert.equal(p[5].bullet.listType, 'BULLET_LIST');
    assert.equal(saved.lists, undefined); // The SDK resolves standard presets implicitly.
    assert.equal(f.doc.insertText(0, 'Edited '), true);
    saved = JSON.parse(JSON.stringify(f.doc.save())); validateDocument(saved);
    assert.deepEqual(saved.body.paragraphs.map(p => p.startIndex), [17,24,30,36,43,50]);
    assert.deepEqual(saved.body.paragraphs.map(p => p.bullet), p.map(p => p.bullet));
    await ws.save('owner', workId, { commandId: 'save', document: saved, contentRevision: 1, permissionRevision: 1 });
    // Actual nine-level built-in templates are valid while only level zero is active.
    validateDocument({ ...saved, lists: { ORDER_LIST: core.PRESET_LIST_TYPE.ORDER_LIST, BULLET_LIST: core.PRESET_LIST_TYPE.BULLET_LIST } });
  } finally { f.univer.dispose(); }
  const stored = await new Workspace(new FileFixtureStore(path)).get('owner', workId), reopened = native(stored.document);
  try { assert.deepEqual(reopened.doc.save(), saved); assert.equal(stored.humanDocument, true); }
  finally { reopened.univer.dispose(); }
});
test('installed native document insert, selection/range styling, save and reopen retain native structure', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'document-sdk-')), 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const ws = new Workspace(new FileFixtureStore(path));
  const { workId } = await ws.createBlank('owner', { commandId: 'create', title: 'Native document', kind: 'document' });
  const w = await ws.get('owner', workId), first = native(w.document); let saved, changes = 0;
  const listener = first.api.addEvent(first.api.Event.CommandExecuted, e => { if (e.id.startsWith('doc.mutation.')) changes++; });
  try {
    validateDocument(first.doc.save());
    const emptyReopen = native(structuredClone(first.doc.save())); try { validateDocument(emptyReopen.doc.save()); } finally { emptyReopen.univer.dispose(); }
    assert.equal(first.doc.insertText(0, 'Native text\rSecond paragraph'), true);
    assert.equal(first.doc.getTextRange(0, 6).setTextStyle({ bl: 1, it: 1, fs: 18, ff: 'Arial', cl: { rgb: '#123456' }, bg: { rgb: '#fff000' }, ul: { s: 1 }, st: { s: 0 } }), true);
    assert.equal(first.doc.getParagraphs()[0].setStyle({ horizontalAlign: 2, lineSpacing: 1.5, spaceAbove: { v: 8 }, spaceBelow: { v: 4 }, indentStart: { v: 12 }, tabStops: [{ offset: 72, alignment: 1 }] }), true);
    saved = structuredClone(first.doc.save()); assert.ok(changes >= 2);
    validateDocument(saved); assert.equal(saved.body.textRuns[0].ts.bl, 1);
    await ws.save('owner', w.id, { commandId: 'save', document: saved, contentRevision: 1, permissionRevision: 1 });
  } finally { listener.dispose(); first.univer.dispose(); }
  const stored = await new Workspace(new FileFixtureStore(path)).get('owner', w.id);
  assert.deepEqual(stored.document, saved); assert.equal(stored.humanDocument, true);
  const second = native(stored.document);
  try { assert.deepEqual(second.doc.save(), saved); assert.equal(documentText(second.doc.save()), 'Native text\nSecond paragraph'); }
  finally { second.univer.dispose(); }
});
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
// Actual DocumentEditor consumer with hook/container fixtures and installed native
// commands. The DOM and preset rendering remain Parent's browser qualification.
test('DocumentEditor consumer observes native pending edits/title/styles and refuses disposed or composing commits', async () => {
  const code = ts.transpileModule(readFileSync(new URL('../src/DocumentEditor.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const listeners = new Map(), element = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  let cleanup, handle, instance, nativeAPI, doc, tree, failCreate = false; const edits = [], errors = [];
  const react = { useRef: value => ({ current: value === null ? element : value }), useEffect: fn => { cleanup = fn(); } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name.endsWith('/workagent-contract/document.mjs')) return documentContract;
    if (name === 'react') return react;
    if (name === '@univerjs/presets') return { LocaleType, mergeLocales: x => x, createUniver: options => {
      assert.equal(options.presets.length, 1);
      instance = new Univer({ locale: LocaleType.EN_US, locales: { enUS: {} } });
      instance.registerPlugin(require('@univerjs/engine-render').UniverRenderEnginePlugin); instance.registerPlugin(require('@univerjs/docs').UniverDocsPlugin);
      installClipboard(instance);
      const api = nativeAPI = FUniver.newAPI(instance), create = api.createDocument.bind(api); api.createDocument = data => { if (failCreate) throw new Error('Native body unavailable'); return doc = create(data); };
      return { univer: instance, univerAPI: api };
    } };
    if (name === '@univerjs/preset-docs-core') return require(name);
    if (name.endsWith('/locales/en-US')) return {};
    if (name.endsWith('.css')) return {};
    return require(name);
  }, module, module.exports);
  tree = module.exports.DocumentEditor({ document: blankDocument('consumer', 'Title'), version: 'v1', onReady: value => { handle = value; }, onEdit: value => edits.push(value), onError: e => errors.push(e) });
  try {
    doc.insertText(0, 'Unfinished native text'); doc.getTextRange(0, 10).setTextStyle({ bl: 1 });
    assert.equal(edits.at(-1).body.dataStream, 'Unfinished native text\r\n'); assert.equal(edits.at(-1).body.textRuns[0].ts.bl, 1);
    const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
    nodes(tree).find(n => n.props['aria-label'] === 'Document title').props.onChange({ target: { value: 'Renamed' } });
    const committed = await handle.commit(); assert.equal(committed.title, 'Renamed'); assert.deepEqual(committed, edits.at(-1)); validateDocument(committed);
    // The installed DocInputController uses this asynchronous public command path.
    // The mutation can precede command completion: a save must not acknowledge it early.
    const input = nativeAPI.executeCommand('doc.command.insert-text', { unitId: 'consumer', body: { dataStream: 'Typed ' }, range: { startOffset: 0, endOffset: 0, collapsed: true } });
    assert.equal(handle.isEditing(), true);
    await assert.rejects(handle.commit(), /input is still finishing/);
    assert.equal(await input, true); assert.equal(handle.isEditing(), false);
    assert.match((await handle.commit()).body.dataStream, /^Typed Unfinished/);
    listeners.get('compositionstart')(); assert.equal(handle.isEditing(), true); await assert.rejects(handle.commit(), /Finish composing/);
    doc.insertText(0, '雪'); listeners.get('compositionend')(); await Promise.resolve();
    assert.equal(handle.isEditing(), false); assert.match((await handle.commit()).body.dataStream, /^雪/);
    const stale = handle, editsBeforeDispose = edits.length;
    listeners.get('compositionend')(); // A queued native callback cannot publish after disposal.
    cleanup(); cleanup = null; await Promise.resolve();
    assert.equal(edits.length, editsBeforeDispose); assert.equal(handle, null); await assert.rejects(stale.commit(), /editor changed/); assert.deepEqual(errors, []);
    failCreate = true;
    module.exports.DocumentEditor({ document: blankDocument('broken', 'Title'), version: 'v2', onReady: value => { handle = value; }, onEdit: value => edits.push(value), onError: e => errors.push(e) });
    assert.equal(handle, null); assert.match(errors[0].message, /Native body unavailable/);
  } finally { cleanup?.(); }
});

// Reuse the actual TSX hook fixtures without registering their separate test files.
function consumerFixture(file, names) {
  const url = new URL(file, import.meta.url);
  let source = readFileSync(url, 'utf8').split('for (const newerPending')[0].replace('const require = createRequire(import.meta.url);', '').replaceAll('import.meta.url', JSON.stringify(url.href));
  source += `\nmodule.exports = {${names}};`;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(createRequire(url), module, module.exports);
  return module.exports;
}
// Capture the installed plugin's dependency registration using a headless host.
// This obtains the real unexported service class without rewriting SDK source or
// shared prototypes; DocumentEditor still resolves its own service by public token.
const ui = require('@univerjs/docs-ui'), core = require('@univerjs/core'), docs = require('@univerjs/docs');
const dependencies = [], disposable = () => ({ dispose() {} });
const registration = new ui.UniverDocsUIPlugin({}, { add: d => dependencies.push(d), get: () => ({ registerShortcut() {} }) }, {}, { registerCommand: disposable, registerMultipleCommand: disposable }, { setConfig() {} });
const NativeClipboard = dependencies.find(([token]) => token === ui.IDocClipboardService)[1].useClass;
registration.dispose();
function installClipboard(instance, clipboardRead = async () => []) {
  const injector = instance.__getInjector(), command = injector.get(core.ICommandService), selection = injector.get(docs.DocSelectionManagerService);
  command.registerCommand(ui.InnerPasteCommand);
  const clipboard = new NativeClipboard(injector.get(core.IUniverInstanceService), injector.get(core.ILogService), command, injector.get(core.IPermissionService), { supportClipboard: true, read: clipboardRead }, injector.get(core.ErrorService), new ui.DocHtmlExportService(), selection, injector.get(docs.DocStateChangeManagerService), { getDefaultStyle: () => ({}), getStyleCache: () => ({}) }, injector.get(core.IUndoRedoService));
  injector.add([ui.IDocClipboardService, { useValue: clipboard }]);
  return clipboard;
}
function editorFixture(props, clipboardRead = async () => []) {
  let cleanup, handle, instance, clipboard, nativeDoc, tree; const edits = [], errors = [];
  const listeners = new Map(), element = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/DocumentEditor.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name.endsWith('/workagent-contract/document.mjs')) return documentContract;
    if (name === 'react') return { useRef: value => ({ current: value === null ? element : value }), useEffect: fn => { cleanup = fn(); } };
    if (name === '@univerjs/presets') return { LocaleType, mergeLocales: x => x, createUniver: () => {
      instance = new Univer({ locale: LocaleType.EN_US, locales: { enUS: {} } });
      instance.registerPlugin(require('@univerjs/engine-render').UniverRenderEnginePlugin); instance.registerPlugin(docs.UniverDocsPlugin);
      clipboard = installClipboard(instance, clipboardRead);
      const selection = instance.__getInjector().get(docs.DocSelectionManagerService);
      const api = FUniver.newAPI(instance), create = api.createDocument.bind(api);
      api.createDocument = data => { nativeDoc = create(data); selection.__TEST_ONLY_setCurrentSelection({ unitId: data.id, subUnitId: data.id }); selection.__TEST_ONLY_add([{ startOffset: 0, endOffset: 0, collapsed: true, isActive: true, segmentId: '' }]); return nativeDoc; };
      return { univer: instance, univerAPI: api };
    } };
    if (name.endsWith('.css') || name.endsWith('/locales/en-US')) return {};
    return require(name);
  }, module, module.exports);
  tree = module.exports.DocumentEditor({ version: 'test', onError: e => errors.push(e), ...props, onReady: h => { handle = h; props.onReady?.(h); }, onEdit: d => { edits.push(d); props.onEdit?.(d); } });
  const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
  return { clipboard, edits, errors, listeners, doc: () => nativeDoc,
    select(ranges, segmentId = '', rectRanges = []) {
      const selection = instance.__getInjector().get(docs.DocSelectionManagerService);
      // Installed render-to-logical-selection entry point; geometry/pointer input
      // remains a browser qualification. The actual SDK emits its real event.
      selection.__replaceTextRangesWithNoRefresh({ textRanges: ranges.map(r => ({ collapsed: r.startOffset === r.endOffset, isActive: true, segmentId, ...r })), rectRanges, segmentId, segmentPage: -1, isEditing: false, style: require('@univerjs/engine-render').NORMAL_TEXT_SELECTION_PLUGIN_STYLE }, { unitId: nativeDoc.getId(), subUnitId: nativeDoc.getId() });
    }, get handle() { return handle; }, title(value) { nodes(tree).find(n => n.props['aria-label'] === 'Document title').props.onChange({ target: { value } }); }, dispose() { cleanup?.(); cleanup = null; } };
}
const held = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
for (const entry of ['paste', 'pasteFromClipboard', 'legacyPaste']) test(`owned SDK ${entry} blocks actual export/save/send through delayed read and recovers`, async () => {
  const app = consumerFixture('./csv-app.test.mjs', 'mount,disk,server'), exchange = consumerFixture('./document-exchange.test.mjs', 'mount,storage');
  const api = app.server((path, input, works) => {
    if (path.endsWith('/save')) { assert.ok(input.document); assert.equal(input.book, undefined); works.old = { ...works.old, document: input.document, contentRevision: 2, eventSequence: 2 }; return { contentRevision: 2, permissionRevision: 1 }; }
    return { workId: 'old' };
  });
  const { book, ...base } = api.works.old; api.works.old = { ...base, kind: 'document', document: blankDocument('old', 'Title', 'Before') };
  const view = app.mount(app.disk(), api.fetch); await view.flush(); await view.open('old');
  const gate = held(), readGate = held(), items = [{ types: ['text/plain'], getType: async () => ({ text: () => gate.promise }) }];
  const editor = editorFixture(view.doc(), async () => readGate.promise);
  const ex = exchange.mount(exchange.storage(), { api: async () => assert.fail('network'), editor: () => editor.handle, work: api.works.old, onImported: async () => {}, onOpen: async () => {} });
  try {
    editor.title('Human title'); await view.flush();
    // legacyPaste's async preparation is its public image hook; ordinary text also
    // runs through the same tracked entry point, even before its first mutation.
    let paste;
    if (entry === 'legacyPaste') paste = editor.clipboard.legacyPaste({ text: 'Pasted ', files: [], mode: 'text' });
    else paste = entry === 'paste' ? editor.clipboard.paste(items, 'text') : editor.clipboard.pasteFromClipboard('text');
    assert.equal(editor.handle.isEditing(), true);
    if (entry !== 'legacyPaste') {
      await view.click('Save document'); await view.message('Explain this document'); await view.send(); await ex.click('Export document Markdown source');
      assert.equal(api.calls.filter(c => c.path.endsWith('/save') || c.path === '/api/work/commands').length, 0);
      assert.equal(ex.downloads.length, 0); assert.match(ex.text(), /finishing/); assert.equal(view.messageValue(), 'Explain this document');
      await view.click('Download draft'); assert.match(view.text(), /finishing/);
      await view.open('imported'); assert.equal(view.doc().document.id, 'old');
      readGate.resolve(items); gate.resolve('Pasted ');
    }
    assert.equal(await paste, true); assert.equal(editor.handle.isEditing(), false);
    await ex.click('Export document Markdown source'); assert.equal(await ex.blobs[0].text(), 'Pasted Before');
    await view.click('Save document'); assert.equal(api.calls.find(c => c.path.endsWith('/save')).input.document.body.dataStream, 'Pasted Before\r\n');
    await view.message('Explain this document'); await view.send(); assert.equal(api.calls.filter(c => c.path === '/api/work/commands').length, 1);
    const bad = editor.clipboard.paste([{ types: ['text/plain'], getType: async () => { throw Error('clipboard failed'); } }], 'text');
    await assert.rejects(bad, /clipboard failed/); assert.equal(editor.handle.isEditing(), false); await editor.handle.commit();
    const late = held(), pending = editor.clipboard.paste([{ types: ['text/plain'], getType: async () => ({ text: () => late.promise }) }], 'text');
    const stale = editor.handle, count = editor.edits.length; editor.dispose(); late.resolve('Too late');
    assert.equal(await pending, false); assert.equal(editor.edits.length, count); assert.equal(stale.isEditing(), false); await assert.rejects(stale.commit(), /editor changed/);
  } finally { editor.dispose(); view.unmount(); ex.unmount(); }
});

for (const [field, value] of [['sheetOrder', []], ['sheetOrder', null], ['sheets', {}], ['book', null], ['name', 'foreign workbook']]) test(`actual SDK → App title/save keeps document kind for legacy ${field}:${JSON.stringify(value)} and offers intact recovery`, async () => {
  const app = consumerFixture('./csv-app.test.mjs', 'mount,disk,server');
  const store = { state: initialState('owner'), async transaction(fn) { const next = structuredClone(this.state), result = await fn(next); this.state = next; return structuredClone(result); } }, ws = new Workspace(store);
  const { workId } = await ws.createBlank('owner', { commandId: 'new', title: 'Native title', kind: 'document' });
  const saved = await ws.get('owner', workId), poisoned = structuredClone(saved.document); poisoned[field] = value;
  const api = app.server(async (path, input, works) => {
    if (path.endsWith('/save')) { try { const result = await ws.save('owner', workId, input); works[workId] = await ws.get('owner', workId); return result; } catch(e) { const { ApiError } = await import('../src/resume.ts'); throw new ApiError(path.slice(4), e.status, e.message); } }
    assert.fail('unexpected mutation');
  });
  api.works[workId] = saved;
  const storage = app.disk(), retained = new Map(), set = storage.setItem; storage.setItem = (key, value) => { if (key.startsWith('workagent-recovery:')) retained.set(key, value); set(key, value); }; storage.setItem(`workagent-draft:${workId}`, JSON.stringify({ book: poisoned, revision: 1, permission: 1 }));
  const view = app.mount(storage, api.fetch); await view.flush(); await view.open(workId);
  const editor = editorFixture(view.doc());
  try {
    editor.title('Human title'); await view.flush(); assert.match(view.text(), /Native title/);
    assert.equal(view.documents().editor(), editor.handle); assert.equal(view.exchange().editor(), null); assert.equal(view.xlsx().editor(), null);
    assert.doesNotMatch(view.text(), /Attach selected cells/);
    await view.click('Save document');
    const sent = api.calls.find(c => c.path.endsWith('/save')); assert.ok(sent.input.document); assert.equal(sent.input.book, undefined);
    assert.deepEqual(sent.input.document[field], value); assert.equal((await ws.get('owner', workId)).contentRevision, 1);
    assert.match(view.text(), /Download draft/); assert.match(view.text(), /Open saved version/);
    assert.equal(new (await import('../src/maintenance-actions.ts')).MaintenanceActions(storage, `sheet-save:${workId}`).read(), null);
    await view.click('Open saved version'); editor.dispose();
    const clean = editorFixture(view.doc()); clean.title('Recovered title'); await view.flush(); await view.click('Save document'); clean.dispose();
    assert.equal((await ws.get('owner', workId)).document.title, 'Recovered title');
    // viewSaved retains a whole native recovery snapshot, including the foreign field.
    assert.equal(storage.getItem(`workagent-draft:${workId}`), null);
    assert.equal(retained.size, 1); assert.deepEqual(JSON.parse([...retained.values()][0]).book[field], value);
    assert.equal(JSON.parse([...retained.values()][0]).book.title, 'Human title');
  } finally { editor.dispose(); view.unmount(); }
});

test('legacy native clipboard hook failure and overlapping reads release only their owned lifetime; remount stays live', async () => {
  const editor = editorFixture({ document: blankDocument('old', 'Title', 'Before') }), hookGate = held();
  const hook = editor.clipboard.addClipboardHook({ onBeforePasteImage: () => hookGate.promise });
  try {
    const paste = editor.clipboard.legacyPaste({ files: [new File(['fixture'], 'fixture.png', { type: 'image/png' })] });
    assert.equal(editor.handle.isEditing(), true); await assert.rejects(editor.handle.commit(), /finishing/);
    hookGate.reject(Error('image preparation failed')); await assert.rejects(paste, /image preparation failed/);
    assert.equal(editor.handle.isEditing(), false); assert.equal((await editor.handle.commit()).body.dataStream, 'Before\r\n');
    const a = held(), b = held(), items = gate => [{ types: ['text/plain'], getType: async () => ({ text: () => gate.promise }) }];
    const first = editor.clipboard.paste(items(a), 'text'), second = editor.clipboard.paste(items(b), 'text');
    a.reject(Error('read failed')); await assert.rejects(first, /read failed/); assert.equal(editor.handle.isEditing(), true);
    const oldHandle = editor.handle, oldCount = editor.edits.length; editor.dispose();
    const next = editorFixture({ document: blankDocument('new', 'New title', 'New work') });
    try {
      b.resolve('late'); assert.equal(await second, false); assert.equal(oldHandle.isEditing(), false); assert.equal(editor.edits.length, oldCount);
      assert.equal((await next.handle.commit()).body.dataStream, 'New work\r\n'); assert.equal(next.edits.length, 0);
    } finally { next.dispose(); }
  } finally { hook.dispose(); editor.dispose(); }
});

for (const kind of [undefined, 'sheet']) test(`actual App preserves ${kind ?? 'legacy absent-kind'} sheet save/selection/export dispatch`, async () => {
  const app = consumerFixture('./csv-app.test.mjs', 'mount,disk,server,attach');
  const api = app.server((path, input, works) => {
    assert.ok(input.book); assert.equal(input.document, undefined);
    works.old = { ...works.old, book: input.book, contentRevision: 2, eventSequence: 2 };
    return { contentRevision: 2, permissionRevision: 1 };
  });
  if (kind) api.works.old.kind = kind;
  const view = app.mount(app.disk(), api.fetch); await view.flush(); await view.open('old');
  try {
    const sheet = app.attach(view); sheet.edit('human value'); await view.flush();
    assert.equal(view.exchange().editor(), sheet.handle); assert.equal(view.xlsx().editor(), sheet.handle); assert.equal(view.documents().editor(), null);
    await view.click('Attach selected cells'); await view.save();
    assert.equal(api.calls.find(c => c.path.endsWith('/save')).input.book.sheets.sheet1.cellData[0][0].v, 'human value');
  } finally { view.unmount(); }
});

// These tests drive actual installed logical selection events and native editing
// through the actual DocumentEditor + App TSX consumers. Pointer geometry/DOM
// rendering and real clipboard permissions remain Parent's browser acceptance.
async function selectionApp(handler, storage) {
  const app = consumerFixture('./csv-app.test.mjs', 'mount,disk,server');
  const api = app.server(handler ?? ((path, input, works) => {
    if (path.endsWith('/save')) { const revision = works.old.contentRevision + 1; works.old = { ...works.old, document: input.document, contentRevision: revision, eventSequence: revision }; return { contentRevision: revision, permissionRevision: 1 }; }
    return { workId: input.workId };
  }));
  const { book, ...w } = api.works.old;
  api.works.old = { ...w, kind: 'document', document: blankDocument('old', 'Native source', '  雪 🌍 é Ελληνικά العربية\nSecond paragraph  ') };
  storage ??= app.disk(); const view = app.mount(storage, api.fetch); await view.flush(); await view.open('old');
  const editor = editorFixture(view.doc());
  return { app, api, view, editor, storage, close() { editor.dispose(); view.unmount(); } };
}
test('genuine logical body selection → actual TSX attach/remove/save/send uses exact Unicode quote and explicit document descriptor', async () => {
  const f = await selectionApp();
  try {
    f.editor.doc().insertText(0, 'Human edit\r');
    f.editor.doc().getTextRange(0, 5).setTextStyle({ bl: 1 });
    const original = await f.editor.handle.commit(), endOffset = original.body.dataStream.length - 1;
    f.editor.select([{ startOffset: 0, endOffset }]); await f.view.flush();
    await f.view.click('Attach selected text');
    assert.match(f.view.text(), /body offsets/); assert.match(f.view.text(), /雪 🌍 é Ελληνικά العربية/);
    assert.equal(JSON.parse(f.storage.getItem('workagent-composer:old')).selection.quote, original.body.dataStream.slice(0, -1));
    await f.view.click('Remove selection'); assert.equal(JSON.parse(f.storage.getItem('workagent-composer:old')).selection, undefined);
    await f.view.click('Attach selected text'); await f.view.message('Explain only this passage'); await f.view.send();
    const saves = f.api.calls.filter(c => c.path.endsWith('/save')), sends = f.api.calls.filter(c => c.path === '/api/work/commands');
    assert.equal(saves.length, 1); assert.deepEqual(saves[0].input.document, original); assert.equal(sends.length, 1);
    assert.deepEqual(sends[0].input.selection, { kind: 'document', workId: 'old', documentId: 'old', segmentId: '', startOffset: 0, endOffset, contentRevision: 2 });
    assert.equal(sends[0].input.selection.quote, undefined); assert.equal(sends[0].input.selection.sheetId, undefined);
  } finally { f.close(); }
});
test('native selection refuses caret, multiple ranges, header/footer, objects, surrogate split and excess; keeps exact whitespace', async () => {
  const e = editorFixture({ document: blankDocument('selection', 'Native', '  🌍\n' + 'x'.repeat(10001)) });
  try {
    for (const [ranges, segment, rect, error] of [
      [[{ startOffset: 0, endOffset: 0 }], '', [], /caret/],
      [[{ startOffset: 0, endOffset: 1 }, { startOffset: 4, endOffset: 5 }], '', [], /Multiple ranges/],
      [[{ startOffset: 0, endOffset: 1 }], 'header', [], /headers/],
      [[{ startOffset: 0, endOffset: 1, segmentId: 'footer' }], '', [], /footers/],
      [[{ startOffset: 0, endOffset: 1 }], '', [{ startOffset: 0, endOffset: 1 }], /objects/],
      [[{ startOffset: 2, endOffset: 3 }], '', [], /Unicode/],
      [[{ startOffset: 3, endOffset: 4 }], '', [], /Unicode/],
      [[{ startOffset: 0, endOffset: 10001 }], '', [], /10,000/],
    ]) { e.select(ranges, segment, rect); assert.throws(() => e.handle.selection(), error); }
    e.select([{ startOffset: 0, endOffset: 5 }]); assert.equal(e.handle.selection().quote, '  🌍\r');
    e.select([{ startOffset: 5, endOffset: 10005 }]); assert.equal(e.handle.selection().quote.length, 10000);
  } finally { e.dispose(); }
});
for (const change of ['selection-ABA', 'title-ABA', 'text', 'style']) test(`document attachment detects ${change} before send and leaves unsaved edits and message intact`, async () => {
  const f = await selectionApp();
  try {
    f.editor.select([{ startOffset: 0, endOffset: 6 }]); await f.view.click('Attach selected text'); await f.view.message('Explain attached text');
    if (change === 'selection-ABA') { f.editor.select([{ startOffset: 6, endOffset: 7 }]); f.editor.select([{ startOffset: 0, endOffset: 6 }]); }
    if (change === 'title-ABA') { f.editor.title('Changed'); f.editor.title('Native source'); }
    if (change === 'text') f.editor.doc().insertText(0, 'New');
    if (change === 'style') f.editor.doc().getTextRange(0, 2).setTextStyle({ bl: 1 });
    await f.view.flush(); assert.match(f.view.text(), /Reattach selected text/);
    await f.view.send(); assert.equal(f.api.calls.filter(c => c.path.endsWith('/save') || c.path === '/api/work/commands').length, 0);
    assert.equal(f.view.messageValue(), 'Explain attached text');
    await f.view.click('Remove selection'); await f.view.send(); assert.equal(f.api.calls.filter(c => c.path === '/api/work/commands').length, 1);
  } finally { f.close(); }
});
for (const change of ['selection-ABA', 'title-ABA', 'new-revision', 'remount', 'native-input']) test(`document selection ${change} during held save ACK refuses admission`, async () => {
  const gate = held();
  const f = await selectionApp((path, input, works) => {
    if (path.endsWith('/save')) { works.old = { ...works.old, document: input.document, contentRevision: change === 'new-revision' ? 3 : 2, eventSequence: 3 }; return gate.promise; }
    assert.fail('changed selection must not admit a command');
  });
  let next;
  try {
    f.editor.title('Human title'); f.editor.select([{ startOffset: 0, endOffset: 6 }]); await f.view.click('Attach selected text'); await f.view.message('Explain attached'); await f.view.send();
    assert.equal(f.api.calls.filter(c => c.path.endsWith('/save')).length, 1);
    if (change === 'selection-ABA') { f.editor.select([{ startOffset: 6, endOffset: 7 }]); f.editor.select([{ startOffset: 0, endOffset: 6 }]); }
    if (change === 'title-ABA') { f.editor.title('Temporary'); f.editor.title('Human title'); }
    if (change === 'remount') { f.editor.dispose(); next = editorFixture(f.view.doc()); next.select([{ startOffset: 0, endOffset: 6 }]); }
    if (change === 'native-input') f.editor.listeners.get('compositionstart')();
    gate.resolve({ contentRevision: 2, permissionRevision: 1 }); await f.view.flush();
    assert.equal(f.api.calls.filter(c => c.path === '/api/work/commands').length, 0); assert.equal(f.view.messageValue(), 'Explain attached');
    assert.match(f.view.text(), /changed|latest edit/);
  } finally { next?.dispose(); f.close(); }
});
test('selection attachment and draft survive intentional navigation/reload but remount visibly requires reattachment', async () => {
  const f = await selectionApp(); let reopened;
  try {
    f.editor.title('Human draft'); f.editor.select([{ startOffset: 0, endOffset: 6 }]); await f.view.click('Attach selected text'); await f.view.message('Keep this passage');
    const saved = f.storage.getItem('workagent-composer:old'); await f.view.open('imported'); f.editor.dispose(); await f.view.open('old');
    reopened = editorFixture(f.view.doc()); await f.view.flush();
    assert.equal(f.view.doc().document.title, 'Human draft'); assert.equal(f.view.messageValue(), 'Keep this passage'); assert.equal(f.storage.getItem('workagent-composer:old'), saved);
    assert.match(f.view.text(), /Reattach selected text/); reopened.select([{ startOffset: 0, endOffset: 6 }]); await f.view.send();
    assert.equal(f.api.calls.filter(c => c.path === '/api/work/commands').length, 0);
    await f.view.click('Attach selected text'); await f.view.send(); assert.equal(f.api.calls.filter(c => c.path === '/api/work/commands').length, 1);
  } finally { reopened?.dispose(); f.close(); }
});
test('pending real clipboard/IME fences attachment and send; failed inner paste releases only its operation and valid paste recovers', async () => {
  const f = await selectionApp(), gate = held();
  const items = text => [{ types: ['text/plain'], getType: async () => ({ text: async () => text }) }];
  try {
    f.editor.select([{ startOffset: 0, endOffset: 6 }]); await f.view.click('Attach selected text'); await f.view.message('Explain text');
    const paste = f.editor.clipboard.paste([{ types: ['text/plain'], getType: async () => ({ text: () => gate.promise }) }], 'text');
    assert.equal(f.editor.handle.isEditing(), true); await f.view.click('Attach selected text'); await f.view.send();
    assert.match(f.view.text(), /finishing/); assert.equal(f.api.calls.filter(c => c.path.endsWith('/save') || c.path === '/api/work/commands').length, 0);
    gate.resolve('Pasted '); assert.equal(await paste, true);
    assert.equal(await f.editor.clipboard.legacyPaste({ text: '\u001a', files: [], mode: 'text' }), false); assert.equal(f.editor.handle.isEditing(), false);
    assert.equal(await f.editor.clipboard.paste(items('Recovered '), 'text'), true); await f.editor.handle.commit();
    f.editor.select([{ startOffset: 0, endOffset: 6 }]); f.editor.listeners.get('compositionstart')();
    assert.throws(() => f.editor.handle.selection(), /finishing/); await f.view.send(); assert.equal(f.api.calls.filter(c => c.path === '/api/work/commands').length, 0);
    f.editor.listeners.get('compositionend')(); await Promise.resolve();
    f.editor.select([{ startOffset: 0, endOffset: 6 }]); await f.view.click('Attach selected text'); await f.view.send();
    assert.equal(f.api.calls.filter(c => c.path === '/api/work/commands').length, 1);
  } finally { gate.resolve(''); f.close(); }
});
test('document lost-ACK retry after reload uses exact body without saving newer native edits or recapturing selection', async () => {
  let sends = 0; const f = await selectionApp((path, input) => {
    assert.equal(path, '/api/work/commands'); if (++sends === 1) throw Error('lost acknowledgement'); return { workId: input.workId };
  });
  let reload, editor;
  try {
    f.editor.select([{ startOffset: 0, endOffset: 6 }]); await f.view.click('Attach selected text'); await f.view.message('Explain original passage'); await f.view.send();
    assert.match(f.view.text(), /original captured context retained/); f.close();
    reload = f.app.mount(f.storage, f.api.fetch); await reload.flush(); await reload.open('old'); editor = editorFixture(reload.doc());
    editor.doc().insertText(0, 'New human content '); editor.select([{ startOffset: 6, endOffset: 9 }]); await reload.flush();
    await reload.send(); const calls = f.api.calls.filter(c => c.path === '/api/work/commands'); assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]);
    assert.equal(f.api.calls.filter(c => c.path.endsWith('/save')).length, 0); assert.match(JSON.parse(f.storage.getItem('workagent-draft:old')).book.body.dataStream, /^New human content/);
  } finally { editor?.dispose(); reload?.unmount(); f.close(); }
});
test('two document send consumers keep original command even after sibling settles and clears shared storage', async () => {
  let sends = 0; const f = await selectionApp((path, input) => { assert.equal(path, '/api/work/commands'); if (++sends === 1) throw Error('lost acknowledgement'); return { workId: input.workId }; });
  let sibling, editor;
  try {
    f.editor.select([{ startOffset: 0, endOffset: 6 }]); await f.view.click('Attach selected text'); await f.view.message('Explain once'); await f.view.send();
    sibling = f.app.mount(f.storage, f.api.fetch); await sibling.flush(); await sibling.open('old'); editor = editorFixture(sibling.doc()); await sibling.send();
    assert.equal(f.storage.getItem('workagent-composer:old:send'), null);
    await f.view.send(); const calls = f.api.calls.filter(c => c.path === '/api/work/commands'); assert.equal(calls.length, 3); assert.deepEqual(calls[1], calls[0]); assert.deepEqual(calls[2], calls[0]);
  } finally { editor?.dispose(); sibling?.unmount(); f.close(); }
});
