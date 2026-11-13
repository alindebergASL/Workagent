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
    if (name.endsWith('/workagent-contract/document.mjs')) return documentContract;
    if (name === './editor-focus') return { installEditorFocus: () => () => {} }; // No DOM in this harness.
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
  return { instance, nativeDoc, clipboard, commands: instance.__getInjector().get(core.ICommandService), edits, errors, get handle() { return handle; }, title(value) { nodes(tree).find(n => n.props['aria-label'] === 'Document title').props.onChange({ target: { value } }); }, dispose() { cleanup?.(); cleanup = null; } };
}
const held = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

import { trustedCodec, docxInput, defaultDocx } from '../../workagent-server/tests/support/docx-fixture.mjs';
test('actual built-in toolbar commands → shared validation → DOCX → native reopen; unsupported mutation is atomic', async () => {
 const editor=editorFixture({ document: blankDocument('doc','Lists','First 雪 🌍\nSecond\nPlain\nRestart\nBullet') });
 for(const c of [ui.ListOperationCommand,ui.ChangeListTypeCommand,ui.OrderListCommand,ui.BulletListCommand]) editor.commands.registerCommand(c);
 const range=(a,b)=>({docRange:[{startOffset:a,endOffset:b,segmentId:'',collapsed:false}]});
 try {
  assert.equal(editor.commands.syncExecuteCommand(ui.OrderListCommand.id,range(0,17)),true);
  assert.equal(editor.commands.syncExecuteCommand(ui.OrderListCommand.id,range(24,31)),true);
  assert.equal(editor.commands.syncExecuteCommand(ui.BulletListCommand.id,range(32,38)),true);
  const saved=await editor.handle.commit(); validateDocument(saved);
  const before=JSON.stringify(saved);
  assert.throws(()=>editor.commands.syncExecuteCommand(ui.OrderListCommand.id,{...range(0,17),value:'ORDER_LIST_3'}),/unsupported_document_list/);
  assert.equal(JSON.stringify(await editor.handle.commit()),before); assert.equal(editor.handle.isEditing(),false);
  const output=trustedCodec({op:'export',document:saved}), imported=trustedCodec({op:'import',base64:output.base64}).document;
  validateDocument(imported); assert.equal(imported.body.dataStream,saved.body.dataStream);
  const p=imported.body.paragraphs; assert.equal(p[0].bullet.listId,p[1].bullet.listId); assert.equal(p[2].bullet,undefined);
  assert.equal(p[0].bullet.listId === p[3].bullet.listId, saved.body.paragraphs[0].bullet.listId === saved.body.paragraphs[3].bullet.listId); // Preserve the SDK's actual continuation choice.
  const reopened=native(imported);
  try { validateDocument(reopened.doc.save()); assert.deepEqual(reopened.doc.save().lists,imported.lists); assert.deepEqual(reopened.doc.save().body.paragraphs,imported.body.paragraphs); }
  finally { reopened.univer.dispose(); }
 } finally { editor.dispose(); }
});
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

