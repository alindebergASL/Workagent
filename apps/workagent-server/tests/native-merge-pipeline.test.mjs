// Real pinned native service/OT/middleware with an in-memory implementation of
// public IDatabaseAdapter. No SQLite/Postgres, sockets or persistence proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UnitSnapshotMaterializer, UniverCollabService } from '@univerjs-pro/collaboration-service';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { NativeAuthority, NATIVE_UNIT as UNIT } from '../src/native-collaboration.mjs';
import { NativeComments, ADD_COMMENT, DELETE_COMMENT, RESOLVE_COMMENT } from '../src/native-comments.mjs';
import { blank } from './native-comments-sdk.test.mjs';
export async function fixture() {
  let state=initialState('owner'),tail=Promise.resolve(),unit,snapshot,changesets=[],blocks=[];
  state.nativeQualification={storage:{pairID:'pair',purpose:'workagent-native-workspace'}};
  state.works[UNIT]={id:UNIT,kind:'native-sheet',nativeCollaboration:true,status:'ready',accessRevision:1,acl:{peer:'editor'},nativeIdentity:{version:1,workspace:'owner',unitID:UNIT,pairID:'pair',owners:{}}};
  const store={read:async fn=>structuredClone(await fn(structuredClone(state))),transaction(fn){const p=tail.then(async()=>{const copy=structuredClone(state),result=await fn(copy);state=copy;return structuredClone(result);});tail=p.catch(()=>{});return p;}};
  const db={
    getUnit:async()=>structuredClone(unit??null),getSnapshotInfo:async()=>snapshot?{unitID:UNIT,type:2,rev:snapshot.rev}:null,getSnapshot:async()=>structuredClone(snapshot??null),
    getSheetBlock:async(_c,_u,id)=>structuredClone(blocks.find(b=>b.id===id)??null),
    getChangesets:async(_c,_u,{from,to=Infinity})=>structuredClone(changesets.filter(c=>c.revision>from&&c.revision<=to)),
    createUnit:async(_c,input)=>{unit=structuredClone(input.record);snapshot=structuredClone(input.snapshot);blocks=structuredClone(input.sheetBlocks??[]);return {status:'created',record:unit};},
    saveSnapshot:async(_c,input)=>{snapshot=structuredClone(input.snapshot);blocks=structuredClone(input.sheetBlocks??[]);},
    commitChangeset:async(_c,{changeset})=>{if(changeset.revision!==unit.headRevision+1)return {status:'revision-mismatch',actualHeadRevision:unit.headRevision};changesets.push(structuredClone(changeset));unit.headRevision=changeset.revision;return {status:'committed',changeset,headRevision:unit.headRevision};},
  };
  const workspace=new Workspace(store,{peers:[{id:'peer',name:'Peer'}],nativeEnabled:true}),authority=new NativeAuthority(workspace);
  const service=new UniverCollabService({dbAdapter:db,enableUnitPermissionAnalysis:true,runtime:{execution:{mode:'in-process'}}});
  const comments=new NativeComments(authority,service,db);authority.comments=comments;authority.install(service,{use(){},on(){}});
  const session={userID:'owner',unitID:UNIT,revision:1,binding:'binding'};authority.sessions.set('m',session);
  const initial=blank(UNIT);initial.sheets['sheet-1'].cellData={};
  await authority.scope.run({creating:true},()=>service.createUnitFromData({type:2,data:initial},{userID:'owner'}));
  let reqId=0;
  const submit=(mutations,baseRev=unit.headRevision)=>service.submitChangeset({changeset:{unitID:UNIT,type:2,baseRev,revision:baseRev+1,userID:'owner',memberID:'m',sid:'comment-sid',reqId:++reqId,mutations:mutations.map(([id,p])=>({id,data:JSON.stringify({unitId:UNIT,subUnitId:'sheet-1',...p})}))}},{userID:'owner',memberID:'m'});
  const submitAs=(principal,member,mutations,baseRev=unit.headRevision)=>service.submitChangeset({changeset:{unitID:UNIT,type:2,baseRev,revision:baseRev+1,userID:principal,memberID:member,sid:'sid-'+member,reqId:++reqId,mutations:mutations.map(([id,p])=>({id,data:JSON.stringify({unitId:UNIT,subUnitId:'sheet-1',...p})}))}},{userID:principal,memberID:member});
  const claim=async(id='root')=>{let comment;await comments.claim('owner','Owner',UNIT,session,{id,ref:'H9',body:'Immutable'},v=>comment=v);return comment;};
  const list=async(pendingID,principal='owner',epoch=1)=>{let result;await comments.list(principal,UNIT,{userID:principal,unitID:UNIT,revision:epoch,binding:'binding'},v=>result=v,pendingID);return result;};
  const checkpoint = async revision => {
    // In-memory adapter fixture of an aged native snapshot, not 4,097 executed edits.
    const materializer = new UnitSnapshotMaterializer({execution:{mode:'in-process'}});
    try { const loaded=await authority.scope.run({unitID:UNIT,session},()=>service.getUnitLoadDataWithBlocks({unitID:UNIT,type:2,revision:0},{userID:'owner'}));const head=await materializer.materializeSnapshot(loaded);snapshot=head.snapshot;snapshot.rev=revision;blocks=[...head.sheetBlocks];unit.headRevision=revision; }finally{await materializer.dispose();}
  };
  return {service,db,comments,authority,workspace,store,claim,submit,submitAs,list,session,checkpoint,get head(){return unit.headRevision;},get changesets(){return changesets;}};
}
import {MERGE,UNMERGE} from '../src/native-merge.mjs';
import {transformSnapshotToWorkbookData} from '@univerjs-pro/collaboration';
const range={startRow:0,endRow:0,startColumn:0,endColumn:1};
test('native merge/unmerge service: real permissions/materialization, raw loss and bounds refused, ACL/head fenced',async()=>{
 const f=await fixture();const seen=[];f.service.use('commitChangeset',async(c,next)=>{seen.push(c.requiredUnitPermissions);await next();});
 const read=async()=>{const load=await f.service.getUnitLoadDataWithBlocks({unitID:UNIT,type:2,revision:0},{userID:'owner'}),m=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});try{const state=await m.materializeSnapshot(load);return transformSnapshotToWorkbookData(state.snapshot,[...state.sheetBlocks]);}finally{await m.dispose();}};
 try{
  assert.equal((await f.submit([['sheet.mutation.set-range-values',{cellValue:{0:{0:{v:11}}}}]])).status,'committed');
  const merge=await f.submit([[MERGE,{ranges:[range]}]]);assert.equal(merge.status,'committed',JSON.stringify(merge));assert.deepEqual((await read()).sheets['sheet-1'].mergeData,[range]);
  assert.equal((await f.submit([[MERGE,{ranges:[range]}]])).status,'rejected');
  assert.equal((await f.submit([[UNMERGE,{ranges:[range]}]])).status,'committed');assert.deepEqual((await read()).sheets['sheet-1'].mergeData,[]);
  await f.submit([['sheet.mutation.set-range-values',{cellValue:{0:{1:{v:22}}}}]]);const head=f.head;
  assert.equal((await f.submit([[MERGE,{ranges:[range]}]])).status,'rejected');assert.equal(f.head,head);assert.equal((await read()).sheets['sheet-1'].cellData[0][1].v,22);
  assert.equal((await f.submit([[MERGE,{ranges:[{...range,endRow:100000}]}]])).status,'rejected');
  const other={startRow:2,endRow:2,startColumn:0,endColumn:1};assert.equal((await f.submit([[MERGE,{ranges:[other]}]],1)).status,'rejected');
  f.authority.sessions.set('p',{userID:'peer',unitID:UNIT,revision:1,binding:'binding'});assert.equal((await f.submitAs('peer','p',[[MERGE,{ranges:[other]}]])).status,'committed');
  await f.workspace.share('owner',UNIT,{commandId:'reader',peer:'peer',role:'read',accessRevision:1});
  assert.equal((await f.submitAs('peer','p',[[UNMERGE,{ranges:[other]}]])).status,'rejected');
  f.authority.sessions.set('p',{userID:'peer',unitID:UNIT,revision:2,binding:'binding'});assert.equal((await f.submitAs('peer','p',[[UNMERGE,{ranges:[other]}]])).status,'rejected');
  console.log('Native merge permission evidence',JSON.stringify(seen));
 }finally{await f.service.dispose();}
});

