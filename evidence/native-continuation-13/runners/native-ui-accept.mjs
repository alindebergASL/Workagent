import assert from 'node:assert/strict';import{createRequire}from'node:module';import{readFile,writeFile}from'node:fs/promises';
const root='/home/ubuntu/workagent-flexible-work',out=root+'/.local/general-continuation-native-02';const require=createRequire(root+'/web/package.json');const{chromium,expect}=require('@playwright/test');const origin='http://127.0.0.1:3166',cid='cf457e1d-0590-4dea-9287-279413eefa9c',aid='54f1ff77-d3c1-43f1-8416-69338e415089',pid='aced3518-25c1-4cd7-a152-efa2c56ab2b7';
const base=origin+'/api/domain/v1/workspaces/flexible-proof';const get=async p=>{const r=await fetch(base+p,{headers:{'X-Workagent-Client':'local-ui'}});assert.equal(r.status,200);return r.json();};
const human=JSON.parse(await readFile(out+'/human-saved.json','utf8')),brief=JSON.parse(await readFile(root+'/.local/native-continuation-brief.json','utf8'));const proposal=(await get(`/artifacts/${aid}/proposals`)).items.find(p=>p.id===pid);assert.equal(proposal.status,'pending');assert.equal(proposal.base_revision_id,human.current_revision_id);
const protectedBefore=human.current_revision.body.blocks.find(b=>b.block_id==='human-context');assert.deepEqual(proposal.body.blocks.find(b=>b.block_id==='human-context'),protectedBefore);assert(protectedBefore.text.includes(brief.human_note));
await writeFile(out+'/accept.started.json',JSON.stringify({proposal_id:pid,base_revision:proposal.base_revision_id,proposal_body_hash:proposal.body_hash,synthetic_acceptance_authorized:true}),{flag:'wx'});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(`${origin}/conversations/${cid}/artifacts/${aid}`);await expect(page.getByRole('button',{name:'Apply proposed version',exact:true})).toBeVisible();
 await page.getByText('See the proposed version',{exact:true}).click();const review=page.locator('details').filter({has:page.getByText('See the proposed version',{exact:true})});await expect(review).toHaveCount(1);
 for(const text of ['40 minutes','two 25-minute tours require 50 minutes','Priya is a proposal','15:45–16:00',brief.human_note])await expect(review).toContainText(text);
 await page.screenshot({path:out+'/03-review-proposed-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Apply proposed version',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/04-pending-phone.png'});
 const response=page.waitForResponse(r=>r.url().endsWith(`/proposals/${pid}/accept`));await page.getByRole('button',{name:'Apply proposed version',exact:true}).click();const r=await response;assert.equal(r.status(),200,await r.text());
 await expect(page.getByRole('button',{name:'Apply proposed version',exact:true})).toHaveCount(0);
 const accepted=await get('/artifacts/'+aid),after=(await get(`/artifacts/${aid}/proposals`)).items.find(p=>p.id===pid);
 assert.equal(after.status,'accepted');assert.equal(after.accepted_revision_id,accepted.current_revision_id);assert.notEqual(accepted.current_revision_id,human.current_revision_id);assert.deepEqual(accepted.current_revision.body,proposal.body);assert.equal(accepted.current_revision.body_hash,proposal.body_hash);assert.deepEqual(accepted.current_revision.body.blocks.find(b=>b.block_id==='human-context'),protectedBefore);
 await writeFile(out+'/accepted.json',JSON.stringify({artifact:accepted,proposal:after,accept_http_status:r.status(),accepted_via:'trusted Apply proposed version button, phone viewport',exact_human_block_preserved:true},null,2)+'\n',{flag:'wx'});
 await page.getByRole('textbox',{name:'Paragraph overview',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/05-accepted-phone.png'});
 await page.getByRole('link',{name:'Agent',exact:true}).click();await expect(page).toHaveURL(origin+'/');
 // Find the work from the ordinary conversation list, not a forged deep link.
 await page.getByRole('link',{name:'Conversations',exact:true}).click();await page.locator(`a[href="/conversations/${cid}"]`).first().click();
 await page.locator(`a[href="/conversations/${cid}/artifacts/${aid}"]`).first().click();
 await expect(page.getByRole('textbox',{name:'Paragraph human-context',exact:true})).toHaveValue(protectedBefore.text);await expect(page.getByRole('textbox',{name:'Paragraph revision-summary',exact:true})).toHaveValue(proposal.body.blocks.find(b=>b.block_id==='revision-summary').text);
 await page.getByRole('textbox',{name:'Paragraph overview',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/06-reopened-before-restart.png'});
 console.log(JSON.stringify({artifact_id:aid,proposal_id:pid,accepted_revision:accepted.current_revision_id,body_hash:accepted.current_revision.body_hash,exact_human_block_preserved:true,home_conversations_reopen:true}));
}finally{await browser.close();}
