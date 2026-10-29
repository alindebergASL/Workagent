import {chromium} from '/home/ubuntu/workagent-continuation-20261026/web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const base=process.cwd()+'/.local/batch3/b33a',out=base+'/evidence/client-browser';fs.mkdirSync(out,{recursive:true});
const f=JSON.parse(fs.readFileSync(base+'/client-fixture-web.json'));const b=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});const p=await b.newPage();const result={passed:false,classification:f.classification,statuses:[],requests:[]};
p.on('response',r=>{if(r.url().includes('/tool-attempts'))result.requests.push({url:r.url(),status:r.status()});});
try{
 await p.goto('http://127.0.0.1:13238/conversations/'+f.conversation_id+'?workspace='+f.workspace_id);await p.getByText('Tool activity',{exact:true}).click();const activity=p.locator('.tool-activity');await p.locator('[data-status=changed_source]').waitFor();
 for(const status of ['rate_limited','denied','unavailable','available','changed_source']){const r=p.locator('[data-testid=github-receipt][data-status='+status+']');assert.equal(await r.count(),1);assert((await r.innerText()).includes('Deterministic fixture — not live GitHub'));result.statuses.push({status,rendered:await r.innerText()});}
 await p.getByText('Source excerpt (untrusted text)',{exact:true}).first().click();assert((await activity.innerText()).includes('CONTROLLED_REVOKED_TITLE'));assert.equal(await p.locator('[data-kind=unverified]').count(),0);
 fs.writeFileSync(out+'/preloaded.txt',await activity.innerText());await p.setViewportSize({width:390,height:900});await activity.scrollIntoViewIfNeeded();await p.screenshot({path:out+'/preloaded.png',fullPage:true});
 execFileSync(process.cwd()+'/backend/.venv/bin/python',[base+'/client_fixture.py','revoke','web'],{env:process.env});
 await activity.getByRole('button',{name:'Refresh',exact:true}).click();await activity.getByRole('alert').waitFor();assert.equal(await p.locator('[data-testid=github-receipt]').count(),0);assert(!(await p.locator('body').innerText()).includes('CONTROLLED_REVOKED_TITLE'));assert(result.requests.some(r=>r.status===404));
 result.denial=await activity.innerText();fs.writeFileSync(out+'/denied.txt',await p.locator('body').innerText());await p.screenshot({path:out+'/denied.png',fullPage:true});result.passed=true;
}finally{fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));await b.close();}
console.log(JSON.stringify(result));
