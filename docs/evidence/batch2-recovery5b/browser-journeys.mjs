import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=process.cwd();
const require=createRequire(root+'/web/package.json');
const {chromium,expect:baseExpect}=require('@playwright/test');
const expect=baseExpect.configure({timeout:30000});
const out=root+'/docs/evidence/batch2-recovery5b'+(process.env.PROOF_RUN?'/'+process.env.PROOF_RUN:'');
await fs.mkdir(out,{recursive:true});
const origin='http://127.0.0.1:3195',ws='recovery5a-workspace',cid='cb848ce6-e383-4dc8-b2dc-7721720e45e6',aid='dfe536ed-23fa-44fc-8e3d-0f9796317304';
const base=origin+'/api/domain/v1/workspaces/'+ws, url=origin+'/conversations/'+cid+'?workspace='+ws;
const hash=b=>createHash('sha256').update(b).digest('hex');
const phase=process.argv[2];
const report={phase,started:new Date().toISOString(),evidence_type:'real Chromium + current real HTTP/PostgreSQL; synthetic fixture; zero product provider calls',checks:[],errors:[],requests:[]};
const profile=root+'/.local/recovery5b/browser-profile';
const ctx=await chromium.launchPersistentContext(profile,{headless:true,args:['--no-sandbox'],viewport:{width:1440,height:1000},acceptDownloads:true});
const page=ctx.pages()[0];page.setDefaultTimeout(30000);
page.on('pageerror',e=>report.errors.push(e.message));
page.on('request',r=>{if(r.url().includes('/api/'))report.requests.push({method:r.method(),url:r.url().replace(origin,''),at:new Date().toISOString()})});
await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
const get=async(p)=>{const r=await fetch(base+p,{headers:{'X-Workagent-Client':'local-ui'}});expect(r.status).toBe(200);return r.json()};
const snap=async(name)=>{await page.screenshot({path:out+'/'+phase+'-'+name+'.png',fullPage:true});await fs.writeFile(out+'/'+phase+'-'+name+'.txt',await page.locator('body').innerText());};
const check=(name,data={})=>report.checks.push({name,...data});
async function open(){await page.goto(url);await expect(page.getByTestId('documents')).toBeVisible();await expect(page.getByRole('heading',{name:'Community garden continuity',exact:true})).toBeVisible();await expect(page.locator('textarea')).toBeVisible();}
async function idb(){return page.evaluate(async()=>{const db=await new Promise((ok,no)=>{const q=indexedDB.open('workagent-drafts',1);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});const rows=await new Promise((ok,no)=>{const q=db.transaction('documents').objectStore('documents').getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});db.close();return Promise.all(rows.map(async r=>({...r,bytes:undefined,actual_sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',r.bytes))).map(b=>b.toString(16).padStart(2,'0')).join(''),actual_length:r.bytes.byteLength})));});}
try{
 await open();
 if(phase==='baseline'){
  report.initial={conversation:await get('/conversations/'+cid),snapshot:await get('/work-snapshot?conversation_id='+cid),artifact:await get('/artifacts/'+aid),documents:await get('/conversations/'+cid+'/documents')};
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:900});
   for(const summary of await page.getByTestId('documents').locator('summary').all())if(!await summary.evaluate(e=>e.parentElement.open))await summary.click();
   await expect(page.getByTestId('document-text')).toHaveCount(3);
   const texts=await page.getByTestId('document-text').allTextContents();
   expect(texts.every(t=>t.length>0)).toBeTruthy();
   const body=await page.locator('body').innerText();expect(body).toContain('Earlier check-in');expect(body).toContain('Garden options — current human correction');expect(body).toContain('Stopped. Send a new message');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
   const draft='  Browser Unicode 雪\nline two ♪\n';await page.locator('textarea').fill(draft);await page.keyboard.press('End');await page.keyboard.type('!');expect(await page.locator('textarea').inputValue()).toContain('雪');
   await page.locator('textarea').fill('');await snap('conversation-'+width);check('readable same work/documents/current-v-history keyboard no-overflow',{width,texts});
  }
  for(const row of await page.getByTestId('documents').locator('[data-document]').all()){
   const id=await row.getAttribute('data-document');const meta=report.initial.documents.items.find(d=>d.document_id===id);
   const download=page.waitForEvent('download');await row.getByRole('button',{name:'Download original'}).click();const d=await download;const bytes=await fs.readFile(await d.path());expect(hash(bytes)).toBe(meta.sha256);check('browser original exact bytes',{document_id:id,sha256:hash(bytes),length:bytes.length});
   await fs.writeFile(root+'/.local/recovery5b/'+meta.filename,bytes);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('link',{name:'Open current table',exact:true}).click();await page.locator('#work-tab-edit').click();
  const notes=page.getByTestId('notes-list');const before=await get('/artifacts/'+aid);expect(await notes.locator('textarea').evaluateAll(es=>es.map(e=>e.value))).toEqual(before.current_revision.body.notes);
  await page.getByLabel('Row 1 Plant',{exact:true}).fill('Oak — browser correction 雪 '+new Date().toISOString());await page.getByRole('button',{name:'Save my edits',exact:true}).click();
  await expect.poll(async()=>(await get('/artifacts/'+aid)).current_revision_id).not.toBe(before.current_revision_id);
  report.after_edit=await get('/artifacts/'+aid);expect(report.after_edit.current_revision.body.notes).toEqual(before.current_revision.body.notes);check('browser cell edit retains exact terminal human note objects');
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await snap('editor-'+width);}
  await open();await page.getByTestId('document-picker').locator('input[type=file]').setInputFiles(root+'/.local/recovery5b/continuity.pdf');await expect(page.locator('[data-upload=local]')).toBeVisible();
  await expect.poll(async()=>(await idb()).length).toBe(1);const rows=await idb();expect(rows[0].sha256).toBe(rows[0].actual_sha256);expect(rows[0].actual_length).toBe(rows[0].byte_length);report.idb_staged=rows;check('actual IndexedDB binary staged; closing entire Chromium context/process');await snap('staged');
 }else if(phase==='restart'){
  await expect(page.locator('[data-upload=unknown]')).toBeVisible();report.idb_before=await idb();report.snapshot_before=await get('/work-snapshot?conversation_id='+cid);report.conversation_before=await get('/conversations/'+cid);
  const draft='  Retained browser draft during API restart 雪\nexact trailing newline\n';await page.locator('textarea').fill(draft);
  report.old_pid=3850164;execFileSync('python3',['-c',"from pathlib import Path;p=Path('/proc/3850164');assert (p/'cwd').resolve()==Path('"+root+"/backend');assert b'workagent.api:app' in (p/'cmdline').read_bytes();assert b'18965' in (p/'cmdline').read_bytes()"]);
  execFileSync('tmux',['kill-session','-t','b2r5a-api']);await page.waitForTimeout(8000);expect(await page.locator('textarea').inputValue()).toBe(draft);await snap('offline');
  execFileSync('tmux',['new-session','-d','-s','b2r5b-api','-c',root,"source .local/recovery5a/test.env; exec backend/.venv/bin/python .local/recovery5a/launch.py api > .local/recovery5b/api-restarted.log 2>&1"]);
  await expect.poll(async()=>{try{return (await get('/conversations/'+cid)).conversation.id}catch{return null}},{timeout:30000}).toBe(cid);
  report.new_pid=Number(execFileSync('tmux',['display-message','-p','-t','b2r5b-api','#{pane_pid}'],{encoding:'utf8'}).trim());expect(report.new_pid).not.toBe(report.old_pid);
  await page.waitForTimeout(10000);expect(await page.locator('textarea').inputValue()).toBe(draft);expect(await idb()).toEqual(report.idb_before);report.snapshot_after=await get('/work-snapshot?conversation_id='+cid);report.conversation_after=await get('/conversations/'+cid);expect(report.conversation_after).toEqual(report.conversation_before);report.cursor_replay=await get('/events?conversation_id='+cid+'&after='+encodeURIComponent(report.snapshot_before.snapshot_cursor));
  expect(report.requests.filter(r=>r.method==='POST')).toHaveLength(0);check('actual API PID restart with browser kept open retains exact draft/unknown bytes, no automatic writes, old current cursor still accepted');await snap('reconnected');
 }else if(phase==='review'){
  const seed=JSON.parse(await fs.readFile(root+'/docs/evidence/batch2-recovery5b/review-initial.json','utf8'));report.before=await get('/artifacts/'+aid);
  await page.goto(origin+'/conversations/'+cid+'/artifacts/'+aid+'?workspace='+ws);await page.locator('#work-tab-changes').click();
  const latest=page.getByRole('button',{name:'Apply proposed version',exact:true});await expect(latest).toBeDisabled();
  await page.getByText('1 earlier proposal for this version',{exact:true}).click();const earlier=page.getByRole('button',{name:'Apply this earlier version',exact:true});await expect(earlier).toBeDisabled();
  await page.getByRole('checkbox',{name:'Apply this earlier proposal instead of the latest one',exact:true}).check();await expect(earlier).toBeDisabled();check('older-candidate acknowledgement alone cannot accept removal');
  await page.getByRole('checkbox',{name:'Apply this earlier proposal instead of the latest one',exact:true}).uncheck();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await snap('consent-'+width);}
  const removals=page.getByRole('checkbox',{name:'I understand this removes or replaces the saved content above',exact:true});await removals.first().check();await expect(latest).toBeEnabled();await page.reload();await expect(latest).toBeDisabled();await expect(removals.first()).not.toBeChecked();check('consent resets on reload; never carried into a reopened review');
  await removals.first().check();await latest.click();await expect.poll(async()=>(await get('/artifacts/'+aid)).current_revision_id).not.toBe(report.before.current_revision_id);report.after=await get('/artifacts/'+aid);expect(report.after.current_revision.body.notes).toEqual(seed.notes);expect(report.after.current_revision.body.rows).toEqual(seed.body.rows);check('explicit browser title-replacement consent accepts latest proposal, human notes/cells preserved');await snap('accepted');
  await open();await expect(page.locator('body')).toContainText('Latest browser proposal retains human notes');await expect(page.locator('body')).toContainText('Earlier check-in');await expect(page.locator('body')).toContainText('outcome remains unverified');report.snapshot=await get('/work-snapshot?conversation_id='+cid);check('current accepted version visible without rewriting earlier observation or declaring goal done');await snap('current-history');
 }else if(phase==='controls'){
  report.before=await get('/conversations/'+cid);report.snapshot_before=await get('/work-snapshot?conversation_id='+cid);
  expect(report.before.runs.at(-1).state).toBe('queued');await expect(page.getByTestId('continue-run')).toHaveCount(0);check('new latest run hides old stopped checkpoint immediately after reread');
  report.preexisting_queue=await get('/conversations/'+cid+'/queued-messages');for(const row of await page.locator('[data-queued][data-state=pending]').all())await row.getByRole('button',{name:'Cancel this queued message',exact:true}).click();await expect(page.locator('[data-queued][data-state=pending]')).toHaveCount(0);
  const text='  Queue from browser 雪\nPreserve this exact later intent.\n';await page.locator('textarea').fill(text);await page.getByTestId('queue-later').click();
  await expect(page.locator('[data-queued][data-state=pending]')).toHaveCount(1);report.queue=await get('/conversations/'+cid+'/queued-messages');const q=report.queue.items.find(x=>x.state==='pending');expect(q.intent.text).toBe(text);expect((await get('/conversations/'+cid)).runs).toHaveLength(report.before.runs.length);check('Queue later exact intent creates no run and does not supersede');
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});await expect(page.getByTestId('stop-run')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await snap('queue-'+width);}
  await page.getByRole('button',{name:'Stop this run…',exact:true}).click();await expect(page.getByRole('button',{name:'Keep going',exact:true})).toBeVisible();expect((await get('/conversations/'+cid)).runs.at(-1).state).toBe('queued');
  await page.getByRole('button',{name:'Stop this run',exact:true}).click();await expect.poll(async()=>(await get('/conversations/'+cid)).runs.at(-1).state).toBe('cancelled');report.after_stop=await get('/conversations/'+cid);expect(report.after_stop.conversation.state).toBe('open');expect((await get('/conversations/'+cid+'/queued-messages')).items.find(x=>x.id===q.id).state).toBe('pending');check('STOP requires explicit confirm, affects exact run not queue/conversation');
  await expect(page.getByTestId('continue-blocked')).toContainText('Stopped. Send a new message');await page.getByRole('button',{name:'Cancel this queued message',exact:true}).click();await expect.poll(async()=>(await get('/conversations/'+cid+'/queued-messages')).items.find(x=>x.id===q.id).state).toBe('cancelled');check('queue cancellation independent canonical readback');
  if(await page.getByRole('button',{name:'Mark as seen',exact:true}).count())await page.getByRole('button',{name:'Mark as seen',exact:true}).click();await expect(page.getByRole('button',{name:'Mark as seen',exact:true})).toHaveCount(0);check('browser Mark seen clears attention without proposal acceptance');
  report.final={conversation:await get('/conversations/'+cid),snapshot:await get('/work-snapshot?conversation_id='+cid),queue:await get('/conversations/'+cid+'/queued-messages'),checkpoints:await get('/conversations/'+cid+'/checkpoints'),artifact:await get('/artifacts/'+aid)};
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await snap('stopped-'+width);}
 }else if(phase==='stage'){
  await page.getByTestId('document-picker').locator('input[type=file]').setInputFiles(root+'/.local/recovery5b/continuity.pdf');await expect(page.locator('[data-upload=local]')).toBeVisible();
  await expect.poll(async()=>(await idb()).length).toBe(1);const rows=await idb();expect(rows[0].sha256).toBe(rows[0].actual_sha256);report.idb_staged=rows;await fs.writeFile(out+'/baseline.json',JSON.stringify(report,null,2));check('actual IndexedDB binary staged, closing process');await snap('local');
 }else if(phase==='unknown'){
  await expect(page.locator('[data-upload=local]')).toBeVisible();const rows=await idb();const prior=JSON.parse(await fs.readFile(out+'/baseline.json','utf8'));expect(rows).toEqual(prior.idb_staged);check('binary exact after process close/reopen',{rows});
  await page.goto(origin+'/conversations/83c35686-6645-4866-be46-c0d5ea929e24?workspace='+ws);await expect(page.locator('body')).toContainText(/unavailable|permission|access|not found/i);await expect(page.locator('[data-upload]')).toHaveCount(0);await snap('revoked-scope');check('revoked conversation does not display original draft');
  await open();await expect(page.locator('[data-upload=local]')).toBeVisible();
  let fault;
  await page.route('**/conversations/'+cid+'/documents',async route=>{
   if(route.request().method()!=='POST')return route.fallback();
   const payload=route.request().postData();const r=await route.fetch();fault={payload,sha256:hash(payload),status:r.status(),response:await r.text()};await fs.writeFile(out+'/upload-committed-lost-ack.json',JSON.stringify(fault,null,2));await route.abort('connectionreset');
  });
  await page.locator('textarea').fill('Retain and reread the attached PDF; no model evaluation claim.');
  await page.locator('textarea').press('Control+Enter');
  await expect.poll(()=>Boolean(fault),{timeout:60000}).toBeTruthy();await expect(page.locator('[data-upload=unknown]')).toBeVisible();
  report.idb_unknown=await idb();expect(report.idb_unknown[0].upload.command_id).toBe(JSON.parse(fault.payload).command_id);report.documents_after_commit=await get('/conversations/'+cid+'/documents');check('real upload committed then browser ACK deliberately dropped; frozen upload identity retained');await snap('unknown');
 }else if(phase==='replay'){
  await expect(page.locator('[data-upload=unknown]')).toBeVisible();const before=await get('/conversations/'+cid);const rows=await idb();const old=JSON.parse(await fs.readFile(out+'/unknown.json','utf8'));expect(rows).toEqual(old.idb_unknown);check('unknown identity and bytes survive second browser process restart');
  await page.waitForTimeout(2000);expect(report.requests.filter(r=>r.method==='POST')).toHaveLength(0);check('reopen does not automatically resend');
  let replay;
  await page.route('**/conversations/'+cid+'/documents',async route=>{if(route.request().method()!=='POST')return route.fallback();const payload=route.request().postData();const r=await route.fetch();replay={payload,sha256:hash(payload),status:r.status(),response:await r.text()};await route.fulfill({response:r});});
  const messageText='  Browser exact Send 雪\nRetain the attached PDF.\n';await page.locator('textarea').fill(messageText);
  await page.locator('textarea').press('Control+Enter');await expect.poll(()=>Boolean(replay),{timeout:60000}).toBeTruthy();
  const first=JSON.parse(await fs.readFile(out+'/upload-committed-lost-ack.json','utf8'));expect(replay.payload).toBe(first.payload);report.replay=replay;expect(JSON.parse(replay.response)).toEqual(JSON.parse(first.response));report.response_bytes_equal=replay.response===first.response;
  await expect.poll(async()=>(await get('/conversations/'+cid)).messages.length,{timeout:60000}).toBe(before.messages.length+1);report.after=await get('/conversations/'+cid);report.documents_after=await get('/conversations/'+cid+'/documents');expect(report.documents_after.items).toHaveLength(old.documents_after_commit.items.length);
  expect(report.after.messages.at(-1).text).toBe(messageText);check('new browser Send preserves exact leading spaces, Unicode and trailing newline');await expect(page.getByTestId('message-documents').last()).toBeVisible();await expect.poll(async()=>(await idb()).length).toBe(0);check('explicit byte-identical upload replay, one message, no duplicate document, refs visible, sent generation removed');await snap('message-refs');
 }
 expect(report.errors).toEqual([]);report.status='PASS';
}catch(e){report.status='FAIL';report.failure=String(e.stack||e);await snap('failure').catch(()=>{});process.exitCode=1;}
finally{report.finished=new Date().toISOString();await fs.writeFile(out+'/'+phase+'.json',JSON.stringify(report,null,2));await ctx.close();console.log(JSON.stringify({phase,status:report.status,checks:report.checks.map(c=>c.name),failure:report.failure},null,2));}
