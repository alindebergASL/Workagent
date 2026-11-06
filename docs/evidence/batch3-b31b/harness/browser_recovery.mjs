// Actual production UI + real HTTP/PG; injected delays/errors are labeled faults.
import {chromium, expect} from './web/node_modules/@playwright/test/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {scopedHeaders} from './web/scripts/lib/scope.mjs';
const fixture=JSON.parse(await readFile('.local/batch3/b31b/ui-fixture.json','utf8'));
const origin='http://127.0.0.1:13231', ws=fixture.workspace_id;
const out='../evidence/browser';await mkdir(out,{recursive:true});
const headers=await scopedHeaders(origin,{'X-Workagent-Client':'local-ui','Content-Type':'application/json'});
const cmd=()=>({schema_version:'workagent/v1',request_id:crypto.randomUUID(),command_id:crypto.randomUUID()});
async function api(path,body,status=200){const r=await fetch(origin+'/api/domain/v1/workspaces/'+ws+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});expect(r.status).toBe(status);return r.json();}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];let page;
async function snap(name){await page.screenshot({path:out+'/'+name+'.png',fullPage:true});await writeFile(out+'/'+name+'.txt',await page.locator('body').innerText());}
async function open(label,width){const cv=await api('/conversations',{...cmd(),title:'Memory browser '+label},201);fixture.conversations[label]=cv.id;await writeFile(out+'/fixture.json',JSON.stringify(fixture,null,2));page=await browser.newPage({viewport:{width,height:900}});await page.goto(origin+'/conversations/'+fixture.conversations[label]+'?workspace='+ws);await page.getByText('Memory',{exact:true}).click();await expect(page.getByRole('form',{name:'Remember something'})).toBeVisible();await expect(page.getByText('Nothing is remembered for this conversation.')).toBeVisible();}
function row(text){return page.getByTestId('memory-item').filter({hasText:text});}
async function remember(text,kind='preference'){
 await page.getByRole('textbox',{name:'Remember',exact:true}).fill(text);
 await page.getByRole('form',{name:'Remember something'}).locator('select').selectOption(kind);
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&/\/memory\/(remember|candidates)$/.test(r.url()));
 await page.getByRole('button',{name:kind==='procedure'?'Save for review':'Remember',exact:true}).click();
 const receipt=await (await response).json();await expect(page.getByRole('textbox',{name:'Remember',exact:true})).toBeEnabled();return receipt;
}
try{
 await open('desktop',1440);
 const composer=page.getByRole('textbox',{name:/message/i}).first();
 if(await composer.count())await composer.fill('Unsent original conversation draft');
 const m=await remember('Use concise amber headings');await expect(row('Use concise amber headings')).toBeVisible();
 await row('Use concise amber headings').getByText('Why this is here').click();
 await expect(row('Use concise amber headings')).toContainText('You asked to remember this');await snap('desktop-inspected');
 // The rendered correction form pins r1 while another human writes r2 via API.
 await row('Use concise amber headings').getByRole('button',{name:'Correct',exact:true}).click();
 await page.getByRole('textbox',{name:'Corrected text',exact:true}).fill('Older unsent correction');
 const concurrent=await api('/memory/'+m.memory_id+'/correct',{...cmd(),expected_revision_id:m.revision_id,content:'Newer human blue headings',mode:'permanent'});
 await remember('Unrelated preserved note'); // triggers real list refresh
 await expect(row('Newer human blue headings')).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Corrected text',exact:true})).toHaveValue('Older unsent correction');
 await expect(page.getByRole('button',{name:'Save correction'})).toBeDisabled();
 expect((await api('/memory/'+m.memory_id)).current.revision_id).toBe(concurrent.revision_id);
 await snap('desktop-stale-draft');
 await page.getByRole('button',{name:'Correct the current version instead'}).click();
 await page.getByRole('textbox',{name:'Corrected text',exact:true}).fill('Final human green headings');
 // Delay genuine correction readback: affected fields stay locked through it.
 let releaseRead,readEntered;const entered=new Promise(r=>readEntered=r), release=new Promise(r=>releaseRead=r);
 const exact='**/memory/'+m.memory_id;
 await page.route(exact,async route=>{if(route.request().method()!=='GET')return route.continue();readEntered();await release;await route.continue();});
 const corrResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/memory/'+m.memory_id+'/correct'));
 await page.getByRole('button',{name:'Save correction'}).click();const corr=await (await corrResponse).json();await entered;
 await expect(page.getByRole('textbox',{name:'Corrected text',exact:true})).toBeDisabled();
 releaseRead();await expect(row('Final human green headings')).toBeVisible();await page.unroute(exact);
 expect((await api('/memory/'+m.memory_id)).current.content).toBe('Final human green headings');
 const candidate=await remember('Verify units before calculating','procedure');expect(candidate.status).toBe('candidate');
 await page.getByRole('button',{name:'Waiting for review',exact:true}).click();
 await expect(row('Verify units before calculating')).toBeVisible();await row('Verify units before calculating').getByRole('button',{name:'Accept',exact:true}).click();
 await page.getByRole('button',{name:'In use',exact:true}).click();await expect(row('Verify units before calculating')).toBeVisible();
 expect((await api('/memory/'+candidate.memory_id)).current.origin).toBe('human_reviewed');
 await snap('desktop-reviewed');
 // Definite forget receipt, pending verification GET, then injected network failure.
 let releaseFailure,forgetRead,failureDone;const forgetEntered=new Promise(r=>forgetRead=r), failRelease=new Promise(r=>releaseFailure=r), failedReadDone=new Promise(r=>failureDone=r);
 await page.route(exact,async route=>{if(route.request().method()!=='GET')return route.continue();forgetRead();await failRelease;await route.abort('failed');failureDone();});
 await row('Final human green headings').getByRole('button',{name:'Forget…',exact:true}).click();
 const forgotResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/forget'));
 await page.getByRole('button',{name:'Forget it',exact:true}).click();const forgotten=await (await forgotResponse).json();expect(forgotten.status).toBe('forgotten');await forgetEntered;
 await expect(page.getByText('Final human green headings',{exact:true})).toHaveCount(0);
 await snap('desktop-forget-before-failed-read');releaseFailure();await failedReadDone;await page.unroute(exact);
 await expect(row('Final human green headings')).toHaveCount(0);
 const erased=await api('/memory/'+m.memory_id);expect(erased.revisions.every(r=>r.content===null)).toBe(true);
 if(await composer.count())await expect(composer).toHaveValue('Unsent original conversation draft');
 results.push({width:1440,remember:m,correct:corr,review:candidate,forget:forgotten,stale_draft_preserved:true,write_readback_fields_locked:true,forgotten_purged_before_injected_failed_read:true});
 await page.close();
 await open('mobile',390);
 const phone=await remember('Phone scoped concise headings');await expect(row('Phone scoped concise headings')).toBeVisible();await snap('phone390-inspected');
 await row('Phone scoped concise headings').getByRole('button',{name:'Correct',exact:true}).click();await page.getByRole('textbox',{name:'Corrected text',exact:true}).fill('Phone corrected headings');
 await page.getByRole('button',{name:'Save correction'}).click();await expect(row('Phone corrected headings')).toBeVisible();
 await page.setViewportSize({width:320,height:900});await snap('phone320-corrected');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await row('Phone corrected headings').getByRole('button',{name:'Forget…',exact:true}).click();await page.getByRole('button',{name:'Forget it',exact:true}).click();await expect(row('Phone corrected headings')).toHaveCount(0);
 expect((await api('/memory/'+phone.memory_id)).current.status).toBe('forgotten');await snap('phone320-forgotten');
 results.push({widths:[390,320],memory:phone.memory_id,correct_forget:true,no_horizontal_overflow:true});
 await writeFile(out+'/result.json',JSON.stringify({passed:true,evidence:'actual production UI/API/restricted PG; controlled fault injection, no product model calls',results},null,2));
 console.log('ACTUAL WEB PASS');
}catch(e){if(page){await snap('failure');}await writeFile(out+'/failed.json',JSON.stringify({error:String(e),results},null,2));throw e;}
finally{await browser.close();}
