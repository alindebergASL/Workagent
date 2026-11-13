// Parent qualification on an executor permitted to create rootless namespaces.
// Fails (does not skip or fall back) when isolation is unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { sandboxArgs, XlsxWorker } from '../src/xlsx-worker.mjs';
const venv = process.env.WORKAGENT_XLSX_VENV;
test('real namespace denies host paths, ambient environment, host service and read-only writes', () => {
  const args = sandboxArgs(venv);
  args.splice(-1, 1, '-c', `import os,socket,json
result={'home_absent':not os.path.exists('/home'),'config_absent':not os.path.exists('/etc'),'state_absent':not os.path.exists('/var/lib/workagent-b01'),'env_absent':'WORKAGENT_XLSX_TEST_SECRET' not in os.environ,'private_cwd':os.getcwd()=='/tmp'}
try:
 open('/usr/xlsx-write-test','w').close();result['readonly']=False
except OSError: result['readonly']=True
try:
 s=socket.create_connection(('127.0.0.1',8310),timeout=.2);s.close();result['network_denied']=False
except OSError: result['network_denied']=True
print(json.dumps(result))`);
  const r=spawnSync('/usr/bin/bwrap',args,{env:{WORKAGENT_XLSX_TEST_SECRET:'synthetic sentinel'},encoding:'utf8',timeout:12000,maxBuffer:16384});
  assert.equal(r.status,0,r.stderr || r.error?.message); const result=JSON.parse(r.stdout);
  for(const [key,value] of Object.entries(result)) assert.equal(value,true,key);
});
test('real isolated openpyxl export/import and malformed failure release the worker slot', async()=>{
  const worker=new XlsxWorker({venv});
  const book={id:'isolation',name:'Isolated fixture',sheetOrder:['one'],styles:{},sheets:{one:{id:'one',name:'One',rowCount:200,columnCount:26,cellData:{0:{0:{v:true,t:3},1:{v:1,t:2},2:{f:'=B1+1'}}}}}};
  const exported=await worker.run({op:'export',book}), imported=await worker.run({op:'import',base64:exported.base64});
  assert.equal(imported.book.sheets.sheet1.cellData[0][0].t,3);assert.equal(imported.book.sheets.sheet1.cellData[0][1].t,2);
  await assert.rejects(()=>worker.run({op:'import',base64:'aW52YWxpZA=='}),/xlsx_refused/);assert.equal(worker.active,false);
  assert.ok((await worker.run({op:'export',book})).base64);
});
