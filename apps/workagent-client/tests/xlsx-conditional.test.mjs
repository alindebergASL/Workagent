// Trusted local fixtures + installed SDK, not Excel-application/browser evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { mountNative } from './sheet-scale-harness.mjs';
import { blankWorkbook, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CONDITIONAL_RESOURCE, conditionalRules } from '../../../packages/workagent-contract/conditional-formatting.mjs';
import { trustedCodec } from '../../workagent-server/tests/support/xlsx-fixture.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const req=createRequire(import.meta.resolve('@univerjs/preset-sheets-conditional-formatting'));
const filename=req.resolve('@univerjs/sheets-conditional-formatting'), module=new Module(filename);
module.filename=filename; module.paths=Module._nodeModulePaths(dirname(filename));
module._compile(readFileSync(filename,'utf8')+'\nmodule.exports.__probe = HighlightCellCalculateUnit;',filename);
const unit=Object.create(module.exports.__probe.prototype);
const match=(rule,cell)=>unit.getCellResult(0,0,null,{rule:{rule},getCellValue:()=>cell});
const generate=code=>{
  const result=spawnSync(root+'.local/xlsx-python/bin/python',['-I','-B','-c',code],{encoding:'utf8',maxBuffer:6000000,timeout:12000});
  assert.equal(result.status,0,result.stderr); return JSON.parse(result.stdout);
};
const prefix=`import importlib.util,json,base64,io,zipfile\ns=importlib.util.spec_from_file_location('fixtures',${JSON.stringify(root+'services/workagent-execution/xlsx/test_codec.py')})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n`;

test('installed native matcher establishes refused equality, whitespace, error and case semantics',()=>{
  const numeric={type:'highlightCell',subType:'number',operator:'equal',value:0,style:{bl:1}};
  assert.equal(match(numeric,{v:1e-17,t:2}),true,'native equality uses EPSILON, not Excel equality');
  assert.equal(match(numeric,null),true);assert.equal(match(numeric,{v:'0',t:1}),false);
  const text={...numeric,subType:'text',operator:'containsText',value:'Ready*?'};
  assert.equal(match(text,{v:'Ready*? now',t:1}),true);assert.equal(match(text,{v:'ready*? now',t:1}),false);
  assert.equal(match({...text,operator:'containsBlanks'},{v:'\t\u00a0',t:1}),true);
  assert.equal(match({...text,operator:'containsErrors'},{v:'#REF!',t:1}),true);
});

test('actual native matcher agrees with generated expression results for numbers, text, errors, blanks and true formulas',async()=>{
  const spec=generate(prefix+`
b=m.codec.import_book(m.fixture())['book'];b['sheets']['sheet1']['cellData']={};b['sheetOrder']=['sheet1'];b['sheets']={'sheet1':b['sheets']['sheet1']}
entries=[m.cf_entry(op,[-2,0] if op in ('between','notBetween') else 0) for op in m.codec.CF_NUM]
entries += [m.cf_entry(op,'雪 <&> "*?~"','text') for op in m.codec.CF_TEXT]
b['resources']=[{'name':m.codec.CF_RESOURCE,'data':json.dumps({'sheet1':entries})}]
x=m.codec.export_book(b);raw=base64.b64decode(x['base64'])
with zipfile.ZipFile(io.BytesIO(raw)) as z:
 r=m.ET.fromstring(z.read('xl/worksheets/sheet1.xml'));expressions=[e.text for e in r.findall('.//{'+m.NS+'}cfRule/{'+m.NS+'}formula')]
print(json.dumps({'book':m.codec.import_book(raw)['book'],'expressions':expressions}))`);
  const cells=[{}, {v:0,t:2},{v:-2,t:2},{v:2,t:2},{v:'0',t:1},{v:true,t:3},{v:false,t:3},{v:'#DIV/0!',t:1},{v:'  ',t:1},
    {v:'雪 <&> "*?~"',t:1},{v:'x雪 <&> "*?~"x',t:1},{v:'雪 <&> "*?~"x',t:1},{v:'x雪 <&> "*?~"',t:1},
    {f:'=1+1'},{f:'=1/0'},{f:'=IF(1=1,"",0)'},{f:'=IF(1=1,TRUE,FALSE)'}];
  const rules=conditionalRules(spec.book).sheet1;
  // Formula-engine diagnostics are test-only cells, never admitted exchange formulas.
  for(let row=0;row<cells.length;row++){
    const data=spec.book.sheets.sheet1.cellData[row]={0:cells[row]};
    for(let col=0;col<spec.expressions.length;col++)data[col+1]={f:'='+spec.expressions[col].replaceAll('A1',`A${row+1}`)};
  }
  spec.book.resources=[];
  const view=mountNative({book:spec.book,version:'cf-semantics'});
  try{
    await view.settle(); const sheet=view.api.getActiveWorkbook().getActiveSheet();
    for(let row=0;row<cells.length;row++){
      const source=sheet.getRange(row,0,1,1).getCellData();
      for(let col=0;col<rules.length;col++){
        const value=sheet.getRange(row,col+1,1,1).getValue();
        assert.ok(value===true||value===false||value===0||value===1,`expression calculated ${row}/${col}: ${value}`);
        assert.equal(Boolean(value),match(rules[col].rule,source),`${rules[col].rule.subType}/${rules[col].rule.operator} at ${row}: ${JSON.stringify(source)}`);
      }
    }
  }finally{await delay(1100);view.dispose();}
});

