import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile,writeFile} from 'node:fs/promises';
const root='/home/ubuntu/workagent-flexible-work',out=root+'/.local/general-continuation-native-02';const require=createRequire(root+'/web/package.json');const{chromium,expect}=require('@playwright/test');
const brief=JSON.parse(await readFile(root+'/.local/native-continuation-brief.json','utf8'));
const origin='http://127.0.0.1:3166',cid='cf457e1d-0590-4dea-9287-279413eefa9c',aid='54f1ff77-d3c1-43f1-8416-69338e415089';
const base=origin+'/api/domain/v1/workspaces/flexible-proof';const get=async p=>{const r=await fetch(base+p,{headers:{'X-Workagent-Client':'local-ui'}});assert.equal(r.status,200);return r.json();};
const before=await get('/artifacts/'+aid);const expected=structuredClone(before.current_revision.body);const block=expected.blocks.find(x=>x.block_id==='human-context');assert.equal(block.kind,'protected_note');block.text+='\n'+brief.human_note;
await writeFile(out+'/human-edit.started.json',JSON.stringify({base_revision:before.current_revision_id,field:block.block_id,before:before.current_revision.body.blocks.find(x=>x.block_id===block.block_id).text,after:block.text}),{flag:'wx'});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(`${origin}/conversations/${cid}/artifacts/${aid}`);
 await expect(page.getByRole('textbox',{name:'Paragraph human-context',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Paragraph human-context',exact:true}).fill(block.text);
 await page.getByRole('button',{name:'Save my edits',exact:true}).click();
 await expect(page.getByText('Your edits are saved.',{exact:true})).toBeVisible();
 const saved=await get('/artifacts/'+aid);assert.notEqual(saved.current_revision_id,before.current_revision_id);assert.equal(saved.current_revision.author_kind,'human');assert.deepEqual(saved.current_revision.body,expected);
 await writeFile(out+'/human-saved.json',JSON.stringify(saved,null,2)+'\n',{flag:'wx'});await page.screenshot({path:out+'/02-human-edit-saved.png',fullPage:true});
 let posts=0;const target={artifact_id:aid,revision_id:saved.current_revision_id,body_hash:saved.current_revision.body_hash};
 await writeFile(out+'/followup.started.json',JSON.stringify({text:brief.followup,target}),{flag:'wx'});
 await page.route('**/conversations/*/messages',async route=>{posts++;const body=route.request().postDataJSON();assert.equal(posts,1);assert.equal(body.text,brief.followup);assert.deepEqual(body.target,target);assert.equal(body.operation??null,null);await writeFile(out+'/followup-ui-request.json',JSON.stringify(body,null,2)+'\n',{flag:'wx'});await route.continue();});
 await page.getByPlaceholder('Reply about this work…').fill(brief.followup);const response=page.waitForResponse(r=>r.url().endsWith('/messages'));await page.getByRole('button',{name:'Send',exact:true}).click();const r=await response;assert.equal(r.status(),202,await r.text());const receipt=await r.json();assert.deepEqual(receipt.message.target,target);
 await writeFile(out+'/followup.queued.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({human_revision:saved.current_revision_id,human_body_hash:saved.current_revision.body_hash,note_exact:true,all_other_blocks_exact:true,followup_run:receipt.run.id,target:receipt.message.target,status:r.status(),posts}));
}finally{await browser.close();}