import {pair,relay,UNIT as HISTORY_UNIT,TAB} from './native-history-sdk.test.mjs';
import {AddWorksheetMergeCommand,InsertRowCommand,RemoveRowCommand,SetRangeValuesCommand} from '@univerjs/sheets';
import {AddCommentCommand} from '@univerjs/thread-comment';
import {Direction} from '@univerjs/core';
test('public row commands before a merge converge through native service with styles and comment anchors retained',async()=>pair(async(s,a,b)=>{
 const comment=await s.claim();await relay(await a.run(s,AddCommentCommand.id,{unitId:HISTORY_UNIT,subUnitId:TAB,comment}),b);
 await relay(await a.run(s,SetRangeValuesCommand.id,{unitId:HISTORY_UNIT,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:0,endColumn:0},value:{v:11,s:{bg:{rgb:'#123456'}}}}),b);
 const r={startRow:2,endRow:4,startColumn:0,endColumn:1};await relay(await a.run(s,AddWorksheetMergeCommand.id,{unitId:HISTORY_UNIT,subUnitId:TAB,selections:[r]}),b);
 const before=await s.data(),originalClaims=await s.store.read(x=>x.works[HISTORY_UNIT].nativeCommentClaims);
 const inserted=await b.run(s,InsertRowCommand.id,{unitId:HISTORY_UNIT,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:0,endColumn:25},direction:Direction.UP});await relay(inserted,a);
 assert.equal(a.book.getActiveSheet().getMergeData()[0].endRow,5);assert.equal(a.model.getComment(HISTORY_UNIT,TAB,'root').ref,'H10');
 await relay(await b.run(s,RemoveRowCommand.id,{unitId:HISTORY_UNIT,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:0,endColumn:25}}),a);
 const after=await s.data();const resolved=data=>{const sheet=structuredClone(data.sheets[TAB]);for(const cols of Object.values(sheet.cellData))for(const cell of Object.values(cols))if(typeof cell.s==='string')cell.s=data.styles[cell.s];return sheet;};assert.deepEqual(resolved(after),resolved(before));assert.deepEqual(after.resources,before.resources);
 assert.deepEqual(a.book.getActiveSheet().getMergeData(),b.book.getActiveSheet().getMergeData());assert.equal(a.model.getComment(HISTORY_UNIT,TAB,'root').ref,'H9');assert.deepEqual(await s.store.read(x=>x.works[HISTORY_UNIT].nativeCommentClaims),originalClaims);
 assert.deepEqual((await s.data(4)).sheets[TAB].mergeData,[r]);
}));
test('native merge actual commit rechecks concurrent content, overlap and reader epoch after admission',async()=>{
 for(const change of ['content','overlap','reader']){
  const f=await fixture();let release,reached;const gate=new Promise(r=>release=r),ready=new Promise(r=>reached=r);let held=false;
  f.authority.sessions.set('p',{userID:'peer',unitID:UNIT,revision:1,binding:'binding'});
  f.service.use('submitChangeset',async(c,next)=>{if(!held&&c.request.changeset.memberID==='p'){held=true;reached();await gate;}await next();});
  try{const pending=f.submitAs('peer','p',[[MERGE,{ranges:[range]}]]);await ready;
   if(change==='reader')await f.workspace.share('owner',UNIT,{commandId:'downgrade',peer:'peer',role:'read',accessRevision:1});
   else assert.equal((await f.submit(change==='overlap'?[[MERGE,{ranges:[range]}]]:[['sheet.mutation.set-range-values',{cellValue:{0:{1:{v:22}}}}]])).status,'committed');
   const head=f.head;release();const result=await pending;assert.equal(result.status,'rejected',JSON.stringify(result));assert.equal(result.error.retryable,false);assert.equal(f.head,head);
  }finally{release();await f.service.dispose();}
 }
});

