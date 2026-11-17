// Public SDK commands with production instance guard. No transport/browser proof.
import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,blank,add} from '../../workagent-server/tests/native-comments-sdk.test.mjs';
import {deserializeRangeWithSheet} from '@univerjs/engine-formula';
import {guardNativeMerge} from '../src/native-merge.ts';
import {AddWorksheetMergeCommand as Add,RemoveWorksheetMergeCommand as Remove} from '@univerjs/sheets';
const range={startRow:0,endRow:0,startColumn:0,endColumn:1};
test('native toolbar command guard allows lossless merge/unmerge and refuses loss before any mutation',async()=>{
 const data=blank();data.sheets['sheet-1'].cellData={0:{0:{v:11},1:{v:22}}};const f=fixture(data),messages=[];let allowed=true;
 const g=guardNativeMerge(f.unitID,f.commands,f.save,()=>[range],()=>allowed,m=>messages.push(m));
 try{const before=f.save();assert.equal(await f.commands.executeCommand(Add.id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[range],defaultMerge:true}),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,0);assert.match(messages.at(-1),/discard/);
 const r={...range,startRow:2,endRow:2};assert.equal(await f.commands.executeCommand(Add.id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[r]}),true);assert.equal(await f.commands.executeCommand(Remove.id,{unitId:f.unitID,subUnitId:'sheet-1',ranges:[r]}),true);
 allowed=false;const count=f.emitted.length;assert.equal(await f.commands.executeCommand(Add.id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[r]}),false);assert.equal(f.emitted.length,count);
 }finally{g.dispose();f.dispose();}
});
test('comment anchors and nonuniform unmerge formatting refuse atomically; disposal removes only own guard',async()=>{
 const data=blank();data.sheets['sheet-1'].mergeData=[range];data.sheets['sheet-1'].cellData={0:{0:{v:11,s:{bg:{rgb:'#112233'}}},1:{s:{bg:{rgb:'#445566'}}}}};const f=fixture(data),messages=[];
 await add(f,'root','owner');const g=guardNativeMerge(f.unitID,f.commands,f.save,()=>[range],()=>true,m=>messages.push(m));
 try{let before=f.save(),count=f.emitted.length;assert.equal(await f.commands.executeCommand(Remove.id,{unitId:f.unitID,subUnitId:'sheet-1',ranges:[range]}),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,count);assert.match(messages.at(-1),/formatting/);
 const r={startRow:8,endRow:8,startColumn:7,endColumn:8};assert.equal(await f.commands.executeCommand(Add.id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[r]}),false);assert.equal(f.emitted.length,count);assert.match(messages.at(-1),/comment anchor/);
 g.dispose();assert.equal(await f.commands.executeCommand(Remove.id,{unitId:f.unitID,subUnitId:'sheet-1',ranges:[range]}),true);
 }finally{g.dispose();f.dispose();}
});

import {AddWorksheetMergeAllCommand,SheetsSelectionsService} from '@univerjs/sheets';
import {IUniverInstanceService} from '@univerjs/core';
test('public dropdown merge-all and unmerge consume realistic current selections under the production guard',async()=>{
 const data=blank();data.sheets['sheet-1'].cellData={0:{0:{v:11}}};const f=fixture(data),injector=f.univer.__getInjector(),selections=injector.get(SheetsSelectionsService);
 injector.get(IUniverInstanceService).focusUnit(f.unitID);
 const r=deserializeRangeWithSheet('A1:B2').range,select=()=>selections.setSelections(f.unitID,'sheet-1',[{range:r,primary:{...r,actualRow:0,actualColumn:0,isMerged:false,isMergedMainCell:false},style:null}]);select();
 const g=guardNativeMerge(f.unitID,f.commands,f.save,()=>selections.getCurrentSelections().map(s=>s.range),()=>true,()=>{});
 try{assert.equal(await f.commands.executeCommand(AddWorksheetMergeAllCommand.id),true);assert.deepEqual(f.save().sheets['sheet-1'].mergeData,[r]);select();assert.equal(await f.commands.executeCommand(Remove.id),true);assert.deepEqual(f.save().sheets['sheet-1'].mergeData,[]);assert.equal(f.book.getActiveSheet().getCellRaw(0,0).v,11);}
 finally{g.dispose();f.dispose();}
});
import {InsertRowCommand,RemoveRowCommand} from '@univerjs/sheets';
import {Direction} from '@univerjs/core';
test('unsupported row crossing refuses before first primitive mutation; remote and outside changes are not blocked',async()=>{
 const data=blank();data.sheets['sheet-1'].mergeData=[{startRow:0,endRow:2,startColumn:0,endColumn:1}];const f=fixture(data),messages=[];
 const g=guardNativeMerge(f.unitID,f.commands,f.save,()=>[],()=>true,m=>messages.push(m));
 try{for(const id of [InsertRowCommand.id,RemoveRowCommand.id]){const before=f.save(),count=f.emitted.length;assert.equal(await f.commands.executeCommand(id,{unitId:f.unitID,subUnitId:'sheet-1',range:{startRow:1,endRow:1,startColumn:0,endColumn:25},direction:Direction.UP}),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,count);assert.match(messages.at(-1),/No row change/);}
 assert.equal(await f.commands.executeCommand(InsertRowCommand.id,{unitId:f.unitID,subUnitId:'sheet-1',range:{startRow:0,endRow:0,startColumn:0,endColumn:25},direction:Direction.UP}),true);
 }finally{g.dispose();f.dispose();}
});

test('public reference flag variants pass unchanged; malformed metadata refuses merge/unmerge/row commands before mutations',async()=>{
 const data=blank();data.sheets['sheet-1'].cellData={};const f=fixture(data),messages=[];
 const g=guardNativeMerge(f.unitID,f.commands,f.save,()=>[],()=>true,m=>messages.push(m));
 try{
  for(const text of ['A$1:B$2','$A1:$B2','$A$1:$B$2','A1:$B$2']){
   const r=deserializeRangeWithSheet(text).range,before=structuredClone(r);
   assert.equal(await f.commands.executeCommand(Add.id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[r]}),true);assert.deepEqual(r,before);
   assert.equal(await f.commands.executeCommand(Remove.id,{unitId:f.unitID,subUnitId:'sheet-1',ranges:[r]}),true);
  }
  const r=deserializeRangeWithSheet('A1:B2').range;
  for(const metadata of [{startAbsoluteRefType:4},{endAbsoluteRefType:-1},{startAbsoluteRefType:'0'},{endAbsoluteRefType:null},{startAbsoluteRefType:true},{endAbsoluteRefType:0.5},{startAbsoluteRefType:{}},{endAbsoluteRefType:[]},{unexpectedRangeFlag:0}]){
   for(const id of [Add.id,Remove.id,InsertRowCommand.id,RemoveRowCommand.id]){
    const before=f.save(),count=f.emitted.length,bad={...r,...metadata};
    assert.equal(await f.commands.executeCommand(id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[bad],ranges:[bad],range:bad,direction:Direction.UP}),false,JSON.stringify({id,metadata}));assert.equal(f.emitted.length,count);assert.deepEqual(f.save(),before);
   }
  }
 }finally{g.dispose();f.dispose();}
});
