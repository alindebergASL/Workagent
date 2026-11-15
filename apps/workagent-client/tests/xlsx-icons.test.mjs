// Independent XML/openpyxl fixtures -> actual codec -> installed SDK/adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire, Module } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mountNative } from './sheet-scale-harness.mjs';
import { validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CONDITIONAL_RESOURCE, conditionalRules } from '../../../packages/workagent-contract/conditional-formatting.mjs';
import { trustedCodec, trustedWorker } from '../../workagent-server/tests/support/xlsx-fixture.mjs';
import { XlsxExchange } from '../../workagent-server/src/xlsx-exchange.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const generated=spawnSync(root+'.local/xlsx-python/bin/python',['-I','-B','-c',`import importlib.util,base64,json\ns=importlib.util.spec_from_file_location('f',${JSON.stringify(root+'services/workagent-execution/xlsx/test_codec.py')})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ne=lambda *a,**k:base64.b64encode(m.icon_numeric_fixture(*a,**k)).decode()\nprint(json.dumps({'mixed':base64.b64encode(m.icon_fixture()).decode(),'kinds':{k:e(kind=k) for k in ('num','percent','percentile')},'bad':[e(('9007199254740992','9007199254740993')),e(formula=True),e(('5','5'),kind='percent')],'good':e(('9007199254740992','9007199254740994'))}))`],{encoding:'utf8',timeout:12000,maxBuffer:6000000});
assert.equal(generated.status,0,generated.stderr);const fixtures=JSON.parse(generated.stdout);
const req=createRequire(import.meta.resolve('@univerjs/preset-sheets-conditional-formatting'));
const filename=req.resolve('@univerjs/sheets-conditional-formatting'),installed=new Module(filename);
installed.filename=filename;installed.paths=Module._nodeModulePaths(dirname(filename));
installed._compile(readFileSync(filename,'utf8')+'\nmodule.exports.__icons=IconSetCalculateUnit;module.exports.__assets=ICON_MAP;',filename);
const sdk=installed.exports;
const ids=(view,b)=>Array.from({length:8},(_,r)=>view.conditional.composeStyle(b.id,'sheet1',r,0)?.iconSet?.iconId);
const ruleBook=kind=>trustedCodec({op:'import',base64:fixtures.kinds[kind]}).book;
test('installed icon registry and calculator preserve high/low ordering, comparator edges and inert bottom',()=>{
  assert.deepEqual(sdk.iconMap['3Arrows'],['up-green','right-gold','down-red'].map(k=>sdk.__assets.arrow[k]));
  assert.deepEqual(sdk.iconMap['4Rating'],['signal25','signal50','signal75','signal100'].map(k=>sdk.__assets.signal[k]));
  assert.deepEqual(sdk.iconMap['5Quarters'],['progress100','progress75','progress50','progress25','progress0'].map(k=>sdk.__assets.progress[k]));
  const entry=conditionalRules(ruleBook('num')).sheet1[0];entry.rule.config[0].operator='greaterThan';entry.rule.config.at(-1).value.value=-100;
  const cells=[-200,0,5,10,11].map(v=>({v,t:2})).concat([{v:1,t:3},{v:'10',t:1},{v:'#DIV/0!',t:4},{}]);
  const unit=Object.create(sdk.__icons.prototype);let bands;unit.setPreComputingCache=b=>bands=b;unit._preComputingStatus$={next(){}};
  const context={rule:entry,worksheet:{getMaxRows:()=>100,getMaxColumns:()=>20},getCellValue:r=>cells[r]??{}};
  unit.preComputing(0,0,context);
  assert.deepEqual(cells.map((_,r)=>unit.getCellResult(r,0,bands,context)?.iconId),['2','2','1','1','0',undefined,undefined,undefined,undefined]);
});
test('installed 5Quarters endpoint SVG bytes are identical; exchange refusal leaves native family intact',()=>{
  const quarters=sdk.iconMap['5Quarters'];assert.equal(quarters.length,5);
  const bytes=value=>Buffer.from(value.slice(value.indexOf(',')+1),'base64');
  assert.deepEqual(bytes(quarters[0]),bytes(quarters[4]));
  assert.equal(createHash('sha256').update(quarters[0]).digest('hex'),'17e095fae29aa127c3c343f2f4f3c7833904f56adc77242a3343dbcff7d8caad');
  // Other installed standard families have distinct assets; the native registry
  // is unchanged. This does not claim cross-app raster identity.
  for(const family of ['3Arrows','3ArrowsGray','3Flags','3TrafficLights1','3TrafficLights2','3Signs','3Symbols','3Symbols2','4Arrows','4ArrowsGray','4RedToBlack','4TrafficLights','4Rating','5Arrows','5ArrowsGray','5Rating'])
    assert.equal(new Set(sdk.iconMap[family]).size,sdk.iconMap[family].length,family);
});
test('installed renderer selects the exact family/id asset, suppresses small/hidden cells and leaves text hiding to composition',()=>{
  // Exercise actual renderer with loaded-image stand-ins; not browser pixel proof.
  const renderer=Object.create(sdk.ConditionalFormattingIcon.prototype),asset={fixture:true},draws=[];
  Object.assign(renderer,{_width:15,_paddingRightAndLeft:2,_imageMap:new Map([['3Arrows_2',asset]]),_renderRangeResolver:null});
  renderer.isRenderDiffRangesByCell=()=>true;
  const cell={iconSet:{iconType:'3Arrows',iconId:'2',isShowValue:false}};let visible=true,height=20;
  const skeleton={rowColumnSegment:{startRow:0,endRow:0,startColumn:0,endColumn:0},worksheet:{getMergeData:()=>[],getRowVisible:()=>visible,getColVisible:()=>true,getCell:()=>cell},getCellWithCoordByIndex:()=>({isMerged:false,isMergedMainCell:false,mergeInfo:{},startX:0,endX:80,startY:0,endY:height})};
  const ctx={save(){},restore(){},drawImage(...a){draws.push(a);}};
  renderer.draw(ctx,{},skeleton,[]);assert.equal(draws.length,1);assert.equal(draws[0][0],asset);
  visible=false;renderer.draw(ctx,{},skeleton,[]);visible=true;height=10;renderer.draw(ctx,{},skeleton,[]);assert.equal(draws.length,1);
});
test('icon unsafe populations and formulas refuse before preview/adoption/original writes',async()=>{
  const state=initialState('owner'),before=structuredClone(state);let writes=0;
  const workspace=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)});
  const exchange=new XlsxExchange({workspace,worker:trustedWorker,files:{writeOriginal(){writes++;throw Error('must not write');}}});
  for(const [i,base64] of fixtures.bad.entries()){
    const input={filename:'Icons.xlsx',commandId:'bad-icons-'+i,synthetic:true,base64};
    await assert.rejects(()=>exchange.preview('owner',input));await assert.rejects(()=>exchange.import('owner',input));
  }
  assert.equal(writes,0);assert.deepEqual(state,before);
  const b=trustedCodec({op:'import',base64:fixtures.good}).book;assert.equal(b.sheets.sheet1.cellData[1][0].v,9007199254740994);
});
test('native icon populations, >/>= edges, reversal, hiding and live edits survive actual exchange',async()=>{
  for(const kind of ['num','percent','percentile']){
    const b=ruleBook(kind);validateWorkbook(b);
    const v=mountNative({book:b,version:'icons-'+kind});
    try{
      await v.settle();const s=v.api.getActiveWorkbook().getActiveSheet();
      assert.deepEqual(ids(v,b),['2','1','0',undefined,undefined,undefined,undefined,undefined]);
      const entry=conditionalRules(b).sheet1[0];entry.rule.isShowValue=false;entry.rule.config.forEach((p,i)=>p.iconId=String(2-i));entry.rule.config[1].operator='greaterThan';
      await v.conditionalSettled(()=>s.setConditionalFormattingRule(entry.cfId,entry));
      assert.deepEqual(ids(v,b).slice(0,3),['0','0','2']);assert.equal(v.conditional.composeStyle(b.id,'sheet1',0,0).isShowValue,false);
      assert.equal(s.getSheet().getCell(0,0).fontRenderExtension.isSkip,true);assert.ok(!s.getSheet().getCell(3,0).fontRenderExtension?.isSkip);
      await v.conditionalSettled(()=>s.getRange('A2').setValue(7));assert.equal(ids(v,b)[1],kind==='percentile'?'0':'1');
      const snapshot=await v.handle.commit();const output=trustedCodec({op:'export',book:snapshot});
      const reopened=trustedCodec({op:'import',base64:output.base64}).book;
      assert.deepEqual(conditionalRules(reopened),conditionalRules(snapshot));assert.equal(reopened.sheets.sheet1.cellData[1][0].v,7);
      for(const row of Object.values(snapshot.sheets.sheet1.cellData))for(const c of Object.values(row)){assert.equal(c.iconSet,undefined);assert.equal(c.fontRenderExtension,undefined);}
      for(const formula of ['=1+1','=TRUE()','="text"','=1/0']){
        await v.conditionalSettled(()=>s.getRange('A2').setValue(formula));await v.settle();
        assert.throws(()=>trustedCodec({op:'export',book:v.handle.save()}),/without evaluating formulas/);
      }
    }finally{await delay(1100);v.dispose();}
  }
});
test('independent mixed two-tab icon import retains exact original, priorities, protected blanks and dirty-export isolation',async()=>{
  const state=initialState('owner'),workspace=new Workspace({transaction:async fn=>fn(state),read:async fn=>fn(state)}),originals=[];
  const exchange=new XlsxExchange({workspace,worker:trustedWorker,files:{async writeOriginal(owner,b){originals.push(Buffer.from(b));return {bytes:b.length,hash:'icon-fixture'};}}});
  const input={filename:'Icons.xlsx',commandId:'icons-import',synthetic:true,base64:fixtures.mixed};
  const before=structuredClone(state);const preview=await exchange.preview('owner',input);assert.equal(preview.sheets.length,2);assert.ok(preview.warnings.length<=40);assert.ok(preview.warnings.every(w=>w.length<=500));assert.deepEqual(state,before);
  const adopted=await exchange.import('owner',input);assert.deepEqual(await exchange.import('owner',input),adopted);
  const saved=structuredClone(state.works[adopted.workId]),b=structuredClone(saved.book);assert.ok(saved.humanCells.includes('sheet2:7:7'));assert.equal(conditionalRules(b).sheet1.length,12);
  b.sheets.sheet1.cellData[1][5].v=7;const prior=structuredClone(state);
  const output=await exchange.export('owner',{workId:b.id,book:b});assert.deepEqual(state,prior);
  const reopened=trustedCodec({op:'import',base64:output.base64}).book;
  const meaning=b=>Object.values(conditionalRules(b)).map(rs=>rs.map(({cfId,...r})=>r));assert.deepEqual(meaning(reopened),meaning(b));
  assert.deepEqual(originals[0],Buffer.from(fixtures.mixed,'base64'));assert.deepEqual(state.works[b.id],saved);
  const v=mountNative({book:reopened,version:'mixed-icons-cold'});
  try{await v.settle();const result=v.conditional.composeStyle(reopened.id,'sheet1',0,5);assert.equal(result.iconSet,undefined);assert.equal(result.style.bg.rgb,'#FFEEAA');assert.equal(v.conditional.composeStyle(reopened.id,'sheet2',1,5).iconSet.iconType,'3Arrows');}finally{await delay(1100);v.dispose();}
});
