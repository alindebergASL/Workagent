// Actual public SDK commands with the production early guard; no browser proof.
import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from '../../workagent-server/tests/native-comments-sdk.test.mjs';
import {guardNativeWorksheets} from '../src/native-worksheets.ts';
import {InsertSheetCommand,SetWorksheetNameCommand,SetWorksheetActiveOperation,SetRangeValuesCommand,RemoveSheetCommand,InsertRowCommand,AddWorksheetMergeAllCommand} from '@univerjs/sheets';
import {IUniverInstanceService,Direction} from '@univerjs/core';
test('native tabs add/rename/select preserve values; unsupported cross-sheet tools and busy switches refuse before mutation',async()=>{
 const f=fixture(),messages=[];let busy=false,write=true;f.univer.__getInjector().get(IUniverInstanceService).focusUnit(f.unitID);
 const g=guardNativeWorksheets(f.unitID,f.commands,f.save,()=>f.book.getActiveSheet().getSheetId(),()=>write,()=>busy,m=>messages.push(m));
 try{
  assert.equal(await f.commands.executeCommand(InsertSheetCommand.id,{unitId:f.unitID}),true);const sid=f.save().sheetOrder[1];
  assert.equal(await f.commands.executeCommand(SetWorksheetNameCommand.id,{unitId:f.unitID,subUnitId:sid,name:'Second'}),true);
  busy=true;const n=f.emitted.length;assert.equal(await f.commands.executeCommand(SetWorksheetActiveOperation.id,{unitId:f.unitID,subUnitId:sid}),false);assert.equal(f.emitted.length,n);busy=false;
  assert.equal(await f.commands.executeCommand(SetWorksheetActiveOperation.id,{unitId:f.unitID,subUnitId:sid}),true);assert.equal(f.emitted.length,n);
  assert.equal(await f.commands.executeCommand(SetRangeValuesCommand.id,{unitId:f.unitID,subUnitId:sid,range:{startRow:0,endRow:0,startColumn:0,endColumn:0},value:{v:22}}),true);
  const before=f.save(),count=f.emitted.length;
  for(const [id,params]of [[RemoveSheetCommand.id,{unitId:f.unitID,subUnitId:sid}],[InsertRowCommand.id,{unitId:f.unitID,subUnitId:sid,range:{startRow:0,endRow:0,startColumn:0,endColumn:19},direction:Direction.UP}],[AddWorksheetMergeAllCommand.id,{}],[InsertSheetCommand.id,{unitId:f.unitID,sheet:{id:'prefilled',cellData:{0:{0:{v:99}}}}}],[SetWorksheetNameCommand.id,{unitId:f.unitID,subUnitId:sid,name:'Sheet 1'}]])assert.equal(await f.commands.executeCommand(id,params),false);
  assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,count);assert.match(messages.at(-1),/original worksheet/);
  write=false;assert.equal(await f.commands.executeCommand(InsertSheetCommand.id,{unitId:f.unitID}),false);assert.equal(await f.commands.executeCommand(SetWorksheetNameCommand.id,{unitId:f.unitID,subUnitId:sid,name:'Denied'}),false);
 }finally{g.dispose();f.dispose();}
});

