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
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
// Actual DocumentEditor consumer with hook/container fixtures and installed native
// commands. The DOM and preset rendering remain Parent's browser qualification.
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
  const element = { addEventListener() {}, removeEventListener() {} };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/DocumentEditor.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
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
  return { clipboard, commands: instance.__getInjector().get(core.ICommandService), edits, errors, get handle() { return handle; }, title(value) { nodes(tree).find(n => n.props['aria-label'] === 'Document title').props.onChange({ target: { value } }); }, dispose() { cleanup?.(); cleanup = null; } };
}
const held = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

import { trustedCodec, docxInput, defaultDocx } from '../../workagent-server/tests/support/docx-fixture.mjs';
test('all enabled paragraph/character defaults retain supported formatting through actual native save and DOCX export',()=>{
 for(const which of ['paragraph','character']) for(const flag of ['1','true','on']) {
  const imported=trustedCodec({op:'import',base64:defaultDocx(which,flag)}).document; validateDocument(imported);
  const editor=native(imported);
  try {
   const saved=structuredClone(editor.doc.save()); validateDocument(saved);
   const expected={bl:1,it:1,ul:{s:1},fs:17,cl:{rgb:'#224466'}};
   assert.deepEqual(saved.body.textRuns[0].ts,expected,`${which} ${flag}`);
   const exported=trustedCodec({op:'export',document:saved});
   assert.deepEqual(trustedCodec({op:'import',base64:exported.base64}).document.body.textRuns[0].ts,expected);
  } finally {editor.univer.dispose();}
 }
});
test('independent DOCX fixture → actual Univer edit/commit → real DOCX → actual Univer reimport', async()=>{
 const original=trustedCodec({op:'import',base64:docxInput().base64}).document; original.id='word-native'; original.title='Native Word'; validateDocument(original);
 const first=native(original); let edited;
 try { assert.equal(first.doc.insertText(0,'Edited '),true); assert.equal(first.doc.getTextRange(0,6).setTextStyle({bl:1,it:1,fs:18,cl:{rgb:'#224466'}}),true); edited=structuredClone(first.doc.save()); validateDocument(edited); }
 finally { first.univer.dispose(); }
 const copy=structuredClone(edited), bytes=trustedCodec({op:'export',document:edited}).base64, imported=trustedCodec({op:'import',base64:bytes}).document; validateDocument(imported); assert.deepEqual(edited,copy);
 const second=native(imported);
 try { const saved=second.doc.save(); validateDocument(saved); assert.equal(documentText(saved),documentText(edited)); assert.equal(saved.body.textRuns[0].ts.bl,1); assert.equal(saved.body.textRuns[0].ts.fs,18); }
 finally { second.univer.dispose(); }
});
test('actual DocxExchange + live DocumentEditor refuse delayed native clipboard then export its committed paste',async()=>{
 const exchange=consumerFixture('./docx-exchange.test.mjs','mount,storage'), gate=held(), read=held(), calls=[];
 const editor=editorFixture({document:blankDocument('old','Title','Before')},async()=>read.promise);
 const view=exchange.mount(exchange.storage(),{api:async(path,input)=>{assert.equal(path,'/exchange/docx/export');calls.push(input);return {...trustedCodec({op:'export',document:input.document}),filename:'Current.docx'};},editor:()=>editor.handle,work:{id:'old',kind:'document'},onImported:async()=>{},onOpen:async()=>{}});
 try {
  const paste=editor.clipboard.pasteFromClipboard('text');assert.equal(editor.handle.isEditing(),true);
  await view.click('Export document Word (.docx)');assert.equal(calls.length,0);assert.equal(view.downloads.length,0);assert.match(view.text(),/finishing/);
  read.resolve([{types:['text/plain'],getType:async()=>({text:()=>gate.promise})}]);gate.resolve('Pasted ');assert.equal(await paste,true);
  await view.click('Export document Word (.docx)');assert.equal(calls.length,1);assert.equal(calls[0].document.body.dataStream,'Pasted Before\r\n');
  const base64=Buffer.from(await view.blobs[0].arrayBuffer()).toString('base64');assert.equal(trustedCodec({op:'import',base64}).document.body.dataStream,'Pasted Before\r\n');
 } finally {editor.dispose();view.unmount();}
});
