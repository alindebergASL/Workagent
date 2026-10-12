"""Owned isolated local QA stack; no provider transport or manual worker ticks."""
import sys,os,json,time,signal,socket,subprocess,urllib.request,hashlib
from pathlib import Path
ROOT=Path('/home/ubuntu/workagent-general-continuation-review')
sys.path.insert(0,str(ROOT/'scripts'))
import workagent
workagent.PYTHON=Path('/home/ubuntu/workagent-flexible-work/backend/.venv/bin/python')
OUT=ROOT/'.local/general-continuation-breadth'; OUT.mkdir(parents=True,exist_ok=True)
ENV=ROOT/'.local/general-continuation-breadth.env'
if ENV.exists():
    assert (OUT/'source.json').exists(), 'Only reuse this operator-created isolated database'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()=='dd01cd49a9b026edf8a99281d182e0554d54f4e2'
assert (ROOT/'web/.next/BUILD_ID').exists()
for port in [3175,8175]:
    with socket.socket() as s: assert s.connect_ex(('127.0.0.1',port))!=0, f'Occupied: {port}'
env=workagent.environment(ENV)
env.update(WORKAGENT_WEB_ORIGIN='http://127.0.0.1:3175',WORKAGENT_BACKEND_URL='http://127.0.0.1:8175')
source=Path('/home/ubuntu/workagent-flexible-work/evidence/flexible-work-13/rainwater.json')
payload=json.loads(source.read_text()); body=payload['revision']['body']
(OUT/'source.json').write_text(json.dumps({'mode':'REPLAY retained model-created calculator; controlled local execution, no model calls','source_artifact_id':payload['artifact_id'],'source_revision_id':payload['revision']['id'],'source_file':str(source),'source_file_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'source_code_sha256':hashlib.sha256(body['code'].encode()).hexdigest(),'body':body,'expected_arguments':[137,12,75],'expected_integer_result':137*12*75//100,'formula':'floor(roof_area_m2 * rainfall_mm * capture_efficiency_percent / 100)'},indent=2))
commands=[('api',[str(workagent.PYTHON),'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port','8175','--no-proxy-headers'],ROOT/'backend'),('web',['node',str(ROOT/'web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3175'],ROOT/'web'),('consumer',[str(workagent.PYTHON),'-m','workagent.dispatcher','--general-controlled'],ROOT/'backend')]
children=[]; logs=[]
def stopped(*_): raise KeyboardInterrupt
signal.signal(signal.SIGTERM,stopped)
try:
    for name,args,cwd in commands:
        log=(OUT/(name+'.log')).open('ab'); logs.append(log)
        proc=subprocess.Popen(args,cwd=cwd,env=env,stdout=log,stderr=log,start_new_session=True); children.append(proc)
    (OUT/'owned-processes.json').write_text(json.dumps([{'name':name,'pid':p.pid,'command':args} for (name,args,_),p in zip(commands,children)],indent=2))
    for i in range(120):
        if any(p.poll() is not None for p in children): raise RuntimeError('Owned service exited; inspect logs')
        try:
            req=urllib.request.Request('http://127.0.0.1:3175/api/domain/v1/workspaces',headers={'X-Workagent-Client':'local-ui'})
            with urllib.request.urlopen(req,timeout=2) as r:
                if r.status==200: break
        except OSError: time.sleep(.5)
    else: raise RuntimeError('Readiness failed')
    print('READY isolated stack 3175/8175',flush=True)
    result=subprocess.run(['node',str(ROOT/'.local/general-breadth-browser.mjs')],cwd=ROOT,env=env)
    (OUT/'browser-exit.json').write_text(json.dumps({'returncode':result.returncode}))
    sys.exit(result.returncode)
finally:
    for p in children:
        if p.poll() is None: os.killpg(p.pid,signal.SIGTERM)
    for p in children:
        try:p.wait(timeout=10)
        except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
    for log in logs: log.close()
    (OUT/'cleanup.json').write_text(json.dumps({'owned_processes_stopped':all(p.poll() is not None for p in children),'database_preserved':True,'original_services_untouched':True},indent=2))
