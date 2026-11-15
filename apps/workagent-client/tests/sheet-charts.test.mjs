// Actual installed SDK + production panel/NativeEditor/App; headless scheduling,
// no browser/PG/provider claims. Every fixture is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { mountNative, mountApp, memoryStorage, SheetCharts, ChartGraphic, versions } from './sheet-scale-harness.mjs';
import { mountConditionalEditor } from './conditional-editor-harness.mjs';
import { blankWorkbook, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CHART_RESOURCE, CHART_SCOPE, sheetCharts, withCharts, chartData, chartScale } from '../../../packages/workagent-contract/sheet-charts.mjs';
import { CONTROL_RESOURCE, sheetControls } from '../../../packages/workagent-contract/sheet-controls.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
import { XlsxExchange } from '../../workagent-server/src/xlsx-exchange.mjs';
import { createSheetReader, escapedBytes, SHEET_READ_BYTES } from '../../workagent-runner/src/sheet-read.mjs';
import { trustedCodec } from '../../workagent-server/tests/support/xlsx-fixture.mjs';
import { CSV_LOSSES } from '../../../packages/workagent-contract/csv.mjs';
import { CONDITIONAL_SCOPE } from '../../../packages/workagent-contract/conditional-formatting.mjs';
const priorGlobals = new Map(['window','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
test.afterEach(()=>{for(const [k,d] of priorGlobals)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];});
const chart = (extra={}) => ({id:'chart-1',title:'Synthetic revenue',type:'bar',sheetId:'sheet1',range:{startRow:0,endRow:4,startColumn:0,endColumn:2},...extra});
function fixture(id='book') {
  const b=blankWorkbook(id); b.sheets.sheet1.cellData={0:{0:{v:'Label',t:1},1:{v:'Revenue',t:1},2:{v:'Double',t:1}},1:{0:{v:'Zero',t:1},1:{v:0,t:2},2:{f:'=B2*2',v:999,t:2}},2:{0:{v:'Negative',t:1},1:{v:-4,t:2},2:{f:'=B3*2',v:999,t:2}},3:{0:{v:'Missing',t:1},2:{f:'=1/0',v:999,t:2}},4:{0:{v:'Positive',t:1},1:{v:10,t:2},2:{f:'=B5*2',v:999,t:2}}};
  b.styles={bold:{bl:1}};b.sheets.sheet1.cellData[0][0].s='bold';
  b.resources=[{name:CONTROL_RESOURCE,data:JSON.stringify({sheet1:[{uid:'list',type:'list',formula1:'["One","Two"]',ranges:[{startRow:10,endRow:11,startColumn:0,endColumn:0}]}]})}];
  return b;
}
async function readyCharts(view) {
  for(let i=0;i<150;i++){if(view.handle.charts.view().status==='Live calculated values')return view.handle.charts.view();await delay(20);}
  assert.fail(view.handle.charts.view().status);
}
async function close(view){await delay(1100);view.dispose();}
const byText = label => n=>n.type==='button'&&n.props.children===label;
const field = label => n=>n.props['aria-label']===label;
async function click(panel,label){await panel.find(byText(label)).props.onClick();panel.flush();}

test('authoritative chart schema bounds, prototypes, merge ambiguity and inert strings',()=>{
  assert.equal(versions.core,'1.4.0');
  validateWorkbook(withCharts(fixture(),[chart({title:'<img src=x onerror=alert(1)> https://example.invalid'})]));
  const invalid=[c=>c.id='__proto__',c=>c.extra={url:'x'},c=>c.type='pie',c=>c.range.endRow=101,c=>c.range.endColumn=5,c=>c.range.startRow=-1,c=>c.range.endRow=0,c=>c.sheetId='missing',c=>c.title='x'.repeat(161),c=>c.range=JSON.parse('{"startRow":0,"endRow":2,"startColumn":0,"endColumn":1,"__proto__":{}}')];
  for(const mutate of invalid){const b=fixture(),c=chart();mutate(c);b.resources.push({name:CHART_RESOURCE,data:JSON.stringify([c])});assert.throws(()=>validateWorkbook(b));}
  for(const list of [[chart(),chart()],Array.from({length:9},(_,i)=>chart({id:`chart${i}`}))])assert.throws(()=>withCharts(fixture(),list));
  const merged=fixture();merged.sheets.sheet1.mergeData=[{startRow:1,endRow:2,startColumn:0,endColumn:0}];assert.throws(()=>withCharts(merged,[chart()]));
  const b=withCharts(fixture(),[chart()]);b.resources.push({...b.resources.at(-1)});assert.throws(()=>validateWorkbook(b));
});
test('finite SVG geometry, zero versus gaps, negative/extreme values, inert labels and broken line gaps',()=>{
  const values=[0,null,-Number.MAX_VALUE,Number.MAX_VALUE,'123',NaN,Infinity];
  const c=chart({type:'line',title:'<script>bad()</script>',range:{startRow:0,endRow:values.length,startColumn:0,endColumn:1}});
  const data=chartData(c,(r,col)=>col===0?{v:'<img onerror=x>',t:1}:r===0?{v:'Series',t:1}:{v:values[r-1],t:2});
  assert.deepEqual(data.series[0].values,[0,null,-Number.MAX_VALUE,Number.MAX_VALUE,null,null,null]);
  assert.equal(data.series[0].missing[1],'blank'); assert.equal(data.series[0].missing[4],'non-number');
  for(const v of data.series[0].values.filter(v=>v!==null))assert.ok(Number.isFinite(chartScale(data).y(v)));
  const html=renderToStaticMarkup(React.createElement(ChartGraphic,{chart:c,data}));
  assert.doesNotMatch(html,/<script|<img|NaN|Infinity/);assert.match(html,/&lt;img/);assert.match(html,/Missing \(blank\)/);
  assert.match(html,/class="sheet-chart-values" tabindex="0" role="region" aria-label="Chart values"/);
  assert.equal((html.match(/<line /g)||[]).length,2,'baseline plus only the adjacent finite pair; gaps are not joined');
});
test('native resource persistence, live calc, source edits, chart edits/delete/undo and cold reopen retain other resources/styles',async()=>{
  let view=mountNative({book:fixture(),version:'first'}), saved;
  try{
    await view.settle();const ctl=view.handle.charts;ctl.put(chart());let state=await readyCharts(view);
    assert.deepEqual(state.data['chart-1'].series[1].values,[0,-8,null,20]);
    const wb=view.api.getActiveWorkbook(),sheet=wb.getActiveSheet();sheet.getRange('B3').setValue(-7);
    state=await readyCharts(view);assert.equal(state.data['chart-1'].series[1].values[1],-14);
    sheet.getRange('C5').setValue('=B5*3');state=await readyCharts(view);assert.equal(state.data['chart-1'].series[1].values[3],30);
    ctl.put(chart({title:'Changed',type:'line'}));await wb.undo();assert.equal(ctl.view().charts[0].type,'bar');await wb.redo();assert.equal(ctl.view().charts[0].type,'line');
    ctl.remove('chart-1');assert.equal(sheetCharts(view.handle.save()).length,0);await wb.undo();assert.equal(ctl.view().charts[0].title,'Changed');
    saved=await view.handle.commit();validateWorkbook(saved);assert.deepEqual(sheetControls(saved),sheetControls(fixture()));
    assert.equal(saved.sheets.sheet1.cellData[0][0].s,'bold');assert.equal(saved.styles.bold.bl,1);
  }finally{await close(view);}
  view=mountNative({book:saved,version:'cold'});
  try{await view.settle();const state=await readyCharts(view);assert.equal(state.data['chart-1'].series[1].values[1],-14);assert.deepEqual(sheetCharts(view.handle.save()),sheetCharts(saved));assert.equal(view.edits,0);}
  finally{await close(view);}
});
test('structural commands and multi-mutation history refuse before data changes while ordinary edits and chart Undo work',async()=>{
  const view=mountNative({book:fixture(),version:'structures'});
  try{
    await view.settle();const wb=view.api.getActiveWorkbook(),sheet=wb.getActiveSheet();sheet.insertRowsBefore(1,1);view.handle.charts.put(chart());
    const snapshot=()=>JSON.stringify(view.handle.save());
    for(const fn of [()=>sheet.deleteRows(0,1),()=>sheet.deleteColumns(0,1),()=>sheet.moveRows(sheet.getRange('A2:C3'),8),()=>sheet.moveColumns(sheet.getRange('B1:B4'),5),()=>sheet.setName('Renamed'),()=>view.api.executeCommand('sheet.command.remove-sheet',{unitId:wb.getId(),subUnitId:'sheet1'}),()=>view.api.executeCommand('sheet.command.insert-sheet',{unitId:wb.getId()}),()=>view.api.executeCommand('sheet.command.add-worksheet-merge',{unitId:wb.getId()}),()=>view.api.executeCommand('sheet.command.reorder-range',{unitId:wb.getId()}),()=>assert.equal(view.clipboard.getClipboardHooks().find(h=>h.id==='workagent-chart-structure').onBeforePaste({unitId:wb.getId(),subUnitId:'sheet1',range:{startRow:0,endRow:0,startColumn:0,endColumn:1}}),false)]){
      view.messages.length=0;const before=snapshot();try{await fn();}catch(e){if(!view.messages.length)throw new Error('Structural fixture failed before refusal: '+fn.toString(),{cause:e});}assert.equal(snapshot(),before);assert.match(view.messages.at(-1),/Chart source change refused/,fn.toString());
    }
    const before=snapshot();try{await view.api.executeCommand('sheet.mutation.move-range',{unitId:wb.getId(),fromRange:{startRow:0,endRow:1,startColumn:0,endColumn:1},toRange:{startRow:5,endRow:6,startColumn:5,endColumn:6}});}catch{}assert.equal(snapshot(),before);
    await wb.undo();assert.equal(view.handle.charts.view().charts.length,0);await wb.undo();assert.equal(view.handle.save().sheets.sheet1.rowCount,200);await wb.redo();await wb.redo();assert.equal(view.handle.charts.view().charts.length,1);
    sheet.getRange('B2').setValue(12);await wb.undo();assert.equal(view.handle.charts.view().charts.length,1);
    // An existing structural undo below a chart loaded outside history must be
    // refused before its first mutation. This is the installed command path.
    await wb.undo(); // Undo chart creation.
    view.commands.syncExecuteCommand('sheet.mutation.workagent-charts',{unitId:wb.getId(),charts:[chart()]});
    const stable=snapshot();try{await wb.undo();}catch{}assert.equal(snapshot(),stable);
  }finally{await close(view);}
});
test('production chart panel create/edit/selected source/delete and unsaved form navigation gate',async()=>{
  const view=mountNative({book:fixture(),version:'panel'});let panel;
  try{
    await view.settle();panel=mountConditionalEditor(SheetCharts,{controller:view.handle.charts});
    const scope=panel.find(n=>n.type==='details'&&treeNodes(n).some(c=>c.type==='summary'&&c.props.children==='Chart limits · edits restricted; XLSX styling differs, CSV loses charts'));
    assert.ok(!scope.props.open,'full disclosure starts collapsed');
    assert.ok(treeNodes(scope).some(n=>n.type==='p'&&n.props.children===CHART_SCOPE),'entire chart disclosure retained');
    assert.equal(panel.find(n=>n.type==='section').props.tabIndex,0,'chart scroller is keyboard reachable');
    assert.match(panel.find(n=>n.type==='summary'&&String(n.props.children).startsWith('Chart limits')).props.children,/edits restricted; XLSX styling differs, CSV loses charts/,'material warning stays in the always-visible summary');
    assert.ok(treeNodes(scope).some(n=>n.type==='p'&&typeof n.props.children==='string'&&/structural edits.*XLSX preserves supported/.test(n.props.children)),'full editing and fidelity instructions remain available');
    await click(panel,'Add chart');assert.equal(view.handle.isEditing(),true);
    await assert.rejects(view.handle.commit,/Apply or cancel/);assert.throws(view.handle.save,/Apply or cancel/);
    panel.change(field('Chart title'),{target:{value:'<b>Human</b>'}});panel.change(field('Chart source range'),{target:{value:'A1:C5'}});
    await click(panel,'Apply chart');await readyCharts(view);panel.flush();assert.equal(panel.find(n=>n.type===ChartGraphic).props.data.series[1].values[1],-8);
    view.api.getActiveWorkbook().getActiveSheet().getRange('B3').setValue(-11);await readyCharts(view);panel.flush();assert.equal(panel.find(n=>n.type===ChartGraphic).props.data.series[1].values[1],-22);assert.equal(view.handle.isEditing(),false);assert.equal(sheetCharts(view.handle.save())[0].title,'<b>Human</b>');
    await click(panel,'Edit chart');panel.change(field('Chart source range'),{target:{value:'A1:Z200'}});await click(panel,'Apply chart');assert.match(panel.text(),/1–100 data rows/);assert.equal(view.handle.isEditing(),true);
    assert.match(panel.find(n=>n.props.role==='alert').props.children,/1–100 data rows/);
    await click(panel,'Cancel chart edit');await click(panel,'Edit chart');
    view.api.getActiveWorkbook().getActiveSheet().setActiveRange(view.api.getActiveWorkbook().getActiveSheet().getRange('A1:B3'));
    await click(panel,'Use selected range');assert.equal(panel.find(field('Chart source range')).props.value,'A1:B3');
    panel.change(field('Chart type'),{target:{value:'line'}});await click(panel,'Apply chart');assert.equal(sheetCharts(view.handle.save())[0].type,'line');
    await click(panel,'Delete chart');assert.equal(sheetCharts(view.handle.save()).length,0);await view.api.getActiveWorkbook().undo();panel.flush();assert.match(panel.text(),/<b>Human<\/b>/);
  }finally{panel?.dispose();await close(view);}
});
test('App durable chart draft, lost ACK exact retry, stale save/model protection, navigation and cold file reopen',async()=>{
  const path=join(await mkdtemp(new URL('../../../.local/charts-',import.meta.url)),'workspace.json');await writeFile(path,JSON.stringify(initialState('owner')));
  const ws=new Workspace(new FileFixtureStore(path));const {workId}=await ws.createBlank('owner',{commandId:'create',title:'Charts'});
  await ws.save('owner',workId,{commandId:'seed',book:fixture(workId),contentRevision:1,permissionRevision:1,formatEdits:{}});
  const other=(await ws.createBlank('owner',{commandId:'other',title:'Other'})).workId;
  const initial=await ws.get('owner',workId),storage=memoryStorage(),calls=[];let lose=true, holdOther, releaseOther;
  const delayedOther = new Promise(resolve=>{releaseOther=resolve;});
  const fetcher=async(url,options)=>{
    let result;if(url==='/api/work')result=[{id:workId,title:'Charts',status:'ready'},{id:other,title:'Other',status:'ready'}];
    else if(url==='/api/events')result={kind:'reset',cursor:1,events:[],works:[],snapshots:[]};
    else if(url.endsWith('/save')){const input=JSON.parse(options.body);calls.push(input);result=await ws.save('owner',workId,input);if(lose){lose=false;throw new Error('Lost acknowledgement fixture');}}
    else {if(holdOther && url.endsWith(other))await delayedOther;result=await ws.get('owner',url.split('/').at(-1));}return {ok:true,status:200,json:async()=>structuredClone(result)};
  };
  let app=mountApp(storage,fetcher),view;
  const attach=async()=>{await app.open(workId);for(let i=0;i<100&&!app.native();i++){await delay(10);await app.flush();}view=mountNative(app.native());await view.settle();};
  try{
    await attach();view.handle.charts.stage();await app.open(other);assert.equal(app.native().book.id,workId);assert.match(app.text(),/Apply or cancel/);
    view.handle.charts.put(chart());
    const clipboardController=view.nativeClipboard();
    try { assert.equal(await view.clipboard.legacyPaste(undefined,'23',undefined,undefined,{unitId:workId,subUnitId:'sheet1',range:{startRow:2,endRow:2,startColumn:1,endColumn:1}}),true); }
    finally { clipboardController.dispose(); }
    await app.flush();assert.match(app.text(),/Unsaved changes/);await app.save();await delay(20);await app.flush();assert.equal(calls.length,1);
    view.handle.charts.put(chart({title:'Newer human chart'}));await app.flush();await close(view);view=null;app.unmount();
    app=mountApp(storage,fetcher);await attach();assert.equal(sheetCharts(view.handle.save())[0].title,'Newer human chart');
    await app.save();await delay(30);await app.flush();assert.deepEqual(calls[1],calls[0]);assert.match(app.text(),/Unsaved changes/);
    await app.save();await delay(30);await app.flush();const saved=await ws.get('owner',workId);assert.equal(sheetCharts(saved.book)[0].title,'Newer human chart');assert.equal(saved.book.sheets.sheet1.cellData[2][1].v,23);assert.ok(saved.humanCells.includes('sheet1:2:1'));
    await assert.rejects(()=>ws.save('owner',workId,{commandId:'stale',book:withCharts(initial.book,[]),contentRevision:initial.contentRevision,permissionRevision:1}),/save_conflict/);
    assert.equal((await ws.mutate('owner',workId,{commandId:'old-model',expected:initial.expected,patch:{cells:[{sheetId:'sheet1',row:2,column:1,value:90}]}})).status,'proposed');
    const reopened=new Workspace(new FileFixtureStore(path));assert.deepEqual(sheetCharts((await reopened.get('owner',workId)).book),sheetCharts(saved.book));
    holdOther=true;const navigation=app.open(other);await delay(20);view.handle.charts.put(chart({title:'Edit during delayed navigation'}));await app.flush();releaseOther();await navigation;await app.flush();assert.equal(app.native().book.id,workId);assert.equal(sheetCharts(view.handle.save())[0].title,'Edit during delayed navigation');
    const ctl=view.handle.charts;await close(view);view=null;assert.throws(()=>ctl.put(chart()),/editor changed/);
    const cold=mountNative({book:saved.book,version:'cold-app'});try{await cold.settle();await readyCharts(cold);assert.deepEqual(sheetCharts(cold.handle.save()),sheetCharts(saved.book));}finally{await close(cold);}
  }finally{if(view)await close(view);app.unmount();}
});
test('bounded model context includes charts, XLSX exports through worker and CSV explicitly discloses visual loss',async()=>{
  const state=initialState('owner'),ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId}=await ws.createBlank('owner',{commandId:'start',title:'Exchange'});state.works[workId].book=withCharts(fixture(workId),[chart()]);
  const w=await ws.get('owner',workId),reader=createSheetReader(workId),result=JSON.parse(reader(w,JSON.stringify({overview:true})));
  assert.deepEqual(result.charts.map(({source,...raw})=>raw),[chart()]);assert.equal(result.charts[0].source.rangeA1,'A1:C5');assert.equal(result.charts[0].source.seriesCount,2);assert.ok(escapedBytes(result)<=SHEET_READ_BYTES);assert.equal(result.cells.length,0);
  const exchange=new XlsxExchange({workspace:ws,worker:{run:async input=>trustedCodec(input)}});
  const exported=await exchange.export('owner',{workId,book:w.book});
  assert.equal(sheetCharts(trustedCodec({op:'import',base64:exported.base64}).book).length,1);
  assert.deepEqual((await ws.get('owner',workId)).book,w.book);assert.match(CSV_LOSSES,/charts/);assert.match(CHART_SCOPE,/CSV loses charts/);
});

