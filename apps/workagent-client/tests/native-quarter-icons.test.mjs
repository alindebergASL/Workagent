import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { setTimeout as delay } from 'node:timers/promises';
import { mountNative } from './sheet-scale-harness.mjs';
import { blankWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CONDITIONAL_RESOURCE, conditionalRules } from '../../../packages/workagent-contract/conditional-formatting.mjs';
const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-conditional-formatting'));
const sdk = require('@univerjs/sheets-conditional-formatting');
const original = {...sdk.iconMap};
const groups = sdk.iconGroup.flatMap(g=>g.group).map(g=>({name:g.name,list:g.list}));
const module = {exports:{}};
new Function('require','module','exports',ts.transpileModule(readFileSync(new URL('../src/native-quarter-icons.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>sdk,module,module.exports);
const {installNativeQuarterIcons,quarterIconSources} = module.exports;
const nodes = n=>Array.isArray(n)?n.flatMap(nodes):n?.props?[n,...nodes(n.props.children)]:[];
const range={startRow:0,endRow:7,startColumn:0,endColumn:0};
function book(){
  const b=blankWorkbook('quarters-native');
  b.sheets.sheet1.cellData=Object.fromEntries([0,10,20,30,40,null,true,'20'].map((v,r)=>[r,Object.fromEntries([0,1,2,3].map(c=>[c,v===null?{}:{v,t:typeof v==='number'?2:typeof v==='boolean'?3:1}]))]));
  b.sheets.sheet1.cellData[0][5]={f:'=1+1'};
  b.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[0,1,2,3].map(c=>({cfId:'quarter-'+c,stopIfTrue:false,ranges:[{...range,startColumn:c,endColumn:c}],rule:{type:'iconSet',isShowValue:c<2,config:[40,30,20,10,0].map((v,i)=>({iconType:'5Quarters',iconId:String(c%2?4-i:i),operator:i===4?'lessThanOrEqual':'greaterThanOrEqual',value:{type:'num',value:v}}))}}))})}];return b;
}

test('static quarter setup replaces both installed registries idempotently before new native image caches; all other assets unchanged',()=>{
  assert.equal(original['5Quarters'][0],original['5Quarters'][4],'inherited defect is real');
  const previous=globalThis.Image;
  globalThis.Image=class {set src(value){this.source=value;this.onload?.();}};
  try{for(let mount=0;mount<3;mount++){
    installNativeQuarterIcons();assert.equal(sdk.iconMap['5Quarters'],quarterIconSources);
    assert.equal(sdk.iconGroup.flatMap(g=>g.group).find(g=>g.name==='5Quarters').list,quarterIconSources);
    const renderer=new sdk.ConditionalFormattingIcon();
    try{assert.deepEqual([0,1,2,3,4].map(i=>renderer._imageMap.get('5Quarters_'+i).source),quarterIconSources);}finally{renderer.dispose();}
    for(const [family,list] of Object.entries(original))if(family!=='5Quarters')assert.equal(sdk.iconMap[family],list,family);
    for(const g of groups)if(g.name!=='5Quarters')assert.equal(sdk.iconGroup.flatMap(g=>g.group).find(x=>x.name===g.name).list,g.list,g.name);
  }}finally{if(previous===undefined)delete globalThis.Image;else globalThis.Image=previous;}
});

test('quarter SVG geometry has full/three-quarter/half/quarter/empty dark areas at native size, with a common visible outline',()=>{
  // Geometry proof, not a raster/decoder claim: interpret the actual circular
  // arc endpoints and large-arc flag, independently of source byte inequality.
  const areas=quarterIconSources.map(src=>{
    const svg=decodeURIComponent(src.split(',')[1]);
    assert.match(svg,/viewBox="0 0 16 16"/);
    assert.match(svg,/<circle cx="8" cy="8" r="6.5" fill="white"\/>/);
    assert.match(svg,/<circle cx="8" cy="8" r="6.5" fill="none" stroke="#4b5563" stroke-width="1"\/>/);
    if(svg.includes('<circle cx="8" cy="8" r="6.5" fill="#4b5563"/>'))return Math.PI*6**2*(15/16)**2;
    const arc=svg.match(/<path d="M8 8 L8 1.5 A6.5 6.5 0 ([01]) 1 ([\d.]+) ([\d.]+) Z" fill="#4b5563"\/>/);
    if(!arc){assert.ok(!svg.includes('<path'));return 0;}
    const angle=(Math.atan2(+arc[3]-8,+arc[2]-8)+Math.PI/2+2*Math.PI)%(2*Math.PI);
    assert.equal(+(angle>Math.PI),+arc[1]);
    return angle/2*6**2*(15/16)**2;
  });
  assert.deepEqual(areas.map(a=>Math.round(a/areas[0]*100)),[100,75,50,25,0]);
  for(let i=1;i<5;i++)assert.ok(areas[i-1]-areas[i]>24,'substantial area distinction at 15px');
});

