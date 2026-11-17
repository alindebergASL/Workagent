import {NativeHistory} from '../src/native-history.mjs';
// Actual SDK service and public adapter with in-memory stores, not durability.
import test from 'node:test';import assert from 'node:assert/strict';
import {fixture as serviceFixture} from './native-merge-pipeline.test.mjs';
import {fixture as clientFixture} from './native-comments-sdk.test.mjs';
import {addSheet} from './native-worksheets-sdk.test.mjs';
import {NativeMerge} from '../src/native-merge.mjs';
import {INSERT_SHEET,RENAME_SHEET,SHEET_VALUES} from '../src/native-worksheets.mjs';
import {NATIVE_UNIT as UNIT} from '../src/native-collaboration.mjs';
const requests=new WeakMap();
const submit=(f,batch,principal='owner',baseRev=f.head)=>{const req=(requests.get(f)??0)+1;requests.set(f,req);return f.service.submitChangeset({changeset:{unitID:UNIT,type:2,baseRev,revision:baseRev+1,userID:principal,memberID:principal==='owner'?'m':'p',sid:'worksheets-'+principal,reqId:req,mutations:batch.map(([id,p])=>({id,data:JSON.stringify({unitId:UNIT,...(id===INSERT_SHEET?{}:{subUnitId:'sheet-1'}),...p})}))}},{userID:principal,memberID:principal==='owner'?'m':'p'});};
const data=f=>new NativeMerge(f.authority,f.service).prepare('owner',UNIT,f.session).then(x=>x.data);
async function addition(f){const c=clientFixture(await data(f));try{return (await addSheet(c)).map(m=>[m.id,m.params]);}finally{c.dispose();}}
test('blank native worksheet add/rename, independent values and historical names; unsupported imports and raw targets refused',async()=>{
 const f=await serviceFixture();const permissions=[];f.service.use('commitChangeset',async(c,next)=>{permissions.push(c.requiredUnitPermissions);await next();});try{
  const batch=await addition(f),sid=batch[0][1].sheet.id;assert.equal((await submit(f,batch)).status,'committed');
  const oldName=batch[0][1].sheet.name;assert.equal((await submit(f,[[RENAME_SHEET,{subUnitId:sid,name:'Second',oldName}]])).status,'committed');
  f.authority.sessions.set('p',{userID:'peer',unitID:UNIT,revision:1,binding:'binding'});
  assert.equal((await submit(f,[[SHEET_VALUES,{cellValue:{0:{0:{v:11}}}}]])).status,'committed');
  assert.equal((await submit(f,[[SHEET_VALUES,{subUnitId:sid,cellValue:{0:{0:{v:22,t:2,f:null,si:null,s:'0',ft:null,fd:null}}},styleRefMap:{'0':{cl:{rgb:'#1B1C1F'}}}}]],'peer')).status,'committed');
  const current=await data(f);assert.equal(current.sheets[sid].name,'Second');assert.equal(current.sheets[sid].cellData[0][0].v,22);assert.equal(current.sheets['sheet-1'].cellData[0][0].v,11);
  const loaded=clientFixture(current);try{assert.equal(loaded.save().sheets[sid].cellData[0][0].v,22);}finally{loaded.dispose();}
  let preview;await new NativeHistory(f.authority,f.service,f.db).read('owner',UNIT,f.session,new URLSearchParams({revision:String(f.head)}),x=>preview=x);assert.deepEqual(preview.sheets.map(x=>x.name),['Sheet 1','Second']);assert.equal(preview.sheets[1].cells[0].value,'22');
  const historical=await new NativeMerge(f.authority,f.service).prepare('owner',UNIT,f.session,2);assert.equal(historical.data.sheets[sid].name,oldName);
  const head=f.head,base=await addition(f);
  for(const b of [batch,[[INSERT_SHEET,{...base[0][1],sheet:{...base[0][1].sheet,cellData:{0:{0:{v:'import'}}}}}]],[[RENAME_SHEET,{subUnitId:sid,oldName:'Second',name:'Sheet 1'}]],[[SHEET_VALUES,{subUnitId:'foreign',cellValue:{0:{0:{v:9}}}}]],[[SHEET_VALUES,{subUnitId:sid,cellValue:{0:{0:{f:'=1'}}}}]],[[SHEET_VALUES,{subUnitId:sid,cellValue:{1000:{0:{v:9}}}}]], [['sheet.mutation.remove-sheet',{subUnitId:sid}]], [['sheet.mutation.insert-row',{subUnitId:sid,range:{startRow:0,endRow:0,startColumn:0,endColumn:19}}]]])assert.equal((await submit(f,b)).status,'rejected');
  assert.equal(f.head,head);const resolve=d=>{const sheets=structuredClone(d.sheets);for(const sheet of Object.values(sheets))for(const row of Object.values(sheet.cellData??{}))for(const cell of Object.values(row))if(typeof cell.s==='string')cell.s=d.styles[cell.s];return sheets;};assert.deepEqual(resolve(await data(f)),resolve(current));console.log('worksheet permission evidence',JSON.stringify(permissions));
 }finally{await f.service.dispose();}
});
test('worksheet admission then concurrent rename/head or reader downgrade refuses at actual commit',async()=>{
 for(const race of ['head','reader']){const f=await serviceFixture();let release,reached;const gate=new Promise(r=>release=r),ready=new Promise(r=>reached=r);let held=false;try{
  f.authority.sessions.set('p',{userID:'peer',unitID:UNIT,revision:1,binding:'binding'});const batch=await addition(f);
  f.service.use('submitChangeset',async(c,next)=>{if(c.memberID==='p'&&!held){held=true;reached();await gate;}await next();});
  const pending=submit(f,batch,'peer');await Promise.race([ready,pending.then(result=>{throw new Error('submission refused before interleaving: '+JSON.stringify(result));})]);
  if(race==='reader')await f.workspace.share('owner',UNIT,{commandId:'read',peer:'peer',role:'read',accessRevision:1});else assert.equal((await submit(f,[[SHEET_VALUES,{cellValue:{0:{0:{v:99}}}}]])).status,'committed');
  const head=f.head;release();assert.equal((await pending).status,'rejected');assert.equal(f.head,head);if(race==='reader')f.session.revision=2;assert.deepEqual((await data(f)).sheetOrder,['sheet-1']);
 }finally{release?.();await f.service.dispose();}}
});

