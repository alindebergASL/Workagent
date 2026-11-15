import { CONDITIONAL_RESOURCE, conditionalRules } from '../../../packages/workagent-contract/conditional-formatting.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { XlsxExchange } from '../src/xlsx-exchange.mjs';
import { XlsxWorker, sandboxArgs } from '../src/xlsx-worker.mjs';
import { CsvExchange } from '../src/exchange.mjs';
import { OwnedFiles, hashBytes } from '../src/owned-files.mjs';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { createHandler } from '../src/http.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
import { trustedWorker, trustedCodec, originalXlsx, xlsxInput } from './support/xlsx-fixture.mjs';
import { CONTROL_RESOURCE, sheetControls } from '../../../packages/workagent-contract/sheet-controls.mjs';
import { sheetCharts, withCharts } from '../../../packages/workagent-contract/sheet-charts.mjs';
import { blankWorkbook, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
async function fixture(worker = trustedWorker) {
  const root = await mkdtemp(join(tmpdir(), 'workagent-xlsx-')), path = join(root, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), workspace = new Workspace(store), files = new OwnedFiles(root);
  return { root, path, store, workspace, files, exchange: new CsvExchange({workspace, files}), xlsx: new XlsxExchange({workspace, files, worker}), state: async () => JSON.parse(await readFile(path, 'utf8')) };
}
function dropdownBook() {
  const book = trustedCodec({op:'import',base64:originalXlsx.toString('base64')}).book;
  book.resources = [{name:CONTROL_RESOURCE,data:JSON.stringify(Object.fromEntries(book.sheetOrder.map(sid => [sid,[{
    uid:'list',type:'list',formula1:JSON.stringify(['Ready & <now>','=1+1','雪']),allowBlank:false,showDropDown:true,showErrorMessage:true,errorStyle:1,
    ranges:[{startRow:5,endRow:7,startColumn:2,endColumn:2,unitId:book.id,sheetId:sid}]
  }]])))}, {name:'SHEET_DEFINED_NAME_PLUGIN',data:'{}'}];
  return book;
}
test('dropdown XLSX import protects blank cells, rebinds IDs, exact-retries and preserves originals after Save/restart', async () => {
  const bytes = Buffer.from(trustedCodec({op:'export',book:dropdownBook()}).base64,'base64');
  const f = await fixture({run:async input => {
    const result = trustedCodec(input), controls = sheetControls(result.book);
    for (const [sid,rules] of Object.entries(controls)) for (const r of rules[0].ranges) Object.assign(r,{unitId:result.book.id,sheetId:sid});
    result.book.resources[0].data = JSON.stringify(controls); return result;
  }});
  const input = {...xlsxInput('dropdown-import'),base64:bytes.toString('base64')};
  const imported = await f.xlsx.import('owner',input); let w = await f.workspace.get('owner',imported.workId);
  validateWorkbook(w.book);
  for (const sid of w.book.sheetOrder) {
    const rule = sheetControls(w.book)[sid][0]; assert.equal(rule.ranges[0].unitId,w.id);
    assert.deepEqual(JSON.parse(rule.formula1),['Ready & <now>','=1+1','雪']);
    assert.ok(w.humanCells.includes(`${sid}:7:2`));
  }
  const other = await f.workspace.createBlank('owner',{commandId:'unrelated',title:'Other work'});
  const otherBefore = await f.workspace.get('owner',other.workId);
  const book = structuredClone(w.book), controls = sheetControls(book); delete controls.sheet1;
  book.resources[0].data = JSON.stringify(controls); book.sheets.sheet2.cellData[5] = {2:{v:'=1+1',t:1}};
  const save = {commandId:'dropdown-save',book,contentRevision:1,permissionRevision:1,formatEdits:{}};
  const saved = await f.workspace.save('owner',w.id,save);
  assert.deepEqual(await f.workspace.save('owner',w.id,save),saved);
  const restarted = new Workspace(new FileFixtureStore(f.path)); w = await restarted.get('owner',w.id);
  assert.equal((await restarted.mutate('owner',w.id,{commandId:'blank-overwrite',expected:w.expected,patch:{cells:[{sheetId:'sheet1',row:7,column:2,value:'No'}]}})).status,'proposed');
  const retry = new XlsxExchange({workspace:restarted,files:f.files,worker:{run(){throw new Error('retry must not parse');}}});
  assert.deepEqual(await retry.import('owner',input),imported);
  assert.deepEqual((await f.exchange.original('owner',w.id,imported.original.id)).bytes,bytes);
  const {eventSequence: _oldCursor, ...otherContent} = otherBefore;
  const {eventSequence: _newCursor, ...otherAfter} = await restarted.get('owner',other.workId);
  assert.deepEqual(otherAfter,otherContent);
  f.xlsx.worker = trustedWorker;
  const exported = await f.xlsx.export('owner',{workId:w.id,book:w.book});
  assert.deepEqual(trustedCodec({op:'import',base64:exported.base64}).book.sheets.sheet2.cellData[5][2],{v:'=1+1',t:1});
  assert.equal(Object.keys((await f.state()).jobs).length,0);
});
test('dropdown export refuses unsupported checkbox flags, ambiguous lists, overlapping rules and invalid resource identities', async () => {
  const f = await fixture(); const created = await f.workspace.createBlank('owner',{commandId:'new',title:'Export'});
  for (const [label, change, pattern] of [
    ['checkbox', rules=>rules.push({...rules[0],uid:'check',type:'checkbox',formula1:'TRUE',formula2:'FALSE'}), /xlsx_controls_not_supported/],
    ['comma', rules=>rules[0].formula1='["a,b"]', /Ambiguous inline-list/],
    ['duplicate', rules=>rules.push(structuredClone(rules[0])), /unsupported_sheet_controls/],
    ['overlap', rules=>rules.push({...rules[0],uid:'overlap'}), /Overlapping validation/],
    ['bounds', rules=>rules[0].ranges[0].endRow=10000, /unsupported_sheet_controls/],
    ['prototype', rules=>rules[0].uid='__proto__', /invalid_id/],
    ['other-unit', rules=>rules[0].ranges[0].unitId='other', /unsupported_sheet_controls/],
  ]) {
    const book=dropdownBook(); book.id=created.workId; const data=sheetControls(book);
    for(const rules of Object.values(data)) rules[0].ranges[0].unitId=book.id;
    change(data.sheet1); book.resources[0].data=JSON.stringify(data);
    await assert.rejects(()=>f.xlsx.export('owner',{workId:book.id,book}),pattern,label);
  }
});
test('modern checkbox exchange protects blank controls, retains exact original and permits mixed dropdown export', async () => {
  const book = dropdownBook(), controls = sheetControls(book);
  for (const sid of book.sheetOrder) {
    controls[sid].push({uid:'checks',type:'checkbox',ranges:[{startRow:8,endRow:10,startColumn:4,endColumn:4}]});
    book.sheets[sid].cellData[8] = {4:{v:false,t:3,s:{bl:1}},5:{v:false,t:3,s:{bl:1}}};
    book.sheets[sid].cellData[9] = {4:{v:true,t:3,s:{bl:1}}};
  }
  book.resources[0].data=JSON.stringify(controls);
  const bytes=Buffer.from(trustedCodec({op:'export',book}).base64,'base64');
  const f=await fixture(), input={...xlsxInput('checkbox-import'),base64:bytes.toString('base64')};
  const imported=await f.xlsx.import('owner',input), w=await f.workspace.get('owner',imported.workId);
  assert.deepEqual((await f.exchange.original('owner',w.id,imported.original.id)).bytes,bytes);
  assert.deepEqual(await f.xlsx.import('owner',input),imported);
  for(const sid of w.book.sheetOrder) {
    assert.ok(w.humanCells.includes(`${sid}:10:4`));
    assert.equal(sheetControls(w.book)[sid].filter(r=>r.type==='checkbox').length,1);
    assert.equal(w.book.sheets[sid].cellData[8][5].v,false);
  }
  const before=await f.state(), exported=await f.xlsx.export('owner',{workId:w.id,book:w.book});
  const reopened=trustedCodec({op:'import',base64:exported.base64}).book;
  assert.equal(reopened.sheets.sheet1.cellData[8][4].v,0);
  assert.equal(reopened.sheets.sheet1.cellData[9][4].v,1);
  assert.equal(reopened.sheets.sheet1.cellData[10]?.[4]?.v,undefined);
  assert.deepEqual(await f.state(),before);
  assert.equal((await f.workspace.mutate('owner',w.id,{commandId:'blank-checkbox-change',expected:w.expected,patch:{cells:[{sheetId:'sheet1',row:10,column:4,value:true}]}})).status,'proposed');
});
test('real XLSX preview/import/exact original, restart retry, human ownership, explicit-only model admission', async () => {
  const f = await fixture(), before = await f.state();
  const preview = await f.xlsx.preview('owner', xlsxInput()); assert.equal(preview.sheets.length, 2); assert.deepEqual(await f.state(), before);
  const result = await f.xlsx.import('owner', xlsxInput()), w = await f.workspace.get('owner', result.workId);
  assert.equal(result.original.hash, hashBytes(originalXlsx)); assert.equal(result.original.size, originalXlsx.length);
  assert.deepEqual((await f.exchange.original('owner', w.id, result.original.id)).bytes, originalXlsx);
  assert.equal(w.intentRevision, 0); assert.equal(Object.keys((await f.state()).jobs).length, 0);
  const second = new XlsxExchange({workspace: new Workspace(new FileFixtureStore(f.path)), files: f.files, worker: {run: () => { throw new Error('dedup precedes worker'); }}});
  assert.deepEqual(await second.import('owner', xlsxInput()), result);
  await assert.rejects(() => second.import('owner', {...xlsxInput(), filename:'Changed.xlsx'}), /command_conflict/);
  const proposal = await f.workspace.mutate('owner', w.id, {commandId:'model-patch', expected:w.expected, patch:{cells:[{sheetId:'sheet1',row:0,column:1,value:false}]}});
  assert.equal(proposal.status, 'proposed');
  const book = structuredClone(w.book); book.sheets.sheet1.cellData[0][0] = {v:'00099',t:1};
  await f.workspace.save('owner', w.id, {commandId:'save',book,contentRevision:1,permissionRevision:1});
  assert.deepEqual(await second.import('owner', xlsxInput()), result); assert.equal((await f.workspace.get('owner',w.id)).book.sheets.sheet1.cellData[0][0].v,'00099');
  assert.deepEqual((await f.exchange.original('owner', w.id, result.original.id)).bytes, originalXlsx);
  await f.workspace.command('owner',{commandId:'continue',kind:'continue',workId:w.id,expectedIntentRevision:0,sourceIds:[],text:'Explain the imported cells'});
  assert.equal((await f.workspace.claim('owner')).workId,w.id);
});
test('authorization before decode/worker/files; changed grant after worker and during adoption refuses without work/jobs', async () => {
  let runs = 0; const f = await fixture({run: async input => {runs++; return trustedCodec(input);}});
  await assert.rejects(() => f.xlsx.import('other', xlsxInput()), /access_denied/); assert.equal(runs,0);
  f.xlsx.worker = {run: async input => { const r=trustedCodec(input); await f.store.transaction(s=>s.permissionRevision++); return r; }};
  await assert.rejects(() => f.xlsx.import('owner', xlsxInput()), /access_changed/); assert.equal(Object.keys((await f.state()).works).length,0);
  f.xlsx.worker = trustedWorker; const write=f.files.writeOriginal.bind(f.files);
  f.files.writeOriginal=async (...args)=>{const b=await write(...args); await f.store.transaction(s=>s.permissionRevision++); return b;};
  await assert.rejects(() => f.xlsx.import('owner', xlsxInput()), /access_changed/); assert.equal(Object.keys((await f.state()).works).length,0);
  assert.equal(Object.keys((await f.state()).commands).length,0); assert.equal(Object.keys((await f.state()).jobs).length,0);
});
test('actual XLSX import protects blank merged children on the second tab through Workspace.mutate', async () => {
  const seed = trustedCodec({op:'import',base64:originalXlsx.toString('base64')}).book;
  seed.sheets.sheet2.cellData = {0:{0:{v:'Heading',t:1}},2:{0:{v:'literal',t:1},1:{s:{bl:1}}}};
  seed.sheets.sheet2.mergeData = [{startRow:0,endRow:0,startColumn:0,endColumn:2}];
  const bytes = Buffer.from(trustedCodec({op:'export',book:seed}).base64,'base64');
  const f = await fixture(), input = {...xlsxInput('merged-import'),base64:bytes.toString('base64')};
  const imported = await f.xlsx.import('owner',input), before = await f.workspace.get('owner',imported.workId);
  for (const [row,column] of [[0,1],[0,2],[2,0],[2,1]]) {
    const mutation = {commandId:`model-${row}-${column}`,expected:before.expected,patch:{cells:[{sheetId:'sheet2',row,column,value:'unapproved'}]}};
    const proposed = await f.workspace.mutate('owner',before.id,mutation);
    assert.equal(proposed.status,'proposed');
    assert.deepEqual(await f.workspace.mutate('owner',before.id,mutation),proposed);
  }
  const after = await f.workspace.get('owner',before.id);
  assert.deepEqual(after.book,before.book); assert.equal(after.contentRevision,1);
  assert.equal(after.humanCells.length,new Set(after.humanCells).size);
  assert.equal(after.proposals.length,4);
  assert.deepEqual(await f.xlsx.import('owner',input),imported);
  const exported = await f.xlsx.export('owner',{workId:after.id,book:after.book});
  assert.equal(trustedCodec({op:'import',base64:exported.base64}).book.sheets.sheet2.cellData[0][1],undefined);
  assert.deepEqual((await f.exchange.original('owner',after.id,imported.original.id)).bytes,bytes);
  assert.equal(Object.keys((await f.state()).jobs).length,0);
  const ordinary = after.proposals.find(p=>p.patch.cells[0].row===2 && p.patch.cells[0].column===0);
  await f.workspace.decide('owner',after.id,ordinary.id,{commandId:'accept-literal',decision:'accept',expected:after.expected});
  assert.equal((await f.workspace.get('owner',after.id)).book.sheets.sheet2.cellData[2][0].v,'unapproved');
});
test('failed transaction leaves no adoption; original download scopes and revocation rechecked', async () => {
  const f = await fixture(), tx=f.store.transaction.bind(f.store); let fail=true;
  f.store.transaction=fn=>tx(async s=>{const r=await fn(s); if(fail && Object.keys(s.works).length) {fail=false; throw new Error('fixture rollback');} return r;});
  await assert.rejects(()=>f.xlsx.import('owner',xlsxInput()),/fixture rollback/); assert.equal(Object.keys((await f.state()).works).length,0);
  const result=await f.xlsx.import('owner',xlsxInput());
  await assert.rejects(()=>f.exchange.original('other',result.workId,result.original.id),/access_denied/);
  await assert.rejects(()=>f.files.readOriginal('other',result.original.hash,'xlsx'),/ENOENT/);
  const read=f.files.readOriginal.bind(f.files); f.files.readOriginal=async(...args)=>{const b=await read(...args); await f.store.transaction(s=>s.enabled=false); return b;};
  await assert.rejects(()=>f.exchange.original('owner',result.workId,result.original.id),/access_denied/);
});
test('actual HTTP handler XLSX routes authenticate, preserve original, export pending snapshot with no save/job', async () => {
  const f=await fixture(), token='synthetic-fixture-key-at-least-32-characters', origin='https://private.example.test'; let wakes=0;
  const handler=createHandler({...f,owner:'owner',token,origin,clientRoot:f.root,onCommand:()=>wakes++});
  async function request(url,data,auth=true,requestOrigin=origin){
    const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]); Object.assign(req,{url,method:data?'POST':'GET',headers:{'content-type':'application/json',origin:requestOrigin,...(auth?{authorization:`Bearer ${token}`}:{})}});
    const result={headers:{}}; await handler(req,{setHeader:(k,v)=>result.headers[k]=v,writeHead:(status,h)=>{result.status=status;Object.assign(result.headers,h);},end:b=>result.body=b}); return result;
  }
  assert.equal((await request('/api/exchange/xlsx/preview',xlsxInput(),false)).status,401);
  assert.equal((await request('/api/exchange/xlsx/import',xlsxInput(),true,'https://evil.test')).status,403);
  assert.equal((await request('/api/exchange/xlsx/preview',xlsxInput())).status,200);
  const imported=await request('/api/exchange/xlsx/import',xlsxInput()); assert.equal(imported.status,200); const result=JSON.parse(imported.body);
  const path=`/api/work/${result.workId}/original/${result.original.id}`; assert.equal((await request(path,null,false)).status,401); assert.deepEqual((await request(path)).body,originalXlsx);
  const before=await f.state(), book=structuredClone(before.works[result.workId].book); book.sheets.sheet1.cellData[1][0].v=27;
  const exported=await request('/api/exchange/xlsx/export',{workId:book.id,book}); assert.equal(exported.status,200);
  const reopened=trustedCodec({op:'import',base64:JSON.parse(exported.body).base64}); assert.equal(reopened.book.sheets.sheet1.cellData[1][0].v,27);
  assert.deepEqual(await f.state(),before); assert.equal(wakes,0);
});
test('sandbox has no host mounts/ambient configuration and missing configuration fails closed', async () => {
  const args=sandboxArgs('/trusted/python');
  for(const flag of ['--unshare-all','--die-with-parent','--new-session','--clearenv']) assert.ok(args.includes(flag));
  assert.deepEqual(args.filter((v,i)=>args[i-1]==='--ro-bind'),['/usr','/trusted/python',new URL('../../../services/workagent-execution/xlsx/codec.py',import.meta.url).pathname]);
  const worker=new XlsxWorker(); await assert.rejects(()=>worker.run({op:'import',base64:xlsxInput().base64}),/xlsx_sandbox_unavailable/); assert.equal(worker.active,false);
});
test('real sandbox attempt fails closed on this controller or performs real conversion; no fallback and slot released', async () => {
  const worker=new XlsxWorker({venv:process.cwd()+'/.local/xlsx-python'});
  const pending=worker.run({op:'import',base64:xlsxInput().base64});
  await assert.rejects(()=>worker.run({op:'import',base64:xlsxInput().base64}),/busy/);
  try {const result=await pending; assert.equal(result.book.sheetOrder.length,2);} catch(e) {assert.match(e.code,/xlsx_sandbox/);}
  assert.equal(worker.active,false);
});