import {ClearSelectionContentCommand,ClearSelectionAllCommand,ClearSelectionFormatCommand,AutoClearContentCommand,SheetsSelectionsService} from '@univerjs/sheets';
import {blank} from '../../workagent-server/tests/native-comments-sdk.test.mjs';
import {mergeWorksheetSnapshotWithDefault} from '@univerjs/core';
test('extra-sheet public clear uses explicit or current selections; busy, multiple and unsupported clears are atomic refusals',async()=>{
 const snapshot=blank();snapshot.sheetOrder.push('second');snapshot.sheets.second=mergeWorksheetSnapshotWithDefault({id:'second',name:'Second',cellData:{0:{0:{v:22,s:{bl:1}},1:{v:33}}}});
 const f=fixture(snapshot),i=f.univer.__getInjector();i.get(IUniverInstanceService).focusUnit(f.unitID);
 await f.commands.executeCommand(SetWorksheetActiveOperation.id,{unitId:f.unitID,subUnitId:'second'});
 const selections=i.get(SheetsSelectionsService),range=(end=0)=>({startRow:0,endRow:0,startColumn:0,endColumn:end});
 const select=ranges=>selections.setSelections(f.unitID,'second',ranges.map(range=>({range,primary:null,style:null})));
 let busy=false,write=true;const messages=[];
 const g=guardNativeWorksheets(f.unitID,f.commands,f.save,()=>f.book.getActiveSheet().getSheetId(),()=>write,()=>busy,m=>messages.push(m),()=>selections.getCurrentSelections().map(s=>s.range));
 try{
  for(const params of [undefined,{unitId:f.unitID,subUnitId:'second',ranges:[range(1)]}]){
   select([range(1)]);const before=f.save(),n=f.emitted.length;assert.equal(await f.commands.executeCommand(ClearSelectionContentCommand.id,params),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,n);
  }
  select([range(),{...range(),startColumn:1,endColumn:1}]);assert.equal(await f.commands.executeCommand(ClearSelectionContentCommand.id),false);
  select([range()]);
  for(const state of ['busy','readonly']){busy=state==='busy';write=state!=='readonly';const before=f.save(),n=f.emitted.length;assert.equal(await f.commands.executeCommand(ClearSelectionContentCommand.id),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,n);}busy=false;write=true;
  for(const id of [ClearSelectionAllCommand.id,ClearSelectionFormatCommand.id,AutoClearContentCommand.id]){const before=f.save(),n=f.emitted.length;assert.equal(await f.commands.executeCommand(id,{unitId:f.unitID,subUnitId:'second',clearRange:range(),selectionRange:range()}),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,n);}
  const style=f.book.getSheetBySheetId('second').getCell(0,0).s;
  assert.equal(await f.commands.executeCommand(ClearSelectionContentCommand.id),true);assert.equal(f.book.getSheetBySheetId('second').getCell(0,0).v??null,null);assert.deepEqual(f.book.getSheetBySheetId('second').getCell(0,0).s,style);assert.equal(f.save().sheets.second.cellData[0][1].v,33);
  assert.equal(await f.commands.executeCommand(ClearSelectionContentCommand.id,{unitId:f.unitID,subUnitId:'second',ranges:[{...range(),startColumn:1,endColumn:1}]}),true);assert.equal(f.save().sheets.second.cellData[0]?.[1]?.v??null,null);
  await f.commands.executeCommand(SetWorksheetActiveOperation.id,{unitId:f.unitID,subUnitId:'sheet-1'});const count=messages.length;await f.commands.executeCommand(ClearSelectionContentCommand.id,{unitId:f.unitID,subUnitId:'sheet-1',ranges:[range(1)]});assert.equal(messages.length,count);
 }finally{g.dispose();f.dispose();}
});

test('native toolbar default-size sheet options are blank-only, permission/busy fenced and capped at four tabs',async()=>{
 const f=fixture(),i=f.univer.__getInjector();i.get(IUniverInstanceService).focusUnit(f.unitID);
 let write=true,busy=false;const messages=[];
 const g=guardNativeWorksheets(f.unitID,f.commands,f.save,()=>f.book.getActiveSheet().getSheetId(),()=>write,()=>busy,m=>messages.push(m));
 const toolbar={sheet:{rowCount:1000,columnCount:20}};
 const refused=async params=>{const before=f.save(),count=f.emitted.length;assert.equal(await f.commands.executeCommand(InsertSheetCommand.id,params),false,JSON.stringify(params));assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,count);};
 try{
  for(const sheet of [null,[],{}, {rowCount:1000},{columnCount:20},{rowCount:'1000',columnCount:20},{rowCount:999,columnCount:20},{rowCount:1000,columnCount:21}, ...['id','name','cellData','resources','mergeData','styles','custom'].map(k=>({...toolbar.sheet,[k]:k==='id'?'imported':{}})),Object.assign(Object.create({cellData:{0:{0:{v:99}}}}),toolbar.sheet)])await refused({sheet});
  await refused({...toolbar,unknown:true});await refused({...toolbar,index:0});await refused({...toolbar,unitId:'foreign'});
  write=false;await refused(toolbar);write=true;busy=true;await refused(toolbar);busy=false;
  const original=f.save().sheets['sheet-1'];
  // Exact native '+' payload: no unitId/index, followed by existing no-params path.
  // The SDK expands the supplied sheet object in place; each click supplies a fresh envelope.
  for(const params of [structuredClone(toolbar),undefined,structuredClone(toolbar)]){
   assert.equal(await f.commands.executeCommand(InsertSheetCommand.id,params),true);const saved=f.save(),id=saved.sheetOrder.at(-1),sheet=saved.sheets[id];
   assert.equal(sheet.rowCount,1000);assert.equal(sheet.columnCount,20);assert.deepEqual(sheet.cellData,{});assert.deepEqual(sheet.mergeData,[]);assert.deepEqual(saved.sheets['sheet-1'],original);
  }
  assert.equal(f.save().sheetOrder.length,4);await refused(toolbar);await refused(undefined);
 }finally{g.dispose();f.dispose();}
});

