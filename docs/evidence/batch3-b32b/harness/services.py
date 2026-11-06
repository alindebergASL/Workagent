"""Synthetic B3.2b fixture/setup and verified owned preview lifecycle."""
import json,os,signal,socket,subprocess,sys,time
from pathlib import Path
from hashlib import sha256
root=Path(__file__).resolve().parents[3];base=root/'.local/batch3/b32b';record=base/'processes.json';action=sys.argv[1]
if action=='seed':
 from workagent.db import Database
 from workagent.fixture import seed
 from workagent.models import CreateConversation,new_id
 from workagent.service import Service,Principal
 from workagent.workspace_file_models import CreateWorkspaceFile,WorkingText
 from test_domain import cmd
 ws='office-'+new_id();p=Principal('local-human');seed(os.environ['MIGRATION_DATABASE_URL'],json.loads((root/'fixtures/actor/solo-v0.1/initial_records.json').read_text()),ws,p.id)
 s=Service(Database());s.db.check_runtime_role();f={'workspace_id':ws}
 for key in ['web','native']:
  cv=s.create_conversation(p,ws,cmd(CreateConversation,title='Editable office '+key,selected_source_refs=[]));f[key]=cv.id
  text='region,hours\nEast,0.1\nEast,0.2\nWest,1.5\n'
  file=s.create_workspace_file(p,ws,cv.id,cmd(CreateWorkspaceFile,expected_work_version=cv.work_version,source=WorkingText(filename='capacity.csv',mime_type='text/csv',content=text,sha256=sha256(text.encode()).hexdigest())))
  f[key+'_table']=file.workspace_file_id
 (base/'fixture.json').write_text(json.dumps(f,indent=2));print(json.dumps(f))
if action in ('stop','restart'):
 rows=json.loads(record.read_text())
 for r in rows:
  proc=Path('/proc')/str(r['pid'])
  if proc.exists():
   assert str((proc/'cwd').resolve())==r['cwd']
   assert (proc/'stat').read_text().rsplit(')',1)[1].split()[19]==r['start']
   os.killpg(r['pid'],signal.SIGTERM)
 for r in rows:
  for _ in range(100):
   try:
    with socket.create_connection(('127.0.0.1',r['port']),timeout=.1):pass
   except OSError:break
   time.sleep(.1)
  else:raise AssertionError('owned port still listening')
 (base/'evidence'/('process-stop-'+str(time.time_ns())+'.json')).write_text(json.dumps(rows,indent=2))
if action in ('start','restart'):
 env={**os.environ,'WORKAGENT_OFFICE_ENABLED':'1','WORKAGENT_BACKEND_URL':'http://127.0.0.1:18235','WORKAGENT_WEB_ORIGIN':'http://127.0.0.1:13235','WORKAGENT_OPERATOR_URL':'http://127.0.0.1:18235'}
 rows=[]
 for name,args,cwd,port in [('api',[str(root/'backend/.venv/bin/python'),'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port','18235'],root,18235),('web',['node',str(root/'web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','13235'],base/'candidate/web',13235)]:
  with socket.socket() as probe:assert probe.connect_ex(('127.0.0.1',port))!=0
  process=subprocess.Popen(args,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=(base/(name+'.log')).open('ab'),stderr=subprocess.STDOUT,start_new_session=True)
  time.sleep(2);assert process.poll() is None,name
  rows.append(dict(name=name,pid=process.pid,cwd=str(cwd),port=port,start=Path('/proc/'+str(process.pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]))
 record.write_text(json.dumps(rows,indent=2));print(json.dumps(rows))
