import assert from 'node:assert/strict';import{createRequire}from'node:module';import{readFile,writeFile}from'node:fs/promises';
const root='/home/ubuntu/workagent-flexible-work',out=root+'/.local/general-continuation-native-02';const require=createRequire(root+'/web/package.json');const{chromium,expect}=require('@playwright/test');const origin='http://127.0.0.1:3166',cid='cf457e1d-0590-4dea-9287-279413eefa9c',aid='54f1ff77-d3c1-43f1-8416-69338e415089';
const accepted=JSON.parse(await readFile(out+'/accepted.json','utf8'));const rev=accepted.artifact.current_revision,base=origin+'/api/domain/v1/workspaces/flexible-proof';const get=async p=>{const r=await fetch(base+p,{headers:{'X-Workagent-Client':'local-ui'}});assert.equal(r.status,200);return r.json();};
const after=await get('/artifacts/'+aid),proposals=await get(`/artifacts/${aid}/proposals`);assert.deepEqual(after.current_revision,rev);assert.equal(after.current_revision_id,accepted.proposal.accepted_revision_id);assert.deepEqual(proposals.items.find(p=>p.id===accepted.proposal.id),accepted.proposal);
const checks=[],errors=[],writes=[];const browser=await chromium.launch({headless:true});
try{
 for(const [name,width,height] of [['desktop',1440,1000],['phone',390,844],['narrow-phone',320,844]]){
  const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push({viewport:name,message:e.message}));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push({method:r.method(),url:r.url()});});
  await page.goto(origin);await page.getByRole('link',{name:'Conversations',exact:true}).click();await page.locator(`a[href="/conversations/${cid}"]`).first().click();await page.locator(`a[href="/conversations/${cid}/artifacts/${aid}"]`).first().click();
  await expect(page.getByRole('textbox',{name:'Paragraph overview',exact:true})).toHaveValue(rev.body.blocks.find(b=>b.block_id==='overview').text);
  await expect(page.getByRole('textbox',{name:'Paragraph revision-summary',exact:true})).toHaveValue(rev.body.blocks.find(b=>b.block_id==='revision-summary').text);
  await expect(page.getByRole('textbox',{name:'Paragraph human-context',exact:true})).toHaveValue(rev.body.blocks.find(b=>b.block_id==='human-context').text);
  await expect(page.getByRole('button',{name:'Apply proposed version',exact:true})).toHaveCount(0);
  await page.getByRole('textbox',{name:'Paragraph overview',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/07-restarted-${name}-result.png`});
  await page.getByRole('textbox',{name:'Paragraph human-context',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/08-restarted-${name}-human-note.png`});
  const dimensions=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert(dimensions.scrollWidth<=dimensions.width+2);
  if(name!=='desktop')await page.getByRole('button',{name:'Conversation',exact:true}).click();await expect(page.getByPlaceholder('Reply about this work…')).toBeVisible();
  await page.screenshot({path:`${out}/09-restarted-${name}-continue.png`});
  checks.push({viewport:name,width,height,fresh_browser_context:true,home_conversations_work_navigation:true,exact_accepted_revision_displayed:true,exact_human_block_preserved:true,pending_acceptance_control_absent:true,ordinary_continuation_visible:true,horizontal_overflow:dimensions.scrollWidth-dimensions.width});await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);const final=await get('/artifacts/'+aid);assert.deepEqual(final.current_revision,rev);
 const verification={application_sha:'4186d337a5d3b225fc257dda02b9d18bb10ab63e',build_id:'iaKQHcHGIn8V1TbkNONjy',api_before_pid:2902280,web_before_pid:2902304,api_after_pid:2913266,web_after_pid:2913290,provider_consumer_restarted:false,artifact_id:aid,accepted_proposal_id:accepted.proposal.id,accepted_revision_id:final.current_revision_id,accepted_body_hash:rev.body_hash,checks,errors,writes,provider_calls_by_verifier:0,read_only_review_url:`${origin}/conversations/${cid}/artifacts/${aid}`,review_location_scope:'host loopback only; no public deployment; consumer stopped; APIs/UI kept running',goal_state:'accepted editable work; staffing/access decisions remain unresolved; no automatic goal verification'};
 await writeFile(out+'/restart-verification.json',JSON.stringify(verification,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(verification));
}finally{await browser.close();}