test('chart preview has no effects; acceptance retains original bytes and exact retries create one protected native work', async()=>{
  const b=blankWorkbook('preview');b.sheets.sheet1.name="O'Brien & 雪";
  b.sheets.sheet1.cellData={1:{1:{v:'Label',t:1},2:{v:'Units',t:1},3:{v:'Double',t:1}},2:{1:{v:'Zero',t:1},2:{v:0,t:2},3:{f:'=C3*2'}},3:{1:{v:'Negative',t:1},2:{v:-2,t:2},3:{f:'=C4*2'}},4:{1:{v:'Missing',t:1}}};
  const book=withCharts(b,[{id:'chart',title:'Budget',type:'bar',sheetId:'sheet1',range:{startRow:1,endRow:4,startColumn:1,endColumn:3}}]);
  const bytes=Buffer.from(trustedCodec({op:'export',book}).base64,'base64'),input={...xlsxInput('chart-import'),base64:bytes.toString('base64')};
  const f=await fixture(),before=await f.state();
  const preview=await f.xlsx.preview('owner',input);assert.match(preview.warnings.join(' '),/Position, size/);assert.deepEqual(await f.state(),before);
  const result=await f.xlsx.import('owner',input),w=await f.workspace.get('owner',result.workId);
  assert.equal(sheetCharts(w.book)[0].range.startColumn,1);assert.ok(w.humanCells.includes('sheet1:3:2'));
  assert.deepEqual(await f.xlsx.import('owner',input),result);assert.deepEqual((await f.exchange.original('owner',w.id,result.original.id)).bytes,bytes);
  const accepted=await f.state(),exported=await f.xlsx.export('owner',{workId:w.id,book:w.book});
  assert.equal(sheetCharts(trustedCodec({op:'import',base64:exported.base64}).book).length,1);
  assert.deepEqual(await f.state(),accepted);assert.equal(Object.keys(accepted.works).length,1);assert.equal(Object.keys(accepted.jobs).length,0);
  await assert.rejects(()=>f.xlsx.export('stranger',{workId:w.id,book:w.book}));
});

