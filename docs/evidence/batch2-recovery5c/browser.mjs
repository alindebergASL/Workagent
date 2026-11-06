import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),require=createRequire(root+'/web/package.json');
const {chromium,expect:baseExpect}=require('@playwright/test'),expect=baseExpect.configure({timeout:15000});
const out=root+'/docs/evidence/batch2-recovery5c',phase=process.argv[2],run=process.env.RUN||phase;
const f=JSON.parse(await fs.readFile(out+'/fixture.json','utf8')),ws=f.workspace,origin='http://127.0.0.1:3195',base=origin+'/api/domain/v1/workspaces/'+ws;
const report={phase,started:new Date().toISOString(),checks:[],reads:[],posts:[],errors:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
const ctx=await chromium.launchPersistentContext(root+'/.local/recovery5c/browser-profile',{headless:true,args:['--no-sandbox'],viewport:{width:1440,height:1000}});
const page=ctx.pages()[0];
await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
page.on('pageerror',e=>report.errors.push(e.message));
page.on('request',r=>{if(r.method()==='POST')report.posts.push({path:new URL(r.url()).pathname,payload:r.postData()});});
const save=async(name,data)=>fs.writeFile(out+'/'+run+'-'+name+'.json',JSON.stringify(data,null,2),{flag:'wx'});
const get=async path=>{const r=await fetch(base+path,{headers:{'X-Workagent-Client':'local-ui'}});const body=await r.json();report.reads.push({path,status:r.status,body});expect(r.status).toBe(200);return body};
const snap=async name=>{await page.screenshot({path:out+'/'+run+'-'+name+'.png',fullPage:true});await fs.writeFile(out+'/'+run+'-'+name+'.txt',await page.locator('body').innerText(),{flag:'wx'});};
const open=async(name,tab)=>{const x=f.items[name];await page.goto(origin+'/conversations/'+x.conversation+'/artifacts/'+x.artifact+'?workspace='+ws);await page.locator('#work-tab-'+tab).click();return x;};
const seed=mode=>execFileSync(root+'/backend/.venv/bin/python',[out+'/fixture.py',mode],{cwd:root,env:process.env});
try{
 if(phase==='notes'){
  for(const name of ['five','ten']){
   const x=await open(name,'edit'),notes=page.getByTestId('notes-list').locator('textarea');
   await expect(notes).toHaveCount(x.body.notes.length);
   expect(await notes.evaluateAll(es=>es.map(e=>e.value))).toEqual(x.body.notes);
   let before=await get('/artifacts/'+x.artifact);expect(before.current_revision.body.notes).toEqual(x.body.notes);
   // Unchanged editor correctly has no Save action. Retyping identical bytes is a no-op.
   await notes.first().fill(x.body.notes[0]+'x');await notes.first().fill(x.body.notes[0]);
   await expect(page.getByRole('button',{name:'Save my edits',exact:true})).toHaveCount(0);
   let after=await get('/artifacts/'+x.artifact);expect(after.current_revision).toEqual(before.current_revision);
   report.checks.push(name+': unchanged retype is a UI no-op, not a fabricated save');
   await save(name+'-unchanged',{before,after,note_hashes:x.body.notes.map(hash),objects:x.body.notes.length,displayed_lines:x.body.notes.join('\n').split('\n').length});
   before=after;
   await page.getByLabel('Row 1 Plant',{exact:true}).fill('Cell-only correction 雪 '+name+' '+run);
   await page.getByRole('button',{name:'Save my edits',exact:true}).click();
   await expect.poll(async()=>(await get('/artifacts/'+x.artifact)).current_revision_id).not.toBe(before.current_revision_id);
   after=await get('/artifacts/'+x.artifact);expect(after.current_revision.body.notes).toEqual(x.body.notes);
   expect(after.current_revision.body.rows[0].cells[0].value).toBe('Cell-only correction 雪 '+name+' '+run);
   await save(name+'-cell-only',{before,after,note_hashes:after.current_revision.body.notes.map(hash)});
   if(name==='ten'){
    const add=page.getByRole('button',{name:'Add a note',exact:true});await expect(add).toBeDisabled();
    expect(await notes.evaluateAll(es=>es.map(e=>e.value))).toEqual(x.body.notes);
    report.checks.push('Ten objects valid; eleventh add disabled; duplicate/blank/trailing bytes retained');
   }
   for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await snap(name+'-'+width);}
   await page.reload();await expect(notes).toHaveCount(x.body.notes.length);expect(await notes.evaluateAll(es=>es.map(e=>e.value))).toEqual(x.body.notes);
   report.checks.push(name+': unchanged UI no-op, actual cell-only save and reload exact object/string order');
  }
 }else if(phase==='review'){
  const x=await open('removals','changes');const props=await get('/artifacts/'+x.artifact+'/proposals');report.initial_proposals=props;
  const p=props.items.find(p=>p.id===x.proposal);expect(p.review.removed_content_count).toBe(26);expect(p.review.removed_content.length).toBe(20);report.truncation={total:26,server_sample:20,omitted:6};
  const apply=page.getByRole('button',{name:'Apply proposed version',exact:true});const ack=page.getByRole('checkbox',{name:'I understand this removes or replaces the saved content above',exact:true});
  await expect(apply).toBeDisabled();await snap('unconsented');
  await ack.first().check();await expect(apply).toBeEnabled();await snap('consented-original');
  seed('newer');await get('/artifacts/'+x.artifact+'/proposals');
  // Artifact resource intentionally refreshes on focus, not a timer. Keep the review mounted.
  const other=await ctx.newPage();await other.goto(origin);await other.bringToFront();await page.bringToFront();await other.close();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus'))); // exercise the production focus refresh handler
  await expect(ack.first()).not.toBeChecked({timeout:30000});await expect(apply).toBeDisabled();report.checks.push('Newer candidate arrives during open browser review; exact-review consent resets');await snap('newer-reset');
  await ack.first().check();await expect(apply).toBeEnabled();
  // Hold the actual browser accept request; change saved base before dispatching it.
  let stale;
  await page.route('**/proposals/*/accept',async route=>{seed('stale');const response=await route.fetch();stale={payload:route.request().postDataJSON(),status:response.status(),body:await response.json()};await route.fulfill({response});});
  await apply.click();await expect.poll(()=>Boolean(stale)).toBeTruthy();report.stale=stale;expect(stale.status).toBe(409);
  const after=await get('/artifacts/'+x.artifact);expect(after.current_revision.body.rows).toHaveLength(26);expect(after.current_revision.body.notes).toEqual(['Human concurrent correction: keep exact base fence.']);report.checks.push('Actual browser consent-bearing stale-base POST rejected409; all26 rows retained');await snap('stale-refused');
 }
 report.status='PASS';
}catch(e){report.status='FAIL';report.failure=String(e.stack||e);process.exitCode=1;await snap('failure').catch(()=>{});}
finally{report.finished=new Date().toISOString();await save('report',report);await ctx.close();console.log(JSON.stringify({status:report.status,checks:report.checks,failure:report.failure},null,2));}
