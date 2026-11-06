"""Additive non-self-referential integration manifest and human-safe ZIP."""
from pathlib import Path
import hashlib
import json
import sqlite3
import subprocess
import zipfile

ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parent
RUN=ROOT/'.local/batch3/b35c/integration-01'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    # Run only after all evidence writers have exited. Never hash stdout-in-flight.
    names=['study_binding.py','study_application.py','study_controller.py','study_diagnostic.py','study_worker.py','study_transport.py','test_study_integration.py','test_study_controller.py','verify_study_diagnostic.py']
    files=[ROOT/'evaluation'/name for name in names]
    files += [p for p in HERE.iterdir() if p.is_file() and p.name not in ('MANIFEST.json',)]
    files += [ROOT/p for p in ['docs/evidence/batch3-b35c/controller-review/REVIEW.md','docs/evidence/batch3-b35c/controller-review/RECEIPT.json','docs/evidence/batch3-b35c/controller-review/test_scoped_review.py','docs/evidence/batch3-b35c/controller/MANIFEST.json','docs/evidence/batch3-b35c/execution/ADDITIVE_BINDING.json','docs/evidence/batch3-b35c/runtime/MANIFEST.json']]
    db=sqlite3.connect(f'file:{RUN/"controller.sqlite"}?mode=ro',uri=True)
    binding=json.loads(db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0])
    assert db.execute("SELECT count(*) FROM operations WHERE operation='collect' AND state='complete'").fetchone()[0]==18
    assert not db.execute("SELECT 1 FROM operations WHERE state!='complete'").fetchall()
    db.close()
    verification=json.loads((HERE/'representative-verification.json').read_text())
    assert verification['episodes']==18 and verification['status']=='PASS'
    manifest={
      'scope':'live-ready_engineering_handoff_release_locked_NOT_live_AB',
      'implementation_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
      'candidate_note':'Commit plus inherited uncommitted product delta; exact product bytes anchored by runtime manifest and sources, not HEAD alone.',
      'files':{str(p.relative_to(ROOT)):sha(p) for p in sorted(set(files))},
      'private_evidence_files':{str(p.relative_to(ROOT)):sha(p) for p in sorted(RUN.rglob('*')) if p.is_file() and p.suffix not in ('.sqlite',) and not p.name.endswith(('-wal','-shm')) and p.name not in ('fixture.env','connection.json','application.json')},
      'execution_binding':binding,
      'verification':verification,
      'targeted_tests':43,
      'historical_review':'changes_required preserved; R2-R4 narrow independent follow-up, residual R1 bytecode closure parent-verified',
      'retained_72_evidence':'read-only reverified, not fresh current-candidate 72-worker campaign',
      'full_72_protocol_coverage':'fresh targeted controller test',
      'paid_calls':0,'new_allocations':0,'installed_mutations':0,'ledger_recollections':0,'live_episodes':0,
      'live_release':None,'deployed':False,'published':False,
      'execution_owner':'t_e07c8870','publication_acceptance_owner':'t_82b30c02',
      'development_model':'GPT-6-Astra/openai-codex','development_billing':'outside_product_ledger_unreconciled'
    }
    with (HERE/'MANIFEST.json').open('x') as f: json.dump(manifest,f,sort_keys=True,indent=2); f.write('\n')
    archive=RUN/'B3.5c-live-ready-engineering-handoff.zip'
    with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(set(files+[HERE/'MANIFEST.json'])): z.write(p,str(p.relative_to(ROOT)))
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        for p,h in manifest['files'].items(): assert hashlib.sha256(z.read(p)).hexdigest()==h
    print(json.dumps({'archive':str(archive),'archive_sha256':sha(archive),'manifest_sha256':sha(HERE/'MANIFEST.json'),'packaged_files':len(files)+1},sort_keys=True))
if __name__=='__main__': main()
