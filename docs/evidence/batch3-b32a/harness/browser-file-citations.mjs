// B3.2a harness (not app code): the ORIGINAL browser conversation's human-edited
// research-conclusion.txt, its mounted Files-editor citations consumer, exact
// saved revision/body hash, claims, stale warning and both captures at
// 1440/390/320. Read-only: no save, no tool/model call, no run re-entry.
// Usage (repo root): node .local/batch3/b32a/browser-file-citations.mjs <label>
import {chromium,expect} from '../../../web/node_modules/@playwright/test/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {scopedHeaders} from '../../../web/scripts/lib/scope.mjs';
const label=process.argv[2]??'run';
const f=JSON.parse(await readFile('.local/batch3/b32a/fixture.json','utf8')),ws=f.workspace_id,cid=f.browser,origin='http://127.0.0.1:13234',out='.local/batch3/b32a/evidence/browser',pre=out+'/file-citations-'+label+'-';await mkdir(out,{recursive:true});
const headers=await scopedHeaders(origin,{'X-Workagent-Client':'local-ui','x-schema-version':'workagent/v1'});
async function api(path){const r=await fetch(origin+'/api/domain/v1/workspaces/'+ws+path,{headers});if(!r.ok)throw Error(path+' '+r.status);return r.json();}
const sha=(s)=>createHash('sha256').update(s,'utf8').digest('hex');
const record={label,workspace_id:ws,conversation_id:cid,steps:[]};const step=(s,extra={})=>{record.steps.push({step:s,...extra});console.log('ok',s);};

// Canonical expectations from the service (frozen copies; nothing re-read for assertions).
const files=(await api('/work-areas/'+cid+'/files')).items;const file=structuredClone(files.find(x=>x.filename==='research-conclusion.txt'));
const snap=await api('/work-snapshot?conversation_id='+cid);const art=structuredClone(snap.artifacts.find(a=>a.current_revision_id===file.current.version_id));
if(!art)throw Error('no artifact whose current revision is the saved file version');
const claims=structuredClone(await api('/artifacts/'+art.id+'/revisions/'+art.current_revision_id+'/research/claims?body_hash='+art.body_hash));
const sources=structuredClone((await api('/work-areas/'+cid+'/research/snapshots')).items).sort((a,b)=>a.version_number-b.version_number);
if(sha(f.browser_human)!==file.current.sha256)throw Error('saved file sha is not the exact human UTF-8 body');
if(!claims.items.some(i=>i.claim.semantic_status==='unsupported'))throw Error('fixture lacks an unsupported claim');
if(!claims.items.some(i=>i.freshness==='potentially_stale'))throw Error('fixture lacks a potentially stale claim');
if(!claims.items.every(i=>i.claim.revision_id===art.current_revision_id&&i.claim.body_hash===art.body_hash))throw Error('claim binding mismatch');
Object.assign(record,{file,artifact:art,human_utf8_sha256:sha(f.browser_human),claims,sources:sources.map(s=>({snapshot_id:s.snapshot_id,version_number:s.version_number,original_sha256:s.original_sha256,extraction_sha256:s.extraction_sha256,url:s.locator.url,final_url:s.locator.final_url,coverage:s.coverage,extraction_status:s.extraction_status}))});

