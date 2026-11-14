import test from 'node:test';
import assert from 'node:assert/strict';
import { mountNative, mountApp, memoryStorage } from './sheet-scale-harness.mjs';
import { blankWorkbook, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CONDITIONAL_RESOURCE, conditionalRules, conditionalCells } from '../../../packages/workagent-contract/conditional-formatting.mjs';
import { CONTROL_RESOURCE, sheetControls } from '../../../packages/workagent-contract/sheet-controls.mjs';
import { serializeCsv } from '../../../packages/workagent-contract/csv.mjs';
import { Workspace, commitEditorPatch } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { XlsxExchange } from '../../workagent-server/src/xlsx-exchange.mjs';
const range = {startRow:0,endRow:3,startColumn:0,endColumn:0};
const rule = () => ({cfId:'numeric',stopIfTrue:false,ranges:[range],rule:{type:'highlightCell',subType:'number',operator:'greaterThan',value:5,style:{bg:{rgb:'#ff0000'},bl:1}}});
const scale = (three = false) => ({ cfId:'scale', stopIfTrue:false, ranges:[range], rule:{type:'colorScale',config:[{index:0,color:'#ff0000',value:{type:'min'}}, ...(three ? [{index:1,color:'#ffff00',value:{type:'percentile',value:50}}] : []), {index:three ? 2 : 1,color:'#00ff00',value:{type:'max'}}]} });
const withRules = () => {const b=blankWorkbook('book');b.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[rule()]})}];return b;};
test('open conditional form retains the editor through clean navigation and dirty Save until Submit or Cancel', async () => {
  const state = initialState('owner'), ws = new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId} = await ws.createBlank('owner',{commandId:'new',title:'Panel draft'});
  const other = (await ws.createBlank('owner',{commandId:'other',title:'Other'})).workId;
  state.works[workId].book.sheets.sheet1.cellData = {0:{2:{f:'=1+2'}}};
  const calls = [], app = mountApp(memoryStorage(), async (url, options) => {
    let result;
    if (url === '/api/work') result = [{id:workId,title:'Panel draft'},{id:other,title:'Other'}];
    else if (url === '/api/events') result = {kind:'reset',cursor:1,events:[],works:[],snapshots:[]};
    else if (url.endsWith('/save')) { const input=JSON.parse(options.body); calls.push(input); result=await ws.save('owner',workId,input); }
    else result = await ws.get('owner',url.split('/').at(-1));
    return {ok:true,status:200,json:async()=>structuredClone(result)};
  });
  let view;
  try {
    await app.open(workId); view=mountNative(app.native()); await view.settle();
    const version = app.native().version, panel = view.conditionalPanel(); panel.attach();
    assert.equal(view.handle.isEditing(),true,'opening a form protects it before input');
    await app.open(other); assert.equal(app.native().version,version);
    assert.match(app.text(),/Submit or Cancel/);
    view.api.getActiveWorkbook().getActiveSheet().getRange('B1').setValue('existing draft');
    panel.input(); await app.flush(); await app.save();
    assert.equal(calls.length,0); assert.equal(app.native().version,version);
    assert.throws(()=>view.handle.save(),/Submit or Cancel/);
    await assert.rejects(view.handle.commit(),/Submit or Cancel/);
    panel.close(); assert.equal(view.handle.isEditing(),false);
    await app.save(); assert.equal(calls.length,1);
    assert.equal(calls[0].book.sheets.sheet1.cellData[0][1].v,'existing draft');
    await app.open(other); assert.equal(app.native().book.id,other);
  } finally {view?.dispose(); app.unmount();}
});
test('bounded actual SDK resource schema refuses advanced, malformed and excessive inputs atomically', async () => {
  validateWorkbook(withRules());
  const state=initialState('owner'), ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Rules'});
  const initial=await ws.get('owner',workId);
  const changes=[
    d=>d.sheet1[0].rule.subType='formula', d=>d.sheet1[0].rule.type='dataBar',
    d=>d.sheet1[0].rule.value='=WEBSERVICE("https://example.com")',
    d=>d.sheet1[0].rule.style.bg.rgb='url(https://example.com)',
    d=>d.sheet1[0].rule.style.extra={}, d=>d.sheet1[0].ranges[0].endRow=1e9,
    d=>d.sheet1[0].ranges[0].unitId='external', d=>d.sheet1[0].ranges[0].rangeType=1,
    d=>d.sheet1.push(structuredClone(d.sheet1[0])), d=>d.sheet1[0].cfId='__proto__',
    d=>d.sheet1[0].rule.operator='regex', d=>d.sheet1[0].rule.style.bg.constructor={},
    d=>d.sheet1[0].ranges=Array(1001).fill(range),
  ];
  for(const change of changes){const b=withRules();b.id=workId;const d=conditionalRules(b);change(d);b.resources[0].data=JSON.stringify(d);
    await assert.rejects(()=>ws.save('owner',workId,{commandId:'invalid',book:b,contentRevision:1,permissionRevision:1}));
    assert.deepEqual(await ws.get('owner',workId),initial);
  }
  const b=withRules();b.resources[0].data='{"__proto__":[]}';assert.throws(()=>validateWorkbook(b));
  b.resources[0].data=JSON.stringify({sheet1:[{...rule(),ranges:[{...range,endRow:9999,endColumn:199}]}]});assert.throws(()=>validateWorkbook(b));
});
test('native SDK highlights are derived, mutable, ordered, editable and persist with controls and protected blanks', async () => {
  const state=initialState('owner'), ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Native highlights'});
  state.works[workId].book.sheets.sheet1.cellData={0:{0:{v:10,t:2,s:{it:1}},2:{f:'=1+2'}},1:{0:{v:2,t:2}}};
  let saved=await ws.get('owner',workId), view=mountNative({book:saved.book,version:'one'});
  try {
    await view.settle(); assert.equal(view.edits,0);
    const wb=view.api.getActiveWorkbook(), sheet=wb.getActiveSheet();
    const authored=structuredClone(view.handle.save().sheets.sheet1.cellData[0][0]);
    const numeric=sheet.newConditionalFormattingRule().whenNumberGreaterThan(5).setRanges([range]).setBackground('#ff0000').build();
    sheet.addConditionalFormattingRule(numeric);
    assert.equal(view.conditional.composeStyle(workId,'sheet1',0,0).style.bg.rgb,'rgb(255,0,0)');
    assert.ok(!view.conditional.composeStyle(workId,'sheet1',1,0)?.style?.bg);
    assert.deepEqual(view.handle.save().sheets.sheet1.cellData[0][0],authored,'rendering never writes cell styles');
    await view.conditionalSettled(() => sheet.getRange('A2').setValue(12));
    assert.equal(view.conditional.composeStyle(workId,'sheet1',1,0).style.bg.rgb,'rgb(255,0,0)');
    assert.equal(view.handle.save().sheets.sheet1.cellData[1][0].s,undefined);
    assert.ok(!view.handle.formatEdits().sheet1.includes(2),'formula cache does not own unrelated cell');
    const text=sheet.newConditionalFormattingRule().whenTextContains('Ready').setRanges([{...range,startColumn:1,endColumn:1}]).setBackground('#00ff00').build();
    await view.conditionalSettled(() => { sheet.addConditionalFormattingRule(text);sheet.getRange('B1').setValue('Ready now'); });
    assert.equal(view.conditional.composeStyle(workId,'sheet1',0,1).style.bg.rgb,'rgb(0,255,0)');
    sheet.getRange('D1:D4').setDataValidation(view.api.newDataValidation().requireValueInList(['Ready','Next']).build());
    const second={...structuredClone(numeric),cfId:'second',rule:{...numeric.rule,style:{bg:{rgb:'#0000ff'}}}};
    sheet.addConditionalFormattingRule(second);
    await view.conditionalSettled(() => sheet.moveConditionalFormattingRule(numeric.cfId,'second','before'));
    assert.equal(view.conditional.composeStyle(workId,'sheet1',0,0).style.bg.rgb,'rgb(255,0,0)');
    await view.conditionalSettled(() => sheet.setConditionalFormattingRule(numeric.cfId,{...numeric,rule:{...numeric.rule,value:50}}));
    assert.equal(view.conditional.composeStyle(workId,'sheet1',0,0).style.bg.rgb,'#0000ff');
    await view.conditionalSettled(() => wb.undo());assert.equal(view.conditional.composeStyle(workId,'sheet1',0,0).style.bg.rgb,'rgb(255,0,0)');
    sheet.deleteConditionalFormattingRule('second');wb.undo();assert.ok(sheet.getConditionalFormattingRules().some(r=>r.cfId==='second'));wb.redo();
    const snapshot=view.handle.save();validateWorkbook(snapshot);
    const input={commandId:'save',book:snapshot,formatEdits:view.handle.formatEdits(),contentRevision:1,permissionRevision:1};
    const ack=await ws.save('owner',workId,input);assert.deepEqual(await ws.save('owner',workId,input),ack);
    saved=await ws.get('owner',workId);assert.ok(saved.humanCells.includes('sheet1:3:0'));assert.ok(!saved.humanCells.includes('sheet1:0:2'));
    assert.equal((await ws.mutate('owner',workId,{commandId:'agent',expected:saved.expected,patch:{cells:[{sheetId:'sheet1',row:3,column:0,value:99}]}})).status,'proposed');
    await assert.rejects(()=>ws.save('intruder',workId,{...input,commandId:'denied'}));
    await assert.rejects(()=>new XlsxExchange({workspace:ws,worker:{run(){throw new Error('must not run');}}}).export('owner',{workId,book:snapshot}),/xlsx_conditional_formatting_not_supported/);
    assert.throws(()=>serializeCsv(snapshot,'sheet1'),/cannot preserve conditional/);
    const before=conditionalRules(view.handle.save());
    sheet.addConditionalFormattingRule({...rule(),cfId:'bad',rule:{type:'highlightCell',subType:'formula',value:'=1',style:{}}});
    assert.deepEqual(conditionalRules(view.handle.save()),before,'unsupported native commands cannot install/evaluate a rule');
  } finally { view.dispose(); }
  view=mountNative({book:saved.book,humanCells:saved.humanCells,version:'cold'});
  try { await view.settle();assert.equal(view.edits,0);assert.deepEqual(view.handle.formatEdits(),{});
    assert.deepEqual(conditionalRules(view.handle.save()),conditionalRules(saved.book));assert.deepEqual(sheetControls(view.handle.save()),sheetControls(saved.book));
    assert.equal(view.conditional.composeStyle(workId,'sheet1',0,0).style.bg.rgb,'rgb(255,0,0)');
    assert.equal(view.handle.save().sheets.sheet1.cellData[0][2].f,'=1+2');
  } finally {view.dispose();}
});
for(const axis of ['row','column']) test(`native ${axis} movement/deletion/undo preserves conditional rules and removed blank ownership`,async()=>{
  const b=blankWorkbook('structure');b.sheets.sheet1.cellData={0:{0:{f:'=1+2'}}};
  const view=mountNative({book:b,version:axis});
  try {await view.settle();const wb=view.api.getActiveWorkbook(),s=wb.getActiveSheet();
    const r=s.newConditionalFormattingRule().whenNumberGreaterThan(5).setRanges([s.getRange('D5').getRange()]).setBackground('#ff0000').build();s.addConditionalFormattingRule(r);
    if(axis==='row')s.insertRowsBefore(1,1);else s.insertColumnsBefore(1,1);
    const shifted=axis==='row'?1003:804;assert.ok(view.handle.formatEdits().sheet1.includes(shifted));
    const current=s.getConditionalFormattingRules()[0].ranges[0];assert.equal(current[axis==='row'?'startRow':'startColumn'],5-Number(axis==='column'));
    if(axis==='row')s.moveRows(s.getRange('D6'),9);else s.moveColumns(s.getRange('E5'),8);
    const moved=axis==='row'?1603:807;assert.ok(view.handle.formatEdits().sheet1.includes(moved));
    wb.undo();assert.ok(view.handle.formatEdits().sheet1.includes(shifted));wb.redo();
    s.deleteConditionalFormattingRule(r.cfId);assert.equal(conditionalCells(view.handle.save()).size,0);
    if(axis==='row')s.deleteRows(8,1);else s.deleteColumns(7,1);
    assert.ok(!view.handle.formatEdits().sheet1.includes(moved));wb.undo();assert.ok(view.handle.formatEdits().sheet1.includes(moved));
    assert.ok(!view.handle.formatEdits().sheet1.includes(0));validateWorkbook(view.handle.save());
  }finally{view.dispose();}
});

