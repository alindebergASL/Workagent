// Actual Univer 1.4 commands/history and NativeEditor. Synthetic headless fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {mountNative} from './sheet-scale-harness.mjs';
import {blankWorkbook,validateWorkbook} from '../../../packages/workagent-contract/index.mjs';
import {withCharts,sheetCharts} from '../../../packages/workagent-contract/sheet-charts.mjs';
const require=createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
const {IUndoRedoService,CanceledError}=require('@univerjs/core');
const {SheetInterceptorService}=require('@univerjs/sheets');
const range={startRow:2,endRow:5,startColumn:2,endColumn:4};
function fixture(){const b=blankWorkbook('structure-charts');b.sheets.sheet1.cellData={2:{2:{v:'Label',t:1,s:'bold'},3:{v:'Value',t:1},4:{v:'Double',t:1}},3:{2:{v:'Zero',t:1},3:{v:0,t:2},4:{f:'=D4*2',v:999}},4:{2:{v:'Negative',t:1},3:{v:-4,t:2},4:{f:'=D5*2',v:999}},5:{2:{v:'Gap',t:1},4:{f:'=1/0',v:999}}};b.styles={bold:{bl:1}};b.sheets.other={...structuredClone(b.sheets.sheet1),id:'other',name:'Other'};b.sheetOrder.push('other');return withCharts(b,[{id:'a',title:'Stable',type:'bar',sheetId:'sheet1',range},{id:'b',title:'Same source',type:'line',sheetId:'sheet1',range},{id:'other',title:'Other',type:'line',sheetId:'other',range}]);}
async function ready(v){for(let i=0;i<200;i++){if(v.handle.charts.view().status==='Live calculated values')return v.handle.charts.view();await delay(20);}assert.fail(v.handle.charts.view().status);}
async function close(v){await delay(1100);v.dispose();}
function operate(s,axis,insert,start,count=1){return axis==='row'?(insert?s.insertRowsBefore(start,count):s.deleteRows(start,count)):(insert?s.insertColumnsBefore(start,count):s.deleteColumns(start,count));}
// Strip only derived formula values/types; authored formulas/styles remain compared.
function authored(b){b=structuredClone(b);for(const s of Object.values(b.sheets))for(const row of Object.values(s.cellData??{}))for(const c of Object.values(row??{}))if(c?.f||c?.si){delete c.v;delete c.t;}return JSON.parse(JSON.stringify(b));}
for(const axis of ['row','col'])test(`installed UI ${axis} confirmation wrapper preserves protected deletion, single history and native cancellation`,async()=>{
 const b=fixture();
 // Formula-free source allows byte-exact refusal checks without calculation noise.
 for(const sheet of Object.values(b.sheets))for(const cells of Object.values(sheet.cellData))for(const cell of Object.values(cells))if(cell.f){delete cell.f;cell.v=8;cell.t=2;}
 const v=mountNative({book:b,version:'ui-confirm-'+axis});
 try{
  await ready(v);
  const {RemoveRowConfirmCommand,RemoveColConfirmCommand}=require('@univerjs/sheets-ui');
  const {SheetsSelectionsService}=require('@univerjs/sheets'),{IConfirmService}=require('@univerjs/core');
  const wrapper=axis==='row'?RemoveRowConfirmCommand:RemoveColConfirmCommand;
  // The harness's installed plugins register these actual UI commands.
  const wb=v.api.getActiveWorkbook(),h=v.injector.get(IUndoRedoService);
  const selections=v.injector.get(SheetsSelectionsService),seen=[],dialogs=[];
  let answer=false;
  v.injector.add([IConfirmService,{useValue:{async confirm(options){dialogs.push(options);return answer;}}}]);
  const trace=v.commands.onCommandExecuted(c=>seen.push(c.id));
  const select=(start,end=start)=>selections.setSelections([{range:axis==='row'
   ?{startRow:start,endRow:end,startColumn:0,endColumn:25}
   :{startRow:0,endRow:199,startColumn:start,endColumn:end},primary:null,style:null}]);
  const bytes=()=>JSON.stringify(v.handle.save());
  try{
   const before=bytes(),status=h.getUndoRedoStatus(wb.getId());
   select(2);await v.commands.executeCommand(wrapper.id);
   assert.equal(bytes(),before,'protected header/label refusal is byte exact');assert.deepEqual(h.getUndoRedoStatus(wb.getId()),status);
   assert.ok(v.messages.some(m=>m.includes('Chart source change refused')));
   select(0);seen.length=0;const edits=v.edits;
   assert.equal(await v.commands.executeCommand(wrapper.id),true);
   const after=bytes(),r=sheetCharts(v.handle.save())[0].range;
   assert.deepEqual(r,axis==='row'?{...range,startRow:1,endRow:4}:{...range,startColumn:1,endColumn:3});
   for(const id of [`sheet.command.remove-${axis}`,`sheet.command.remove-${axis}-by-range`,'sheet.mutation.workagent-chart-structure-begin',axis==='row'?'sheet.mutation.remove-rows':'sheet.mutation.remove-col','sheet.mutation.workagent-charts'])assert.equal(seen.filter(x=>x===id).length,1,`wrapper reaches protected inner ${id} exactly once`);
   assert.equal(v.edits,edits+1);assert.equal(h.getUndoRedoStatus(wb.getId()).undos,status.undos+1);
   await wb.undo();assert.equal(bytes(),before);await wb.redo();assert.equal(bytes(),after);await wb.undo();assert.equal(bytes(),before);
   const stable=h.getUndoRedoStatus(wb.getId()),stableEdits=v.edits;
   for(answer of [false,true]){
    select(0,axis==='row'?199:25);seen.length=0;
    assert.equal(await v.commands.executeCommand(wrapper.id),false,'native all-axis guard returns false for cancel and confirm');
    assert.equal(dialogs.at(-1).id,`sheet.confirm.remove-${axis}`);
    assert.deepEqual(seen,[wrapper.id],'all-axis dialog never reaches inner deletion');assert.equal(bytes(),before);
    assert.deepEqual(h.getUndoRedoStatus(wb.getId()),stable);assert.equal(v.edits,stableEdits);
   }
   assert.equal(dialogs.length,2);
   select(0);seen.length=0;v.handle.charts.stage();
   assert.equal(await v.commands.executeCommand(wrapper.id),false);assert.deepEqual(seen,[],'draft fence precedes wrapper');
   v.handle.charts.cancel();assert.equal(bytes(),before);assert.deepEqual(h.getUndoRedoStatus(wb.getId()),stable);
   assert.equal(await v.commands.executeCommand(wrapper.id),true,'valid operation still works after guards');await wb.undo();assert.equal(bytes(),before);
  }finally{trace.dispose();}
 }finally{await close(v);}
});
for(const axis of ['row','col'])test(`native ${axis} insert/delete exact source edges, one-step history and coherent edit callbacks`,async()=>{
 const edits=[],v=mountNative({book:fixture(),version:axis,onEdit:b=>{if(b)edits.push(structuredClone(b));}});
 try{await ready(v);const wb=v.api.getActiveWorkbook(),s=wb.getActiveSheet(),history=v.injector.get(IUndoRedoService),end=axis==='row'?5:4;
 for(const [insert,start,expected] of [[true,0,[3,end+1]],[true,2,[3,end+1]],[true,3,[2,end+1]],[true,end,[2,end+1]],[true,end+1,[2,end]],[true,end+2,[2,end]],[false,0,[1,end-1]],[false,3,[2,end-1]],[false,end,[2,end-1]],[false,end+1,[2,end]],[false,end+2,[2,end]]]){
  const before=authored(v.handle.save()),h=history.getUndoRedoStatus(wb.getId());edits.length=0;operate(s,axis,insert,start);const saved=v.handle.save(),r=sheetCharts(saved)[0].range;
  assert.deepEqual(axis==='row'?[r.startRow,r.endRow]:[r.startColumn,r.endColumn],expected,`${insert?'insert':'delete'} ${start}`);
  assert.deepEqual(sheetCharts(saved)[2],sheetCharts(before)[2]);assert.deepEqual(authored(saved).sheets.other,before.sheets.other);assert.deepEqual(sheetCharts(saved)[1].range,r);validateWorkbook(saved);
  assert.equal(history.getUndoRedoStatus(wb.getId()).undos,h.undos+1);assert.equal(edits.length,1,'publish one complete authored change');assert.deepEqual(sheetCharts(edits[0]),sheetCharts(saved));validateWorkbook(edits[0]);
  await wb.undo();assert.deepEqual(authored(v.handle.save()),before);await wb.redo();assert.deepEqual(authored(v.handle.save()),authored(saved));await wb.undo();
 }
 }finally{await close(v);}
});
test('formula-backed chart sources survive structure, canonical save/read and cold SDK reopen',async()=>{
 let v=mountNative({book:fixture(),version:'formula'}),saved;
 try{await ready(v);const s=v.api.getActiveWorkbook().getActiveSheet();s.insertRowsBefore(2,2);s.insertColumnsBefore(2,1);let state=await ready(v);assert.deepEqual(state.data.a.labels,['Zero','Negative','Gap']);assert.deepEqual(state.data.a.series.map(s=>[s.name,s.values]),[['Value',[0,-4,null]],['Double',[0,-8,null]]]);s.getRange('E7').setValue(6);state=await ready(v);assert.deepEqual(state.data.a.series[1].values,[0,12,null]);saved=JSON.parse(JSON.stringify(await v.handle.commit()));validateWorkbook(saved);assert.equal(saved.sheets.sheet1.cellData[6][5].f,'=E7*2');}finally{await close(v);}
 v=mountNative({book:saved,version:'cold'});try{const state=await ready(v);assert.deepEqual(state.data.a.series[1].values,[0,12,null]);assert.deepEqual(sheetCharts(v.handle.save()),sheetCharts(saved));assert.equal(v.edits,0);}finally{await close(v);}
});
test('heading/empty/cap/bounds/partial-range/direct mutation refusals preserve all state and history, then valid operation works',async()=>{
 const v=mountNative({book:fixture(),version:'refusal'});
 try{await ready(v);const wb=v.api.getActiveWorkbook(),s=wb.getActiveSheet(),h=v.injector.get(IUndoRedoService);
 const bad=[()=>s.deleteRows(2,1),()=>s.deleteColumns(2,1),()=>s.deleteRows(3,3),()=>s.deleteColumns(3,2),()=>s.insertRowsBefore(3,100),()=>s.insertColumnsBefore(3,4),()=>s.deleteRows(0,200),()=>s.deleteColumns(0,26),()=>s.deleteRows(3,0),()=>s.deleteRows(3,-1),()=>s.deleteRows(-1,1),()=>s.deleteRows(199,2),()=>s.insertRowsBefore(3,10000),()=>v.commands.syncExecuteCommand('sheet.command.insert-row-by-range',{unitId:wb.getId(),subUnitId:'sheet1',direction:0,range:{startRow:3,endRow:3,startColumn:1,endColumn:2}}),()=>v.commands.syncExecuteCommand('sheet.mutation.remove-rows',{unitId:wb.getId(),subUnitId:'sheet1',range:{startRow:0,endRow:0,startColumn:0,endColumn:25}})];
 for(const fn of bad){const before=authored(v.handle.save()),status=h.getUndoRedoStatus(wb.getId());try{await fn();}catch{}assert.deepEqual(authored(v.handle.save()),before);assert.deepEqual(h.getUndoRedoStatus(wb.getId()),status);}
 s.insertRowsBefore(0,1);assert.equal(sheetCharts(v.handle.save())[0].range.startRow,3);await wb.undo();assert.equal(sheetCharts(v.handle.save())[0].range.startRow,2);
 v.handle.charts.stage();const before=authored(wb.save());s.insertRowsBefore(0,1);assert.deepEqual(authored(wb.save()),before);v.handle.charts.cancel();
 }finally{await close(v);}
});

