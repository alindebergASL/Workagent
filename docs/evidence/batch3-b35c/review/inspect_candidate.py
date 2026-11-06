"""Read-only exact-source reviewer receipt. Source final.env without printing it."""
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

import psycopg

root = Path.cwd()
here = root / 'docs/evidence/batch3-b35c/review'
runtime_path = root / 'docs/evidence/batch3-b35c/runtime/MANIFEST.json'
runtime = json.loads(runtime_path.read_bytes())
for name, expected in runtime['files'].items():
    assert sha256((root / name).read_bytes()).hexdigest() == expected, name
memory = json.loads((root / 'docs/evidence/batch3-b35c/engineering/SOURCE_REQUEST_FREEZE.json').read_bytes())
for name, expected in memory['source_files'].items():
    assert sha256((root / name).read_bytes()).hexdigest() == expected, name
assert '/workagent_test_' in os.environ['DATABASE_URL']
with psycopg.connect(os.environ['DATABASE_URL']) as c:
    c.execute('SET TRANSACTION READ ONLY')
    role = c.execute("SELECT rolsuper,rolbypassrls,current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='tool_grants'::regclass)) FROM pg_roles WHERE rolname=current_user").fetchone()
    assert role == (False, False, False), role
    functions = {}
    for name in ['reserve_tool_call(text,text,integer,text,jsonb,text)', 'tool_native_file_resources_authorized(text,text,jsonb)', 'tool_pre_office_resources_authorized(text,text,jsonb)']:
        definition, definer, config = c.execute('SELECT pg_get_functiondef(oid),prosecdef,proconfig FROM pg_proc WHERE oid=%s::regprocedure',(name,)).fetchone()
        assert 'public.tool_effective_resources(ws,rid)' in definition, name
        functions[name] = {'sha256':sha256(definition.encode()).hexdigest(),'security_definer':definer,'config':config}
    migrations = [row[0] for row in c.execute('SELECT name FROM schema_migrations ORDER BY name')]
    assert migrations[-1] == '074_run_output_resources.sql'
# Trusted local pytest-generated JUnit, not uploaded/untrusted XML input.
suite = ET.parse(here / 'probes.xml').getroot().find('testsuite')
assert suite is not None
assert (suite.get('tests'),suite.get('failures'),suite.get('errors'),suite.get('skipped')) == ('3','0','0','0')
changed = ['backend/migrations/074_run_output_resources.sql','backend/workagent/capabilities/models.py','backend/workagent/capabilities/policy.py','backend/workagent/capabilities/registry.py','backend/workagent/conversations.py','contracts/tool-grant.schema.json','contracts/capability-registry-v2.json','backend/tests/test_run_output_workflow.py','backend/tests/test_workspace_file_gateway_pg.py']
result = dict(
    verdict='PASS_narrow_exact_source_review',
    full_live_AB='NOT_ESTABLISHED_existing_execution_card_owns_gaps',
    base_head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
    branch=subprocess.check_output(['git','branch','--show-current'],text=True).strip(),
    runtime_manifest_sha256=sha256(runtime_path.read_bytes()).hexdigest(),
    runtime_hashes_verified=len(runtime['files']),
    accepted_memory_source_files_unchanged=len(memory['source_files']),
    changed_source_sha256={name:sha256((root/name).read_bytes()).hexdigest() for name in changed},
    restricted_disposable_role={'superuser':role[0],'bypassrls':role[1],'table_owner':role[2]},
    migration_count=len(migrations),material_SQL_functions=functions,
    independently_executed_tests=3, reused_predecessor_tests=33,
    new_product_calls=0,live_episodes=0,new_allocation_usd='0',
    ledger_recollected=False,installed_maintenance=False,published=False,deployed=False,
    development_model='gpt-6-astra/openai-codex',development_tool_billing='Outside product ledger; unreconciled',
    evidence_sha256={p.name:sha256(p.read_bytes()).hexdigest() for p in sorted(here.iterdir()) if p.is_file() and p.name!='RECEIPT.json'},
    successor='t_e07c8870')
(here/'RECEIPT.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in {'changed_source_sha256','evidence_sha256','material_SQL_functions'}},indent=2))
