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
async function fixture(worker = trustedWorker) {
  const root = await mkdtemp(join(tmpdir(), 'workagent-xlsx-')), path = join(root, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), workspace = new Workspace(store), files = new OwnedFiles(root);
  return { root, path, store, workspace, files, exchange: new CsvExchange({workspace, files}), xlsx: new XlsxExchange({workspace, files, worker}), state: async () => JSON.parse(await readFile(path, 'utf8')) };
}
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
