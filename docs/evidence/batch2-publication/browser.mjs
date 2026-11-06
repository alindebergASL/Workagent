// Real browser/API/PostgreSQL smoke. All content is synthetic; no model worker.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const root=process.cwd(),req=createRequire(root+'/web/package.json');
const {chromium,expect}=req('@playwright/test');
const out=root+'/docs/evidence/batch2-publication';
const f=JSON.parse(await fs.readFile(out+'/fixture.json','utf8'));
const origin='http://127.0.0.1:3197';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const report={status:'RUNNING',checks:[],page_errors:[],external_requests:[]};
let scope;
page.on('request',r=>{const value=r.headers()['x-workagent-scope'];if(value)scope=value;});
page.on('pageerror',e=>report.page_errors.push(String(e)));
await page.route('**/*',r=>{if(new URL(r.request().url()).origin===origin)return r.continue();report.external_requests.push(r.request().url());return r.abort();});
const get=async path=>{expect(scope).toMatch(/^[a-f0-9]{64}$/);const r=await fetch(origin+'/api/domain/v1/workspaces/'+f.workspace+path,{headers:{'X-Workagent-Client':'local-ui','X-Workagent-Scope':scope}});expect(r.status).toBe(200);return r.json();};
try{
 await page.goto(origin+'/?workspace='+f.workspace);
 await expect(page.getByText('Publication smoke — volunteer garden').first()).toBeVisible();
 report.checks.push('Home lists fresh canonical conversation through real proxy');
 const url=origin+'/conversations/'+f.conversation+'/artifacts/'+f.artifact+'?workspace='+f.workspace;
 await page.goto(url);await page.locator('#work-tab-edit').click();
 const note=page.getByTestId('notes-list').locator('textarea');
 await expect(note).toHaveValue(f.body.notes[0]);
 const before=await get('/artifacts/'+f.artifact);
 const changed='Human note: keep Saturday morning. Verified in publication smoke.';
 await note.fill(changed);await page.getByRole('button',{name:'Save my edits',exact:true}).click();
 await expect.poll(async()=> (await get('/artifacts/'+f.artifact)).current_revision.body.notes[0]).toBe(changed);
 const after=await get('/artifacts/'+f.artifact);expect(after.current_revision_id).not.toBe(before.current_revision_id);
 await page.reload();await page.locator('#work-tab-edit').click();await expect(note).toHaveValue(changed);
 report.checks.push('Real browser human save persists new revision and survives reload');
 report.before_revision=before.current_revision_id;report.after_revision=after.current_revision_id;report.after_body_hash=after.current_revision.body_hash;
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});
  await expect(note).toHaveValue(changed);
  const geometry=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth}));
  expect(geometry.body).toBeLessThanOrEqual(geometry.viewport);
  await page.screenshot({path:out+'/runtime-'+width+'.png',fullPage:true});
  await fs.writeFile(out+'/runtime-'+width+'.txt',await page.locator('body').innerText());
  report.checks.push('Saved human edit visible at '+width+'px without page overflow');
 }
 expect(report.page_errors).toEqual([]);expect(report.external_requests).toEqual([]);
 report.status='PASS';report.fixture=f.workspace;report.url=url;
}catch(e){report.status='FAIL';report.error=String(e.stack||e);process.exitCode=1;}
finally{await browser.close();await fs.writeFile(out+'/browser-verified-report.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report,null,2));}
