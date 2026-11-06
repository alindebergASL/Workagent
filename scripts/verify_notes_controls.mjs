// Bounded real-stack regression for the root verifier helpers; synthetic fixture only.
import {chromium, expect} from '../web/node_modules/@playwright/test/index.mjs';
import {readFile, writeFile} from 'node:fs/promises';
import {scopedHeaders} from '../web/scripts/lib/scope.mjs';
import {setNotes, expectNotes} from './notes_controls.mjs';

const origin=process.env.WORKAGENT_WEB_ORIGIN;
if (!origin || new URL(origin).hostname !== '127.0.0.1') throw new Error('Isolated loopback fixture required');
const fixture=JSON.parse(await readFile(process.argv[2], 'utf8'));
const url=origin+`/conversations/${fixture.csv_conversation}/artifacts/${fixture.table_id}`;
const draft=['  first line\nsecond line  ', '', 'third\n\nlast  '];
const exact=['  first line\nsecond line  ', 'middle  ', 'third\n\nlast  '];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',error=>errors.push(error.message));
 // Hold the artifact response so setNotes is invoked before NotesList exists.
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/domain/v1/workspaces/*/artifacts/'+fixture.table_id,async route=>{await gate;await route.continue();});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 const setting=setNotes(page,draft);
 release();
 await setting;
 await expectNotes(page,draft);
 await expect(page.getByRole('button',{name:'Save my edits',exact:true})).toBeDisabled();
 await expect(page.getByText('Write something in note 2, or remove it, before saving.',{exact:true})).toBeVisible();
 await setNotes(page,exact);
 await page.getByRole('button',{name:'Save my edits',exact:true}).click();
 await expect(page.getByText('Your edits are saved. Recalculate or run it to check them.',{exact:true})).toBeVisible();
 await page.reload();
 await expectNotes(page,exact);
 const response=await fetch(origin+`/api/domain/v1/workspaces/local-workspace/artifacts/${fixture.table_id}`,{headers:await scopedHeaders(origin,{'X-Workagent-Client':'local-ui'})});
 expect(response.status).toBe(200);
 const saved=await response.json();
 expect(saved.current_revision.body.notes).toEqual(exact);
 const widths=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
 expect(widths.document).toBeLessThanOrEqual(widths.viewport);
 expect(errors).toEqual([]);
 await page.screenshot({path:process.argv[3]+'.png',fullPage:true});
 await writeFile(process.argv[3],JSON.stringify({passed:true,notes:exact,empty_note_retained_but_save_refused:true,delayed_load:true,saved_and_reloaded:true,widths,page_errors:errors,provider_calls:0},null,2)+'\n');
 console.log('PASS: delayed NotesList, multiline/empty/trailing-space array, save/reload/API readback, 390px');
} finally {await browser.close();}
