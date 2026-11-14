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
import { spawnSync } from 'node:child_process';
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

import { trustedCodec, docxInput, defaultDocx, nestedDocx } from '../../workagent-server/tests/support/docx-fixture.mjs';
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
  assert.throws(()=>editor.commands.syncExecuteCommand(ui.OrderListCommand.id,{...range(0,17),value:'CHECK_LIST'}),/unsupported_document_list/);
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

for (const type of ['BULLET_LIST','ORDER_LIST','ORDER_LIST_1','ORDER_LIST_2','ORDER_LIST_3','ORDER_LIST_4','ORDER_LIST_5']) test(`installed ${type} levels match descriptor and survive actual indent/outdent/undo and Word`,async()=>{
 const initial=blankDocument('nested','Nested','Alpha 雪 🌍\nBravo\nCharlie\nDelta\nEcho\nFoxtrot\nGolf\nHotel\nIndia\nJuliet\nKilo');
 initial.body.paragraphs.forEach((p,i)=>p.paragraphId='paragraph-'+i);
 const e=editorFixture({document:initial});
 for(const cmd of [ui.ListOperationCommand,ui.ChangeListTypeCommand,ui.OrderListCommand,ui.BulletListCommand,ui.ChangeListNestingLevelCommand]) e.commands.registerCommand(cmd);
 const inj=e.instance.__getInjector(), selection=inj.get(docs.DocSelectionManagerService);
 inj.get(core.IUniverInstanceService).focusUnit('nested');
 const depth=[0,1,2,1,0,1,2,3,4,5,type==='ORDER_LIST_2'?6:8];
 const select=i=>{
  const saved=e.nativeDoc.save(),start=i?saved.body.paragraphs[i-1].startIndex+1:0;
  selection.replaceSelectionInfoWithoutRefresh({...selection.getSelectionInfo(),textRanges:[{startOffset:start+2,endOffset:start+2,collapsed:true,isActive:true,segmentId:''}]});
 };
 const flush=()=>inj.get(docs.DocStateChangeManagerService).flushPendingChanges('nested');
 try {
  assert.equal(e.commands.syncExecuteCommand(ui.ChangeListTypeCommand.id,{listType:type,docRange:[{startOffset:0,endOffset:e.nativeDoc.save().body.dataStream.length-2,collapsed:false,segmentId:''}]}),true);
  e.nativeDoc.getTextRange(0,5).setTextStyle({bl:1,it:1,cl:{rgb:'#224466'}});
  e.nativeDoc.getParagraphs()[1].setStyle({horizontalAlign:2,textStyle:{fs:18}});
  for(let i=0;i<depth.length;i++) for(let n=0;n<depth[i];n++) {select(i);assert.equal(e.commands.syncExecuteCommand(ui.ChangeListNestingLevelCommand.id,{type:1}),true);}
  const before=await e.handle.commit(); validateDocument(before);
  assert.deepEqual(before.body.paragraphs.map(p=>p.bullet.nestingLevel),depth);
  for(const p of before.body.paragraphs) assert.deepEqual(documentContract.documentListDefinition(before,p.bullet).level,core.PRESET_LIST_TYPE[type].nestingLevel[p.bullet.nestingLevel]);
  flush();select(2);assert.equal(e.commands.syncExecuteCommand(ui.ChangeListNestingLevelCommand.id,{type:-1}),true);flush();
  assert.equal((await e.handle.commit()).body.paragraphs[2].bullet.nestingLevel,1);
  assert.equal(await e.commands.executeCommand(core.UndoCommand.id),true);
  assert.deepEqual((await e.handle.commit()).body,before.body);
  // Clearing one selected list paragraph preserves its style and neighbors.
  flush();const a=before.body.paragraphs[0].startIndex+2;
  assert.equal(e.commands.syncExecuteCommand(ui.ListOperationCommand.id,{listType:type,docRange:[{startOffset:a,endOffset:a,collapsed:true,segmentId:''}]}),true);flush();
  const cleared=await e.handle.commit();assert.equal(cleared.body.paragraphs[1].bullet,undefined);assert.deepEqual(cleared.body.paragraphs[1].paragraphStyle,before.body.paragraphs[1].paragraphStyle);
  assert.deepEqual(cleared.body.paragraphs[2],before.body.paragraphs[2]);
  assert.equal(await e.commands.executeCommand(core.UndoCommand.id),true);assert.deepEqual((await e.handle.commit()).body,before.body);
  const after=trustedCodec({op:'import',base64:trustedCodec({op:'export',document:before}).base64}).document;validateDocument(after);
  assert.deepEqual(after.body.paragraphs.map(p=>p.bullet.nestingLevel),depth);
  assert.equal(after.body.dataStream,before.body.dataStream);assert.deepEqual(renderedMarkers(after,e.instance),renderedMarkers(before,e.instance));
  assert.deepEqual(after.body.paragraphs.map(p=>p.startIndex),before.body.paragraphs.map(p=>p.startIndex));
  assert.equal(new Set(after.body.paragraphs.map(p=>p.bullet.listId)).size,1);
  const reopened=native(after);try {
   const saved=reopened.doc.save();validateDocument(saved);
   assert.deepEqual(saved.body.paragraphs,after.body.paragraphs);assert.deepEqual(saved.body.textRuns,after.body.textRuns);assert.equal(saved.body.dataStream,after.body.dataStream);assert.deepEqual(saved.lists,after.lists);
   assert.deepEqual(saved.body.sectionBreaks.map(s=>s.startIndex),after.body.sectionBreaks.map(s=>s.startIndex));
   // Native opening assigns a section identity. It persists on subsequent opens.
   const cold=native(structuredClone(saved));try{assert.deepEqual(cold.doc.save(),saved);}finally{cold.univer.dispose();}
  }finally{reopened.univer.dispose();}
 }finally{e.dispose();}
});

