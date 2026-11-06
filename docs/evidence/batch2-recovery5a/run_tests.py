# XML input is only this harness's own trusted local pytest JUnit output.
import json,os,subprocess,time,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/batch2-recovery5a'
files=['test_batch2_process_restart_pg.py','test_tui_real_stack_pg.py','test_tui_recovery_http_pg.py','test_tui_continuity_commands.py','test_tui_continuity_ui.py','test_tui_composer.py','test_tui_state.py','test_tui_review.py','test_operator_review_http_pg.py','test_b24_runtime_pg.py','test_b24_stale_source_pg.py','test_b24_queue_isolation_pg.py','test_document_journey_pg.py','test_document_target_pg.py','test_work_events_pg.py','test_work_event_emission_auth.py']
keys=['PATH','HOME','USER','LANG','LC_ALL','TMPDIR','DATABASE_URL','MIGRATION_DATABASE_URL','LOCAL_TEST_MODE','LOCAL_BEARER_TOKEN','LOCAL_PRINCIPAL_ID']
env={k:os.environ[k] for k in keys if k in os.environ};env['PYTHONPATH']=str(ROOT/'backend')
args=[str(ROOT/'backend/.venv/bin/python'),'-m','pytest','-q','--tb=short','-rA',*['backend/tests/'+f for f in files],'-o','junit_family=legacy','--junitxml='+str(OUT/'journey-tests.xml')]
start=time.monotonic()
with (OUT/'journey-tests.log').open('x') as log:r=subprocess.run(args,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=1800)
root=ET.parse(OUT/'journey-tests.xml').getroot();cases=root.findall('.//testcase')
result={'command':args,'exit':r.returncode,'seconds':time.monotonic()-start,'tests':len(cases),'failed':sum(c.find('failure') is not None for c in cases),'errors':sum(c.find('error') is not None for c in cases),'skipped':sum(c.find('skipped') is not None for c in cases),'transport_note':'Mixed: actual uvicorn process/socket restart and real socket TUI tests; other tests include in-process FastAPI/Pilot/service calls and explicitly synthetic provider fixtures. None are live model evaluation.'}
result['passed']=result['tests']-sum(result[k] for k in ['failed','errors','skipped'])
(OUT/'journey-test-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));raise SystemExit(r.returncode)
