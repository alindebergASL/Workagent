#!/usr/bin/env node
// Real production UI over an explicitly identified saved generated artifact.
// Read-only: filtering/refresh/reopen must never rewrite saved criteria or notes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require=createRequire(path.join(root,'web/package.json'));
const {chromium,expect}=require('@playwright/test');
const [artifactPath,output]=process.argv.slice(2);
assert(artifactPath&&output,'Usage: verify_criteria_view.mjs saved-artifact.json output-dir');
const out=path.resolve(output);await mkdir(out,{recursive:true});
const origin=process.env.WORKAGENT_WEB_ORIGIN||'http://127.0.0.1:3163';
const seed=JSON.parse(await readFile(artifactPath,'utf8'));
const prefix=origin+'/api/domain/v1/workspaces/flexible-proof';
async function api(id){const r=await fetch(prefix+'/artifacts/'+id,{headers:{'X-Workagent-Client':'local-ui'}});assert.equal(r.status,200);return r.json();}
const view=await api(seed.id);assert.deepEqual(view.current_revision,seed.current_revision);
const table=await api(view.current_revision.body.bindings[0].artifact_id);
const originalTable=await api('167c057f-3ff9-432a-930c-0bdc46841664');
const originalView=await api('597739cf-363b-49ea-becb-decf484c452c');
assert.deepEqual(table.current_revision.body,originalTable.current_revision.body);
const url=`${origin}/conversations/${view.conversation_id}/artifacts/${view.id}`;
const checks=[],actions=[],errors=[],writes=[];
let operation='idle',expectedActions=0;
async function withRead(page,label,act){
 operation=label;expectedActions++;
 const response=page.waitForResponse(r=>r.url().endsWith('/view-actions'));
 await act();assert.equal((await response).status(),200);
}
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH}:{})});
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method())&&!r.url().endsWith('/view-actions'))writes.push({method:r.method(),url:r.url()});});
 page.on('response',r=>{if(r.url().endsWith('/view-actions'))actions.push({operation,status:r.status()});});
 for(const [name,width,height] of [['desktop',1440,1000],['phone',390,844]]){
  await page.setViewportSize({width,height});await withRead(page,`${name}:initial`,()=>page.goto(url));
  await expect(page.locator('.view-trust')).toContainText('hasn’t been verified');
  const f=page.frameLocator('iframe');await expect(f.locator('#status')).toContainText('Saved revision loaded');
  await expect(f.locator('#budget')).toHaveValue('300');
  await expect(f.getByRole('heading',{name:'Original saved-assessment criteria',exact:true})).toBeVisible();
  await expect(f.getByRole('heading',{name:'Temporary/current filters',exact:true})).toBeVisible();
  for(const budget of ['300','350']){
   await f.locator('#budget').selectOption(budget);
   const rows=table.current_revision.body.rows.map(row=>({id:row.row_id,c:Object.fromEntries(row.cells.map(c=>[c.field_key,c.value]))}));
   const matches=rows.filter(({c})=>Number(c.hire_cost)<=Number(budget)&&c.capacity>=70&&c.step_free===true).length;
   await expect(f.locator('#count')).toHaveText(`${matches} of ${rows.length} venues match the current filter. 0 have unknown match status.`);
   await expect(f.locator('#criteria')).toContainText(`£${budget} GBP`);
   for(const {id,c} of rows){
    const card=f.locator(`article[data-row-id="${id}"]`);
    await expect(card.getByRole('heading',{name:c.venue,exact:true})).toBeVisible();
    const match=Number(c.hire_cost)<=Number(budget)&&c.capacity>=70&&c.step_free===true;
    await expect(card.getByText(`Local result — Matches current filter: ${match?'Yes':'No'}`,{exact:true})).toBeVisible();
    await expect(card.locator('.saved')).toContainText('Saved assessment (static, original task)');
    await expect(card.locator('.saved')).toContainText('hire cost at most £300 GBP; capacity at least 70 people; step-free access required.');
    await expect(card.locator('.saved').getByText(c.assessment,{exact:true})).toBeVisible();
    if(typeof c.venue_notes==='string')await expect(card.getByText(c.venue_notes,{exact:true})).toBeVisible();
    else await expect(card.getByText('No human note supplied (unknown).',{exact:true})).toBeVisible();
   }
   await withRead(page,`${name}:${budget}:refresh`,()=>f.getByRole('button',{name:'Refresh saved data',exact:true}).click());
   await expect(f.locator('#status')).toContainText('Saved revision loaded');await expect(f.locator('#budget')).toHaveValue(budget);
   await expect(f.locator('#count')).toContainText(`${matches} of ${rows.length}`);
   await f.locator('h1').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`${name}-${budget}-overview.png`),fullPage:true});
   const willow=f.locator('article').filter({has:f.getByRole('heading',{name:'Willow Hall',exact:true})});
   await willow.screenshot({path:path.join(out,`${name}-${budget}-willow.png`)});
   checks.push({viewport:name,budget,match_count:matches,adjacent_original_criteria:true,exact_saved_assessments_and_notes:true,refresh_preserves_filter:true});
  }
  await withRead(page,`${name}:reload`,()=>page.reload());await expect(f.locator('#status')).toContainText('Saved revision loaded');await expect(f.locator('#budget')).toHaveValue('300');
  await page.goto(origin);await withRead(page,`${name}:reopen`,()=>page.goto(url));await expect(f.locator('#status')).toContainText('Saved revision loaded');await expect(f.locator('#budget')).toHaveValue('300');
  const shellSize=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(shellSize.scroll<=shellSize.width+2);
  const inner=page.frames().find(x=>x!==page.mainFrame());const innerSize=await inner.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(innerSize.scroll<=innerSize.width+2);
  await page.getByText('Readable version',{exact:true}).first().click();await expect(page.locator('.view-fallback').first()).toContainText(view.current_revision.body.fallback);
  checks.push({viewport:name,reload_and_reopen_reset_temporary_filter:true,shell_and_frame_no_horizontal_overflow:true,explicit_criteria_fallback:true});
 }
 for(const a of [view,table,originalTable,originalView]){const after=await api(a.id);assert.deepEqual(after.current_revision,a.current_revision);assert.equal(after.current_revision_id,a.current_revision_id);}
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert(actions.every(a=>a.status===200));assert.equal(actions.length,expectedActions);assert.equal(new Set(actions.map(a=>a.operation)).size,expectedActions);
 await writeFile(path.join(out,'verification.json'),JSON.stringify({mode:'production_ui_real_api_live_generated_view_over_replayed_saved_source',artifact_id:view.id,revision_id:view.current_revision_id,body_hash:view.current_revision.body_hash,originals_unchanged:true,saved_mutations:0,provider_calls_by_browser:0,checks,actions,errors,writes},null,2)+'\n');
 console.log(JSON.stringify({passed:checks.length,checks,originals_unchanged:true}));
}finally{await browser.close();}