const scalar=(sheet,row,col,v)=>[SHEET_VALUES,{subUnitId:sheet,cellValue:{[row]:{[col]:{v}}}}];
async function secondSheet(f){const batch=await addition(f);assert.equal((await submit(f,batch)).status,'committed');f.authority.sessions.set('p',{userID:'peer',unitID:UNIT,revision:1,binding:'binding'});return batch[0][1].sheet.id;}
test('stale extra-sheet scalar and mixed scalar batches use native OT after unrelated first/extra-sheet edits',async()=>{
 const f=await serviceFixture();try{
  const sid=await secondSheet(f),base=f.head;
  assert.equal((await submit(f,[scalar('sheet-1',0,0,11)])).status,'committed');
  assert.equal((await submit(f,[scalar(sid,0,1,33)])).status,'committed');
  const before=f.head,result=await submit(f,[scalar(sid,0,0,22),scalar('sheet-1',0,1,44)],'peer',base);
  assert.equal(result.status,'committed',JSON.stringify(result));assert.equal(result.changeset.baseRev,before);assert.equal(result.changeset.revision,before+1);
  const current=await data(f);assert.equal(current.sheets[sid].cellData[0][0].v,22);assert.equal(current.sheets[sid].cellData[0][1].v,33);assert.equal(current.sheets['sheet-1'].cellData[0][0].v,11);assert.equal(current.sheets['sheet-1'].cellData[0][1].v,44);
 }finally{await f.service.dispose();}
});
test('historical scalar admission cannot acquire a later sheet or bypass malformed bounds; structural batches stay latest-only',async()=>{
 const f=await serviceFixture();try{
  const sid=await secondSheet(f),base=f.head,name=(await data(f)).sheets[sid].name;
  const next=await addition(f);assert.equal((await submit(f,[scalar('sheet-1',0,0,11)])).status,'committed');const head=f.head,before=await data(f);
  const refused=[
   [[scalar(sid,0,0,22)],1], // Sheet did not exist at the requested native base.
   [[scalar('missing',0,0,22)],base],[[scalar(sid,1000,0,22)],base],[[scalar(sid,-1,0,22)],base],
   [[[SHEET_VALUES,{subUnitId:sid,cellValue:{0:{0:{f:'=1'}}}}]],base],
   [next,base],[[[RENAME_SHEET,{subUnitId:sid,name:'Renamed',oldName:name}]],base],
   [[...next,scalar(sid,0,0,22)],head],[[[RENAME_SHEET,{subUnitId:sid,name:'Renamed',oldName:name}],scalar(sid,0,0,22)],head]
  ];
  for(const [batch,revision]of refused){const out=await submit(f,batch,'peer',revision);assert.equal(out.status,'rejected',JSON.stringify({batch,revision,out}));assert.equal(out.error.retryable,false);assert.equal(f.head,head);assert.deepEqual((await data(f)).sheets,before.sheets);}
 }finally{await f.service.dispose();}
});
test('extra-sheet scalar admitted before concurrent edit revalidates transformed commit; revoked epoch still rejects atomically',async()=>{
 for(const race of ['first-sheet','extra-sheet','reader']){
  const f=await serviceFixture();let release,reached;const gate=new Promise(r=>release=r),ready=new Promise(r=>reached=r);let held=false;
  try{
   const sid=await secondSheet(f),base=f.head;
   f.service.use('submitChangeset',async(c,next)=>{if(c.memberID==='p'&&!held){held=true;reached();await gate;}await next();});
   const pending=submit(f,[scalar(sid,0,0,22)],'peer',base);
   await Promise.race([ready,pending.then(result=>{throw new Error('refused before admission gate '+JSON.stringify(result));})]);
   if(race==='reader'){await f.workspace.share('owner',UNIT,{commandId:'scalar-read',peer:'peer',role:'read',accessRevision:1});f.session.revision=2;}
   else assert.equal((await submit(f,[scalar(race==='first-sheet'?'sheet-1':sid,0,1,33)])).status,'committed');
   const head=f.head,before=await data(f);release();const result=await pending;
   assert.equal(result.status,race==='reader'?'rejected':'committed',JSON.stringify(result));assert.equal(f.head,head+(race==='reader'?0:1));
   const after=await data(f);if(race==='reader')assert.deepEqual(after.sheets,before.sheets);else {assert.equal(after.sheets[sid].cellData[0][0].v,22);assert.equal(after.sheets[race==='first-sheet'?'sheet-1':sid].cellData[0][1].v,33);assert.equal(result.changeset.baseRev,head);}
  }finally{release?.();await f.service.dispose();}
 }
});

