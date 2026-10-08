#!/usr/bin/env node
/** Actual UI journey; explicit operator setup, one continuous worker + one restart.
 * Model goals contain no evaluator answers, operations, or supplied test cases.
 * Requires an already running isolated 3130/8130 stack and private operator manifest.
 */
import { chromium, expect } from '../web/node_modules/@playwright/test/index.mjs';
import { readFile, writeFile, open, stat } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
const out=path.resolve(process.argv[2]);
const config=JSON.parse(await readFile(path.join(out,'manifest.json'),'utf8'));
const root=path.resolve(import.meta.dirname,'..');
const origin=config.origin, base=origin+'/api/domain/v1/workspaces/local-workspace';
const headers={'X-Workagent-Client':'local-ui','Content-Type':'application/json'};
const report={mode:'live_model_real_ui_postgresql_continuous_worker',origin,requests:[],errors:[],turns:[]};
const save=async(name,data)=>writeFile(path.join(out,name),JSON.stringify(data,null,2),{mode:0o600});
const get=async(p)=>{const r=await fetch(base+p,{headers});expect(r.ok).toBe(true);return r.json();};
const exists=async(p)=>stat(p).then(()=>true,()=>false);
let worker,log;
const workerArgs=[path.join(root,'scripts/run_interruption_probe.py'),'--probe-dir',path.join(out,'probe'),'--lock-file',config.lock_file,
 '--general-responses','--workspace','local-workspace','--grant-id',config.grant_id,'--authority-record',path.join(out,'authority.json'),
 '--state-dir',path.join(out,'private-state'),'--serve','--interval','0.5'];