const INSERT_ROW='sheet.mutation.insert-row',REMOVE_ROWS='sheet.mutation.remove-rows';
const rowRange=(startRow,endRow=startRow)=>({startRow,endRow,startColumn:0,endColumn:25,startAbsoluteRefType:0,endAbsoluteRefType:0,rangeType:1});
async function nativeData(f){const load=await f.service.getUnitLoadDataWithBlocks({unitID:UNIT,type:2,revision:0},{userID:'owner'}),m=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});try{const head=await m.materializeSnapshot(load);return await transformSnapshotToWorkbookData(head.snapshot,[...head.sheetBlocks]);}finally{await m.dispose();}}
test('raw row crossing and malformed ranges reject atomically without out-of-bounds merges',async()=>{
 const f=await fixture();try{
  assert.equal((await f.submit([[MERGE,{ranges:[{startRow:28,endRow:29,startColumn:0,endColumn:1}]}]])).status,'committed');const before=await nativeData(f),head=f.head;
  for(const [id,r] of [[REMOVE_ROWS,rowRange(29)],[INSERT_ROW,rowRange(29)],[REMOVE_ROWS,null],[INSERT_ROW,rowRange(-1)],[REMOVE_ROWS,rowRange(31)],[INSERT_ROW,{...rowRange(0),endColumn:24}],[REMOVE_ROWS,{...rowRange(0),endRow:0.5}]]){
   const result=await f.submit([[id,{range:r}]]);assert.equal(result.status,'rejected',JSON.stringify({id,r,result}));assert.equal(result.error.retryable,false);assert.equal(f.head,head);assert.deepEqual((await nativeData(f)).sheets,before.sheets);
  }
 }finally{await f.service.dispose();}
});
test('compound row indices use native range adjustment and refuse later crossing before any native effect',async()=>{
 const f=await fixture();try{
  const r={startRow:5,endRow:6,startColumn:0,endColumn:1};assert.equal((await f.submit([[MERGE,{ranges:[r]}]])).status,'committed');const head=f.head;
  for(const batch of [[[INSERT_ROW,{range:rowRange(0)}],[REMOVE_ROWS,{range:rowRange(6)}]],[[REMOVE_ROWS,{range:rowRange(0)}],[INSERT_ROW,{range:rowRange(5)}]]]){const out=await f.submit(batch);assert.equal(out.status,'rejected',JSON.stringify(out));assert.equal(f.head,head);assert.deepEqual((await nativeData(f)).sheets['sheet-1'].mergeData,[r]);}
  const good=await f.submit([[INSERT_ROW,{range:rowRange(0)}],[REMOVE_ROWS,{range:rowRange(0)}]]);assert.equal(good.status,'committed',JSON.stringify(good));assert.equal((await nativeData(f)).sheets['sheet-1'].rowCount,30);assert.deepEqual((await nativeData(f)).sheets['sheet-1'].mergeData,[r]);
 }finally{await f.service.dispose();}
});
test('row admission then concurrent merge: actual commit rejects crossing but native OT still accepts outside rows',async()=>{
 for(const id of [INSERT_ROW,REMOVE_ROWS])for(const crossing of [true,false]){
  const f=await fixture();let release,reached;const ready=new Promise(r=>reached=r),gate=new Promise(r=>release=r);let held=false;
  f.authority.sessions.set('p',{userID:'peer',unitID:UNIT,revision:1,binding:'binding'});
  f.service.use('submitChangeset',async(c,next)=>{if(!held&&c.memberID==='p'){held=true;reached();await gate;}await next();});
  try{const pending=f.submitAs('peer','p',[[id,{range:rowRange(crossing?29:0)}]]);await ready;
   assert.equal((await f.submit([[MERGE,{ranges:[{startRow:28,endRow:29,startColumn:0,endColumn:1}]}]])).status,'committed');release();const result=await pending;
   assert.equal(result.status,crossing?'rejected':'committed',JSON.stringify({id,crossing,result}));assert.equal(f.head,crossing?2:3);
   const sheet=(await nativeData(f)).sheets['sheet-1'];assert.ok(sheet.mergeData.every(m=>m.endRow<sheet.rowCount));assert.equal(sheet.rowCount,crossing?30:id===INSERT_ROW?31:29);
  }finally{release();await f.service.dispose();}
 }
});
test('stale outside row operations retain native OT with or without existing merges',async()=>{
 for(const withMerge of [false,true]){const f=await fixture();try{
  if(withMerge)assert.equal((await f.submit([[MERGE,{ranges:[{startRow:20,endRow:21,startColumn:0,endColumn:1}]}]])).status,'committed');
  const base=f.head;assert.equal((await f.submit([[INSERT_ROW,{range:rowRange(0)}]])).status,'committed');
  const result=await f.submit([[INSERT_ROW,{range:rowRange(10)}]],base);assert.equal(result.status,'committed',JSON.stringify(result));const sheet=(await nativeData(f)).sheets['sheet-1'];assert.equal(sheet.rowCount,32);if(withMerge)assert.deepEqual(sheet.mergeData,[{startRow:22,endRow:23,startColumn:0,endColumn:1}]);
 }finally{await f.service.dispose();}}
});

