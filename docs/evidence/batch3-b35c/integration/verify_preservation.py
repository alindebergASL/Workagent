"""Read-only original evidence checks; expected controller source delta is explicit."""
from pathlib import Path
import hashlib
import json
import subprocess
ROOT = Path(__file__).resolve().parents[4]
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def check(path):
    manifest=json.loads((ROOT/path).read_text())
    bad={p:{'expected':h,'actual':sha(ROOT/p)} for p,h in manifest['files'].items() if sha(ROOT/p)!=h}
    return {'files':len(manifest['files']),'mismatches':bad,'manifest_sha256':sha(ROOT/path)}
def main():
    output={}
    for name,path in [('run102','docs/evidence/batch3-b35c/execution/ADDITIVE_BINDING.json'),('runtime','docs/evidence/batch3-b35c/runtime/MANIFEST.json')]:
        output[name]=check(path)
        assert not output[name]['mismatches'], output[name]
    output['historical_controller']=check('docs/evidence/batch3-b35c/controller/MANIFEST.json')
    assert set(output['historical_controller']['mismatches']) == {'evaluation/study_controller.py','evaluation/study_application.py','evaluation/study_diagnostic.py','evaluation/study_worker.py','evaluation/verify_study_diagnostic.py'}
    baseline='26e599b3db8a61b73eeeaea4f87a1d3de0b296d9'
    files=subprocess.check_output(['git','ls-tree','-r','--name-only',baseline,'backend/workagent'],cwd=ROOT,text=True).splitlines()
    for p in files:
        raw=subprocess.check_output(['git','show',baseline+':'+p],cwd=ROOT)
        assert raw==(ROOT/'.local/batch3/b35b/baseline'/p.removeprefix('backend/')).read_bytes()
    output['accepted_baseline']={'commit':baseline,'files':len(files)}
    print(json.dumps(output,sort_keys=True,indent=2))
if __name__=='__main__': main()