test('actual XLSX codec preserves populated chart resources and accepts empty chart resources after deletion',()=>{
  const populated=withCharts(fixture(),[chart()]);
  const full=trustedCodec({op:'export',book:populated});
  const imported=sheetCharts(trustedCodec({op:'import',base64:full.base64}).book);
  assert.deepEqual(imported.map(({id,...c})=>c),[chart()].map(({id,...c})=>c));
  const empty=withCharts(fixture(),[]), exported=trustedCodec({op:'export',book:empty});
  const reopened=trustedCodec({op:'import',base64:exported.base64}).book;
  assert.equal(reopened.sheets[reopened.sheetOrder[0]].cellData[2][1].v,-4);
  assert.deepEqual(sheetCharts(reopened),[]);
});
test('literal-only sources calculate without formulas; an all-missing series remains empty',async()=>{
  const b=blankWorkbook('literal-chart');b.sheets.sheet1.cellData={0:{1:{v:'Amount',t:1}},1:{1:{v:0,t:2}},2:{1:{v:-2,t:2}},3:{1:{v:5,t:2}}};
  const view=mountNative({book:b,version:'literal-chart'});
  try{
    // Actual SDK zero-formula semantics: the applied waiter resolves without
    // SUCCESS. The general formula-bearing settle() assertions stay strict.
    const formula=view.api.getFormula(),starts=[],ends=[];
    const start=formula.calculationStart(force=>starts.push(force)),end=formula.calculationEnd(state=>ends.push(state));
    try{formula.executeCalculation();await formula.onCalculationResultApplied(2000);assert.ok(starts.includes(true));assert.ok(!ends.includes(3),'zero-formula completion is not SUCCESS');}
    finally{start.dispose();end.dispose();}
    view.handle.charts.put(chart({range:{startRow:0,endRow:4,startColumn:0,endColumn:1}}));
    let state=await readyCharts(view);assert.deepEqual(state.data['chart-1'].series[0].values,[0,-2,5,null]);
    view.api.getActiveWorkbook().getActiveSheet().getRange('B2:B5').setValues([[null],[null],[null],[null]]);
    state=await readyCharts(view);assert.deepEqual(state.data['chart-1'].series[0].values,[null,null,null,null]);
    assert.match(renderToStaticMarkup(React.createElement(ChartGraphic,{chart:state.charts[0],data:state.data['chart-1']})),/No finite numeric values/);
  }finally{await close(view);}
});