test('mixed color scale/highlight import protects blanks and originals, dirty export stays separate and refusals are atomic', async()=>{
  const f=await fixture(); const book=blankWorkbook('cf-book');
  const data={sheet1:[{cfId:'highlight',stopIfTrue:true,ranges:[{startRow:0,endRow:7,startColumn:0,endColumn:0}],rule:{type:'highlightCell',subType:'number',operator:'lessThanOrEqual',value:0,style:{bg:{rgb:'#FFEEAA'},bl:0,ul:{s:0}}}}]};
  data.sheet1.push({cfId:'scale',stopIfTrue:false,ranges:data.sheet1[0].ranges,rule:{type:'colorScale',config:[{index:0,color:'#FF0000',value:{type:'num',value:-10}},{index:1,color:'#00FF00',value:{type:'num',value:10}}]}});
  book.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify(data)}];book.sheets.sheet1.cellData={0:{0:{v:-2,t:2}},1:{0:{f:'=1/0'}}};
  const bytes=Buffer.from(trustedCodec({op:'export',book}).base64,'base64');
  const input={...xlsxInput('conditional-import'),filename:'Highlights.xlsx',base64:bytes.toString('base64')};
  const before=await f.state();const preview=await f.xlsx.preview('owner',input);assert.match(preview.warnings.join(' '),/Conditional highlights/);
  assert.deepEqual(await f.state(),before,'preview never adopts');
  const imported=await f.xlsx.import('owner',input), saved=await f.workspace.get('owner',imported.workId);
  assert.ok(saved.humanCells.includes('sheet1:7:0'),'blank conditional ranges are authored human intent');
  assert.deepEqual((await f.exchange.original('owner',saved.id,imported.original.id)).bytes,bytes);
  assert.deepEqual(await f.xlsx.import('owner',input),imported);
  const unsaved=structuredClone(saved.book);unsaved.sheets.sheet1.cellData[0][0].v=8;
  const exported=await f.xlsx.export('owner',{workId:saved.id,book:unsaved});
  assert.equal(trustedCodec({op:'import',base64:exported.base64}).book.sheets.sheet1.cellData[0][0].v,8);
  assert.deepEqual(conditionalRules(trustedCodec({op:'import',base64:exported.base64}).book).sheet1.map(r=>r.rule),data.sheet1.map(r=>r.rule));
  assert.deepEqual((await f.workspace.get('owner',saved.id)).book,saved.book,'export does not implicitly save');
  const adopt=await f.xlsx.import('owner',{...input,commandId:'conditional-separate',base64:exported.base64});assert.notEqual(adopt.workId,saved.id);
  assert.deepEqual((await f.exchange.original('owner',saved.id,imported.original.id)).bytes,bytes);
  const baseline=await f.state();
  const bad=structuredClone(saved.book), rules=conditionalRules(bad);rules.sheet1.push({...rules.sheet1[0],cfId:'unsupported',rule:{type:'colorScale',config:[{index:0,color:'#FF0000',value:{type:'min'}},{index:1,color:'#00FF00',value:{type:'max'}}]}});
  bad.resources[0].data=JSON.stringify(rules);
  await assert.rejects(()=>f.xlsx.export('owner',{workId:saved.id,book:bad}),/Color scale stopIfTrue/);
  assert.deepEqual(await f.state(),baseline);
  const denied=new XlsxExchange({workspace:f.workspace,files:f.files,worker:{run:async()=>{throw new Error('Unsupported conditional expression');}}});
  await assert.rejects(()=>denied.import('owner',{...input,commandId:'mixed-refusal'}),/Unsupported conditional/);
  assert.deepEqual(await f.state(),baseline);
});

