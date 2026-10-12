#!/usr/bin/env node
// Production-browser preflight: refuse a missing/stale native target BEFORE
// admission. Only a separately prepared synthetic fixture may use this check.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'web/package.json'));
const {chromium,expect}=require('@playwright/test');
const [fixturePath,out]=process.argv.slice(2);
assert(fixturePath&&out,'Usage: verify_native_target.mjs fixture.json result.json');
const f=JSON.parse(await readFile(fixturePath,'utf8'));
assert.equal(f.fixture_origin,'controlled native-admission preflight');
const origin=process.env.WORKAGENT_WEB_ORIGIN;
assert(origin&&new URL(origin).hostname==='127.0.0.1','Loopback synthetic preflight only');
const headers={'X-Workagent-Client':'local-ui'};
const base=`${origin}/api/domain/v1/workspaces/${f.workspace_id}`;
async function get(p){const r=await fetch(base+p,{headers});assert.equal(r.status,200);return r.json();}
const before=await get(`/artifacts/${f.artifact_id}`);
const target={artifact_id:before.id,revision_id:before.current_revision_id,body_hash:before.current_revision.body_hash};
assert.deepEqual(target,f.target);
let blocked=false,posts=0,request=null,status=null;
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.route('**/conversations/*/messages',async route=>{
  posts++;request=route.request().postDataJSON();
  try{assert.deepEqual(request.target,target);assert.equal(request.operation??null,null);}
  catch{blocked=true;await route.abort('blockedbyclient');return;}
  await route.continue();
 });
 await page.goto(origin+f.url);
 await expect(page.getByPlaceholder('Reply about this work…')).toBeVisible();
 await page.getByPlaceholder('Reply about this work…').fill('Clarify the wording of this saved work and preserve my note.');
 const observed=page.waitForEvent('requestfinished',{predicate:r=>r.url().endsWith('/messages')}).then(async r=>{status=(await r.response()).status();}).catch(()=>{});
 // The rejected request path does not dispatch or retry an admission.
 await page.getByRole('button',{name:'Send',exact:true}).click();
 for(let n=0;n<100&&!blocked&&status===null;n++)await page.waitForTimeout(100);
 assert.equal(posts,1);
 const after=await get(`/conversations/${f.conversation_id}`);
 const latest=after.messages.at(-1);
 if(blocked){assert.equal(after.messages.length,f.before_message_count);}
 else{assert.equal(status,202);assert.deepEqual(latest.target,target);assert.equal(latest.text,request.text);}
 await writeFile(out,JSON.stringify({native_target_present:!blocked,blocked_before_admission:blocked,posts,status,target,request,admitted_message:blocked?null:latest,conversation:after},null,2)+'\n');
 if(blocked)throw new Error('Native target absent/stale: build with NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1 before live review. No message admitted.');
}finally{await browser.close();}