test('all-blank source, clearing the last formula and literal → formula → literal stay fresh',async()=>{
  const view=mountNative({book:blankWorkbook('chart-transitions'),version:'transitions'});
  try{
    const ctl=view.handle.charts,sheet=view.api.getActiveWorkbook().getActiveSheet();
    ctl.put(chart({range:{startRow:0,endRow:4,startColumn:0,endColumn:1}}));
    assert.deepEqual((await readyCharts(view)).data['chart-1'].series[0].values,[null,null,null,null]);
    sheet.getRange('B2').setValue(7);
    assert.equal((await readyCharts(view)).data['chart-1'].series[0].values[0],7);
    sheet.getRange('D2').setValue(9);sheet.getRange('B2').setValue('=D2*2');
    assert.equal((await readyCharts(view)).data['chart-1'].series[0].values[0],18);
    await view.settle(); // Formula completion must still be actual SUCCESS.
    sheet.getRange('D2').setValue(11);
    assert.equal((await readyCharts(view)).data['chart-1'].series[0].values[0],22);
    sheet.getRange('B2').setValue(3);
    assert.equal((await readyCharts(view)).data['chart-1'].series[0].values[0],3);
    sheet.getRange('B2').setValue('=D2*3');
    assert.equal((await readyCharts(view)).data['chart-1'].series[0].values[0],33);
    sheet.getRange('B2').setValues([[null]]);
    assert.deepEqual((await readyCharts(view)).data['chart-1'].series[0].values,[null,null,null,null]);
    sheet.getRange('B2:B5').setValues([[{v:'#DIV/0!',t:4}],[{v:'text',t:1}],[{v:true,t:3}],[null]]);
    const missing=(await readyCharts(view)).data['chart-1'].series[0];
    assert.deepEqual(missing.values,[null,null,null,null]);assert.deepEqual(missing.missing,['error','non-number','non-number','blank']);
  }finally{await close(view);}
});

