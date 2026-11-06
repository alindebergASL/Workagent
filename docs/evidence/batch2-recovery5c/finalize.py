"""Finalize append-only evidence index/supplement; never changes the historical matrix."""
from pathlib import Path
import os,json,hashlib,sys,subprocess,re,zipfile
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'backend'))
from workagent.db import Database
OUT=ROOT/'docs/evidence/batch2-recovery5c'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(name,d):
 with (OUT/name).open('x') as f:json.dump(d,f,indent=2,ensure_ascii=False,default=str);f.write('\n')
source=ROOT/'docs/evidence/batch2-recovery5b/source-manifest.json';m=json.loads(source.read_text());assert len(m)==602 and not [p for p,h in m.items() if sha(ROOT/p)!=h]
assert sha(source)=='1a969241aa7dfba5f77cf7382f2c521cb1d5fd12bb1ce831e230968fba89017f'
assert json.loads((OUT/'source-manifest.json').read_text())==m  # JSON whitespace differs; exact602 path/hash pairs are identical.
historical=ROOT/'docs/evidence/batch2-recovery5b/acceptance-matrix.json';matrix=json.loads(historical.read_text());assert len(matrix['rows'])==43
rows=[]
verdicts={
 'A14':('RED — NOT CLOSED','Real combined authenticated-principal/backend endpoint switch exposes previous principal unsent draft; staged PDF not rendered under B, bytes retained in IndexedDB. Fresh revoked reads404, but active midstream proof interrupted by socket error. Needs Claude scope identity correction and bounded full journey.',['scope-report.json','scope-principal-b.png','scope-revoked.json','final2-browser-report.json']),
 'A28':('VERIFIED — deterministic paired scope','26 total/20 samples; actual browser focus-refresh resets consent on newer candidate, consent-bearing stale base409; TUI no-consent refusal then exact fresh accept; browser/HTTP readback. Focus-refresh, not continuous polling; retained automatic-reset red. Prior older regression evidence reused.',['review2-report.json','pty-sample-back-1.txt','pty-consent-location.txt','pty-accept-readback.json','pty-accepted-body.txt','final2-browser-report.json']),
 'A35':('VERIFIED — deterministic paired scope','5 objects/17 lines and10 objects/40 lines; exact duplicates/blank/trailing bytes. Browser cell saves, unchanged UI no-op, separately real unchanged browser wire-save; Textual full-body captures and final actual terminal executable/current API hashes.',['notes4-report.json','final2-browser-report.json','pty-five-selected.txt','pty-five-scrolled.txt','pty-ten-selected.txt','pty-ten-scrolled.txt','terminal-parity.json'])}
for row in matrix['rows']:
 if row['id'] in verdicts:
  status,scope,paths=verdicts[row['id']]
  assert all((OUT/p).exists() for p in paths)
  rows.append({'id':row['id'],'case':row['case'],'required':row['required'],'evidence_required':row['evidence_required'],'prior_status':row['status'],'status':status,'scope':scope,'evidence':paths,'live_provider_evidence':False})
assert len(rows)==3
supp={'base_matrix':str(historical.relative_to(ROOT)),'base_matrix_sha256':sha(historical),'base_rows':43,'supplement_rows':3,'other_rows_unchanged':40,'batch2_complete':False,'publication_gate':'HOLD','rows':rows}
put('acceptance-supplement.json',supp)
with (OUT/'acceptance-supplement.md').open('x') as f:
 f.write('# Additive recovery5c supplement — full Batch2 HOLD\n\nHistorical recovery5b43-row matrix is untouched; only these3 dispositions are supplemented. Other40 and all live/longitudinal obligations remain unchanged.\n\n')
 for row in rows:f.write('## '+row['id']+' — '+row['status']+'\n\n'+row['scope']+'\n\nEvidence: '+', '.join('`'+p+'`' for p in row['evidence'])+'\n\n')
