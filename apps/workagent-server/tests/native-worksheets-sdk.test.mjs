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
