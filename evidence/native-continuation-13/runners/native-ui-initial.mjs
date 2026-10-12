import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root='/home/ubuntu/workagent-flexible-work',out=root+'/.local/general-continuation-native-02';
const require=createRequire(root+'/web/package.json');const{chromium,expect}=require('@playwright/test');
const brief=JSON.parse(await readFile(root+'/.local/native-continuation-brief.json','utf8'));
await writeFile(out+'/ui-initial.started.json',JSON.stringify({goal:brief.initial_goal,entry:'native homepage composer',grant_pause:'initial native /messages request paused while UI-created empty conversation is scoped via canonical operator seams'}),{flag:'wx'});
const safeEnv={...process.env};for(const k of Object.keys(safeEnv))if(/DATABASE|TOKEN|PASSWORD|API_KEY|AUTH/.test(k))delete safeEnv[k];
const browser=await chromium.launch({headless:true,env:safeEnv});let cid,posts=0,routeError=null;
function stage(name,extra=[]){const r=spawnSync(root+'/backend/.venv/bin/python',[root+'/.local/general-continuation-resume.py',name,'--out',out,'--database','workagent_test_673057748094',...extra],{cwd:root,env:process.env,encoding:'utf8',timeout:25000});if(r.status!==0)throw new Error(`${name} failed: ${r.stderr} ${r.stdout}`);return r.stdout;}
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.route('**/conversations/*/messages',async route=>{
  try{
   posts++;assert.equal(posts,1);const payload=route.request().postDataJSON();assert.equal(payload.text,brief.initial_goal);assert.equal(payload.operation??null,null);assert.equal(payload.target,null);assert.deepEqual(payload.attachments,[]);
   cid=route.request().url().match(/conversations\/([^/]+)\/messages$/)[1];
   await writeFile(out+'/ui-initial-request.json',JSON.stringify({conversation_id:cid,payload},null,2)+'\n',{flag:'wx'});
   stage('attach-empty',['--conversation-id',cid]);
   const pins=['--reviewed-sha','4186d337a5d3b225fc257dda02b9d18bb10ab63e','--reviewed-consumer','75e487d7c1dd53ba50c15515fa92793ad2edf22dd259f3ec99841019a5653c12'];
   stage('draft',[...pins,'--route',root+'/.local/flexible-route.private.json']);
   stage('install',[...pins,'--execute']);
   await route.continue();
  }catch(e){routeError=String(e);await route.abort('blockedbyclient');}
 });
 await page.goto('http://127.0.0.1:3166');
 await expect(page.getByPlaceholder('Ask, think aloud, or hand something over…')).toBeVisible();
 await page.getByPlaceholder('Ask, think aloud, or hand something over…').fill(brief.initial_goal);
 const response=page.waitForResponse(r=>r.url().endsWith('/messages'),{timeout:90000});
 await page.getByRole('button',{name:'Send',exact:true}).click();
 const r=await response;assert.equal(r.status(),202,await r.text());assert.equal(routeError,null);
 const receipt=await r.json();assert.equal(receipt.message.text,brief.initial_goal);assert.equal(receipt.run.profile,'general-responses-v1');
 await writeFile(out+'/ui-initial.queued.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 await expect(page).toHaveURL(`http://127.0.0.1:3166/conversations/${cid}`);
 await page.screenshot({path:out+'/01-initial-native-ui.png',fullPage:true});
 console.log(JSON.stringify({conversation_id:cid,run_id:receipt.run.id,status:r.status(),native_ui_initial_posts:posts,provider_calls_by_browser:0}));
}finally{if(routeError)console.error(routeError);await browser.close();}
