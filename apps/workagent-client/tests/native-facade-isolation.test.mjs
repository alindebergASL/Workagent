// Real installed SDK factories and production imports; no DOM, session or transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { Univer, LocaleType } = require('@univerjs/core');
const { FUniver } = require('@univerjs/core/facade');
require('@univerjs/docs/facade'); require('@univerjs/sheets/facade');
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = {exports:{}}; modules.set(file,module);
  const code = ts.transpileModule(readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',code)(name=>{
    if (name.endsWith('.css')) return {};
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(file),name), local = [base,base+'.ts',base+'.tsx'].find(existsSync);
    assert.ok(local, name); return load(local);
  },module,module.exports);
  return module.exports;
}
function ordinary() {
  const doc = new Univer({locale:LocaleType.EN_US,locales:{enUS:{}}});
  const sheet = new Univer({locale:LocaleType.EN_US,locales:{enUS:{}}});
  try {
    doc.registerPlugin(require('@univerjs/engine-render').UniverRenderEnginePlugin);
    doc.registerPlugin(require('@univerjs/docs').UniverDocsPlugin);
    sheet.registerPlugin(require('@univerjs/engine-render').UniverRenderEnginePlugin);
    sheet.registerPlugin(require('@univerjs/sheets').UniverSheetsPlugin);
    const d = FUniver.newAPI(doc).createDocument({id:'ordinary-doc',body:{dataStream:'Text\r\n',paragraphs:[{startIndex:4}]}});
    const s = FUniver.newAPI(sheet).createWorkbook({id:'ordinary-sheet',sheetOrder:['s'],sheets:{s:{id:'s',name:'Sheet',rowCount:10,columnCount:10,cellData:{}}}});
    assert.equal(d.insertText(0,'Human '),true); assert.match(d.save().body.dataStream,/Human Text/);
    s.getActiveSheet().getRange('A1').setValue(17); assert.equal(s.save().sheets.s.cellData[0][0].v,17);
    const {CollaborationController} = require('@univerjs-pro/collaboration-client');
    assert.equal(doc.__getInjector().has(CollaborationController),false);
    assert.equal(sheet.__getInjector().has(CollaborationController),false);
  } finally {doc.dispose();sheet.dispose();}
}
test('ordinary document and sheet factories edit before and after the production native module loads',()=>{
  ordinary();
  const component = load(resolve('apps/workagent-client/src/NativeCollaborationEditor.tsx'));
  assert.equal(typeof component.NativeCollaborationEditor,'function');
  ordinary(); ordinary();
});

test('scoped native public-service wiring preserves load/readiness, status, pending work and exact recovery events',async()=>{
  const {Injector,UniverInstanceType}=require('@univerjs/core');
  const {CollaborationController,DataLoaderService,CollaborationStatus}=require('@univerjs-pro/collaboration-client');
  const {Subject,BehaviorSubject}=require('rxjs');
  const {nativeCollaborationClient}=load(resolve('apps/workagent-client/src/native-collaboration-client.ts'));
  const entities=new Subject(), status=new BehaviorSubject(CollaborationStatus.OFFLINE), resend=new Subject(), conflict=new Subject();
  let pending=true, current=null, release, released=false;
  const calls=[], model={nativeModel:true}, ready=new Promise(r=>{release=r;});
  const entity={state:{status:CollaborationStatus.OFFLINE},status$:status,changesetResend$:resend,conflict$:conflict};
  const controller={getCollabEntity(id){assert.equal(id,'A');return current;},getCollabEntity$(id){assert.equal(id,'A');return entities;},hasWritePending(id){assert.equal(id,'A');return pending;},readyForCollab(id){calls.push(['ready',id]);return ready;}};
  const loader={async loadUnit(...args){calls.push(['load',...args]);return model;}};
  const injector=new Injector([[CollaborationController,{useValue:controller}],[DataLoaderService,{useValue:loader}]]);
  try {
    const client=nativeCollaborationClient(injector,'A'), seen=[];
    const observation=client.subscribe({status:()=>seen.push(['status',client.getCollaborationStatus()]),resend:e=>seen.push(['resend',e]),conflict:e=>seen.push(['conflict',e])});
    assert.equal(client.getCollaborationStatus(),CollaborationStatus.NOT_COLLAB);
    const loading=client.loadSheetAsync().then(v=>{released=true;return v;});await new Promise(setImmediate);
    assert.deepEqual(calls,[['load','A',UniverInstanceType.UNIVER_SHEET],['ready','A']]);assert.equal(released,false);
    current=entity;entities.next(entity);assert.equal(client.hasWritePending(),true);
    const retry={reqId:7,reason:'reconnect'}, recovery={unitID:'A',reason:'permission_rejected',localChanges:{awaitingChangeset:{sid:'unchanged',reqId:7}}};
    resend.next(retry);conflict.next(recovery);assert.equal(seen.at(-2)[1],retry);assert.equal(seen.at(-1)[1],recovery);
    entity.state.status=CollaborationStatus.SYNCED;pending=false;status.next(CollaborationStatus.SYNCED);
    assert.equal(client.hasWritePending(),false);assert.equal(client.getCollaborationStatus(),CollaborationStatus.SYNCED);
    release();assert.equal(await loading,model);
    observation.dispose();assert.equal(entities.observers.length+status.observers.length+resend.observers.length+conflict.observers.length,0);
    ordinary(); // Native service setup must not change a later ordinary factory.
    calls.length=0;loader.loadUnit=async()=>null;assert.equal(await client.loadSheetAsync(),null);assert.deepEqual(calls,[]);
    const failure=new Error('native cache load failed');loader.loadUnit=async()=>{throw failure;};await assert.rejects(client.loadSheetAsync(),e=>e===failure);
  }finally{injector.dispose();entities.complete();status.complete();resend.complete();conflict.complete();}
});
