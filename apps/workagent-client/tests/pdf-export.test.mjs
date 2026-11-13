// Actual TSX consumer and installed native SDK, with explicit hook/transport fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { validatePdfDocument } from '../../workagent-server/src/pdf-exchange.mjs';
import { trustedCodec } from '../../workagent-server/tests/support/docx-fixture.mjs';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
import { listDocument } from '../../workagent-server/tests/support/pdf-list-fixture.mjs';
import { importedWord, importedSaved, pdfIntermediate, contrastNative } from '../../workagent-server/tests/support/pdf-imported-fixture.mjs';
import { PDF_WARNINGS } from '../../workagent-server/src/pdf-exchange.mjs';
function fixture(file, boundary, names, edit = s => s) {
  const url = new URL(file, import.meta.url);
  let source = edit(readFileSync(url, 'utf8').split(boundary)[0]).replaceAll('import.meta.url', JSON.stringify(url.href));
  source = source.replaceAll("import.meta.resolve('@univerjs/preset-docs-core')", JSON.stringify(import.meta.resolve('@univerjs/preset-docs-core')));
  source += `\nmodule.exports = {${names}};`;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('require', 'module', 'exports', code)(createRequire(url), module, module.exports); return module.exports;
}
const { mount, storage } = fixture('./docx-exchange.test.mjs', 'for (const newerPending', 'mount,storage', s => s.replace('const require = createRequire(import.meta.url);', '').replaceAll('../src/DocxExchange.tsx', '../src/PdfExport.tsx').replaceAll('module.exports.DocxExchange(props)', 'module.exports.PdfExport(props)').replace('button.props.onClick(); await flush();', 'button.props.onClick(); button.props.onClick(); await flush();'));
const { editorFixture, dependencies, ui, core, docs } = fixture('./docx-native.test.mjs', 'import { trustedCodec', 'editorFixture,dependencies,ui,core,docs', s => s.replace("const require = createRequire(import.meta.resolve('@univerjs/preset-docs-core'));", "require = createRequire(import.meta.resolve('@univerjs/preset-docs-core'));")
  .replace('const element = { addEventListener() {}, removeEventListener() {} };', 'const listeners = {}; const element = { addEventListener(k, fn) { listeners[k] = fn; }, removeEventListener(k) { delete listeners[k]; } };')
  .replace('return { instance, nativeDoc, clipboard,', 'return { emit: k => listeners[k]?.(), instance, nativeDoc, clipboard,'));