import {ClearSelectionContentCommand,SetWorksheetActiveOperation,SheetsSelectionsService} from '@univerjs/sheets';
import {IUniverInstanceService} from '@univerjs/core';
import {CompressMutationService} from '@univerjs-pro/collaboration';
import {guardNativeWorksheets} from '../../workagent-client/src/native-worksheets.ts';
test('public selection clear SEND envelope commits losslessly; malformed clear and mixed batches refuse atomically',async()=>{
 const f=await serviceFixture();let c,g;try{
  const sid=await secondSheet(f);
  assert.equal((await submit(f,[[SHEET_VALUES,{subUnitId:sid,cellValue:{0:{0:{v:22,s:'0'}}},styleRefMap:{'0':{bl:1}}}],scalar(sid,0,1,33)])).status,'committed');
  const before=await data(f),base=f.head;c=clientFixture(before);const i=c.univer.__getInjector();i.get(IUniverInstanceService).focusUnit(UNIT);
  await c.commands.executeCommand(SetWorksheetActiveOperation.id,{unitId:UNIT,subUnitId:sid});const selections=i.get(SheetsSelectionsService);
  selections.setSelections(UNIT,sid,[{range:{startRow:0,endRow:0,startColumn:0,endColumn:0},primary:null,style:null}]);
  g=guardNativeWorksheets(UNIT,c.commands,c.save,()=>c.book.getActiveSheet().getSheetId(),()=>true,()=>false,()=>{},()=>selections.getCurrentSelections().map(s=>s.range));
  assert.equal(await c.commands.executeCommand(ClearSelectionContentCommand.id),true);
  const compressor=new CompressMutationService();let emitted;try{emitted=compressor.interceptor.fetchThroughInterceptors(compressor.interceptor.getInterceptPoints().COMPRESS_MUTATION_SEND)(structuredClone(c.emitted),i.get(IUniverInstanceService));}finally{compressor.interceptor.dispose();}
  assert.equal(emitted.length,1);const p=emitted[0].params;assert.deepEqual(p.cellValue,{0:{0:{v:null,p:null,f:null,si:null,custom:null}}});assert.deepEqual(p.styleRefMap,{});
  // A peer write after this clear's native base must still use SDK OT.
  assert.equal((await submit(f,[scalar('sheet-1',0,1,71)])).status,'committed');
  assert.equal((await submit(f,emitted.map(m=>[m.id,m.params]),'peer',base)).status,'committed');
  const after=await data(f);assert.equal(after.sheets[sid].cellData[0][0].v??null,null);assert.equal(after.sheets[sid].cellData[0][1].v,33);assert.equal(after.sheets['sheet-1'].cellData[0][1].v,71);
  const style=d=>{const s=d.sheets[sid].cellData[0][0].s;return typeof s==='string'?d.styles[s]:s;};assert.deepEqual(style(after),style(before));assert.deepEqual(style(c.save()),style(before));
  const head=f.head,clear=p.cellValue[0][0];
  const resolved=d=>{const sheets=structuredClone(d.sheets);for(const sheet of Object.values(sheets))for(const row of Object.values(sheet.cellData??{}))for(const cell of Object.values(row))if(typeof cell.s==='string')cell.s=d.styles[cell.s];return sheets;};
  const invalid=[...['p','custom'].map(k=>({...p,cellValue:{0:{0:{...clear,[k]:{data:'no'}}}}})),{...p,cellValue:{0:{0:{...clear,unknown:null}}}},{...p,cellValue:{0:{0:clear,1:clear}}},{...p,cellValue:{1000:{0:clear}}},...[null,[],{'0':{bl:0}}].map(styleRefMap=>({...p,styleRefMap}))];
  for(const bad of invalid){assert.equal((await submit(f,[scalar('sheet-1',0,2,999),[SHEET_VALUES,bad]])).status,'rejected');assert.equal(f.head,head);assert.deepEqual(resolved(await data(f)),resolved(after));}
 }finally{g?.dispose();c?.dispose();await f.service.dispose();}
});