import {deserializeRangeWithSheet} from '@univerjs/engine-formula';
test('native service retains public reference metadata and rejects malformed flags on merge, unmerge and rows',async()=>{
 const f=await fixture();try{
  const r=deserializeRangeWithSheet('$A$1:$B$2').range;
  assert.equal((await f.submit([[MERGE,{ranges:[r]}]])).status,'committed');
  assert.deepEqual((await nativeData(f)).sheets['sheet-1'].mergeData,[r]);
  const head=f.head,before=await nativeData(f);
  for(const metadata of [{startAbsoluteRefType:4},{endAbsoluteRefType:-1},{startAbsoluteRefType:'0'},{endAbsoluteRefType:null},{startAbsoluteRefType:true},{endAbsoluteRefType:0.5},{startAbsoluteRefType:{}},{endAbsoluteRefType:[]},{unexpectedRangeFlag:0}]){
   for(const id of [MERGE,UNMERGE,INSERT_ROW,REMOVE_ROWS]){
    const params=[MERGE,UNMERGE].includes(id)?{ranges:[{...r,...metadata}]}:{range:{...rowRange(10),...metadata}};
    const result=await f.submit([[id,params]]);assert.equal(result.status,'rejected',JSON.stringify({id,metadata,result}));assert.equal(result.error.retryable,false);assert.equal(f.head,head);
   }
  }
  assert.deepEqual(await nativeData(f),before);
  assert.equal((await f.submit([[UNMERGE,{ranges:[r]}]])).status,'committed');
  assert.deepEqual((await nativeData(f)).sheets['sheet-1'].mergeData,[]);
 }finally{await f.service.dispose();}
});

