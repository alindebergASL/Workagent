"""Separate evaluator jobs: oracle never enters product storage or solve context."""
import json
from pathlib import Path
from hashlib import sha256
from workagent.sandbox.client import run
from workagent.sandbox.runner_protocol import blob
base=Path(__file__).resolve().parent;out=base/'evidence'
oracle=(base/'evaluator-private/heldout_test.py').read_bytes()
assert sha256(oracle).hexdigest()=='39fc05a6829ea8fd280a95f000b8f93f1f3e39bc0cada41a745f0d99ea848af6'
for stage in ['v1','v2','transfer']:
 candidate=(out/(stage+'-1-candidate.txt')).read_bytes()
 freeze=json.loads((out/(stage+'-candidate-freeze.json')).read_text())
 assert sha256(candidate).hexdigest()==freeze['sha256']
 code="import runpy,sys\nsys.argv="+repr(['heldout_test.py','--confined','--stage',stage,'--candidate','/inputs/candidate.py','--candidate-sha256',freeze['sha256']])+"\nrunpy.run_path('/inputs/heldout_test.py',run_name='__main__')\n"
 result=run(code,[blob('heldout_test.py',oracle),blob('candidate.py',candidate)],authorized=lambda:True)
 (out/(stage+'-heldout.json')).write_text(json.dumps(result,indent=2)+'\n')
 print(stage,result['status'],result['exit_code'],result['stdout'],result['stderr'])
 assert result['status']=='succeeded' and result['exit_code']==0