test('merged stripes and a second overcap chart refuse atomically; unrelated merge/control/CF follow native history',async()=>{
 const b=fixture();b.sheets.sheet1.mergeData=[{startRow:10,endRow:11,startColumn:10,endColumn:11}];
 b.resources.push({name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet1:[{uid:'list',type:'list',formula1:'["One","Two"]',ranges:[{startRow:12,endRow:13,startColumn:12,endColumn:12}]},{uid:'check',type:'checkbox',ranges:[{startRow:14,endRow:14,startColumn:12,endColumn:12}]}]})});
 b.resources.push({name:'SHEET_CONDITIONAL_FORMATTING_PLUGIN',data:JSON.stringify({sheet1:[{cfId:'cf',stopIfTrue:false,ranges:[{startRow:12,endRow:13,startColumn:12,endColumn:12}],rule:{type:'highlightCell',subType:'number',operator:'greaterThan',value:5,style:{bg:{rgb:'#ff0000'}}}}]})});
 // Confirm the resource names match production validation, not silent opaque fixtures.
 const {CONDITIONAL_RESOURCE,conditionalRules}=await import('../../../packages/workagent-contract/conditional-formatting.mjs');
 b.resources.at(-1).name=CONDITIONAL_RESOURCE;
 const v=mountNative({book:b,version:'resources'});
 try{await ready(v);const wb=v.api.getActiveWorkbook(),s=wb.getActiveSheet();const before=authored(v.handle.save());
 for(const fn of [()=>s.insertRowsBefore(11,1),()=>s.deleteRows(10,1),()=>s.insertColumnsBefore(11,1),()=>s.deleteColumns(10,1)]){try{fn();}catch{}assert.deepEqual(authored(v.handle.save()),before);}
 s.insertRowsBefore(0,1);const saved=v.handle.save();assert.equal(saved.sheets.sheet1.mergeData[0].startRow,11);assert.equal(conditionalRules(saved).sheet1[0].ranges[0].startRow,13);validateWorkbook(saved);await wb.undo();assert.deepEqual(authored(v.handle.save()),before);await wb.redo();assert.deepEqual(authored(v.handle.save()),authored(saved));await wb.undo();
 const definitions=sheetCharts(v.handle.save());definitions[1].range={startRow:1,endRow:101,startColumn:2,endColumn:4};v.handle.charts.put(definitions[1]);const capped=authored(v.handle.save());s.insertRowsBefore(3,1);assert.deepEqual(authored(v.handle.save()),capped,'later chart prevents any earlier chart/cell/resource change');
 }finally{await close(v);}
});
test('history aggregate preflight rejects bypasses before any cell write and keeps redo usable',async()=>{
 const v=mountNative({book:fixture(),version:'history'});
 try{await ready(v);const wb=v.api.getActiveWorkbook(),s=wb.getActiveSheet(),h=v.injector.get(IUndoRedoService);s.insertRowsBefore(0,1);wb.undo();
 const entry=h.pitchTopRedoElement(),axis=entry.redoMutations.find(m=>m.id==='sheet.mutation.insert-row'),original=axis.params.range;axis.params.range={...original,startRow:2,endRow:2};
 const before=authored(v.handle.save()),status=h.getUndoRedoStatus(wb.getId());wb.redo();assert.deepEqual(authored(v.handle.save()),before);assert.deepEqual(h.getUndoRedoStatus(wb.getId()),status);axis.params.range=original;wb.redo();assert.equal(sheetCharts(v.handle.save())[0].range.startRow,3);
 const undo=h.pitchTopUndoElement();undo.undoMutations.unshift({id:'sheet.mutation.set-range-values',params:{unitId:wb.getId(),subUnitId:'sheet1',cellValue:{0:{0:{v:'MUST NOT WRITE',t:1}}}}});const stable=authored(v.handle.save());wb.undo();assert.deepEqual(authored(v.handle.save()),stable);undo.undoMutations.shift();wb.undo();assert.deepEqual(authored(v.handle.save()),before);
 }finally{await close(v);}
});
test('no-chart structure is unchanged and a disposed chart controller cannot affect another workbook',async()=>{
 const b=fixture();b.resources=[];const a=mountNative({book:b,version:'plain'}),v=mountNative({book:fixture(),version:'charts'});
 try{await ready(v);await a.settle();const wb=a.api.getActiveWorkbook(),s=wb.getActiveSheet();s.deleteRows(2,1);assert.equal(a.handle.save().sheets.sheet1.rowCount,199);wb.undo();assert.equal(a.handle.save().sheets.sheet1.rowCount,200);
 v.handle.charts.dispose();s.insertColumnsBefore(0,1);assert.equal(a.handle.save().sheets.sheet1.columnCount,27);wb.undo();assert.equal(a.handle.save().sheets.sheet1.columnCount,26);
 }finally{await close(a);await close(v);}
});
test('append boundary, zero-sized uncharted tab and synchronous save gate',async()=>{
 const b=fixture();b.sheets.tiny={...structuredClone(b.sheets.sheet1),id:'tiny',name:'Tiny',rowCount:1,columnCount:1,cellData:{}};b.sheetOrder.push('tiny');
 const v=mountNative({book:b,version:'boundary'});
 try{await ready(v);const wb=v.api.getActiveWorkbook(),s=wb.getActiveSheet();let observed=0;const subscription=v.commands.onCommandExecuted(c=>{if(c.id==='sheet.mutation.insert-row'){observed++;assert.throws(()=>v.handle.save(),/structure change/);}});
 s.insertRowsAfter(199,2);subscription.dispose();assert.equal(observed,1);assert.equal(v.handle.save().sheets.sheet1.rowCount,202);assert.deepEqual(sheetCharts(v.handle.save()),sheetCharts(b));wb.undo();
 const before=authored(v.handle.save());wb.getSheetBySheetId('tiny').deleteRows(0,1);assert.deepEqual(authored(v.handle.save()),before);wb.getSheetBySheetId('tiny').deleteColumns(0,1);assert.deepEqual(authored(v.handle.save()),before);s.insertRowsBefore(0,1);assert.equal(sheetCharts(v.handle.save())[0].range.startRow,3);
 }finally{await close(v);}
});
test('async native commands and multi-row deletion contract the tail without losing source identity',async()=>{
 const {Direction}=require('@univerjs/core'),v=mountNative({book:fixture(),version:'async'});
 try{await ready(v);const wb=v.api.getActiveWorkbook(),params={unitId:wb.getId(),subUnitId:'sheet1',direction:Direction.UP,range:{startRow:0,endRow:1,startColumn:0,endColumn:25}};
 assert.equal(await v.api.executeCommand('sheet.command.insert-row',params),true);assert.equal(sheetCharts(v.handle.save())[0].range.startRow,4);wb.undo();
 assert.equal(await v.api.executeCommand('sheet.command.remove-row',{unitId:wb.getId(),subUnitId:'sheet1',range:{startRow:4,endRow:7,startColumn:0,endColumn:25}}),true);assert.deepEqual(sheetCharts(v.handle.save())[0].range,{...range,endRow:3});assert.deepEqual((await ready(v)).data.a.series[1].values,[0]);wb.undo();assert.deepEqual((await ready(v)).data.a.series[1].values,[0,-8,null]);
 }finally{await close(v);}
});
test('canonical human save after structure leaves pending chart/cell proposals unchanged and stale',async()=>{
 const {Workspace}=await import('../../workagent-server/src/workspace.mjs'),{initialState}=await import('../../workagent-server/src/store.mjs');
 const state=initialState('owner'),ws=new Workspace({read:async fn=>fn(state),transaction:async fn=>fn(state)}),{workId}=await ws.createBlank('owner',{commandId:'new',title:'Synthetic structural work'});
 const b=fixture();b.id=workId;await ws.save('owner',workId,{commandId:'seed',book:b,contentRevision:1,permissionRevision:1});const before=await ws.get('owner',workId);
 await ws.mutate('owner',workId,{commandId:'chart-proposal',expected:before.expected,patch:{cells:[],chartOps:[{op:'update',chart:{...sheetCharts(b)[0],title:'Pending only'}}]}});
 await ws.mutate('owner',workId,{commandId:'cell-proposal',expected:before.expected,patch:{cells:[{sheetId:'sheet1',row:3,column:3,value:99}],chartOps:[{op:'update',chart:{...sheetCharts(b)[1],title:'Another pending'}}]}});
 const pending=structuredClone((await ws.get('owner',workId)).proposals),v=mountNative({book:before.book,version:'pending'});
 try{await ready(v);v.api.getActiveWorkbook().getActiveSheet().insertRowsBefore(0,1);const saved=await v.handle.commit();await ws.save('owner',workId,{commandId:'structure-save',book:saved,contentRevision:before.contentRevision,permissionRevision:1});const current=await ws.get('owner',workId);assert.deepEqual(current.proposals,pending);assert.equal(sheetCharts(current.book)[0].title,'Stable');assert.equal(sheetCharts(current.book)[0].range.startRow,3);validateWorkbook(current.book);
 const {createSheetReader}=await import('../../workagent-runner/src/sheet-read.mjs');const overview=JSON.parse(createSheetReader(workId)(current,JSON.stringify({overview:true})));assert.ok(JSON.stringify(overview).includes('Stable'));
 for(const p of pending)await assert.rejects(ws.decide('owner',workId,p.id,{commandId:'stale-'+p.id,expected:current.expected,decision:'accept'}),/conflict|stale/);assert.deepEqual((await ws.get('owner',workId)).proposals,pending);
 }finally{await close(v);}
});