test('formula-only headers and labels, shared formulas and cross-sheet dependencies require fresh calculation',async()=>{
  const b=blankWorkbook('chart-dependencies');
  b.sheets.inputs={...structuredClone(b.sheets.sheet1),id:'inputs',name:'Inputs',cellData:{0:{0:{v:'Amount',t:1}},1:{0:{v:'First',t:1}},2:{0:{v:6,t:2}}}};b.sheetOrder.push('inputs');
  b.sheets.sheet1.cellData={0:{1:{f:'=Inputs!A1',v:'STALE HEADER',t:1}},1:{0:{v:'Literal label',t:1},1:{v:2,t:2}}};
  const view=mountNative({book:b,version:'dependencies'}),starts=[];
  const sub=view.api.getFormula().calculationStart(force=>starts.push(force));
  try{
    const ctl=view.handle.charts,wb=view.api.getActiveWorkbook(),sheet=wb.getSheetBySheetId('sheet1'),inputs=wb.getSheetBySheetId('inputs');
    ctl.put(chart({range:{startRow:0,endRow:2,startColumn:0,endColumn:1}}));
    let state=await readyCharts(view);assert.equal(state.data['chart-1'].series[0].name,'Amount');assert.ok(starts.includes(true));
    inputs.getRange('A1').setValue('Updated');starts.length=0;
    state=await readyCharts(view);assert.equal(state.data['chart-1'].series[0].name,'Updated');assert.ok(starts.includes(true));
    sheet.getRange('B1').setValue('Literal header');sheet.getRange('A2').setValue('=Inputs!A2');starts.length=0;
    state=await readyCharts(view);assert.equal(state.data['chart-1'].labels[0],'First');assert.ok(starts.includes(true));
    inputs.getRange('A2').setValue('Second');
    assert.equal((await readyCharts(view)).data['chart-1'].labels[0],'Second');
    sheet.getRange('A2').setValue('Literal label');
    sheet.getRange('B2:B3').setValues([[{f:'=Inputs!$A$3*2',si:'shared-chart',v:999,t:2}],[{si:'shared-chart',v:999,t:2}]]);
    state=await readyCharts(view);assert.deepEqual(state.data['chart-1'].series[0].values,[12,12]);
    inputs.getRange('A3').setValue(8);
    state=await readyCharts(view);assert.deepEqual(state.data['chart-1'].series[0].values,[16,16]);
    // A bounded source containing only the shared-formula follower still needs calculation.
    ctl.put(chart({range:{startRow:1,endRow:2,startColumn:0,endColumn:1}}));starts.length=0;
    state=await readyCharts(view);assert.deepEqual(state.data['chart-1'].series[0].values,[16]);assert.ok(starts.includes(true));
  }finally{sub.dispose();await close(view);}
});

