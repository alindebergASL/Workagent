import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './native-comments-sdk.test.mjs';
import {InsertSheetCommand,SetWorksheetNameCommand,SetWorksheetActiveOperation,SetRangeValuesCommand} from '@univerjs/sheets';
import {CompressMutationService} from '@univerjs-pro/collaboration';
import {IUniverInstanceService} from '@univerjs/core';
export async function addSheet(f){f.univer.__getInjector().get(IUniverInstanceService).focusUnit(f.unitID);const start=f.emitted.length;assert.equal(await f.commands.executeCommand(InsertSheetCommand.id,{unitId:f.unitID}),true);const compressor=new CompressMutationService();try{return compressor.interceptor.fetchThroughInterceptors(compressor.interceptor.getInterceptPoints().COMPRESS_MUTATION_SEND)(structuredClone(f.emitted.slice(start)),f.univer.__getInjector().get(IUniverInstanceService));}finally{compressor.interceptor.dispose();}}
if(process.argv[1]===new URL(import.meta.url).pathname)test('public blank worksheet add, rename, selection and per-sheet values survive SDK reload',async t=>{const f=fixture();let loaded;try{
 const added=await addSheet(f);t.diagnostic(JSON.stringify(added));const second=f.save().sheetOrder[1];assert.ok(second);assert.equal(added.length,1);
 const start=f.emitted.length;assert.equal(await f.commands.executeCommand(SetWorksheetNameCommand.id,{unitId:f.unitID,subUnitId:second,name:'Second'}),true);t.diagnostic(JSON.stringify(f.emitted.slice(start)));
 const count=f.emitted.length;assert.equal(await f.commands.executeCommand(SetWorksheetActiveOperation.id,{unitId:f.unitID,subUnitId:second}),true);assert.equal(f.emitted.length,count);
 for(const [subUnitId,v] of [['sheet-1',11],[second,22]])assert.equal(await f.commands.executeCommand(SetRangeValuesCommand.id,{unitId:f.unitID,subUnitId,range:{startRow:0,endRow:0,startColumn:0,endColumn:0},value:{v}}),true);
 const saved=f.save();loaded=fixture(saved);assert.deepEqual(loaded.save().sheetOrder,saved.sheetOrder);assert.equal(loaded.save().sheets[second].name,'Second');assert.equal(loaded.save().sheets[second].cellData[0][0].v,22);assert.equal(loaded.save().sheets['sheet-1'].cellData[0][0].v,11);
}finally{loaded?.dispose();f.dispose();}});

import {SetWorksheetOrderCommand,SetWorksheetOrderMutation} from '@univerjs/sheets';
import {blank,add} from './native-comments-sdk.test.mjs';
import {mergeWorksheetSnapshotWithDefault} from '@univerjs/core';
if(process.argv[1]===new URL(import.meta.url).pathname)test('public reorder uses zero-based final indexes, preserves active identity and resources; SDK no-op still emits',async()=>{
 const source=blank();for(const [id,v]of [['second',22],['third',33]]){source.sheetOrder.push(id);source.sheets[id]=mergeWorksheetSnapshotWithDefault({id,name:id,cellData:{0:{0:{v,s:'bold'}}}});}source.styles={bold:{bl:1}};
 const f=fixture(source),compressor=new CompressMutationService();let peer;try{
  f.univer.__getInjector().get(IUniverInstanceService).focusUnit(f.unitID);await add(f,'root','owner');
  await f.commands.executeCommand(SetWorksheetActiveOperation.id,{unitId:f.unitID,subUnitId:'second'});
  const before=f.save();peer=fixture(before);const peerBefore=peer.save();
  for(const [order,expected]of [[2,['sheet-1','third','second']],[1,['sheet-1','second','third']]]){
   const start=f.emitted.length;assert.equal(await f.commands.executeCommand(SetWorksheetOrderCommand.id,{order}),true);
   const batch=compressor.interceptor.fetchThroughInterceptors(compressor.interceptor.getInterceptPoints().COMPRESS_MUTATION_SEND)(structuredClone(f.emitted.slice(start)),f.univer.__getInjector().get(IUniverInstanceService));
   assert.equal(batch.length,1);assert.equal(batch[0].id,SetWorksheetOrderMutation.id);assert.deepEqual(batch[0].params,{unitId:f.unitID,subUnitId:'second',fromOrder:order===2?1:2,toOrder:order,trigger:SetWorksheetOrderCommand.id});
   const applied=compressor.interceptor.fetchThroughInterceptors(compressor.interceptor.getInterceptPoints().COMPRESS_MUTATION_APPLY)(structuredClone(batch),peer.univer.__getInjector().get(IUniverInstanceService));
   for(const m of applied)assert.equal(peer.commands.syncExecuteCommand(m.id,m.params,{fromCollab:true}),true);
   assert.deepEqual(f.save().sheetOrder,expected);assert.deepEqual(peer.save().sheetOrder,expected);assert.equal(f.book.getActiveSheet().getSheetId(),'second');
   for(const key of ['sheets','styles','resources']){assert.deepEqual(f.save()[key],before[key]);assert.deepEqual(peer.save()[key],peerBefore[key]);}
  }
  const count=f.emitted.length;assert.equal(await f.commands.executeCommand(SetWorksheetOrderCommand.id,{order:1}),true);assert.equal(f.emitted.length,count+1,'SDK no-op needs early app containment');assert.deepEqual(f.save(),before);
 }finally{peer?.dispose();compressor.interceptor.dispose();f.dispose();}
});