for (const axis of ['row', 'column']) for (const preloaded of [true, false]) test(`mixed highlight/scale ${preloaded ? 'preloaded' : 'new'} boundary rules survive ${axis} delete, undo, redo, Save and cold reopen`, async () => {
  const state = initialState('owner'), ws = new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId} = await ws.createBlank('owner', {commandId:'new',title:'Boundary rules'});
  const b = state.works[workId].book;
  b.sheets.sheet1.cellData = {0:{0:{v:'deleted',t:1}},2:{2:{f:'=1+2'}}};
  const rules = [0, 1].map(i => ({...(i ? scale(true) : rule()), cfId:`boundary${i}`, ranges:[{
    startRow:axis === 'row' ? 199 : i, endRow:axis === 'row' ? 199 : i,
    startColumn:axis === 'row' ? i : 25, endColumn:axis === 'row' ? i : 25,
  }]}));
  if (preloaded) b.resources = [{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:rules})}];
  let view = mountNative({book:structuredClone(b),version:'initial'}), saved, serial = 0;
  const persist = async () => {
    const current = await ws.get('owner',workId), book = view.handle.save();
    validateWorkbook(book);
    await ws.save('owner',workId,{commandId:`save${serial++}`,book,formatEdits:view.handle.formatEdits(),contentRevision:current.contentRevision,permissionRevision:1});
    return ws.get('owner',workId);
  };
  try {
    await view.settle(); const wb=view.api.getActiveWorkbook(), s=wb.getActiveSheet();
    if (!preloaded) for (const r of rules) s.addConditionalFormattingRule(r);
    s.getRange('B2').setValue(42);
    const beforeBook=await view.handle.commit(), before=conditionalRules(beforeBook);
    axis === 'row' ? s.deleteRows(0,1) : s.deleteColumns(0,1);
    const checkDeleted = () => {
      const snapshot=view.handle.save(); validateWorkbook(snapshot);
      assert.equal(snapshot.sheets.sheet1[axis === 'row' ? 'rowCount' : 'columnCount'],axis === 'row' ? 199 : 25);
      assert.equal(snapshot.sheets.sheet1.cellData[axis === 'row' ? 0 : 1][axis === 'row' ? 1 : 0].v,42);
      assert.equal(snapshot.sheets.sheet1.cellData[axis === 'row' ? 1 : 2][axis === 'row' ? 2 : 1].f,'=1+2');
      for (const r of conditionalRules(snapshot).sheet1) assert.equal(r.ranges[0][axis === 'row' ? 'endRow' : 'endColumn'],axis === 'row' ? 198 : 24);
      assert.equal(conditionalRules(snapshot).sheet1.length,2);
    };
    checkDeleted(); await persist();
    wb.undo();
    view.api.getFormula().executeCalculation(); await view.settle();
    let restored=await view.handle.commit(); validateWorkbook(restored);
    assert.equal(restored.sheets.sheet1.cellData[0][0].v,'deleted');
    assert.equal(restored.sheets.sheet1.cellData[1][1].v,42,'undo must restore deletion, not the preceding cell edit');
    assert.deepEqual(conditionalRules(restored),before);
    assert.equal(restored.sheets.sheet1.rowCount,beforeBook.sheets.sheet1.rowCount);
    assert.equal(restored.sheets.sheet1.columnCount,beforeBook.sheets.sheet1.columnCount);
    assert.deepEqual(restored.sheets.sheet1.cellData,beforeBook.sheets.sheet1.cellData); await persist();
    wb.redo(); checkDeleted(); saved=await persist();
    wb.undo(); wb.undo();
    restored=view.handle.save();
    assert.equal(restored.sheets.sheet1.cellData[1]?.[1]?.v,undefined,'the prior edit remains separately undoable');
    assert.equal(restored.sheets.sheet1.cellData[0][0].v,'deleted');
  } finally { view.dispose(); }
  view=mountNative({book:saved.book,humanCells:saved.humanCells,version:'cold'});
  try {
    await view.settle(); const reopened=view.handle.save(); validateWorkbook(reopened);
    assert.deepEqual(conditionalRules(reopened),conditionalRules(saved.book));
    assert.equal(reopened.sheets.sheet1.cellData[axis === 'row' ? 0 : 1][axis === 'row' ? 1 : 0].v,42);
    for (const key of conditionalCells(reopened).keys()) assert.ok(saved.humanCells.includes(key));
  } finally {view.dispose();}
});

