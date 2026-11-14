import test from 'node:test';
import assert from 'node:assert/strict';
import {mountNative} from './sheet-scale-harness.mjs';
import {blankWorkbook,validateWorkbook} from '../../../packages/workagent-contract/index.mjs';
import {CONDITIONAL_RESOURCE,conditionalRules} from '../../../packages/workagent-contract/conditional-formatting.mjs';
const range={startRow:0,endRow:3,startColumn:0,endColumn:0};
const icon=(values=[20,10,0])=>({cfId:'icons',stopIfTrue:true,ranges:[range],rule:{type:'iconSet',config:values.map((v,i)=>({iconType:'3Arrows',iconId:String(i),operator:i===2?'lessThanOrEqual':'greaterThanOrEqual',value:{type:'num',value:v}}))}});
const highlight={cfId:'lower',stopIfTrue:false,ranges:[range],rule:{type:'highlightCell',subType:'number',operator:'greaterThan',value:-1,style:{bg:{rgb:'#ff0000'},cl:{rgb:'#2f56ef'}}}};
async function mount(r,withB=false){const book=blankWorkbook('editor');book.sheets.sheet1.cellData={0:{0:{v:0,t:2},2:{f:'=1+2'}},1:{0:{v:10,t:2}},2:{0:{v:20,t:2}},3:{0:{v:40,t:2}}};if(withB)for(let row=0;row<4;row++)book.sheets.sheet1.cellData[row][1]={...book.sheets.sheet1.cellData[row][0]};book.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[r,highlight]})}];const v=mountNative({book,version:'editor'});await v.settle();return v;}
const saved=v=>conditionalRules(v.handle.save()).sheet1[0];
test('mounted editor initialization and Submit preserve omitted visibility default',async()=>{const r=icon();r.stopIfTrue=false;const v=await mount(r);let e;try{e=v.openConditionalEditor(r);await e.submit();assert.equal(saved(v).rule.isShowValue??true,true);}finally{e?.dispose();v.dispose();}});
test('mounted editor Submit preserves stopIfTrue above a highlight',async()=>{const r=icon();r.rule.isShowValue=true;const v=await mount(r);let e;try{e=v.openConditionalEditor(r);await e.submit();assert.equal(saved(v).stopIfTrue,true);assert.equal(v.conditional.composeStyle('editor','sheet1',2,0).style,undefined);}finally{e?.dispose();v.dispose();}});
test('mounted editor beforeSubmit accepts tied and crossing associations',async()=>{for(const values of [[20,20,0],[10,30,0]]){const r=icon(values);r.rule.isShowValue=true;const v=await mount(r);let e;try{e=v.openConditionalEditor(r);let mutations=0;const listener=v.commands.onCommandExecuted(c=>{if(c.id==='sheet.mutation.set-conditional-rule')mutations++;});await e.submit();listener.dispose();assert.equal(mutations,1);assert.deepEqual(saved(v).rule.config,r.rule.config);}finally{e?.dispose();v.dispose();}}});
const control = label => n=>n.props['aria-label']===label;
const checkbox = label => n=>typeof n.props.onChange==='function'&&n.props.children===label;
const input = value => ({target:{value:String(value)}});
test('actual native Icon Set menu draft chooses a family, Adds visible icons and persists strictly',async()=>{
  const v=await mount(icon(),true);let e;try{
    const before=v.handle.save();let exits=0;const calls=[];
    const listener=v.commands.onCommandExecuted(c=>{if(/^sheet.command.(add|set)-conditional-rule$/.test(c.id))calls.push(c.id);});
    const menu=v.openIconMenu({...range,startColumn:1,endColumn:1},()=>exits++);e=menu.editor;
    assert.deepEqual(menu.rule.rule,{type:'iconSet',config:[],isShowValue:true});
    assert.equal(e.find(checkbox('Show values')).props.checked,true);
    e.change(control('Icon family'),input('3Arrows'));await e.submit();
    assert.doesNotMatch(e.text(),/This rule was removed/);assert.equal(exits,1);
    assert.deepEqual(calls,['sheet.command.add-conditional-rule']);listener.dispose();
    const book=await v.handle.commit();validateWorkbook(book);
    const added=conditionalRules(book).sheet1.find(r=>!conditionalRules(before).sheet1.some(p=>p.cfId===r.cfId));
    assert.ok(added?.cfId);assert.equal(added.stopIfTrue,false);assert.equal(added.rule.config.length,3);
    assert.deepEqual(book.sheets.sheet1.cellData,before.sheets.sheet1.cellData);
    assert.deepEqual([0,1,2,3].map(row=>v.conditional.composeStyle('editor','sheet1',row,1).iconSet.iconId),['2','2','1','0']);
    const persisted=await v.handle.commit();validateWorkbook(persisted);
    const reopened=mountNative({book:persisted,version:'reopened-icons'});try{await reopened.settle();assert.deepEqual(conditionalRules(reopened.handle.save()),conditionalRules(persisted));assert.equal(reopened.conditional.composeStyle('editor','sheet1',3,1).iconSet.iconId,'0');}finally{reopened.dispose();}
  }finally{e?.dispose();v.dispose();}
});
test('new preallocated native draft toggles are explicit; collision and removed edit refuse without resurrection',async()=>{
  const v=await mount(icon());let e;try{
    const menu=v.openIconMenu(range);menu.editor.dispose();
    // The menu draft can also arrive with an ID allocated by the native model.
    const draft={...menu.rule,cfId:'allocated-draft',stopIfTrue:false};let exits=0;
    e=v.openConditionalEditor(draft,()=>exits++);e.change(control('Icon family'),input('3Arrows'));e.change(checkbox('Show values'),false);e.change(checkbox('Stop if true'),true);await e.submit();
    assert.equal(exits,1);assert.deepEqual(conditionalRules(v.handle.save()).sheet1.find(r=>r.cfId===draft.cfId).stopIfTrue,true);assert.equal(conditionalRules(v.handle.save()).sheet1.find(r=>r.cfId===draft.cfId).rule.isShowValue,false);e.dispose();
    const sheet=v.api.getActiveWorkbook().getActiveSheet();
    e=v.openConditionalEditor({...draft,cfId:'collision'},()=>exits++);e.change(control('Icon family'),input('3Flags'));
    sheet.addConditionalFormattingRule({...icon(),cfId:'collision'});const occupied=v.handle.save();await e.submit();assert.match(e.text(),/already exists/);assert.deepEqual(v.handle.save(),occupied);assert.equal(exits,1);e.dispose();
    e=v.openConditionalEditor(saved(v),()=>exits++);const removedId=saved(v).cfId;sheet.deleteConditionalFormattingRule(removedId);const removed=v.handle.save();await e.submit();assert.match(e.text(),/This rule was removed/);assert.deepEqual(v.handle.save(),removed);assert.equal(exits,1);
  }finally{e?.dispose();v.dispose();}
});
test('fresh menu validation/cancel/navigation and aggregate caps have no partial effects',async()=>{
  const v=await mount(icon());let e;try{
    let exits=0;const before=v.handle.save();e=v.openIconMenu(range,()=>exits++).editor;
    await e.submit();assert.match(e.text(),/Use valid sheet ranges/);assert.equal(exits,0);assert.deepEqual(v.handle.save(),before);
    e.find(n=>typeof n.props.onClick==='function'&&/panel.cancel$/.test(n.props.children)).props.onClick();e.flush();assert.equal(exits,1);assert.deepEqual(v.handle.save(),before);e.dispose();
    e=v.openIconMenu(range,()=>exits++).editor;v.api.getActiveWorkbook().create('Other',10,5);e.flush();assert.equal(exits,2);assert.doesNotMatch(e.text(),/Thresholds keep/);e.dispose();
  }finally{e?.dispose();v.dispose();}
  for(const kind of ['rules','ranges','area']){
    const book=blankWorkbook('editor');book.sheets.sheet1.cellData={0:{2:{f:'=1+2'}}};
    const rules=kind==='rules'?Array.from({length:256},(_,i)=>({...icon(),cfId:`cap-${i}`})):[{...icon(),ranges:kind==='ranges'?Array.from({length:1000},()=>range):[{...range,endRow:9999,endColumn:9}]}];
    book.sheets.sheet1.rowCount=10000;book.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:rules})}];validateWorkbook(book);
    const capped=mountNative({book,version:`cap-${kind}`});try{await capped.settle();capped.api.getActiveWorkbook().getActiveSheet().getRange('B1').setValue('undo sentinel');e=capped.openIconMenu(range).editor;e.change(control('Icon family'),input('3Arrows'));const before=capped.handle.save(),edits=capped.handle.formatEdits();await e.submit();assert.match(e.text(),/Use valid sheet ranges/);assert.deepEqual(capped.handle.save(),before);assert.deepEqual(capped.handle.formatEdits(),edits);capped.api.getActiveWorkbook().undo();assert.equal(capped.handle.save().sheets.sheet1.cellData[0]?.[1]?.v,undefined);}finally{e?.dispose();capped.dispose();}
  }
});
test('native list callbacks switch rule identity; unchanged edits Set and refused Adds stay open',async()=>{
  const v=await mount(icon());let e;try{
    const second={...icon([30,15,0]),cfId:'second',stopIfTrue:false};v.api.getActiveWorkbook().getActiveSheet().addConditionalFormattingRule(second);
    let exits=0;e=v.openConditionalEditor(undefined,()=>exits++);
    const select=e.find(n=>typeof n.props.onCreate==='function'&&typeof n.props.onClick==='function').props.onClick;
    select(icon());e.flush();e.change(checkbox('Show values'),false);e.change(control('Threshold 1'),input(''));
    select(second);e.flush();assert.equal(e.find(control('Threshold 1')).props.value,30);assert.equal(e.find(checkbox('Show values')).props.checked,true);
    const before=v.handle.save(),calls=[];const listener=v.commands.onCommandExecuted(c=>{if(/^sheet.command.(add|set)-conditional-rule$/.test(c.id))calls.push(c.id);});
    await e.submit();assert.equal(exits,1);assert.deepEqual(calls,['sheet.command.set-conditional-rule']);assert.deepEqual(v.handle.save(),before);listener.dispose();e.dispose();
    e=v.openIconMenu(range,()=>exits++).editor;e.change(control('Icon family'),input('3Arrows'));
    const refuse=v.api.addEvent(v.api.Event.BeforeCommandExecute,c=>{if(c.id==='sheet.command.add-conditional-rule')throw new Error('test command refusal');});
    try{await e.submit();assert.match(e.text(),/The rule was not applied/);assert.equal(exits,1);assert.deepEqual(v.handle.save(),before);}finally{refuse.dispose();}
  }finally{e?.dispose();v.dispose();}
});
test('mounted visibility omitted/true/false saves and intentional toggles retain effective values',async()=>{
  for(const show of [undefined,true,false]){const r=icon();if(show!==undefined)r.rule.isShowValue=show;const v=await mount(r);let e;
    try{e=v.openConditionalEditor(r);assert.equal(e.find(checkbox('Show values')).props.checked,show??true);await e.submit();assert.deepEqual(saved(v),r);e.dispose();
      e=v.openConditionalEditor(saved(v));e.change(checkbox('Show values'),!(show??true));await e.submit();assert.equal(saved(v).rule.isShowValue,!(show??true));assert.equal(saved(v).stopIfTrue,true);
    }finally{e?.dispose();v.dispose();}
  }
});
test('icon and visibility edits retain stop priority; explicit checkbox/facade/commands can change it',async()=>{
  const r=icon(),v=await mount(r);let e;try{const sheet=v.api.getActiveWorkbook().getActiveSheet();
    for(const edit of [e=>{},e=>e.change(control('Icon 1'),input('3Flags:2')),e=>e.change(checkbox('Show values'),false)]){
      e=v.openConditionalEditor(saved(v));edit(e);await e.submit();assert.equal(saved(v).stopIfTrue,true);assert.equal(v.conditional.composeStyle('editor','sheet1',2,0).style,undefined);e.dispose();
    }
    e=v.openConditionalEditor(saved(v));e.change(checkbox('Stop if true'),false);await e.submit();assert.equal(saved(v).stopIfTrue,false);assert.equal(v.conditional.composeStyle('editor','sheet1',2,0).style.bg.rgb,'#ff0000');e.dispose();
    sheet.setConditionalFormattingRule('icons',{...saved(v),stopIfTrue:true});assert.equal(saved(v).stopIfTrue,true);
    e=v.openConditionalEditor(saved(v));sheet.setConditionalFormattingRule('icons',{...saved(v),stopIfTrue:false});e.change(control('Icon 1'),input('3Arrows:0'));await e.submit();assert.equal(saved(v).stopIfTrue,false,'ordinary editor save does not reverse a newer facade stop change');e.dispose();
    await v.commands.executeCommand('sheet.command.set-conditional-rule',{unitId:'editor',subUnitId:'sheet1',rule:{...saved(v),stopIfTrue:true}});assert.equal(saved(v).stopIfTrue,true);
    sheet.setConditionalFormattingRule('icons',{...saved(v),stopIfTrue:false});assert.equal(saved(v).stopIfTrue,false);
  }finally{e?.dispose();v.dispose();}
});
test('ties, crossings and mixed types preserve exact associations, row order, raw cells and priority after visibility edits',async()=>{
  for(const kind of ['ties','crossing','mixed']){const r=icon(kind==='ties'?[20,20,0]:[10,30,0]);if(kind==='crossing')r.rule.config.slice(0,2).forEach(p=>p.operator='greaterThan');if(kind==='mixed')r.rule.config[1].value={type:'percent',value:75};const v=await mount(r);let e;
    try{const before=v.handle.save(),icons=()=>[0,1,2,3].map(row=>v.conditional.composeStyle('editor','sheet1',row,0).iconSet.iconId),expected=icons();
      e=v.openConditionalEditor(r);e.change(checkbox('Show values'),false);await e.submit();assert.deepEqual(saved(v).rule.config,r.rule.config);assert.deepEqual(icons(),expected);assert.deepEqual(conditionalRules(v.handle.save()).sheet1.map(r=>r.cfId),['icons','lower']);assert.deepEqual(v.handle.save().sheets.sheet1.cellData,before.sheets.sheet1.cellData);assert.equal(v.conditional.composeStyle('editor','sheet1',2,0).style,undefined);
    }finally{e?.dispose();v.dispose();}
  }
});
test('editor domain validation refuses genuine invalid thresholds before mutation or Undo',async()=>{
  const r=icon(),v=await mount(r);let e;try{const sheet=v.api.getActiveWorkbook().getActiveSheet();sheet.getRange('B1').setValue('undo sentinel');const before=v.handle.save(),provenance=v.handle.formatEdits();let mutations=0;const listener=v.commands.onCommandExecuted(c=>{if(c.id==='sheet.mutation.set-conditional-rule')mutations++;});
    for(const change of [e=>e.change(control('Threshold 1'),input('')),e=>e.change(control('Threshold 1'),input('Infinity')),e=>e.change(control('Threshold 1'),input('9007199254740992')),e=>{e.change(control('Threshold type 1'),input('percent'));e.change(control('Threshold 1'),input('-1'));},e=>{e.change(control('Threshold type 1'),input('percentile'));e.change(control('Threshold 1'),input('101'));},e=>e.change(control('Threshold type 1'),input('formula')),e=>e.change(control('Icon 1'),input('CUSTOM:0')),e=>e.change(control('Operator 1'),input('lessThan'))]){
      e=v.openConditionalEditor(r);change(e);await e.submit();assert.match(e.text(),/Use valid sheet ranges/);assert.deepEqual(v.handle.save(),before);assert.deepEqual(v.handle.formatEdits(),provenance);e.dispose();
    }
    listener.dispose();assert.equal(mutations,0);v.api.getActiveWorkbook().undo();assert.equal(v.handle.save().sheets.sheet1.cellData[0]?.[1]?.v,undefined);
  }finally{e?.dispose();v.dispose();}
});
test('native non-icon editor and new-rule chooser still execute through the public slot',async()=>{
  const r=icon(),v=await mount(r);let e;try{const sheet=v.api.getActiveWorkbook().getActiveSheet();
    let mutations=0;const listener=v.commands.onCommandExecuted(c=>{if(c.id==='sheet.mutation.set-conditional-rule')mutations++;});
    e=v.openConditionalEditor(highlight);assert.ok(e.find(n=>n.props.value==='1'&&Array.isArray(n.props.options)));await e.submit();assert.equal(mutations,1);assert.deepEqual(conditionalRules(v.handle.save()).sheet1[1],highlight);e.dispose();
    e=v.openConditionalEditor(undefined);const nativePanel=e.find(n=>typeof n.props.onCreate==='function');nativePanel.props.onCreate();e.flush();assert.ok(e.find(n=>n.props.value==='1'&&Array.isArray(n.props.options)));e.dispose();
    const bar={cfId:'bar',stopIfTrue:false,ranges:[range],rule:{type:'dataBar',isShowValue:true,config:{min:{type:'min',value:0},max:{type:'max',value:100},isGradient:false,positiveColor:'#ffbe38',nativeColor:'#abd91a'}}};sheet.addConditionalFormattingRule(bar);
    e=v.openConditionalEditor(bar);assert.ok(e.find(n=>n.props.value==='3'&&Array.isArray(n.props.options)));await e.submit();assert.equal(mutations,2);assert.deepEqual(conditionalRules(v.handle.save()).sheet1.find(r=>r.cfId==='bar'),bar);e.dispose();
    const scale={cfId:'scale',stopIfTrue:false,ranges:[range],rule:{type:'colorScale',config:[{index:0,color:'#ff0000',value:{type:'min',value:0}},{index:1,color:'#00ff00',value:{type:'max',value:100}}]}};sheet.addConditionalFormattingRule(scale);e=v.openConditionalEditor(scale);await e.submit();assert.equal(mutations,3);assert.deepEqual(conditionalRules(v.handle.save()).sheet1.find(r=>r.cfId==='scale'),scale);listener.dispose();
  }finally{e?.dispose();v.dispose();}
});
test('mounted adapters isolate concurrent instances, reverse/no-icon edits and dispose on sheet activation',async()=>{
  const a=await mount(icon()),b=await mount(icon([30,20,0]));let ea,eb;try{ea=a.openConditionalEditor(saved(a));eb=b.openConditionalEditor(saved(b));
    ea.change(control('Icon 1'),input('EMPTY_ICON_TYPE:'));await ea.submit();assert.equal(saved(a).rule.config[0].iconType,'EMPTY_ICON_TYPE');assert.equal(saved(b).rule.config[0].iconType,'3Arrows');ea.dispose();
    eb.change(checkbox('Show values'),false);await eb.submit();assert.equal(saved(b).rule.isShowValue,false);assert.equal(saved(a).rule.isShowValue,undefined);eb.dispose();
    ea=a.openConditionalEditor(saved(a));ea.find(n=>n.props.children==='Reverse icons').props.onClick();ea.flush();await ea.submit();assert.equal(saved(a).rule.config[2].iconType,'EMPTY_ICON_TYPE');ea.dispose();
    ea=a.openConditionalEditor(saved(a));const wb=a.api.getActiveWorkbook();wb.create('Other',10,5);ea.flush();assert.doesNotMatch(ea.text(),/Thresholds keep their icons/);
  }finally{ea?.dispose();eb?.dispose();a.dispose();b.dispose();}
});
test('mounted icon family chooser retains valid 3/4/5-band rules and range selector preserves initial ranges',async()=>{
  const v=await mount(icon());let e;try{
    for(const [family,count] of [['3Flags',3],['4Arrows',4],['5Rating',5]]){
      e=v.openConditionalEditor(saved(v));const selector=e.find(n=>n.props.initialValue==='A1:A4');selector.props.onChange([], '');e.flush();
      e.change(control('Icon family'),input(family));await e.submit();assert.equal(saved(v).rule.config.length,count);assert.ok(saved(v).rule.config.every(p=>p.iconType===family));assert.deepEqual(saved(v).ranges,[range]);assert.equal(saved(v).stopIfTrue,true);e.dispose();
    }
    e=v.openConditionalEditor(saved(v));e.find(n=>n.props.initialValue==='A1:A4').props.onChange([], 'B1:B4');e.flush();await e.submit();assert.deepEqual(saved(v).ranges.map(({startRow,endRow,startColumn,endColumn})=>({startRow,endRow,startColumn,endColumn})),[{...range,startColumn:1,endColumn:1}]);assert.ok(v.handle.formatEdits().sheet1.includes(601));
  }finally{e?.dispose();v.dispose();}
});