test('actual native quarters compose, canvas sources, picker and preview survive repeated mounts, edits, Undo/Redo and reopen',async()=>{
  let b=book();
  for(let mount=0;mount<2;mount++){
    // Restore only fixture registry references to prove each app mount installs
    // assets before createUniver, even without earlier test initialization.
    sdk.iconMap['5Quarters']=original['5Quarters'];
    sdk.iconGroup.flatMap(g=>g.group).find(g=>g.name==='5Quarters').list=original['5Quarters'];
    const v=mountNative({book:b,version:'quarters-'+mount});let editor,picker;
    assert.deepEqual(v.initialQuarterSources,quarterIconSources);
    try{
      await v.settle();const wb=v.api.getActiveWorkbook(),s=wb.getActiveSheet();
      const ids=c=>Array.from({length:8},(_,r)=>v.conditional.composeStyle(b.id,'sheet1',r,c)?.iconSet?.iconId);
      for(let c=0;c<4;c++){
        const expected=c%2?['0','1','2','3','4']:['4','3','2','1','0'];
        assert.deepEqual(ids(c),[...expected,undefined,undefined,undefined]);
        for(let r=0;r<5;r++)assert.equal(!!s.getSheet().getCell(r,c).fontRenderExtension?.isSkip,c>=2);
        const drawn=v.drawIcons('sheet1',{...range,startColumn:c,endColumn:c});
        assert.deepEqual(drawn.map(d=>d.source),expected.map(i=>quarterIconSources[+i]));
        assert.ok(drawn.every(d=>d.geometry[2]===15&&d.geometry[3]===15));
      }
      picker=v.openIconFamilyPicker();
      const quarterButton=nodes(picker.tree).find(n=>n.type==='button'&&n.props['aria-pressed']===true);
      assert.deepEqual(nodes(quarterButton).filter(n=>n.type==='img').map(n=>n.props.src),quarterIconSources);
      editor=v.openConditionalEditor(conditionalRules(b).sheet1[0]);
      assert.deepEqual(nodes(editor.tree).filter(n=>n.type==='img').map(n=>n.props.src),quarterIconSources);
      assert.match(editor.text(),/Otherwise/);await editor.submit();editor.dispose();editor=null;
      await v.conditionalSettled(()=>s.getRange('A1').setValue(40));assert.equal(ids(0)[0],'0');
      await v.conditionalSettled(()=>wb.undo());assert.equal(ids(0)[0],'4');
      await v.conditionalSettled(()=>wb.redo());assert.equal(ids(0)[0],'0');
      await v.conditionalSettled(()=>wb.undo());assert.equal(ids(0)[0],'4');
      const r=conditionalRules(v.handle.save()).sheet1[0];r.rule.config[1].operator='greaterThan';
      await v.conditionalSettled(()=>s.setConditionalFormattingRule(r.cfId,r));assert.equal(ids(0)[3],'2');
      await v.conditionalSettled(()=>wb.undo());assert.equal(ids(0)[3],'1');
      b=await v.handle.commit();assert.deepEqual(conditionalRules(b),conditionalRules(book()));
    }finally{editor?.dispose();picker?.dispose();await delay(1100);v.dispose();}
  }
});

test('native authoring menu keeps quarter family, Reverse, > comparator, Otherwise and show-value controls through Submit and Undo',async()=>{
  const b=book(),v=mountNative({book:b,version:'quarter-author'});let e;
  try{
    await v.settle();const menu=v.openIconMenu({...range,startColumn:4,endColumn:4});e=menu.editor;
    const control=label=>n=>n.props['aria-label']===label;
    const input=value=>({target:{value:String(value)}});
    e.change(control('Icon family'),input('5Quarters'));
    assert.deepEqual(nodes(e.tree).filter(n=>n.type==='img').map(n=>n.props.src),quarterIconSources);
    const reverse=e.find(n=>typeof n.props.onClick==='function'&&n.props.children==='Reverse icons');reverse.props.onClick();e.flush();
    assert.deepEqual(nodes(e.tree).filter(n=>n.type==='img').map(n=>n.props.src),[...quarterIconSources].reverse());
    for(let i=1;i<5;i++){e.change(control('Threshold type '+i),input('num'));e.change(control('Threshold '+i),input(50-i*10));}
    e.change(control('Operator 2'),input('greaterThan'));
    e.change(n=>typeof n.props.onChange==='function'&&n.props.children==='Show values',false);
    assert.match(e.text(),/Otherwise/);assert.ok(!nodes(e.tree).some(control('Threshold 5')));
    await e.submit();
    const saved=await v.handle.commit(),added=conditionalRules(saved).sheet1.find(r=>!conditionalRules(b).sheet1.some(old=>old.cfId===r.cfId));
    assert.ok(added,e.text());assert.equal(added.rule.isShowValue,false);
    assert.deepEqual(added.rule.config.map(p=>p.iconId),['4','3','2','1','0']);
    assert.equal(added.rule.config[1].operator,'greaterThan');
    assert.equal(added.rule.config.at(-1).operator,'lessThanOrEqual');
    v.api.getActiveWorkbook().undo();assert.ok(!conditionalRules(v.handle.save()).sheet1.some(r=>r.cfId===added.cfId));
    v.api.getActiveWorkbook().redo();assert.deepEqual(conditionalRules(v.handle.save()).sheet1.find(r=>r.cfId===added.cfId),added);
  }finally{e?.dispose();await delay(1100);v.dispose();}
});