const held = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
const result = { base64: Buffer.from('%PDF-1.7\nfixture\n%%EOF\n').toString('base64'), filename: 'Current.pdf', warnings: ['Fonts may differ'] };
const work = { id: 'doc', kind: 'document', contentRevision: 1, expected: { permissionRevision: 1 } };
const label = 'Export document PDF (.pdf)';
function nativeMarkers(data, instance, full = false) {
  const er = createRequire(import.meta.resolve('@univerjs/preset-docs-core'))('@univerjs/engine-render');
  const skeleton = er.DocumentSkeleton.create(new er.DocumentViewModel(new core.DocumentDataModel(structuredClone(data))), instance.__getInjector().get(core.LocaleService));
  try {
    skeleton.calculate(); const found = [], seen = new Set();
    function walk(value) {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (value.glyphType === 2 && value.content) found.push(full
        ? [value.content, ...['cl', 'fs', 'bl', 'it', 'ul'].map(k => value.ts[k] ?? core.DEFAULT_STYLES[k])]
        : [value.content, (value.ts.cl ?? core.DEFAULT_STYLES.cl).rgb]);
      if (value instanceof Map) for (const child of value.values()) walk(child);
      else for (const [key, child] of Object.entries(value)) if (key !== 'parent') walk(child);
    }
    walk(skeleton.getSkeletonData()); return found;
  } finally { skeleton.dispose(); }
}
for (const atEnd of [false, true]) test(`genuine imported Word → native Enter/undo/redo → PDF intermediate: ${atEnd ? 'end colour conflict mapped' : 'middle split preserved'}`, async () => {
  const source = importedWord(), imported = trustedCodec({ op: 'import', base64: source }).document;
  imported.id = 'doc';
  const before = structuredClone(imported), editor = editorFixture({ document: imported });
  const injector = editor.instance.__getInjector();
  injector.add(dependencies.find(d => d[0]?.name === 'DocMenuStyleService'));
  editor.commands.registerCommand(ui.BreakLineCommand);
  injector.get(core.IUniverInstanceService).focusUnit('doc');
  try {
    const offset = atEnd ? imported.body.paragraphs[6].startIndex : imported.body.paragraphs[5].startIndex + 4;
    assert.equal(await editor.commands.executeCommand(ui.BreakLineCommand.id, { unitId: 'doc', textRange: { startOffset: offset, endOffset: offset, collapsed: true, segmentId: '' } }), true);
    const entered = await editor.handle.commit();
    assert.equal(entered.body.paragraphs.length, 10);
    injector.get(docs.DocStateChangeManagerService).flushPendingChanges('doc');
    assert.equal(await editor.commands.executeCommand(core.UndoCommand.id), true);
    assert.equal((await editor.handle.commit()).body.dataStream, before.body.dataStream);
    assert.equal(await editor.commands.executeCommand(core.RedoCommand.id), true);
    const saved = await editor.handle.commit(), copy = structuredClone(saved);
    assert.equal(saved.body.dataStream, entered.body.dataStream);
    assert.deepEqual(nativeMarkers(saved, editor.instance), ['•', '•', '1.', '2.', '5.', '6.', '7.', '3.'].map((label, i) => [label, atEnd && i === 5 ? '#1B1C1F' : '#000000']));
    validatePdfDocument(saved);
    const mapped = pdfIntermediate(saved);
    if (atEnd) {
      assert.throws(() => trustedCodec({ op: 'export', document: saved }), /Conflicting paragraph-mark/);
    }
    assert.equal(mapped.error, undefined);
    const reopened = trustedCodec({ op: 'import', base64: mapped.base64 }).document;
    assert.deepEqual(nativeMarkers(reopened, editor.instance, true), nativeMarkers(saved, editor.instance, true));
    assert.equal(reopened.body.dataStream, saved.body.dataStream);
    const counts = new Map(), markers = [];
    for (const p of reopened.body.paragraphs) if (p.bullet) {
      const b = p.bullet, level = reopened.lists[b.listType].nestingLevel[0];
      const count = (counts.get(b.listId) ?? level.startNumber) + 1; counts.set(b.listId, count);
      markers.push(level.glyphSymbol ?? `${count}.`);
    }
    assert.deepEqual(markers, ['•', '•', '1.', '2.', '5.', '6.', '7.', '3.']);
    assert.equal(counts.size, 3);
    assert.deepEqual(saved, copy); assert.deepEqual(imported, before);
    assert.deepEqual(trustedCodec({ op: 'import', base64: source }).document.body, before.body);
  } finally { editor.dispose(); }
});
test('saved imported conflict maps before fixture transport download and discloses PDF-only mark semantics', async () => {
  const snapshot = importedSaved(); snapshot.id = 'doc'; const before = structuredClone(snapshot);
  const native = { commit: async () => snapshot, save: () => snapshot, isEditing: () => false, contentEpoch: () => 0 };
  let calls = 0;
  const view = mount(storage(), { api: async (_path, input) => {
    calls++; validatePdfDocument(input.document);
    const mapped = pdfIntermediate(input.document); assert.equal(mapped.error, undefined);
    assert.equal(trustedCodec({ op: 'import', base64: mapped.base64 }).document.body.dataStream, snapshot.body.dataStream);
    return { ...result, warnings: PDF_WARNINGS }; // Transport fixture, not rendered PDF evidence.
  }, editor: () => native, work });
  try {
    await view.click(label); await view.click(label);
    assert.equal(calls, 2); assert.equal(view.downloads.length, 2);
    assert.match(view.text(), /does not retain conflicting paragraph-mark editing metadata/);
    assert.match(view.text(), /Word export still refuses that conflict/);
    assert.match(view.text(), /No exact layout or full Word fidelity/);
    assert.deepEqual(snapshot, before);
  } finally { view.unmount(); }
});
test('PDF intermediate retains genuine native red/green marker typography with blue body and empty continuation', () => {
  const snapshot = contrastNative(), before = structuredClone(snapshot), editor = editorFixture({ document: snapshot });
  try {
    const expected = ['5.', '6.', '7.', '2.', '3.'].map((label, i) => [label, ...([0, 1, 3].includes(i)
      ? [{ rgb: '#FF0000' }, 20, 1, 1, { s: 1 }] : [{ rgb: '#008000' }, 14, 0, 0, { s: 0 }])]);
    assert.deepEqual(nativeMarkers(snapshot, editor.instance, true), expected);
    const mapped = pdfIntermediate(snapshot); assert.equal(mapped.error, undefined);
    const reopened = trustedCodec({ op: 'import', base64: mapped.base64 }).document;
    assert.deepEqual(nativeMarkers(reopened, editor.instance, true), expected);
    assert.deepEqual(snapshot, before);
  } finally { editor.dispose(); }
});
test('PDF consumer dispatches flat lists unchanged, discloses bounds and never saves', async () => {
  const snapshot = listDocument(), before = structuredClone(snapshot), calls = [];
  const native = { commit: async () => snapshot, save: () => snapshot, isEditing: () => false, contentEpoch: () => 0 };
  const view = mount(storage(), { api: async (path, input) => { calls.push({ path, input }); return result; }, editor: () => native, work });
  await view.click(label); assert.equal(view.downloads.length, 1); assert.match(view.text(), /Nested lists/); assert.match(view.text(), /1–32,767, including continuations/); assert.match(view.text(), /1–1,000,000 start bounds/); assert.deepEqual(snapshot, before);
  assert.deepEqual(calls.map(c => c.path), ['/exchange/pdf/export']); assert.deepEqual(calls[0].input.document, before); view.unmount();
});
for (const change of ['none', 'editor', 'navigation', 'revision', 'permission', 'edit', 'undo', 'pending', 'unmount']) test(`PDF consumer held response with ${change}: no stale download, no save, bounded double click`, async () => {
  const conversion = held(), calls = [], snapshot = listDocument(); let epoch = 0, pending = false;
  const native = { commit: async () => structuredClone(snapshot), save: () => structuredClone(snapshot), contentEpoch: () => epoch, isEditing: () => pending }; let current = native;
  const disk = storage(); disk.setItem('unsent-message', 'keep this'); disk.setItem('workagent-draft:doc', 'keep draft');
  const view = mount(disk, { api: async (path, input) => { calls.push({ path, input }); return conversion.promise; }, editor: () => current, work });
  await view.click(label); assert.equal(calls.length, 1); assert.equal(calls[0].path, '/exchange/pdf/export'); assert.deepEqual(calls[0].input.document, snapshot); assert.match(view.text(), /Rendering PDF/);
  if (change === 'editor') current = {};
  if (change === 'navigation') await view.update({ work: { ...work, id: 'other' } });
  if (change === 'revision') await view.update({ work: { ...work, contentRevision: 2 } });
  if (change === 'permission') await view.update({ work: { ...work, expected: { permissionRevision: 2 } } });
  if (change === 'edit') snapshot.title = 'Newer title';
  if (change === 'undo') epoch += 2;
  if (change === 'pending') pending = true;
  if (change === 'unmount') view.unmount();
  conversion.resolve(result); await view.flush(); assert.equal(view.downloads.length, change === 'none' ? 1 : 0);
  assert.equal(disk.getItem('unsent-message'), 'keep this'); assert.equal(disk.getItem('workagent-draft:doc'), 'keep draft');
  if (change === 'none') { assert.equal(view.blobs[0].type, 'application/pdf'); assert.match(view.text(), /without saving/); }
  else if (change !== 'unmount') assert.match(view.text(), /changed/);
  view.unmount();
});
for (const message of ['Native document clipboard input is still finishing.', 'Finish composing the current character.', 'Native document input is still finishing.']) test('PDF pending input refuses before dispatch and releases busy: ' + message, async () => {
  let calls = 0; const native = { commit: async () => { throw new Error(message); } };
  const view = mount(storage(), { api: async () => { calls++; }, editor: () => native, work });
  await view.click(label); await view.click(label); assert.equal(calls, 0); assert.match(view.text(), new RegExp(message)); view.unmount();
});
test('unavailable renderer is visible and the same consumer can retry successfully', async () => {
  let calls = 0; const snapshot = blankDocument('doc'), native = { commit: async () => snapshot, save: () => snapshot, isEditing: () => false, contentEpoch: () => 0 };
  const view = mount(storage(), { api: async () => { if (++calls === 1) throw new Error('pdf_renderer_unavailable'); return result; }, editor: () => native, work });
  await view.click(label); assert.match(view.text(), /Isolated PDF conversion is unavailable/); await view.click(label); assert.equal(calls, 2); assert.equal(view.downloads.length, 1); view.unmount();
});
for (const [error, message] of [['unsupported_pdf_list_number', /PDF supports item numbers 1–32,767, including continued lists/], ['pdf_fonts_unavailable', /Required PDF rendering fonts are unavailable/], ['pdf_missing_glyph', /cannot render some characters/], ['pdf_unsupported_text', /cannot render some characters/], ['unsupported_pdf_list_layout', /cannot map this list layout/], ['pdf_codec_refused', /cannot map this list layout/]]) test(`PDF ${error} is visible, retains edits and allows retry`, async () => {
  let calls = 0; const snapshot = blankDocument('doc', 'Retained', '雪 🌍'), native = { commit: async () => snapshot, save: () => snapshot, isEditing: () => false, contentEpoch: () => 0 };
  const view = mount(storage(), { api: async () => { if (++calls === 1) throw new Error(error); return result; }, editor: () => native, work });
  await view.click(label); assert.match(view.text(), message); assert.equal(view.downloads.length, 0); assert.equal(snapshot.body.dataStream, '雪 🌍\r\n');
  await view.click(label); assert.equal(view.downloads.length, 1); view.unmount();
});
test('actual native list consumer fences composition, exports dirty lists after focus loss, retains epoch checks', async () => {
  const editor = editorFixture({ document: listDocument() }), calls = [], conversion = held();
  const view = mount(storage(), { api: async (path, input) => { calls.push({ path, input }); return conversion.promise; }, editor: () => editor.handle, work });
  try {
    editor.emit('compositionstart'); await view.click(label);
    assert.equal(calls.length, 0); assert.match(view.text(), /composing/);
    editor.emit('compositionend'); editor.title('Unsaved list title');
    const core = createRequire(import.meta.resolve('@univerjs/preset-docs-core'))('@univerjs/core');
    editor.instance.__getInjector().get(core.IUniverInstanceService).focusUnit(null);
    await view.click(label); assert.equal(calls.length, 1);
    assert.equal(calls[0].input.document.title, 'Unsaved list title'); validatePdfDocument(calls[0].input.document);
    assert.deepEqual(calls[0].input.document.body.paragraphs.map(p => p.bullet), listDocument().body.paragraphs.map(p => p.bullet));
    const prior = editor.handle.contentEpoch(); editor.title('Different'); editor.title('Unsaved list title');
    assert.ok(editor.handle.contentEpoch() > prior);
    conversion.resolve(result); await view.flush(); assert.equal(view.downloads.length, 0); assert.match(view.text(), /changed/);
    assert.deepEqual(calls.map(c => c.path), ['/exchange/pdf/export']);
  } finally { conversion.resolve(result); editor.dispose(); view.unmount(); }
});
test('actual native clipboard commit includes unsaved pasted text; native title edit during render refuses', async () => {
  const read = held(), conversion = held(), calls = [];
  const editor = editorFixture({ document: blankDocument('doc', 'Title', 'Before') }, async () => read.promise);
  const view = mount(storage(), { api: async (path, input) => { calls.push(input); return conversion.promise; }, editor: () => editor.handle, work });
  try {
    const paste = editor.clipboard.pasteFromClipboard('text'); await view.click(label); assert.equal(calls.length, 0); assert.match(view.text(), /finishing/);
    read.resolve([{ types: ['text/plain'], getType: async () => ({ text: async () => 'Pasted 雪 🌍 ' }) }]); assert.equal(await paste, true);
    await view.click(label); assert.equal(calls.length, 1); assert.equal(calls[0].document.body.dataStream, 'Pasted 雪 🌍 Before\r\n');
    const checked = validatePdfDocument(calls[0].document);
    const word = trustedCodec({ op: 'export', document: checked });
    assert.equal(trustedCodec({ op: 'import', base64: word.base64 }).document.body.dataStream, checked.body.dataStream);
    editor.title('Changed during render'); conversion.resolve(result); await view.flush(); assert.equal(view.downloads.length, 0); assert.match(view.text(), /changed/);
  } finally { editor.dispose(); view.unmount(); }
});