import {CompressMutationService} from '@univerjs-pro/collaboration';
test('SDK compressed empty unmerge companion commits; unsafe style maps and companion changes refuse atomically',async()=>{
 const f=await fixture(),compressor=new CompressMutationService();try{
  const r=deserializeRangeWithSheet('G4:H5').range;
  assert.equal((await f.submit([[MERGE,{ranges:[r]}]])).status,'committed');
  const params={unitId:UNIT,subUnitId:'sheet-1',cellValue:{},trigger:'sheet.command.remove-worksheet-merge'};
  const points=compressor.interceptor.getInterceptPoints();
  // Actual public transport compressor; this mutation needs no instance lookup.
  const compressed=compressor.interceptor.fetchThroughInterceptors(points.COMPRESS_MUTATION_SEND)([{id:'sheet.mutation.set-range-values',params}],null);
  assert.deepEqual(compressed[0].params,{...params,styleRefMap:{}});
  const applied=compressor.interceptor.fetchThroughInterceptors(points.COMPRESS_MUTATION_APPLY)(structuredClone(compressed),null);
  assert.deepEqual(applied[0].params.cellValue,{});
  const before=await nativeData(f),head=f.head;
  const invalid=[...[[{s:{bg:{rgb:'#fff'}}}],{'0':{bg:{rgb:'#fff'}}},null,[],false,0,''].map(styleRefMap=>({...params,styleRefMap})),
   {...params,styleRefMap:{},extra:true},
   {...params,styleRefMap:{},cellValue:{3:{6:{v:99}}}},
   {...params,styleRefMap:{},cellValue:{3:{6:{s:{bg:{rgb:'#fff'}}}}}},
   {...params,styleRefMap:{},cellValue:{0:{0:{s:null}}}},
   {...params,styleRefMap:{},cellValue:[]},
   {...params,styleRefMap:{},cellValue:{3:[]}},
   {...params,styleRefMap:{},cellValue:{3:{6:[]}}}
  ];
  for(const q of invalid){const out=await f.submit([[UNMERGE,{ranges:[r]}],['sheet.mutation.set-range-values',q]]);assert.equal(out.status,'rejected',JSON.stringify(q));assert.equal(out.error.retryable,false);assert.equal(f.head,head);}
  assert.deepEqual(await nativeData(f),before);
  const out=await f.submit([[UNMERGE,{ranges:[r]}],['sheet.mutation.set-range-values',compressed[0].params]]);assert.equal(out.status,'committed',JSON.stringify(out));assert.equal(f.head,head+1);
  const after=await nativeData(f),expected=structuredClone(before);expected.sheets['sheet-1'].mergeData=[];assert.deepEqual(after.sheets,expected.sheets);assert.deepEqual(after.resources,before.resources);assert.deepEqual(after.styles,before.styles);
 }finally{compressor.interceptor.dispose();await f.service.dispose();}
});

