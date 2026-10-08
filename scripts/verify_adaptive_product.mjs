// Real browser -> proxy -> API -> PostgreSQL -> GeneralWorker -> real Wasmtime.
// Only provider HTTP is a labeled synthetic fixture; no forged API/UI replies.
import {chromium, expect} from '../web/node_modules/@playwright/test/index.mjs';
import {readFile, writeFile, open} from 'node:fs/promises';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [out,envFile,phase]=process.argv.slice(2);
if(!out||!envFile) throw new Error('Run through verify_adaptive_product.py');
const M=JSON.parse(await readFile(path.join(out,'manifest.json'),'utf8'));
const origin=M.origin, base=origin+'/api/domain/v1/workspaces/local-workspace';
const report={mode:'real_browser_real_api_postgresql_wasmtime_synthetic_provider',live_provider_calls:0,
  model_adaptation:'NOT TESTED: deterministic provider fixture',requests:[],errors:[],external:[],screenshots:[],turns:[]};
const save=(name,data)=>writeFile(path.join(out,name),JSON.stringify(data,null,2)+'\n',{mode:0o600});
const get=async p=>{const r=await fetch(base+p,{headers:{'X-Workagent-Client':'local-ui'}});expect(r.status,p).toBe(200);return r.json();};
const python=path.join(root,'backend/.venv/bin/python');
const argv=[path.join(root,'scripts/verify_adaptive_product.py')];
const opts=['--env',envFile,'--output',out];
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.PLAYWRIGHT_CHROMIUM_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
await context.tracing.start({screenshots:true,snapshots:true,sources:true});
const page=await context.newPage();
page.on('pageerror',e=>report.errors.push(e.message));
page.on('request',r=>{if(r.method()==='POST'&&r.url().startsWith(base))report.requests.push({path:new URL(r.url()).pathname,body:r.postDataJSON()});});
await context.route('**/*',async r=>{if(new URL(r.request().url()).origin!==origin){report.external.push(r.request().url());return r.abort('blockedbyclient');}return r.continue();});
let worker,log;
async function shot(name){await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});report.screenshots.push(name+'.png');}
async function ready(cid,n){
 await expect.poll(async()=> (await get('/conversations/'+cid)).messages.filter(m=>m.author_kind==='assistant').length,{timeout:45000}).toBe(n);
 const d=await get('/conversations/'+cid), t=d.turns.at(-1);
 expect(d.runs).toHaveLength(n);expect(d.runs.at(-1).state).toBe('partial');
 expect(t.adaptive.outcome).toBe('needs_validation');
 expect(t.adaptive.steps).toHaveLength(2);expect(t.adaptive.steps[0].status).toBe('rejected');
 expect(t.adaptive.steps[1].verification.model_tests_passed).toBe(true);
 expect(t.adaptive.steps.every(s=>s.verification.satisfied===false)).toBe(true);
 expect(t.retained_local_result.published).toBe(true);expect(t.evidence_origin).toBe('synthetic_provider_receipt');
 const product=d.messages.filter(m=>m.author_kind==='assistant').at(-1).result.results.find(r=>r.kind==='tool');
 const observation=await get('/observations/'+product.observation_id);
 expect(observation.observation.output.value).toBe('3750');
 report.turns.push({conversation:d,product,observation});await save('progress.json',report);
 return {d,product,artifact:await get('/artifacts/'+product.artifact_id)};
}
async function openTool(){await page.getByRole('link',{name:'Open tool product',exact:true}).click();await page.waitForURL(/\/artifacts\//);}
async function stopWorker(){if(worker&&worker.exitCode===null&&worker.signalCode===null){worker.kill('SIGTERM');await once(worker,'exit');}if(log){await log.close();log=null;}}
try{
 if(phase==='reopen'){
  const prior=JSON.parse(await readFile(path.join(out,'browser-result.json'),'utf8'));
  await page.goto(origin+'/spaces/local-workspace');
  await page.locator(`a.work-row[data-artifact="${prior.product.id}"]`).click();
  await expect(page.getByLabel('Your notes (one per line)')).toHaveValue(M.human_note);
  await expect(page.getByTestId('observed-return')).toHaveText('3750');
  expect((await get('/artifacts/'+prior.product.id)).current_revision_id).toBe(prior.product.current_revision_id);
  const d=await get('/conversations/'+prior.conversation_id);expect(d.messages).toHaveLength(4);expect(d.runs).toHaveLength(2);
  await shot('07-process-restart-desktop');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Conversation',exact:true}).click();
  await expect(page.getByText('Result saved — needs review',{exact:true}).last()).toBeVisible();
  await shot('08-process-restart-phone');expect(report.requests).toEqual([]);
 }else{
  let cid,release,createdResolve;const created=new Promise(r=>createdResolve=r),barrier=new Promise(r=>release=r);
  await page.route(base+'/conversations',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   const response=await route.fetch();expect(response.status()).toBe(201);cid=(await response.json()).id;createdResolve();
   await barrier;await route.fulfill({response}); // unchanged real create; operator admission barrier only
  });
  await page.goto(origin);await page.getByLabel('Message your agent').fill(M.prompt);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await Promise.race([created,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Create not observed')),20000).unref())]);
  await save('conversation-ids.json',{tool:cid});
  const installed=spawnSync(python,[...argv,'install',...opts],{cwd:root,env:process.env,encoding:'utf8'});
  await writeFile(path.join(out,'operator.log'),installed.stdout+installed.stderr,{mode:0o600});expect(installed.status,installed.stderr).toBe(0);
  release();await page.waitForURL(origin+'/conversations/'+cid);await expect(page.locator('[data-state="queued"]')).toBeVisible();
  log=await open(path.join(out,'worker.log'),'w',0o600);
  worker=spawn(python,[...argv,'consume',...opts],{cwd:root,env:process.env,stdio:['ignore',log.fd,log.fd]});
  const first=await ready(cid,1);
  await expect(page.getByText('Result saved — needs review',{exact:true})).toBeVisible();
  const details=page.locator('details').filter({has:page.locator('summary',{hasText:'How this ran'})});
  await expect(details).not.toHaveAttribute('open','');
  await shot('01-result-needs-review-desktop');
  await page.getByText('How this ran',{exact:true}).click();await shot('02-actual-failure-and-repair-details');
  await page.getByText('How this ran',{exact:true}).click();await openTool();
  await expect(page.getByTestId('observed-return')).toHaveText('3750');
  await page.getByLabel('Your notes (one per line)').fill(M.human_note);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Conversation',exact:true}).click();
  await page.getByLabel('Reply about this work',{exact:true}).fill(M.followup);
  await page.getByRole('button',{name:'Work',exact:true}).click();await page.reload();
  await expect(page.getByLabel('Your notes (one per line)')).toHaveValue(M.human_note);
  await page.getByRole('button',{name:'Conversation',exact:true}).click();
  await expect(page.getByLabel('Reply about this work',{exact:true})).toHaveValue(M.followup);
  await page.getByRole('button',{name:'Work',exact:true}).click();
  await page.getByRole('button',{name:'Save my edits',exact:true}).click();
  await expect(page.getByTestId('product-verification')).toHaveText('This saved version hasn’t been checked yet.');
  const saved=await get('/artifacts/'+first.artifact.id);expect(saved.current_revision.author_kind).toBe('human');
  await shot('03-human-edit-saved-phone');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.agent-pane').getByRole('button',{name:'Send',exact:true}).click();
  const second=await ready(cid,2);
  expect((await get('/artifacts/'+saved.id)).current_revision_id).toBe(saved.current_revision_id);
  expect(second.product.proposal_id).toBeTruthy();
  await expect(page.getByTestId('product-proposal')).toBeVisible();await shot('04-proposed-not-overwritten');
  await page.goto(origin);await expect(page.locator(`section.decision-card[data-artifact="${saved.id}"]`)).toContainText('A proposed version is ready');
  await page.goto(origin+'/spaces/local-workspace');await page.locator(`a.work-row[data-artifact="${saved.id}"]`).click();
  await page.getByRole('button',{name:'Apply proposed version',exact:true}).click();
  await expect(page.getByTestId('product-verification')).toHaveText('Checked against this saved version.');
  const current=await get('/artifacts/'+saved.id);expect(current.current_revision.body.notes).toEqual([M.human_note]);
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved file',exact:true}).click();
  const download=await pending;await download.saveAs(path.join(out,'invoice-calculator.wat'));
  expect(await readFile(path.join(out,'invoice-calculator.wat'),'utf8')).toBe(current.current_revision.body.code);
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await expect(page.getByTestId('observed-return')).toHaveText('3750');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot('05-work-'+width);
   await page.getByRole('button',{name:'Conversation',exact:true}).click();
   await expect(page.getByText('Result saved — needs review',{exact:true}).last()).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot('06-conversation-'+width);
   await page.getByRole('button',{name:'Work',exact:true}).click();
  }
  const posts=report.requests.filter(r=>r.path.endsWith('/messages'));expect(posts).toHaveLength(2);
  expect(posts.map(r=>r.body.text)).toEqual([M.prompt,M.followup]);
  for(const p of posts){expect(p.body.operation??null).toBeNull();expect(p.body.acceptance_checks??null).toBeNull();}
  expect(posts[1].body.target).toEqual({artifact_id:saved.id,revision_id:saved.current_revision_id,body_hash:saved.current_revision.body_hash});
  report.product=current;report.conversation_id=cid;
 }
 expect(report.errors).toEqual([]);expect(report.external).toEqual([]);report.passed=true;
 await save(phase==='reopen'?'restart.json':'browser-result.json',report);console.log('PASS adaptive browser '+(phase??'journey'));
}catch(e){report.passed=false;report.error=String(e.stack??e);await shot('failure');await save(phase==='reopen'?'restart-failure.json':'browser-failure.json',report);throw e;}
finally{await stopWorker();await context.tracing.stop({path:path.join(out,phase==='reopen'?'restart-trace.zip':'browser-trace.zip')});await context.close();await browser.close();}