test('actual refused inner paste releases its fence, preserves later valid paste and permits PDF export', async () => {
  const editor = editorFixture({ document: blankDocument('doc', 'Title', 'Before') }), calls = [];
  const view = mount(storage(), { api: async (path, input) => { calls.push(input); return result; }, editor: () => editor.handle, work });
  try {
    assert.equal(await editor.clipboard.legacyPaste({ text: '\u001a', files: [], mode: 'text' }), false);
    assert.equal(editor.handle.isEditing(), false);
    assert.equal((await editor.handle.commit()).body.dataStream, 'Before\r\n');
    assert.equal(await editor.clipboard.legacyPaste({ text: 'Good ', files: [], mode: 'text' }), true);
    assert.equal(editor.handle.isEditing(), false);
    assert.equal((await editor.handle.commit()).body.dataStream, 'Good Before\r\n');
    await view.click(label); assert.equal(calls.length, 1); assert.equal(view.downloads.length, 1);
    assert.equal(calls[0].document.body.dataStream, 'Good Before\r\n');
  } finally { editor.dispose(); view.unmount(); }
});

test('failed native commands release only their calls; syncOnly, disposal and a fresh editor recover', async () => {
  const editor = editorFixture({ document: blankDocument('doc', 'Title', 'Before') }), gate = held();
  const { commands } = editor;
  commands.registerCommand({ id: 'doc.command.held-test', type: 0, handler: () => gate.promise });
  commands.registerCommand({ id: 'doc.command.failed-test', type: 0, handler: () => { throw Error('command failed'); } });
  commands.registerCommand({ id: 'doc.command.ok-test', type: 0, handler: () => true });
  try {
    const pending = commands.executeCommand('doc.command.held-test', { unitId: 'doc' });
    assert.equal(await editor.clipboard.legacyPaste({ text: '\u001a', files: [], mode: 'text' }), false);
    await assert.rejects(commands.executeCommand('doc.command.failed-test'), /command failed/);
    assert.throws(() => commands.syncExecuteCommand('doc.command.failed-test'), /command failed/);
    assert.equal(editor.handle.isEditing(), true); await assert.rejects(editor.handle.commit(), /input is still finishing/);
    gate.resolve(true); assert.equal(await pending, true); assert.equal(editor.handle.isEditing(), false);
    assert.equal(await commands.executeCommand('doc.command.ok-test', {}, { syncOnly: true }), true);
    assert.equal(commands.syncExecuteCommand('doc.command.ok-test'), true);
    assert.equal(editor.handle.isEditing(), false); await editor.handle.commit();
    const late = held(); commands.registerCommand({ id: 'doc.command.late-test', type: 0, handler: async () => { await late.promise; throw Error('late failure'); } });
    const old = editor.handle, count = editor.edits.length, operation = commands.executeCommand('doc.command.late-test');
    const rejected = assert.rejects(operation, /late failure/);
    editor.dispose(); late.resolve(); await rejected;
    assert.equal(old.isEditing(), false); await assert.rejects(old.commit(), /editor changed/); assert.equal(editor.edits.length, count);
    assert.equal(Object.hasOwn(commands, 'executeCommand'), false); assert.equal(Object.hasOwn(commands, 'syncExecuteCommand'), false);
    const next = editorFixture({ document: blankDocument('next', 'New', 'Retained') });
    try { assert.equal((await next.handle.commit()).body.dataStream, 'Retained\r\n'); } finally { next.dispose(); }
  } finally { gate.resolve(true); editor.dispose(); }
});