import {fixture as localFixture} from './native-comments-sdk.test.mjs';
import {AddWorksheetMergeHorizontalCommand as Horizontal,AddWorksheetMergeVerticalCommand as Vertical,RemoveWorksheetMergeCommand,SheetsSelectionsService} from '@univerjs/sheets';
import {IUniverInstanceService} from '@univerjs/core';
import {guardNativeMerge} from '../../workagent-client/src/native-merge.ts';
test('strip toolbar public SEND/service/APPLY roundtrip preserves per-strip anchors, resources and historical merges',async()=>{
 for(const horizontal of [true,false]){
  const f=await fixture(),compressor=new CompressMutationService();let a,b,g;
  try{
   await f.submit([['sheet.mutation.set-range-values',{cellValue:horizontal?{0:{0:{v:11}},1:{0:{v:22}}}:{0:{0:{v:11},1:{v:22},2:{v:33}}}}]]);
   const comment=await f.claim();assert.equal((await f.submit([[ADD_COMMENT,{comment}]] )).status,'committed');
   const before=await nativeData(f),claims=await f.store.read(s=>s.works[UNIT].nativeCommentClaims);a=localFixture(before);b=localFixture(before);
   const i=a.univer.__getInjector(),instances=i.get(IUniverInstanceService),selections=i.get(SheetsSelectionsService),r=deserializeRangeWithSheet('A1:C2').range;instances.focusUnit(UNIT);
   const select=()=>selections.setSelections(UNIT,'sheet-1',[{range:r,primary:null,style:null}]);select();g=guardNativeMerge(UNIT,a.commands,a.save,()=>selections.getCurrentSelections().map(x=>x.range),()=>true,()=>{});
   const roundtrip=async id=>{const start=a.emitted.length;assert.equal(await a.commands.executeCommand(id),true);const points=compressor.interceptor.getInterceptPoints(),send=compressor.interceptor.fetchThroughInterceptors(points.COMPRESS_MUTATION_SEND)(structuredClone(a.emitted.slice(start)),instances);
    const result=await f.submit(send.map(m=>[m.id,m.params]));assert.equal(result.status,'committed',JSON.stringify(result));
    const applied=compressor.interceptor.fetchThroughInterceptors(points.COMPRESS_MUTATION_APPLY)(result.changeset.mutations.map(m=>({id:m.id,params:JSON.parse(m.data)})),b.univer.__getInjector().get(IUniverInstanceService));
    for(const m of applied)assert.equal(b.commands.syncExecuteCommand(m.id,m.params,{fromCollab:true}),true);
    assert.deepEqual(a.save().sheets,b.save().sheets);assert.deepEqual((await nativeData(f)).sheets,a.save().sheets);return f.head;};
   const merged=await roundtrip((horizontal?Horizontal:Vertical).id);const ranges=a.save().sheets['sheet-1'].mergeData;assert.equal(ranges.length,horizontal?2:3);select();await roundtrip(RemoveWorksheetMergeCommand.id);
   const after=await nativeData(f);assert.deepEqual(after.sheets,before.sheets);assert.deepEqual(after.resources,before.resources);assert.deepEqual(after.styles,before.styles);assert.deepEqual(await f.store.read(s=>s.works[UNIT].nativeCommentClaims),claims);
   const load=await f.service.getUnitLoadDataWithBlocks({unitID:UNIT,type:2,revision:merged},{userID:'owner'}),m=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});try{const x=await m.materializeSnapshot(load);assert.deepEqual((await transformSnapshotToWorkbookData(x.snapshot,[...x.sheetBlocks])).sheets['sheet-1'].mergeData,ranges);}finally{await m.dispose();}
  }finally{g?.dispose();a?.dispose();b?.dispose();compressor.interceptor.dispose();await f.service.dispose();}
 }
});

