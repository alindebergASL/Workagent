import {chromium} from '/home/ubuntu/workagent-continuation-20261026/web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const base='/home/ubuntu/workagent-continuation-20261026/.local/batch3/b33a',out=base+'/evidence/browser';const f=JSON.parse(fs.readFileSync(base+'/fixture.json'));const mode=process.argv[2];
const b=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});const p=await b.newPage({acceptDownloads:true});const result={mode,passed:false,layouts:[]};
try{
 await p.goto('http://127.0.0.1:13238/conversations/'+f.conversation_id+'?workspace='+f.workspace_id);await p.getByRole('button',{name:'requests-brief.md',exact:true}).click();const text=p.getByLabel(/^Text \(/);await text.waitFor();
 if(mode==='human'){
  const human=(await text.inputValue())+'\nHuman note: prioritize release compatibility; preserve this exact wording after restart.\n';await text.fill(human);const consent=p.getByRole('checkbox',{name:/This file has/});if(await consent.count())await consent.check();const posted=p.waitForResponse(r=>r.url().includes('/versions')&&r.request().method()==='POST');await p.getByRole('button',{name:'Save',exact:true}).click();const response=await posted;assert(response.ok(),JSON.stringify(await response.json()));result.saved=await response.json();fs.writeFileSync(base+'/evidence/expected-human.md',human);await p.reload();await p.getByRole('button',{name:'requests-brief.md',exact:true}).click();assert.equal(await text.inputValue(),human);
 }else{
  await p.locator('select').first().selectOption('markdown');await p.getByRole('button',{name:/Export saved version/}).click();const download=p.waitForEvent('download');await p.getByRole('button',{name:/Download/}).click();const dl=await download;const dest=out+'/'+mode+'.md';await dl.saveAs(dest);const raw=fs.readFileSync(dest);const expected=fs.readFileSync(base+'/evidence/'+(mode==='after'?'expected-human.md':'expected-brief.md'));assert.deepEqual(raw,expected);result.download={sha256:crypto.createHash('sha256').update(raw).digest('hex'),bytes:raw.length};
  if(mode==='after')assert((await text.inputValue()).includes('Human note: prioritize release compatibility; preserve this exact wording after restart.'));
 }
 for(const width of [1440,390,320]){await p.setViewportSize({width,height:900});await text.scrollIntoViewIfNeeded();await p.screenshot({path:out+'/'+mode+'-file-'+width+'.png'});const layout=await p.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth}));assert(layout.pageWidth<=layout.width);result.layouts.push(layout);}
 result.passed=true;
}finally{fs.writeFileSync(out+'/'+mode+'-file-rendered.txt',await p.locator('body').innerText());fs.writeFileSync(out+'/'+mode+'-file-result.json',JSON.stringify(result,null,2));await b.close();}
console.log(JSON.stringify(result));
