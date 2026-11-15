// Actual installed calculator and native integration; no external-renderer claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mountNative } from './sheet-scale-harness.mjs';
import { blankWorkbook, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CONDITIONAL_RESOURCE, conditionalRules } from '../../../packages/workagent-contract/conditional-formatting.mjs';
import { trustedCodec } from '../../workagent-server/tests/support/xlsx-fixture.mjs';
import { XlsxExchange } from '../../workagent-server/src/xlsx-exchange.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
const req=createRequire(import.meta.resolve('@univerjs/preset-sheets-conditional-formatting'));
const filename=req.resolve('@univerjs/sheets-conditional-formatting'), installed=new Module(filename);
installed.filename=filename;installed.paths=Module._nodeModulePaths(dirname(filename));
installed._compile(readFileSync(filename,'utf8')+'\nmodule.exports.__scale = ColorScaleCalculateUnit;',filename);
const range={startRow:0,endRow:7,startColumn:0,endColumn:0};
const scale=(values=[{type:'min'},{type:'max'}])=>({cfId:'scale',stopIfTrue:false,ranges:[range],rule:{type:'colorScale',config:values.map((value,index)=>({index,value,color:['#FF0000',...(values.length===3?['#FFFF00']:[]),'#00FF00'][index]}))}});
const put=(book,entry)=>book.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[entry]})}];
const stock=(entry,cells)=>{
  const unit=Object.create(installed.exports.__scale.prototype);let points;
  unit.setPreComputingCache=v=>points=v;unit._preComputingStatus$={next(){}};
  const context={rule:entry,worksheet:{getMaxRows:()=>100,getMaxColumns:()=>20},getCellValue:(r,c)=>c===0?cells[r]??{}:{}};
  unit.preComputing(0,0,context);
  return {values:points.map(p=>p.value),colors:cells.map((_,r)=>unit.getCellResult(r,0,points,context))};
};
test('raw OOXML scale numbers cross the Python/Node bridge exactly or refuse before preview/adoption',async()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  const generated=spawnSync(root+'.local/xlsx-python/bin/python',['-I','-B','-c',`import importlib.util,base64,json\ns=importlib.util.spec_from_file_location('f',${JSON.stringify(root+'services/workagent-execution/xlsx/test_codec.py')})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nencode=lambda values,fixed=False,formula=False:base64.b64encode(m.color_scale_numeric_fixture(values,fixed,formula)).decode()\nprint(json.dumps({'bad':[encode(v,fixed) for fixed in (False,True) for v in [('9007199254740992','9007199254740993'),('-9007199254740993','-9007199254740992')]],'good':[encode(v) for v in [('9007199254740992','9007199254740994'),('-9007199254740994','-9007199254740992')]],'overflow':encode(['0','9'*400]),'formula':encode(['0','10'],True,True),'relativeFormula':encode(['0','10'],False,True)}))`],{encoding:'utf8',timeout:12000,maxBuffer:6000000});
  assert.equal(generated.status,0,generated.stderr);const fixtures=JSON.parse(generated.stdout);
  const state=initialState('owner'),before=structuredClone(state);let originals=0;
  const workspace=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const exchange=new XlsxExchange({workspace,worker:{run:async input=>trustedCodec(input)},files:{writeOriginal(){originals++;throw new Error('must refuse before retaining/adopting');}}});
  for(const [i,base64] of fixtures.bad.entries()){
    assert.throws(()=>trustedCodec({op:'import',base64}),/exactly representable/);
    const input={filename:'Scale.xlsx',commandId:'precision-'+i,synthetic:true,base64};
    await assert.rejects(()=>exchange.preview('owner',input),/exactly representable/);
    await assert.rejects(()=>exchange.import('owner',input),/exactly representable/);
  }
  assert.equal(originals,0);assert.deepEqual(state,before);
  assert.throws(()=>trustedCodec({op:'import',base64:fixtures.overflow}),/too large|Nonfinite|exactly representable/);
  assert.throws(()=>trustedCodec({op:'import',base64:fixtures.relativeFormula}),/without evaluating formulas/);
  for(const [i,base64] of fixtures.good.entries()){
    const book=trustedCodec({op:'import',base64}).book;validateWorkbook(book);
    const expected=i===0?[9007199254740992,9007199254740994]:[-9007199254740994,-9007199254740992];
    assert.deepEqual([0,1].map(row=>book.sheets.sheet1.cellData[row][0].v),expected);
    assert.equal(book.sheets.sheet1.cellData[4][0].v,'9007199254740993','numeric-looking text stays text');
    const v=mountNative({book,version:'exact-number-bridge'});
    try{
      await v.settle();assert.deepEqual([0,1].map(row=>v.conditional.composeStyle(book.id,'sheet1',row,0)?.style?.bg?.rgb),['rgb(255,0,0)','rgb(0,255,0)']);
      for(const row of [3,4,5,6])assert.equal(v.conditional.composeStyle(book.id,'sheet1',row,0)?.style?.bg,undefined);
    }finally{await delay(1100);v.dispose();}
    const reopened=trustedCodec({op:'import',base64:trustedCodec({op:'export',book}).base64}).book;
    assert.deepEqual([0,1].map(row=>reopened.sheets.sheet1.cellData[row][0].v),expected);
  }
  const formulaBook=trustedCodec({op:'import',base64:fixtures.formula}).book;validateWorkbook(formulaBook);
  assert.deepEqual(formulaBook.sheets.sheet1.cellData[7][0],{f:'=1+1'},'unsafe stale cache is discarded, not qualified as source data');
  const v=mountNative({book:formulaBook,version:'fixed-formula-bridge'});
  try{await v.settle();assert.equal(v.conditional.composeStyle(formulaBook.id,'sheet1',7,0).style.bg.rgb,'rgb(102,153,0)');}
  finally{await delay(1100);v.dispose();}
});
test('installed 1.4 calculator probes numeric filtering, percentile ranks, negative maximum and crossed color reassignment',()=>{
  const cells=[{v:-10,t:2},{v:0,t:2},{v:10,t:2},{v:100,t:2},{v:'500',t:1},{v:1,t:3},{},{v:'#DIV/0!',t:4}];
  assert.deepEqual(stock(scale([{type:'min'},{type:'percentile',value:50},{type:'max'}]),cells).values,[-10,5,100]);
  assert.deepEqual(stock(scale([{type:'min'},{type:'percent',value:50},{type:'max'}]),cells).values,[-10,45,100]);
  assert.deepEqual(stock(scale(),[{v:-10,t:2},{v:-5,t:2}]).values,[-10,0],'stock maximum bug is corrected by the existing native integration');
  const crossed=stock(scale([{type:'min'},{type:'num',value:200},{type:'max'}]),cells);
  assert.equal(crossed.colors[3],'rgb(255,255,0)','stock sorts numbers without colors; do not reuse it as exchange authority');
  assert.ok(stock(scale(),cells).colors.slice(4).every(c=>c===undefined));
});
test('actual native scales retain authored colors at crossings and ties and inclusive percentile across disjoint ranges',async()=>{
  const b=blankWorkbook('scale-probe');b.sheets.sheet1.cellData={0:{0:{v:-10,t:2},2:{f:'=1+2'}},1:{0:{v:0,t:2}},2:{0:{v:10,t:2}},3:{0:{v:100,t:2}},4:{0:{v:'500',t:1}},5:{0:{v:true,t:3}},6:{0:{f:'=1/0'}},7:{0:{}}};
  const r=scale([{type:'min'},{type:'num',value:200},{type:'max'}]);put(b,r);
  const view=mountNative({book:b,version:'scale-probe'});
  try{
    await view.settle();const s=view.api.getActiveWorkbook().getActiveSheet();
    const colors=()=>Array.from({length:8},(_,row)=>view.conditional.composeStyle(b.id,'sheet1',row,0)?.style?.bg?.rgb);
    assert.equal(colors()[3],'rgb(0,255,0)');assert.deepEqual(colors().slice(4),[undefined,undefined,undefined,undefined]);
    const tied=scale([{type:'num',value:0},{type:'num',value:0},{type:'num',value:100}]);
    await view.conditionalSettled(()=>s.setConditionalFormattingRule(r.cfId,tied));assert.equal(colors()[1],'rgb(255,0,0)');
    const percentile=scale([{type:'min'},{type:'percentile',value:50},{type:'max'}]);
    percentile.ranges=[{...range,endRow:1},{...range,startRow:2,endRow:7}];
    await view.conditionalSettled(()=>s.setConditionalFormattingRule(r.cfId,percentile));assert.equal(colors()[1],'rgb(255,170,0)');
    const constant=scale();await view.conditionalSettled(()=>s.setConditionalFormattingRule(r.cfId,constant));
    await view.conditionalSettled(()=>s.getRange('A1:A4').setValues([[5],[5],[5],[5]]));assert.equal(colors()[0],'rgb(255,0,0)');
  }finally{await delay(1100);view.dispose();}
});

