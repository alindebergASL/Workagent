import test from 'node:test';
import assert from 'node:assert/strict';
import { mountNative, mountApp, memoryStorage } from './sheet-scale-harness.mjs';
import { blankWorkbook, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CONDITIONAL_RESOURCE, conditionalRules, conditionalCells } from '../../../packages/workagent-contract/conditional-formatting.mjs';
import { CONTROL_RESOURCE, sheetControls } from '../../../packages/workagent-contract/sheet-controls.mjs';
import { serializeCsv } from '../../../packages/workagent-contract/csv.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { XlsxExchange } from '../../workagent-server/src/xlsx-exchange.mjs';
const range = {startRow:0,endRow:3,startColumn:0,endColumn:0};
const rule = () => ({cfId:'numeric',stopIfTrue:false,ranges:[range],rule:{type:'highlightCell',subType:'number',operator:'greaterThan',value:5,style:{bg:{rgb:'#ff0000'},bl:1}}});
const withRules = () => {const b=blankWorkbook('book');b.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[rule()]})}];return b;};
test('open conditional form retains the editor through clean navigation and dirty Save until Done or Cancel', async () => {
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
    assert.match(app.text(),/Done or Cancel/);
    view.api.getActiveWorkbook().getActiveSheet().getRange('B1').setValue('existing draft');
    panel.input(); await app.flush(); await app.save();
    assert.equal(calls.length,0); assert.equal(app.native().version,version);
    assert.throws(()=>view.handle.save(),/Done or Cancel/);
    await assert.rejects(view.handle.commit(),/Done or Cancel/);
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

for (const axis of ['row', 'column']) for (const preloaded of [true, false]) test(`two ${preloaded ? 'preloaded' : 'new'} boundary rules survive ${axis} delete, undo, redo, Save and cold reopen`, async () => {
  const state = initialState('owner'), ws = new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const {workId} = await ws.createBlank('owner', {commandId:'new',title:'Boundary rules'});
  const b = state.works[workId].book;
  b.sheets.sheet1.cellData = {0:{0:{v:'deleted',t:1}},2:{2:{f:'=1+2'}}};
  const rules = [0, 1].map(i => ({...rule(), cfId:`boundary${i}`, ranges:[{
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
    const before=conditionalRules(view.handle.save());
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
    let restored=view.handle.save(); validateWorkbook(restored);
    assert.equal(restored.sheets.sheet1.cellData[0][0].v,'deleted');
    assert.equal(restored.sheets.sheet1.cellData[1][1].v,42,'undo must restore deletion, not the preceding cell edit');
    assert.deepEqual(conditionalRules(restored),before); await persist();
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
    sheet.addConditionalFormattingRule({...rule(),cfId:'excess',ranges:[single]});
    assert.deepEqual(conditionalRules(view.handle.save()),before);
  } finally {view.dispose();}
});
