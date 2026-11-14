// Transaction/HTTP checks use trusted generated extraction, not namespace claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openSync, closeSync } from 'node:fs';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { PdfExchange } from '../src/pdf-exchange.mjs';
import { decodePdfUpload, validatePdfText } from '../src/pdf-import.mjs';
import { PdfWorker, sandboxArgs } from '../src/pdf-worker.mjs';
import { CsvExchange } from '../src/exchange.mjs';
import { OwnedFiles, hashBytes } from '../src/owned-files.mjs';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { createHandler } from '../src/http.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
const generated = spawnSync('/usr/bin/python3',['-I','services/workagent-execution/pdf/fixtures/text_import.py','unicode','2'],{encoding:'utf8',timeout:10000});
assert.equal(generated.status,0,generated.stderr);
const base64=generated.stdout.trim(), bytes=Buffer.from(base64,'base64');
// This controller denies socket shutdown for spawnSync stdin. As in DOCX
// fixtures, use a bounded trusted request file, never a production fallback.
const requestPath=join(await mkdtemp(join(tmpdir(),'pdf-trusted-request-')),'input.json');
await writeFile(requestPath,JSON.stringify({op:'import',base64}));const fd=openSync(requestPath,'r');
const extraction=spawnSync('/usr/bin/python3',['-I','services/workagent-execution/pdf/extract.py'],{stdio:[fd,'pipe','pipe'],encoding:'utf8',timeout:25000});closeSync(fd);
assert.equal(extraction.status,0,extraction.stdout+extraction.stderr);
const output=JSON.parse(extraction.stdout), input={filename:'literal 雪.pdf',base64,synthetic:true};
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'workagent-pdf-import-')),path=join(root,'state.json');
  await writeFile(path,JSON.stringify(initialState('owner')));
  const store=new FileFixtureStore(path),workspace=new Workspace(store),files=new OwnedFiles(root);
  const worker={run:async()=>structuredClone(output)},pdf=new PdfExchange({workspace,files,worker});
  return {root,path,store,workspace,files,pdf,exchange:new CsvExchange({workspace,files}),state:async()=>JSON.parse(await readFile(path,'utf8')),adoption:async(commandId='pdf-adopt')=>({...input,commandId,previewHash:(await pdf.preview('owner',input)).previewHash})};
}
test('preview is read-only; adoption is new human work; retry/cold reopen/save/original preserve existing work and proposals',async()=>{
 const f=await fixture(); const prior=await f.workspace.createBlank('owner',{commandId:'blank',title:'Keep me',kind:'document'});
 const old=await f.workspace.get('owner',prior.workId);
 await f.workspace.mutateDocument('owner',old.id,{commandId:'proposal',expected:old.expected,document:{...old.document,title:'Pending'}});
 const before=await f.state(),a=await f.adoption(); assert.deepEqual(await f.state(),before);
 const preview=await f.pdf.preview('owner',input);assert.equal(preview.pages,2);assert.match(preview.sample,/Café café Ω Ж/);
 const made=await f.pdf.import('owner',a),w=await f.workspace.get('owner',made.workId);
 assert.notEqual(w.id,old.id);assert.equal(w.humanDocument,true);assert.equal(w.intentRevision,0);
 assert.equal(w.document.body.dataStream.slice(0,-2).replace(/\r/g,'\n'),output.text);
 assert.ok(w.document.body.paragraphs.every(p=>!p.bullet));assert.equal(w.document.lists,undefined);
 assert.deepEqual((await f.state()).works[old.id],before.works[old.id]);assert.deepEqual((await f.state()).jobs,{});
 assert.equal(made.original.hash,hashBytes(bytes));assert.deepEqual((await f.exchange.original('owner',w.id,made.original.id)).bytes,bytes);
 const restarted=new PdfExchange({workspace:new Workspace(new FileFixtureStore(f.path)),files:f.files,worker:{run:()=>assert.fail('retry must not parse')}});
 assert.deepEqual(await restarted.import('owner',a),made);
 await assert.rejects(restarted.import('owner',{...a,filename:'other.pdf'}),/command_conflict/);
 const edited={...w.document,title:'Human PDF text'};
 await f.workspace.save('owner',w.id,{commandId:'save',document:edited,contentRevision:1,permissionRevision:1});
 assert.deepEqual((await new Workspace(new FileFixtureStore(f.path)).get('owner',w.id)).document,edited);
 assert.deepEqual((await f.exchange.original('owner',w.id,made.original.id)).bytes,bytes);
});
test('preview binding, unauthorized access, conversion/write revocation, rollback and cancellation leave no adoption/jobs',async()=>{
 const f=await fixture(),a=await f.adoption(),before=await f.state();let calls=0;
 f.pdf.worker={run:async()=>{calls++;return structuredClone(output);}};
 await assert.rejects(f.pdf.preview('stranger',input),/access_denied/);assert.equal(calls,0);
 await assert.rejects(f.pdf.import('owner',{...a,previewHash:undefined}),/pdf_preview_required/);
 await assert.rejects(f.pdf.import('owner',{...a,previewHash:'a'.repeat(64)}),/pdf_preview_changed/);assert.deepEqual(await f.state(),before);
 f.pdf.worker={run:async()=>{await f.store.transaction(s=>s.permissionRevision++);return structuredClone(output);}};
 await assert.rejects(f.pdf.preview('owner',input),/access_changed/);
 await assert.rejects(f.pdf.import('owner',a),/access_changed/);
 f.pdf.worker={run:async()=>structuredClone(output)};
 const write=f.files.writeOriginal.bind(f.files);
 f.files.writeOriginal=async()=>{throw Error('write failed');};await assert.rejects(f.pdf.import('owner',a),/write failed/);
 f.files.writeOriginal=async(...args)=>{const r=await write(...args);await f.store.transaction(s=>s.permissionRevision++);return r;};
 await assert.rejects(f.pdf.import('owner',a),/access_changed/);
 f.files.writeOriginal=write;
 const transaction=f.store.transaction.bind(f.store);f.store.transaction=fn=>transaction(async s=>{const r=await fn(s);if(Object.keys(s.works).length)throw Error('rollback');return r;});
 await assert.rejects(f.pdf.import('owner',a),/rollback/);
 f.store.transaction=transaction;
 const controller=new AbortController();f.files.writeOriginal=async(...args)=>{const r=await write(...args);controller.abort();return r;};
 await assert.rejects(f.pdf.import('owner',a,{signal:controller.signal}),/pdf_import_cancelled/);
 const state=await f.state();for(const field of ['works','jobs','commands'])assert.deepEqual(state[field],{});
 f.files.writeOriginal=write;const made=await f.pdf.import('owner',a);
 const read=f.files.readOriginal.bind(f.files);f.files.readOriginal=async(...args)=>{const r=await read(...args);await f.store.transaction(s=>s.enabled=false);return r;};
 await assert.rejects(f.exchange.original('owner',made.workId,made.original.id),/access_denied/);
});
test('HTTP auth/origin, preview, explicit import and immutable PDF download use existing routes without model admission',async()=>{
 const f=await fixture(),token='synthetic-fixture-key-at-least-32-characters',origin='https://private.example.test';
 const handler=createHandler({...f,owner:'owner',token,origin,clientRoot:f.root,onCommand:()=>assert.fail('no model')});
 async function req(url,body,auth=true,from=origin){
  const request=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(request,{url,method:body?'POST':'GET',headers:{'content-type':'application/json',origin:from,...(auth?{authorization:`Bearer ${token}`}:{})}});
  const result={headers:{}},response=new EventEmitter();Object.assign(response,{setHeader:(k,v)=>result.headers[k]=v,writeHead:(s,h)=>{result.status=s;Object.assign(result.headers,h);},end:b=>{result.body=b;response.writableEnded=true;}});await handler(request,response);return result;
 }
 assert.equal((await req('/api/exchange/pdf/preview',input,false)).status,401);
 assert.equal((await req('/api/exchange/pdf/import',input,true,'https://evil.test')).status,403);
 const p=await req('/api/exchange/pdf/preview',input);assert.equal(p.status,200);
 const made=await req('/api/exchange/pdf/import',{...input,commandId:'http-import',previewHash:JSON.parse(p.body).previewHash});assert.equal(made.status,200);
 const {workId,original}=JSON.parse(made.body),download=await req(`/api/work/${workId}/original/${original.id}`);
 assert.equal(download.headers['Content-Type'],'application/pdf');assert.deepEqual(download.body,bytes);assert.match(download.headers['Content-Disposition'],/original.pdf/);
});
test('strict input/result limits and narrower import namespace; no fallback',async()=>{
 const args=sandboxArgs(undefined,'import');for(const flag of ['--clearenv','--unshare-all','--die-with-parent','--new-session'])assert.ok(args.includes(flag));
 for(const path of ['/venv','/codec.py','/etc/libreoffice','--share-net'])assert.ok(!args.includes(path));
 for(const filename of ['../x.pdf','x\\y.pdf','x.pdf\n','x.docx'])assert.throws(()=>decodePdfUpload({...input,filename}));
 assert.equal(decodePdfUpload({...input,base64:Buffer.alloc(16_000_000).toString('base64')}).length,16_000_000);
 assert.throws(()=>decodePdfUpload({...input,base64:Buffer.alloc(16_000_001).toString('base64')}),/pdf_input_limit/);
 validatePdfText({pages:200,text:'A'.repeat(200000)});validatePdfText({pages:1,text:'A\n'.repeat(9999)+'A'});
 for(const value of [{pages:201,text:'A'},{pages:1,text:'A'.repeat(200001)},{pages:1,text:'A\n'.repeat(10000)},{pages:1,text:'\ud800'},{pages:1,text:'A\f'},{pages:1,text:'  '}])assert.throws(()=>validatePdfText(value));
 const worker=new PdfWorker();const c=new AbortController();c.abort();await assert.rejects(worker.run({op:'import',base64},{signal:c.signal}),/pdf_import_cancelled/);assert.equal(worker.active,false);
});
test('explicit modes bind previews, original metadata and dedup; legacy pending input stays exact', async () => {
 const f=await fixture(), calls=[];
 f.pdf.worker={run:async request=>{calls.push(structuredClone(request));return structuredClone(output);}};
 const legacy=await f.pdf.preview('owner',input), text=await f.pdf.preview('owner',{...input,mode:'text'}), ocr=await f.pdf.preview('owner',{...input,mode:'ocr-eng'});
 assert.equal(ocr.mode,'ocr-eng');assert.equal(ocr.language,'English');assert.equal(ocr.clipped,false);
 assert.equal(new Set([legacy.previewHash,text.previewHash,ocr.previewHash]).size,3);
 assert.deepEqual(calls.map(c=>c.mode),[undefined,'text','ocr-eng']);
 for(const [mode,previewHash] of [['ocr-eng',text.previewHash],['text',ocr.previewHash],['ocr-eng',legacy.previewHash]])
  await assert.rejects(f.pdf.import('owner',{...input,mode,previewHash,commandId:'cross-mode'}),/pdf_preview_changed/);
 const old={...input,previewHash:legacy.previewHash,commandId:'old-pending'};
 const retained=await f.pdf.import('owner',old);
 assert.deepEqual(await f.pdf.import('owner',structuredClone(old)),retained);
 const a={...input,mode:'ocr-eng',previewHash:ocr.previewHash,commandId:'ocr-adopt'};
 const made=await f.pdf.import('owner',a);
 assert.equal(made.original.mode,'ocr-eng');assert.equal(made.original.language,'English');assert.match(made.original.encoding,/English OCR/);
 assert.equal(made.original.hash,hashBytes(bytes));assert.deepEqual((await f.exchange.original('owner',made.workId,made.original.id)).bytes,bytes);
 const w=await f.workspace.get('owner',made.workId);assert.equal(w.humanDocument,true);assert.deepEqual(w.proposals,[]);
 f.pdf.worker={run:()=>assert.fail('retry must not run OCR')};assert.deepEqual(await f.pdf.import('owner',a),made);
 await assert.rejects(f.pdf.import('owner',{...a,mode:'text'}),/command_conflict/);
});
test('OCR preview exposes all bounded recognized text; text preview stays clipped and limits differ',async()=>{
 const f=await fixture();f.pdf.worker={run:async()=>({pages:5,text:'Review 00120\n'.repeat(1000)})};
 const p=await f.pdf.preview('owner',{...input,mode:'ocr-eng'});assert.equal(p.sample.length,13000);assert.equal(p.clipped,false);
 assert.equal((await f.pdf.preview('owner',{...input,mode:'text'})).sample.length,4000);
 f.pdf.worker={run:async()=>({pages:6,text:'Six pages'})};await assert.rejects(f.pdf.preview('owner',{...input,mode:'ocr-eng'}),/pdf_invalid_extraction/);
 for(const mode of [null,'ocr','eng','',42])assert.throws(()=>decodePdfUpload({...input,mode}),/invalid_pdf_mode/);
 assert.throws(()=>decodePdfUpload({...input,mode:'ocr-eng',language:'eng'}),/invalid_pdf_input/);
 const w=new PdfWorker();for(const req of [{op:'import',base64,mode:'ocr'},{op:'import',base64,mode:'ocr-eng',language:'eng'},{op:'export',document:{},mode:'ocr-eng'}])await assert.rejects(w.run(req),/invalid_pdf/);
 const args=sandboxArgs(undefined,'import','ocr-eng');assert.ok(args.some(v=>v.endsWith('/ocr.py')));assert.ok(args.includes('OMP_THREAD_LIMIT'));
 assert.ok(!args.includes('/venv'));assert.ok(!args.includes('--share-net'));assert.ok(args.includes('--clearenv'));
});
test('OCR import rollback, abort and permission revision checks retain prior document and proposal',async()=>{
 const f=await fixture(),req={...input,mode:'ocr-eng'},created=await f.workspace.createBlank('owner',{commandId:'keep',title:'Keep draft',kind:'document'});
 const w=await f.workspace.get('owner',created.workId);await f.workspace.mutateDocument('owner',w.id,{commandId:'keep-proposal',expected:w.expected,document:{...w.document,title:'Pending'}});
 const before=await f.state(),a={...req,previewHash:(await f.pdf.preview('owner',req)).previewHash,commandId:'ocr-write'};
 const c=new AbortController();c.abort();await assert.rejects(f.pdf.preview('owner',req,{signal:c.signal}),/pdf_import_cancelled/);
 const tx=f.store.transaction.bind(f.store);f.store.transaction=fn=>tx(async s=>{await fn(s);throw Error('rollback');});
 await assert.rejects(f.pdf.import('owner',a),/rollback/);f.store.transaction=tx;assert.deepEqual(await f.state(),before);
 f.pdf.worker={run:async()=>{await tx(s=>s.permissionRevision++);return structuredClone(output);}};
 await assert.rejects(f.pdf.import('owner',a),/access_changed/);
 const after=await f.state();assert.deepEqual(after.works,before.works);assert.deepEqual(after.commands,before.commands);assert.deepEqual(after.jobs,before.jobs);
 f.pdf.worker={run:async()=>structuredClone(output)};const made=await f.pdf.import('owner',a);
 assert.notEqual(made.workId,w.id);assert.deepEqual((await f.state()).works[w.id],before.works[w.id]);
});
test('OCR preview observes caller cancellation during the final grant read',async()=>{
 const f=await fixture(),c=new AbortController(),access=f.pdf.access.bind(f.pdf);
 f.pdf.access=async(principal,expected)=>{const r=await access(principal,expected);if(expected!==undefined)c.abort();return r;};
 await assert.rejects(f.pdf.preview('owner',{...input,mode:'ocr-eng'},{signal:c.signal}),/pdf_import_cancelled/);
 assert.deepEqual((await f.state()).works,{});
});
