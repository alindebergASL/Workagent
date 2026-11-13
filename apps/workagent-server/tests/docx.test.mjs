// Trusted generated codec fixtures + real transaction/files/HTTP handler consumers.
// Namespace and actual PostgreSQL/browser qualification are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DocxExchange } from '../src/docx-exchange.mjs';
import { DocxWorker, sandboxArgs } from '../src/docx-worker.mjs';
import { CsvExchange } from '../src/exchange.mjs';
import { OwnedFiles, hashBytes } from '../src/owned-files.mjs';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { createHandler } from '../src/http.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
import { trustedWorker, trustedCodec, originalDocx, docxInput, defaultDocx, numberedDocx } from './support/docx-fixture.mjs';
async function fixture(worker = trustedWorker) {
  const root = await mkdtemp(join(tmpdir(), 'workagent-docx-')), path = join(root, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), workspace = new Workspace(store), files = new OwnedFiles(root);
  return { root, path, store, workspace, files, exchange: new CsvExchange({workspace, files}), docx: new DocxExchange({workspace, files, worker}), state: async () => JSON.parse(await readFile(path, 'utf8')) };
}
test('numbering import/reimport keeps human ownership and immutable originals; malformed override refuses atomically', async () => {
 const f=await fixture(), input={...docxInput('lists'),base64:numberedDocx()}, before=await f.state();
 const write=f.files.writeOriginal.bind(f.files); f.files.writeOriginal=async()=>assert.fail('invalid numbering must not write a blob');
 const bad={...input,base64:numberedDocx(true)};
 await assert.rejects(f.docx.preview('owner',bad),/Unsupported/); await assert.rejects(f.docx.import('owner',bad),/Unsupported/); assert.deepEqual(await f.state(),before);
 f.files.writeOriginal=write;
 const result=await f.docx.import('owner',input), w=await f.workspace.get('owner',result.workId);
 assert.equal(w.humanDocument,true); assert.ok(w.document.lists); assert.ok(w.document.body.paragraphs[0].bullet);
 const exported=await f.docx.export('owner',{workId:w.id,document:w.document});
 const again=await f.docx.import('owner',{...input,commandId:'list-reimport',base64:exported.base64});
 assert.equal((await f.workspace.get('owner',again.workId)).document.body.dataStream,w.document.body.dataStream);
 assert.deepEqual((await f.exchange.original('owner',w.id,w.original.id)).bytes,Buffer.from(input.base64,'base64'));
 const proposal=await f.workspace.mutateDocument('owner',w.id,{commandId:'list-model',expected:w.expected,document:{...w.document,title:'Proposed'}});
 assert.equal(proposal.status,'proposed'); assert.deepEqual((await f.workspace.get('owner',w.id)).document,w.document);
});
test('hidden paragraph/character defaults refuse preview and adoption without state or blob writes', async () => {
  const f=await fixture(), before=await f.state();
  f.files.writeOriginal=async()=>assert.fail('refused content must not reach original storage');
  for (const which of ['paragraph','character']) for (const flag of ['1','true','on']) {
    const input={...docxInput(`hidden-${which}-${flag}`),base64:defaultDocx(which,flag,true)};
    await assert.rejects(f.docx.preview('owner',input),/Hidden content refused/);
    await assert.rejects(f.docx.import('owner',input),/Hidden content refused/);
    assert.deepEqual(await f.state(),before);
  }
});
test('DOCX preview/adoption owns immutable bytes, exact retry survives restart, edits retain human proposals', async () => {
  const f=await fixture(), before=await f.state(), input=docxInput();
  const preview=await f.docx.preview('owner',input); assert.equal(preview.paragraphs,3); assert.deepEqual(await f.state(),before);
  const result=await f.docx.import('owner',input), w=await f.workspace.get('owner',result.workId);
  assert.equal(w.kind,'document');assert.equal(w.humanDocument,true);assert.equal(w.intentRevision,0);assert.equal(w.original.format,'docx');assert.equal(w.original.hash,hashBytes(originalDocx));
  assert.deepEqual((await f.exchange.original('owner',w.id,w.original.id)).bytes,originalDocx);
  const restarted=new DocxExchange({workspace:new Workspace(new FileFixtureStore(f.path)),files:f.files,worker:{run:()=>assert.fail('retry must precede conversion')}});
  assert.deepEqual(await restarted.import('owner',input),result);
  await assert.rejects(restarted.import('owner',{...input,filename:'other.docx'}),/command_conflict/);
  const edited=structuredClone(w.document);edited.title='Human edited';edited.body.textRuns[0].ts.fs=22;
  await f.workspace.save('owner',w.id,{commandId:'save',document:edited,contentRevision:1,permissionRevision:1});
  const current=await f.workspace.get('owner',w.id);
  const proposed=await f.workspace.mutateDocument('owner',w.id,{commandId:'model',expected:current.expected,document:w.document});assert.equal(proposed.status,'proposed');
  assert.deepEqual((await f.workspace.get('owner',w.id)).document,edited);
  const exported=await f.docx.export('owner',{workId:w.id,document:edited});
  const imported=await f.docx.import('owner',{...input,commandId:'reimport',base64:exported.base64});
  const again=await f.workspace.get('owner',imported.workId);assert.equal(again.document.body.textRuns[0].ts.fs,22);assert.equal(again.document.body.dataStream,edited.body.dataStream);
  assert.deepEqual((await f.exchange.original('owner',w.id,w.original.id)).bytes,originalDocx);
  assert.equal(Object.keys((await f.state()).jobs).length,0);
});
test('authorization, grant changes during conversion/file write, write failures and transaction rollback prevent adoption', async()=>{
  let calls=0;const f=await fixture({run:async i=>{calls++;return trustedCodec(i);}});
  await assert.rejects(f.docx.import('other',docxInput()),/access_denied/);assert.equal(calls,0);
  f.docx.worker={run:async i=>{const r=trustedCodec(i);await f.store.transaction(s=>s.permissionRevision++);return r;}};
  await assert.rejects(f.docx.import('owner',docxInput()),/access_changed/);assert.equal(Object.keys((await f.state()).works).length,0);
  f.docx.worker=trustedWorker;const write=f.files.writeOriginal.bind(f.files);
  f.files.writeOriginal=async()=>{throw Error('file write failed');};await assert.rejects(f.docx.import('owner',docxInput()),/file write failed/);
  f.files.writeOriginal=async(...a)=>{const r=await write(...a);await f.store.transaction(s=>s.permissionRevision++);return r;};
  await assert.rejects(f.docx.import('owner',docxInput()),/access_changed/);
  f.files.writeOriginal=write;const tx=f.store.transaction.bind(f.store);let fail=true;
  f.store.transaction=fn=>tx(async s=>{const r=await fn(s);if(fail&&Object.keys(s.works).length){fail=false;throw Error('rollback');}return r;});
  await assert.rejects(f.docx.import('owner',docxInput()),/rollback/);assert.equal(Object.keys((await f.state()).commands).length,0);
  const made=await f.docx.import('owner',docxInput());assert.ok(made.workId);
  const read=f.files.readOriginal.bind(f.files); f.files.readOriginal=async(...a)=>{const b=await read(...a);await f.store.transaction(s=>s.enabled=false);return b;};
  await assert.rejects(f.exchange.original('owner',made.workId,made.original.id),/access_denied/);
});
test('HTTP handler requires auth/origin, proper DOCX MIME, exports pending snapshot without save or job',async()=>{
  const f=await fixture(),token='synthetic-fixture-key-at-least-32-characters',origin='https://private.example.test';
  const handler=createHandler({...f,owner:'owner',token,origin,clientRoot:f.root,onCommand:()=>assert.fail('no model admission')});
  async function req(url,input,auth=true,from=origin){
    const request=Readable.from(input?[Buffer.from(JSON.stringify(input))]:[]);Object.assign(request,{url,method:input?'POST':'GET',headers:{'content-type':'application/json',origin:from,...(auth?{authorization:`Bearer ${token}`}:{})}});
    const r={headers:{}};await handler(request,{setHeader:(k,v)=>r.headers[k]=v,writeHead:(s,h)=>{r.status=s;Object.assign(r.headers,h);},end:b=>r.body=b});return r;
  }
  assert.equal((await req('/api/exchange/docx/preview',docxInput(),false)).status,401);
  assert.equal((await req('/api/exchange/docx/import',docxInput(),true,'https://evil.test')).status,403);
  assert.equal((await req('/api/exchange/docx/preview',{...docxInput(),foreign:true})).status,400);
  const made=await req('/api/exchange/docx/import',docxInput());assert.equal(made.status,200);const {workId,original}=JSON.parse(made.body);
  const download=await req(`/api/work/${workId}/original/${original.id}`);assert.equal(download.headers['Content-Type'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document');assert.deepEqual(download.body,originalDocx);
  const before=await f.state(),document=structuredClone(before.works[workId].document);document.body.textRuns[0].ts.bl=0;
  const exported=await req('/api/exchange/docx/export',{workId,document});assert.equal(exported.status,200);assert.equal(trustedCodec({op:'import',base64:JSON.parse(exported.body).base64}).document.body.textRuns[0].ts.bl,0);
  assert.deepEqual(await f.state(),before);
  document.body.tables=[{}];assert.equal((await req('/api/exchange/docx/export',{workId,document})).status,400);
});
test('export rechecks revocation and document kind; missing sandbox configuration fails closed',async()=>{
  const f=await fixture();const {workId}=await f.docx.import('owner',docxInput());const w=await f.workspace.get('owner',workId);
  f.docx.worker={run:async i=>{const r=trustedCodec(i);await f.store.transaction(s=>s.permissionRevision++);return r;}};
  await assert.rejects(f.docx.export('owner',{workId,document:w.document}),/access_changed/);
  const sheet=await f.workspace.createBlank('owner',{commandId:'sheet',title:'Sheet'});
  await assert.rejects(f.docx.export('owner',{workId:sheet.workId,document:w.document}),/document_required/);
  const worker=new DocxWorker();await assert.rejects(worker.run({op:'import',base64:docxInput().base64}),/docx_sandbox_unavailable/);assert.equal(worker.active,false);
  const args=sandboxArgs('/dedicated-venv');for(const flag of ['--unshare-all','--clearenv','--die-with-parent','--new-session'])assert.ok(args.includes(flag));assert.ok(!args.includes('--share-net'));
});
