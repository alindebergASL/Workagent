// B3.2c download-refusal regression. Run by the parent against its actual
// preview (same origin/fixture as ../browser.mjs); not run inside the lane.
//   node b32c-download-refusal.mjs
import {chromium} from '/home/ubuntu/workagent-continuation-20261026/web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';
const base='/home/ubuntu/workagent-continuation-20261026/.local/batch3/b32c',out=base+'/evidence/browser';fs.mkdirSync(out,{recursive:true});
const fixture=JSON.parse(fs.readFileSync(base+'/fixture.json'));const origin=process.env.B32C_ORIGIN||'http://127.0.0.1:13236';
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});const page=await (await browser.newContext({acceptDownloads:true})).newPage();
const result={steps:[]};
const row=()=>page.locator('.tool-activity > div > ul > li').filter({hasText:'Ran to completion (exit 0)'});
const refresh=()=>page.locator('.tool-activity').getByRole('button',{name:'Refresh',exact:true}).click();
try{
 await page.goto(origin+'/conversations/'+fixture.conversation_id+'?workspace='+fixture.workspace_id);
 await page.getByText('Tool activity',{exact:true}).click();await row().waitFor();
 const button=row().getByRole('button',{name:/^Download /}).first();const name=await button.innerText();
 // 1) A refused download withdraws the receipt immediately: no output, no file controls.
 await page.route('**/exports/*/download',r=>r.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'not_found_or_not_authorized'})}));
 await button.click();await row().getByTestId('receipt-withdrawn').waitFor();
 assert.equal(await row().getByTestId('compute-receipt').count(),0);
 assert.equal(await row().getByRole('button',{name:/^Download /}).count(),0);
 assert(!(await row().innerText()).includes('Output (stdout)'));
 await page.screenshot({path:out+'/after-download-refusal.png',animations:'disabled'});result.steps.push('refusal-withdrawn');
 // 2) Only an explicit successful refresh restores it.
 await page.unroute('**/exports/*/download');await refresh();await row().getByTestId('compute-receipt').waitFor();
 assert.equal(await row().getByTestId('receipt-withdrawn').count(),0);result.steps.push('refresh-restored');
 // 3) A download still pending when the view refreshes never surfaces afterwards.
 let release;const gate=new Promise(r=>{release=r;});
 await page.route('**/exports/*/download',async r=>{await gate;await r.fulfill({status:404,contentType:'application/json',body:'{}'});});
 await row().getByRole('button',{name,exact:true}).click();await refresh();await row().getByTestId('compute-receipt').waitFor();
 release();await page.waitForTimeout(800);
 assert.equal(await page.getByTestId('receipt-withdrawn').count(),0);
 assert(await row().getByRole('button',{name,exact:true}).isEnabled());result.steps.push('stale-download-ignored');
 result.passed=true;
}finally{fs.writeFileSync(out+'/download-refusal-result.json',JSON.stringify(result,null,2));await browser.close();}
console.log(JSON.stringify(result));
