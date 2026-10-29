// Bounded production-bundle polling/identity-loss smoke. No domain mutations.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const root=process.cwd(),require=createRequire(root+'/web/package.json');
const {chromium,expect:base}=require('@playwright/test'),expect=base.configure({timeout:15000});
const out=root+'/docs/evidence/batch2-recovery5d/poll-correction';
const origin='http://127.0.0.1:3195',ws='recovery5a-workspace',cid='cb848ce6-e383-4dc8-b2dc-7721720e45e6';
const report={started:new Date().toISOString(),scope:'Actual production bundle + authenticated GETs; controlled SSE transport failure and session-unavailable fault; real delayed JSON body. Not a new real principal switch or membership revocation.',posts:[],errors:[],console:[],screenshots:[]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
await context.addInitScript(()=>{
 const original=window.fetch.bind(window);
 const state=window.__pollProof={requests:[],pollAccepted:false,bodyStarted:false,bodyReleased:false,fenceFault:false,streamFaults:0,pollCalls:0};
 let release;const held=new Promise(ok=>release=ok);
 window.__releasePoll=()=>{state.bodyReleased=true;release()};
 window.fetch=async(...args)=>{
  const url=String(args[0] instanceof Request?args[0].url:args[0]);
  state.requests.push({url,at:Date.now(),afterFence:state.fenceFault,method:args[1]?.method||'GET'});
  if(url.includes('/events/stream')){state.streamFaults++;throw new TypeError('Controlled SSE outage for poll-boundary proof')}
  if(url.endsWith('/v1/session')&&state.fenceFault)return new Response(JSON.stringify({code:'connection_required',message:'Controlled identity-unavailable fault'}),{status:503,headers:{'Content-Type':'application/json'}});
  const res=await original(...args);
  if(url.includes('/events?')){
   state.pollCalls++;state.pollStatus=res.status;
   if(res.ok&&state.pollCalls===1){
    state.pollAccepted=true;const json=res.json.bind(res);
    res.json=async()=>{state.bodyStarted=true;const body=await json();state.actualPage={count:body.events?.length,has_more:body.has_more,reset_required:body.reset_required};await held;return body};
   }
  }
  return res;
 };
});
page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))report.posts.push({method:r.method(),url:r.url()})});
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.console.push(m.text())});
async function identity(){const r=await context.request.get(origin+'/api/domain/v1/session',{headers:{'X-Workagent-Client':'local-ui'}});expect(r.status()).toBe(200);return r.json()}
async function canonical(scope){const r=await context.request.get(origin+'/api/domain/v1/workspaces/'+ws+'/conversations/'+cid,{headers:{'X-Workagent-Client':'local-ui','X-Workagent-Scope':scope}});return {status:r.status(),body:await r.json()}}
try{
 report.identity=await identity();expect(report.identity.principal_id).toBe('local-human');report.canonicalBefore=await canonical(report.identity.scope_id);expect(report.canonicalBefore.status).toBe(200);
 await page.goto(origin+'/conversations/'+cid+'?workspace='+ws);
 await expect(page.locator('textarea').first()).toBeVisible();
 const draft='Polling-fence private synthetic draft 雪\nnot sent\n';await page.locator('textarea').first().fill(draft);
 await expect.poll(()=>page.evaluate(()=>window.__pollProof.bodyStarted)).toBe(true);
 report.beforeFence=await page.evaluate(()=>window.__pollProof);expect(report.beforeFence.pollStatus).toBe(200);
 await page.evaluate(()=>{window.__pollProof.fenceFault=true;window.dispatchEvent(new Event('focus'))});
 await expect(page.locator('textarea')).toHaveCount(0);await expect(page.getByRole('status')).toContainText('Access for this page changed');
 report.fencedText=await page.locator('body').innerText();
 await page.evaluate(()=>window.__releasePoll());
 await page.waitForTimeout(2600);
 report.afterRelease=await page.evaluate(()=>window.__pollProof);
 expect(report.afterRelease.pollCalls).toBe(1);expect(report.afterRelease.streamFaults).toBe(1);
 expect(report.afterRelease.requests.filter(r=>r.afterFence&&!r.url.endsWith('/v1/session'))).toHaveLength(0);
 await expect(page.locator('textarea')).toHaveCount(0);
 expect(await page.locator('body').innerText()).not.toContain(draft);
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});
  const metrics=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  expect(metrics.document).toBeLessThanOrEqual(width);expect(metrics.body).toBeLessThanOrEqual(width);
  const name='fenced-'+width+'.png';await page.screenshot({path:out+'/'+name,fullPage:true});report.screenshots.push({name,...metrics});
 }
 report.canonicalAfter=await canonical(report.identity.scope_id);expect(report.canonicalAfter).toEqual(report.canonicalBefore);
 await page.reload();await expect(page.locator('textarea').first()).toHaveValue(draft);report.sameScopeReloadRecovery=true;
 expect(report.posts).toHaveLength(0);expect(report.errors).toEqual([]);report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e.stack||e);await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{report.finished=new Date().toISOString();await fs.writeFile(out+'/browser-report.json',JSON.stringify(report,null,2),{flag:'wx'});await context.close();await browser.close();console.log(JSON.stringify({status:report.status,error:report.error,posts:report.posts.length,errors:report.errors,screenshots:report.screenshots},null,2));}
