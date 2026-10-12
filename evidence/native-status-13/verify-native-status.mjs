import assert from 'node:assert/strict';import{createRequire}from'node:module';import{mkdir,writeFile}from'node:fs/promises';
const root='/home/ubuntu/workagent-flexible-work';const require=createRequire(root+'/web/package.json');const{chromium,expect}=require('@playwright/test');
const origin=process.env.WORKAGENT_WEB_ORIGIN||'http://127.0.0.1:3167',out=process.argv[2];assert(out);await mkdir(out,{recursive:true});
const cid='cf457e1d-0590-4dea-9287-279413eefa9c',aid='54f1ff77-d3c1-43f1-8416-69338e415089',base=origin+'/api/domain/v1/workspaces/flexible-proof';
async function get(p){const r=await fetch(base+p,{headers:{'X-Workagent-Client':'local-ui'}});assert.equal(r.status,200);return r.json();}
const before=await get('/artifacts/'+aid),conversation=await get('/conversations/'+cid),proposals=await get(`/artifacts/${aid}/proposals`);
const history=await get(`/artifacts/${aid}/history`),accepted=history.items.find(r=>r.id==='cd06942f-1a32-409a-b186-13900632970c');assert(accepted);assert.equal(accepted.body_hash,'aae632c58fe85550e12acb53419254dece7c841d5d1fb4026792a2775f71a41a');assert.deepEqual(before.current_revision.body.blocks.find(b=>b.block_id==='human-context'),accepted.body.blocks.find(b=>b.block_id==='human-context'));
assert.equal(conversation.runs.length,2);assert.equal(proposals.items[0].status,'accepted');
const checks=[],errors=[],writes=[];const browser=await chromium.launch({headless:true});
try{
 for(const[name,width,height]of[['desktop',1440,1000],['phone',390,844],['narrow-phone',320,844]]){
  const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push({url:r.url(),method:r.method()});});
  await page.goto(`${origin}/conversations/${cid}/artifacts/${aid}`);await expect(page.getByRole('textbox',{name:'Paragraph human-context',exact:true})).toHaveValue(before.current_revision.body.blocks.find(b=>b.block_id==='human-context').text);await expect(page.getByRole('button',{name:'Apply proposed version',exact:true})).toHaveCount(0);
  if(name!=='desktop')await page.getByRole('button',{name:'Conversation',exact:true}).click();
  const panels=page.locator('details').filter({has:page.getByText('How this ran',{exact:true})});await expect(panels).toHaveCount(2);
  for(let i=0;i<2;i++){
   const panel=panels.nth(i);await panel.locator('summary').first().click();await expect(panel).toContainText('No model examples were run for this step.');await expect(panel).not.toContainText('Model examples did not pass');await expect(panel).not.toContainText('Requested result verified');
  }
  await panels.first().scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${name}-corrected-details.png`});
  await expect(page.getByPlaceholder('Reply about this work…')).toBeVisible();assert(!((await page.locator('body').innerText()).includes('Changed approach after a failed check')));
  const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(dims.scroll<=dims.width+2);
  await page.getByRole('link',{name:'Agent',exact:true}).click();await page.getByRole('link',{name:'Conversations',exact:true}).click();await page.locator(`a[href="/conversations/${cid}"]`).first().click();await page.locator(`a[href="/conversations/${cid}/artifacts/${aid}"]`).first().click();await expect(page.getByRole('textbox',{name:'Paragraph human-context',exact:true})).toHaveValue(before.current_revision.body.blocks.find(b=>b.block_id==='human-context').text);
  checks.push({viewport:name,correct_none_wording_for_both_actual_turns:true,no_false_failure_or_completion:true,accepted_history_and_exact_current_human_note:true,newer_human_edits_preserved:true,no_apply_button:true,home_reopen:true,reply_visible:true,overflow:dims.scroll-dims.width});await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual((await get('/artifacts/'+aid)).current_revision,before.current_revision);assert.deepEqual((await get(`/artifacts/${aid}/proposals`)).items,proposals.items);const after=await get('/conversations/'+cid);assert.deepEqual(after.messages,conversation.messages);assert.deepEqual(after.runs,conversation.runs);
 const result={application_sha:'5acc6e521766f3b830dea3f47b3c611056370be4',owner_commit:'edb09db466d3f636818b439c4e2102f9bb3d33f7',origin,checks,errors,writes,provider_calls:0,saved_state_unchanged:true,current_revision:before.current_revision_id,current_hash:before.current_revision.body_hash,accepted_revision:accepted.id,accepted_hash:accepted.body_hash};await writeFile(out+'/verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