test('rapid edits during calculation discard the stale generation before publishing chart data',async()=>{
  const b=blankWorkbook('chart-stale');b.sheets.sheet1.cellData={1:{1:{f:'=D2*2',v:999,t:2},3:{v:2,t:2}}};
  const view=mountNative({book:b,version:'stale'});
  try{
    await view.settle();const ctl=view.handle.charts,sheet=view.api.getActiveWorkbook().getActiveSheet();
    ctl.put(chart({range:{startRow:0,endRow:2,startColumn:0,endColumn:1}}));await readyCharts(view);
    const published=[],sub=ctl.subscribe(()=>{const s=ctl.view();if(s.status==='Live calculated values')published.push(s.data['chart-1'].series[0].values[0]);});
    let changed=false;
    const start=view.api.getFormula().calculationStart(force=>{
      if(!force||changed)return;changed=true;
      sheet.getRange('D2').setValue(10);sheet.getRange('B2').setValue('=D2*3');sheet.getRange('B2').setValue(71);
    });
    try{
      ctl.invalidate();await ctl.refresh();assert.equal(changed,true);assert.deepEqual(ctl.view().data,{});
      assert.equal((await readyCharts(view)).data['chart-1'].series[0].values[0],71);
      await delay(250);assert.deepEqual(published,[71]);
    }finally{start.dispose();sub();}
    // Repeat with a newer formula generation, rather than a literal endpoint.
    sheet.getRange('B2').setValue('=D2*2');await readyCharts(view);
    let changedFormula=false;const seen=[];
    const latest=ctl.subscribe(()=>{const s=ctl.view();if(s.status==='Live calculated values')seen.push(s.data['chart-1'].series[0].values[0]);});
    const formulaStart=view.api.getFormula().calculationStart(force=>{if(force&&!changedFormula){changedFormula=true;sheet.getRange('D2').setValue(12);sheet.getRange('B2').setValue('=D2*4');}});
    try{ctl.invalidate();await ctl.refresh();assert.equal(changedFormula,true);assert.deepEqual(ctl.view().data,{});assert.equal((await readyCharts(view)).data['chart-1'].series[0].values[0],48);assert.deepEqual(seen,[48]);}
    finally{formulaStart.dispose();latest();}
  }finally{await close(view);}
});

test('a stopped formula calculation cannot publish cached chart values, headers or labels',async()=>{
  const b=blankWorkbook('chart-stopped');b.sheets.sheet1.cellData={0:{1:{f:'="Header"',v:'STALE',t:1}},1:{0:{f:'="Label"',v:'STALE',t:1},1:{f:'=6*7',v:999,t:2}}};
  const view=mountNative({book:b,version:'stopped'});
  try{
    await view.settle();const ctl=view.handle.charts,formula=view.api.getFormula();
    ctl.put(chart({range:{startRow:0,endRow:2,startColumn:0,endColumn:1}}));await readyCharts(view);
    let stopped=false;
    const stop=formula.calculationProcessing(info=>{if(info.stage===3&&!stopped){stopped=true;formula.stopCalculation();}});
    try{ctl.invalidate();await ctl.refresh();assert.equal(stopped,true);assert.deepEqual(ctl.view().data,{});assert.match(ctl.view().status,/not yet verified/);}
    finally{stop.dispose();}
    await ctl.refresh();const state=await readyCharts(view);
    assert.equal(state.data['chart-1'].series[0].values[0],42);assert.equal(state.data['chart-1'].series[0].name,'Header');assert.equal(state.data['chart-1'].labels[0],'Label');
  }finally{await close(view);}
});

