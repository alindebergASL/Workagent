"""Append-only exact-source/delta binder. Uses the hash-proved dirty baseline."""
from pathlib import Path
import json,hashlib,subprocess,difflib,sys
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/batch2-recovery5d';BASE=ROOT/'.local/recovery5d/baseline'
label=sys.argv[1];assert label.replace('-','').isalnum()
hash=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
old=json.loads((ROOT/'docs/evidence/batch2-recovery5b/source-manifest.json').read_text())
assert len(old)==602 and all(hash(BASE/p)==h for p,h in old.items())
paths=set(old)|set(subprocess.check_output(['git','ls-files','-co','--exclude-standard','backend','contracts','web'],cwd=ROOT,text=True).splitlines())
new={p:hash(ROOT/p) for p in sorted(paths)}
delta=[{'path':p,'before':old.get(p),'after':h} for p,h in new.items() if old.get(p)!=h]
patch=''.join(''.join(difflib.unified_diff((BASE/d['path']).read_text().splitlines(True) if d['before'] else [],(ROOT/d['path']).read_text().splitlines(True),fromfile='before/'+d['path'],tofile='after/'+d['path'])) for d in delta)
for name,data in [('source-manifest',new),('source-delta',delta)]:
    with (OUT/(label+'-'+name+'.json')).open('x') as f:json.dump(data,f,indent=2);f.write('\n')
with (OUT/(label+'-delta.patch')).open('x') as f:f.write(patch)
print(json.dumps({'source_files':len(new),'delta_files':len(delta),'manifest_sha256':hash(OUT/(label+'-source-manifest.json')),'paths':[d['path'] for d in delta]},indent=2))
