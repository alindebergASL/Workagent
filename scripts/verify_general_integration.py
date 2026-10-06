#!/usr/bin/env python3
"""Real local B2/B3 UI, consumer outage, restart and exact readback verification.

No provider, harness, key lookup or manual worker tick. Output contains synthetic
fixture evidence only. Use a NEW --env path for a fresh PostgreSQL fixture.
"""
import argparse
import json
import subprocess
from pathlib import Path
from workagent import ROOT, Stack, environment, run

NODE = r'''
import {chromium,expect} from './web/node_modules/@playwright/test/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const out=process.argv[1], phase=process.argv[2];
const origin='http://127.0.0.1:3000';
const base=origin+'/api/domain/v1/workspaces/local-workspace';
const headers={'X-Workagent-Client':'local-ui','Content-Type':'application/json'};
const cmd=()=>({schema_version:'workagent/v1',request_id:crypto.randomUUID(),command_id:crypto.randomUUID()});
async function api(p,body){const r=await fetch(base+p,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});expect(r.ok).toBe(true);return r.json();}
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.PLAYWRIGHT_CHROMIUM_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH}:{})});
try{
 const page=await browser.newPage();
 if(phase==='outage'){
  const cv=await api('/conversations',cmd());
  const admitted=await api('/conversations/'+cv.id+'/messages',{...cmd(),expected_work_version:cv.work_version,text:'Preserve this turn while the controlled consumer is unavailable.'});
  await page.goto(origin+'/conversations/'+cv.id);
  await expect(page.locator('[data-state="unavailable"]')).toContainText('No controlled consumer claim observed',{timeout:20000});
  await expect(page.locator('.msg-agent')).toHaveCount(0);
  await page.screenshot({path:out+'/consumer-unavailable.png',fullPage:true});
  await writeFile(out+'/outage.json',JSON.stringify({conversation_id:cv.id,run_id:admitted.run.id,observed_state:'unavailable',fabricated_replies:0},null,2));
 }else{
  const outage=JSON.parse(await readFile(out+'/outage.json','utf8'));
  await page.goto(origin+'/conversations/'+outage.conversation_id);
  await expect(page.locator('.msg-agent')).toHaveCount(1,{timeout:15000});
  const recovered=await api('/conversations/'+outage.conversation_id);
  expect(recovered.runs).toHaveLength(1);expect(recovered.runs[0].id).toBe(outage.run_id);expect(recovered.runs[0].state).toBe('ready');
  const p=JSON.parse(await readFile(out+'/products/result.json','utf8'));
  await page.goto(origin+'/conversations/'+p.csv_conversation+'/artifacts/'+p.table_id);
  await expect(page.getByLabel('Row 2 note',{exact:true})).toHaveValue('Human credit note retained');
  await expect(page.getByLabel('Your notes (one per line)')).toHaveValue('Newest human note');
  await expect(page.getByTestId('product-verification')).toHaveText('This saved version hasn’t been checked yet.');
  await page.goto(origin+'/conversations/'+p.tool_conversation+'/artifacts/'+p.tool_id);
  await expect(page.getByTestId('observed-return')).toHaveText('4250');
  await expect(page.getByLabel('Your notes (one per line)')).toHaveValue('Human: all amounts are cents');
  await expect(page.getByTestId('product-verification')).toHaveText('Checked against this saved version.');
  const exact=JSON.parse(await readFile(out+'/readback/readback.json','utf8'));
  await page.goto(exact.artifact_url);
  await expect(page.getByTestId('observed-return').first()).toHaveText('9007199254740993');
  await expect(page.getByTestId('product-verification')).toHaveText('Checked against this saved version.');
  await writeFile(out+'/restart.json',JSON.stringify({passed:true,processes_restarted:['web','api','dispatcher'],same_recovered_run:outage.run_id,shipping_return:'4250',exact_i64_return:'9007199254740993',human_notes_preserved:true},null,2));
 }
 console.log('PASS: '+phase+' browser/database readback');
}finally{await browser.close();}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    env = environment(args.env.resolve())
    stack = Stack(env)
    try:
        stack.start(worker=True)
        run(['node', ROOT / 'web/scripts/products-journey.mjs', output / 'products'], env=env)
        run(['node', ROOT / 'web/scripts/products-readback-journey.mjs', output / 'readback'], env=env)
        stack.stop()
        stack.start(worker=False)
        run(['node', '--input-type=module', '-e', NODE, output, 'outage'], env=env)
        stack.stop()
        stack.start(worker=True)
        run(['node', '--input-type=module', '-e', NODE, output, 'restart'], env=env)
        (output / 'verification.json').write_text(json.dumps({
            'git_commit': subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(),
            'dirty': bool(subprocess.check_output(['git','status','--porcelain'], cwd=ROOT, text=True)),
            'passed': True, 'mode': 'real_ui_api_postgresql_continuous_controlled_consumer',
            'model_calls': 'not_performed', 'evidence_origin': 'controlled_transport',
        }, indent=2) + '\n')
    finally:
        stack.stop()


if __name__ == '__main__':
    main()
