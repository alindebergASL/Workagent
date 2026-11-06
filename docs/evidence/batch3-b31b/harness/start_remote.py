"""Start only the isolated fixture API; env remains remote/private."""
import json, os, subprocess, sys, time
from pathlib import Path
root=Path.cwd(); proof=root.parent
assert root.name=='candidate' and 'b31b-recovery-' in str(proof)
log=(proof/'evidence/api.log').open('ab')
p=subprocess.Popen([str(root/'backend/.venv/bin/python'),'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port','18231'],cwd=root,env={**os.environ,'PYTHONPATH':str(root/'backend')},stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
(proof/'api-process.json').write_text(json.dumps({'pid':p.pid,'cwd':str(root),'port':18231})+'\n')
time.sleep(2)
assert p.poll() is None, 'Owned API failed; inspect private log'
print('Started owned API',p.pid)
