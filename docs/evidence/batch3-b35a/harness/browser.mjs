import {chromium} from '/home/ubuntu/workagent-continuation-20261026/web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const root=process.cwd(),base=root+'/.local/batch3/b35a',out=base+'/evidence/browser-v2';fs.mkdirSync(out,{recursive:true});
const fixtures=JSON.parse(fs.readFileSync(base+'/ui-fixture-v2.json')),env={...process.env,PYTHONPATH:root+'/backend'};
for(const line of fs.readFileSync(base+'/ui.env','utf8').split('\n'))if(line.startsWith('export ')){const [k,...v]=line.slice(7).split('=');env[k]=v.join('=');}
const b=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});let results=[];
try{for(const width of [1440,390,320]){
 const f=fixtures.find(x=>x.label==='web'+width),p=await b.newPage({viewport:{width,height:1000}}),r={width,passed:false,errors:[],receipts:[]};
 p.on('pageerror',e=>r.errors.push(e.message));
 const url='http://127.0.0.1:13250/conversations/'+f.conversation_id+'?workspace='+f.workspace_id;
 const capture=async name=>{await p.screenshot({path:out+'/'+width+'-'+name+'.png',fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');};
 const api=async path=>{const res=await fetch('http://127.0.0.1:18250/v1/workspaces/'+f.workspace_id+path,{headers:{Authorization:'Bearer '+env.LOCAL_BEARER_TOKEN,'X-Schema-Version':'workagent/v1','X-Request-Id':'b35a-readback'}});assert(res.ok);return res.json();};
 try{
  const already=await api('/memory/'+f.memory_id);
  if(already.current.status!=='forgotten'){
  await p.goto(url);await p.getByText('Memory',{exact:true}).click();
  let item=p.getByTestId('memory-item').filter({hasText:'Use concise synthetic headings '+f.label});await item.waitFor();await item.getByRole('button',{name:'Correct',exact:true}).click();await item.getByLabel('Corrected text',{exact:true}).fill('Human corrected headings '+f.label);
  await capture('correction-ready');const pending=p.waitForResponse(x=>x.url().endsWith('/correct')&&x.request().method()==='POST');await item.getByRole('button',{name:'Save correction',exact:true}).click();const posted=await pending;assert(posted.ok());r.receipts.push(await posted.json());
  item=p.getByTestId('memory-item').filter({hasText:'Human corrected headings '+f.label});await item.waitFor();await capture('corrected');assert.equal((await api('/memory/'+f.memory_id)).current.content,'Human corrected headings '+f.label);
  await p.reload();await p.getByText('Memory',{exact:true}).click();await item.waitFor();
  await item.getByRole('button',{name:'Forget…',exact:true}).click();await capture('retention-warning');const gone=p.waitForResponse(x=>x.url().endsWith('/forget')&&x.request().method()==='POST');await item.getByRole('button',{name:'Forget it',exact:true}).click();const forgotten=await gone;assert(forgotten.ok());r.receipts.push(await forgotten.json());await item.waitFor({state:'detached'});
  const current=await api('/memory/'+f.memory_id);assert.equal(current.current.status,'forgotten');assert(current.revisions.every(x=>x.content===null));
  await p.getByTestId('memory-item').filter({hasText:'Revocable synthetic context '+f.label}).waitFor();execFileSync(root+'/backend/.venv/bin/python',[base+'/ui_actions.py','revoke-source',f.label],{env});
  await p.reload();await p.getByText('Memory',{exact:true}).click();await p.getByRole('combobox',{name:'Kind',exact:true}).waitFor();assert(!(await p.locator('body').innerText()).includes('Revocable synthetic context '+f.label));assert.equal((await api('/memory?conversation_id='+f.conversation_id)).items.length,0);await capture('forgotten-source-revoked');
  }else{r.resumed_after_verified_memory_actions=true;r.memory_readback=already;}
  const connector=JSON.parse(execFileSync(root+'/backend/.venv/bin/python',[base+'/ui_actions.py','prepare-connector',f.label],{env,encoding:'utf8'}));r.connector_scope=connector;
  await p.goto('http://127.0.0.1:13250/connections');const revoked=p.waitForResponse(x=>x.url().includes(connector.connector_id+'/revoke')&&x.request().method()==='POST');await p.getByRole('button',{name:'Revoke access',exact:true}).nth(connector.index).click();const rr=await revoked;assert(rr.ok());const revokeReceipt=await rr.json();assert.equal(revokeReceipt.state,'revoked');assert.equal(revokeReceipt.provider_revocation,'failed');r.receipts.push(revokeReceipt);await p.getByTestId('provider-revocation').filter({hasText:'failed'}).first().waitFor();await capture('connector-local-revoke');
  r.readback=JSON.parse(execFileSync(root+'/backend/.venv/bin/python',[base+'/ui_actions.py','readback',f.label],{env,encoding:'utf8'}));assert.equal(r.readback.visible_memory_count,0);assert.deepEqual(r.errors,[]);r.passed=true;
 }finally{fs.writeFileSync(out+'/'+width+'-rendered.txt',await p.locator('body').innerText());results.push(r);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));await p.close();}
}}finally{await b.close();}
console.log('Actual web correct/forget/revoke/readback passed at',results.map(x=>x.width));