test('conditional rules traverse the real credentialless worker when namespaces are available',async t=>{
  const book=blankWorkbook('worker-cf');book.resources=[{name:CONDITIONAL_RESOURCE,data:JSON.stringify({sheet1:[{cfId:'r',stopIfTrue:false,ranges:[{startRow:0,endRow:2,startColumn:0,endColumn:0}],rule:{type:'highlightCell',subType:'text',operator:'containsText',value:'Ready*?',style:{bl:0,bg:{rgb:'#FFEEAA'}}}}]})}];
  const rules=conditionalRules(book);rules.sheet1.push({cfId:'scale',stopIfTrue:false,ranges:rules.sheet1[0].ranges,rule:{type:'colorScale',config:[{index:0,color:'#FF0000',value:{type:'num',value:-5}},{index:1,color:'#00FF00',value:{type:'num',value:5}}]}});book.resources[0].data=JSON.stringify(rules);
  rules.sheet1.push({cfId:'bar',stopIfTrue:false,ranges:rules.sheet1[0].ranges,rule:{type:'dataBar',isShowValue:false,config:{min:{type:'num',value:0},max:{type:'num',value:10},positiveColor:'#123456',nativeColor:'#123456',isGradient:true}}});book.resources[0].data=JSON.stringify(rules);
  rules.sheet1.push({cfId:'icons',stopIfTrue:false,ranges:rules.sheet1[0].ranges,rule:{type:'iconSet',isShowValue:false,config:[10,5,0].map((value,i)=>({iconType:'3Arrows',iconId:String(i),operator:'greaterThanOrEqual',value:{type:'num',value}}))}});book.resources[0].data=JSON.stringify(rules);
  book.sheets.sheet1.cellData={0:{0:{v:0,t:2}},1:{0:{v:5,t:2}},2:{0:{v:10,t:2}}};
  const worker=new XlsxWorker({venv:process.env.WORKAGENT_XLSX_VENV||process.cwd()+'/.local/xlsx-python'});
  let exported;
  try{exported=await worker.run({op:'export',book});}
  catch(e){if(/^xlsx_sandbox/.test(e.code)){t.skip(`Namespace/socket boundary unavailable here (${e.code}); Parent must qualify actual worker conversion`);return;}throw e;}
  const imported=await worker.run({op:'import',base64:exported.base64});
  assert.deepEqual(conditionalRules(imported.book).sheet1[0].rule,conditionalRules(book).sheet1[0].rule);
  assert.deepEqual(conditionalRules(imported.book).sheet1[1].rule,conditionalRules(book).sheet1[1].rule);
  assert.deepEqual(conditionalRules(imported.book).sheet1[2].rule,conditionalRules(book).sheet1[2].rule);
  assert.deepEqual(conditionalRules(imported.book).sheet1[3].rule,conditionalRules(book).sheet1[3].rule);
  // Independent library-authored mixed file must also cross the production
  // namespace worker; a native export/reimport alone is not this evidence.
  const generated=spawnSync(process.cwd()+'/.local/xlsx-python/bin/python',['-I','-B','-c',`import importlib.util,base64\ns=importlib.util.spec_from_file_location('f',${JSON.stringify(process.cwd()+'/services/workagent-execution/xlsx/test_codec.py')})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(base64.b64encode(m.icon_fixture()).decode())`],{encoding:'utf8',timeout:12000,maxBuffer:6000000});
  assert.equal(generated.status,0,generated.stderr);
  const independent=await worker.run({op:'import',base64:generated.stdout.trim()});
  assert.equal(independent.book.sheetOrder.length,2);
  for(const entries of Object.values(conditionalRules(independent.book))){
    const icons=entries.filter(e=>e.rule.type==='iconSet');assert.equal(icons.length,3);assert.deepEqual(icons.map(e=>e.rule.config[0].iconType),['3Arrows','4Rating','5Rating']);
    const bars=entries.filter(e=>e.rule.type==='dataBar');assert.equal(bars.length,4);
    assert.deepEqual(bars.map(e=>e.rule.config.min.type),['min','percent','percentile','num']);
    assert.deepEqual(bars.map(e=>e.rule.isShowValue),[true,false,true,false]);
    assert.ok(bars.every(e=>e.rule.config.positiveColor==='#123456'&&e.rule.config.nativeColor==='#123456'&&e.rule.config.isGradient===true&&!e.stopIfTrue));
  }
  const custom=structuredClone(book),customRules=conditionalRules(custom);customRules.sheet1[3].rule.config[0].iconType='3Flags';custom.resources[0].data=JSON.stringify(customRules);
  await assert.rejects(()=>worker.run({op:'export',book:custom}),/mixed\/custom\/no-icon/);
  const signed=structuredClone(book);signed.sheets.sheet1.cellData[0][0].v=-1;
  await assert.rejects(()=>worker.run({op:'export',book:signed}),/Signed data bar/);
});