function recoveryFixture(){
 const b=fixture();
 b.sheets.sheet1.mergeData=[{startRow:10,endRow:11,startColumn:10,endColumn:11}];
 b.sheets.sheet1.rowData={12:{h:33}};b.sheets.sheet1.columnData={12:{w:123}};
 b.sheets.sheet1.cellData[15]={0:{f:'=D4*3',si:'shared',v:999},1:{si:'shared',v:999}};
 b.resources.push({name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet1:[{uid:'list',type:'list',formula1:'["One","Two"]',ranges:[{startRow:12,endRow:13,startColumn:12,endColumn:12}]}]})});
 b.resources.push({name:'SHEET_CONDITIONAL_FORMATTING_PLUGIN',data:JSON.stringify({sheet1:[{cfId:'cf',stopIfTrue:false,ranges:[{startRow:12,endRow:13,startColumn:12,endColumn:12}],rule:{type:'highlightCell',subType:'number',operator:'greaterThan',value:5,style:{bg:{rgb:'#ff0000'}}}}]})});
 return b;
}
function liveAuthored(wb){return Object.fromEntries(wb.getSheets().map(s=>[s.getSheetId(),authored({sheets:{s:{cellData:s.getSheet().getCellMatrix().getMatrix()}}}).sheets.s.cellData]));}
for(const mode of ['chart-cancel','chart-throw','after-throw','after-step-cancel','insert-col-cancel','remove-row-cancel','remove-col-cancel','undo-cancel','undo-throw','redo-cancel','redo-throw'])test(`structural transaction restores live cells/resources/provenance/history after ${mode}`,async()=>{
 const v=mountNative({book:recoveryFixture(),version:mode});
 try{
  await ready(v);const wb=v.api.getActiveWorkbook(),s=wb.getActiveSheet(),h=v.injector.get(IUndoRedoService);
  s.getRange('A19').setValue('unrelated human edit');
  if(mode.startsWith('undo')||mode.startsWith('redo'))s.insertRowsBefore(0,1);
  if(mode.startsWith('redo'))await wb.undo();
  await ready(v);
  const before=authored(v.handle.save()),live=liveAuthored(wb),status=h.getUndoRedoStatus(wb.getId()),edits=v.edits,formats=structuredClone(v.handle.formatEdits());
  const undo=h.pitchTopUndoElement(),redo=h.pitchTopRedoElement();
  const failure=new Error('synthetic structural failure');let once=false;
  const hook=mode==='after-throw'?v.injector.get(SheetInterceptorService).interceptAfterCommand({getMutations:c=>{if(c.id==='sheet.command.insert-row')throw failure;return {redos:[],undos:[]};}}):v.commands.beforeCommandExecuted(c=>{if(c.id===(mode==='after-step-cancel'?'sheet.mutation.restore-human-provenance':'sheet.mutation.workagent-charts')&&!once){once=true;throw mode.endsWith('throw')?failure:new CanceledError();}});
  let caught;
  try{if(mode.startsWith('undo'))await wb.undo();else if(mode.startsWith('redo'))await wb.redo();else if(mode==='insert-col-cancel')s.insertColumnsBefore(0,1);else if(mode==='remove-row-cancel')s.deleteRows(3,1);else if(mode==='remove-col-cancel')s.deleteColumns(3,1);else s.insertRowsBefore(0,1);}catch(e){caught=e;}finally{hook.dispose();}
  if(mode.endsWith('throw'))assert.equal(caught,failure,'retain original exception');else assert.equal(caught,undefined);
  assert.equal(v.handle.charts.structurePending,false);
  assert.deepEqual(authored(v.handle.save()),before,'exact authored book and resources');
  assert.deepEqual(liveAuthored(wb),live,'actual live SDK cells, including shared formulas');
  assert.deepEqual(h.getUndoRedoStatus(wb.getId()),status);assert.equal(h.pitchTopUndoElement(),undo);assert.equal(h.pitchTopRedoElement(),redo);
  assert.deepEqual(v.handle.formatEdits(),formats,'human formatting ownership restored');assert.equal(v.edits,edits,'no half-state notification');
  await ready(v);assert.deepEqual(authored(v.handle.save()),before,'calculation cannot reintroduce partial state');
  if(mode.startsWith('undo')){await wb.undo();await wb.redo();assert.deepEqual(authored(v.handle.save()),before);}
  else if(mode.startsWith('redo')){await wb.redo();await wb.undo();assert.deepEqual(authored(v.handle.save()),before);}
  s.insertRowsBefore(0,1);const complete=authored(v.handle.save());await wb.undo();assert.deepEqual(authored(v.handle.save()),before);await wb.redo();assert.deepEqual(authored(v.handle.save()),complete);await wb.undo();
  assert.equal(s.getRange(mode.startsWith('undo')?'A20':'A19').getValue(),'unrelated human edit');
 }finally{await close(v);}
});
test('entire structural history payload is sealed, including ownership, plans and affiliated merges',async()=>{
 const v=mountNative({book:recoveryFixture(),version:'sealed'});
 try{await ready(v);const wb=v.api.getActiveWorkbook(),s=wb.getActiveSheet(),h=v.injector.get(IUndoRedoService);
 const params={unitId:wb.getId(),subUnitId:'sheet1',ranges:[{startRow:30,endRow:31,startColumn:10,endColumn:11}]};
 const affiliate=v.injector.get(SheetInterceptorService).interceptCommand({getMutations:c=>c.id==='sheet.command.insert-row'?{redos:[{id:'sheet.mutation.add-worksheet-merge',params:structuredClone(params)}],undos:[{id:'sheet.mutation.remove-worksheet-merge',params:structuredClone(params)}]}:{redos:[],undos:[]}});
 s.insertRowsBefore(0,1);affiliate.dispose();await wb.undo();
 const entry=h.pitchTopRedoElement(),before=authored(v.handle.save()),status=h.getUndoRedoStatus(wb.getId()),edits=v.edits;
 const chart=entry.redoMutations.find(m=>m.id==='sheet.mutation.workagent-charts'),plan=entry.redoMutations[0],merge=entry.redoMutations.find(m=>/worksheet-merge$/.test(m.id));assert.ok(merge);
 const mutations=[()=>{chart.params.unitId='wrong';},()=>{plan.params.after[0].range.startRow++;},()=>{merge.params.unitId='wrong';},()=>{merge.params.ranges=[];},()=>{entry.unitID='wrong';},()=>{entry.redoMutations.splice(0,entry.redoMutations.length,{id:'sheet.mutation.set-range-values',params:{unitId:wb.getId(),subUnitId:'sheet1',cellValue:{0:{0:{v:'bad'}}}}});},()=>{entry.redoMutations.push({id:'sheet.mutation.set-range-values',params:{unitId:'wrong',subUnitId:'sheet1',cellValue:{0:{0:{v:'bad'}}}}});}];
 for(const tamper of mutations){
  const owner=entry.unitID,list=entry.redoMutations.slice(),copies=list.map(m=>structuredClone(m.params));tamper();await wb.redo();
  assert.deepEqual(authored(v.handle.save()),before);assert.deepEqual(h.getUndoRedoStatus(wb.getId()),status);assert.equal(v.edits,edits);assert.equal(v.handle.charts.structurePending,false);
  entry.unitID=owner;entry.redoMutations.splice(0,entry.redoMutations.length,...list);list.forEach((m,i)=>{for(const k of Object.keys(m.params))delete m.params[k];Object.assign(m.params,copies[i]);});
 }
 await wb.redo();assert.equal(sheetCharts(v.handle.save())[0].range.startRow,3);await wb.undo();assert.deepEqual(authored(v.handle.save()),before);
 }finally{await close(v);}
});
