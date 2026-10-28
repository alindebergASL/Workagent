"""Deterministic R3/R4 receipt wrapper, source/config hashes and exits."""
import os,sys,subprocess,json,time,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[3]; os.chdir(root)
out=root/'.local/batch3/b30b'; lane=out/'web-owner'
label=sys.argv[1]; args=sys.argv[2:]
def hashes():
    paths=[]
    for folder in ('web/src','web/test','contracts/src'):
        paths += [p for p in (lane/folder).rglob('*') if p.is_file()]
    paths += [p for p in (lane/'web').iterdir() if p.is_file() and p.suffix in ('.json','.ts','.mjs') and p.name!='tsconfig.tsbuildinfo']
    return {str(p.relative_to(lane)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}
r={'argv':args,'start':time.time(),'source_before':hashes(),'scope':'isolated web-owner; real browser controlled HTTP faults; no paid provider calls'}
try:
    with (out/(label+'.log')).open('w') as f:
        p=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT,timeout=1200)
    r['exit']=p.returncode
except subprocess.TimeoutExpired:r['exit']=124
r.update(end=time.time(),source_after=hashes())
(out/(label+'.json')).write_text(json.dumps(r,indent=2)+'\n')
print(label,'EXIT',r['exit'],flush=True); sys.exit(r['exit'])
