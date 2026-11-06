import {chromium,expect} from '../../../web/node_modules/@playwright/test/index.mjs';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {scopedHeaders} from '../../../web/scripts/lib/scope.mjs';
const root=process.cwd(),base='.local/batch3/b32a',file=base+'/native-fixture.json',f=JSON.parse(await readFile(file,'utf8')),ws=f.workspace_id,origin='http://127.0.0.1:13234',out=base+'/evidence/browser';await mkdir(out,{recursive:true});
const headers=await scopedHeaders(origin,{'X-Workagent-Client':'local-ui'});
const api=async p=>{const r=await fetch(origin+'/api/domain/v1/workspaces/'+ws+p,{headers});if(!r.ok)throw Error(await r.text());return r.json()};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);let cid=f.browserdoc;const proof={passed:false,responses:[]};page.on('response',r=>{if(r.url().includes('/research/'))proof.responses.push({url:r.url(),status:r.status()})});
async function snap(name,full=false){await page.screenshot({path:out+'/'+name+'.png',fullPage:full});await writeFile(out+'/'+name+'.txt',await page.locator('body').innerText());}
async function expand(){const d=page.getByTestId('research-claims');await expect(d).toBeVisible({timeout:30000});if(await d.getAttribute('open')===null)await d.locator(':scope > summary').click();}
async function send(p,text){const ack=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/messages'));await p.getByRole('textbox',{name:/^(Message your agent|Continue the conversation)$/}).fill(text);await p.getByRole('button',{name:'Send',exact:true}).click();const r=await ack;if(!r.ok())throw Error(await r.text());return r.json();}
async function run(mode){const fd=await open(base+'/browserdoc-'+mode+'-worker.log','w');const r=spawnSync(root+'/backend/.venv/bin/python',[base+'/journey.py','run',cid,mode,'browserdoc-'+mode],{env:process.env,stdio:['ignore',fd.fd,fd.fd],timeout:180000});await fd.close();if(r.status!==0)throw Error('worker '+mode+' exit '+r.status);}
try{
 await page.goto(origin+'/?workspace='+ws);await expect(page.getByLabel('Message your agent')).toBeVisible({timeout:30000});
 if(!cid){const ack=await send(page,'Prepare an editable east-depot assessment document; we will capture the public evidence separately. Do not assert an organization-wide conclusion.');cid=ack.conversation.id;const latest=JSON.parse(await readFile(file,'utf8'));latest.browserdoc=cid;await writeFile(file,JSON.stringify(latest,null,2));await snap('document-home-request');await run('document');}
 await page.goto(origin+'/conversations/'+cid+'?workspace='+ws);await expect(page.getByRole('textbox',{name:'Continue the conversation'})).toBeVisible({timeout:30000});
 if(!process.env.B32A_DOC_RESUME){
 await send(page,'Capture https://fixture.example/source as untrusted primary source evidence.');await run('captureonly');await page.reload();await expect(page.getByRole('textbox',{name:'Continue the conversation'})).toBeVisible({timeout:30000});
 await send(page,'Cite the exact current saved document; keep the 99-unit all-depots claim unsupported.');await run('doccite');
 }
 if(process.env.B32A_STALE_RETRY){await send(page,'Cite the newest 12-unit source against this exact saved document, keeping unsupported extrapolations explicit.');await run('doccite_latest');await page.reload();}
 await expand();await page.getByRole('button',{name:'Refresh citations'}).click();await expand();await expect(page.locator('[data-freshness="current"][data-semantic="not_assessed"]')).toHaveCount(1,{timeout:30000});
 await page.getByRole('button',{name:'Check against the capture'}).first().click();await expect(page.getByTestId('quote-matches')).toBeVisible();await page.getByText('Cited capture',{exact:true}).click();await page.getByText('Cited capture',{exact:true}).scrollIntoViewIfNeeded();await snap('document-original-capture');
 const before=await api('/conversations/'+cid);const art=await api('/artifacts/'+before.artifact_ids[0]);proof.bindingBefore={artifact:art.id,revision:art.current_revision.id,body_hash:art.current_revision.body_hash,body:art.current_revision.body};
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await page.getByRole('button',{name:'Refresh citations'}).scrollIntoViewIfNeeded();await snap('document-citations-'+width);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.__b32a_mounted='same-document');
 const initialStale=await page.locator('[data-freshness="potentially_stale"]').count();let releasePoll;const pollGate=new Promise(resolve=>releasePoll=resolve);
 // Delay only genuine background conversation reads, not research requests or
 // response bodies. Isolate the explicit metadata-refresh control from polling.
 await page.route('**/api/domain/**',async route=>{const r=route.request();if(r.method()==='GET'&&!r.url().includes('/research/'))await pollGate;await route.continue().catch(()=>{});});
 const steering=await browser.newPage();await steering.goto(origin+'/conversations/'+cid+'?workspace='+ws);await expect(steering.getByRole('textbox',{name:'Continue the conversation'})).toBeVisible({timeout:30000});await send(steering,'Refresh the source after its capacity change; preserve the exact saved document.');await run('docrefresh');await steering.close();
 expect(await page.locator('[data-freshness="potentially_stale"]').count()).toBe(initialStale);
 await page.getByRole('button',{name:'Refresh citations'}).click();await expect(page.locator('[data-freshness="potentially_stale"]')).toHaveCount(initialStale+1,{timeout:30000});await expand();expect(await page.evaluate(()=>window.__b32a_mounted)).toBe('same-document');proof.delayed_real_background_reads=true;
 await page.getByRole('button',{name:'Refresh citations'}).scrollIntoViewIfNeeded();await snap('document-mounted-refresh-stale');
 const after=await api('/artifacts/'+art.id);expect(after.current_revision).toEqual(art.current_revision);proof.bindingAfter={revision:after.current_revision.id,body_hash:after.current_revision.body_hash};
 // The source was loaded above. Re-read claims to clear only its loaded capture,
 // then revoke the source grant; the next capture check returns canonical 404.
 await page.getByRole('button',{name:'Refresh citations'}).click();await expand();await expect(page.getByRole('button',{name:'Check against the capture'}).first()).toBeVisible();
 const initial=JSON.parse(await readFile(base+'/evidence/browserdoc-captureonly-result.json','utf8'));
 const code='import os; from workagent.db import Database; from pathlib import Path; import json; g=json.loads(Path("'+base+'/evidence/browserdoc-captureonly-result.json").read_text())["grant_id"];\nwith Database(os.environ["MIGRATION_DATABASE_URL"]).transaction() as c:\n c.execute("UPDATE tool_grants SET active=false WHERE id=%s",(g,)); assert not c.execute("SELECT active FROM tool_grants WHERE id=%s",(g,)).fetchone()["active"]';
 const revoke=spawnSync(root+'/backend/.venv/bin/python',['-c',code],{env:process.env,encoding:'utf8'});if(revoke.status!==0)throw Error(revoke.stderr);
 const originalCapture=JSON.parse(await readFile(base+'/evidence/browserdoc-captureonly-observations.json','utf8'))[0].data.output.result.snapshot.snapshot_id;
 const denial=page.waitForResponse(r=>r.url().includes('/research/snapshots/'+originalCapture)&&r.status()===404);await page.locator('[data-snapshot="'+originalCapture+'"]').getByRole('button',{name:'Check against the capture'}).click();await denial;
 await expect(page.locator('.research-quote')).toHaveCount(0);await expect(page.locator('.research-claim')).toHaveCount(0);await expect(page.getByTestId('claims-error')).toContainText('These sources aren’t available to you now.');await snap('document-real404-cleared');
 releasePoll();proof.passed=true;proof.conversation_id=cid;proof.revoked_source_grant=initial.grant_id;console.log('PASS actual mounted 1440/390/320 citations, unsupported claim, exact source, stale refresh without reload, real canonical404 clears quotes.');
}catch(e){await snap('document-failure-'+Date.now(),true);throw e;}finally{await writeFile(out+'/document-proof.json',JSON.stringify(proof,null,2));await browser.close();}
