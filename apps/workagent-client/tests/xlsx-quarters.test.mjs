// Independent standard OOXML/openpyxl -> codec -> actual native composition ->
// native commit -> codec export -> actual reimport -> a fresh native instance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mountNative } from './sheet-scale-harness.mjs';
import { conditionalRules } from '../../../packages/workagent-contract/conditional-formatting.mjs';
import { trustedCodec } from '../../workagent-server/tests/support/xlsx-fixture.mjs';
const generated=spawnSync((process.env.WORKAGENT_XLSX_VENV||process.cwd()+'/.local/xlsx-python')+'/bin/python',['-I','-B','-c',`import importlib.util,base64,json
s=importlib.util.spec_from_file_location('f',${JSON.stringify(process.cwd()+'/services/workagent-execution/xlsx/test_codec.py')})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps([{'show':show,'reverse':reverse,'base64':base64.b64encode(m.quarters_fixture(show,reverse)).decode()} for show in (False,True) for reverse in (False,True)]))`],{encoding:'utf8',timeout:12000,maxBuffer:6000000});
assert.equal(generated.status,0,generated.stderr);
for(const fixture of JSON.parse(generated.stdout))test(`independent 5Quarters XLSX all bands through native export and cold actual reimport: reverse=${fixture.reverse} show=${fixture.show}`,async()=>{
  let b=trustedCodec({op:'import',base64:fixture.base64}).book;
  const original=conditionalRules(b),expected=fixture.reverse?['0','1','2','3','4']:['4','3','2','1','0'];
  for(let mount=0;mount<2;mount++){
    const v=mountNative({book:b,version:'quarter-exchange-'+mount});
    try{
      await v.settle();const s=v.api.getActiveWorkbook().getActiveSheet();
      const ids=()=>Array.from({length:5},(_,r)=>v.conditional.composeStyle(b.id,'sheet1',r,0)?.iconSet?.iconId);
      assert.deepEqual(ids(),expected);
      for(let r=0;r<5;r++)assert.equal(!!s.getSheet().getCell(r,0).fontRenderExtension?.isSkip,!fixture.show);
      const drawings=v.drawIcons('sheet1',{startRow:0,endRow:4,startColumn:0,endColumn:0});
      assert.equal(drawings.length,5);assert.equal(new Set(drawings.map(d=>d.source)).size,5);
      assert.ok(drawings.every(d=>decodeURIComponent(d.source).includes('fill="white"')));
      const snapshot=await v.handle.commit();
      assert.deepEqual(conditionalRules(snapshot),original);
      const result=trustedCodec({op:'export',book:snapshot});
      b=trustedCodec({op:'import',base64:result.base64}).book;
      assert.deepEqual(conditionalRules(b),original);
      assert.deepEqual([0,1,2,3,4].map(r=>b.sheets.sheet1.cellData[r][0].v),[0,10,20,30,40]);
    }finally{await delay(1100);v.dispose();}
  }
});