import {InsertSheetCommand} from '@univerjs/sheets';
import {mergeWorksheetSnapshotWithDefault} from '@univerjs/core';
test('captured native toolbar default-size command reaches SEND and canonical blank service commit',async()=>{
 const f=await serviceFixture();let c,g;try{
  const before=await data(f),head=f.head;c=clientFixture(before);const instances=c.univer.__getInjector().get(IUniverInstanceService);instances.focusUnit(UNIT);
  g=guardNativeWorksheets(UNIT,c.commands,c.save,()=>c.book.getActiveSheet().getSheetId(),()=>true,()=>false,()=>{});
  assert.equal(await c.commands.executeCommand(InsertSheetCommand.id,{sheet:{rowCount:1000,columnCount:20}}),true);
  const compressor=new CompressMutationService();let emitted;try{emitted=compressor.interceptor.fetchThroughInterceptors(compressor.interceptor.getInterceptPoints().COMPRESS_MUTATION_SEND)(structuredClone(c.emitted),instances);}finally{compressor.interceptor.dispose();}
  assert.equal(emitted.length,1);assert.equal(emitted[0].id,INSERT_SHEET);const params=emitted[0].params;
  assert.equal(params.index,1);assert.equal(params.unitId,UNIT);assert.deepEqual(params.sheet,mergeWorksheetSnapshotWithDefault({id:params.sheet.id,name:params.sheet.name}));
  assert.equal((await submit(f,emitted.map(m=>[m.id,m.params]))).status,'committed');assert.equal(f.head,head+1);
  const current=await data(f);assert.deepEqual(current.sheetOrder,[...before.sheetOrder,params.sheet.id]);assert.deepEqual(current.sheets[params.sheet.id],params.sheet);assert.deepEqual(current.sheets['sheet-1'],before.sheets['sheet-1']);
  const reopened=clientFixture(current);try{assert.deepEqual(reopened.save().sheets,current.sheets);}finally{reopened.dispose();}
 }finally{g?.dispose();c?.dispose();await f.service.dispose();}
});

