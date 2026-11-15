// Real installed calculator, raw OOXML/openpyxl inputs, Python -> JSON -> JS,
// and the existing native integration. External renderer parity is not asserted.
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
const filename=req.resolve('@univerjs/sheets-conditional-formatting'),installed=new Module(filename);
installed.filename=filename;installed.paths=Module._nodeModulePaths(dirname(filename));
installed._compile(readFileSync(filename,'utf8')+'\nmodule.exports.__bar = DataBarCalculateUnit;',filename);
const range={startRow:0,endRow:7,startColumn:0,endColumn:0};
const bar=(min={type:'min'},max={type:'max'})=>({cfId:'bar',stopIfTrue:false,ranges:[range],rule:{type:'dataBar',isShowValue:true,config:{min,max,positiveColor:'#123456',nativeColor:'#123456',isGradient:true}}});
const put=(b,r)=>b.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[r]})}];
const root=fileURLToPath(new URL('../../../',import.meta.url));
const generated=spawnSync(root+'.local/xlsx-python/bin/python',['-I','-B','-c',`import importlib.util,base64,json\ns=importlib.util.spec_from_file_location('f',${JSON.stringify(root+'services/workagent-execution/xlsx/test_codec.py')})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ne=lambda v=('0','5','10'),fixed=False,formula=False,lengths=True:base64.b64encode(m.data_bar_numeric_fixture(v,fixed,formula,lengths)).decode()\nprint(json.dumps({'mixed':base64.b64encode(m.data_bar_fixture()).decode(),'bad':[e(v,fixed) for fixed in (False,True) for v in [('9007199254740992','9007199254740993'),('0','9007199254740993')]],'good':e(('9007199254740992','9007199254740994')),'formula':[e(formula=True,fixed=f) for f in (False,True)],'signed':e(('-5','0','10')),'defaultLengths':e(lengths=False),'overflow':e(('0','9'*400))}))`],{encoding:'utf8',timeout:12000,maxBuffer:6000000});
assert.equal(generated.status,0,generated.stderr);const fixtures=JSON.parse(generated.stdout);
const stock=(entry,cells)=>{
  const unit=Object.create(installed.exports.__bar.prototype);let bounds;
  unit.setPreComputingCache=v=>bounds=v;unit._preComputingStatus$={next(){}};
  const context={rule:entry,worksheet:{getMaxRows:()=>100,getMaxColumns:()=>20},getCellValue:(r,c)=>c===0?cells[r]??{}:{}};
  unit.preComputing(0,0,context);
  return {bounds,bars:cells.map((_,r)=>unit.getCellResult(r,0,bounds,context))};
};
test('installed 1.4 bar probe: defaults, signed axis, clipping, equal bounds, percent vs percentile and numeric filtering',()=>{
  const cells=[0,5,10,100].map(v=>({v,t:2})).concat([{v:1,t:3},{v:'5',t:1},{v:'#DIV/0!',t:4},{}]);
  const r=bar();delete r.rule.config.isGradient;delete r.rule.isShowValue;
  const defaults=stock(r,cells);assert.equal(defaults.bars[1].isGradient,undefined);assert.equal(defaults.bars[1].isShowValue,undefined);
  assert.ok(defaults.bars.slice(4).every(v=>v===undefined));
  assert.equal(stock(bar({type:'percent',value:50}),cells).bounds.min,50);
  assert.equal(stock(bar({type:'percentile',value:50}),cells).bounds.min,7.5);
  assert.deepEqual(stock(bar(),[-10,0,10].map(v=>({v,t:2}))).bounds,{min:-10,max:10,startPoint:50});
  assert.equal(stock(bar(),[-10,-5,-1].map(v=>({v,t:2}))).bounds.max,0,'stock negative maximum is corrected in existing native adapter');
  assert.equal(stock(bar(),[5,5].map(v=>({v,t:2}))).bars[0],undefined,'stock equal bounds differ from native adapter');
  const clipped=stock(bar({type:'num',value:2},{type:'num',value:8}),cells);
  assert.equal(clipped.bars[0],undefined);assert.equal(clipped.bars[1].value,50);assert.equal(clipped.bars[2].value,100);
});

test('unsafe raw integers, signed/formula inputs and default file lengths refuse atomically before preview/adoption',async()=>{
  const state=initialState('owner'),before=structuredClone(state);let originals=0;
  const workspace=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const exchange=new XlsxExchange({workspace,worker:{run:async input=>trustedCodec(input)},files:{writeOriginal(){originals++;throw Error('must refuse before retaining');}}});
  for(const [i,base64] of [...fixtures.bad,...fixtures.formula,fixtures.signed,fixtures.defaultLengths,fixtures.overflow].entries()){
    assert.throws(()=>trustedCodec({op:'import',base64}),/exactly representable|without evaluating formulas|Signed data bar|explicit minLength|too large|Nonfinite/);
    const input={filename:'Bars.xlsx',commandId:'bar-refusal-'+i,synthetic:true,base64};
    await assert.rejects(()=>exchange.preview('owner',input));await assert.rejects(()=>exchange.import('owner',input));
  }
  assert.equal(originals,0);assert.deepEqual(state,before);
  const b=trustedCodec({op:'import',base64:fixtures.good}).book;validateWorkbook(b);
  assert.deepEqual([0,1].map(row=>b.sheets.sheet1.cellData[row][0].v),[9007199254740992,9007199254740994]);
  const v=mountNative({book:b,version:'bar-number-bridge'});
  try{await v.settle();assert.equal(v.conditional.composeStyle(b.id,'sheet1',0,0)?.dataBar,undefined);assert.equal(v.conditional.composeStyle(b.id,'sheet1',1,0).dataBar.value,100);
    for(const row of [3,4,5,6])assert.equal(v.conditional.composeStyle(b.id,'sheet1',row,0)?.dataBar,undefined);
  }finally{await delay(1100);v.dispose();}
  const reopened=trustedCodec({op:'import',base64:trustedCodec({op:'export',book:b}).base64}).book;
  assert.deepEqual([0,1].map(row=>reopened.sheets.sheet1.cellData[row][0].v),[9007199254740992,9007199254740994]);
});