test('nested native mixed families, nonconsecutive IDs, ancestor reset and subtree restarts retain rendered counters',async()=>{
 const data=blankDocument('branches','Branches','Parent\nChild\nLeaf\nChild restart\nLeaf reset\nChild next\nPlain\nOther\nParent next\nChild default\nOther next');
 data.lists={mixed:structuredClone(core.PRESET_LIST_TYPE.ORDER_LIST)};
 data.lists.mixed.nestingLevel[2]=structuredClone(core.PRESET_LIST_TYPE.BULLET_LIST.nestingLevel[2]);
 const levels=[0,1,2,1,2,1,null,0,0,1,0];
 data.body.paragraphs.forEach((p,i)=>{if(levels[i]!==null)p.bullet={listId:[7,10].includes(i)?'other':'main',listType:'mixed',nestingLevel:levels[i]};});
 data.body.paragraphs[0].bullet.startNumber=4;data.body.paragraphs[3].bullet.startNumber=3;
 data.body.paragraphs[7].bullet.startNumber=8;
 const e=editorFixture({document:data});
 try {
  const before=await e.handle.commit(),expected=renderedMarkers(before,e.instance);
  assert.deepEqual(expected.map(m=>m.content),['5.','a.','■','d.','■','e.','9.','6.','a.','10.']);
  const after=trustedCodec({op:'import',base64:trustedCodec({op:'export',document:before}).base64}).document;validateDocument(after);
  assert.deepEqual(renderedMarkers(after,e.instance),expected);
  assert.equal(after.body.paragraphs[0].bullet.listId,after.body.paragraphs[8].bullet.listId);
  assert.equal(after.body.paragraphs[7].bullet.listId,after.body.paragraphs[10].bullet.listId);
  assert.equal(after.body.paragraphs[3].bullet.listId,after.body.paragraphs[0].bullet.listId);
  assert.equal(after.body.paragraphs[3].bullet.startNumber,3);
  assert.notEqual(after.body.paragraphs[7].bullet.listId,after.body.paragraphs[0].bullet.listId);
  assert.equal(after.body.paragraphs[6].bullet,undefined);
  assert.deepEqual(renderedMarkers(trustedCodec({op:'import',base64:trustedCodec({op:'export',document:after}).base64}).document,e.instance),expected);
 }finally{e.dispose();}
});