test('independent XLSX highlights render priority, false overlays and stopIfTrue and retain rules after SDK snapshot',async()=>{
  const base64=generate(prefix+'print(json.dumps(base64.b64encode(m.conditional_fixture()).decode()))');
  const imported=trustedCodec({op:'import',base64});validateWorkbook(imported.book);
  const data=conditionalRules(imported.book);
  data.sheet1.push({cfId:'overlap',stopIfTrue:false,ranges:data.sheet1[0].ranges,rule:{type:'highlightCell',subType:'text',operator:'notContainsText',value:'Ready',style:{bl:1,cl:{rgb:'#FF0000'}}}});
  imported.book.resources.find(r=>r.name===CONDITIONAL_RESOURCE).data=JSON.stringify(data);
  const view=mountNative({book:imported.book,version:'independent-cf'});
  try{
    await view.settle();
    const zero=view.conditional.composeStyle('preview','sheet1',0,0).style;
    assert.equal(zero.bl,0);assert.equal(zero.it,0);assert.equal(zero.ul.s,0);assert.equal(zero.st.s,0);assert.equal(zero.bg.rgb,'#FFEEAA');
    assert.equal(zero.cl,undefined,'stopIfTrue stops lower-priority overlay');
    assert.equal(view.conditional.composeStyle('preview','sheet1',3,0).style.cl.rgb,'#123456');
    const sheet=view.api.getActiveWorkbook().getActiveSheet();
    await view.conditionalSettled(()=>sheet.setConditionalFormattingRule(data.sheet1[0].cfId,{...data.sheet1[0],stopIfTrue:false}));
    const overlay=view.conditional.composeStyle('preview','sheet1',0,0).style;
    assert.equal(overlay.bl,0,'higher-priority explicit false overrides lower true');
    assert.equal(overlay.cl.rgb,'#FF0000','absent field permits lower-priority color');
    const snapshot=await view.handle.commit();
    const exported=trustedCodec({op:'export',book:snapshot}), reopened=trustedCodec({op:'import',base64:exported.base64}).book;
    validateWorkbook(reopened);
    const meaning=b=>Object.values(conditionalRules(b)).map(rs=>rs.map(({cfId,...r})=>r));
    assert.deepEqual(meaning(reopened),meaning(snapshot));
    assert.equal(reopened.sheets.sheet1.cellData[5][0].f,'=1/0');assert.equal(reopened.sheets.sheet1.cellData[5][0].v,undefined);
  }finally{await delay(1100);view.dispose();}
});

test('conditional export refuses proven precision and CR match flips; safe numeric and LF/tab inputs keep installed matcher results',()=>{
  const cases=[
    {value:1.0000000000000002,threshold:1,subType:'number',operator:'greaterThan',expected:true,refused:true},
    {value:'A\nB',threshold:'A\rB',subType:'text',operator:'equal',expected:false,refused:true},
    {value:'A\r\nB',threshold:'A\nB',subType:'text',operator:'equal',expected:false,refused:true},
    {value:1.000000000000001,threshold:1,subType:'number',operator:'greaterThan',expected:true},
    {value:-2,threshold:0,subType:'number',operator:'lessThan',expected:true},
    {value:'A\nB\t雪 <&>',threshold:'A\nB\t雪 <&>',subType:'text',operator:'equal',expected:true},
  ];
  for(const c of cases){
    const book=blankWorkbook('fidelity');book.sheets.sheet1.cellData={0:{0:{v:c.value,t:typeof c.value==='number'?2:1}}};
    const rule={type:'highlightCell',subType:c.subType,operator:c.operator,value:c.threshold,style:{bl:0,bg:{rgb:'#FFEEAA'}}};
    book.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[{cfId:'fidelity',stopIfTrue:false,ranges:[{startRow:0,endRow:0,startColumn:0,endColumn:0}],rule}]})}];
    validateWorkbook(book);assert.equal(match(rule,book.sheets.sheet1.cellData[0][0]),c.expected);
    if(c.refused){assert.throws(()=>trustedCodec({op:'export',book}),/Conditional export refused/);continue;}
    const exported=trustedCodec({op:'export',book}), reopened=trustedCodec({op:'import',base64:exported.base64}).book;
    validateWorkbook(reopened);assert.equal(match(conditionalRules(reopened).sheet1[0].rule,reopened.sheets.sheet1.cellData[0][0]),c.expected);
    assert.equal(reopened.sheets.sheet1.cellData[0][0].v,c.value);
  }
});