test('independently constructed mixed XLSX scales and highlights survive actual native calculation, dirty export and cold recalculation',async()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  const generated=spawnSync(root+'.local/xlsx-python/bin/python',['-I','-B','-c',`import importlib.util,base64\ns=importlib.util.spec_from_file_location('f',${JSON.stringify(root+'services/workagent-execution/xlsx/test_codec.py')})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(base64.b64encode(m.color_scale_fixture()).decode())`],{encoding:'utf8',timeout:12000,maxBuffer:6000000});
  assert.equal(generated.status,0,generated.stderr);
  const b=trustedCodec({op:'import',base64:generated.stdout.trim()}).book;validateWorkbook(b);
  const view=mountNative({book:b,version:'mixed-scale'});let snapshot,expected;
  const visible=v=>Object.fromEntries(b.sheetOrder.map(sid=>[sid,Array.from({length:8},(_,row)=>[0,1,3].map(col=>v.conditional.composeStyle('preview',sid,row,col)?.style))]));
  try{
    await view.settle();const s=view.api.getActiveWorkbook().getActiveSheet();
    assert.equal(view.conditional.composeStyle(b.id,'sheet1',0,0).style.bl,0);
    assert.equal(view.conditional.composeStyle(b.id,'sheet1',0,0).style.bg.rgb,'#FFEEAA','higher priority highlight stop flag wins over scale');
    assert.equal(view.conditional.composeStyle(b.id,'sheet1',6,0).style.bg.rgb,'rgb(102,153,0)','formula =1+1 recalculates under fixed stops');
    await view.conditionalSettled(()=>s.getRange('B2').setValue(5));
    snapshot=await view.handle.commit();expected=visible(view);
    assert.equal(snapshot.sheets.sheet1.cellData[1][1].s,undefined);
  }finally{await delay(1100);view.dispose();}
  const exported=trustedCodec({op:'export',book:snapshot});
  const imported=trustedCodec({op:'import',base64:exported.base64}).book;validateWorkbook(imported);
  const meaning=book=>Object.values(conditionalRules(book)).map(rs=>rs.map(({cfId,...r})=>r));
  assert.deepEqual(meaning(imported),meaning(snapshot));assert.equal(imported.sheets.sheet1.cellData[1][1].v,5);
  assert.equal(imported.sheets.sheet1.cellData[6][0].v,undefined,'cached formula values never enter file exchange');
  const cold=mountNative({book:imported,version:'cold-scale'});
  try{await cold.settle();assert.deepEqual(visible(cold),expected);}finally{await delay(1100);cold.dispose();}
});

