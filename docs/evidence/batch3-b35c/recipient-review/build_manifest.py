"""Emit immutable review manifest from actual retained outputs and source bytes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
from decimal import Decimal
import difflib,json,subprocess
ROOT=Path(__file__).resolve().parents[4]
OUT=Path(__file__).resolve().parent
R=str(OUT.relative_to(ROOT))
def digest(path):return sha256((ROOT/path).read_bytes()).hexdigest()
def load(path):return json.loads((ROOT/path).read_text())
product='.local/batch3/b35c/recipient-product/20261030T000409Z-independent-review-0f0971c1/summary.json'
previous='.local/batch3/b35c/recipient-product/20261029T234614Z-full-product-af8634ec/summary.json'
install='.local/batch3/b35c/recipient-install-tests/ede9fcc999344948aa4148d882a5de7f/summary.json'
p=load(product);old=load(previous);i=load(install);w=load(R+'/workflow-results.json');installed=load(R+'/installed-readonly.json')
assert p['status']=='PASS' and len(p['scenarios'])==3 and all(x['status']=='PASS' for x in p['scenarios'])
assert p['sql_sha256']==old['sql_sha256']==digest('evaluation/recipient_funding.sql')
assert p['verifier_sha256']==digest('evaluation/verify_recipient_product.py')
assert i['status']=='PASS' and len(i['checks'])==7
assert w['status']=='BLOCKER_REPRODUCED' and {x['arm'] for x in w['results']}=={'B1','M1'}
assert installed['verified_databases']==12 and installed['verified_grants']==24
source=[f'evaluation/{s}' for s in ('recipient_funding.sql','verify_recipient_funding.py','verify_recipient_product.py','install_recipient_funding.py','live_tool_authority.py','verify_live_installation.py','run_live_study.py','study_binding.py','study_worker.py','test_study_integration.py','study_application.py','study_transport.py','study_controller.py','study_diagnostic.py','network_harness.py','accounting_correction.sql')]
source += ['backend/workagent/capabilities/'+x for x in ('policy.py','registry.py','models.py','file_adapters.py')]
source += ['backend/workagent/general_worker.py','backend/workagent/conversations.py','backend/migrations/074_run_output_resources.sql','docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md','.local/batch3/b35c/recipient-lane/recipient_funding.sql']
old_sql=ROOT/'.local/batch3/b35c/recipient-lane/recipient_funding.sql'
new_sql=ROOT/'evaluation/recipient_funding.sql'
diff=''.join(difflib.unified_diff(old_sql.read_text().splitlines(True),new_sql.read_text().splitlines(True),fromfile=str(old_sql.relative_to(ROOT)),tofile=str(new_sql.relative_to(ROOT))))
with (OUT/'sql-adaptation.diff').open('x') as f:f.write(diff)
retained=[previous,product,install,'.local/batch3/b35c/recipient-integration/minimal-2grants-01.log','.local/batch3/b35c/recipient-install-tests/449f0e7ba04a442bbb67a2972a82d7d9/summary.json','docs/evidence/batch3-b35c/accounting-correction-review/CLOSURE.md','docs/evidence/batch3-b35c/integration/REVIEW_CLOSURE.md','docs/evidence/batch3-b35c/integration/CURRENT_HANDOFF.md']
artifacts=[str(x.relative_to(ROOT)) for x in sorted(OUT.iterdir()) if x.is_file() and x.name!='REVIEW.json']
commands=[]
def cmd(command,exit_code,result,log=None):
    item=dict(command=command,exit_code=exit_code,result=result)
    if log:item['log']=R+'/'+log
    commands.append(item)
cmd('PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=evaluation:backend backend/.venv/bin/python -m pytest -q -p no:cacheprovider evaluation/test_study_integration.py -k \'sourceless_dependency_bytecode or actual_worker_rejects_pin\' --basetemp /home/ubuntu/.hermes/cache/scratch/recipient-review-r1-20261030 --junitxml='+R+'/r1.xml',0,'3 passed, 25 deselected; host and actual jailed child negatives','r1.log')
cmd('PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python evaluation/run_live_study.py --credential-file /nonexistent/recipient-review-never-read --initial-phase-usd 2',1,'Expected paid_execution_unreleased_t_e07c8870 before credential access; shell exit assertion succeeded','release-locked.log')
cmd('PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python evaluation/install_recipient_funding.py verify',0,'12 exact identities verified read-only','exact12-readonly.log')
for n,(log,result) in enumerate([('workflow.log','Review fixture error: mismatched stable goal caused source_changed'),('workflow-02.log','Review fixture error: missing workspaces state'),('workflow-03.log','Review fixture error: comparison used whole time-sensitive artifact DTO'),('workflow-04.log','Real full-tool B1/M1 workers ready; FileBody episode2 blocker reproduced; immutable revision unchanged')]):
    cmd('PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python '+R+'/probe_workflow.py',1 if n<3 else 0,result,log)
cmd('PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python '+R+'/probe_installed_readonly.py',0,'12 distinct physical recipients, 24 exact grants, raw12, all unfunded/zero response events','installed-readonly.log')
cmd('PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python -m pytest -q -p no:cacheprovider '+R+'/test_phase_protocol.py --basetemp /home/ubuntu/.hermes/cache/scratch/recipient-review-phase-20261030 --junitxml='+R+'/phase-unit.xml',0,'4 unit/mock orchestration cases passed; no database execution','phase-unit.log')
cmd('PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python evaluation/verify_recipient_product.py --label independent-review',0,'3 current exact-byte real product scenarios PASS; wire mocked; zero provider calls','product-current.log')
cmd('PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python evaluation/verify_live_installation.py',0,'7 current disposable installation/tool checks PASS','install-current.log')
cmd('diff -u .local/batch3/b35c/recipient-lane/recipient_funding.sql evaluation/recipient_funding.sql',1,'Expected adaptation-only difference 8/50 to2/12 and error name','sql-adaptation.diff')
result=dict(schema='independent-recipient-review-v1',generated_at=datetime.now(timezone.utc).isoformat(),workspace=str(ROOT),
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),verdict='CHANGES_REQUIRED',live_acceptance=False,
    reviewer=dict(model='GPT-6-Astra',provider='openai-codex',within_run_independent=True,development_billing='outside product ledger, unreconciled'),
    boundaries=dict(implementation_changes=False,installed_database_changes=False,issuer_execution=False,paid_calls=0,provider_network_calls=0,live_release_modified=False,credentials_modified=False,commits=False,board_transitions=False),
    findings=[dict(id='F1',severity='P1',blocking=True,title='Tool-granted B1/M1 FileBody draft crashes document-only episode2 human edit',locations=['evaluation/study_application.py:163-172','evaluation/live_tool_authority.py:23-25','backend/workagent/capabilities/policy.py:38-44'],evidence=[R+'/workflow-results.json',R+'/workflow-04.log'],expected='ordinary authorized edit of emitted editable artifact, preserving human contribution',actual="AttributeError: 'FileBody' object has no attribute 'blocks'",arms=['B1','M1'])],
    scope_results=dict(recipient_gate='PASS narrow real-PG/real-product wire-fixture scope',exact_installer='PASS disposable inactive bootstrap',phase_bridge='PASS mock orchestration only; real issuance not executed',live_driver='PASS release-lock negative only',residual_R1='PASS independent host/actual-child negatives',installed_topology='PASS exact read-only12/24 unfunded',longitudinal_workflow='FAIL F1',full_live_study='NOT ACCEPTED'),
    current_product_summary=p,current_installer_summary=i,workflow_results=w,installed_summary={k:v for k,v in installed.items() if k!='rows'},
    retained_evidence_reuse=dict(minimal_pg_groups=13,sql_matches=True,old_product_verifier_hash=old['verifier_sha256'],current_product_verifier_hash=p['verifier_sha256'],old_verifier_differs=old['verifier_sha256']!=p['verifier_sha256'],response='reran current exact-byte3 scenarios; did not treat old verifier as current',correction_review_reopened=False,R2_R4_review_reopened=False),
    financial_calculations=dict(reservation_usd=str((Decimal(50000)*Decimal('2.5')+Decimal(8192)*Decimal(10))/Decimal(1000000)),prior_checkpoint_unallocated_usd=str(Decimal(100)-Decimal('68.0597000')),hypothetical_incremental_initial_2_if_all12_begin_usd=str(Decimal(2)*12),checkpoint_not_freshly_reconciled=True,no_full_study_preallocation=True),
    commands=commands,source_sha256={x:digest(x) for x in source},retained_evidence_sha256={x:digest(x) for x in retained},artifact_sha256={x:digest(x) for x in artifacts},
    limitations=['No real issuer certificate issued or installed funded admission verified.','No unlocked driver or full real tool-granted72-episode campaign.','Current full-product verifier uses reply-only scripted outputs; workflow probe separately uses full tool schema.','Tool selector bootstrap and create-draft exercised, not every adapter or selector branch.','Mock phase retry does not clear controller unknown operations.','Failed probe attempts preserved; final probe code hash is for completed workflow-04 run.'])
with (OUT/'REVIEW.json').open('x') as f:json.dump(result,f,indent=2,sort_keys=True);f.write('\n')
print(json.dumps(dict(verdict=result['verdict'],blocking_findings=len(result['findings']),source_hashes=len(source),commands=len(commands),review_json=str((OUT/'REVIEW.json').relative_to(ROOT))),sort_keys=True))
