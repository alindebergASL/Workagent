// Actual namespace checks. Never skipped; Parent reruns when the writer sandbox
// forbids namespaces. Synthetic pixels are not live/model acceptance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { PdfWorker, sandboxArgs, namespaceIdentity, collectChild } from '../src/pdf-worker.mjs';
function fixture(kind='scan', pages=1) {
 const r=spawnSync('/usr/bin/python3',['-I','services/workagent-execution/pdf/fixtures/ocr_import.py',kind,String(pages)],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
function child(args) {
 const c=spawn('/usr/bin/bwrap',args,{detached:true,env:{PDF_TEST_SECRET:'synthetic-not-a-credential'},stdio:['pipe','pipe','pipe','pipe','pipe','pipe']});
 namespaceIdentity().forEach((v,i)=>{c.stdio[i+3].on('error',()=>{});c.stdio[i+3].end(v);});return c;
}
test('actual OCR namespace has cleared credentials, no host home/state/network, read-only tessdata and resource caps',async()=>{
 const args=sandboxArgs(undefined,'import','ocr-eng');args.splice(-1,1,'-c',`import os,socket,json,runpy,resource
m=runpy.run_path('/extract.py');m['limits']()
assert not os.path.exists('/home') and not os.path.exists('/var/lib/workagent-b01')
assert 'PDF_TEST_SECRET' not in os.environ and os.environ['OMP_THREAD_LIMIT']=='1'
assert set(os.listdir('/etc'))=={'fonts','passwd','group','nsswitch.conf'}
assert resource.getrlimit(resource.RLIMIT_AS)==(512*1024**2,)*2
assert resource.getrlimit(resource.RLIMIT_CPU)==(10,10)
assert os.path.isfile('/usr/share/tesseract-ocr/5/tessdata/eng.traineddata')
try:
 open('/usr/share/tesseract-ocr/5/tessdata/probe','w');raise AssertionError('writable tessdata')
except OSError:pass
try:
 s=socket.create_connection(('127.0.0.1',8310),timeout=.1);s.close();raise AssertionError('host network reachable')
except OSError:pass
print(json.dumps({'pages':1,'text':'Isolation checked'}))`);
 assert.equal((await collectChild(child(args),'',{operation:'import',mode:'ocr-eng',timeoutMs:10000})).text,'Isolation checked');
});
test('actual isolated OCR recognizes image pixels/leading zeros and every mixed page, without hidden text',async()=>{
 const worker=new PdfWorker();
 for(const kind of ['scan','mixed']) {
  const r=await worker.run({op:'import',mode:'ocr-eng',base64:fixture(kind,2)});
  assert.equal(r.pages,2);assert.equal(r.text.split('Reference 00120').length,3);assert.ok(r.text.includes('Guests 0042'));
  assert.ok(r.text.includes(kind==='mixed'?'Visible text page 2':'English preview page 2'));
  assert.ok(!r.text.includes('HIDDEN'));assert.ok(!r.text.includes('99999'));
  console.log(JSON.stringify({kind,recognizedText:r.text}));
 }
});
for(const [kind,pages,code] of [['scan',6,'pdf_ocr_page_limit'],['blank',1,'pdf_ocr_page_without_text'],['mixed-blank',2,'pdf_ocr_page_without_text']])test(`actual OCR refuses whole ${kind}/${pages}`,async()=>{
 await assert.rejects(new PdfWorker().run({op:'import',mode:'ocr-eng',base64:fixture(kind,pages)}),e=>e.code===code && e.status===400);
});
for(const target of ['/usr/bin/tesseract','/usr/bin/pdftoppm','/usr/share/tesseract-ocr/5/tessdata/eng.traineddata'])test(`missing sandbox runtime refuses without fallback: ${target}`,async()=>{
 const args=sandboxArgs(undefined,'import','ocr-eng');
 // Empty, non-executable/unreadable source hides only the required runtime.
 args.splice(args.indexOf('--proc'),0,'--ro-bind','/dev/null',target);
 const request={op:'import',mode:'ocr-eng',base64:fixture()};
 await assert.rejects(collectChild(child(args),JSON.stringify(request),{operation:'import',mode:'ocr-eng',timeoutMs:10000}),/pdf_ocr_runtime_unavailable|pdf_ocr_failed/);
});
for(const abort of [false,true])test(`OCR watchdog/abort closes descendants in separate sessions: abort ${abort}`,async()=>{
 const args=sandboxArgs(undefined,'import','ocr-eng');args.splice(-1,1,'-c',`import subprocess,time,json
subprocess.Popen(['/usr/bin/python3','-c','import time;time.sleep(60)'],start_new_session=True)
print(json.dumps({'pages':1,'text':'Waiting'}),flush=True)
time.sleep(60)`);
 const c=child(args),controller=new AbortController(),start=Date.now();
 const p=collectChild(c,'',{operation:'import',mode:'ocr-eng',timeoutMs:1000,signal:controller.signal});
 if(abort)c.stdout.once('data',()=>controller.abort());
 await assert.rejects(p,abort?/pdf_import_cancelled/:/pdf_worker_timeout/);assert.ok(Date.now()-start<5000);
});
