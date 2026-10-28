import {createRequire} from 'node:module';import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';
const root=process.cwd(),req=createRequire(root+'/web/package.json'),{chromium,expect:base}=req('@playwright/test'),expect=base.configure({timeout:15000});
const out=root+'/docs/evidence/batch2-recovery5c',f=JSON.parse(await fs.readFile(out+'/scope-fixture.json','utf8')),origin='http://127.0.0.1:3195',ws=f.workspace;
const report={started:new Date().toISOString(),posts:[],reads:[],checks:[],failures:[]};
const ctx=await chromium.launchPersistentContext(root+'/.local/recovery5c/scope-browser',{headless:true,args:['--no-sandbox'],viewport:{width:1200,height:900}}),page=ctx.pages()[0];
await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
page.on('request',r=>{if(r.method()==='POST')report.posts.push({url:r.url(),body:r.postData()})});
const url=id=>origin+'/conversations/'+id+'?workspace='+ws;
const get=async path=>{const r=await fetch(origin+'/api/domain/v1/workspaces/'+ws+path,{headers:{'X-Workagent-Client':'local-ui'}});const b=await r.json();report.reads.push({path,status:r.status,body:b});return {status:r.status,body:b};};
const snap=async name=>{await page.screenshot({path:out+'/scope-'+name+'.png',fullPage:true});await fs.writeFile(out+'/scope-'+name+'.txt',await page.locator('body').innerText(),{flag:'wx'});};
async function idb(){return page.evaluate(async()=>{const db=await new Promise((ok,no)=>{const q=indexedDB.open('workagent-drafts',1);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});const rows=await new Promise((ok,no)=>{const q=db.transaction('documents').objectStore('documents').getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});db.close();return Promise.all(rows.map(async r=>({...r,bytes:undefined,actual_sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',r.bytes))).map(b=>b.toString(16).padStart(2,'0')).join(''),actual_length:r.bytes.byteLength})));});}
let switched=false;
async function switchWeb(port){
 const pid=execFileSync('tmux',['display-message','-p','-t','b2r5b-web','#{pane_pid}'],{encoding:'utf8'}).trim();
 const cwd=await fs.realpath('/proc/'+pid+'/cwd');expect(cwd).toBe(root+'/web');
 const argv=await fs.readFile('/proc/'+pid+'/cmdline','utf8');expect(argv).toContain('next');
 execFileSync('tmux',['kill-session','-t','b2r5b-web']);
 execFileSync('tmux',['new-session','-d','-s','b2r5b-web','-c',root,`source .local/recovery5a/test.env; export WORKAGENT_WEB_ORIGIN=${origin} WORKAGENT_BACKEND_URL=http://127.0.0.1:${port}; cd web; exec node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3195 > ../.local/recovery5c/web-${port}.log 2>&1`]);
 await expect.poll(async()=>{try{return (await fetch(origin)).status}catch{return 0}},{timeout:30000}).toBe(200);
 report.checks.push('Actual web proxy restart uses API '+port);
}
try{
 await page.goto(url(f.conversation));await expect(page.locator('textarea')).toBeVisible();report.before=await get('/conversations/'+f.conversation);
 const draft='  Principal A private synthetic draft 雪\nnot shared ♪\n';await page.locator('textarea').fill(draft);
 await page.getByTestId('document-picker').locator('input[type=file]').setInputFiles(root+'/.local/recovery5b/continuity.pdf');await expect(page.locator('[data-upload=local]')).toBeVisible();
 await expect.poll(async()=>(await idb()).length).toBe(1);report.staged=await idb();expect(report.staged[0].sha256).toBe(report.staged[0].actual_sha256);await snap('principal-a');
 await page.goto(url(f.other_conversation));await expect(page.locator('textarea')).toHaveValue('');await expect(page.locator('[data-upload=local]')).toHaveCount(0);await get('/conversations/'+f.other_conversation);report.checks.push('Different conversation hides exact draft and staged bytes');
 await page.goto(url(f.conversation));await expect(page.locator('textarea')).toHaveValue(draft);await expect(page.locator('[data-upload=local]')).toBeVisible();expect(await idb()).toEqual(report.staged);
 switched=true;await switchWeb(18966);await page.reload();await expect(page.locator('textarea')).toBeVisible();report.after_switch=await get('/conversations/'+f.conversation);
 // Read another workspace only principal A is authorized for: real API proof of principal change.
 const denied=await fetch(origin+'/api/domain/v1/workspaces/recovery5a-workspace/conversations',{headers:{'X-Workagent-Client':'local-ui'}});report.foreign_workspace_status=denied.status;expect(denied.status).toBe(404);
 report.principal_b_draft=await page.locator('textarea').inputValue();report.principal_b_staged=await idb();report.principal_b_visible_staged=await page.locator('[data-upload=local]').count();await snap('principal-b');
 if(report.principal_b_draft===draft||report.principal_b_visible_staged>0)report.failures.push('CONFIRMED: switching actual backend endpoint+authenticated principal on same browser origin exposes previous principal draft/staged document. Client PRINCIPAL is build-time local-human; scope lacks endpoint identity.');
 await switchWeb(18965);switched=false;await page.reload();await expect(page.locator('textarea')).toHaveValue(draft);
 report.snapshot_before=await get('/work-snapshot?conversation_id='+f.conversation);await page.waitForTimeout(2000);
 execFileSync(root+'/backend/.venv/bin/python',[out+'/scope.py','revoke'],{env:process.env});
 await expect.poll(async()=>(await get('/conversations/'+f.conversation)).status,{timeout:30000}).toBe(404);
 await page.waitForTimeout(20000);report.after_revoke_text=await page.locator('body').innerText();report.revoke_draft_fields=await page.locator('textarea').count();report.revoked_snapshot=await get('/work-snapshot?conversation_id='+f.conversation);report.revoked_events=await get('/events?conversation_id='+f.conversation+'&after='+encodeURIComponent(report.snapshot_before.body.snapshot_cursor));await snap('revoked');
 expect(report.revoked_snapshot.status).toBe(404);expect(report.revoked_events.status).toBe(404);expect(report.posts).toHaveLength(0);
 report.checks.push('Midstream membership revocation: real conversation/snapshot/events404, zero automatic POST');
 if(report.after_revoke_text.includes('Scope A synthetic draft')||report.revoke_draft_fields)report.failures.push('Revoked browser still renders protected content/composer after20s; see exact DOM receipt');
 report.status=report.failures.length?'RED':'PASS';
}catch(e){report.status='HARNESS_OR_PRODUCT_FAILURE';report.error=String(e.stack||e);await snap('failure').catch(()=>{});process.exitCode=1;}
finally{if(switched)await switchWeb(18965);report.finished=new Date().toISOString();await fs.writeFile(out+'/scope-report.json',JSON.stringify(report,null,2),{flag:'wx'});await ctx.close();console.log(JSON.stringify({status:report.status,checks:report.checks,failures:report.failures,error:report.error},null,2));}
