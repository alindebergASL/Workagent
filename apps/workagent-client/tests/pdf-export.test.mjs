// Actual TSX consumer and installed native SDK, with explicit hook/transport fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { validatePdfDocument } from '../../workagent-server/src/pdf-exchange.mjs';
import { trustedCodec } from '../../workagent-server/tests/support/docx-fixture.mjs';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
function fixture(file, boundary, names, edit = s => s) {
  const url = new URL(file, import.meta.url);
  let source = edit(readFileSync(url, 'utf8').split(boundary)[0]).replaceAll('import.meta.url', JSON.stringify(url.href));
  source = source.replaceAll("import.meta.resolve('@univerjs/preset-docs-core')", JSON.stringify(import.meta.resolve('@univerjs/preset-docs-core')));
  source += `\nmodule.exports = {${names}};`;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('require', 'module', 'exports', code)(createRequire(url), module, module.exports); return module.exports;
}
const { mount, storage } = fixture('./docx-exchange.test.mjs', 'for (const newerPending', 'mount,storage', s => s.replace('const require = createRequire(import.meta.url);', '').replaceAll('../src/DocxExchange.tsx', '../src/PdfExport.tsx').replaceAll('module.exports.DocxExchange(props)', 'module.exports.PdfExport(props)').replace('button.props.onClick(); await flush();', 'button.props.onClick(); button.props.onClick(); await flush();'));
const { editorFixture } = fixture('./docx-native.test.mjs', 'import { trustedCodec', 'editorFixture', s => s.replace("const require = createRequire(import.meta.resolve('@univerjs/preset-docs-core'));", "require = createRequire(import.meta.resolve('@univerjs/preset-docs-core'));"));
const held = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
const result = { base64: Buffer.from('%PDF-1.7\nfixture\n%%EOF\n').toString('base64'), filename: 'Current.pdf', warnings: ['Fonts may differ'] };
const work = { id: 'doc', kind: 'document', contentRevision: 1, expected: { permissionRevision: 1 } };
const label = 'Export document PDF (.pdf)';
test('PDF consumer discloses list refusal before dispatch or download and preserves native offsets', async () => {
  const snapshot = blankDocument('doc', 'Lists', 'First\nSecond');
  snapshot.body.paragraphs.forEach(p => p.bullet = { listType: 'ORDER_LIST', listId: 'list', nestingLevel: 0 });
  const before = structuredClone(snapshot), native = { commit: async () => snapshot, contentEpoch: () => 0 };
  const view = mount(storage(), { api: async () => assert.fail('list PDF must not dispatch'), editor: () => native, work });
  await view.click(label); assert.equal(view.downloads.length, 0); assert.match(view.text(), /Use Word export/); assert.deepEqual(snapshot, before); view.unmount();
});
for (const change of ['none', 'editor', 'revision', 'permission', 'edit', 'undo', 'pending', 'unmount']) test(`PDF consumer held response with ${change}: no stale download, no save, bounded double click`, async () => {
  const conversion = held(), calls = [], snapshot = blankDocument('doc', 'Unsaved', '<script> & 雪 🌍'); let epoch = 0, pending = false;
  const native = { commit: async () => structuredClone(snapshot), save: () => structuredClone(snapshot), contentEpoch: () => epoch, isEditing: () => pending }; let current = native;
  const disk = storage(); disk.setItem('unsent-message', 'keep this'); disk.setItem('workagent-draft:doc', 'keep draft');
  const view = mount(disk, { api: async (path, input) => { calls.push({ path, input }); return conversion.promise; }, editor: () => current, work });
  await view.click(label); assert.equal(calls.length, 1); assert.equal(calls[0].path, '/exchange/pdf/export'); assert.deepEqual(calls[0].input.document, snapshot); assert.match(view.text(), /Rendering PDF/);
  if (change === 'editor') current = {};
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
for (const [error, message] of [['pdf_fonts_unavailable', /Required PDF rendering fonts are unavailable/], ['pdf_missing_glyph', /cannot render some characters/], ['pdf_unsupported_text', /cannot render some characters/]]) test(`PDF ${error} is visible, retains edits and allows retry`, async () => {
  let calls = 0; const snapshot = blankDocument('doc', 'Retained', '雪 🌍'), native = { commit: async () => snapshot, save: () => snapshot, isEditing: () => false, contentEpoch: () => 0 };
  const view = mount(storage(), { api: async () => { if (++calls === 1) throw new Error(error); return result; }, editor: () => native, work });
  await view.click(label); assert.match(view.text(), message); assert.equal(view.downloads.length, 0); assert.equal(snapshot.body.dataStream, '雪 🌍\r\n');
  await view.click(label); assert.equal(view.downloads.length, 1); view.unmount();
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
