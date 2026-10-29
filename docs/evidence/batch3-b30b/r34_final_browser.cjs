const { chromium, expect } = require('./web-owner/web/node_modules/@playwright/test');
const fs=require('fs'),path=require('path');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,process.env.R34_FIXTURE||'r34-ui-fixture.json')));
const out=path.join(__dirname,process.env.R34_OUT||'r34-browser');fs.mkdirSync(out,{recursive:true});
const result=[];
async function controlProof(locator){
 await locator.scrollIntoViewIfNeeded();await locator.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await locator.focus();await locator.page().waitForTimeout(150);
 const proof=await locator.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {visible:r.width>0&&r.height>0,unobscured:hit===el||el.contains(hit),focused:document.activeElement===el,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}});
 expect(proof.visible&&proof.unobscured&&proof.focused,JSON.stringify(proof)).toBe(true);return proof;
}
const journal=async(page,needle)=>page.evaluate(n=>Object.entries(sessionStorage).filter(([k])=>k.includes(n)),needle);
async function init(page){
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);
  window.__race={calls:[],mode:null,release:null,releases:[],landed:false};
  window.fetch=async(...args)=>{
   const [input,opts]=args;const url=typeof input==='string'?input:input.url||String(input);
   const method=opts?.method||input?.method||'GET';
   if(method==='POST'&&(/\/work-areas\/[^/]+\/files$/.test(url)||/\/files\/[^/]+\/versions$/.test(url))){
    const mode=window.__race.mode;window.__race.mode=null;
    const body=opts?.body ? JSON.parse(opts.body) : await input.clone().json();
    const call={url,body,mode};window.__race.calls.push(call);
    const response=await original(...args);call.status=response.status;
    if(mode==='delay') {window.__race.landed=true;await new Promise(resolve=>{window.__race.release=resolve;window.__race.releases.push(resolve)});}
    if(mode==='lose') throw new TypeError('Controlled lost ACK after actual server response');
    return response;
   }
   return original(...args);
  };
 });
}
async function mode(page,m){await page.evaluate(m=>{window.__race.mode=m;window.__race.landed=false},m)}
async function remount(page,url){
 // Actual Next Link navigation preserves the JS realm and delayed handler.
 const home=page.locator('a[href="/"]:visible, a[href^="/?"]:visible').first();
 await home.click();await expect(page.getByRole('heading',{name:'Files',exact:true})).toHaveCount(0);
 await page.goBack();await expect(page.getByRole('heading',{name:'Files',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>!!window.__race.release)).toBe(true);
}
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{for(const width of [1440,390,320]){
 const context=await browser.newContext({viewport:{width,height:width===1440?900:844}}),page=await context.newPage();await init(page);
 const rec={width,errors:[]};result.push(rec);page.on('pageerror',e=>rec.errors.push(String(e)));
 const cid=fixture.conversations['web'+width],url=fixture.web+`/conversations/${cid}?workspace=${fixture.workspace_id}`;
 try{
 await page.goto(url);await expect(page.getByRole('heading',{name:'Files',exact:true})).toBeVisible({timeout:30000});
 const composer=page.getByRole('textbox',{name:'Continue the conversation',exact:true});await composer.fill('Independent composer survives R34');
 const name='r34-save-'+width+'.txt';await page.getByRole('button',{name:'New file…',exact:true}).click();
 const filename=page.getByLabel('Filename (.txt, .md, .markdown, .csv or .json)',{exact:true}),content=page.getByRole('textbox',{name:'Text',exact:true});
 await filename.fill(name);await content.fill('Original');await page.getByRole('button',{name:'Create file',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();
 const editor=page.locator(`[aria-label="File ${name}"]`),text=editor.locator('textarea');await expect(text).toHaveValue('Original');
 await text.fill('First saved envelope');await mode(page,'lose');await editor.getByRole('button',{name:'Save',exact:true}).click();
 const retry=editor.getByRole('button',{name:/Retry/});await expect(retry).toBeEnabled();
 const before=(await page.evaluate(()=>window.__race.calls)).at(-1);expect(before.status).toBe(201);
 // Current correction may lock edits or preserve a newer generation. Both are safe.
 const blocked=await text.isDisabled();if(!blocked)await text.fill('Newer protected edit');
 rec.retrySaveControl=await controlProof(retry);await page.screenshot({path:path.join(out,`r3-pending-${width}.png`),fullPage:true});
 await retry.click();await expect(retry).toHaveCount(0);
 const after=(await page.evaluate(()=>window.__race.calls)).at(-1);expect(after.body).toEqual(before.body);
 if(blocked){await expect(text).toHaveValue('First saved envelope');await expect(text).toBeEnabled();await text.fill('Newer protected edit');}
 else await expect(text).toHaveValue('Newer protected edit');
 await page.reload();await page.getByRole('button',{name,exact:true}).click();await expect(text).toHaveValue('Newer protected edit');await expect(composer).toHaveValue('Independent composer survives R34');
 rec.R3={pass:true,editingBlockedWhileUnknown:blocked,first:before.body,replay:after.body,reloadDraft:'Newer protected edit'};
 await text.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`r3-${width}.png`),fullPage:true});
 // R4: server commits A, response is held in old component's fetch promise.
 await page.getByRole('button',{name:'New file…',exact:true}).click();await filename.fill('r34-A-'+width+'.txt');await content.fill('A content');await mode(page,'delay');await page.getByRole('button',{name:'Create file',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__race.landed)).toBe(true);
 const a=(await page.evaluate(()=>window.__race.calls)).at(-1);expect(a.status).toBe(201);
 await remount(page,url);await page.getByRole('button',{name:'Retry the same create',exact:true}).click();
 await expect(page.getByRole('button',{name:'New file…',exact:true})).toBeVisible();
 const aReplay=(await page.evaluate(()=>window.__race.calls)).at(-1);expect(aReplay.body).toEqual(a.body);
 await page.getByRole('button',{name:'New file…',exact:true}).click();await filename.fill('r34-B-'+width+'.txt');await content.fill('B protected content');
 // Conversation polling refreshes work version after A.
 await page.waitForTimeout(2300);await mode(page,'lose');await page.getByRole('button',{name:'Create file',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry the same create',exact:true})).toBeEnabled();
 const b=(await page.evaluate(()=>window.__race.calls)).at(-1);expect(b.status).toBe(201);
 rec.retryCreateControl=await controlProof(page.getByRole('button',{name:'Retry the same create',exact:true}));await page.screenshot({path:path.join(out,`r4-pending-${width}.png`),fullPage:true});
 const pendingBefore=await journal(page,'workagent:file-create:'),draftBefore=await journal(page,'workagent:file-new:');expect(pendingBefore.length).toBe(1);expect(draftBefore.length).toBe(1);
 await page.evaluate(()=>window.__race.release());await page.waitForTimeout(200);
 expect(await journal(page,'workagent:file-create:')).toEqual(pendingBefore);expect(await journal(page,'workagent:file-new:')).toEqual(draftBefore);await expect(content).toHaveValue('B protected content');
 const calls=await page.evaluate(()=>window.__race.calls);await page.reload();await expect(content).toHaveValue('B protected content');
 await expect(page.getByRole('button',{name:'Retry the same create',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Retry the same create',exact:true}).click();await expect(page.getByRole('button',{name:'New file…',exact:true})).toBeVisible();
 const bReplay=(await page.evaluate(()=>window.__race.calls)).at(-1);expect(bReplay.body).toEqual(b.body);expect(bReplay.status).toBe(201);
 expect(await journal(page,'workagent:file-create:')).toEqual([]);await expect(composer).toHaveValue('Independent composer survives R34');
 await expect(page.getByRole('button',{name:'r34-A-'+width+'.txt',exact:true})).toHaveCount(1);await expect(page.getByRole('button',{name:'r34-B-'+width+'.txt',exact:true})).toHaveCount(1);
 rec.R4={pass:true,calls,bReplay:bReplay.body,lateA_preserved_B_journal_and_draft:true,oneFileEach:true};
 // Additional actual-remount ordering: old A ACK BEFORE live replay ACK.
 await page.getByRole('button',{name:'New file…',exact:true}).click();await filename.fill('r34-oldfirst-'+width+'.txt');await content.fill('Old first content');
 await page.waitForTimeout(2300);await mode(page,'delay');await page.getByRole('button',{name:'Create file',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__race.landed)).toBe(true);
 const oldFirst=(await page.evaluate(()=>window.__race.calls)).at(-1);expect(oldFirst.status).toBe(201);
 await remount(page,url);await mode(page,'delay');await page.getByRole('button',{name:'Retry the same create',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__race.releases.length)).toBe(2);
 const liveFirst=(await page.evaluate(()=>window.__race.calls)).at(-1);expect(liveFirst.body).toEqual(oldFirst.body);expect(liveFirst.status).toBe(201);
 const exactPending=await journal(page,'workagent:file-create:');expect(exactPending.length).toBe(1);
 await page.evaluate(()=>window.__race.releases[0]());await page.waitForTimeout(200);expect(await journal(page,'workagent:file-create:')).toEqual(exactPending);
 await page.evaluate(()=>window.__race.releases[1]());await expect(page.getByRole('button',{name:'New file…',exact:true})).toBeVisible();expect(await journal(page,'workagent:file-create:')).toEqual([]);
 await expect(page.getByRole('button',{name:'r34-oldfirst-'+width+'.txt',exact:true})).toHaveCount(1);
 rec.R4_oldFirst={pass:true,first:oldFirst.body,replay:liveFirst.body,oldCompletionPreservedLiveJournal:true,liveCreatorRecovered:true};
 rec.layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));expect(rec.layout.scrollWidth).toBeLessThanOrEqual(width);expect(rec.errors).toEqual([]);
 await page.screenshot({path:path.join(out,`r4-${width}.png`),fullPage:true});rec.pass=true;
 }catch(e){rec.pass=false;rec.error=String(e);fs.writeFileSync(path.join(out,`failure-${width}.txt`),await page.locator('body').innerText());await page.screenshot({path:path.join(out,`failure-${width}.png`),fullPage:true});throw e;}
 finally{fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));await context.close();}
}}finally{await browser.close()}console.log('R3/R4 real browser delayed/lost ACK 1440/390/320 PASS');})().catch(e=>{console.error(e);process.exitCode=1});