test('deleted CF tab leaves only harmless empty buckets; undo restores rules and blank author ownership', async () => {
  const state=initialState('owner'), ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Tabs'});
  const b=state.works[workId].book;
  b.sheets.sheet1.cellData={2:{2:{f:'=1+2'}}};
  b.sheetOrder.push('sheet2'); b.sheets.sheet2={...structuredClone(b.sheets.sheet1),id:'sheet2',name:'Other'};
  b.sheets.sheet2.cellData[0]={0:{v:'keep',t:1}};
  b.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[rule()]})}];
  state.works[workId].humanCells=['sheet1:3:0','sheet2:0:0'];
  let view=mountNative({book:structuredClone(b),humanCells:state.works[workId].humanCells,version:'tabs'}), serial=0, saved;
  const persist=async()=>{
    const current=await ws.get('owner',workId), book=view.handle.save();validateWorkbook(book);
    await ws.save('owner',workId,{commandId:`save${serial++}`,book,formatEdits:view.handle.formatEdits(),contentRevision:current.contentRevision,permissionRevision:1});
    return ws.get('owner',workId);
  };
  try {
    await view.settle(); const wb=view.api.getActiveWorkbook();
    wb.deleteSheet(wb.getSheetBySheetId('sheet1'));
    const removed=await persist();
    assert.deepEqual(removed.book.sheetOrder,['sheet2']);
    assert.deepEqual(conditionalRules(removed.book),{sheet1:[]});
    assert.ok(!removed.humanCells.includes('sheet1:3:0'));
    let exports=0;
    const exchange=new XlsxExchange({workspace:ws,worker:{async run(){exports++;return {base64:'UEs=',warnings:[]};}}});
    await exchange.export('owner',{workId,book:removed.book});assert.equal(exports,1);
    wb.undo(); saved=await persist();
    assert.deepEqual(conditionalRules(saved.book).sheet1,[rule()]);
    assert.ok(saved.humanCells.includes('sheet1:3:0'));
    assert.ok(saved.humanCells.includes('sheet2:0:0'));
    assert.equal(saved.book.sheets.sheet2.cellData[0][0].v,'keep');
    wb.redo(); assert.deepEqual((await persist()).book.sheetOrder,['sheet2']);
    wb.undo(); saved=await persist();
  } finally {view.dispose();}
  view=mountNative({book:saved.book,humanCells:saved.humanCells,version:'cold-tabs'});
  try {await view.settle();validateWorkbook(view.handle.save());assert.deepEqual(conditionalRules(view.handle.save()).sheet1,[rule()]);}
  finally {view.dispose();}
  assert.equal((await ws.mutate('owner',workId,{commandId:'agent',expected:saved.expected,patch:{cells:[{sheetId:'sheet1',row:3,column:0,value:99}]}})).status,'proposed');
});

