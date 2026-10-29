import json,os,subprocess,time
from pathlib import Path
root=Path.cwd();proof=root.parent
assert proof.name=='b31c-t5a57eb56'
out=proof/'evidence';out.mkdir(exist_ok=True)
env={**os.environ,'PYTHONPATH':str(root/'backend'),'WORKAGENT_BACKEND_URL':'http://127.0.0.1:18232','WORKAGENT_WEB_ORIGIN':'http://127.0.0.1:13232','WORKAGENT_OPERATOR_URL':'http://127.0.0.1:18232'}
rows=[]
for name,argv,cwd,port in [('api',[str(root/'backend/.venv/bin/python'),'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port','18232'],root,18232),('web',['/home/ubuntu/workagent/tools/node-v22.23.4-linux-x64/bin/node',str(root/'web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','13232'],root/'web',13232)]:
 p=subprocess.Popen(argv,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=(out/(name+'.log')).open('ab'),stderr=subprocess.STDOUT,start_new_session=True)
 time.sleep(3);assert p.poll() is None,name
 rows.append(dict(name=name,pid=p.pid,cwd=str(cwd),port=port,start=Path('/proc/'+str(p.pid)+'/stat').read_text().split()[21]))
(proof/'processes.json').write_text(json.dumps(rows,indent=2));print(json.dumps(rows))
