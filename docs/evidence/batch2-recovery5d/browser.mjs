import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),req=createRequire(root+'/web/package.json'),{chromium,expect:base}=req('@playwright/test'),expect=base.configure({timeout:20000});
const out=root+'/docs/evidence/batch2-recovery5d',fixtureOut=out+(process.env.A14_FIXTURE_SUBDIR?'/'+process.env.A14_FIXTURE_SUBDIR:''),f=JSON.parse(await fs.readFile(fixtureOut+'/fixture.json','utf8')),origin='http://127.0.0.1:3195';
const label=process.env.A14_RUN_LABEL||'browser';
const report={started:new Date().toISOString(),label,checks:[],posts:[],reads:[],console:[],errors:[],switches:[]};
const ctx=await chromium.launchPersistentContext(root+'/.local/recovery5d/'+label+'-profile',{headless:true,args:['--no-sandbox'],viewport:{width:1440,height:1000}}),page=ctx.pages()[0];
await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
await ctx.addInitScript(()=>{
 const original=window.fetch.bind(window);window.__a14Frames=[];window.__a14UiSamples=[];
 let last='';const sample=()=>{const values=[...document.querySelectorAll('textarea')].map(e=>e.value);const staged=document.querySelectorAll('[data-upload=local]').length;const next=JSON.stringify({values,staged});if(next!==last){last=next;window.__a14UiSamples.push({values,staged});}requestAnimationFrame(sample);};requestAnimationFrame(sample);
 window.fetch=async(...args)=>{const response=await original(...args);const input=args[0];const url=typeof input==='string'?input:input instanceof Request?input.url:String(input);
  if(url.includes('/events/stream')&&response.ok&&response.body){const reader=response.clone().body.getReader();void(async()=>{const decoder=new TextDecoder();try{for(;;){const {done,value}=await reader.read();if(done)break;const text=decoder.decode(value,{stream:true});if(window.__a14Frames.length<100)window.__a14Frames.push({at:Date.now(),text:text.slice(0,4096)});}}catch(e){window.__a14Frames.push({streamError:String(e)});}})();}
  return response;
 };
});
page.on('request',r=>{if(r.method()==='POST')report.posts.push({url:r.url(),body:r.postData(),scope:r.headers()['x-workagent-scope']??null})});
page.on('console',m=>{if(m.type()==='error')report.console.push(m.text())});page.on('pageerror',e=>report.errors.push(String(e)));
const url=id=>origin+'/conversations/'+id+'?workspace='+f.workspace;
const draft='  Principal A private synthetic draft 雪\nnot shared ♪\n';
async function get(path,scope=null){
 // GET-only bounded polling handles closed keepalive sockets after owned restarts.
 let error;for(let n=0;n<4;n++){try{const r=await fetch(origin+'/api/domain'+path,{headers:{'X-Workagent-Client':'local-ui',...(scope?{'X-Workagent-Scope':scope}:{})},signal:AbortSignal.timeout(10000)});const body=await r.json();const result={path,status:r.status,body};report.reads.push(result);return result;}catch(e){error=e;await new Promise(r=>setTimeout(r,250*(n+1)));}}throw error;
}
async function identity(){const r=await get('/v1/session');expect(r.status).toBe(200);expect(r.body.scope_id).toMatch(/^[a-f0-9]{64}$/);return r.body;}
async function ready(){await expect(page.locator('textarea').first()).toBeVisible();}
async function snap(name){
 const prefix=out+'/'+label+'-'+name;await page.screenshot({path:prefix+'.png',fullPage:true});await fs.writeFile(prefix+'.txt',await page.locator('body').innerText(),{flag:'wx'});
 const overflow=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));report.checks.push({screenshot:name,overflow});expect(overflow.document).toBeLessThanOrEqual(overflow.width);expect(overflow.body).toBeLessThanOrEqual(overflow.width);
}
async function idb(){return page.evaluate(async()=>{
 const db=await new Promise((ok,no)=>{const q=indexedDB.open('workagent-drafts',1);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});
 const rows=db.objectStoreNames.contains('documents')?await new Promise((ok,no)=>{const q=db.transaction('documents').objectStore('documents').getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)}):[];db.close();
 return Promise.all(rows.map(async r=>({...r,bytes:undefined,actual_sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',r.bytes))).map(b=>b.toString(16).padStart(2,'0')).join(''),actual_length:r.bytes.byteLength})));
 });}
async function verifyOwned(session,kind){const pid=execFileSync('tmux',['display-message','-p','-t',session,'#{pane_pid}'],{encoding:'utf8'}).trim();const cwd=await fs.realpath('/proc/'+pid+'/cwd');const argv=await fs.readFile('/proc/'+pid+'/cmdline','utf8');expect(cwd.startsWith(root)).toBe(true);expect(argv.includes(kind==='web'?'next':'.venv/bin/python')).toBe(true);return {session,pid,cwd,argv:argv.replaceAll('\0',' ')};}
async function switchApi(principal){
 report.switches.push({type:'principal-only',principal,previous:await verifyOwned('b2r5b-api','api')});execFileSync('tmux',['kill-session','-t','b2r5b-api']);
 execFileSync('tmux',['new-session','-d','-s','b2r5b-api','-c',root,`source .local/recovery5a/test.env; exec backend/.venv/bin/python docs/evidence/batch2-recovery5d/fixture.py api ${principal} 18965 > .local/recovery5d/api-${principal}.log 2>&1`]);
 await expect.poll(async()=>{try{return (await identity()).principal_id}catch{return null}},{timeout:30000}).toBe(principal);
}
async function switchWeb(port){
 report.switches.push({type:'endpoint-only',port,previous:await verifyOwned('b2r5b-web','web')});execFileSync('tmux',['kill-session','-t','b2r5b-web']);
 execFileSync('tmux',['new-session','-d','-s','b2r5b-web','-c',root,`source .local/recovery5a/test.env; export WORKAGENT_WEB_ORIGIN=${origin} WORKAGENT_BACKEND_URL=http://127.0.0.1:${port}; cd web; exec node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3195 > ../.local/recovery5d/web-${port}.log 2>&1`]);
 await expect.poll(async()=>{try{return (await fetch(origin)).status}catch{return 0}},{timeout:30000}).toBe(200);
}
async function stalePost(scope,name){
 // Known stale fence only. Never retry this POST; canonical readbacks prove no mutation.
 const body={schema_version:'workagent/v1',request_id:'recovery5d-'+name,command_id:'recovery5d-'+name,title:'MUST NEVER CREATE',selected_source_refs:[]};
 const r=await page.evaluate(async({scope,body,ws})=>{const r=await fetch('/api/domain/v1/workspaces/'+ws+'/conversations',{method:'POST',headers:{'Content-Type':'application/json','X-Workagent-Client':'local-ui','X-Workagent-Scope':scope},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{scope,body,ws:f.workspace});
 report.checks.push({stale_command:name,...r});expect([401,403,409]).toContain(r.status);
}
let principalB=false,endpointB=false;
try{
 report.identityA=await identity();expect(report.identityA.principal_id).toBe(f.principal_a);
 // A legacy record of unproven identity is retained but cannot be restored.
 await page.goto(origin);await page.evaluate(({cid})=>{sessionStorage.setItem('workagent:conversation:'+cid,'LEGACY UNPROVEN PRIVATE DRAFT');},{cid:f.conversation});
 await page.goto(url(f.conversation));await ready();await expect(page.locator('textarea').first()).toHaveValue('');
 report.legacy=await page.evaluate(cid=>sessionStorage.getItem('workagent:conversation:'+cid),f.conversation);expect(report.legacy).toBe('LEGACY UNPROVEN PRIVATE DRAFT');
 await page.locator('textarea').first().fill(draft);
 await page.getByTestId('document-picker').locator('input[type=file]').setInputFiles(root+'/.local/recovery5b/continuity.pdf');await expect(page.locator('[data-upload=local]')).toBeVisible();
 await expect.poll(async()=>(await idb()).length).toBe(1);report.stagedA=await idb();expect(report.stagedA[0].sha256).toBe(report.stagedA[0].actual_sha256);
 report.canonicalBefore=await get('/v1/workspaces/'+f.workspace+'/conversations/'+f.conversation,report.identityA.scope_id);expect(report.canonicalBefore.status).toBe(200);
 report.pendingKey='workagent:scope:v1:'+report.identityA.scope_id+':workagent:pending:'+f.workspace+':conversation:'+f.conversation+':send';
 report.pendingEnvelope={command_id:'recovery5d-never-dispatch',expected_work_version:report.canonicalBefore.body.conversation.work_version,text:draft,attachments:[]};
 await page.evaluate(({key,envelope})=>sessionStorage.setItem(key,JSON.stringify(envelope)),{key:report.pendingKey,envelope:report.pendingEnvelope});
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await snap('a-'+width);}
 await page.reload();await ready();await expect(page.locator('textarea').first()).toHaveValue(draft);await expect(page.locator('[data-upload=local]')).toBeVisible();expect(await idb()).toEqual(report.stagedA);report.checks.push('same-principal/same-endpoint ordinary reload restores exact draft and staged bytes');
 await page.route('**/api/domain/v1/session',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'connection_required',message:'Synthetic session outage'})}));
 await page.reload();await expect(page.getByRole('status')).toContainText('Couldn’t confirm access');await expect(page.locator('textarea')).toHaveCount(0);expect(await idb()).toEqual(report.stagedA);for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await snap('identity-unavailable-'+width);}await page.unroute('**/api/domain/v1/session');
 await page.reload();await ready();await expect(page.locator('textarea').first()).toHaveValue(draft);await expect(page.locator('[data-upload=local]')).toBeVisible();report.checks.push('Controlled unavailable-session fault: no durable UI exposure or dispatch; unchanged exact A recovery after real authentication returns');
 await page.goto(url(f.other_conversation));await ready();await expect(page.locator('textarea').first()).toHaveValue('');await expect(page.locator('[data-upload=local]')).toHaveCount(0);
 await page.goto(url(f.conversation));await ready();await expect(page.locator('textarea').first()).toHaveValue(draft);
 // Actual principal-only change, no endpoint/proxy change; browser remains open.
 principalB=true;await switchApi(f.principal_b);report.identityB=await identity();expect(report.identityB.scope_id).not.toBe(report.identityA.scope_id);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(async()=>await page.locator('textarea').count()===0||await page.locator('textarea').first().inputValue()!==draft,{timeout:30000}).toBe(true);
 await snap('principal-transition');await stalePost(report.identityA.scope_id,'principal-stale');
 await page.reload();await expect(page.getByText('Your access to this conversation changed.',{exact:false})).toBeVisible();await expect(page.locator('textarea')).toHaveCount(0);await expect(page.locator('[data-upload=local]')).toHaveCount(0);expect(await idb()).toEqual(report.stagedA);
 report.principalBRead=await get('/v1/workspaces/'+f.workspace+'/conversations/'+f.conversation,report.identityB.scope_id);expect(report.principalBRead.status).toBe(200);report.principalBSnapshot=await get('/v1/workspaces/'+f.workspace+'/work-snapshot?conversation_id='+f.conversation,report.identityB.scope_id);expect(report.principalBSnapshot.status).toBe(404);
 report.principalBUiSamples=await page.evaluate(()=>window.__a14UiSamples);expect(report.principalBUiSamples.every(s=>!s.values.includes(draft)&&s.staged===0)).toBe(true);report.checks.push('Principal B: existing owner-only work-snapshot refuses404 although ordinary shared conversation read200; no sampled transient draft or staged-file exposure');
 report.pendingUnderB=await page.evaluate(({original,foreign})=>({original:JSON.parse(sessionStorage.getItem(original)),foreign:sessionStorage.getItem(foreign)}),{original:report.pendingKey,foreign:report.pendingKey.replace(report.identityA.scope_id,report.identityB.scope_id)});expect(report.pendingUnderB.original).toEqual(report.pendingEnvelope);expect(report.pendingUnderB.foreign).toBeNull();
 report.privateRefusal=await get('/v1/workspaces/'+f.private_workspace+'/conversations',report.identityB.scope_id);expect(report.privateRefusal.status).toBe(404);await snap('principal-b');
 await switchApi(f.principal_a);principalB=false;await page.reload();await ready();await expect(page.locator('textarea').first()).toHaveValue(draft);await expect(page.locator('[data-upload=local]')).toBeVisible();expect(await idb()).toEqual(report.stagedA);
 expect(await identity()).toEqual(report.identityA);report.checks.push('principal-only change isolates drafts/bytes and stale dispatch; original scope restores');
 // Actual endpoint-only change to second owned API with same principal/database.
 endpointB=true;await switchWeb(18966);report.identityEndpoint=await identity();expect(report.identityEndpoint.principal_id).toBe(f.principal_a);expect(report.identityEndpoint.scope_id).not.toBe(report.identityA.scope_id);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(async()=>await page.locator('textarea').count()===0||await page.locator('textarea').first().inputValue()!==draft,{timeout:30000}).toBe(true);
 await stalePost(report.identityA.scope_id,'endpoint-stale');await page.reload();await ready();await expect(page.locator('textarea').first()).toHaveValue('');await expect(page.locator('[data-upload=local]')).toHaveCount(0);expect(await idb()).toEqual(report.stagedA);await snap('endpoint-b');
 await switchWeb(18965);endpointB=false;await page.reload();await ready();await expect(page.locator('textarea').first()).toHaveValue(draft);await expect(page.locator('[data-upload=local]')).toBeVisible();expect(await idb()).toEqual(report.stagedA);expect(await identity()).toEqual(report.identityA);report.checks.push('endpoint-only change isolates drafts/bytes and stale dispatch; original endpoint restores');
 if(process.env.A14_SKIP_REVOCATION==='1'){report.status='PARTIAL';report.checks.push('Candidate1 harness preflight only; revocation deliberately not attempted until reviewed correction build');}else{
 // Live streaming channel is open before membership revocation.
 const events=[];page.on('response',r=>{if(r.url().includes('/events/stream'))events.push({url:r.url(),status:r.status()})});
 await page.reload();await ready();await expect(page.locator('textarea').first()).toHaveValue(draft);await expect.poll(()=>events.filter(e=>e.status===200).length,{timeout:25000}).toBeGreaterThan(0);
 report.liveStreamBeforeRevoke=events.slice();report.snapshotBefore=await get('/v1/workspaces/'+f.workspace+'/work-snapshot?conversation_id='+f.conversation,report.identityA.scope_id);expect(report.snapshotBefore.status).toBe(200);
 execFileSync(root+'/backend/.venv/bin/python',[out+'/'+(process.env.A14_FIXTURE_SCRIPT||'fixture.py'),'revoke'],{env:process.env});
 await expect.poll(async()=>(await get('/v1/workspaces/'+f.workspace+'/conversations/'+f.conversation,report.identityA.scope_id)).status,{timeout:30000}).toBe(404);
 await expect(page.getByText('Your access to this conversation changed.',{exact:false})).toBeVisible({timeout:30000});await expect(page.locator('[data-upload=local]')).toHaveCount(0);report.revokedText=await page.locator('body').innerText();expect(report.revokedText).not.toContain('A14 shared synthetic conversation');report.revokedInputs=await page.locator('textarea').evaluateAll(es=>es.map(e=>({value:e.value,readOnly:e.readOnly,disabled:e.disabled})));expect(report.revokedInputs.every(e=>e.readOnly&&e.value===draft)).toBe(true);await expect(page.getByRole('button',{name:/^(Send|Send message|Queue|Try again)$/})).toHaveCount(0);
 report.revokedSnapshot=await get('/v1/workspaces/'+f.workspace+'/work-snapshot?conversation_id='+f.conversation,report.identityA.scope_id);report.revokedEvents=await get('/v1/workspaces/'+f.workspace+'/events?conversation_id='+f.conversation+'&after='+encodeURIComponent(report.snapshotBefore.body.snapshot_cursor),report.identityA.scope_id);expect(report.revokedSnapshot.status).toBe(404);expect(report.revokedEvents.status).toBe(404);expect(await idb()).toEqual(report.stagedA);
 report.revocationFrames=await page.evaluate(()=>window.__a14Frames);expect(report.revocationFrames.some(f=>(f.text||'').includes('access_changed'))).toBe(true);
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await snap('revoked-'+width);}
 expect(report.posts).toHaveLength(2);expect(report.errors).toEqual([]);report.checks.push('active-midstream revocation sanitizes open browser, retains originals, refuses canonical reads; only2 intentional stale POST probes, no automatic dispatch');
 report.status='PASS';
 }
}catch(e){report.status='FAIL';report.error=String(e.stack||e);await snap('failure').catch(()=>{});process.exitCode=1;}
finally{
 if(principalB)await switchApi(f.principal_a).catch(e=>report.restoreError=String(e));if(endpointB)await switchWeb(18965).catch(e=>report.restoreError=String(e));report.finished=new Date().toISOString();await fs.writeFile(out+'/'+label+'-report.json',JSON.stringify(report,null,2),{flag:'wx'});await ctx.close();console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,posts:report.posts.length},null,2));
}
