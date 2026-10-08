#!/usr/bin/env node
/** Read-only completion of the already-resumed run06 proof; never admits work. */
import { chromium, expect } from '../web/node_modules/@playwright/test/index.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readProposal } from './adaptive_proposal_readback.mjs';
import path from 'node:path';
const prior=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
await mkdir(out,{recursive:true,mode:0o700});
const read=async n=>JSON.parse(await readFile(path.join(prior,n),'utf8'));
const config=await read('manifest.json'),failed=await read('browser-evidence.json');
const authority=await read('authority.json');
const uiSha=process.env.WORKAGENT_REVIEW_SHA;
expect(uiSha,'Explicit tested UI build SHA is required; never guess provenance').toMatch(/^[0-9a-f]{40}$/);
expect(authority.candidate_sha,'Original runtime SHA comes from retained admission record').toMatch(/^[0-9a-f]{40}$/);
const ids=await read('conversation-ids.json');
const origin=process.env.WORKAGENT_REVIEW_ORIGIN || config.origin,base=origin+'/api/domain/v1/workspaces/local-workspace';
const headers={'X-Workagent-Client':'local-ui'};
const get=async p=>{const r=await fetch(base+p,{headers});expect(r.ok,`${p}: HTTP ${r.status}`).toBe(true);return r.json();};
const hash=x=>createHash('sha256').update(x).digest('hex');
const product=(d,k)=>d.messages.filter(x=>x.author_kind==='assistant').at(-1).result.results.find(x=>x.kind===k);
const before=await read('audit-before-resume.json'),after=await read('audit-recovery-readback.json');
expect(after.dispatches).toEqual(before.dispatches);expect(after.identities).toEqual(before.identities);
expect(after.counts.dispatch).toBe(6);expect(after.counts.count_send).toBe(6);
expect(after.counts.read).toBe(before.counts.read+1);expect(after.counts.result).toBe(before.counts.result+1);
expect(after.budget.reserved_cost_usd).toBe(before.budget.reserved_cost_usd);
expect(failed.interruption.interrupted_before_completion).toBe(true);
const d=await get('/conversations/'+ids.tool),csv=await get('/conversations/'+ids.csv);
const old=await read('turn-'+ids.tool+'-4.json');expect(d).toEqual(old);
const run=d.runs.at(-1),result=product(d,'tool');expect(run.state).toBe('ready');
expect(run.id).toBe(failed.turns.at(-1).run_id);
expect(d.messages.filter(m=>m.author_kind==='assistant'&&m.run_id===run.id)).toHaveLength(1);
const art=await get('/artifacts/'+result.artifact_id),proposal=await readProposal(get,result.artifact_id,result.proposal_id);
expect(proposal.status).toBe('pending');expect(proposal.base_revision_id).toBe(art.current_revision_id);
expect(art.current_revision.author_kind).toBe('human');
expect(art.current_revision.body.notes).toEqual([config.human_note]);expect(proposal.body.notes).toEqual(art.current_revision.body.notes);
expect(proposal.body.code).not.toBe(art.current_revision.body.code);
const obs=await get('/observations/'+result.observation_id);
expect(obs.observation.output.value).toBe('118264581564861424');
const verification=d.turns.at(-1).adaptive.steps.at(-1).verification;
expect(verification.basis).toBe('independent_bounded');expect(verification.automatic.passed).toBe(true);expect(verification.automatic.case_count).toBe(1891);
expect(csv.turns.at(-1).adaptive.steps.at(-1).verification.automatic.row_count).toBe(6);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await context.newPage();const errors=[],writes=[];
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/api/domain/**',async route=>{
 if(!['GET','HEAD'].includes(route.request().method())){writes.push(route.request().method()+' '+route.request().url());return route.abort();}
 return route.continue();
});
const url=origin+'/conversations/'+ids.tool+'/artifacts/'+art.id;
try{
 await page.goto(url);
 await expect(page.getByTestId('product-proposal')).toBeVisible();
 await expect(page.getByTestId('proposal-result')).toContainText('118264581564861424');
 await expect(page.getByLabel('Your notes (one per line)')).toHaveValue(config.human_note);
 await expect(page.getByRole('button',{name:'Apply proposed version',exact:true})).toBeVisible();
 await page.screenshot({path:path.join(out,'resumed-proposal-desktop.png'),fullPage:true});
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download proposed file',exact:true}).click();
 const file=path.join(out,'proposed-team-calculator.wat');await(await pending).saveAs(file);
 expect(await readFile(file,'utf8')).toBe(proposal.body.code);
 expect((await readProposal(get,art.id,proposal.id)).status).toBe('pending');
 expect((await get('/artifacts/'+art.id)).current_revision_id).toBe(art.current_revision_id);
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByTestId('product-proposal')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:path.join(out,'resumed-proposal-phone.png'),fullPage:true});
 await page.goto(origin+'/conversations/'+ids.csv+'/artifacts/'+product(csv,'table').artifact_id);
 const csvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved file',exact:true}).click();
 const csvFile=path.join(out,'verified-invoices.csv');await(await csvDownload).saveAs(csvFile);
 await page.screenshot({path:path.join(out,'verified-csv-phone.png'),fullPage:true});
 expect(errors).toEqual([]);expect(writes).toEqual([]);
 expect(await get('/conversations/'+ids.tool)).toEqual(d);
 const evidence={passed:true,scope:'read-only completion of original interrupted/resumed live journey; not a new interruption',
 application_sha:authority.candidate_sha,ui_sha:uiSha,sha_provenance:{runtime:'retained original admission record',ui:'explicit operator-supplied build SHA; validated separately against served build, not discovered by this script'},failure_classification:'harness requested nonexistent proposal GET; canonical artifact-scoped readback works',
 original_interruption:failed.interruption,same_run:true,one_assistant_result:true,proposal_pending:true,saved_human_note_preserved:true,saved_revision_unchanged:true,
 downtime_draft:{observed_in_original_harness:'phone Work/Conversation switch plus reload while worker stopped',after_worker_resume:'not asserted: original browser closed after run06 failure; no recreated draft presented as original'},
 model_changed_code:true,wrong_observed_value:failed.introduced_obstacle.actual,repaired_observed_value:obs.observation.output.value,
 verification:{basis:verification.basis,scope:verification.automatic.scope,case_count:verification.automatic.case_count,row_count:6},
 continuity:{before_counts:before.counts,after_counts:after.counts,same_dispatches:true,same_response_id_hashes:true,reserved_before:before.budget.reserved_cost_usd,reserved_after:after.budget.reserved_cost_usd,unknown_usage_steps_before:before.budget.unknown_usage_steps,unknown_usage_steps_after:after.budget.unknown_usage_steps},
 proposal_download_sha256:hash(await readFile(file)),csv_download_sha256:hash(await readFile(csvFile)),download_did_not_accept:true,console_errors:errors,mutating_browser_requests:writes,review_url:url};
 await writeFile(path.join(out,'readback-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 console.log(JSON.stringify(evidence));
}finally{await browser.close();}