test('native two/three stop numeric, min/max, percent and percentile colors survive real codec ZIP roundtrips',async()=>{
  for(const thresholds of [[{type:'min'},{type:'max'}],[{type:'num',value:-20},{type:'num',value:200}],
    [{type:'min'},{type:'percent',value:50},{type:'max'}],[{type:'min'},{type:'percentile',value:50},{type:'max'}],
    [{type:'num',value:-10},{type:'num',value:0},{type:'num',value:100}]]){
    const b=blankWorkbook('scale-roundtrip');b.sheets.sheet1.cellData={0:{0:{v:-10,t:2},2:{f:'=1+2'}},1:{0:{v:0,t:2}},2:{0:{v:10,t:2}},3:{0:{v:100,t:2}},4:{0:{v:'100',t:1}},5:{0:{v:true,t:3}},6:{0:{v:'#DIV/0!',t:1}}};
    if(thresholds.length===2 && thresholds[0].type==='min')[-10,-5,-3,-1].forEach((v,row)=>b.sheets.sheet1.cellData[row][0].v=v);
    put(b,scale(thresholds));const colors=[];
    for(const book of [b,trustedCodec({op:'import',base64:trustedCodec({op:'export',book:b}).base64}).book]){
      const v=mountNative({book,version:'colors'});
      try{await v.settle();colors.push(Array.from({length:8},(_,row)=>v.conditional.composeStyle(book.id,'sheet1',row,0)?.style?.bg?.rgb));}
      finally{await delay(1100);v.dispose();}
    }
    assert.deepEqual(colors[0],colors[1]);assert.deepEqual(colors[0].slice(4),[undefined,undefined,undefined,undefined]);
    if(thresholds[0].type==='min'){assert.equal(colors[0][0],'rgb(255,0,0)');assert.equal(colors[0][3],'rgb(0,255,0)');}
  }
});
