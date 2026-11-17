// Actual pinned SDK; no transport/database. Proves native command semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,blank,add} from './native-comments-sdk.test.mjs';
import {AddWorksheetMergeCommand,RemoveWorksheetMergeCommand,SetRangeValuesCommand,InsertRowMutation,RemoveRowCommand} from '@univerjs/sheets';
const range={startRow:0,endRow:0,startColumn:0,endColumn:1};
test('public merge/unmerge preserves anchor, clears non-anchor value, and unmerge does not restore it',async t=>{
 const data=blank();data.sheets['sheet-1'].cellData={0:{0:{v:11,s:{bg:{rgb:'#112233'}}},1:{v:22,s:{bg:{rgb:'#445566'}}}}};const f=fixture(data);
 try{let start=f.emitted.length;assert.equal(await f.commands.executeCommand(AddWorksheetMergeCommand.id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[range],defaultMerge:true}),true);t.diagnostic(JSON.stringify(f.emitted.slice(start)));t.diagnostic(JSON.stringify(f.save().sheets['sheet-1']));assert.equal(f.book.getActiveSheet().getCellRaw(0,1).v,undefined);
 start=f.emitted.length;assert.equal(await f.commands.executeCommand(RemoveWorksheetMergeCommand.id,{unitId:f.unitID,subUnitId:'sheet-1',ranges:[range]}),true);t.diagnostic(JSON.stringify(f.emitted.slice(start)));assert.equal(f.book.getActiveSheet().getCellRaw(0,1).v,undefined);assert.deepEqual(f.save().sheets['sheet-1'].mergeData,[]);
 }finally{f.dispose();}
});
test('blank non-anchor merge emits metadata only; scalar command retains exact addressed coordinates inside merged cells; native row operations transform merge',async t=>{
 const data=blank();data.sheets['sheet-1'].cellData={0:{0:{v:11}}};const f=fixture(data);try{
 assert.equal(await f.commands.executeCommand(AddWorksheetMergeCommand.id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[range]}),true);t.diagnostic(JSON.stringify(f.emitted));assert.equal(f.emitted.length,1);
 const start=f.emitted.length;await f.commands.executeCommand(SetRangeValuesCommand.id,{unitId:f.unitID,subUnitId:'sheet-1',range:{startRow:0,endRow:0,startColumn:1,endColumn:1},value:{v:33}});t.diagnostic(JSON.stringify(f.emitted.slice(start)));
 await f.commands.executeCommand(InsertRowMutation.id,{unitId:f.unitID,subUnitId:'sheet-1',range:{startRow:0,endRow:0,startColumn:0,endColumn:25}});assert.equal(f.save().sheets['sheet-1'].mergeData[0].startRow,1);
 assert.equal(await f.commands.executeCommand(RemoveRowCommand.id,{unitId:f.unitID,subUnitId:'sheet-1',range:{startRow:1,endRow:1,startColumn:0,endColumn:25}}),true);assert.deepEqual(f.save().sheets['sheet-1'].mergeData,[]);
 }finally{f.dispose();}
});

import {deserializeRangeWithSheet} from '@univerjs/engine-formula';
import {AbsoluteRefType,IUniverInstanceService} from '@univerjs/core';
import {AddWorksheetMergeAllCommand,SheetsSelectionsService,InsertRowCommand} from '@univerjs/sheets';
test('public name-box parser flags survive Merge All, unmerge and row command mutation serialization',async()=>{
 for(const [text,flag] of [['A1:B2',AbsoluteRefType.NONE],['A$1:B$2',AbsoluteRefType.ROW],['$A1:$B2',AbsoluteRefType.COLUMN],['$A$1:$B$2',AbsoluteRefType.ALL]]){
  const f=fixture();try{
   const r=deserializeRangeWithSheet(text).range,copy=structuredClone(r),injector=f.univer.__getInjector();assert.equal(r.startAbsoluteRefType,flag);assert.equal(r.endAbsoluteRefType,flag);
   injector.get(IUniverInstanceService).focusUnit(f.unitID);const selections=injector.get(SheetsSelectionsService);selections.setSelections(f.unitID,'sheet-1',[{range:r,primary:{...r,actualRow:0,actualColumn:0,isMerged:false,isMergedMainCell:false},style:null}]);
   assert.equal(await f.commands.executeCommand(AddWorksheetMergeAllCommand.id),true);assert.deepEqual(f.emitted[0].params.ranges,[copy]);assert.deepEqual(r,copy);
   const start=f.emitted.length;assert.equal(await f.commands.executeCommand(RemoveWorksheetMergeCommand.id,{unitId:f.unitID,subUnitId:'sheet-1',ranges:[r]}),true);assert.deepEqual(f.emitted[start].params.ranges,[copy]);
   // Full-row name-box references use the same optional flags; public row
   // commands add row rangeType without removing those flags.
   const row=deserializeRangeWithSheet('$3:$3').range;row.startColumn=0;row.endColumn=25;const at=f.emitted.length;
   assert.equal(await f.commands.executeCommand(InsertRowCommand.id,{unitId:f.unitID,subUnitId:'sheet-1',range:row,direction:0}),true);
   assert.equal(f.emitted[at].id,'sheet.mutation.insert-row');assert.equal(f.emitted[at].params.range.startAbsoluteRefType,row.startAbsoluteRefType);assert.equal(f.emitted[at].params.range.endAbsoluteRefType,row.endAbsoluteRefType);
  }finally{f.dispose();}
 }
});