// Inspect the emitted package independently of the codec's import/counter logic.
function numberingXml(base64) {
 const result=spawnSync(new URL('../../../.local/docx-python/bin/python',import.meta.url).pathname,['-I','-B','-c',`
import base64,io,json,sys,zipfile,xml.etree.ElementTree as ET
q=lambda name:'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'+name
with zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.argv[1]))) as z:
 document=ET.fromstring(z.read('word/document.xml')); numbering=ET.fromstring(z.read('word/numbering.xml'))
 tags=[e.tag for e in numbering]; assert max(i for i,t in enumerate(tags) if t==q('abstractNum')) < min(i for i,t in enumerate(tags) if t==q('num')), 'abstract definitions must precede concrete instances'
 ids=[int(e.get(q('val'))) for e in document.iter(q('numId'))]
 nums={int(e.get(q('numId'))):{int(o.get(q('ilvl'))):int(o.find(q('startOverride')).get(q('val'))) for o in e.findall(q('lvlOverride'))} for e in numbering.findall(q('num'))}
 abstracts={int(n.get(q('numId'))):int(n.find(q('abstractNumId')).get(q('val'))) for n in numbering.findall(q('num'))}
 print(json.dumps({'ids':ids,'abstracts':[abstracts[n] for n in ids],'overrides':[nums[n] for n in dict.fromkeys(ids)]}))
`,base64],{stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:12000,maxBuffer:100000});
 if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
for(const scenario of [
 {name:'partial outdent after explicit leaf restart',depths:[2,1,0,1],restart:5,
  markers:['1.1.6.','1.2.','2.','2.1.'],ids:[0,1,2,2],overrides:[{2:6},{0:1,1:2},{0:2}]},
 {name:'partial outdent without initial restart',depths:[2,1,0,1],
  markers:['1.1.1.','1.2.','2.','2.1.'],ids:[0,1,2,2],overrides:[{},{0:1,1:2},{0:2}]},
 {name:'skipped ancestor within an existing branch',depths:[0,2,1,0,1],
  markers:['1.','1.1.1.','1.2.','2.','2.1.'],ids:[0,0,1,0,0],overrides:[{},{0:1,1:2}]},
 {name:'multiple skipped ancestors and interleaved independent identities',depths:[0,3,2,2,1,1,2,0,0,1,1],other:[2,4,7,9],restartIndex:2,restart:4,
  markers:['1.','1.1.1.1.','1.1.5.','1.1.2.','1.2.','1.2.','1.2.1.','2.','2.','2.1.','2.1.'],
  ids:[0,0,1,2,3,4,4,5,0,5,0],overrides:[{},{2:5},{0:1,1:1,2:2},{0:1,1:2},{0:1,1:2},{0:2}]},
]) test(`nested continuation XML and actual SDK markers: ${scenario.name}`,async()=>{
 const data=blankDocument('partial-outdent','Partial outdent',scenario.depths.map((_,i)=>`Item ${i} 雪`).join('\n'));
 data.body.paragraphs.forEach((p,i)=>{p.bullet={listId:scenario.other?.includes(i)?'other':'main',listType:'ORDER_LIST_2',nestingLevel:scenario.depths[i]};});
 if(scenario.restart!==undefined)data.body.paragraphs[scenario.restartIndex??0].bullet.startNumber=scenario.restart;
 const e=editorFixture({document:data});
 try {
  const before=await e.handle.commit(),unchanged=structuredClone(before);validateDocument(before);
  const markers=renderedMarkers(before,e.instance);assert.deepEqual(markers.map(m=>m.content),scenario.markers);
  const output=trustedCodec({op:'export',document:before});assert.deepEqual(before,unchanged);
  const xml=numberingXml(output.base64),unique=[...new Set(xml.ids)];
  assert.deepEqual(xml.ids.map(id=>unique.indexOf(id)),scenario.ids);
  assert.deepEqual(xml.overrides,scenario.overrides);
  const after=trustedCodec({op:'import',base64:output.base64}).document;validateDocument(after);
  assert.deepEqual(renderedMarkers(after,e.instance),markers);
  assert.equal(after.body.dataStream,before.body.dataStream);
  assert.deepEqual(after.body.paragraphs.map(p=>p.bullet.nestingLevel),scenario.depths);
  assert.deepEqual(after.body.paragraphs.map(p=>p.startIndex),before.body.paragraphs.map(p=>p.startIndex));
  const twice=trustedCodec({op:'import',base64:trustedCodec({op:'export',document:after}).base64}).document;
  assert.deepEqual(renderedMarkers(twice,e.instance),markers);
 }finally{e.dispose();}
});

test('nested malformed native mutations refuse before changing editor or human recovery',async()=>{
 const data=blankDocument('atomic','Atomic','First\nSecond');data.body.paragraphs.forEach(p=>p.bullet={listId:'one',listType:'ORDER_LIST',nestingLevel:1});
 const e=editorFixture({document:data});
 try{
  const before=await e.handle.commit(),edits=e.edits.length;
  for(const change of [p=>p.bullet.nestingLevel=9,p=>p.bullet.nestingLevel=-1,p=>p.bullet.startNumber=-1,p=>p.bullet.listType='absent',p=>p.bullet.listId='__proto__']){
   const paragraph=structuredClone(before.body.paragraphs[0]);change(paragraph);paragraph.startIndex=0;
   const actions=core.JSONX.getInstance().editOp([{t:core.TextXActionType.RETAIN,len:before.body.paragraphs[0].startIndex},{t:core.TextXActionType.RETAIN,len:1,body:{dataStream:'',paragraphs:[paragraph]},coverType:core.UpdateDocsAttributeType.REPLACE}],['body']);
   assert.throws(()=>e.commands.syncExecuteCommand('doc.mutation.rich-text-editing',{unitId:'atomic',actions}));
   assert.deepEqual(await e.handle.commit(),before);assert.equal(e.edits.length,edits);
  }
 }finally{e.dispose();}
});

test('shared-abstract OOXML matches incoming LibreOffice markers before and after Word roundtrip',()=>{
 const imported=trustedCodec({op:'import',base64:nestedDocx()}).document,e=native(imported);
 try {
  const saved=e.doc.save();validateDocument(saved);
  const expected=['3.','b.','3.b.i.','c.','4.','e.','5.','b.','5.b.i.'];
  assert.deepEqual(renderedMarkers(saved,e.univer).map(m=>m.content),expected);
  assert.deepEqual(Object.keys(saved.lists),['word-num-90']);
  assert.ok(saved.body.paragraphs.filter(p=>p.bullet).every(p=>p.bullet.listId==='word-num-90'&&p.bullet.listType==='word-num-90'));
  const output=trustedCodec({op:'export',document:saved}).base64, xml=numberingXml(output);
  assert.equal(new Set(xml.abstracts).size,1);
  assert.deepEqual(xml.overrides,[{}, {0:4,1:5}]);
  const after=trustedCodec({op:'import',base64:output}).document;
  assert.deepEqual(renderedMarkers(after,e.univer),renderedMarkers(saved,e.univer));
 }finally{e.univer.dispose();}
});

for(const scenario of [
 {name:'first-item restart then original instance and repeated visits',items:[[90,0],[90,0],[91,0],[90,0],[91,0],[90,0]],overrides:{0:5},expected:['3.','4.','5.','6.','7.','8.'],xmlStarts:[{},{0:5}]},
 // Source marker oracles: Parent's actual LibreOffice PDFs in
 // .local/shared-counter-render-parent; independent uses the ordered source.
 {name:'nested override continuation and ancestor resets',items:[[90,0],[90,1],[91,1],[90,1],[91,1],[91,0],[91,1],[90,1],[90,0],[91,1],[90,1]],expected:['3.','b.','e.','f.','g.','4.','b.','c.','5.','b.','c.'],xmlStarts:[{},{0:3,1:5}]},
 {name:'incoming composite markers visit skipped ancestors before outdent',items:[[90,2],[90,1],[90,0],[90,1]],overrides:{},expected:['3.b.i.','c.','4.','b.'],xmlStarts:[{},{0:3,1:3},{0:4}]},
 {name:'independent abstracts with equal level definitions stay independent',items:[[90,0],[90,1],[91,0],[91,1],[90,0],[90,1],[91,0],[91,1]],independent:true,expected:['3.','b.','3.','e.','4.','b.','4.','b.'],xmlStarts:[{},{},{0:3,1:5}]},
]) test(`incoming shared numbering semantics: ${scenario.name}`,()=>{
 const {name,expected,xmlStarts,...input}=scenario,source=nestedDocx(input), imported=trustedCodec({op:'import',base64:source}).document,e=native(imported);
 try{
  numberingXml(source); // Independently check generated fixture order too.
  const saved=e.doc.save();validateDocument(saved);
  assert.deepEqual(renderedMarkers(saved,e.univer).map(m=>m.content),expected);
  const output=trustedCodec({op:'export',document:saved}).base64,xml=numberingXml(output);
  assert.equal(new Set(xml.abstracts).size,scenario.independent?2:1);
  assert.deepEqual(xml.overrides,xmlStarts);
  const after=trustedCodec({op:'import',base64:output}).document;validateDocument(after);
  assert.deepEqual(renderedMarkers(after,e.univer),renderedMarkers(saved,e.univer));
  assert.equal(after.body.dataStream,saved.body.dataStream);assert.deepEqual(after.body.textRuns,saved.body.textRuns);
  assert.deepEqual(after.body.paragraphs.map(p=>p.startIndex),saved.body.paragraphs.map(p=>p.startIndex));
 }finally{e.univer.dispose();}
});
