"""Bind reused evidence without relabeling it new execution."""
import json,subprocess
from pathlib import Path
from hashlib import sha256
ROOT=Path.cwd();OUT=Path(__file__).resolve().parent
BASE='f206eda4609dd9223332ceaaeccd10adb134beee'
def h(p):return sha256(Path(p).read_bytes()).hexdigest()
paths=subprocess.check_output(['git','ls-files','backend/workagent','backend/migrations','web/src','web/test','contracts/src'],text=True).splitlines()
source={}
for name in paths:
 p=Path(name)
 if not p.is_file():continue
 current=p.read_bytes();previous=subprocess.check_output(['git','show',BASE+':'+name])
 assert current==previous,name
 source[name]=sha256(current).hexdigest()
F=Path('.local/batch3/b35c/filename-delivery-candidate')
web=json.loads((F/'web-owner/HANDOFF.json').read_text())
for name,entry in web['changed_files'].items():assert h(Path('web')/name)==entry['patched'],name
fmt=json.loads(Path('docs/evidence/batch3-b35c/acceptance/FORMAT_EQUIVALENCE.json').read_text())
for e in fmt['files']:assert h(e['path'])==e['after_sha256']
browser=F/'client-replay-02/browser';rows=[json.loads(l) for l in (browser/'final-browser.jsonl').read_text().splitlines()]
assert len(rows)==4
files=[]
for row in rows:
 assert len(row['downloads'])==1
 d=row['downloads'][0];p=browser/('final-'+row['surface']+'-'+row['artifact'])/d['filename']
 assert p.stat().st_size==d['bytes'] and h(p)==d['sha256']
 files.append(dict(path=str(p),surface=row['surface'],**d))
refs=['docs/evidence/batch3-b35c/acceptance/PROVISION_R1.md','docs/evidence/batch3-b35c/acceptance/FILENAME_REPAIR_REPORT.md','docs/evidence/batch3-b35c/acceptance/EVALUATION_REPORT.md','docs/evidence/batch3-b35c/acceptance/ROSTER_SUMMARY.json','docs/evidence/batch3-b35c/acceptance/FORMAT_EQUIVALENCE.json',str(F/'web-owner/HANDOFF.json'),str(browser/'final-browser.jsonl'),'.local/batch3/b35c/provision-r1-20261101/PARENT_FINAL_VERIFICATION.json','.local/batch3/b35c/acceptance-r2-20261101/REVIEW.md']
r={'base':BASE,'unchanged_product_source_files':len(source),'source':source,'reused_reports':{p:h(p) for p in refs},'unchanged_filename_web_delta_files':len(web['changed_files']),'unchanged_previously_verified_formatting_files':len(fmt['files']),'reused_actual_browser_downloads':files,'limits':'No new browser execution; saved-material legacy live75 replay evidence remains separate from new scripted current-schema worker/client proof. R1 source/PG/review accepted and not rerun.'}
with (OUT/'EVIDENCE_REUSE.json').open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps({k:v for k,v in r.items() if k!='source'},indent=2))