proof={}
with Database().transaction() as c:
 for name,sql in {
 'provider_attempts':"SELECT count(*) n FROM provider_attempts WHERE workspace_id IN (%s,%s)",
 'responses_steps':"SELECT count(*) n FROM responses_steps s JOIN provider_grants g ON g.id=s.grant_id WHERE g.workspace_id IN (%s,%s)",
 'responses_events':"SELECT count(*) n FROM responses_events e JOIN responses_steps s USING(attempt_id,phase) JOIN provider_grants g ON g.id=s.grant_id WHERE g.workspace_id IN (%s,%s)",
 'provider_grants':"SELECT count(*) n FROM provider_grants WHERE workspace_id IN (%s,%s)"}.items():proof[name]=c.execute(sql,('recovery5c-workspace','recovery5c-scope')).fetchone()['n']
 assert all(x==0 for x in proof.values())
put('no-provider-scoped-joined.json',{'scopes':['recovery5c-workspace','recovery5c-scope'],'counts':proof,'product_provider_calls':0,'inline_controlled_seed_run_dispatches':3})
before=json.loads((OUT/'audit-before.json').read_text());after=json.loads((OUT/'audit-final.json').read_text());assert before['preexisting_source_access_sha256']==after['preexisting_source_access_sha256'];assert before['ledger_tables']['provider_grants']==after['ledger_tables']['provider_grants']
files=[p for p in OUT.rglob('*') if p.is_file() and '__pycache__' not in p.parts]
patterns=[r'postgres(?:ql)?://',r'Bearer\s+[A-Za-z0-9_-]{24,}',r'sk-[A-Za-z0-9_-]{20,}']
hits=[]
for p in files:
 if p.suffix in ['.json','.txt','.md','.py','.mjs']:
  text=p.read_text()
  if any(re.search(x,text) for x in patterns) and p.name!='finalize.py':hits.append(str(p))
assert not hits,hits
processes={}
for session in ['b2r5b-api','b2r5b-web']:
 pid=int(subprocess.check_output(['tmux','display-message','-p','-t',session,'#{pane_pid}'],text=True));proc=Path('/proc')/str(pid);env=dict(x.split(b'=',1) for x in (proc/'environ').read_bytes().split(b'\0') if b'=' in x)
 processes[session]={'pid':pid,'cwd':str((proc/'cwd').resolve()),'argv':(proc/'cmdline').read_bytes().replace(b'\0',b' ').decode()}
 if session.endswith('web'):assert env[b'WORKAGENT_BACKEND_URL']==b'http://127.0.0.1:18965';processes[session]['backend']='http://127.0.0.1:18965'
put('checkpoint-verification.json',{'source_files':602,'source_delta':[],'source_manifest_sha256':sha(source),'matrix_rows':43,'supplement_rows':3,'untouched_rows':40,'secret_scan_matches':hits,'source_hashes_verified':True,'services':processes,'aux_api_stopped':not Path('/proc/3980823').exists(),'tui_detached':True,'product_provider_calls':0,'pty_capture_pairs':len(list(OUT.glob('*.ansi'))),'git_diff_check':subprocess.run(['git','diff','--check'],cwd=ROOT).returncode})
files=sorted(p for p in OUT.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
put('evidence-manifest.json',{'files':{str(p.relative_to(ROOT)):sha(p) for p in files},'handoff':{'path':'docs/BATCH_2_RECOVERY_5C_HANDOFF.md','sha256':sha(ROOT/'docs/BATCH_2_RECOVERY_5C_HANDOFF.md')}})
archive=ROOT/'.local/recovery5c-evidence.zip'
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(OUT.rglob('*')):
  if p.is_file() and '__pycache__' not in p.parts:z.write(p,p.relative_to(ROOT))
 z.write(ROOT/'docs/BATCH_2_RECOVERY_5C_HANDOFF.md','docs/BATCH_2_RECOVERY_5C_HANDOFF.md')
with zipfile.ZipFile(archive) as z:assert z.testzip() is None;members=len(z.namelist())
print(json.dumps({'source_manifest_sha256':sha(source),'evidence_manifest_sha256':sha(OUT/'evidence-manifest.json'),'archive':str(archive),'archive_sha256':sha(archive),'archive_members':members,'rows':[(r['id'],r['status']) for r in rows],'provider':proof,'services':processes},indent=2))
