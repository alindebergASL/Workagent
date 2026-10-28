// Actual production browser + API + restricted PG. Deterministic worker transport.
import {chromium,expect} from './web/node_modules/@playwright/test/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {scopedHeaders} from './web/scripts/lib/scope.mjs';
const f=JSON.parse(await readFile('../fixture.json','utf8')),ws=f.workspace_id,origin='http://127.0.0.1:13232';
const out='../evidence/browser';await mkdir(out,{recursive:true});
const headers=await scopedHeaders(origin,{'X-Workagent-Client':'local-ui','Content-Type':'application/json'});
const cmd=()=>({schema_version:'workagent/v1',request_id:crypto.randomUUID(),command_id:crypto.randomUUID()});
async function api(path,body){const r=await fetch(origin+'/api/domain/v1/workspaces/'+ws+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(await r.text());return r.json();}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});let page;
async function snap(n){await page.screenshot({path:out+'/'+n+'.png',fullPage:true});await writeFile(out+'/'+n+'.txt',await page.locator('body').innerText());}
const initial='observation_id,zone,latency_seconds\nr1,North,60\nr2,North,180\nr3,South,240\nr4,South,\n';
const later='record_id,cohort,elapsed_minutes\na1,North,1.5\na2,North,4.5\na2,North,4.5\nb1,South,2\nb2,South,\nb3,South,6\n';
const specA={id:'observation_id',group:'zone',value:'latency_seconds',seconds_per_unit:'1'};
const specB={id:'record_id',group:'cohort',value:'elapsed_minutes',seconds_per_unit:'60'};
const lesson='For this duration study: compute each group mean using unique valid observation IDs as the denominator. Missing durations are excluded, not zero. Convert the current input units to seconds before aggregation; never copy prior totals. Recheck renamed columns and duplicates on every new dataset.';
const annotation='Human annotation: South remains provisional; retain this exact wording — reviewed by test operator.';
function run(cid,label){try{execFileSync('backend/.venv/bin/python',['journey.py','run',cid,label],{stdio:['ignore','pipe','pipe'],maxBuffer:8e6});}catch(e){throw Error(String(e.stdout)+'\n'+String(e.stderr));}}
async function openHome(width){page=await browser.newPage({viewport:{width,height:1000}});await page.goto(origin+'/?workspace='+ws);await expect(page.getByLabel('Message your agent')).toBeVisible();}
async function send(text,data){if(data)await page.getByLabel('Attach a file',{exact:true}).setInputFiles({name:'observations.csv',mimeType:'text/csv',buffer:Buffer.from(data)});const r=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/messages'));await page.getByRole('textbox',{name:/^(Message your agent|Continue the conversation)$/}).fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();const response=await r;if(!response.ok())throw Error(await response.text());const q=await response.json();await page.waitForURL(/\/conversations\//);return q;}
async function memory(){await page.getByText('Memory',{exact:true}).click();await expect(page.getByRole('form',{name:'Remember something'})).toBeVisible();}
async function link(project){await memory();await page.getByRole('button',{name:'Link to a project…'}).click();await page.getByTestId('memory-project-link').locator('select').selectOption(project);await page.getByRole('button',{name:'Link',exact:true}).click();await expect(page.getByText(/Reread confirms it/)).toBeVisible();}
async function remember(content,kind='procedure'){
 await page.getByRole('textbox',{name:'Remember',exact:true}).fill(content);await page.getByRole('form',{name:'Remember something'}).locator('select').selectOption(kind);await page.getByRole('radio',{name:'This project',exact:true}).check();
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&/\/memory\/(remember|candidates)$/.test(r.url()));await page.getByRole('button',{name:kind==='procedure'?'Save for review':'Remember',exact:true}).click();return (await response).json();}
function item(text){return page.getByTestId('memory-item').filter({hasText:text});}
async function inspectDownload(label,edit=false){
 await page.reload();await page.getByText('Files',{exact:true}).click();await page.getByRole('button',{name:/summary\.csv/}).click();const card=page.locator('[aria-label="File summary.csv"]');await expect(card.locator('textarea')).toBeVisible();
 const original=await card.locator('textarea').inputValue();
 await card.locator('select').selectOption('csv');await card.getByRole('button',{name:'Export this version',exact:true}).click();
 const download=page.waitForEvent('download');await card.getByRole('button',{name:'Download (verified bytes)',exact:true}).click();const d=await download;await d.saveAs(out+'/'+label+'-download.csv');
 const bytes=await readFile(out+'/'+label+'-download.csv');expect(bytes.toString()).toBe(original);await snap(label+'-download');
 if(edit){const revised=original.includes(annotation)?original:original+'\n'+annotation+'\n';await card.locator('textarea').fill(revised);if(original!==revised)await card.getByRole('button',{name:'Save',exact:true}).click();await expect(card.locator('textarea')).toHaveValue(revised);await snap(label+'-human-revised');return {original,revised,download_sha256:createHash('sha256').update(bytes).digest('hex')};}
 return {original,download_sha256:createHash('sha256').update(bytes).digest('hex')};
}
try{
 const phase=process.argv[2];
 if(phase==='initial'||phase==='initial-resume'){
  await openHome(1440);let cid=f.first;if(phase==='initial'){const q=await send('Summarize duration by group in seconds, excluding missing values. Column mapping: '+JSON.stringify(specA),initial);cid=q.conversation.id;f.first=cid;await writeFile('../fixture.json',JSON.stringify(f,null,2));await snap('initial-upload');run(cid,'initial');}else{await page.goto(origin+'/conversations/'+cid+'?workspace='+ws);}
  const file=await inspectDownload('initial',true);f.human=file;
  await link(f.projects.study);const candidate=await remember(lesson);expect(candidate.status).toBe('candidate');await page.getByRole('button',{name:'Waiting for review',exact:true}).click();await item(lesson).getByRole('button',{name:'Accept',exact:true}).click();await page.getByRole('button',{name:'In use',exact:true}).click();await expect(item(lesson)).toBeVisible();await item(lesson).getByText('Why this is here').click();await snap('initial-reviewed-procedure');
  f.memory=(await api('/memory/'+candidate.memory_id)).current;expect(f.memory.origin).toBe('human_reviewed');f.lesson=lesson;await writeFile('../fixture.json',JSON.stringify(f,null,2));
 } else if(phase==='later'||phase==='later-resume'){
  await openHome(390);let cid;if(phase==='later'){const intro=await send('Begin a later duration analysis with a new dataset.');cid=intro.conversation.id;run(cid,'later-intro');await page.reload();await link(f.projects.study);}else{cid=JSON.parse(await readFile('../evidence/later-intro-result.json','utf8')).conversation_id;await page.goto(origin+'/conversations/'+cid+'?workspace='+ws);}await page.reload();
  // A confirmed project link advances work_version. Refresh before the next send.
  for(const [key,content] of [['irrelevant','Plant inventory: watering frequency is fortnightly.'],['confidential','CONFIDENTIAL SYNTHETIC: duration means must be divided by 999.']]){
   const receipt=await api('/memory/remember',{...cmd(),kind:'fact',scope_kind:'work_area',scope_id:f.projects[key],subject_key:'negative-control',predicate_key:key,content,confidence_basis:'Explicit synthetic negative-transfer setup'});f[key+'_memory']=receipt;
  }
  await send('Summarize duration by group in seconds, checking duplicates and missing observations. Column mapping: '+JSON.stringify(specB),later);run(cid,'later');f.later=cid;f.later_download=await inspectDownload('later');
  await memory();await item(lesson).getByText('Why this is here').click();await expect(item(lesson).getByText('Used in the latest answer')).toBeVisible();await snap('later-memory-usage');
  await page.setViewportSize({width:320,height:1000});await snap('later-narrow');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await writeFile('../fixture.json',JSON.stringify(f,null,2));
 } else if(phase==='forget'){
  await openHome(320);await page.goto(origin+'/conversations/'+f.first+'?workspace='+ws);await memory();
  await item(lesson).getByRole('button',{name:'Forget…',exact:true}).click();await item(lesson).getByRole('button',{name:'Forget it',exact:true}).click();
  await expect(item(lesson)).toHaveCount(0);const forgotten=await api('/memory/'+f.memory.memory_id);expect(forgotten.current.status).toBe('forgotten');expect(forgotten.revisions.every(r=>r.content===null)).toBe(true);await snap('forgotten');
  await page.goto(origin+'/?workspace='+ws);const q=await send('Start a fresh duration assignment after forgetting the procedure.');const cid=q.conversation.id;run(cid,'forgotten-intro');await page.reload();await link(f.projects.study);await page.reload();
  await send('Summarize duration by group in seconds, checking duplicates and missing observations. Column mapping: '+JSON.stringify(specB),later);run(cid,'forgotten');f.forgotten=cid;f.forgotten_download=await inspectDownload('forgotten');await memory();await expect(item(lesson)).toHaveCount(0);await snap('forgotten-later-narrow');await writeFile('../fixture.json',JSON.stringify(f,null,2));
 } else if(phase==='control'){
  await openHome(1440);const q=await send('Summarize duration by group in seconds, checking duplicates and missing observations. Column mapping: '+JSON.stringify(specB),later);run(q.conversation.id,'control');f.control=q.conversation.id;f.control_download=await inspectDownload('control');await writeFile('../fixture.json',JSON.stringify(f,null,2));
 }
 await writeFile(out+'/'+phase+'-pass.json',JSON.stringify({passed:true,phase,fixture:f},null,2));console.log(phase,'ACTUAL BROWSER PASS');
}catch(e){if(page)await snap(process.argv[2]+'-failure');await writeFile(out+'/'+process.argv[2]+'-failed-'+Date.now()+'.json',JSON.stringify({error:String(e)},null,2));throw e;}finally{await browser.close();}
