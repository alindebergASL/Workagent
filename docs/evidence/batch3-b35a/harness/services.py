"""Start/stop only the recorded B3.5a proof processes."""
import json,os,signal,socket,subprocess,sys,time
from pathlib import Path
ROOT=Path.cwd();BASE=ROOT/'.local/batch3/b35a';REC=BASE/'processes.json'
def envfile(path):
 return {k:v for line in Path(path).read_text().splitlines() if line.startswith('export ') for k,v in [line[7:].split('=',1)]}
def live(port):
 with socket.socket() as s:return s.connect_ex(('127.0.0.1',port))==0
def start():
 env={**os.environ,**envfile(BASE/'ui.env'),'PYTHONPATH':str(ROOT/'backend'),
 'WORKAGENT_BACKEND_URL':'http://127.0.0.1:18250','WORKAGENT_OPERATOR_URL':'http://127.0.0.1:18250',
 'WORKAGENT_WEB_ORIGIN':'http://127.0.0.1:13250','NEXT_TELEMETRY_DISABLED':'1','WORKAGENT_SYNTHETIC_CONNECTOR':'1'}
 rows=[]
 for name,command,cwd,port in [('api',[str(ROOT/'backend/.venv/bin/python'),'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port','18250','--no-access-log'],ROOT,18250),('web',['node',str(ROOT/'web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','13250'],ROOT/'.local/batch3/b34a/web-lane/web',13250)]:
  assert not live(port),'Unowned listener'
  proc=subprocess.Popen(command,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=(BASE/(name+'.log')).open('ab'),stderr=subprocess.STDOUT,start_new_session=True)
  row={'name':name,'pid':proc.pid,'cwd':str(cwd),'port':port,'start':Path(f'/proc/{proc.pid}/stat').read_text().rsplit(')',1)[1].split()[19]};rows.append(row);REC.write_text(json.dumps(rows,indent=2))
  for _ in range(150):
   assert proc.poll() is None,name+' exited'
   if live(port):break
   time.sleep(.1)
  else:raise RuntimeError('No listener')
 print(json.dumps(rows))
def stop():
 rows=json.loads(REC.read_text())
 for r in rows:
  p=Path('/proc')/str(r['pid'])
  if p.exists():
   parts=(p/'stat').read_text().rsplit(')',1)[1].split()
   assert parts[19]==r['start']
   if parts[0]!='Z':
    assert str((p/'cwd').resolve())==r['cwd'];os.killpg(r['pid'],signal.SIGTERM)
 for r in rows:
  for _ in range(100):
   if not live(r['port']):break
   time.sleep(.1)
  assert not live(r['port'])
 (BASE/'evidence').mkdir(exist_ok=True)
 (BASE/'evidence'/('stopped-'+str(time.time_ns())+'.json')).write_text(json.dumps(rows,indent=2))
 print('Owned sockets closed')
if sys.argv[1]=='start':start()
elif sys.argv[1]=='restart':stop();start()
else:stop()
