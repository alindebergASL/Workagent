import {chromium,expect} from '../../../web/node_modules/@playwright/test/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {scopedHeaders} from '../../../web/scripts/lib/scope.mjs';
const f=JSON.parse(await readFile('.local/batch3/b32a/fixture.json','utf8')),ws=f.workspace_id,origin='http://127.0.0.1:13234',out='.local/batch3/b32a/evidence/browser';await mkdir(out,{recursive:true});
const headers=await scopedHeaders(origin,{'X-Workagent-Client':'local-ui'});
async function api(path){const r=await fetch(origin+'/api/domain/v1/workspaces/'+ws+path,{headers});if(!r.ok)throw Error(await r.text());return r.json();}
const b=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await b.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
async function snap(name){await page.screenshot({path:out+'/'+name+'.png',fullPage:true});await writeFile(out+'/'+name+'.txt',await page.locator('body').innerText());}
try{
 await page.goto(origin+'/conversations/'+f.browser+'?workspace='+ws);await expect(page.getByRole('textbox',{name:'Continue the conversation'})).toBeVisible({timeout:30000});
 await expect(page.getByRole('button',{name:'Refresh sources'})).toBeVisible();
 await page.getByRole('button',{name:'research-conclusion.txt',exact:true}).click();
 await expect(page.locator('textarea').first()).toHaveValue(f.browser_human);
 const detail=await api('/conversations/'+f.browser);await writeFile(out+'/main-restart-detail.json',JSON.stringify(detail,null,2));
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await page.locator('textarea').first().scrollIntoViewIfNeeded();await snap('width'+width+'-human-loaded');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Refresh sources'}).click();await expect(page.getByText('Capacity bulletin B · captured',{exact:false})).toBeVisible();
 for(let i=0;i<2;i++){
  await page.getByText('Capture details',{exact:true}).nth(i).click();await page.getByText('Captured text',{exact:true}).nth(i).click();await page.getByText('Capture details',{exact:true}).nth(i).scrollIntoViewIfNeeded();await snap('source-'+i+'-metadata');
 }
 const href=await page.getByRole('link',{name:'Proposed change to Working file'}).getAttribute('href');await page.goto(origin+href);await expect(page.getByRole('heading',{name:'A proposed version is ready'})).toBeVisible();
 await page.getByText('See the proposed version',{exact:true}).click();await snap('unaccepted-proposal');
 await writeFile(out+'/main-loaded-pass.json',JSON.stringify({passed:true,widths:[1440,390,320],limitations:['Working-file result has no WorkCard: citations control absent on both its file editor and artifact page.'],url:page.url()},null,2));console.log('Loaded exact human edit, two source versions, and pending proposal at 1440/390/320. Citation integration gap recorded.');
}catch(e){await snap('failure-'+Date.now());throw e;}finally{await b.close();}