test('empty deleted-sheet buckets do not admit nonempty or malformed orphans or foreign resources', () => {
  const b=blankWorkbook('orphans');
  b.resources=[{name:CONDITIONAL_RESOURCE,data:'{"deleted":[]}'}];validateWorkbook(b);
  for (const data of ['{"deleted":[{}]}','{"deleted":{}}','{"__proto__":[]}','{"constructor":[]}','{"prototype":[]}','{"foreign/sheet":[]}']) {
    b.resources[0].data=data;assert.throws(()=>validateWorkbook(b));
  }
  b.resources=[{name:'FOREIGN_PLUGIN',data:'{}'}];assert.throws(()=>validateWorkbook(b));
});

test('native mutation guards retain incoming bounds and formula/external refusal', async () => {
  const b=withRules();b.sheets.sheet1.cellData={0:{2:{f:'=1+2'}}};
  const view=mountNative({book:b,version:'guard'});
  try {
    await view.settle();const sheet=view.api.getActiveWorkbook().getActiveSheet(), before=conditionalRules(view.handle.save());
    const invalid=[
      {...rule(),cfId:'formula',rule:{type:'highlightCell',subType:'formula',value:'=1',style:{}}},
      {...rule(),cfId:'external',ranges:[{...range,unitId:'external'}]},
      {...rule(),cfId:'outside',ranges:[{...range,endRow:200}]},
      {...rule(),cfId:'oversized',ranges:Array(1001).fill(range)},
    ];
    for (const r of invalid) {
      sheet.addConditionalFormattingRule(r);
      assert.deepEqual(conditionalRules(view.handle.save()),before);
    }
    sheet.addConditionalFormattingRule({...rule(),cfId:'valid'});
    assert.equal(conditionalRules(view.handle.save()).sheet1.length,2);
  } finally {view.dispose();}
});

for (const limit of ['rules','ranges','area']) test(`native mutation guard retains aggregate ${limit} limit`, async () => {
  const b=withRules();b.sheets.sheet1.cellData={0:{2:{f:'=1+2'}}};
  const single={startRow:0,endRow:0,startColumn:0,endColumn:0};
  const count=limit==='rules'?256:limit==='area'?25:1;
  const ranges=limit==='ranges'?Array(1000).fill(single):[limit==='area'?{startRow:0,endRow:199,startColumn:0,endColumn:19}:single];
  b.resources[0].data=JSON.stringify({sheet1:Array.from({length:count},(_,i)=>({...rule(),cfId:`r${i}`,ranges}))});
  const view=mountNative({book:b,version:limit});
  try {
    await view.settle();const sheet=view.api.getActiveWorkbook().getActiveSheet(),before=conditionalRules(view.handle.save());
    sheet.addConditionalFormattingRule({...scale(),cfId:'excess',ranges:[single]});
    assert.deepEqual(conditionalRules(view.handle.save()),before);
  } finally {view.dispose();}
});

for (const three of [false,true]) test(`native ${three ? 'three' : 'two'}-color scale gradients react, commit/reopen, and preserve authored styles and ownership`, async () => {
  const state=initialState('owner'), ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Scales'});
  const b=state.works[workId].book;
  b.sheets.sheet1.cellData={0:{0:{v:0,t:2,s:{it:1,bg:{rgb:'#123456'}}},2:{f:'=1+2'}},1:{0:{v:50,t:2}},2:{0:{v:100,t:2}}};
  let view=mountNative({book:structuredClone(b),version:'scale'}), saved, display;
  try {
    await view.settle();const wb=view.api.getActiveWorkbook(), sheet=wb.getActiveSheet();
    const raw=structuredClone((await view.handle.commit()).sheets.sheet1.cellData);
    const r=sheet.newConditionalFormattingRule().setColorScale(scale(three).rule.config).setRanges([range]).build();
    sheet.addConditionalFormattingRule(r);
    const bg=row=>view.conditional.composeStyle(workId,'sheet1',row,0)?.style?.bg?.rgb;
    assert.equal(bg(0),'rgb(255,0,0)'); assert.equal(bg(2),'rgb(0,255,0)');
    const middle=bg(1);assert.ok(middle && middle!==bg(0) && middle!==bg(2));
    assert.deepEqual((await view.handle.commit()).sheets.sheet1.cellData,raw,'computed gradients never become authored styles');
    const highlight=sheet.newConditionalFormattingRule().whenNumberGreaterThan(20).setRanges([range]).setBackground('#0000ff').build();
    await view.conditionalSettled(()=>sheet.addConditionalFormattingRule(highlight));assert.equal(bg(1),'rgb(0,0,255)');
    await view.conditionalSettled(()=>sheet.moveConditionalFormattingRule(r.cfId,highlight.cfId,'before'));assert.equal(bg(1),middle);
    await view.conditionalSettled(()=>wb.undo());assert.equal(bg(1),'rgb(0,0,255)');
    await view.conditionalSettled(()=>wb.redo());assert.equal(bg(1),middle);
    sheet.deleteConditionalFormattingRule(highlight.cfId);

    // A percent midpoint responds to distribution changes; percentile is also
    // exercised above and separately below against actual numeric thresholds.
    const original=structuredClone(r), edited=structuredClone(r);if(three)edited.rule.config[1].value={type:'percent',value:50};
    await view.conditionalSettled(()=>sheet.setConditionalFormattingRule(r.cfId,edited));
    await view.conditionalSettled(()=>wb.undo());assert.deepEqual(conditionalRules(await view.handle.commit()).sheet1[0].rule,original.rule);
    await view.conditionalSettled(()=>wb.redo());
    await view.conditionalSettled(()=>sheet.getRange('A3').setValue(200));
    assert.notEqual(bg(1),middle,'SDK displayed gradient changes with the values');display=bg(1);
    const snapshot=await view.handle.commit();
    assert.deepEqual(snapshot.sheets.sheet1.cellData[0][0].s,raw[0][0].s);
    assert.equal(snapshot.sheets.sheet1.cellData[1][0].s,undefined);
    assert.equal(snapshot.sheets.sheet1.cellData[2][0].s,undefined);
    assert.ok(!view.handle.formatEdits().sheet1.includes(2),'unrelated formula result is not human formatting');
    sheet.getRange('D1:D4').setDataValidation(view.api.newDataValidation().requireValueInList(['0012','TRUE']).build());
    sheet.getRange('E1:E4').setDataValidation(view.api.newDataValidation().requireCheckbox().build());
    await ws.save('owner',workId,{commandId:'save',book:await view.handle.commit(),formatEdits:view.handle.formatEdits(),contentRevision:1,permissionRevision:1});
    saved=await ws.get('owner',workId);
    for(const col of [0,3,4]) assert.ok(saved.humanCells.includes(`sheet1:3:${col}`));
    assert.ok(!saved.humanCells.includes('sheet1:0:2'));
    const patch={cells:[{sheetId:'sheet1',row:3,column:0,value:42}]};
    const before=structuredClone(saved.book);
    assert.equal((await ws.mutate('owner',workId,{commandId:'agent',expected:saved.expected,patch})).status,'proposed');
    assert.deepEqual(commitEditorPatch(state,state.works[workId],patch,saved.expected,'maintenance_changed'),{status:'protected',reason:'human_edit'});
    assert.deepEqual((await ws.get('owner',workId)).book,before);
    const resourceOnly=structuredClone(state.works[workId]);resourceOnly.humanCells=[];
    assert.deepEqual(commitEditorPatch(state,resourceOnly,patch,saved.expected,'maintenance_changed'),{status:'protected',reason:'human_edit'},'rule range protects blanks independently of materialized human anchors');
    await assert.rejects(()=>new XlsxExchange({workspace:ws,worker:{run(){throw new Error('must not run');}}}).export('owner',{workId,book:saved.book}),/xlsx_conditional_formatting_not_supported/);
    assert.throws(()=>serializeCsv(saved.book,'sheet1'),/cannot preserve conditional/);
    sheet.deleteConditionalFormattingRule(r.cfId);assert.equal(bg(1),undefined);
    await view.conditionalSettled(()=>wb.undo());assert.equal(bg(1),display);
    sheet.deleteConditionalFormattingRule(r.cfId);
    await ws.save('owner',workId,{commandId:'remove-scale',book:await view.handle.commit(),formatEdits:view.handle.formatEdits(),contentRevision:saved.contentRevision,permissionRevision:1});
    const removed=await ws.get('owner',workId);assert.equal(conditionalCells(removed.book).size,0);
    assert.ok(removed.humanCells.includes('sheet1:3:0'),'deliberate removal preserves blank human intent');
  } finally {view.dispose();}
  view=mountNative({book:saved.book,humanCells:saved.humanCells,version:'reopened-scale'});
  try {
    await view.settle();assert.equal(view.edits,0);assert.deepEqual(view.handle.formatEdits(),{});
    const reopened=await view.handle.commit();validateWorkbook(reopened);
    assert.deepEqual(conditionalRules(reopened),conditionalRules(saved.book));
    assert.deepEqual(sheetControls(reopened),sheetControls(saved.book));
    assert.deepEqual(reopened.sheets.sheet1.cellData,saved.book.sheets.sheet1.cellData);
    assert.equal(view.conditional.composeStyle(workId,'sheet1',1,0).style.bg.rgb,display);
  } finally {view.dispose();}
});

