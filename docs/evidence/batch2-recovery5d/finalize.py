from pathlib import Path
import os,json,hashlib,subprocess,shutil,xml.etree.ElementTree as ET,zipfile
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/batch2-recovery5d'
import sys;sys.path.insert(0,str(ROOT/'backend'))
from workagent.db import Database
H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def save(name,data):
 if (OUT/name).exists():
  assert json.loads((OUT/name).read_text())==data, 'Never replace a differing receipt'
  return
 with (OUT/name).open('x') as f:json.dump(data,f,indent=2,default=str);f.write('\n')
m=json.loads((OUT/'candidate2-source-manifest.json').read_text());assert len(m)==610 and all(H(ROOT/p)==h for p,h in m.items())
shutil.copyfile(OUT/'candidate2-source-manifest.json',OUT/'source-manifest.json')
shutil.copyfile(OUT/'candidate2-source-delta.json',OUT/'source-delta.json')
with Database().transaction() as c:
 names=['provider_attempts','responses_steps','responses_events','responses_budget_carry','responses_consumer_uses'];provider={}
 for name in names:
  rows=c.execute('SELECT to_jsonb(t) value FROM '+name+' t ORDER BY to_jsonb(t)::text').fetchall();provider[name]={'count':len(rows),'sha256':hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()}
assert provider==json.loads((OUT/'provider-before-browser.json').read_text())
save('provider-final.json',{'tables':provider,'browser_boundary_unchanged':True,'new_product_provider_calls':0,'new_product_spend':0})
a=json.loads((OUT/'audit-after-tests.json').read_text());b=json.loads((OUT/'audit-final.json').read_text());assert a['ledger_tables']==b['ledger_tables'];assert a['preexisting5c_memberships_sha256']==b['preexisting5c_memberships_sha256'];assert a['preexisting_source_access_sha256']==b['preexisting_source_access_sha256'];assert a['fixture_conversations']==b['fixture_conversations']
pid=subprocess.check_output(['tmux','display-message','-p','-t','b2r5d-aux','#{pane_pid}'],text=True).strip();p=Path('/proc')/pid;assert str((p/'cwd').resolve())==str(ROOT);assert b'fixture.py api local-human 18966' in (p/'cmdline').read_bytes().replace(b'\0',b' ');subprocess.run(['tmux','kill-session','-t','b2r5d-aux'],check=True)
services=[]
for session in ['b2r5b-api','b2r5b-web']:
 pid=subprocess.check_output(['tmux','display-message','-p','-t',session,'#{pane_pid}'],text=True).strip();p=Path('/proc')/pid;cwd=str((p/'cwd').resolve());assert cwd.startswith(str(ROOT));argv=(p/'cmdline').read_bytes().replace(b'\0',b' ').decode();services.append({'session':session,'pid':int(pid),'cwd':cwd,'argv':argv})
# Scan only this delta's evidence and browser assets for live private env values.
secrets=[os.environ.get(k,'') for k in ['LOCAL_BEARER_TOKEN','DATABASE_URL','MIGRATION_DATABASE_URL']];secrets=[s.encode() for s in secrets if len(s)>8]
files=[p for p in OUT.rglob('*') if p.is_file() and '__pycache__' not in p.parts]+[p for p in (ROOT/'web/.next/static').rglob('*') if p.is_file()]+[ROOT/'docs/BATCH_2_RECOVERY_5D_HANDOFF.md'];matches=[str(p.relative_to(ROOT)) for p in files if any(s in p.read_bytes() for s in secrets)];assert not matches,matches
# Trusted local vitest output, not uploaded/untrusted XML; no external parser input.
r=ET.parse(OUT/'gates2-frontend.xml').getroot();cases=list(r.iter('testcase'));assert len(cases)==510 and not any(c.find(k)is not None for c in cases for k in ['failure','error','skipped'])
assert json.loads((OUT/'verified-browser-report.json').read_text())['status']=='PASS';assert json.loads((OUT/'a28-a35-narrow-report.json').read_text())['status']=='PASS';assert json.loads((OUT/'independent-rereview.json').read_text())['verdict']=='HOLD'
assert subprocess.run(['git','diff','--check'],cwd=ROOT).returncode==0
result={'at':datetime.now(timezone.utc).isoformat(),'verdict':'HOLD','open_finding':'A14-R2-POLL','source_files':610,'source_manifest_sha256':H(OUT/'source-manifest.json'),'delta_files':len(json.loads((OUT/'source-delta.json').read_text())),'frontend_tests':510,'backend_affected_tests':14,'serial_static_build_gates':'PASS','build_id':(ROOT/'web/.next/BUILD_ID').read_text().strip(),'browser_journeys':'PASS with scope stated in handoff; not full A14','a28_a35_narrow':'PASS','services':services,'aux18966':'stopped','secret_scan_files':len(files),'secret_matches':matches,'provider_boundary_unchanged':True,'historical_revocations_unchanged':True,'batch2_complete':False,'publication':'HOLD'}
save('final-verification.json',result)
evidence={str(p.relative_to(ROOT)):H(p) for p in OUT.rglob('*') if p.is_file() and '__pycache__' not in p.parts};evidence['docs/BATCH_2_RECOVERY_5D_HANDOFF.md']=H(ROOT/'docs/BATCH_2_RECOVERY_5D_HANDOFF.md');save('evidence-manifest.json',{'files':evidence})
archive=ROOT/'.local/recovery5d-evidence.zip'
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
 for name in sorted(evidence):z.write(ROOT/name,name)
 z.write(OUT/'evidence-manifest.json','docs/evidence/batch2-recovery5d/evidence-manifest.json')
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
print(json.dumps(result,indent=2));print('ARCHIVE',str(archive),H(archive));print('HANDOFF_BASE64');import base64;print(base64.b64encode((ROOT/'docs/BATCH_2_RECOVERY_5D_HANDOFF.md').read_bytes()).decode())
