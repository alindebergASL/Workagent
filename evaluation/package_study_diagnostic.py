"""Package only public residual proof; never copy private stores/wire logs."""
import json
import shutil
from pathlib import Path
import sqlite3
import subprocess
from study_controller import ROOT, canonical, digest

source = ROOT/'.local/batch3/b35c/controller-12'
out = ROOT/'docs/evidence/batch3-b35c/controller'
report = json.loads((out/'verification.json').read_text())
assert report['status']=='PASS' and report['episodes']==72
unit = ROOT/'.local/batch3/b35c/controller-unit-final.log'
assert '15 passed' in unit.read_text() and 'failed' not in unit.read_text()
shutil.copyfile(unit,out/'unit-tests.log')
shutil.copyfile(source.parent/'controller-12-first.log',out/'first-process.log')
shutil.copyfile(source.parent/'controller-12-resumed.log',out/'resumed-process.log')
db=sqlite3.connect(f'file:{source/"controller.sqlite"}?mode=ro',uri=True)
binding=json.loads(db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0])
for name,expected in binding['execution'].items():
    assert digest((ROOT/'evaluation'/name).read_bytes())==expected
files=[ROOT/'evaluation'/n for n in ('study_controller.py','study_application.py','study_worker.py','study_transport.py','study_diagnostic.py','test_study_controller.py','verify_study_diagnostic.py','package_study_diagnostic.py')]
files += sorted(p for p in out.iterdir() if p.name!='MANIFEST.json')
record={'scope':'residual_implementation_pending_scoped_review_not_live_AB','diagnostic_directory':str(source.relative_to(ROOT)),
        'implementation_commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
        'files':{str(p.relative_to(ROOT)):digest(p.read_bytes()) for p in files},
        'execution_binding':binding['execution'],
        'product_source_manifests_sha256':{v:digest(canonical(m)) for v,m in binding['sources'].items()},
        'schedule_sha256':binding['schedule_sha256'],
        'retained_additive_binding_sha256':digest((ROOT/'docs/evidence/batch3-b35c/execution/ADDITIVE_BINDING.json').read_bytes()),
        'retained_preparation_freeze_sha256':digest((ROOT/'.local/batch3/b35c/preparation/evaluator/FREEZE.json').read_bytes()),
        'verification':report,'unit_tests_passed':15,'paid_execution_release':None,
        'historical_failures_preserved':True,'installed_mutations':0,'new_allocations':0,'ledger_recollections':0,
        'default_merged':False,'deployed':False,'published':False,'review':'pending_t_f251a5a9',
        'integration_owner':'t_fedd7a60','live_execution_owner':'t_e07c8870',
        'development_model':'gpt-6-astra/openai-codex','development_billing':'outside product ledger; unreconciled'}
(out/'MANIFEST.json').write_text(json.dumps(record,sort_keys=True,indent=2)+'\n')
print(json.dumps({'manifest':str(out/'MANIFEST.json'),'sha256':digest((out/'MANIFEST.json').read_bytes()),'proof':report},indent=2))