async function startWorker(){
 log=await open(path.join(out,'continuous-worker.log'),'a',0o600);
 worker=spawn(config.python,workerArgs,{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'backend')},stdio:['ignore',log.fd,log.fd]});
 await save('worker-process.json',{pid:worker.pid,args:workerArgs,continuous:true});
}
async function interruptWorker(){
 const checkpoint=JSON.parse(await readFile(path.join(out,'probe/paused.json'),'utf8'));
 expect(checkpoint.pid).toBe(worker.pid);
 worker.kill('SIGKILL');await once(worker,'exit');await log.close();log=null;
 report.interruption={...checkpoint,signal:'SIGKILL',interrupted_before_completion:true};
}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const tool=await context.newPage(), csv=await context.newPage();
for(const page of [tool,csv]){
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/messages')){
  const b=r.postDataJSON();report.requests.push({text:b.text,target_present:!!b.target,operation_present:!!b.operation,checks_present:!!b.acceptance_checks,attachments:(b.attachments||[]).length});
 }});
}
async function shot(page,name){await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});}
async function terminal(cid,count){
 let d;
 await expect.poll(async()=>{
  d=await get('/conversations/'+cid);
  return d.runs.length===count&&['ready','partial','cancelled'].includes(d.runs.at(-1).state);
 },{timeout:240000,intervals:[500,1000,2000]}).toBe(true);
 await save('turn-'+cid+'-'+count+'.json',d);
 report.turns.push({conversation_id:cid,run_id:d.runs.at(-1).id,state:d.runs.at(-1).state,adaptive:d.turns.at(-1).adaptive});
 return d;
}
function product(d,kind){return d.messages.filter(m=>m.author_kind==='assistant').at(-1)?.result?.results.find(r=>r.kind===kind);}
function choose(n,k){let value=1n;for(let i=1n;i<=BigInt(k);i++)value=value*(BigInt(n)-i+1n)/i;return value.toString();}
try{
 const ids={},releases={};let created;
 const both=new Promise(resolve=>created=resolve);
 for(const [name,page,prompt] of [['tool',tool,config.tool_goal],['csv',csv,config.csv_goal]]){
  await page.route(base+'/conversations',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   const response=await route.fetch();expect(response.status()).toBe(201);
   ids[name]=(await response.json()).id;
   const barrier=new Promise(resolve=>releases[name]=resolve);
   if(Object.keys(ids).length===2)created();
   await barrier;await route.fulfill({response}); // unmodified real creation, admission barrier only
  });
  await page.goto(origin);
  await page.getByLabel('Message your agent').fill(prompt);
  if(name==='csv')await page.locator('input[type="file"]').setInputFiles({name:'invoice-check.csv',mimeType:'text/csv',buffer:Buffer.from(config.csv_source)});
  await page.getByRole('button',{name:'Send',exact:true}).click();
 }
 await Promise.race([both,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Both real conversations were not created')),20000).unref())]);
 await save('conversation-ids.json',ids);
 const install=spawnSync(config.python,[config.setup_program,'install'],{cwd:root,env:process.env,encoding:'utf8'});
 await writeFile(path.join(out,'operator-setup.log'),install.stdout+install.stderr,{mode:0o600});
 expect(install.status).toBe(0);
 await startWorker();releases.tool();releases.csv();
 await tool.waitForURL(origin+'/conversations/'+ids.tool);await csv.waitForURL(origin+'/conversations/'+ids.csv);
 const first=await terminal(ids.tool,1);const csvFirst=await terminal(ids.csv,1);
 expect(first.runs[0].state).toBe('ready');expect(csvFirst.runs[0].state).toBe('ready');
 expect(first.turns[0].adaptive.outcome).toBe('completed');expect(csvFirst.turns[0].adaptive.outcome).toBe('completed');
 expect(first.turns[0].adaptive.steps.at(-1).verification.automatic.case_count).toBe(1891);
 await expect(tool.getByText('Requested result verified',{exact:true})).toBeVisible();
 await expect(csv.getByText('Requested result verified',{exact:true})).toBeVisible();
 await shot(tool,'01-completed-tool-desktop');await shot(csv,'02-completed-csv-desktop');
 const steps=first.turns[0].adaptive.steps;
 report.adaptation={observed_steps:steps.length,changed_after_failure:steps.slice(1).some((s,i)=>steps[i].operation_hash!==s.operation_hash && (steps[i].status==='rejected'||steps[i].verification.automatic?.passed===false)),
  wrong_but_executable:steps.some(s=>s.status==='observed'&&s.verification.automatic?.recognized&&s.verification.automatic.passed===false),operator_repair_supplied:false};
 const initialTool=product(first,'tool'),initialTable=product(csvFirst,'table');
 expect(initialTool).toBeTruthy();expect(initialTable).toBeTruthy();
 report.tool_id=initialTool.artifact_id;report.table_id=initialTable.artifact_id;report.conversations=ids;
 const toolUrl=origin+'/conversations/'+ids.tool+'/artifacts/'+initialTool.artifact_id;
 await tool.goto(toolUrl);
 await expect(tool.getByTestId('observed-return').first()).toHaveText(choose(60,30));
 // Introduce a genuine arithmetic obstacle, not a provider/evaluator answer.
 // This plausible implementation overflows its intermediate i64 product.
 const firstArtifact=await get('/artifacts/'+initialTool.artifact_id);
 let faultyCode=await readFile(path.join(root,'fixtures/general-work/team-selection-overflow.wat'),'utf8');
 faultyCode=faultyCode.replace('(export "choose")','(export "'+firstArtifact.current_revision.body.entrypoint+'")');
 await tool.getByText('Tool code',{exact:true}).click();
 await tool.getByLabel('WebAssembly text (WAT)').fill(faultyCode);
 await tool.getByText('Tool code',{exact:true}).click();
 await tool.getByLabel('Your notes (one per line)').fill(config.human_note);
 await tool.getByRole('button',{name:'Save my edits',exact:true}).click();
 await expect(tool.getByRole('button',{name:'Run saved tool',exact:true})).toBeVisible();
 await tool.getByRole('button',{name:'Run saved tool',exact:true}).click();
 const obstacleRun=await terminal(ids.tool,2);
 expect(obstacleRun.runs.at(-1).profile).toBe('general-products-controlled-v1');
 const obstacle=product(obstacleRun,'tool');
 const obstacleObservation=await get('/observations/'+obstacle.observation_id);
 expect(obstacleObservation.observation.output.value).not.toBe(choose(60,30));
 report.introduced_obstacle={kind:'intermediate_integer_overflow',actual:obstacleObservation.observation.output.value,
   code_changed_by_fault_injection:true,repair_prescribed:false,evaluator_answers_sent:false};
 await expect(tool.getByTestId('product-proposal')).toBeVisible();
 await shot(tool,'03a-observed-overflow-obstacle');
 await tool.getByRole('button',{name:'Keep my current version',exact:true}).click();
 const saved=await get('/artifacts/'+initialTool.artifact_id);
 expect(saved.current_revision.author_kind).toBe('human');expect(saved.current_revision.body.notes).toEqual([config.human_note]);
 await shot(tool,'03-saved-human-edit');
 await writeFile(path.join(out,'probe/arm'),'interrupt final known-ID before publication',{mode:0o600});
 await tool.locator('.agent-pane').getByLabel('Reply about this work',{exact:true}).fill(config.tool_followup);
 await tool.locator('.agent-pane').getByRole('button',{name:'Send',exact:true}).click();
 await expect.poll(()=>exists(path.join(out,'probe/paused.json')),{timeout:240000,intervals:[500,1000]}).toBe(true);
 const interrupted=await get('/conversations/'+ids.tool);
 expect(interrupted.runs).toHaveLength(3);expect(interrupted.runs.at(-1).state).toBe('running');
 expect(interrupted.messages.filter(m=>m.author_kind==='assistant')).toHaveLength(2);
 const before=spawnSync(config.python,[config.setup_program,'audit','before-resume'],{cwd:root,env:process.env,encoding:'utf8'});expect(before.status).toBe(0);
 await interruptWorker();
 // The edit during downtime is a real unsaved UI draft; the saved edit above is in the exact run base.
 await tool.getByLabel('Your notes (one per line)').fill(config.draft_note);
 await tool.setViewportSize({width:390,height:844});
 await tool.getByRole('button',{name:'Conversation',exact:true}).click();
 await tool.getByRole('button',{name:'Work',exact:true}).click();await tool.reload();
 await expect(tool.getByLabel('Your notes (one per line)')).toHaveValue(config.draft_note);
 await shot(tool,'04-interrupted-phone-draft-preserved');
 await startWorker();
 const resumed=await terminal(ids.tool,3);
 expect(resumed.runs.at(-1).id).toBe(interrupted.runs.at(-1).id);expect(resumed.runs.at(-1).state).toBe('ready');
 expect(resumed.messages.filter(m=>m.author_kind==='assistant')).toHaveLength(3);
 const proposed=product(resumed,'tool');expect(proposed.proposal_id).toBeTruthy();
 const proposal=await get('/proposals/'+proposed.proposal_id);
 expect(proposal.status).toBe('pending');expect(proposal.body.notes).toEqual([config.human_note]);
 expect(proposal.body.code).not.toBe(faultyCode);
 const repairedObservation=await get('/observations/'+proposed.observation_id);
 expect(repairedObservation.observation.output.value).toBe(choose(60,30));
 report.introduced_obstacle.resolved_by_changed_model_code=true;
 expect((await get('/artifacts/'+saved.id)).current_revision_id).toBe(saved.current_revision_id);
 await tool.reload();await expect(tool.getByLabel('Your notes (one per line)')).toHaveValue(config.draft_note);
 await tool.setViewportSize({width:1440,height:1000});await shot(tool,'05-resumed-proposal-with-human-draft');
 const downloadPromise=tool.waitForEvent('download');
 await tool.getByRole('button',{name:'Download proposed file',exact:true}).click();
 const download=await downloadPromise;await download.saveAs(path.join(out,'proposed-team-calculator.wat'));
 expect((await get('/proposals/'+proposal.id)).status).toBe('pending');
 expect((await get('/artifacts/'+saved.id)).current_revision_id).toBe(saved.current_revision_id);
 report.resume={same_run:true,saved_human_note_preserved:true,downtime_draft_preserved:true,proposal_pending:true,download_did_not_accept:true};
 const after=spawnSync(config.python,[config.setup_program,'audit','after-resume'],{cwd:root,env:process.env,encoding:'utf8'});expect(after.status).toBe(0);
 // Save the retained draft, then explicitly reuse saved code through the same continuous consumer.
 await tool.getByRole('button',{name:'Keep my current version',exact:true}).click();
 await tool.getByRole('button',{name:'Save my edits',exact:true}).click();
 await expect(tool.getByRole('button',{name:'Run saved tool',exact:true})).toBeVisible();
 const localBefore=spawnSync(config.python,[config.setup_program,'audit','before-local'],{cwd:root,env:process.env,encoding:'utf8'});expect(localBefore.status).toBe(0);
 await tool.getByRole('button',{name:'Run saved tool',exact:true}).click();
 const local=await terminal(ids.tool,4);
 expect(local.runs.at(-1).profile).toBe('general-products-controlled-v1');
 expect(local.runs.at(-1).state).toBe('ready');
 const localProposal=await get('/proposals/'+product(local,'tool').proposal_id);
 expect(localProposal.body.notes).toEqual([config.draft_note]);
 const localAfter=spawnSync(config.python,[config.setup_program,'audit','after-local'],{cwd:root,env:process.env,encoding:'utf8'});expect(localAfter.status).toBe(0);
 report.local_reuse={continuous:true,profile:local.runs.at(-1).profile,human_draft_saved_and_preserved:true};
 await csv.goto(origin+'/conversations/'+ids.csv+'/artifacts/'+initialTable.artifact_id);
 const pending=csv.waitForEvent('download');await csv.getByRole('button',{name:'Download saved file',exact:true}).click();
 await (await pending).saveAs(path.join(out,'verified-invoices.csv'));
 await csv.setViewportSize({width:390,height:844});await shot(csv,'06-csv-phone');
 report.goals_contain_no_operations_or_test_specs=report.requests.filter(r=>!r.operation_present).every(r=>!r.checks_present);
 report.passed=true;
 await save('browser-evidence.json',report);
 console.log(JSON.stringify({passed:true,adaptation:report.adaptation,resume:report.resume,review_url:toolUrl,worker_pid:worker.pid}));
 // Keep the bounded isolated consumer available for review, not production.
 worker.unref();await log.close();log=null;
}catch(e){
 report.passed=false;report.failure=String(e);await save('browser-evidence.json',report);
 if(worker && worker.exitCode===null && worker.signalCode===null){worker.kill('SIGTERM');await once(worker,'exit').catch(()=>{});}
 if(log)await log.close();
 throw e;
}finally{await browser.close();}