test('actual native UI scale command and numeric/percent/percentile thresholds render safely for constant and empty ranges', async () => {
  const b=blankWorkbook('thresholds');b.sheets.sheet1.cellData={0:{0:{v:10,t:2},2:{f:'=1+2'}},1:{0:{v:10,t:2}}};
  const view=mountNative({book:b,version:'thresholds'});
  try {
    await view.settle();const s=view.api.getActiveWorkbook().getActiveSheet();
    assert.equal(await view.commands.executeCommand('sheet.command.add-color-scale-conditional-rule',{ranges:[range],config:scale(true).rule.config}),true);
    const r=structuredClone(s.getConditionalFormattingRules()[0]);assert.equal(r.rule.type,'colorScale');
    assert.match(view.conditional.composeStyle(b.id,'sheet1',0,0).style.bg.rgb,/^rgb\(\d+,\d+,\d+\)$/,'constant min/max range has a finite display');
    for (const type of ['num','percent','percentile']) {
      const edited=structuredClone(r);edited.rule.config.forEach((p,i)=>{p.value={type,value:i*50};});
      await view.conditionalSettled(()=>s.setConditionalFormattingRule(r.cfId,edited));
      for(const row of [0,1]) assert.match(view.conditional.composeStyle(b.id,'sheet1',row,0).style.bg.rgb,/^rgb\(\d+,\d+,\d+\)$/);
      assert.equal(view.conditional.composeStyle(b.id,'sheet1',3,0)?.style?.bg,undefined);
      const empty={...edited,ranges:[{startRow:5,endRow:8,startColumn:0,endColumn:0}]};
      await view.conditionalSettled(()=>s.setConditionalFormattingRule(r.cfId,empty));
      assert.equal(view.conditional.composeStyle(b.id,'sheet1',5,0)?.style?.bg,undefined);
      validateWorkbook(await view.handle.commit());
    }
    // Native panel min/max retains inert numeric input values.
    const panel=scale();panel.rule.config[0].value.value=10;panel.rule.config[1].value.value=90;
    s.addConditionalFormattingRule(panel);validateWorkbook(await view.handle.commit());
    await view.conditionalSettled(()=>s.getRange('A1:A2').setValues([[-20],[-10]]));
    assert.equal(view.conditional.composeStyle(b.id,'sheet1',0,0).style.bg.rgb,'rgb(255,0,0)');
    assert.equal(view.conditional.composeStyle(b.id,'sheet1',1,0).style.bg.rgb,'rgb(0,255,0)');
    validateWorkbook(await view.handle.commit());
  } finally {view.dispose();}
});