import {SetRangeValuesCommand} from '@univerjs/sheets';
test('captured own p undefined scalar typing compresses and commits with style; rich and unknown input never mutate',async()=>{
 const f=await serviceFixture();let c,g;try{
  const sid=await secondSheet(f);assert.equal((await submit(f,[scalar(sid,0,0,22)])).status,'committed');
  const before=await data(f),head=f.head;c=clientFixture(before);const instances=c.univer.__getInjector().get(IUniverInstanceService);instances.focusUnit(UNIT);
  g=guardNativeWorksheets(UNIT,c.commands,c.save,()=>c.book.getActiveSheet().getSheetId(),()=>true,()=>false,()=>{});
  const range={startRow:1,endRow:1,startColumn:1,endColumn:1},captured=()=>({t:2,v:44,f:null,si:null,p:undefined,s:{cl:{rgb:'#1B1C1F'}}});
  for(const value of [{...captured(),p:{body:{dataStream:'Rich\r\n'}}},{...captured(),unknown:undefined}]){
   const local=c.save(),n=c.emitted.length;assert.equal(await c.commands.executeCommand(SetRangeValuesCommand.id,{unitId:UNIT,subUnitId:sid,range,value}),false);assert.deepEqual(c.save(),local);assert.equal(c.emitted.length,n);assert.equal(f.head,head);assert.deepEqual((await data(f)).sheets,before.sheets);
  }
  const value=captured();assert.ok(Object.hasOwn(value,'p'));assert.equal(value.p,undefined);assert.deepEqual(Object.keys(value),['t','v','f','si','p','s']);
  assert.equal(await c.commands.executeCommand(SetRangeValuesCommand.id,{unitId:UNIT,subUnitId:sid,range,value,redoUndoId:'captured-scalar-typing'}),true);
  const compressor=new CompressMutationService();let emitted;try{emitted=compressor.interceptor.fetchThroughInterceptors(compressor.interceptor.getInterceptPoints().COMPRESS_MUTATION_SEND)(structuredClone(c.emitted),instances);}finally{compressor.interceptor.dispose();}
  assert.equal(emitted.length,1);assert.equal(emitted[0].id,SHEET_VALUES);
  const wire=JSON.parse(JSON.stringify(emitted[0].params));assert.equal(Object.hasOwn(wire.cellValue[1][1],'p'),false);assert.equal(wire.cellValue[1][1].v,44);assert.deepEqual(wire.styleRefMap[wire.cellValue[1][1].s],{cl:{rgb:'#1B1C1F'}});
  assert.equal((await submit(f,emitted.map(m=>[m.id,m.params]))).status,'committed');assert.equal(f.head,head+1);
  const current=await data(f),cell=current.sheets[sid].cellData[1][1];assert.equal(cell.v,44);assert.deepEqual(typeof cell.s==='string'?current.styles[cell.s]:cell.s,{cl:{rgb:'#1B1C1F'}});assert.equal(current.sheets[sid].cellData[0][0].v,22);assert.deepEqual(current.sheets['sheet-1'],before.sheets['sheet-1']);
 }finally{g?.dispose();c?.dispose();await f.service.dispose();}
});