function renderedMarkers(data, instance) {
 const er=require('@univerjs/engine-render');
 const skeleton=er.DocumentSkeleton.create(new er.DocumentViewModel(new core.DocumentDataModel(structuredClone(data))),instance.__getInjector().get(core.LocaleService));
 try {
  skeleton.calculate(); const found=[],seen=new Set();
  function walk(v) { if(!v||typeof v!=='object'||seen.has(v))return; seen.add(v);
   if(v.glyphType===2&&v.content) found.push({content:v.content,bl:v.ts.bl??0,it:v.ts.it??0,ul:v.ts.ul?.s??0,fs:v.ts.fs??core.DEFAULT_STYLES.fs,cl:v.ts.cl??core.DEFAULT_STYLES.cl});
   if(v instanceof Map)for(const x of v.values())walk(x); else for(const [k,x]of Object.entries(v))if(k!=='parent')walk(x);
  }
  walk(skeleton.getSkeletonData());return found;
 } finally {skeleton.dispose();}
}
for(const [label,start,end,expected,tailRestart] of [['start',0,0,['5.','6.','7.']],['middle',1,1,['5.','6.','7.']],['end',3,3,['5.','6.','7.']],['selection',1,2,['5.','6.','7.']],['cross paragraph',1,5,['5.','6.']],['cross independent restart',1,5,['5.','10.'],9],['cross equal independent restart',1,5,['5.','5.'],4]]) {
 test(`real Enter ${label} preserves restart, rendered continuation, undo/redo and later edits`,async()=>{
  const data=blankDocument('restart','Restart','One\nTwo'); data.body.paragraphs.forEach(p=>p.bullet={listId:'same',listType:'ORDER_LIST',nestingLevel:0});data.body.paragraphs[0].bullet.startNumber=4; if(tailRestart!==undefined)data.body.paragraphs[1].bullet.startNumber=tailRestart;
  const e=editorFixture({document:data}),inj=e.instance.__getInjector();
  inj.add(dependencies.find(d=>d[0]?.name==='DocMenuStyleService'));e.commands.registerCommand(ui.BreakLineCommand);inj.get(core.IUniverInstanceService).focusUnit(data.id);
  const markers=async()=>renderedMarkers(await e.handle.commit(),e.instance).map(m=>m.content); const initial=['5.',tailRestart===undefined?'6.':`${tailRestart+1}.`];
  try {
   assert.deepEqual(await markers(),initial);
   const before=await e.handle.commit(),epoch=e.handle.contentEpoch(),selectionEpoch=e.handle.selectionEpoch();
   const pending=e.commands.executeCommand(ui.BreakLineCommand.id,{unitId:data.id,textRange:{startOffset:start,endOffset:end,collapsed:start===end,segmentId:''}});
   assert.equal(e.handle.isEditing(),true);await assert.rejects(e.handle.commit(),/input is still finishing/);
   assert.equal(await pending,true);
   const selection=inj.get(docs.DocSelectionManagerService).getTextRanges({unitId:data.id,subUnitId:data.id});
   assert.deepEqual(selection.map(r=>[r.startOffset,r.endOffset]),[[start+1,start+1]]);
   assert.ok(e.handle.selectionEpoch()>selectionEpoch);
   assert.deepEqual(await markers(),expected);assert.equal(e.handle.isEditing(),false);assert.ok(e.handle.contentEpoch()>epoch);
   assert.equal((await e.handle.commit()).body.dataStream,before.body.dataStream.slice(0,start)+'\r'+before.body.dataStream.slice(end));
   inj.get(docs.DocStateChangeManagerService).flushPendingChanges(data.id);
   assert.equal(await e.commands.executeCommand(core.UndoCommand.id),true); assert.deepEqual(await markers(),initial);
   assert.equal((await e.handle.commit()).body.dataStream,before.body.dataStream);
   assert.equal(await e.commands.executeCommand(core.RedoCommand.id),true);assert.deepEqual(await markers(),expected);
   assert.equal(e.nativeDoc.insertText(start+1,'Edited '),true); assert.deepEqual(await markers(),expected); validateDocument(await e.handle.commit());
  }finally{e.dispose();}
 });
}
for(const kind of ['OrderListCommand','BulletListCommand']) for(const mixed of [false,true]) test(`real ${kind} marker formatting survives DOCX with ${mixed?'mixed shared sequence':'uniform styles'}`,async()=>{
 const e=editorFixture({document:blankDocument('styled','Style','First\nSecond\nThird')});
 for(const c of [ui.ListOperationCommand,ui[kind]])e.commands.registerCommand(c);
 try {
  assert.equal(e.commands.syncExecuteCommand(ui[kind].id,{docRange:[{startOffset:0,endOffset:18,collapsed:false,segmentId:''}]}),true);
  e.nativeDoc.getTextRange(0,mixed?5:18).setTextStyle({bl:1,it:1,ul:{s:1},fs:24,cl:{rgb:'#FF0000'}});
  if(mixed)e.nativeDoc.getTextRange(6,12).setTextStyle({bl:0,it:1,ul:{s:0},fs:16,cl:{rgb:'#224466'}});
  const before=await e.handle.commit(), expected=renderedMarkers(before,e.instance);assert.equal(expected[0].bl,1);assert.equal(expected[0].ul,1);assert.equal(expected[1].bl,mixed?0:1);
  const out=trustedCodec({op:'export',document:before}), after=trustedCodec({op:'import',base64:out.base64}).document;validateDocument(after);
  assert.deepEqual(renderedMarkers(after,e.instance),expected); assert.equal(after.body.dataStream,before.body.dataStream);
  assert.equal(new Set(after.body.paragraphs.map(p=>p.bullet.listId)).size,1);
  assert.deepEqual(renderedMarkers(trustedCodec({op:'import',base64:trustedCodec({op:'export',document:after}).base64}).document,e.instance),expected);
 }finally{e.dispose();}
});

test('native marker paragraph, empty-mark, bullet and template precedence roundtrips',async()=>{
 const data=blankDocument('layers','Layers','First\n\nThird');
 data.documentStyle.textStyle={bl:1,it:1,fs:20,cl:{rgb:'#123456'}};
 data.lists={custom:structuredClone(core.PRESET_LIST_TYPE.ORDER_LIST)};
 data.lists.custom.nestingLevel[0].textStyle={it:0};
 data.body.paragraphs.forEach((p,i)=>{p.bullet={listId:'shared',listType:'custom',nestingLevel:0,textStyle:{ul:{s:1}}};p.paragraphStyle={textStyle:{fs:18},...(i===1?{paragraphMarkTextStyle:{bl:0,fs:16}}:{})};});
 data.body.paragraphs[2].bullet.startNumber=8;
 const e=editorFixture({document:data});
 try {
  const before=await e.handle.commit(),expected=renderedMarkers(before,e.instance);
  assert.deepEqual(expected.map(m=>[m.content,m.bl,m.it,m.ul,m.fs]),[['1.',1,0,1,18],['2.',0,0,1,16],['9.',1,0,1,18]]);
  const after=trustedCodec({op:'import',base64:trustedCodec({op:'export',document:before}).base64}).document;
  assert.deepEqual(renderedMarkers(after,e.instance),expected);
 }finally{e.dispose();}
});
