from pathlib import Path
import json,hashlib,subprocess,difflib
ROOT=Path(__file__).resolve().parents[4];OUT=Path(__file__).parent;BASE=ROOT/'.local/recovery5d-poll-before'
H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
old=json.loads((OUT.parent/'candidate2-source-manifest.json').read_text())
paths=set(old)|set(subprocess.check_output(['git','ls-files','-co','--exclude-standard','backend','contracts','web'],cwd=ROOT,text=True).splitlines())
new={p:H(ROOT/p) for p in sorted(paths)}
delta=[{'path':p,'before':old.get(p),'after':h} for p,h in new.items() if old.get(p)!=h]
assert {d['path'] for d in delta}=={'web/src/lib/client/work-stream.ts','web/test/poll-scope.test.ts'},delta
for d in delta:
 if d['before']:assert H(BASE/d['path'])==d['before']
patch=''.join(''.join(difflib.unified_diff((BASE/d['path']).read_text().splitlines(True) if d['before'] else [],(ROOT/d['path']).read_text().splitlines(True),fromfile='before/'+d['path'],tofile='after/'+d['path'])) for d in delta)
for name,data in [('source-manifest',new),('source-delta',delta)]:
 with (OUT/(name+'.json')).open('x') as f:json.dump(data,f,indent=2);f.write('\n')
with (OUT/'delta.patch').open('x') as f:f.write(patch)
print(json.dumps({'source_files':len(new),'delta_files':len(delta),'manifest_sha256':H(OUT/'source-manifest.json'),'delta':delta},indent=2))