test('captured scalar typing accepts only empty own p companion and leaves unsupported input untouched',async()=>{
 const snapshot=blank();snapshot.sheetOrder.push('second');snapshot.sheets.second=mergeWorksheetSnapshotWithDefault({id:'second',name:'Second',cellData:{0:{0:{v:22}}}});
 const f=fixture(snapshot),i=f.univer.__getInjector();i.get(IUniverInstanceService).focusUnit(f.unitID);
 const g=guardNativeWorksheets(f.unitID,f.commands,f.save,()=>f.book.getActiveSheet().getSheetId(),()=>true,()=>false,()=>{});
 const range={startRow:1,endRow:1,startColumn:1,endColumn:1};
 const captured=()=>({t:2,v:44,f:null,si:null,p:undefined,s:{cl:{rgb:'#1B1C1F'}}});
 try{
  const value=captured();assert.ok(Object.hasOwn(value,'p'));assert.equal(value.p,undefined);assert.deepEqual(Object.keys(value),['t','v','f','si','p','s']);
  const first=f.save().sheets['sheet-1'];
  assert.equal(await f.commands.executeCommand(SetRangeValuesCommand.id,{unitId:f.unitID,subUnitId:'second',range,value,redoUndoId:'typing-own-undefined'}),true);
  assert.equal(f.save().sheets.second.cellData[1][1].v,44);assert.equal(f.save().sheets.second.cellData[0][0].v,22);assert.deepEqual(f.save().sheets['sheet-1'],first);
  for(const bad of [{...captured(),p:{body:{dataStream:'Rich\r\n'}}},{...captured(),p:null},{...captured(),unknown:undefined},{...captured(),custom:undefined},{...captured(),f:'=1'}]){
   const before=f.save(),n=f.emitted.length;assert.equal(await f.commands.executeCommand(SetRangeValuesCommand.id,{unitId:f.unitID,subUnitId:'second',range,value:bad}),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,n);
  }
  const before=f.save(),n=f.emitted.length;assert.equal(await f.commands.executeCommand(SetRangeValuesCommand.id,{unitId:f.unitID,subUnitId:'second',range:{...range,endColumn:2},value:captured()}),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,n);
  assert.equal(await f.commands.executeCommand(SetRangeValuesCommand.id,{unitId:f.unitID,subUnitId:'sheet-1',range,value:captured()}),true);assert.equal(f.save().sheets['sheet-1'].cellData[1][1].v,44);assert.deepEqual(f.save().sheets.second,before.sheets.second);
 }finally{g.dispose();f.dispose();}
});

import {SetWorksheetOrderCommand} from '@univerjs/sheets';
test('extra-tab reorder native gesture preserves active sheet; invalid, no-op and busy orders never mutate',async()=>{
 const source=blank();for(const id of ['second','third']){source.sheetOrder.push(id);source.sheets[id]=mergeWorksheetSnapshotWithDefault({id,name:id,cellData:{0:{0:{v:id,s:{bl:1}}}}});}
 const f=fixture(source);f.univer.__getInjector().get(IUniverInstanceService).focusUnit(f.unitID);
 let busy=false,write=true;const messages=[];const g=guardNativeWorksheets(f.unitID,f.commands,f.save,()=>f.book.getActiveSheet().getSheetId(),()=>write,()=>busy,x=>messages.push(x));
 const refused=async p=>{const before=f.save(),n=f.emitted.length,active=f.book.getActiveSheet().getSheetId();if(p===null)await assert.rejects(f.commands.executeCommand(SetWorksheetOrderCommand.id,p),/params.*null/);else assert.equal(await f.commands.executeCommand(SetWorksheetOrderCommand.id,p),false,JSON.stringify(p));assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,n);assert.equal(f.book.getActiveSheet().getSheetId(),active);};
 try{
  await f.commands.executeCommand(SetWorksheetActiveOperation.id,{unitId:f.unitID,subUnitId:'second'});const original=f.save();
  assert.equal(await f.commands.executeCommand(SetWorksheetOrderCommand.id,{order:2}),true);assert.deepEqual(f.save().sheetOrder,['sheet-1','third','second']);assert.equal(f.book.getActiveSheet().getSheetId(),'second');
  assert.equal(await f.commands.executeCommand(SetWorksheetOrderCommand.id,{unitId:f.unitID,subUnitId:'second',order:1}),true);assert.deepEqual(f.save(),original);
  for(const p of [undefined,null,{},[],{order:0},{order:-1},{order:3},{order:1.5},{order:'2'},{order:NaN},{order:1},{order:2,subUnitId:'sheet-1'},{order:2,subUnitId:'missing'},{order:2,unitId:'foreign'},{order:2,unitId:null},{order:2,unitId:''},{order:2,subUnitId:null},{order:2,subUnitId:undefined},{order:2,fromOrder:1},{order:2,toOrder:1},{order:2,sheetOrder:['sheet-1','third','second']},{order:2,unknown:undefined}])await refused(p);
  busy=true;await refused({order:2});busy=false;write=false;await refused({order:2});write=true;
  // Other structural surfaces remain unavailable, without changing active tab.
  await f.commands.executeCommand(SetWorksheetActiveOperation.id,{unitId:f.unitID,subUnitId:'sheet-1'});await refused({order:2});
 }finally{g.dispose();f.dispose();}
});
