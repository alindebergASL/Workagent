import json, os, subprocess, time
from pathlib import Path
root=Path.cwd(); proof=root.parent
assert root.name=='candidate' and 'b31b-recovery-' in str(proof)
log=(proof/'evidence/web-server.log').open('ab')
p=subprocess.Popen(['/home/ubuntu/workagent/tools/node-v22.23.4-linux-x64/bin/node',str(root/'web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','13231'],cwd=root/'web',env={**os.environ,'WORKAGENT_BACKEND_URL':'http://127.0.0.1:18231','WORKAGENT_WEB_ORIGIN':'http://127.0.0.1:13231'},stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
(proof/'web-process.json').write_text(json.dumps({'pid':p.pid,'cwd':str(root/'web'),'port':13231})+'\n')
time.sleep(2);assert p.poll() is None
print('Started owned production-build web',p.pid)
