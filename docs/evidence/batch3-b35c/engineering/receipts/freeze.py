"""Read-only fixture evidence; no provider or external evaluator imports."""
from pathlib import Path
from hashlib import sha256
import os,json,platform
import psycopg
from psycopg.rows import dict_row
from workagent.adaptive import contract
from workagent.capabilities.delegation_composition import SCHEMA
from workagent.general_responses import consumer_hash
from workagent.request_packing import estimate,_encoder
from types import SimpleNamespace
root=Path.cwd(); out=root/'docs/evidence/batch3-b35c/engineering';out.mkdir(exist_ok=True,parents=True)
paths=['backend/workagent/models.py','backend/workagent/adaptive.py','backend/workagent/memory/runtime.py','backend/migrations/073_full_tool_memory_treatment.sql','backend/tests/test_memory_full_tools.py','contracts/provider-grant.schema.json']
policies={}
for mode in ['off','reviewed-v1']:
    policy,schema=contract(SimpleNamespace(continuity_version='sustained-v1',scope_tool_sha256=sha256(SCHEMA.material).hexdigest(),memory_recall=mode))
    policies[mode]={'policy_sha256':sha256(policy.encode()).hexdigest(),'schema_sha256':sha256(schema.material).hexdigest()}
assert policies['off']==policies['reviewed-v1']
assert '/workagent_test_' in os.environ['DATABASE_URL']
rows=[]
with psycopg.connect(os.environ['DATABASE_URL'],row_factory=dict_row) as c:
    c.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    c.execute("SET LOCAL statement_timeout='10s'")
    for r in c.execute("SELECT rc.run_id,rc.data->'responses'->>'memory_recall' treatment,s.phase,s.request_sha256,s.request_bytes,s.count_bytes FROM run_configurations rc JOIN provider_attempts a ON a.run_id=rc.run_id AND a.workspace_id=rc.workspace_id JOIN responses_steps s ON s.attempt_id=a.id WHERE rc.data->'responses' ? 'memory_recall' ORDER BY rc.run_id,s.phase").fetchall():
        raw=r.pop('request_bytes'); count=r.pop('count_bytes');payload=json.loads(raw);ctx=json.loads(payload['input'][0]['content'])
        assert sha256(raw.encode()).hexdigest()==r['request_sha256']
        r.update(request_bytes=len(raw.encode()),local_estimated_count_tokens=estimate(count),count_sha256=sha256(count.encode()).hexdigest(),
            policy_sha256=sha256(payload['instructions'].encode()).hexdigest(),tools_sha256=sha256(json.dumps(payload['tools'],sort_keys=True,separators=(',',':')).encode()).hexdigest(),
            has_memory='memory_context' in ctx,memory_manifest=ctx.get('memory_manifest'))
        rows.append(r)
    migrations=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    c.rollback()
record={'status':'deterministic_real_PG_worker_request_proof_not_live_A_B','python':platform.python_version(),'consumer_sha256':consumer_hash(),
    'source_files':{p:sha256((root/p).read_bytes()).hexdigest() for p in paths},'treatments':policies,'tokenizer':'local_o200k' if _encoder() else 'UTF8_upper_bound',
    'token_count_limitations':'Local whole-count-body estimates only, not provider counts. Synthetic short fixtures cannot establish held-out context fit.',
    'fixture_requests':rows,'request_count':len(rows),'migrations':migrations,'product_paid_requests':0,'live_trajectories':0,'live_episodes':0,'installed':False}
(out/'SOURCE_REQUEST_FREEZE.json').write_text(json.dumps(record,indent=2,default=str)+'\n')
print(json.dumps({'source_files':record['source_files'],'treatments':policies,'consumer_sha256':record['consumer_sha256'],'requests':len(rows),'max_local_estimate':max(x['local_estimated_count_tokens'] for x in rows),'tokenizer':record['tokenizer']},indent=2))
