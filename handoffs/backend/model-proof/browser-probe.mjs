import { createRequire } from 'node:module';
import { readFile,writeFile } from 'node:fs/promises';
const root=process.cwd();
const { chromium, expect }=createRequire(root+'/web/package.json')('@playwright/test');
const operation=JSON.parse(await readFile(root+'/.local/model-responsibility/operation.json','utf8'));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(`http://127.0.0.1:3124/assignments/${operation.assignment_id}/artifacts/${operation.artifact_id}`);
 await expect(page.locator(".doc-card").getByText(/Actual qwen3.8-max draft, operator-imported for review/)).toBeVisible({timeout:15000});
 console.log((await page.locator('main').innerText()).slice(0,600));
 await expect(page.locator(".doc-card").getByText(/Actual qwen3.8-max draft, operator-imported for review/)).toBeVisible();
 await expect(page.locator(".doc-card").getByText('Keep Wednesday 14:00–15:00 for method drafting.',{exact:true})).toBeVisible();
 await expect(page.locator('header .status').first()).toHaveText('Saved');
 await expect(page.locator(".doc-card").getByText(/4 unique cases missing an owner or a next action/)).toBeVisible();
 await page.screenshot({path:root+'/.local/model-responsibility/reopened-model-draft.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:root+'/.local/model-responsibility/reopened-model-draft-mobile.png',fullPage:true});
 await writeFile(root+'/.local/model-responsibility/browser.json',JSON.stringify({passed:true,mode:'actual_model_draft_operator_import_after_recovery',assignment_id:operation.assignment_id,artifact_id:operation.artifact_id,approval_claimed:false,autonomous_worker_claimed:false,widths:[1440,390]},null,2)+'\n');
 console.log('PASS: actual Qwen draft visible after recovery, preserved note, no false approval/live-worker label');
}finally{await browser.close();}
