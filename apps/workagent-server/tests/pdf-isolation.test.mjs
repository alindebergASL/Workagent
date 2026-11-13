// Parent/CI only: actual renderer and namespace, fail closed (never skipped).
// poppler-utils is test-only; production does not invoke PDF text extraction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
import { PdfWorker, sandboxArgs, namespaceIdentity, collectChild } from '../src/pdf-worker.mjs';
const venv = process.env.WORKAGENT_DOCX_VENV;
async function probe(script, input = '') {
  const args = sandboxArgs(venv); args.splice(-1, 1, '-c', script);
  const child = spawn('/usr/bin/bwrap', args, { detached: true, env: { PDF_TEST_SECRET: 'synthetic-only' }, stdio: ['pipe','pipe','pipe','pipe','pipe','pipe'] });
  namespaceIdentity().forEach((text,i) => { child.stdio[i+3].on('error',()=>{});child.stdio[i+3].end(text); });
  return await new Promise((resolve,reject) => {
    const out=[],err=[];const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('probe timeout'));},12000);
    child.stdout.on('data',c=>out.push(c));child.stderr.on('data',c=>err.push(c));child.stdin.on('error',()=>{});child.on('error',reject);
    child.on('close',code=>{clearTimeout(timeout);if(code)reject(Error(Buffer.concat(err).toString()||`exit ${code}`));else resolve(JSON.parse(Buffer.concat(out)));});child.stdin.end(input);
  });
}
test('PDF actual namespace has only scoped config, synthetic actor, cleared environment, no host network/state', async()=>{
  const result=await probe(`import os,socket,json,pwd,runpy,resource
m=runpy.run_path('/render.py');m['limits']()
r={'home':not os.path.exists('/home'),'state':not os.path.exists('/var/lib/workagent-b01'),'env':'PDF_TEST_SECRET' not in os.environ,'identity':pwd.getpwuid(os.getuid()).pw_name=='worker','etc':set(os.listdir('/etc'))=={'fonts','libreoffice','passwd','group','nsswitch.conf'},'cpu':resource.getrlimit(resource.RLIMIT_CPU)==(15,15),'memory':resource.getrlimit(resource.RLIMIT_AS)==(2147483648,2147483648)}
try:
 open('/usr/pdf-test-write','w');r['readonly']=False
except OSError:r['readonly']=True
try:
 s=socket.create_connection(('127.0.0.1',8310),timeout=.1);s.close();r['network']=False
except OSError:r['network']=True
print(json.dumps(r))`);
  for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
});
test('actual isolated native → qualified DOCX → LibreOffice PDF opens with rich/literal/Unicode/empty/multiple-page content', async()=>{
  const worker=new PdfWorker({venv});
  for(const content of ['', 'Guests: 40\nVolunteers: 5\nAccess code 00120. Noor. Readiness confirmed. 雪 🌍\n<script> & <w:t> literal\n', Array.from({length:300},(_,i)=>`Paragraph ${i} preserved on multiple pages.`).join('\n')]){
    const document=blankDocument('pdf-test','PDF fixture',content); if(content) document.body.textRuns=[{st:0,ed:6,ts:{bl:1,it:1,ul:{s:1},fs:18,cl:{rgb:'#224466'}}}];
    const copy=structuredClone(document),start=Date.now(),pending=worker.run({op:'export',document});
    await assert.rejects(worker.run({op:'export',document}),/busy_retry/);
    const result=await pending;assert.deepEqual(document,copy);assert.equal(worker.active,false);
    const opened=await probe(`import sys,base64,pathlib,subprocess,json
p=pathlib.Path('/tmp/check.pdf');p.write_bytes(base64.b64decode(sys.stdin.buffer.read()))
t=subprocess.check_output(['/usr/bin/pdftotext','-layout',str(p),'-'],timeout=5).decode()
i=subprocess.check_output(['/usr/bin/pdfinfo',str(p)],timeout=5).decode()
print(json.dumps({'text':t,'info':i}))`,result.base64);
    if(content.includes('Guests')) for(const value of ['Guests: 40','Volunteers: 5','00120','Noor','Readiness confirmed.','雪','🌍','<script> & <w:t> literal']) assert.ok(opened.text.includes(value),value);
    if(content.includes('Paragraph 299')){assert.ok(opened.text.includes('Paragraph 299'));assert.ok(Number(/Pages:\s+(\d+)/.exec(opened.info)[1])>1);}
    console.log(JSON.stringify({fixture:content?'populated':'empty',bytes:Buffer.from(result.base64,'base64').length,elapsedMs:Date.now()-start,pages:/Pages:\s+(\d+)/.exec(opened.info)[1]}));
  }
});
test('actual PID namespace tears down a descendant that creates its own session on outer timeout',async()=>{
  const args=sandboxArgs(venv);args.splice(-1,1,'-c',`import subprocess,time
subprocess.Popen(['/usr/bin/python3','-c','import time;time.sleep(60)'],start_new_session=True)
time.sleep(60)`);
  const child=spawn('/usr/bin/bwrap',args,{detached:true,env:{},stdio:['pipe','pipe','pipe','pipe','pipe','pipe']});
  const pending=collectChild(child,'',{timeoutMs:1000});namespaceIdentity().forEach((v,i)=>{child.stdio[i+3].on('error',()=>{});child.stdio[i+3].end(v);});
  const start=Date.now();await assert.rejects(pending,/pdf_worker_timeout/);assert.ok(Date.now()-start<5000,'all descendant-held output pipes must close');
});

test('actual isolated PDF preserves adjacent, reversed and repeated Han/emoji and refuses unqualified text', async()=>{
  const worker=new PdfWorker({venv});
  const content='雪 🌍\n🌍 雪\n雪🌍雪🌍\n🌍雪🌍雪\nLatin café <script> & <w:t> 00120';
  const result=await worker.run({op:'export',document:blankDocument('pdf-order','Font order',content)});
  const opened=await probe(`import sys,base64,pathlib,subprocess,json
p=pathlib.Path('/tmp/order.pdf');p.write_bytes(base64.b64decode(sys.stdin.buffer.read()))
t=subprocess.check_output(['/usr/bin/pdftotext','-layout',str(p),'-'],timeout=5).decode()
print(json.dumps({'text':t}))`,result.base64);
  assert.equal((opened.text.match(/雪/g)||[]).length,6);assert.equal((opened.text.match(/🌍/gu)||[]).length,6);
  assert.ok(opened.text.includes('Latin café <script> & <w:t> 00120'));
  const lines=opened.text.split('\n').map(s=>s.replace(/\s/g,''));
  for(const line of ['雪🌍','🌍雪','雪🌍雪🌍','🌍雪🌍雪'])assert.ok(lines.includes(line),line);
  for(const [text,error] of [['العربية','pdf_unsupported_text'],['e\u0301','pdf_unsupported_text'],['👩\u200d💻','pdf_unsupported_text'],['\u9fff','pdf_missing_glyph']]){
    await assert.rejects(worker.run({op:'export',document:blankDocument('pdf-order','Unsupported',text)}),new RegExp(error));assert.equal(worker.active,false);
  }
});
