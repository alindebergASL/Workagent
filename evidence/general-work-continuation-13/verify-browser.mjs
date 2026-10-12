import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root='/home/ubuntu/workagent-flexible-work';
const require=createRequire(root+'/web/package.json');
const {chromium,expect}=require('@playwright/test');
const origin='http://127.0.0.1:3164',cid='43ff87f2-7f31-4b38-be48-c811b9e10bcd';
const docId='ae6b9019-9af6-4bb9-a0b1-a67234f7cffe',viewId='85a3c800-5e03-43da-8412-41e62210deab';
const out=root+'/.local/general-continuation-browser';await mkdir(out,{recursive:true});
const note='Human note: keep the entrance clear for wheelchair access; do not remove this reminder.';
async function api(p){const r=await fetch(`${origin}/api/domain/v1/workspaces/flexible-proof/${p}`,{headers:{'X-Workagent-Client':'local-ui'}});assert.equal(r.status,200);return r.json();}
const before=await Promise.all([api('artifacts/'+docId),api('artifacts/'+viewId),api('conversations/'+cid)]);
const saved=JSON.parse(await readFile(root+'/.local/general-continuation-execution-01/note.saved.json','utf8'));
assert.equal(before[0].current_revision_id,saved.revision_id);assert.deepEqual(before[0].current_revision.body,saved.body);
assert(before[0].current_revision.body.blocks.some(b=>b.text.includes(note)));
assert.deepEqual(before[1].current_revision.body.bindings,[{name:'original',artifact_id:docId,revision_id:saved.revision_id,body_hash:saved.body_hash}]);
const writes=[],errors=[],reads=[],checks=[];let label='';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method())&&!r.url().endsWith('/view-actions'))writes.push({method:r.method(),url:r.url()});});
 page.on('response',r=>{if(r.url().endsWith('/view-actions'))reads.push({label,status:r.status()});});
 async function openView(action){label=action;const response=page.waitForResponse(r=>r.url().endsWith('/view-actions'));await page.goto(`${origin}/conversations/${cid}/artifacts/${viewId}`);assert.equal((await response).status(),200);const f=page.frameLocator('iframe');await expect(f.locator('#status')).toContainText('Exact saved revision loaded');return f;}
 for(const [name,width,height] of [['desktop',1440,1000],['phone',390,844],['narrow-phone',320,844]]){
  await page.setViewportSize({width,height});const f=await openView(name+':open');
  await expect(f.locator('#original')).toContainText(note);
  await expect(f.locator('body')).toContainText('This is a proposal, not an accepted revision.');
  await expect(f.locator('body')).toContainText('11:45–12:00 — Protected pack-up');
  await expect(f.locator('body')).toContainText('11:00–11:30 — Repair slot 2');
  await page.screenshot({path:`${out}/${name}-decision-first.png`,fullPage:true});
  await f.locator('#original').getByText(note,{exact:false}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${name}-human-note.png`,fullPage:true});
  await f.locator('#notes').fill('QA temporary note — deliberately not saved');
  const shell=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  const frame=page.frames().find(fr=>fr!==page.mainFrame());
  const inner=await frame.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  // Record real overflow rather than silently truncating or forcing a PASS.
  const overflow={shell:Math.max(0,shell.scrollWidth-shell.width),frame:Math.max(0,inner.scrollWidth-inner.width)};
  await page.getByRole('link',{name:'Agent',exact:true}).click();await expect(page).toHaveURL(origin+'/');
  const reopened=await openView(name+':reopen');await expect(reopened.locator('#original')).toContainText(note);await expect(reopened.locator('#notes')).toHaveValue('');
  await page.goto(`${origin}/conversations/${cid}/artifacts/${docId}`);
  await expect(page.getByRole('textbox',{name:'Paragraph human-notes',exact:true})).toHaveValue(saved.body.blocks.find(b=>b.block_id==='human-notes').text);
  await expect(page.getByRole('textbox',{name:'Paragraph schedule',exact:true})).toHaveValue(saved.body.blocks.find(b=>b.block_id==='schedule').text);
  if(name!=='desktop'){await page.getByRole('button',{name:'Conversation',exact:true}).click();}
  await expect(page.getByPlaceholder('Reply about this work…')).toBeVisible();
  checks.push({viewport:name,exact_bound_note_rendered:true,proposed_schedule_separate_from_saved_document:true,home_and_reopen:true,temporary_notes_lost_as_labeled:true,saved_document_unchanged:true,steering_visible:true,overflow});
 }
 const after=await Promise.all([api('artifacts/'+docId),api('artifacts/'+viewId),api('conversations/'+cid)]);
 for(let i=0;i<2;i++){assert.deepEqual(after[i].current_revision,before[i].current_revision);}
 assert.deepEqual(after[2].messages,before[2].messages);assert.deepEqual(after[2].runs,before[2].runs);
 assert.equal(reads.length,6);assert.equal(new Set(reads.map(r=>r.label)).size,6);assert(reads.every(r=>r.status===200));assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 await writeFile(out+'/verification.json',JSON.stringify({application_sha:'dd01cd49a9b026edf8a99281d182e0554d54f4e2',mode:'real production UI over fresh live artifacts; read-only verification',natural_admission_build_flag:false,conversation_id:cid,document:{id:docId,revision:saved.revision_id,hash:saved.body_hash},view:{id:viewId,revision:before[1].current_revision_id,hash:before[1].current_revision.body_hash},checks,reads,writes,errors,provider_calls_by_verifier:0,model_followup_target:before[2].messages.filter(m=>m.author_kind==='human').at(-1).target,canonical_proposals_created:false,verdict:'interaction observations only; not complete editable-continuation PASS'},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,reads:reads.length,writes:writes.length,errors,overflow:checks.map(x=>({viewport:x.viewport,...x.overflow}))}));
}finally{await browser.close();}