function renamedConditionalFiles() {
  const generated=spawnSync(process.cwd()+'/.local/xlsx-python/bin/python',['-I','-B','-c',`import importlib.util,base64,json\ns=importlib.util.spec_from_file_location('f',${JSON.stringify(process.cwd()+'/services/workagent-execution/xlsx/test_codec.py')})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ne=lambda target,ext=None:base64.b64encode(m.renamed_data_bar_fixture(target,ext)).decode()\nprint(json.dumps({'good':e('other.XML'),'bad':[e(target,ext) for target in ('other.XML','other','other.data') for ext in ('only','mixed')]}))`],{encoding:'utf8',timeout:12000,maxBuffer:6000000});
  assert.equal(generated.status,0,generated.stderr);return JSON.parse(generated.stdout);
}
for(const sandbox of [false,true]) test(`resolved worksheet CF names refuse atomically through ${sandbox?'production namespace worker':'real codec and server'}`,async t=>{
  const files=renamedConditionalFiles(),worker=sandbox?new XlsxWorker({venv:process.env.WORKAGENT_XLSX_VENV||process.cwd()+'/.local/xlsx-python'}):trustedWorker;
  if(sandbox){
    try{await worker.run({op:'import',base64:files.good});}
    catch(e){if(/^xlsx_sandbox/.test(e.code)){t.skip(`Production namespace/socket execution unverified here (${e.code}); refusal assertions did not run`);return;}throw e;}
  }
  const f=await fixture(worker),input={...xlsxInput('renamed-supported'),base64:files.good};
  const adopted=await f.xlsx.import('owner',input),saved=await f.workspace.get('owner',adopted.workId);
  assert.deepEqual(Object.values(conditionalRules(saved.book)).map(rules=>rules.length),[9,7]);
  assert.equal(saved.book.sheets.sheet2.cellData[1][5].v,5);
  assert.deepEqual((await f.exchange.original('owner',saved.id,adopted.original.id)).bytes,Buffer.from(files.good,'base64'));
  const before=await f.state();let writes=0;
  f.files.writeOriginal=async()=>{writes++;throw new Error('refused file must never reach original storage');};
  for(const [i,base64] of files.bad.entries()){
    const bad={...input,commandId:'renamed-refusal-'+i,base64};
    await assert.rejects(()=>f.xlsx.preview('owner',bad),/Shadowed\/misplaced conditional formatting/);
    await assert.rejects(()=>f.xlsx.import('owner',bad),/Shadowed\/misplaced conditional formatting/);
    assert.deepEqual(await f.state(),before,'no partial work, commands, flattening or mutation of existing native rules');
  }
  assert.equal(writes,0);
});


