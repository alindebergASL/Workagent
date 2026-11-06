// Supplement only: genuine read/receipt reordering, real denied read, rendered usage.
import {chromium,expect} from './web/node_modules/@playwright/test/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {scopedHeaders} from './web/scripts/lib/scope.mjs';
const origin='http://127.0.0.1:13231',out='../evidence/closure';await mkdir(out,{recursive:true});
const f=JSON.parse(await readFile(out+'/fixture.json','utf8')),ws=f.workspace_id;
const headers=await scopedHeaders(origin,{'X-Workagent-Client':'local-ui','Content-Type':'application/json'});
const cmd=()=>({schema_version:'workagent/v1',request_id:crypto.randomUUID(),command_id:crypto.randomUUID()});
async function api(path,body,status=200){const r=await fetch(origin+'/api/domain/v1/workspaces/'+ws+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});expect(r.status).toBe(status);return r.json();}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});let page;const results=[];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function snap(name){await page.screenshot({path:out+'/'+name+'.png',fullPage:true});await writeFile(out+'/'+name+'.txt',await page.locator('body').innerText());}
async function open(cid,workspace=ws){page=await browser.newPage({viewport:{width:1000,height:900}});await page.goto(origin+'/conversations/'+cid+'?workspace='+workspace);await page.getByText('Memory',{exact:true}).click();}
const row=text=>page.getByTestId('memory-item').filter({hasText:text});
async function remember(text){await page.getByRole('textbox',{name:'Remember',exact:true}).fill(text);const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/memory/remember'));await page.getByRole('button',{name:'Remember',exact:true}).click();const receipt=await(await response).json();await expect(page.getByRole('textbox',{name:'Remember',exact:true})).toBeEnabled();return receipt;}
try{
 // Existing real production-worker usage; no additional model request.
 const later=JSON.parse(await readFile('../evidence/later/web-reviewed-forgotten.json','utf8'));
 const oldFixture=JSON.parse(await readFile('../evidence/browser/fixture.json','utf8'));
 await open(later.conversation_id,oldFixture.workspace_id);
 await row('Verify units before calculating').getByText('Why this is here').click();
 await expect(row('Verify units before calculating')).toContainText('Used in the latest answer');await snap('usage');
 results.push({case:'rendered_usage',run_id:later.run_id,revision_id:later.expected_revisions[0],passed:true});await page.close();
 for(const order of ['old-list-before-forget-receipt','old-list-after-forget-receipt']){
  const cv=await api('/conversations',{...cmd(),title:order},201);await open(cv.id);await expect(page.getByText('Nothing is remembered for this conversation.')).toBeVisible();
  const text='Forget ordering payload '+order,m=await remember(text);await expect(row(text)).toBeVisible();
  const got=deferred(),release=deferred(),delivered=deferred();let intercepted=false;
  await page.route('**/memory?**',async route=>{if(intercepted)return route.continue();intercepted=true;const response=await route.fetch();expect((await response.json()).items.some(i=>i.revision.memory_id===m.memory_id)).toBe(true);got.resolve();await release.promise;await route.fulfill({response});delivered.resolve();});
  await remember('Other note '+order);await got.promise;await row(text).getByRole('button',{name:'Forget…',exact:true}).click();
  const receiptGot=deferred(),releaseReceipt=deferred();
  await page.route('**/memory/'+m.memory_id+'/forget',async route=>{const response=await route.fetch();expect((await response.json()).status).toBe('forgotten');receiptGot.resolve();await releaseReceipt.promise;await route.fulfill({response});});
  await page.getByRole('button',{name:'Forget it',exact:true}).click();await receiptGot.promise;
  if(order==='old-list-before-forget-receipt'){release.resolve();await delivered.promise;await expect(row(text)).toBeVisible();releaseReceipt.resolve();}
  else {releaseReceipt.resolve();await expect(row(text)).toHaveCount(0);release.resolve();await delivered.promise;}
  await expect(row(text)).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Remember',exact:true})).toBeEnabled();await snap(order);
  expect((await api('/memory/'+m.memory_id)).current.content).toBe(null);results.push({case:order,passed:true,memory_id:m.memory_id});await page.close();
 }
 // Allow actual correction, revoke source before its actual exact-item readback.
 await open(f.denied_conversation);await expect(row('Revocable browser payload')).toBeVisible();
 await row('Revocable browser payload').getByRole('button',{name:'Correct',exact:true}).click();await page.getByRole('textbox',{name:'Corrected text',exact:true}).fill('Denied correction payload');
 await page.route('**/memory/'+f.denied_memory+'/correct',async route=>{const response=await route.fetch();expect(response.status()).toBe(200);execFileSync('./backend/.venv/bin/python',['.local/batch3/b31b/closure_fixture.py','revoke'],{stdio:'pipe'});await route.fulfill({response});});
 const denied=page.waitForResponse(r=>r.request().method()==='GET'&&r.url().endsWith('/memory/'+f.denied_memory));
 await page.getByRole('button',{name:'Save correction'}).click();const denial=await denied;expect(denial.status()).toBe(404);
 await expect(page.getByTestId('memory-item')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Corrected text',exact:true})).toHaveCount(0);expect(await page.locator('body').innerText()).not.toContain('Revocable browser payload');await snap('denied-read');
 results.push({case:'actual_source_revocation_readback_denied',http_status:denial.status(),passed:true});
 await writeFile(out+'/browser-result.json',JSON.stringify({passed:true,qualification:'Real production UI/API/PG, delayed genuine responses; no fabricated payloads, no paid calls',results},null,2));console.log('SUPPLEMENTARY BROWSER PASS');
}catch(e){if(page)await snap('browser-failure');await writeFile(out+'/browser-failed.json',JSON.stringify({error:String(e),results},null,2));throw e;}finally{await browser.close();}