test('independent mixed two-tab bars preserve priority, stops, immutable original, separate adoption and dirty native snapshots',async()=>{
  const state=initialState('owner');const workspace=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const originals=[];const exchange=new XlsxExchange({workspace,worker:{run:async input=>trustedCodec(input)},files:{async writeOriginal(owner,bytes){originals.push(Buffer.from(bytes));return {bytes:bytes.length,hash:'fixture-hash'};}}});
  const input={filename:'Independent bars.xlsx',commandId:'bars-import',synthetic:true,base64:fixtures.mixed};
  const before=structuredClone(state);const preview=await exchange.preview('owner',input);assert.equal(preview.sheets.length,2);assert.deepEqual(state,before);assert.equal(originals.length,0);
  const adopted=await exchange.import('owner',input),saved=structuredClone(state.works[adopted.workId]),b=saved.book;validateWorkbook(b);
  assert.deepEqual(originals[0],Buffer.from(fixtures.mixed,'base64'));assert.ok(saved.humanCells.includes('sheet1:7:5'));
  const v=mountNative({book:b,version:'mixed-bars'});let snapshot,expected;
  const visible=(view,book)=>Object.fromEntries(book.sheetOrder.map(sid=>[sid,[0,1,2,7].map(row=>view.conditional.composeStyle(book.id,sid,row,5))]));
  try{
    await v.settle();const s=v.api.getActiveWorkbook().getActiveSheet();
    const first=v.conditional.composeStyle(b.id,'sheet1',0,5);assert.equal(first.dataBar,undefined);assert.equal(first.style.bg.rgb,'#FFEEAA');
    assert.equal(v.conditional.composeStyle(b.id,'sheet1',1,5).dataBar.value,25);
    await v.conditionalSettled(()=>s.getRange('F2').setValue(10));
    assert.equal(v.conditional.composeStyle(b.id,'sheet1',1,5).dataBar.value,50);
    snapshot=await v.handle.commit();expected=visible(v,b);
    assert.equal(snapshot.sheets.sheet1.cellData[1][5].s,undefined);assert.equal(snapshot.sheets.sheet1.cellData[1][5].dataBar,undefined);
  }finally{await delay(1100);v.dispose();}
  const prior=structuredClone(state);const exported=await exchange.export('owner',{workId:b.id,book:snapshot});assert.deepEqual(state,prior,'dirty export never saves');
  const imported=trustedCodec({op:'import',base64:exported.base64}).book;validateWorkbook(imported);
  const meaning=book=>Object.values(conditionalRules(book)).map(rs=>rs.map(({cfId,...r})=>r));assert.deepEqual(meaning(imported),meaning(snapshot));
  assert.equal(imported.sheets.sheet1.cellData[1][5].v,10);assert.equal(imported.sheets.sheet1.cellData[6][0].v,undefined);
  const cold=mountNative({book:imported,version:'cold-bars'});
  try{await cold.settle();assert.deepEqual(visible(cold,imported),expected);}finally{await delay(1100);cold.dispose();}
  const second=await exchange.import('owner',{...input,commandId:'bars-second',base64:exported.base64});assert.notEqual(second.workId,b.id);assert.deepEqual(state.works[b.id],saved);
  assert.deepEqual(originals[0],Buffer.from(fixtures.mixed,'base64'));
});

test('native exported bar threshold families, flags, clipping and fixed constant populations recalculate after ZIP roundtrip',async()=>{
  for(const [min,max,values,expected] of [
    [{type:'min'},{type:'max'},[0,5,10],[0,50,100]],
    [{type:'percent',value:10},{type:'percent',value:90},[0,5,10],[0,50,100]],
    [{type:'percentile',value:0},{type:'percentile',value:100},[0,5,10],[0,50,100]],
    [{type:'num',value:2},{type:'num',value:8},[0,5,10],[0,50,100]],
    [{type:'num',value:0},{type:'num',value:10},[5,5,5],[50,50,50]],
    [{type:'num',value:0},{type:'num',value:10},[0,0,0],[0,0,0]],
  ]){
    const b=blankWorkbook('bar-roundtrip');b.sheets.sheet1.cellData={};values.forEach((v,row)=>b.sheets.sheet1.cellData[row]={0:{v,t:2}});
    b.sheets.sheet1.cellData[0][2]={f:'=1+2'}; // harness calculation sentinel outside the bar range
    b.sheets.sheet1.cellData[3]={0:{v:true,t:3}};b.sheets.sheet1.cellData[4]={0:{v:'10',t:1}};
    const r=bar(min,max);r.rule.isShowValue=false;put(b,r);
    for(const book of [b,trustedCodec({op:'import',base64:trustedCodec({op:'export',book:b}).base64}).book]){
      const v=mountNative({book,version:'bar-thresholds'});
      try{await v.settle();for(let row=0;row<3;row++){
        const result=v.conditional.composeStyle(book.id,'sheet1',row,0);assert.equal(result?.dataBar?.value??0,expected[row]);assert.equal(result.isShowValue,false);
        if(expected[row])assert.deepEqual(result.dataBar,{startPoint:0,value:expected[row],color:'#123456',isGradient:true,isShowValue:false});
      }for(const row of [3,4,5])assert.equal(v.conditional.composeStyle(book.id,'sheet1',row,0)?.dataBar,undefined);
      }finally{await delay(1100);v.dispose();}
    }
  }
});