for(const sandbox of [false,true]) test(`5Quarters API roundtrip and malformed-rule transaction refusals through ${sandbox?'production namespace worker':'real codec'}`,async t=>{
  const worker=sandbox?new XlsxWorker({venv:process.env.WORKAGENT_XLSX_VENV||process.cwd()+'/.local/xlsx-python'}):trustedWorker;
  if(sandbox){
    try{await worker.run({op:'export',book:blankWorkbook('quarter-probe')});}
    catch(e){if(/^xlsx_sandbox/.test(e.code)){t.skip(`Production namespace/socket execution unverified here (${e.code}); quarter transaction assertions did not run`);return;}throw e;}
  }
  const generated=spawnSync((process.env.WORKAGENT_XLSX_VENV||process.cwd()+'/.local/xlsx-python')+'/bin/python',['-I','-B','-c',`import importlib.util,base64,json
s=importlib.util.spec_from_file_location('f',${JSON.stringify(process.cwd()+'/services/workagent-execution/xlsx/test_codec.py')})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def bad(root): root.find('.//{'+m.NS+'}cfvo').set('gte','0')
print(json.dumps({'good':[base64.b64encode(m.quarters_fixture(show,reverse,strict=True)).decode() for show in (False,True) for reverse in (False,True)],'bad':base64.b64encode(m.icon_rewrite(m.quarters_fixture(),bad)).decode()}))`],{encoding:'utf8',timeout:12000,maxBuffer:6000000});
  assert.equal(generated.status,0,generated.stderr);const fixtures=JSON.parse(generated.stdout);
  const f=await fixture(worker),token='synthetic-quarter-api-token-at-least-32-characters',origin='https://private.example.test';
  const handler=createHandler({...f,owner:'owner',token,origin,clientRoot:f.root,onCommand:()=>{throw Error('must not schedule work');}});
  async function request(path,data,status=200){
    const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:'/api/exchange/xlsx/'+path,method:'POST',headers:{'content-type':'application/json',origin,authorization:`Bearer ${token}`}});
    const result={};await handler(req,{setHeader(){},writeHead(status){result.status=status;},end(body){result.body=body;}});
    const body=JSON.parse(result.body);assert.equal(result.status,status,`${path}: ${body.error||body.code||'unexpected artifact/status'}`);return body;
  }
  for(const [i,base64] of fixtures.good.entries()){
    const input={commandId:'quarter-import-'+i,filename:'Quarters.xlsx',synthetic:true,base64},before=await f.state();
    await request('preview',input);assert.deepEqual(await f.state(),before);
    const adopted=await request('import',input);assert.deepEqual(await request('import',input),adopted);
    const saved=await f.workspace.get('owner',adopted.workId),b=saved.book,rules=conditionalRules(b);
    assert.deepEqual((await f.exchange.original('owner',b.id,adopted.original.id)).bytes,Buffer.from(base64,'base64'));
    assert.equal((await f.workspace.mutate('owner',b.id,{commandId:'quarter-proposal-'+i,expected:saved.expected,patch:{cells:[{sheetId:'sheet1',row:5,column:0,value:99}]}})).status,'proposed');
    const prior=await f.state(),output=await request('export',{workId:b.id,book:b});assert.deepEqual(await f.state(),prior);
    const reimport=await request('import',{commandId:'quarter-reimport-'+i,filename:'Roundtrip.xlsx',synthetic:true,base64:output.base64});
    assert.deepEqual(conditionalRules((await f.workspace.get('owner',reimport.workId)).book),rules);
    const snapshot=await f.state();let writes=0;const write=f.files.writeOriginal;
    f.files.writeOriginal=async()=>{writes++;throw Error('must refuse before original write');};
    try{
      const bad={...input,commandId:'quarter-bad-'+i,base64:fixtures.bad};
      for(const route of ['preview','import']){const e=await request(route,bad,400);assert.equal(e.base64,undefined);}
      for(const change of [r=>r.config[0].iconType='3Arrows',r=>r.config[0].iconType='EMPTY_ICON_TYPE',r=>r.config[0].iconId=r.config[1].iconId,r=>r.config[1].value.value=40,r=>r.config[0].value={type:'formula',value:'=1+1'}]){
        const altered=structuredClone(b),data=conditionalRules(altered);change(data.sheet1[0].rule);altered.resources.find(r=>r.name===CONDITIONAL_RESOURCE).data=JSON.stringify(data);
        const e=await request('export',{workId:b.id,book:altered},400);assert.equal(e.base64,undefined);
      }
      assert.equal(writes,0);assert.deepEqual(await f.state(),snapshot);
    }finally{f.files.writeOriginal=write;}
  }
});
