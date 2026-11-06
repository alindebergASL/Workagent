import {createRequire} from 'node:module';import fs from 'node:fs/promises';
const root=process.cwd(),req=createRequire(root+'/web/package.json'),{chromium,expect}=req('@playwright/test');
const out=root+'/docs/evidence/batch2-publication',f=JSON.parse(await fs.readFile(out+'/fixture.json','utf8')),before=JSON.parse(await fs.readFile(out+'/browser-verified-report.json','utf8'));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:3197'?r.continue():r.abort());
const result={status:'RUNNING',checks:[],source_manifest:'source-manifest.json'};
try{
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await page.goto(before.url);await page.locator('#work-tab-edit').click();
  await expect(page.getByTestId('notes-list').locator('textarea')).toHaveValue('Human note: keep Saturday morning. Verified in publication smoke.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:out+'/final-runtime-'+width+'.png',fullPage:true});result.checks.push(width+'px exact saved note survives actual Next process/build restart');
 }
 expect(errors).toEqual([]);result.status='PASS';result.build_id=(await fs.readFile(root+'/web/.next/BUILD_ID','utf8')).trim();result.page_errors=errors;
}catch(e){result.status='FAIL';result.error=String(e.stack||e);process.exitCode=1;}
finally{await browser.close();await fs.writeFile(out+'/final-browser-report.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));}