const b=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await b.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
const requests=[];page.on('request',r=>{const u=r.url();if(u.includes('/api/domain/'))requests.push(r.method()+' '+u.replace(origin,''));});
async function snapTo(name){await page.screenshot({path:pre+name+'.png',fullPage:true});await writeFile(pre+name+'.txt',await page.locator('body').innerText());}
const noOverflow=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
try{
 await page.goto(origin+'/conversations/'+cid+'?workspace='+ws);await expect(page.getByRole('textbox',{name:'Continue the conversation'})).toBeVisible();
 await page.getByRole('button',{name:'research-conclusion.txt',exact:true}).click();
 const editor=page.getByLabel('File research-conclusion.txt');const text=editor.locator('textarea');
 await expect(text).toHaveValue(f.browser_human);await expect(editor.getByText('Loading and verifying…')).toHaveCount(0);step('exact human textarea',{sha256:sha(await text.inputValue())});
 const cites=editor.getByTestId('file-citations');await expect(cites).toBeVisible();
 expect(await cites.getAttribute('data-revision')).toBe(art.current_revision_id);expect(await cites.getAttribute('data-body-hash')).toBe(art.body_hash);step('citations mounted on exact saved revision/body hash');
 const summary=cites.locator('summary',{hasText:'Sources for this version'});await expect(summary).toBeVisible();await summary.click();
 await expect(cites.locator('.research-claim')).toHaveCount(claims.items.length);step('claims rendered',{count:claims.items.length});
 await expect(cites.getByText('No supporting quote recorded for this claim').first()).toBeVisible();
 await expect(cites.getByTestId('stale-warning').first()).toBeVisible();await expect(cites.getByTestId('claims-stale-badge')).toBeVisible();step('unsupported claim + potentially stale warning');
 // Load every cited capture and newer capture; await the real loaded details, not a placeholder.
 for(let n=0;n<10;n++){const btn=cites.getByRole('button',{name:/^(Check against the capture|Show newer capture)$/}).first();if(!(await btn.count()))break;await btn.click();await page.waitForTimeout(300);}
 await expect(cites.getByRole('button',{name:/^(Check against the capture|Show newer capture)$/})).toHaveCount(0);
 const evidence=claims.items.flatMap(i=>i.claim.evidence);
 await expect(cites.getByTestId('quote-matches')).toHaveCount(evidence.length);await expect(cites.getByTestId('quote-mismatch')).toHaveCount(0);step('all cited quotes match exact captures',{quotes:evidence.length});
 // Open every nested disclosure (cited capture A, its capture details/text, newer capture B, claim records).
 for(let n=0;n<4;n++)await cites.evaluate(el=>el.querySelectorAll('details').forEach(d=>{d.open=true;}));
 await expect(cites.locator('details:not([open])')).toHaveCount(0);await expect(cites.getByText('Original capture:',{exact:false})).toBeVisible();
 const shown=await cites.innerText();const missing=[];
 const need=[art.current_revision_id,art.body_hash];
 for(const s of sources)need.push(s.snapshot_id,s.original_sha256,s.extraction_sha256,s.locator.final_url,'(version '+s.version_number);
 for(const e of evidence)need.push('Characters '+e.start+'–'+e.end+' of snapshot '+e.snapshot_id);
 for(const i of claims.items)need.push(i.claim.claim_id);
 for(const s of need)if(!shown.includes(s))missing.push(s);
 if(missing.length)throw Error('citations view lacks '+JSON.stringify(missing));
 expect(shown).toContain('10 units');expect(shown).toContain('12 units');expect(shown).toContain('Body and text captured completely.');
 step('A10/B12 exact hashes, versions, URLs, ranges, coverage shown',{checked:need.length});
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await cites.scrollIntoViewIfNeeded();await expect(cites.locator('.research-claim').first()).toBeVisible();await snapTo('width'+width);
  const ok=await noOverflow();if(!ok)throw Error('horizontal overflow at '+width);step('no horizontal overflow',{width});
 }
 await page.setViewportSize({width:1440,height:1000});
 // Metadata refresh on the mounted editor: saved text, then an unsaved human edit, must both survive untouched.
 await page.evaluate(()=>{window.__fileCitationsMarker='same-document';});
 const cr=cites.getByTestId('research-refresh'),sr=page.getByTestId('research-sources').getByTestId('research-refresh');record.collapsedAfterRefresh=[];const refresh=async()=>{const collapsed=await cites.locator('details[data-testid=research-claims]:not([open])').count();record.collapsedAfterRefresh.push(collapsed>0);if(collapsed)await cites.locator('details[data-testid=research-claims] > summary').click();await expect(cr).toHaveText('Refresh citations');await cr.click();await expect(cr).toHaveText('Refresh citations');await expect(cr).toBeEnabled();await sr.click();await expect(sr).toHaveText('Refresh sources');await expect(sr).toBeEnabled();await page.waitForTimeout(1500);};
 await refresh();await expect(text).toHaveValue(f.browser_human);expect(await cites.getAttribute('data-body-hash')).toBe(art.body_hash);step('refresh keeps exact saved textarea');
 const dirtyValue=f.browser_human+'[unsaved browser probe — never saved]';await text.fill(dirtyValue);await expect(editor.getByText('describe the last saved version',{exact:false})).toBeVisible();
 await refresh();await expect(text).toHaveValue(dirtyValue);expect(await cites.getAttribute('data-revision')).toBe(art.current_revision_id);expect(await cites.getAttribute('data-body-hash')).toBe(art.body_hash);
 expect(await page.evaluate(()=>window.__fileCitationsMarker)).toBe('same-document');expect(await noOverflow()).toBe(true);await snapTo('dirty-after-refresh');step('refresh never mutates unsaved human text or rebinds citations');
 const writes=requests.filter(r=>!r.startsWith('GET '));if(writes.length)throw Error('unexpected non-GET requests '+JSON.stringify(writes));
 record.requests=requests;record.passed=true;await writeFile(pre+'result.json',JSON.stringify(record,null,2));
 console.log('PASS file-editor citations '+label+': exact saved revision/body, '+claims.items.length+' claims, unsupported + stale, A/B captures, 1440/390/320, refresh leaves human text untouched, GET only.');
}catch(e){record.passed=false;record.error=String(e);await writeFile(pre+'result.json',JSON.stringify(record,null,2));await snapTo('failure-'+Date.now());throw e;}finally{await b.close();}
