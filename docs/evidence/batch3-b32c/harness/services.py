"""Owned loopback preview only. Does not touch installed runtimes."""
import json,os,sys,subprocess,socket,signal,time
from pathlib import Path
root=Path(__file__).resolve().parents[3];base=root/'.local/batch3/b32c';action=sys.argv[1];record=base/'processes.json'
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
   with socket.socket() as probe:alive=probe.connect_ex(('127.0.0.1',r['port']))==0
   if not alive:break
   time.sleep(.1)
  else:raise AssertionError('owned port still active')
 (base/'evidence'/('service-stop-'+str(time.time_ns())+'.json')).write_text(json.dumps(rows,indent=2))
if action in ('start','restart'):
 env={**os.environ,'PYTHONPATH':str(root/'backend'),'WORKAGENT_BACKEND_URL':'http://127.0.0.1:18236','WORKAGENT_WEB_ORIGIN':'http://127.0.0.1:13236','WORKAGENT_OPERATOR_URL':'http://127.0.0.1:18236'}
 rows=[]
 for name,args,cwd,port in [('api',[str(root/'backend/.venv/bin/python'),'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port','18236'],root,18236),('web',['node',str(root/'web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','13236'],base/'web-lane/web',13236)]:
  with socket.socket() as probe:assert probe.connect_ex(('127.0.0.1',port))!=0
  proc=subprocess.Popen(args,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=(base/(name+'.log')).open('ab'),stderr=subprocess.STDOUT,start_new_session=True)
  time.sleep(2);assert proc.poll() is None
  rows.append(dict(name=name,pid=proc.pid,port=port,cwd=str(cwd),start=Path('/proc/'+str(proc.pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]))
 record.write_text(json.dumps(rows,indent=2));print(json.dumps(rows))