test('malformed scale thresholds refuse before native mutation or server save and retain the previous undo entry', async () => {
  const state=initialState('owner'), ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Refusals'});
  const b=state.works[workId].book;b.sheets.sheet1.cellData={0:{2:{f:'=1+2'}}};
  const view=mountNative({book:structuredClone(b),version:'invalid-scales'});
  const invalid=[
    r=>r.config=null,r=>r.config=[null,null],r=>r.config=[],r=>r.config.pop(),r=>r.config.push(...structuredClone(r.config)),
    r=>r.config.reverse(),r=>r.config[1].index=0,r=>r.config[0].index='0',
    r=>r.config[0].color='url(https://example.com)',r=>r.config[1].color='rgb(256,0,0)',
    r=>r.extra={},r=>r.config[0].extra={},r=>r.config[0].value.extra={},
    r=>r.config[0].value={type:'formula',value:'=WEBSERVICE("https://example.com")'},
    r=>r.config[0].value={type:'external',value:'[other]A1'},r=>r.config[0].value={type:'custom',value:5},
    r=>r.config[0].value={type:'num',value:'=1+2'},r=>r.config[0].value={type:'num',value:'10'},
    r=>r.config[0].value={type:'num',value:Infinity},r=>r.config[0].value={type:'num',value:NaN},
    r=>r.config[0].value={type:'num',value:Number.MAX_VALUE},r=>r.config[0].value={type:'num'},
    r=>r.config[0].value={type:'percent',value:-1},r=>r.config[1].value={type:'percentile',value:101},
    r=>r.config[0].value={type:'max'},r=>r.config[1].value={type:'min'},
    r=>{r.config[0].value={type:'num',value:10};r.config[1].value={type:'num',value:0};},
    r=>r.config[0].value={type:'min',value:'=1+2'},
    r=>r.config[0].value=null,r=>{delete r.config[0].value.type;},r=>{delete r.config[0].color;},
  ];
  try {
    await view.settle();const wb=view.api.getActiveWorkbook(), s=wb.getActiveSheet();s.addConditionalFormattingRule(scale());
    s.getRange('B2').setValue('prior edit');
    const before=await view.handle.commit(), intent=view.handle.formatEdits(), stored=await ws.get('owner',workId);
    let mutations=0;const listener=view.commands.onCommandExecuted(c=>{if(/sheet\.mutation\.(add|set)-conditional-rule/.test(c.id))mutations++;});
    for(const change of invalid) {
      const r=scale();change(r.rule);
      s.addConditionalFormattingRule({...r,cfId:'invalid'});s.setConditionalFormattingRule('scale',r);
      assert.equal(mutations,0,'unsupported rule never reaches the SDK mutation handler');
      assert.deepEqual(await view.handle.commit(),before);assert.deepEqual(view.handle.formatEdits(),intent);
      const bad=structuredClone(before);bad.resources.find(r=>r.name===CONDITIONAL_RESOURCE).data=JSON.stringify({sheet1:[r]});
      await assert.rejects(()=>ws.save('owner',workId,{commandId:'invalid',book:bad,contentRevision:1,permissionRevision:1}));
      assert.deepEqual(await ws.get('owner',workId),stored);
    }
    listener.dispose();wb.undo();assert.equal((await view.handle.commit()).sheets.sheet1.cellData[1]?.[1]?.v,undefined);
    assert.equal(conditionalRules(await view.handle.commit()).sheet1.length,1);
  } finally {view.dispose();}
});

test('scale draft and lost Save acknowledgement survive remount and exact retry through NativeEditor commit', async () => {
  const state=initialState('owner'), ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Scale draft'});
  state.works[workId].book.sheets.sheet1.cellData={0:{0:{v:0,t:2},2:{f:'=1+2'}},1:{0:{v:100,t:2}}};
  const storage=memoryStorage(), calls=[];let loseAck=true;
  const fetcher=async(url,options)=>{
    let result;
    if(url==='/api/work')result=[{id:workId,title:'Scale draft'}];
    else if(url==='/api/events')result={kind:'reset',cursor:1,events:[],works:[],snapshots:[]};
    else if(url.endsWith('/save')){const input=JSON.parse(options.body);calls.push(input);result=await ws.save('owner',workId,input);if(loseAck){loseAck=false;throw new Error('Lost acknowledgement fixture');}}
    else result=await ws.get('owner',workId);
    return {ok:true,status:200,json:async()=>structuredClone(result)};
  };
  let app=mountApp(storage,fetcher),view;
  try {
    await app.open(workId);view=mountNative(app.native());await view.settle();
    const sheet=view.api.getActiveWorkbook().getActiveSheet();sheet.addConditionalFormattingRule(scale(true));
    const pending=await view.handle.commit();await app.flush();await app.save();await app.flush();
    assert.equal(calls.length,1);view.dispose();view=null;app.unmount();
    app=mountApp(storage,fetcher);await app.open(workId);view=mountNative(app.native());await view.settle();
    assert.deepEqual(conditionalRules(await view.handle.commit()),conditionalRules(pending));
    assert.ok(view.handle.formatEdits().sheet1.includes(600),'blank rule intent survives draft recovery');
    await app.save();await app.flush();assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0]);
    const saved=await ws.get('owner',workId);assert.equal(saved.contentRevision,2);assert.ok(saved.humanCells.includes('sheet1:3:0'));
  } finally {view?.dispose();app.unmount();}
});

for (const axis of ['row','column']) for (const partial of [false,true]) test(`cap preflight atomically refuses ${partial ? 'cell-shift' : 'whole'} ${axis} insertion with mixed rules`, async () => {
  const b=blankWorkbook('cap-insert');b.sheets.sheet1.rowCount=500;b.sheets.sheet1.columnCount=100;
  b.sheets.sheet1.cellData={0:{0:{v:0,t:2,s:{it:1}},2:{f:'=1+2'}},1:{0:{v:50,t:2}},2:{0:{v:100,t:2}}};
  const r={startRow:0,endRow:499,startColumn:0,endColumn:99};
  const ranges=partial?Array.from({length:500},(_,i)=>({startRow:Math.floor(i/10)*3,endRow:Math.floor(i/10)*3+1,startColumn:(i%10)*3,endColumn:(i%10)*3+1})):[r];
  b.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[{...scale(),ranges},{...rule(),ranges}]})}];
  const v=mountNative({book:b,version:`${axis}-${partial}`,humanCells:['sheet1:499:99']});
  try {
    await v.settle();const wb=v.api.getActiveWorkbook(),s=wb.getActiveSheet();s.getRange('B2').setValue(42);
    const before=await v.handle.commit(),provenance=v.handle.formatEdits(),edits=v.edits;let mutations=0;
    const listener=v.commands.onCommandExecuted(c=>{if(c.id.includes('.mutation.'))mutations++;});
    if (partial) await v.commands.executeCommand(`sheet.command.insert-range-move-${axis==='row'?'down':'right'}`,{range:axis==='row'?{startRow:1,endRow:1,startColumn:0,endColumn:0}:{startRow:0,endRow:0,startColumn:1,endColumn:1}});
    else if(axis==='row')s.insertRowsBefore(1,1);else s.insertColumnsBefore(1,1);
    listener.dispose();
    assert.equal(mutations,0);assert.deepEqual(await v.handle.commit(),before);assert.deepEqual(v.handle.formatEdits(),provenance);assert.equal(v.edits,edits);
    assert.match(v.messages.at(-1),/100,000 covered cells/);
    wb.undo();const undone=await v.handle.commit();assert.equal(undone.sheets.sheet1.rowCount,500);assert.equal(undone.sheets.sheet1.columnCount,100);
    assert.equal(undone.sheets.sheet1.cellData[1]?.[1]?.v,undefined);assert.deepEqual(conditionalRules(undone),conditionalRules(before));
    wb.redo();assert.equal((await v.handle.commit()).sheets.sheet1.cellData[1][1].v,42);
  } finally {v.dispose();}
});

