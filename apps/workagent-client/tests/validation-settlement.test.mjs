// Real installed SDK commands and production NativeEditor/App. Component registry,
// React rendering, native form scheduling and DOM are stubbed; no browser claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { mountNative, mountApp, memoryStorage } from './sheet-scale-harness.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { sheetControls } from '../../../packages/workagent-contract/sheet-controls.mjs';
const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-data-validation'));
require('@univerjs/sheets-data-validation/facade');
const sdk = require('@univerjs/sheets-data-validation'), core = require('@univerjs/core');
const plugins = [require('@univerjs/data-validation').UniverDataValidationPlugin, sdk.UniverSheetsDataValidationPlugin];
test('matching authoritative type change cannot retire newer same-UID input or another rule', async () => {
 const state=initialState('owner'),ws=new Workspace({transaction:async f=>f(state),read:async f=>f(state)});
 const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Concurrent input'});
 state.works[workId].book.sheets.sheet1.cellData={0:{2:{f:'=1+2'}}};
 const view=mountNative({book:(await ws.get('owner',workId)).book,version:'newer'},plugins);
 try {
  await view.settle();const sheet=view.api.getActiveWorkbook().getActiveSheet();
  sheet.getRange('A1').setDataValidation(view.api.newDataValidation().requireValueInList(['Old']).build());
  sheet.getRange('D1').setDataValidation(view.api.newDataValidation().requireCheckbox().build());
  const rules=sheetControls(view.handle.save()).sheet1;
  const id={unitId:workId,subUnitId:'sheet1',ruleId:rules.find(r=>r.type==='list').uid};
  const other={...id,ruleId:rules.find(r=>r.type==='checkbox').uid};
  view.formulaInput({...id,onChange:()=>{}}).onChange({formula1:'["Pending old"]',formula2:''});
  view.validation.gate.mark(other,0,{formula1:'Other yes',formula2:'Other no'});
  const subscription=view.commands.beforeCommandExecuted(command=>{
   if(command.id==='data-validation.mutation.updateRule'&&command.params.ruleId===id.ruleId) view.validation.gate.mark(id,0,{formula1:'New yes',formula2:'New no'});
  });
  await view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...id,setting:{type:'checkbox',formula1:'TRUE',formula2:'FALSE'}});
  subscription.dispose();
  assert.equal(view.validation.gate.pending,true);
  await view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...other,setting:{type:'checkbox',formula1:'Other yes',formula2:'Other no'}});
  assert.equal(view.validation.gate.pending,true,'newer input on same UID survived the earlier transition');
  await view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...id,setting:{type:'checkbox',formula1:'New yes',formula2:'New no'}});
  assert.equal(view.validation.gate.pending,false);await view.handle.commit();
 } finally { view.dispose(); }
});
for (const action of ['remove', 'change-type', 'remove-undo', 'change-type-undo', 'setting-undo']) test(`authoritative ${action} retires only superseded input and fences its real 1000ms debounce`, async () => {
 const state=initialState('owner'), ws=new Workspace({transaction:async f=>f(state),read:async f=>f(state)});
 const {workId}=await ws.createBlank('owner',{commandId:'new',title:action});
 state.works[workId].book.sheets.sheet1.cellData={0:{2:{f:'=1+2'}}};
 const view=mountNative({book:(await ws.get('owner',workId)).book,version:action},plugins);
 try {
  await view.settle();const wb=view.api.getActiveWorkbook(),sheet=wb.getActiveSheet();
  sheet.getRange('A1').setDataValidation(view.api.newDataValidation().requireValueInList(['Old']).build());
  const id={unitId:workId,subUnitId:'sheet1',ruleId:sheetControls(view.handle.save()).sheet1[0].uid};
  if(action==='setting-undo') await view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...id,setting:{type:'list',formula1:'["Applied"]',formula2:''}});
  const execute=core.debounce(value=>view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...id,setting:{type:'list',...value}}),1000);
  view.formulaInput({...id,onChange:execute}).onChange({formula1:'["Queued old input"]',formula2:''});
  const waiting=view.handle.commit();
  if(action.startsWith('remove')) sheet.getRange('A1').setDataValidation(null);
  else if(action.startsWith('change-type')) await view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...id,setting:{type:'checkbox',formula1:'TRUE',formula2:'FALSE'}});
  if(action.endsWith('undo')) await wb.undo();
  await waiting;
  assert.equal(view.validation.gate.pending,false);
  const intended=sheetControls(await view.handle.commit());
  if(action==='remove') assert.deepEqual(intended,{});
  else if(action==='change-type') assert.equal(intended.sheet1[0].type,'checkbox');
  else assert.equal(intended.sheet1[0].formula1,'["Old"]');
  // A new edit on the restored/retyped UID has its own ticket, even if its
  // text is identical to the now-retired input. Old timer cannot settle it.
  if(action!=='remove') {
   let latest;
   view.formulaInput({...id,onChange:value=>{latest=value;}}).onChange({formula1:action==='change-type'?'Yes':'["Queued old input"]',formula2:action==='change-type'?'No':''});
   await delay(1100);
   assert.equal(view.validation.gate.pending,true);
   assert.deepEqual(sheetControls(wb.save()),intended);
   await view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...id,setting:{type:action==='change-type'?'checkbox':'list',...latest}});
   assert.equal(view.validation.gate.pending,false);await view.handle.commit();
  } else { await delay(1100);assert.deepEqual(sheetControls(await view.handle.commit()),{}); }
 } finally { await delay(1100);view.dispose(); }
});
test('pending native list input gates already-dirty Save, concurrent commit, exact retry and navigation capture', async () => {
 const state=initialState('owner'), ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
 const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Rules'});
 const other=(await ws.createBlank('owner',{commandId:'other',title:'Other'})).workId;
 state.works[workId].book.sheets.sheet1.cellData={0:{2:{f:'=1+2'}}};
 const calls=[], storage=memoryStorage(); let loseAck=true;
 const app=mountApp(storage,async(url,options)=>{
  let result; const input=options.body&&JSON.parse(options.body);
  if(url==='/api/work')result=[{id:workId,title:'Rules',status:'ready'},{id:other,title:'Other',status:'ready'}];
  else if(url==='/api/events')result={kind:'reset',cursor:1,events:[],works:[],snapshots:[]};
  else if(url.endsWith('/save')){calls.push(input);result=await ws.save('owner',workId,input);if(loseAck){loseAck=false;throw Error('lost ACK');}}
  else result=await ws.get('owner',url.split('/').at(-1));
  return {ok:true,status:200,json:async()=>structuredClone(result)};
 });
 let view;
 try {
  await app.open(workId);view=mountNative(app.native(),plugins);await view.settle();
  const sheet=view.api.getActiveWorkbook().getActiveSheet();
  sheet.getRange('A1:A3').setDataValidation(view.api.newDataValidation().requireValueInList(['Ready','Waiting']).build());
  sheet.getRange('B1').setValue('already dirty');await app.flush();
  const uid=sheetControls(view.handle.save()).sheet1[0].uid;
  const id={unitId:workId,subUnitId:'sheet1',ruleId:uid};
  const nativeDebounce=core.debounce(params=>view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,params),1000);
  const schedule=(labels)=>{
   const value={formula1:JSON.stringify(labels),formula2:''};
   const input=view.formulaInput({...id,value:{},onChange:next=>nativeDebounce({...id,setting:{type:'list',...next}})});
   input.onChange(value);
  };
  schedule(['Ready now','Waiting']);
  assert.equal(view.handle.isEditing(),true);assert.throws(()=>view.handle.save(),/still finishing/);
  const concurrent=view.handle.commit();await app.save();assert.equal(calls.length,0);
  assert.equal(sheetControls(await concurrent).sheet1[0].formula1,'["Ready now","Waiting"]');
  await delay(100);await app.flush();assert.equal(calls.length,1);assert.equal(sheetControls(calls[0].book).sheet1[0].formula1.includes('Ready now'),true);
  await app.save();await delay(30);await app.flush();assert.deepEqual(calls[1],calls[0]);
  schedule(['Navigation latest','Waiting']);await app.open(other);assert.equal(app.native().book.id,workId);
  await delay(1100);await app.flush();assert.equal(app.native().book.id,other);
  assert.ok(storage.usage().artifactPayloads.some(p=>p.key.includes(workId)));
  view.dispose();view=null;await app.open(workId);
  assert.equal(sheetControls(app.native().book).sheet1[0].formula1,'["Navigation latest","Waiting"]');
 }finally{if(view){await delay(1100);view.dispose();}app.unmount();}
});
test('matching range/checkbox mutations settle; timeout, wrong identity and disposal preserve pending input', async()=>{
 const state=initialState('owner'),ws=new Workspace({transaction:async f=>f(state),read:async f=>f(state)});
 const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Gate'});
 state.works[workId].book.sheets.sheet1.cellData={0:{2:{f:'=1+2'}}};
 const view=mountNative({book:(await ws.get('owner',workId)).book,version:'test'},plugins);
 try{
  await view.settle();const sheet=view.api.getActiveWorkbook().getActiveSheet();
  sheet.getRange('A1').setDataValidation(view.api.newDataValidation().requireCheckbox().build());
  const id={unitId:workId,subUnitId:'sheet1',ruleId:sheetControls(view.handle.save()).sheet1[0].uid};
  const ranges=[{startRow:0,endRow:2,startColumn:0,endColumn:0}];
  view.validation.gate.mark(id,1,{ranges});const waiting=view.handle.commit();
  await view.api.executeCommand(sdk.UpdateSheetDataValidationRangeCommand.id,{...id,ranges});await waiting;
  view.validation.gate.mark(id,0,{formula1:'Yes',formula2:'No'});
  await view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...id,setting:{type:'checkbox',formula1:'Yes',formula2:'No'}});
  assert.equal(view.validation.gate.pending,false);
  view.validation.gate.mark(id,0,{formula1:'latest'});
  await view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...id,setting:{type:'checkbox',formula1:'stale',formula2:'No'}});
  assert.equal(view.validation.gate.pending,true);
  sheet.getRange('D1').setDataValidation(view.api.newDataValidation().requireCheckbox().build());
  const other=sheetControls(view.api.getActiveWorkbook().save()).sheet1.find(r=>r.uid!==id.ruleId);
  await view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...id,ruleId:other.uid,setting:{type:'checkbox',formula1:'latest',formula2:'No'}});
  assert.equal(view.validation.gate.pending,true,'another rule cannot settle this editor input');
  await assert.rejects(view.validation.gate.wait(20),/still finishing/);assert.equal(view.validation.gate.pending,true);
  await delay(1100);const pending=view.handle.commit();view.dispose();await assert.rejects(pending,/still finishing/);
 }finally{if(view.handle){await delay(1100);view.dispose();}}
});
test('new empty native list cannot be captured before its debounced authored options apply', async()=>{
 const state=initialState('owner'),ws=new Workspace({transaction:async f=>f(state),read:async f=>f(state)});
 const {workId}=await ws.createBlank('owner',{commandId:'new',title:'New list'});
 state.works[workId].book.sheets.sheet1.cellData={0:{2:{f:'=1+2'}}};
 const view=mountNative({book:(await ws.get('owner',workId)).book,version:'new'},plugins);
 try{
  await view.settle();const id={unitId:workId,subUnitId:'sheet1',ruleId:'native-new'};
  await view.api.executeCommand(sdk.AddSheetDataValidationCommand.id,{...id,rule:{uid:id.ruleId,type:'list',formula1:'[]',ranges:[{startRow:0,endRow:2,startColumn:0,endColumn:0}]}});
  assert.equal(sheetControls(view.handle.save(),{validate:false})?.sheet1?.[0]?.formula1,'[]');
  const execute=core.debounce(value=>view.api.executeCommand(sdk.UpdateSheetDataValidationSettingCommand.id,{...id,setting:{type:'list',...value}}),1000);
  view.formulaInput({...id,onChange:execute}).onChange({formula1:'["Ready","Waiting"]',formula2:''});
  const committed=view.handle.commit();assert.throws(()=>view.handle.save(),/still finishing/);
  assert.equal(sheetControls(await committed).sheet1[0].formula1,'["Ready","Waiting"]');
 }finally{await delay(1100);view.dispose();}
});
