// Parent qualification on an executor permitted to create rootless namespaces.
// Fails (does not skip or fall back) when isolation is unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { sandboxArgs, DocxWorker } from '../src/docx-worker.mjs';
const venv = process.env.WORKAGENT_DOCX_VENV;
test('real namespace denies host paths, ambient environment, host service and read-only writes', () => {
  const args = sandboxArgs(venv);
  args.splice(-1, 1, '-c', `import os,socket,json,runpy,resource
runpy.run_path('/codec.py',run_name='qualification')
result={'cpu_limit':resource.getrlimit(resource.RLIMIT_CPU)==(8,8),'memory_limit':resource.getrlimit(resource.RLIMIT_AS)==(536870912,536870912),'file_limit':resource.getrlimit(resource.RLIMIT_FSIZE)==(25165824,25165824),'fd_limit':resource.getrlimit(resource.RLIMIT_NOFILE)==(32,32)}
result.update({'home_absent':not os.path.exists('/home'),'config_absent':not os.path.exists('/etc'),'state_absent':not os.path.exists('/var/lib/workagent-b01'),'env_absent':'WORKAGENT_DOCX_TEST_SECRET' not in os.environ,'private_cwd':os.getcwd()=='/tmp'})
try:
 open('/usr/docx-write-test','w').close();result['readonly']=False
except OSError: result['readonly']=True
try:
 s=socket.create_connection(('127.0.0.1',8310),timeout=.2);s.close();result['network_denied']=False
except OSError: result['network_denied']=True
print(json.dumps(result))`);
  const r=spawnSync('/usr/bin/bwrap',args,{env:{WORKAGENT_DOCX_TEST_SECRET:'synthetic sentinel'},encoding:'utf8',timeout:12000,maxBuffer:16384});
  assert.equal(r.status,0,r.stderr || r.error?.message); const result=JSON.parse(r.stdout);
  for(const [key,value] of Object.entries(result)) assert.equal(value,true,key);
});
test('real isolated python-docx export/import and malformed failure release the worker slot', async()=>{
  const worker=new DocxWorker({venv});
  const document={id:'isolation',title:'Isolated fixture',documentStyle:{pageSize:{width:794,height:1123}},body:{dataStream:'雪 🌍 literal <tag>\r\n',paragraphs:[{startIndex:18}],textRuns:[{st:0,ed:1,ts:{bl:1}}],sectionBreaks:[{startIndex:19}]}};
  document.body.paragraphs[0].startIndex=document.body.dataStream.length-2; document.body.sectionBreaks[0].startIndex=document.body.dataStream.length-1;
  const pending=worker.run({op:'export',document});
  await assert.rejects(worker.run({op:'export',document}),/docx_worker_busy_retry/);
  const exported=await pending, imported=await worker.run({op:'import',base64:exported.base64});
  assert.equal(imported.document.body.dataStream,document.body.dataStream); assert.equal(imported.document.body.textRuns[0].ts.bl,1);
  await assert.rejects(()=>worker.run({op:'import',base64:'aW52YWxpZA=='}),/docx_refused/);assert.equal(worker.active,false);
  assert.ok((await worker.run({op:'export',document})).base64);
});