const treeNodes = n => Array.isArray(n) ? n.flatMap(treeNodes) : n?.props ? [n,...treeNodes(n.props.children)] : [];
function assertPanelOwner(tree, title, value) {
  const nodes=treeNodes(tree), headings=nodes.filter(n=>n.type==='h3').map(n=>n.props.children);
  assert.deepEqual(headings,title ? [title] : [],'every render belongs to the current controller');
  const graphics=nodes.filter(n=>n.type===ChartGraphic);
  assert.deepEqual(graphics.map(n=>n.props.data.series[0].values),value===undefined ? [] : [[value]]);
}
function ownerBook(id,title,value) {
  const book=blankWorkbook(id);book.sheets.sheet1.cellData={0:{0:{v:'Label',t:1},1:{v:'Value',t:1}},1:{0:{v:'Item',t:1},1:{v:value,t:2}}};
  return title ? withCharts(book,[chart({title,range:{startRow:0,endRow:1,startColumn:0,endColumn:1}})]) : book;
}
test('controller identity isolates every panel render, forms, errors and late subscriptions',async()=>{
  const a=mountNative({book:ownerBook('owner-a','A private',77),version:'a'}),b=mountNative({book:ownerBook('owner-b',null,22),version:'b'});
  let panel,expected=['A private',77],late,subscriptions=0;
  const ca=a.handle.charts,cb=b.handle.charts,subscribe=ca.subscribe;
  ca.subscribe=fn=>{late=fn;subscriptions++;const off=subscribe(fn);return()=>{subscriptions--;off();};};
  try {
    await readyCharts(a);
    panel=mountConditionalEditor(SheetCharts,{controller:ca},undefined,tree=>{if(treeNodes(tree).some(n=>n.props.className==='sheet-charts'))assertPanelOwner(tree,...expected);});
    await click(panel,'Edit chart');panel.change(field('Chart title'),{target:{value:'Unapplied A'}});
    panel.change(field('Chart source range'),{target:{value:'A1:Z200'}});await click(panel,'Apply chart');assert.match(panel.text(),/1–100 data rows/);
    panel.update({controller:ca});assert.equal(panel.find(field('Chart title')).props.value,'Unapplied A');assert.throws(ca.assertReady,/Apply or cancel/);
    const oldCallback=late;expected=[];panel.update({controller:cb});assert.equal(subscriptions,0);assert.doesNotMatch(panel.text(),/Unapplied A|1–100 data rows|Apply chart|Cancel chart edit/);
    oldCallback();panel.flush();assertPanelOwner(panel.tree);assert.equal(cb.editing,false);
    // B has already emitted all its calculation events before subscribing again.
    cb.put(chart({title:'B private',range:{startRow:0,endRow:1,startColumn:0,endColumn:1}}));await readyCharts(b);
    ca.cancel();expected=['A private',77];panel.update({controller:ca});
    expected=['B private',22];panel.update({controller:cb});
    expected=['A private',77];panel.update({controller:ca});
    await click(panel,'Edit chart');const disposedCallback=late;ca.dispose();
    expected=['B private',22];panel.update({controller:cb});disposedCallback();panel.flush();
    assert.doesNotMatch(panel.text(),/Apply chart|Cancel chart edit/);expected=[];await click(panel,'Delete chart');assert.equal(cb.view().charts.length,0);
  } finally {panel?.dispose();await Promise.all([close(a),close(b)]);}
});

test('App NativeEditor reuse hides old charts before effects on navigation and same-work save',async()=>{
  const books={a:ownerBook('a','A saved',77),b:ownerBook('b',null,22)};
  const state=initialState('owner'),ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const ids={};for(const id of ['a','b']){ids[id]=(await ws.createBlank('owner',{commandId:id,title:id})).workId;books[id].id=ids[id];await ws.save('owner',ids[id],{commandId:'seed-'+id,book:books[id],contentRevision:1,permissionRevision:1,formatEdits:{}});}
  const fetcher=async(url,options)=>{let result;if(url==='/api/work')result=Object.values(state.works);else if(url==='/api/events')result={kind:'reset',cursor:1,events:[],works:[],snapshots:[]};else if(url.endsWith('/save'))result=await ws.save('owner',url.split('/').at(-2),JSON.parse(options.body));else result=await ws.get('owner',url.split('/').at(-1));return {ok:true,status:200,json:async()=>structuredClone(result)};};
  const app=mountApp(memoryStorage(),fetcher);let view,allowed='A saved';
  const observe=tree=>{for(const h of treeNodes(tree).filter(n=>n.type==='h3'))assert.equal(h.props.children,allowed,'NativeEditor must hide prior-version panels before effects');};
  try {
    await app.open(ids.a);view=mountNative(app.native(),[],undefined,observe);await readyCharts(view);view.panel.flush();
    const support=view.panel.find(n=>n.type==='details'&&n.props.className==='native-sheet-support');
    assert.ok(!support.props.open);assert.ok(treeNodes(support).some(n=>n.props.children===CONDITIONAL_SCOPE),'entire conditional disclosure retained');
    assert.equal(view.panel.find(n=>n.props.className==='native-sheet-workspace').type,'div');
    await click(view.panel,'Edit chart');view.panel.change(field('Chart title'),{target:{value:'Staged A'}});await app.open(ids.b);assert.equal(app.native().book.id,ids.a);view.update(app.native());assert.equal(view.panel.find(field('Chart title')).props.value,'Staged A');
    await click(view.panel,'Cancel chart edit');await app.open(ids.b);allowed=null;view.update(app.native());assertPanelOwner(view.panel.tree);
    await delay(1100);await app.open(ids.a);allowed='A saved';view.update(app.native());await readyCharts(view);view.panel.flush();
    await click(view.panel,'Edit chart');view.panel.change(field('Chart title'),{target:{value:'A saved again'}});allowed='A saved again';await click(view.panel,'Apply chart');await app.flush();const old=view.handle.charts,version=app.native().version;
    await app.save();await delay(30);await app.flush();assert.equal(app.native().version,version,'save rebases the active controller');view.update(app.native());assert.equal(view.handle.charts,old);assert.equal(sheetCharts((await ws.get('owner',ids.a)).book)[0].title,'A saved again');await delay(1100);await app.open(ids.a);assert.notEqual(app.native().version,version);view.update(app.native());assert.notEqual(view.handle.charts,old);await readyCharts(view);view.panel.flush();assertPanelOwner(view.panel.tree,'A saved again',77);assert.throws(old.assertReady,/editor changed/);
  } finally {if(view)await close(view);app.unmount();}
});

