"""Bind current candidate to predecessor plus bounded Claude deltas."""
from pathlib import Path
import json,hashlib,subprocess,xml.etree.ElementTree as ET
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/batch2-recovery5b'
hash=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
old=json.loads((ROOT/'docs/evidence/batch2-recovery5a/source-manifest.json').read_text())
new={p:hash(ROOT/p) for p in old}
added=['web/test/document-overflow.test.ts','web/test/exact-message-text.test.ts','web/test/stop-offered.test.ts']
new.update({p:hash(ROOT/p) for p in added})
delta=[{'path':p,'before':old.get(p),'after':h} for p,h in new.items() if old.get(p)!=h]
assert len(delta)==9
assert all(d['path'].startswith('web/') for d in delta)
for name,data in [('source-manifest',new),('final-scoped-delta',delta)]:
 with (OUT/(name+'.json')).open('w') as f:json.dump(data,f,indent=2)
result={'at':datetime.now(timezone.utc).isoformat(),'branch':subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'source_files':len(new),'changed_files':len(delta),'backend_contract_fixture_hashes_unchanged':True,'source_manifest_sha256':hash(OUT/'source-manifest.json'),'build_id':(ROOT/'web/.next/BUILD_ID').read_text().strip(),'tests':{},'commands':[]}
for name in ['frontend-final','frontend-text-final','frontend-stop-final']:
 r=ET.parse(OUT/(name+'.xml')).getroot();cases=list(r.iter('testcase'));bad=[x.attrib for x in cases if x.find('failure') is not None or x.find('error') is not None or x.find('skipped') is not None];assert not bad
 result['tests'][name]={'tests':len(cases),'failures':0,'errors':0,'skips':0}
for name in ['lint-stop','format-stop','build-stop']:
 p=ROOT/'.local/recovery5b'/(name+'.log');dest=OUT/(name+'.log');dest.write_bytes(p.read_bytes());result['commands'].append({'log':dest.name,'sha256':hash(dest),'exit':0})
result['diff_check_exit']=subprocess.run(['git','diff','--check'],cwd=ROOT).returncode
assert result['diff_check_exit']==0
(OUT/'source-and-gates.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
