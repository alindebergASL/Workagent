import {chromium} from '/home/ubuntu/workagent-continuation-20261026/web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const root='/home/ubuntu/workagent-continuation-20261026',base=root+'/.local/batch3/b32c',out=base+'/evidence/browser';fs.mkdirSync(out,{recursive:true});
const fixture=JSON.parse(fs.readFileSync(base+'/fixture.json'));const origin='http://127.0.0.1:13236';
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});const context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();let records=[],attempts=null;
page.on('response',async r=>{if(r.url().includes('/tool-attempts')){const body=await r.json().catch(()=>null);if(r.ok())attempts=body;records.push({url:r.url(),status:r.status(),body});}});
const url=origin+'/conversations/'+fixture.conversation_id+'?workspace='+fixture.workspace_id;
const mode=process.argv[2]||'before';const result={mode,downloads:[],layouts:[]};
try{
 await page.goto(url);await page.getByText('Tool activity',{exact:true}).click();await page.getByText('Computation failed (exit 1)',{exact:true}).waitFor();await page.getByText('Ran to completion (exit 0)',{exact:true}).waitFor();
 assert(attempts);const compute=attempts.items.filter(x=>x.capability_id==='compute.python');assert.equal(compute.length,2);assert(compute.some(x=>x.observation.output.result.exit_code===1));
 for(const filename of ['patch.txt','candidate.txt','tests.json','applicability.json']){
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download '+filename,exact:true}).click();const dl=await event;const dest=out+'/'+mode+'-'+filename;await dl.saveAs(dest);const raw=fs.readFileSync(dest);const manifest=compute.flatMap(x=>x.observation.output.result.outputs).find(x=>x.filename===filename);assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),manifest.blob.sha256);assert.equal(raw.length,manifest.blob.byte_length);result.downloads.push({filename,path:dest,sha256:manifest.blob.sha256,bytes:raw.length,manifest});
 }
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});const failed=page.locator('.tool-activity > div > ul > li').filter({hasText:'Computation failed (exit 1)'});await failed.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/'+mode+'-failed-'+width+'.png',animations:'disabled'});
  const layout=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth}));assert(layout.pageWidth<=layout.width);result.layouts.push(layout);
 }
 await page.setViewportSize({width:1440,height:1000});const passed=page.locator('.tool-activity > div > ul > li').filter({hasText:'Ran to completion (exit 0)'});await passed.getByText('Run receipt',{exact:true}).click();await passed.getByText('Resources',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/'+mode+'-resource-receipt.png',animations:'disabled'});assert(await passed.innerText().then(t=>t.includes('CPU ')&&t.includes('peak memory')&&t.includes('Input tests.py')));
 fs.writeFileSync(out+'/'+mode+'-rendered.txt',await page.locator('body').innerText());
 if(mode==='before'){
  await page.route('**/runs/*/tool-attempts*',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'forbidden'})}));
  await page.locator('.tool-activity').getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForTimeout(600);assert.equal(await page.locator('[data-testid=compute-receipt]').count(),0);assert.equal(await page.getByRole('button',{name:'Download patch.txt',exact:true}).count(),0);result.refusalCleared=true;await page.screenshot({path:out+'/refusal-cleared.png',animations:'disabled'});
 }
 result.passed=true;
}finally{fs.writeFileSync(out+'/'+mode+'-network.json',JSON.stringify(records,null,2));fs.writeFileSync(out+'/'+mode+'-result.json',JSON.stringify(result,null,2));await browser.close();}
console.log(JSON.stringify(result));