test('App shows inert definition-only chart proposal additions, before/after updates and removals without changing saved book', async () => {
  let state=initialState('owner');
  const ws=new Workspace({read:async fn=>structuredClone(await fn(structuredClone(state))),transaction:async fn=>{const next=structuredClone(state),result=await fn(next);state=next;return structuredClone(result);}});
  const {workId}=await ws.createBlank('owner',{commandId:'blank-preview',title:'Preview'});
  const old=chart({title:'<img src=x onerror=bad()>',type:'bar'}),removed=chart({id:'remove',title:'Remove me'});
  const book=withCharts(fixture(workId),[old,removed]);
  await ws.save('owner',workId,{commandId:'seed-preview',book,contentRevision:1,permissionRevision:1});
  const before=await ws.get('owner',workId);
  const patch={cells:[],addSheets:[{id:'source2',name:'New <script>tab</script>'}],chartOps:[
    {op:'update',chart:{...old,title:'<script>after()</script>',type:'line',range:{startRow:1,endRow:3,startColumn:1,endColumn:3}}},
    {op:'delete',id:'remove'}, {op:'create',chart:chart({id:'new',title:'Added chart',sheetId:'source2'})},
  ]};
  await ws.mutate('owner',workId,{commandId:'model-preview',expected:before.expected,patch});
  const pending=await ws.get('owner',workId),calls=[];
  const app=mountApp(memoryStorage(),async(url,options)=>{calls.push({url,options});const result=url==='/api/work'?[{id:workId,title:'Preview',status:'ready'}]:url==='/api/events'?{kind:'reset',cursor:state.sequence,events:[],works:[],snapshots:[]}:await ws.get('owner',workId);return {ok:true,status:200,json:async()=>structuredClone(result)};});
  try {
    await app.open(workId);await app.flush();
    const html=renderToStaticMarkup(app.tree);
    assert.match(app.text(),/3 chart changes/);assert.doesNotMatch(app.text(),/0 cells changed/);
    assert.match(app.text(),/Definition preview/);assert.match(app.text(),/unchanged until/);
    assert.match(app.text(),/Update chart/);assert.match(app.text(),/Remove chart/);assert.match(app.text(),/Add chart/);
    assert.match(app.text(),/bar.*Sheet 1.*A1:C5/);assert.match(app.text(),/line.*Sheet 1.*B2:D4/);
    assert.match(app.text(),/New <script>tab<\/script>.*A1:C5/);
    assert.match(html,/&lt;script&gt;after/);assert.doesNotMatch(html,/<script|<img|<svg/);
    assert.deepEqual(app.native().book,before.book);assert.deepEqual((await ws.get('owner',workId)).book,before.book);
    assert.deepEqual((await ws.get('owner',workId)).proposals,pending.proposals);
    assert.ok(calls.every(c=>!c.options?.body),'preview never saves or applies');
  } finally {app.unmount();}
});

test('synthetic explicit chart proposal acceptance feeds native calculation and the actual SVG renderer', async () => {
  let state=initialState('owner');
  const ws=new Workspace({read:async fn=>structuredClone(await fn(structuredClone(state))),transaction:async fn=>{const next=structuredClone(state),result=await fn(next);state=next;return structuredClone(result);}});
  const {workId}=await ws.createBlank('owner',{commandId:'blank-accept',title:'Acceptance fixture'});
  const book=fixture(workId);
  await ws.save('owner',workId,{commandId:'seed-accept',book,contentRevision:1,permissionRevision:1});
  const before=await ws.get('owner',workId);
  const patch={cells:[{sheetId:'sheet1',row:2,column:1,value:-7}],chartOps:[{op:'create',chart:chart({type:'line'})}]};
  const proposed=await ws.mutate('owner',workId,{commandId:'synthetic-chart',expected:before.expected,patch});
  assert.equal(proposed.status,'proposed');assert.deepEqual((await ws.get('owner',workId)).book,before.book);
  await ws.decide('owner',workId,proposed.proposalId,{commandId:'synthetic-explicit-accept',expected:before.expected,decision:'accept'});
  const accepted=await ws.get('owner',workId),view=mountNative({book:accepted.book,version:'isolated-accepted'});
  try {
    const current=await readyCharts(view);
    assert.deepEqual(current.data['chart-1'].series[1].values,[0,-14,null,20]);
    const html=renderToStaticMarkup(React.createElement(ChartGraphic,{chart:current.charts[0],data:current.data['chart-1']}));
    assert.match(html,/<svg/);assert.doesNotMatch(html,/999|NaN|Infinity/);
    assert.deepEqual(sheetCharts(view.handle.save()),[chart({type:'line'})]);
    assert.deepEqual(sheetControls(view.handle.save()),sheetControls(book));
  } finally {await close(view);}
});