import {validateMerge} from '../src/native-merge.mjs';
const strips=[{startRow:0,endRow:0,startColumn:0,endColumn:2},{startRow:1,endRow:1,startColumn:0,endColumn:2}];
test('raw strip geometry/content bypasses refuse atomically and validation bounds full tiling and companions',async()=>{
 const f=await fixture();try{const before=await nativeData(f),head=f.head;
  const bad=[[],[strips[0],strips[0]],[strips[0],{...strips[1],startRow:2,endRow:2}],[strips[0],{...strips[1],endColumn:1}],[strips[0],{startRow:1,endRow:2,startColumn:0,endColumn:0}],[{...strips[0],endRow:1},strips[1]],[strips[0],{...strips[1],startAbsoluteRefType:99}]];
  for(const ranges of bad){const result=await f.submit([[MERGE,{ranges}]]);assert.equal(result.status,'rejected',JSON.stringify(ranges));assert.equal(result.error.retryable,false);assert.equal(f.head,head);}
  assert.deepEqual(await nativeData(f),before);
  const large=structuredClone(before);large.sheets['sheet-1'].rowCount=200;large.sheets['sheet-1'].columnCount=200;
  const mutations=(id,ranges,extra=[])=>[{id,data:JSON.stringify({unitId:UNIT,subUnitId:'sheet-1',ranges})},...extra];
  const maximum=Array.from({length:64},(_,row)=>({startRow:row,endRow:row,startColumn:0,endColumn:63}));assert.doesNotThrow(()=>validateMerge(large,mutations(MERGE,maximum)));
  assert.throws(()=>validateMerge(large,mutations(MERGE,[...maximum,{startRow:64,endRow:64,startColumn:0,endColumn:63}])));assert.throws(()=>validateMerge(large,mutations(MERGE,maximum.map(r=>({...r,endColumn:64})))));
  for(const cell of [{v:0},{v:''},{f:'=1'},{p:{body:{dataStream:'Rich\r\n'}}},{si:'shared'},{ft:1},{fd:'source'}]){const data=structuredClone(before);data.sheets['sheet-1'].cellData={1:{1:cell}};assert.throws(()=>validateMerge(data,mutations(MERGE,strips)));}
  // Formatting of merge anchors and covered empty cells is preserved by merge;
  // unsafe unmerge companions cannot change it, even when called raw.
  const styled=structuredClone(before);styled.sheets['sheet-1'].cellData={0:{0:{v:11,s:{bl:1}},1:{s:{bl:1}},2:{s:{bl:1}}},1:{0:{v:22,s:{it:1}},1:{s:{it:1}},2:{s:{it:1}}}};assert.doesNotThrow(()=>validateMerge(styled,mutations(MERGE,strips)));
  assert.equal((await f.submit([[MERGE,{ranges:strips}]] )).status,'committed');const merged=await nativeData(f),mergedHead=f.head;
  for(const ranges of [[{startRow:0,endRow:1,startColumn:0,endColumn:2}],[strips[0],strips[0]],[strips[0],{...strips[1],endColumn:3}]])assert.equal((await f.submit([[UNMERGE,{ranges}]])).status,'rejected');
  for(const q of [{cellValue:{1:{1:{v:99}}}},{cellValue:{9:{9:{s:null}}}},{cellValue:{},styleRefMap:{'0':{bl:1}}}])assert.equal((await f.submit([[UNMERGE,{ranges:strips}],['sheet.mutation.set-range-values',q]])).status,'rejected');
  assert.equal(f.head,mergedHead);assert.deepEqual(await nativeData(f),merged);
 }finally{await f.service.dispose();}
});
test('strip actual commit fence rechecks peer content/overlap/head and reader epoch after admission',async()=>{
 for(const change of ['content','overlap','disjoint','reader']){
  const f=await fixture();let release,reached,held=false;const gate=new Promise(r=>release=r),entered=new Promise(r=>reached=r);f.authority.sessions.set('p',{userID:'peer',unitID:UNIT,revision:1,binding:'binding'});
  f.service.use('submitChangeset',async(c,next)=>{if(!held&&c.request.changeset.memberID==='p'){held=true;reached();await gate;}await next();});
  try{const pending=f.submitAs('peer','p',[[MERGE,{ranges:strips}]]);await entered;
   if(change==='reader')await f.workspace.share('owner',UNIT,{commandId:'strip-reader',peer:'peer',role:'read',accessRevision:1});
   else assert.equal((await f.submit(change==='overlap'?[[MERGE,{ranges:[strips[1]]}]]:[['sheet.mutation.set-range-values',{cellValue:{1:{[change==='disjoint'?9:1]:{v:99}}}}]])).status,'committed');
   const before=await nativeData(f),head=f.head;release();const result=await pending;assert.equal(result.status,'rejected');assert.equal(result.error.retryable,false);assert.equal(f.head,head);assert.deepEqual(await nativeData(f),before);
  }finally{release();await f.service.dispose();}
 }
});
test('raw strips cannot cover committed comment anchors or mix unrelated changes',async()=>{
 const f=await fixture();try{const comment=await f.claim();assert.equal((await f.submit([[ADD_COMMENT,{comment}]])).status,'committed');const before=await nativeData(f),head=f.head,claims=await f.store.read(s=>s.works[UNIT].nativeCommentClaims);
 const covered=[{startRow:7,endRow:7,startColumn:7,endColumn:8},{startRow:8,endRow:8,startColumn:7,endColumn:8}];
 for(const batch of [[[MERGE,{ranges:covered}]],[[MERGE,{ranges:strips}],['sheet.mutation.set-range-values',{cellValue:{0:{9:{v:22}}}}]],[[MERGE,{ranges:strips}],[MERGE,{ranges:[{startRow:4,endRow:4,startColumn:0,endColumn:1}]}]]]){assert.equal((await f.submit(batch)).status,'rejected');assert.equal(f.head,head);assert.deepEqual(await nativeData(f),before);assert.deepEqual(await f.store.read(s=>s.works[UNIT].nativeCommentClaims),claims);}
 }finally{await f.service.dispose();}
});