for (const axis of ['row','column']) test(`${axis} insertion inherits only authored formatting for scales and numeric/text highlights through Undo/Redo, removal and reopen`, async () => {
  const state=initialState('owner'),ws=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId}=await ws.createBlank('owner',{commandId:'new',title:'Inherited styles'});const b=state.works[workId].book;
  const cell=(along,across)=>axis==='row'?[along,across]:[across,along];
  const put=(along,across,data)=>{const [r,c]=cell(along,across);(b.sheets.sheet1.cellData[r]??={})[c]=data;};
  const rr=(start,end)=>axis==='row'?{startRow:0,endRow:2,startColumn:start,endColumn:end}:{startRow:start,endRow:end,startColumn:0,endColumn:2};
  for(let along=0;along<3;along++){put(along,0,{v:along*50,t:2});put(along,1,{v:along*50,t:2,...(along===0?{s:{bg:{rgb:'#123456'},ff:'Arial',bl:1,it:1}}:{})});}
  put(0,2,{v:10,t:2,s:{it:1}});put(0,3,{v:'Ready',t:1,s:{bg:{rgb:'#112233'},ff:'Arial'}});put(0,4,{v:9,t:2,s:{bl:1}});put(0,5,{f:'=1+2'});
  const rules=[{...scale(),ranges:[rr(0,1)]},{...rule(),ranges:[rr(2,2)]},{cfId:'text',stopIfTrue:false,ranges:[rr(3,3)],rule:{type:'highlightCell',subType:'text',operator:'containsText',value:'Ready',style:{bg:{rgb:'#00ff00'},bl:1}}}];
  b.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:rules})}];
  let v=mountNative({book:structuredClone(b),version:axis}),saved;
  const styles=(snapshot,along,across)=>{const [r,c]=cell(along,across),s=snapshot.sheets.sheet1.cellData[r]?.[c]?.s;return typeof s==='string'?snapshot.styles[s]:s;};
  const check=async()=>{const snapshot=await v.handle.commit();assert.equal(styles(snapshot,1,0),undefined);assert.deepEqual(styles(snapshot,1,1),{bg:{rgb:'#123456'},ff:'Arial',bl:1,it:1});assert.deepEqual(styles(snapshot,1,2),{it:1});assert.deepEqual(styles(snapshot,1,3),{bg:{rgb:'#112233'},ff:'Arial'});assert.deepEqual(styles(snapshot,1,4),{bl:1});return snapshot;};
  try {
    await v.settle();const wb=v.api.getActiveWorkbook(),s=wb.getActiveSheet(),before=await v.handle.commit();
    for(const across of [0,1,2,3]){const [r,c]=cell(0,across);assert.ok(v.conditional.composeStyle(workId,'sheet1',r,c)?.style?.bg);}
    if(axis==='row')s.insertRowsBefore(1,1);else s.insertColumnsBefore(1,1);
    await check();wb.undo();await v.settle();assert.deepEqual((await v.handle.commit()).sheets.sheet1.cellData,before.sheets.sheet1.cellData);wb.redo();await check();
    for(const r of rules)s.deleteConditionalFormattingRule(r.cfId);
    const snapshot=await check();assert.equal(conditionalCells(snapshot).size,0);
    await ws.save('owner',workId,{commandId:'save',book:snapshot,formatEdits:v.handle.formatEdits(),contentRevision:1,permissionRevision:1});saved=await ws.get('owner',workId);
    const [r,c]=cell(1,0);assert.ok(saved.humanCells.includes(`sheet1:${r}:${c}`),'blank range/removal intent remains human owned');
    const [fr,fc]=cell(0,5);assert.ok(!saved.humanCells.includes(`sheet1:${fr}:${fc}`),'unmoved formula calculation is not human formatting');
  } finally {v.dispose();}
  v=mountNative({book:saved.book,humanCells:saved.humanCells,version:'reopened'});
  try {await v.settle();await check();assert.equal(v.edits,0);assert.deepEqual(conditionalRules(await v.handle.commit()).sheet1??[],[]);assert.equal(conditionalCells(saved.book).size,0);}
  finally {v.dispose();}
});

test('scale runtime preserves mixed point/color associations through crossings, ties and formula sign changes without changing authored rules', async () => {
  const b=blankWorkbook('runtime-points');b.sheets.sheet1.cellData={0:{0:{v:0,t:2},2:{f:'=1+2'}},1:{0:{v:50,t:2}},2:{0:{v:100,t:2}}};
  const v=mountNative({book:b,version:'runtime'});
  try {
    await v.settle();const s=v.api.getActiveWorkbook().getActiveSheet(),r=scale(true);r.rule.config[1].value={type:'num',value:200};s.addConditionalFormattingRule(r);
    const bg=row=>v.conditional.composeStyle(b.id,'sheet1',row,0)?.style?.bg?.rgb;
    assert.equal(bg(2),'rgb(0,255,0)');
    await v.conditionalSettled(()=>s.getRange('A1:A3').setValues([[0],[200],[400]]));assert.equal(bg(1),'rgb(255,255,0)');assert.equal(bg(2),'rgb(0,255,0)');
    await v.conditionalSettled(()=>s.getRange('A3').setValue(200));assert.equal(bg(2),'rgb(255,255,0)','coincident points prefer the first authored point');
    const plain=scale();await v.conditionalSettled(()=>s.setConditionalFormattingRule(r.cfId,plain));
    await v.conditionalSettled(()=>s.getRange('A1:A3').setValues([[-1000],[-999],[{f:'=A2'}]]));await v.settle();
    await new Promise(resolve=>setTimeout(resolve,120)); // Drain native formula invalidation.
    assert.equal(bg(0),'rgb(255,0,0)');assert.equal(bg(1),'rgb(0,255,0)');assert.equal(bg(2),'rgb(0,255,0)');
    await v.conditionalSettled(()=>s.getRange('A1:A2').setValues([[1000],[1001]]));await v.settle();
    assert.equal(bg(0),'rgb(255,0,0)');assert.equal(bg(1),'rgb(0,255,0)');
    await v.conditionalSettled(()=>s.getRange('A1:A2').setValues([[-1000],[-999]]));await v.settle();
    assert.equal(bg(0),'rgb(255,0,0)');assert.equal(bg(1),'rgb(0,255,0)');
    const saved=await v.handle.commit();assert.deepEqual(conditionalRules(saved).sheet1[0],plain);for(const row of [0,1,2])assert.equal(saved.sheets.sheet1.cellData[row][0].s,undefined);
  } finally {v.dispose();}
});