for (const laterSave of [false, true]) test(`App mixed chart cell preview ${laterSave ? 'withholds unavailable proposal revision after human edits' : 'never displays shared formula caches'}`, async () => {
  let state=initialState('owner');
  const ws=new Workspace({read:async fn=>structuredClone(await fn(structuredClone(state))),transaction:async fn=>{const next=structuredClone(state),result=await fn(next);state=next;return structuredClone(result);}});
  const {workId}=await ws.createBlank('owner',{commandId:'mixed-blank',title:'Mixed preview'});
  const book=withCharts(blankWorkbook(workId),[chart({title:'Original chart'})]);
  book.sheets.sheet1.cellData={
    0:{1:{f:'=2',si:'shared',v:888888,t:2}},
    1:{1:{si:'shared',v:999999,t:2}},
    2:{1:{v:false,t:3}},3:{1:{v:0,t:2}},4:{1:{v:true,t:3}},
    5:{1:{p:{body:{dataStream:'Literal <b>rich</b>\r\n'}},v:'WRONG_LITERAL_CACHE',t:1}},
    6:{1:{si:'shared',p:{body:{dataStream:'WRONG_RICH_FORMULA\r\n'}},v:777777,t:2}},
  };
  await ws.save('owner',workId,{commandId:'mixed-seed',book,contentRevision:1,permissionRevision:1});
  const before=await ws.get('owner',workId);
  const cells=[{sheetId:'sheet1',row:0,column:1,value:null,formula:'=3'},...Array.from({length:6},(_,i)=>({sheetId:'sheet1',row:i+1,column:1,value:[7,false,0,true,'<script>literal</script>',null][i]})),{sheetId:'newtab',row:1,column:1,value:0}];
  await ws.mutate('owner',workId,{commandId:'mixed-proposal',expected:before.expected,patch:{cells,addSheets:[{id:'newtab',name:'Proposed tab'}],chartOps:[{op:'update',chart:chart({title:'Proposed chart',type:'line'})},{op:'create',chart:chart({id:'newchart',sheetId:'newtab',title:'New chart'})}]}});
  const pending=await ws.get('owner',workId),proposal=structuredClone(pending.proposals[0]);
  if(laterSave){
    pending.book.sheets.sheet1.cellData[1][1]={v:123456,t:2};
    pending.book.sheets.sheet1.name='Later renamed sheet';
    await ws.save('owner',workId,{commandId:'mixed-later',book:pending.book,contentRevision:pending.contentRevision,permissionRevision:1});
  }
  const calls=[],app=mountApp(memoryStorage(),async(url,options)=>{calls.push({url,options});const result=url==='/api/work'?[{id:workId,title:'Mixed preview',status:'ready'}]:url==='/api/events'?{kind:'reset',cursor:state.sequence,events:[],works:[],snapshots:[]}:await ws.get('owner',workId);return {ok:true,status:200,json:async()=>structuredClone(result)};});
  try {
    await app.open(workId);await app.flush();
    const article=treeNodes(app.tree).find(n=>n.props.className==='proposal'),html=renderToStaticMarkup(article);
    if(laterSave){
      assert.doesNotMatch(html,/123456/);
      assert.match(html,/unavailable at proposal revision/);
      assert.doesNotMatch(html,/Later renamed sheet/);
      assert.match(html,/out of date/);
    } else {
      assert.doesNotMatch(html,/999999|888888|777777|WRONG_LITERAL_CACHE|WRONG_RICH_FORMULA/);
      assert.match(html,/shared.*unknown/i);
      assert.match(html,/<del>false<\/del>.*<strong>false<\/strong>/);
      assert.match(html,/<del>0<\/del>.*<strong>0<\/strong>/);
      assert.match(html,/<del>true<\/del>.*<strong>true<\/strong>/);
      assert.match(html,/Literal &lt;b&gt;rich&lt;\/b&gt;/);
      assert.match(html,/<del>=2<\/del>.*<strong>=3<\/strong>/);
    }
    assert.match(html,/Cell changes.*proposal revision 2/);
    assert.match(html,/Definition preview at saved revision 2/);
    assert.match(html,/Original chart.*Proposed chart/);
    assert.match(html,/Proposed tab.*row 2, column 2/);
    assert.match(html,/<strong>7<\/strong>/);assert.match(html,/<strong>\(empty\)<\/strong>/);
    assert.match(html,/&lt;script&gt;literal&lt;\/script&gt;/);assert.doesNotMatch(html,/<script|<svg/);
    assert.deepEqual((await ws.get('owner',workId)).proposals[0],proposal);
    assert.ok(calls.every(c=>!c.options?.body),'preview never saves or applies');
  } finally {app.unmount();}
});

test('App cell-only proposals retain current-cell context and raw false/zero values', async () => {
  const state=initialState('owner'),ws=new Workspace({read:async fn=>fn(state),transaction:async fn=>fn(state)});
  const {workId}=await ws.createBlank('owner',{commandId:'cell-only-blank',title:'Cells'});
  let work=await ws.get('owner',workId);
  work.book.sheets.sheet1.cellData={0:{0:{v:true,t:3},1:{v:1,t:2}}};
  await ws.save('owner',workId,{commandId:'cell-only-seed',book:work.book,contentRevision:1,permissionRevision:1});
  work=await ws.get('owner',workId);
  await ws.mutate('owner',workId,{commandId:'cell-only-proposal',expected:work.expected,patch:{cells:[{sheetId:'sheet1',row:0,column:0,value:false},{sheetId:'sheet1',row:0,column:1,value:0}]}});
  work=await ws.get('owner',workId);work.book.sheets.sheet1.name='Current cell-only sheet';work.book.sheets.sheet1.cellData[0][1]={v:5,t:2};
  await ws.save('owner',workId,{commandId:'cell-only-later',book:work.book,contentRevision:work.contentRevision,permissionRevision:1});
  const app=mountApp(memoryStorage(),async url=>({ok:true,status:200,json:async()=>structuredClone(url==='/api/work'?[{id:workId,title:'Cells',status:'ready'}]:url==='/api/events'?{kind:'reset',cursor:state.sequence,events:[],works:[],snapshots:[]}:await ws.get('owner',workId))}));
  try {
    await app.open(workId);await app.flush();
    const html=renderToStaticMarkup(treeNodes(app.tree).find(n=>n.props.className==='proposal'));
    assert.match(html,/Current cell-only sheet, row 1, column 1: <del>true<\/del> → <strong>false<\/strong>/);
    assert.match(html,/Current cell-only sheet, row 1, column 2: <del>5<\/del> → <strong>0<\/strong>/);
    assert.doesNotMatch(html,/Cell changes: before at proposal revision|unavailable at proposal revision/);
  } finally {app.unmount();}
});
