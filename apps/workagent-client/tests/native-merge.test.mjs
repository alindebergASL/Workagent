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

import {AddWorksheetMergeHorizontalCommand as Horizontal,AddWorksheetMergeVerticalCommand as Vertical} from '@univerjs/sheets';
test('public horizontal/vertical toolbar preserves distinct strip anchors and unmerges exact rectangle atomically',async()=>{
 for(const horizontal of [true,false]){
  const data=blank(),r=deserializeRangeWithSheet('A1:C2').range;data.sheets['sheet-1'].cellData=horizontal?{0:{0:{v:11}},1:{0:{v:22}}}:{0:{0:{v:11},1:{v:22},2:{v:33}}};
  const f=fixture(data),i=f.univer.__getInjector(),selections=i.get(SheetsSelectionsService);i.get(IUniverInstanceService).focusUnit(f.unitID);
  const select=()=>selections.setSelections(f.unitID,'sheet-1',[{range:r,primary:{...r,actualRow:0,actualColumn:0,isMerged:false,isMergedMainCell:false},style:null}]);select();
  const g=guardNativeMerge(f.unitID,f.commands,f.save,()=>selections.getCurrentSelections().map(s=>s.range),()=>true,()=>{});
  try{const before=f.save().sheets['sheet-1'].cellData;assert.equal(await f.commands.executeCommand((horizontal?Horizontal:Vertical).id),true);
   assert.equal(f.save().sheets['sheet-1'].mergeData.length,horizontal?2:3);assert.deepEqual(f.save().sheets['sheet-1'].cellData,before);
   select();assert.equal(await f.commands.executeCommand(Remove.id),true);assert.deepEqual(f.save().sheets['sheet-1'].mergeData,[]);assert.deepEqual(f.save().sheets['sheet-1'].cellData,before);
  }finally{g.dispose();f.dispose();}
 }
});

import {Dimension} from '@univerjs/core';
test('strip guard rejects lossy content, comments, overlap, unsupported geometry and formatting before primitive writes',async()=>{
 for(const content of [{v:22},{v:''},{f:'=1'},{si:'shared'},{p:{body:{dataStream:'Text\r\n'}}},{ft:1},{fd:'formula'}]){
  const data=blank();data.sheets['sheet-1'].cellData={1:{1:content}};const f=fixture(data),g=guardNativeMerge(f.unitID,f.commands,f.save,()=>[],()=>true,()=>{});
  try{const before=f.save();assert.equal(await f.commands.executeCommand(Add.id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[{startRow:0,endRow:1,startColumn:0,endColumn:2}],value:Dimension.ROWS,defaultMerge:true}),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,0);}finally{g.dispose();f.dispose();}
 }
 const data=blank();data.sheets['sheet-1'].rowCount=200;data.sheets['sheet-1'].columnCount=200;const f=fixture(data);await add(f,'root','owner');const g=guardNativeMerge(f.unitID,f.commands,f.save,()=>[],()=>true,()=>{});
 try{const r={startRow:0,endRow:1,startColumn:0,endColumn:2};
  const bad=[{selections:[r,r],value:Dimension.ROWS},{selections:[{...r,endRow:64}],value:Dimension.ROWS},{selections:[{...r,endColumn:64}],value:Dimension.COLUMNS},{selections:[{...r,endRow:63,endColumn:64}],value:Dimension.ROWS},{selections:[{...r,startRow:7,endRow:8,startColumn:7,endColumn:8}],value:Dimension.ROWS},{selections:[{...r,extra:1}],value:Dimension.ROWS},{selections:[r],value:'ROWS'},{selections:[{...r,endRow:0}],value:Dimension.COLUMNS}];
  for(const params of bad){const before=f.save(),count=f.emitted.length;assert.equal(await f.commands.executeCommand(Add.id,{unitId:f.unitID,subUnitId:'sheet-1',...params,defaultMerge:true}),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,count);}
  assert.equal(await f.commands.executeCommand(Add.id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[r],value:Dimension.ROWS}),true);const before=f.save(),count=f.emitted.length;
  for(const ranges of [[{...r,endColumn:1}],[{...r,endRow:2}],[r,r]]){assert.equal(await f.commands.executeCommand(Remove.id,{unitId:f.unitID,subUnitId:'sheet-1',ranges}),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,count);}
  assert.equal(await f.commands.executeCommand(Add.id,{unitId:f.unitID,subUnitId:'sheet-1',selections:[r],value:Dimension.COLUMNS}),false);assert.deepEqual(f.save(),before);
 }finally{g.dispose();f.dispose();}
 const styled=blank();styled.sheets['sheet-1'].mergeData=[{startRow:0,endRow:0,startColumn:0,endColumn:1},{startRow:1,endRow:1,startColumn:0,endColumn:1}];styled.sheets['sheet-1'].cellData={0:{0:{v:11,s:{bl:1}},1:{s:{bl:1}}},1:{0:{v:22,s:{it:1}},1:{s:{it:1}}}};
 const s=fixture(styled),guard=guardNativeMerge(s.unitID,s.commands,s.save,()=>[],()=>true,()=>{});try{const before=s.save();assert.equal(await s.commands.executeCommand(Remove.id,{unitId:s.unitID,subUnitId:'sheet-1',ranges:[{startRow:0,endRow:1,startColumn:0,endColumn:1}]}),false);assert.deepEqual(s.save(),before);assert.equal(s.emitted.length,0);}finally{guard.dispose();s.dispose();}
});
test('strip merge retains anchor formula/rich text and all styles; current write/input gate still refuses variants',async()=>{
 const data=blank();data.sheets['sheet-1'].cellData={0:{0:{v:11,f:'=1+10',s:{bl:1}},1:{s:{it:1}}},1:{0:{p:{body:{dataStream:'Rich\r\n'}},s:{bg:{rgb:'#abcdef'}}},1:{s:{bl:1}}}};
 const f=fixture(data);let allowed=false;const g=guardNativeMerge(f.unitID,f.commands,f.save,()=>[],()=>allowed,()=>{});
 try{const before=f.save(),params={unitId:f.unitID,subUnitId:'sheet-1',selections:[{startRow:0,endRow:1,startColumn:0,endColumn:1}],value:Dimension.ROWS};assert.equal(await f.commands.executeCommand(Add.id,params),false);assert.deepEqual(f.save(),before);assert.equal(f.emitted.length,0);allowed=true;
 assert.equal(await f.commands.executeCommand(Add.id,params),true);assert.equal(f.emitted.length,1);assert.deepEqual(f.save().sheets['sheet-1'].cellData,before.sheets['sheet-1'].cellData);assert.deepEqual(f.save().styles,before.styles);
 }finally{g.dispose();f.dispose();}
});