test('extreme finite spans, percentile interpolation, constant/empty ranges and later formula results never produce nonfinite colors', async () => {
  const b=blankWorkbook('extreme-runtime');b.sheets.sheet1.cellData={0:{0:{v:-1e308,t:2},2:{f:'=1+2'}},1:{0:{v:0,t:2}},2:{0:{v:1e308,t:2}}};
  const v=mountNative({book:b,version:'extremes'});
  try {
    await v.settle();const s=v.api.getActiveWorkbook().getActiveSheet(),r=scale(true);r.rule.config.forEach((p,i)=>{p.value={type:'percent',value:i*50};});s.addConditionalFormattingRule(r);
    const colors=()=>[0,1,2].map(row=>v.conditional.composeStyle(b.id,'sheet1',row,0)?.style?.bg?.rgb);
    assert.deepEqual(colors(),['rgb(255,0,0)','rgb(255,255,0)','rgb(0,255,0)']);
    for(const type of ['percentile','percent']) {
      const next=structuredClone(r);next.rule.config.forEach((p,i)=>{p.value={type,value:i*50};});await v.conditionalSettled(()=>s.setConditionalFormattingRule(r.cfId,next));
      for(const values of [[-1e308,-5e307,-1e307],[-1e308,0,1e308],[1e308,1e308,1e308],[Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE]]) {
        await v.conditionalSettled(()=>s.getRange('A1:A3').setValues(values.map(v=>[v])));
        for(const color of colors())assert.match(color,/^rgb\(\d+,\d+,\d+\)$/);
        if(values.every(v=>v===values[0]))assert.deepEqual(colors(),Array(3).fill('rgb(255,0,0)'));
      }
    }
    await v.conditionalSettled(()=>s.getRange('A1:A3').setValues([[-1e308],[0],[{f:'=-A1'}]]));await v.settle();
    // Force a fresh read after the SDK's buffered conditional invalidation.
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.deepEqual(colors(),['rgb(255,0,0)','rgb(255,255,0)','rgb(0,255,0)']);
    const minmax=scale();await v.conditionalSettled(()=>s.setConditionalFormattingRule(r.cfId,minmax));assert.deepEqual(colors(),['rgb(255,0,0)','rgb(128,128,0)','rgb(0,255,0)']);
    const saved=await v.handle.commit();for(const row of [0,1,2])assert.equal(saved.sheets.sheet1.cellData[row][0].s,undefined);assert.equal(saved.sheets.sheet1.cellData[0][0].v,-1e308);assert.equal(saved.sheets.sheet1.cellData[2][0].f,'=-A1');validateWorkbook(saved);
    await v.conditionalSettled(()=>s.getRange('A1:A3').setValues([[''],[''],['']]));assert.deepEqual(colors(),[undefined,undefined,undefined]);
  } finally {v.dispose();}
});

test('sheet duplication preflights aggregate conditional limits and allows bounded copies', async () => {
  const b=blankWorkbook('copy-limits');b.sheets.sheet1.cellData={0:{0:{v:-1000,t:2},2:{f:'=1+2'}},1:{0:{v:-999,t:2}}};
  b.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[scale(),rule()]})}];
  const v=mountNative({book:b,version:'copy'});
  try {
    await v.settle();const wb=v.api.getActiveWorkbook();
    const copy=wb.duplicateSheet(wb.getActiveSheet());assert.equal(wb.save().sheetOrder.length,2);
    assert.equal(conditionalRules(v.handle.save())[copy.getSheetId()].length,2);validateWorkbook(v.handle.save());
    wb.undo();assert.equal(wb.save().sheetOrder.length,1);wb.redo();assert.equal(wb.save().sheetOrder.length,2);
  } finally {v.dispose();}
  const cap=blankWorkbook('copy-cap');cap.sheets.sheet1.rowCount=500;cap.sheets.sheet1.columnCount=100;cap.sheets.sheet1.cellData={0:{2:{f:'=1+2'}}};
  const r={startRow:0,endRow:499,startColumn:0,endColumn:99};cap.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[{...scale(),ranges:[r]},{...rule(),ranges:[r]}]})}];
  const w=mountNative({book:cap,version:'copy-cap'});
  try {
    await w.settle();const wb=w.api.getActiveWorkbook(),before=await w.handle.commit(),edits=w.edits;
    assert.equal(await w.commands.executeCommand('sheet.command.copy-sheet',{unitId:cap.id,subUnitId:'sheet1'}),false);
    assert.deepEqual(await w.handle.commit(),before);assert.equal(w.edits,edits);assert.match(w.messages.at(-1),/100,000/);
  } finally {w.dispose();}
});

test('scale calculation and disposal are isolated between simultaneous native editor instances', async () => {
  const make=(id,values)=>{const b=blankWorkbook(id);b.sheets.sheet1.cellData={0:{0:{v:values[0],t:2},2:{f:'=1+2'}},1:{0:{v:values[1],t:2}}};b.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[scale()]})}];return b;};
  const a=mountNative({book:make('local-a',[-1000,-999]),version:'a'}),b=mountNative({book:make('local-b',[-1e308,1e308]),version:'b'});
  let disposed=false;
  try {
    await a.settle();await b.settle();
    assert.equal(a.conditional.composeStyle('local-a','sheet1',1,0).style.bg.rgb,'rgb(0,255,0)');assert.equal(b.conditional.composeStyle('local-b','sheet1',1,0).style.bg.rgb,'rgb(0,255,0)');
    a.dispose();disposed=true;await b.conditionalSettled(()=>b.api.getActiveWorkbook().getActiveSheet().getRange('A1:A2').setValues([[-20],[-10]]));
    assert.equal(b.conditional.composeStyle('local-b','sheet1',1,0).style.bg.rgb,'rgb(0,255,0)');assert.equal((await b.handle.commit()).sheets.sheet1.cellData[1][0].s,undefined);
  } finally {if(!disposed)a.dispose();b.dispose();}
});
