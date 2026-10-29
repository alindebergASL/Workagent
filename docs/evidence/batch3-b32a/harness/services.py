import json,os,signal,socket,subprocess,time,sys
from pathlib import Path
root=Path.cwd();out=root/'.local/batch3/b32a';record=out/'processes.json'
action=sys.argv[1]
if action in ('stop','restart'):
 rows=json.loads(record.read_text())
 for r in rows:
  proc=Path('/proc')/str(r['pid'])
  if proc.exists():
   assert str((proc/'cwd').resolve())==r['cwd']
   assert (proc/'stat').read_text().rsplit(')',1)[1].split()[19]==r['start']
   os.killpg(r['pid'],signal.SIGTERM)
 for r in rows:
  for _ in range(50):
   try:
    with socket.create_connection(('127.0.0.1',r['port']),timeout=.1):pass
   except OSError:break
   time.sleep(.1)
  else:raise AssertionError('owned port still listening')
 (out/'evidence'/('process-stop-'+str(time.time_ns())+'.json')).write_text(json.dumps(rows,indent=2))
if action in ('start','restart'):
 env={**os.environ,'WORKAGENT_RESEARCH_ENABLED':'1','WORKAGENT_BACKEND_URL':'http://127.0.0.1:18234','WORKAGENT_WEB_ORIGIN':'http://127.0.0.1:13234','WORKAGENT_OPERATOR_URL':'http://127.0.0.1:18234'}
 rows=[]
 for name,args,cwd,port in [('api',[str(root/'backend/.venv/bin/python'),'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port','18234'],root,18234),('web',['node',str(root/'web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','13234'],root/'.local/batch3/b32a/candidate/web',13234)]:
  with socket.socket() as probe:assert probe.connect_ex(('127.0.0.1',port))!=0
  p=subprocess.Popen(args,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=(out/(name+'.log')).open('ab'),stderr=subprocess.STDOUT,start_new_session=True)
  time.sleep(2);assert p.poll() is None,name
  rows.append(dict(name=name,pid=p.pid,cwd=str(cwd),port=port,start=Path('/proc/'+str(p.pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]))
 record.write_text(json.dumps(rows,indent=2));print(json.dumps(rows))
