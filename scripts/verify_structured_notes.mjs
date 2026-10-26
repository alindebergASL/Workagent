import {createRequire} from 'node:module';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const [fixturePath,out]=process.argv.slice(2);
if(!fixturePath||!out)throw new Error('Usage: node scripts/verify_structured_notes.mjs FIXTURE_JSON OUTPUT_DIR');
const origin=process.env.WORKAGENT_TEST_WEB_URL??'http://127.0.0.1:3129';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('Disposable loopback test origin required');
await mkdir(out,{recursive:true});
const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
const base=origin+'/api/domain/v1/workspaces/'+fixture.workspace;
const headers={'X-Workagent-Client':'local-ui'};
async function get(id){const r=await fetch(base+'/artifacts/'+id,{headers});expect(r.status).toBe(200);return r.json();}
const report={mode:'real_browser_real_api_real_postgresql_controlled_synthetic_fixture',live_provider_calls:0,results:[],errors:[]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 for(const f of fixture.fixtures){
  const context=await browser.newContext({viewport:{width:f.width,height:900}});
  await context.tracing.start({screenshots:true,snapshots:true});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  try{
   await page.goto(`${origin}/conversations/${f.conversation}/artifacts/${f.artifact}`);
   await page.locator('#work-tab-edit').click();
   const notes=page.getByTestId('notes-list');
   const values=()=>notes.locator('textarea').evaluateAll(nodes=>nodes.map(n=>n.value));
   await expect(notes.locator('textarea')).toHaveCount(5);expect(await values()).toEqual(fixture.notes);
   // Persist an unrelated cell edit: all untouched note objects must round-trip.
   await page.getByLabel('Row 1 Plant',{exact:true}).fill('Oak reviewed');
   const save=page.getByRole('button',{name:'Save my edits',exact:true});await save.click();
   await expect.poll(async()=>(await get(f.artifact)).current_revision_id).not.toBe(f.revision);
   expect((await get(f.artifact)).current_revision.body.notes).toEqual(fixture.notes);
   await page.reload();await page.locator('#work-tab-edit').click();await expect(notes.locator('textarea')).toHaveCount(5);
   expect(await values()).toEqual(fixture.notes);
   // Discard must clear removal history, not offer Undo for a restored note.
   await notes.getByRole('button',{name:'Remove note 2',exact:true}).click();
   await page.getByRole('button',{name:'Discard my changes',exact:true}).click();
   expect(await values()).toEqual(fixture.notes);
   await expect(notes.getByTestId('notes-undo')).toHaveCount(0);
   // Genuine undo remains functional after an ordinary new removal.
   await notes.getByRole('button',{name:'Remove note 2',exact:true}).click();
   await notes.getByRole('button',{name:'Undo',exact:true}).click();
   expect(await values()).toEqual(fixture.notes);
   // Editing one multiline object leaves the others intact.
   const edited=[...fixture.notes];edited[1]='  Retain leading and trailing spaces.  \nSecond line.\n';
   await notes.getByLabel('Note 2',{exact:true}).fill(edited[1]);
   await notes.getByRole('button',{name:'Move note 2 down',exact:true}).click();
   [edited[1],edited[2]]=[edited[2],edited[1]];expect(await values()).toEqual(edited);
   await notes.getByRole('button',{name:'Remove note 4',exact:true}).click();edited.splice(3,1);
   expect(await values()).toEqual(edited);
   await notes.getByRole('button',{name:'Add a note',exact:true}).click();
   await expect(save).toBeDisabled();await expect(page.getByRole('alert').filter({hasText:'Write something in note 5'})).toBeVisible();
   expect((await values()).at(-1)).toBe('');
   await notes.getByLabel('Note 5',{exact:true}).fill('   ');edited.push('   ');
   let before=await get(f.artifact);await save.click();
   await expect.poll(async()=>(await get(f.artifact)).current_revision_id).not.toBe(before.current_revision_id);
   expect((await get(f.artifact)).current_revision.body.notes).toEqual(edited);
   // Explicit cancellation discards only the draft, not retained notes.
   await notes.getByLabel('Note 1',{exact:true}).fill('discard this temporary edit');
   await page.getByRole('button',{name:'Discard my changes',exact:true}).click();
   expect(await values()).toEqual(edited);expect((await get(f.artifact)).current_revision.body.notes).toEqual(edited);
   while(edited.length<10){
    await notes.getByRole('button',{name:'Add a note',exact:true}).click();edited.push('Additional\nnote '+(edited.length+1));
    await notes.getByLabel('Note '+edited.length,{exact:true}).fill(edited.at(-1));
   }
   await expect(notes.getByRole('button',{name:'Add a note',exact:true})).toBeDisabled();
   before=await get(f.artifact);await save.click();
   await expect.poll(async()=>(await get(f.artifact)).current_revision_id).not.toBe(before.current_revision_id);
   expect((await get(f.artifact)).current_revision.body.notes).toEqual(edited);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:out+'/'+f.name+'.png',fullPage:true});
   report.results.push({viewport:f.name,width:f.width,artifact:f.artifact,status:'pass',checks:['untouched-five-note-seventeen-line-save','reload','discard-clears-stale-undo','genuine-undo','single-note-edit','reorder','remove','empty-blocked-not-erased','whitespace','discard','ten-note-bound','real-api-readback','no-horizontal-overflow']});
  }catch(error){await page.screenshot({path:out+'/'+f.name+'-failure.png',fullPage:true});throw error;}
  finally{await context.tracing.stop({path:out+'/'+f.name+'-trace.zip'});await context.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
 }
 expect(report.errors).toEqual([]);console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
