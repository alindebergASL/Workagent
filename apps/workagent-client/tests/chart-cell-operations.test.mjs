// Installed SDK clipboard service/controller and autofill, through NativeEditor.
// DOM HTML parsing, browser clipboard permission and layout remain Parent checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {mountNative} from './sheet-scale-harness.mjs';
import {blankWorkbook,validateWorkbook} from '../../../packages/workagent-contract/index.mjs';
import {withCharts,sheetCharts} from '../../../packages/workagent-contract/sheet-charts.mjs';
const require=createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
const sheets=require('@univerjs/sheets');
const chart=(id='bar',sheetId='sheet1')=>({id,title:id,type:id==='line'?'line':'bar',sheetId,range:{startRow:0,endRow:3,startColumn:0,endColumn:2}});
function fixture(charts=true){const b=blankWorkbook('cell-ops');b.sheets.sheet1.cellData={0:{0:{v:'Label'},1:{v:'Value'},2:{v:'Double'}},1:{0:{v:'A'},1:{v:2},2:{f:'=B2*2'}},2:{0:{v:'B'},1:{v:3},2:{f:'=B3*2'}},3:{0:{v:'C'},1:{v:0},2:{f:'=B4*2'}},8:{0:{v:'New'},1:{v:9},2:{f:'=B9*2'}},9:{0:{v:'Other'},1:{v:7},2:{f:'=B10*2'}}};return charts?withCharts(b,[chart(),chart('line')]):b;}
const target=(r,c=0,sid='sheet1')=>({unitId:'cell-ops',subUnitId:sid,range:{startRow:r,endRow:r,startColumn:c,endColumn:c}});
async function ready(v){for(let i=0;i<200;i++){const s=v.handle.charts.view();if(s.status==='Live calculated values')return s;await delay(20);}assert.fail(v.handle.charts.view().status);}
function copy(v,range,copyType='COPY',sid='sheet1'){const c=v.clipboard.generateCopyContent('cell-ops',sid,range);v.clipboard.copyContentCache().set(c.copyId,{unitId:'cell-ops',subUnitId:sid,range:c.discreteRange,matrix:c.matrixFragment,copyType});return c.copyId;}
async function run(fn,book=fixture()){const v=mountNative({book,version:'ops'});let ctl;try{await v.settle();ctl=v.nativeClipboard();return await fn(v);}finally{await delay(1100);ctl?.dispose();v.dispose();}}
const range=(r,e=r,c=0,d=c)=>({startRow:r,endRow:e,startColumn:c,endColumn:d});
test('native clipboard copy from outside/inside chart source updates both charts and Undo/Redo',()=>run(async v=>{
 const id=copy(v,range(8,9,0,2));assert.equal(await v.clipboard.pasteByCopyId(id,undefined,target(1)),true);
 let s=await ready(v);assert.deepEqual(s.data.bar.labels,['New','Other','C']);assert.deepEqual(s.data.line.series[0].values,[9,7,0]);
 const wb=v.api.getActiveWorkbook();await wb.undo();s=await ready(v);assert.deepEqual(s.data.bar.series[0].values,[2,3,0]);await wb.redo();s=await ready(v);assert.deepEqual(s.data.bar.series[0].values,[9,7,0]);
 const inside=copy(v,range(1,2,0,2));assert.equal(await v.clipboard.pasteByCopyId(inside,undefined,target(15)),true);assert.equal(v.handle.save().sheets.sheet1.cellData[15][1].v,9);
 validateWorkbook(await v.handle.commit());
}));
test('actual autofill and copy-down/right commands stay within fixed chart bounds',()=>run(async v=>{
 const wb=v.api.getActiveWorkbook(),sh=wb.getActiveSheet();
 assert.equal(await v.api.executeCommand(sheets.AutoFillCommand.id,{unitId:wb.getId(),subUnitId:'sheet1',sourceRange:range(1,2,1),targetRange:range(1,3,1),applyType:'SERIES'}),true);
 assert.deepEqual((await ready(v)).data.bar.series[0].values,[2,3,4]);
 sh.setActiveRange(sh.getRange('B2:B4'));assert.equal(await v.api.executeCommand(sheets.SheetCopyDownCommand.id),true);assert.deepEqual((await ready(v)).data.bar.series[0].values,[2,2,2]);
 sh.setActiveRange(sh.getRange('B2:C4'));assert.equal(await v.api.executeCommand(sheets.SheetCopyRightCommand.id),true);assert.deepEqual((await ready(v)).data.line.series[1].values,[2,2,2]);
 await wb.undo();assert.deepEqual((await ready(v)).data.line.series[1].values,[4,4,4]);
}));
test('native scalar clipboard formula/literal transitions, missing is not zero, save/cold reopen and second tab',async()=>{
 let saved;
 const b=fixture();b.sheetOrder.push('second');b.sheets.second={...structuredClone(b.sheets.sheet1),id:'second',name:'Second'};const book=withCharts(b,[chart(),chart('line','second')]);
 await run(async v=>{
  assert.equal(await v.clipboard.legacyPaste(undefined,'=B2*5',undefined,undefined,target(1,2)),true);
  assert.equal((await ready(v)).data.bar.series[1].values[0],10);
  assert.equal(await v.clipboard.legacyPaste(undefined,'13',undefined,undefined,target(1,2)),true);
  assert.equal((await ready(v)).data.bar.series[1].values[0],13);
  assert.equal(await v.clipboard.paste({types:['text/plain'],getType:async()=>new Blob(['=B2*7'])},undefined,target(1,2)),true);
  assert.equal((await ready(v)).data.bar.series[1].values[0],14);
  const id=copy(v,range(8,9,0,2));assert.equal(await v.clipboard.pasteByCopyId(id,undefined,target(1,0,'second')),true);
  let s=await ready(v);assert.deepEqual(s.data.line.series[1].values,[18,14,0]);
  assert.equal(await v.clipboard.legacyPaste(undefined,'11',undefined,undefined,target(1,2,'second')),true);assert.equal((await ready(v)).data.line.series[1].values[0],11);
  assert.equal(await v.clipboard.legacyPaste(undefined,'=B2*2',undefined,undefined,target(1,2,'second')),true);s=await ready(v);assert.equal(s.data.line.series[1].values[0],18);assert.deepEqual(s.data.bar.series[1].values,[14,6,0]);
  v.api.getActiveWorkbook().getSheetBySheetId('second').getRange('B4').setValues([[null]]);
  s=await ready(v);assert.deepEqual(s.data.line.series[0].values,[9,7,null]);saved=await v.handle.commit();validateWorkbook(saved);
 },book);
 await run(async v=>{const s=await ready(v);assert.deepEqual(s.data.line.series[0].values,[9,7,null]);assert.equal(s.data.bar.series[1].values[0],14);assert.deepEqual(sheetCharts(v.handle.save()),sheetCharts(saved));assert.equal(v.edits,0);},saved);
});
async function unchanged(v,fn){await ready(v);const before=JSON.stringify(v.handle.save());let result;try{result=await fn();}catch(e){assert.equal(e.name,'CanceledError');}assert.notEqual(result,true);assert.equal(JSON.stringify(v.handle.save()),before);}
test('merged/cut/overflow/optional-paste/refill payloads are atomically refused before cells, styles or chart resources change',()=>run(async v=>{
 const cell=v.clipboard.copyContentCache(),id=copy(v,range(8,9,0,2));
 const value=cell.get(id);value.matrix.setValue(0,0,{v:'Must not write',s:{bl:1},rowSpan:2,colSpan:1});
 await unchanged(v,()=>v.clipboard.pasteByCopyId(id,undefined,target(1)));
 const clean=copy(v,range(8,9,0,2));await unchanged(v,()=>v.clipboard.pasteByCopyId(clean,undefined,target(199)));await unchanged(v,()=>v.clipboard.pasteByCopyId(clean,undefined,target(1,25)));
 const cut=copy(v,range(8,9,0,2),'CUT');await unchanged(v,()=>v.clipboard.pasteByCopyId(cut,undefined,target(1)));
 await unchanged(v,()=>v.clipboard.legacyPaste(undefined,undefined,[new File(['x'],'x.png',{type:'image/png'})],undefined,target(1)));
 const good=copy(v,range(8,9,0,2));assert.equal(await v.clipboard.pasteByCopyId(good,undefined,target(1)),true);
 await unchanged(v,()=>v.clipboard.rePasteWithPasteType('SPECIAL_PASTE_FORMAT'));
 await unchanged(v,()=>v.api.executeCommand(sheets.AutoFillCommand.id,{unitId:'cell-ops',subUnitId:'sheet1',sourceRange:range(1,2,1),targetRange:range(1,200,1)}));
 assert.equal(await v.api.executeCommand(sheets.AutoFillCommand.id,{unitId:'cell-ops',subUnitId:'sheet1',sourceRange:range(1,2,1),targetRange:range(1,3,1)}),true);
 await unchanged(v,()=>v.injector.get(sheets.IAutoFillService).fillData('COPY'));
}));
test('chart delete/restore history keeps clipboard undo and structural refusal coherent',()=>run(async v=>{
 const ctl=v.handle.charts,wb=v.api.getActiveWorkbook();const id=copy(v,range(8,9,0,2));await v.clipboard.pasteByCopyId(id,undefined,target(1));
 ctl.remove('bar');ctl.remove('line');await wb.undo();assert.equal(ctl.view().charts.length,1);await wb.undo();assert.equal(ctl.view().charts.length,2);await wb.undo();assert.deepEqual((await ready(v)).data.bar.series[0].values,[2,3,0]);await wb.redo();assert.deepEqual((await ready(v)).data.bar.series[0].values,[9,7,0]);
 await unchanged(v,()=>v.api.executeCommand('sheet.command.insert-row',{unitId:'cell-ops',subUnitId:'sheet1',range:range(0)}));
}));
test('no-chart workbook retains native merged paste and ordinary scalar inference',()=>run(async v=>{
 const id=copy(v,range(8,9,0,2));v.clipboard.copyContentCache().get(id).matrix.setValue(0,0,{v:'Merge',rowSpan:2,colSpan:1});
 assert.equal(await v.clipboard.pasteByCopyId(id,undefined,target(1)),true);assert.equal(v.handle.save().sheets.sheet1.mergeData.length,1);
 for(const [c,text] of [[5,'TRUE'],[6,'1e3'],[7,'12']]){assert.equal(await v.clipboard.legacyPaste(undefined,text,undefined,undefined,target(0,c)),true);}
 const data=v.handle.save().sheets.sheet1.cellData[0];assert.equal(data[5].t,3);assert.equal(data[6].v,1000);assert.equal(data[7].v,12);
},fixture(false)));
test('resource-affecting cell copies/fills and stale copy caches refuse atomically; external values remain usable',async()=>{
 const b=fixture();b.resources.push({name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet1:[{uid:'checkbox',type:'checkbox',formula1:'1',formula2:'0',ranges:[range(8,9,1)]}]})});
 await run(async v=>{
  const id=copy(v,range(8,9,0,2));await unchanged(v,()=>v.clipboard.pasteByCopyId(id,undefined,target(1)));
  await unchanged(v,()=>v.api.executeCommand(sheets.AutoFillCommand.id,{unitId:'cell-ops',subUnitId:'sheet1',sourceRange:range(8,8,1),targetRange:range(8,10,1)}));
  v.api.getActiveWorkbook().getActiveSheet().getRange('B9:B10').setDataValidation(null);
  await unchanged(v,()=>v.clipboard.pasteByCopyId(id,undefined,target(1)));
  assert.equal(await v.api.executeCommand(require('@univerjs/sheets-ui').SheetPasteShortKeyCommand.id,{textContent:'21',target:target(1,1)}),true);
  assert.equal((await ready(v)).data.bar.series[0].values[0],21);
 },b);
});
test('clipboard human edits persist and fresh model overwrites become proposals',async()=>{
 const {Workspace}=await import('../../workagent-server/src/workspace.mjs');const {initialState}=await import('../../workagent-server/src/store.mjs');const state=initialState('owner');
 const ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Clipboard'});
 const b=fixture();b.id=workId;state.works[workId].book=structuredClone(b);let saved;
 await run(async v=>{assert.equal(await v.clipboard.legacyPaste(undefined,'31',undefined,undefined,{...target(1,1),unitId:workId}),true);await ready(v);saved=await v.handle.commit();},b);
 await ws.save('owner',workId,{commandId:'save',book:saved,contentRevision:1,permissionRevision:1,formatEdits:{}});
 const current=await ws.get('owner',workId);assert.ok(current.humanCells.includes('sheet1:1:1'));assert.deepEqual(sheetCharts(current.book),sheetCharts(b));
 assert.equal((await ws.mutate('owner',workId,{commandId:'model',expected:current.expected,patch:{cells:[{sheetId:'sheet1',row:1,column:1,value:90}]}})).status,'proposed');
 assert.equal((await ws.get('owner',workId)).book.sheets.sheet1.cellData[1][1].v,31);
});
test('native external decoded-cell pipeline infers numeric TSV fields, formulas and headers without a custom parser',()=>run(async v=>{
 // This is the SDK's post-HTML-parser entry; the fixture represents decoded TSV.
 // It deliberately does not claim DOM parsing or system clipboard coverage.
 const {ObjectMatrix}=require('@univerjs/core');const data=new ObjectMatrix({0:{0:{v:'Changed label'},1:{v:'Amount'},2:{v:'Calculated'}},1:{0:{v:'Alpha'},1:{v:'8'},2:{v:'=B2*3'}},2:{0:{v:'Beta'},1:{v:'0'},2:{v:'=B3*3'}}});
 assert.equal(await v.clipboard._pasteExternalData({cellMatrix:data},'default-paste',undefined,target(0)),true);
 let s=await ready(v);assert.equal(s.data.bar.series[0].name,'Amount');assert.deepEqual(s.data.bar.labels,['Alpha','Beta','C']);assert.deepEqual(s.data.line.series[1].values,[24,0,0]);
 await v.api.getActiveWorkbook().undo();s=await ready(v);assert.deepEqual(s.data.line.series[1].values,[4,6,0]);await v.api.getActiveWorkbook().redo();assert.equal((await ready(v)).data.bar.series[1].values[0],24);
}));
