import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const root='<FOLLOWUP_WORKTREE>';
const out='<FOCUSED_RESULTS>';
const { chromium, expect }=createRequire(root+'/web/package.json')('@playwright/test');
const origin='http://127.0.0.1:3000';
const get=async path=>{const r=await fetch(origin+'/api/domain/v1/workspaces/local-workspace'+path,{headers:{'X-Workagent-Client':'local-ui'}});expect(r.ok).toBe(true);return r.json()};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];const sent=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);
 await page.getByLabel('Message your agent').fill('Focused real UI follow-up: retain my revision instruction.');
 await page.getByRole('button',{name:/^Your context/}).click();
 for(const title of ['Personal intake review log','Method notebook','Personal working plan'])await page.getByLabel(title,{exact:false}).check();
 await page.getByRole('button',{name:'Start work',exact:true}).click();await page.waitForURL(/\/assignments\/[^/]+$/);
 const assignmentId=page.url().split('/').pop();const initial=await get('/assignments/'+assignmentId);expect(initial.run_ids).toHaveLength(1);
 execFileSync(root+'/backend/.venv/bin/python',['-m','workagent.fixture','work','--workspace','local-workspace','--run',initial.run_ids[0]],{cwd:root+'/backend',env:process.env,stdio:'pipe'});
 await page.getByRole('link',{name:'Open plan',exact:true}).click({timeout:15000});await page.waitForURL(/\/artifacts\/[^/]+$/);
 const artifactId=page.url().split('/').pop();const before=await get('/artifacts/'+artifactId);
 await page.getByRole('button',{name:'Ask for a revision',exact:true}).click();
 const draft='Add a default owner; keep my exact private planning note.';
 await page.getByLabel('What should change?').fill(draft);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===1440?1000:844});
  if(width===390)await page.locator('.working-switch').getByRole('button',{name:'Agent',exact:true}).click();
  await page.getByRole('button',{name:'Keep for later',exact:true}).click();
  await expect(page.getByLabel('What should change?')).toHaveCount(0);
  const resume=page.getByRole('button',{name:'Resume your request',exact:true});await expect(resume).toBeVisible();await expect(resume).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:out+'/real-collapse-'+width+'.png',fullPage:true});
  await resume.click();await expect(page.getByLabel('What should change?')).toHaveValue(draft);await expect(page.getByLabel('What should change?')).toBeFocused();
 }
 await page.route('**/artifacts/*/request-revision',async route=>{
  sent.push(route.request().postDataJSON());
  if(sent.length===1){const response=await route.fetch();expect(response.status()).toBe(202);await route.abort('failed');}
  else await route.continue();
 });
 await page.getByRole('button',{name:'Send request',exact:true}).click();
 await expect(page.getByText('Couldn’t reach the service',{exact:true})).toBeVisible();await expect(page.getByLabel('What should change?')).toBeDisabled();
 await page.getByRole('button',{name:'Keep for later',exact:true}).click();
 await expect(page.getByText('Your last send wasn’t confirmed. Resume to retry the same request.',{exact:true})).toBeVisible();
 await expect(page.getByLabel('What should change?')).toHaveCount(0);
 await page.screenshot({path:out+'/real-committed-response-loss-collapsed.png',fullPage:true});
 await page.getByRole('button',{name:'Resume your request',exact:true}).click();
 await expect(page.getByLabel('What should change?')).toHaveValue(draft);await expect(page.getByLabel('What should change?')).toBeDisabled();
 await page.getByRole('button',{name:'Send request',exact:true}).click();await expect(page.getByLabel('What should change?')).toHaveCount(0);
 expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);
 const after=await get('/assignments/'+assignmentId);expect(after.run_ids).toHaveLength(2);
 const current=await get('/artifacts/'+artifactId);expect(current.current_revision_id).toBe(before.current_revision_id);expect(current.current_revision.body_hash).toBe(before.current_revision.body_hash);
 expect(errors).toEqual([]);
 await writeFile(out+'/real-ui-followup.json',JSON.stringify({passed:true,mode:'real_ui_api_postgresql_fixture',assignment_id:assignmentId,artifact_id:artifactId,collapsed_and_resumed_widths:[1440,390],committed_202_dropped:true,identical_full_command_retried:true,request_count:sent.length,admitted_revision_runs:after.run_ids.length-initial.run_ids.length,same_current_revision:true,same_current_body_hash:true,provider_calls:0,errors},null,2)+'\n');
 console.log('PASS: real desktop/mobile collapse-resume preserves text/focus; dropped committed 202 retries exact command once with one revision admission and unchanged artifact.');
}finally{await browser.close();}
