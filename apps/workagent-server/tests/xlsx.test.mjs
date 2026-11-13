import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
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
import { validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
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
test('dropdown export refuses mixed checkboxes, ambiguous lists, overlapping rules and invalid resource identities', async () => {
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
