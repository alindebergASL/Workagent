"""Read-only exact run checkpoint, excluding credential-bearing configs."""
import json
from pathlib import Path
from decimal import Decimal
import sqlite3
import study_application as A
from study_controller import canonical,digest
from observe_live_study import pending_safety
ROOT=Path(__file__).resolve().parents[1]
SLOT=ROOT/'.local/batch3/b35c/live-study/campaign/d477c622c837a9cc1fb1f0be'
OUT=ROOT/'.local/batch3/b35c/discovery-recovery'
state=json.loads((SLOT/'application.json').read_text());s,p,_=A.context(SLOT,state)
run=s.get_run(p,state['workspace'],state['current_run'])
with s.db.transaction() as c:
    rows=c.execute('SELECT e.phase,e.kind,e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.phase,e.kind,e.id',(run.id,)).fetchall()
    grants=c.execute('SELECT id,data FROM provider_grants ORDER BY id').fetchall()
    migrations=[r['name'] for r in c.execute('SELECT name FROM schema_migrations ORDER BY name').fetchall()]
phases={}
for row in rows:
    v=phases.setdefault(row['phase'],{'events':{}});v['events'][row['kind']]=v['events'].get(row['kind'],0)+1
    if row['kind']=='result':v['result']={k:row['data'].get(k) for k in ['response_id','request_sha256','state','issue','usage']}
    if row['kind']=='tool_result':v['tool_result_status']=row['data'].get('status')
with sqlite3.connect('file:'+str(SLOT.parent/'bridge.sqlite')+'?mode=ro',uri=True) as c:
    bridge=[dict(zip(['key','state','payload_sha256','result'],[key,status,digest(payload),result])) for key,status,payload,result in c.execute("SELECT key,state,payload,result FROM receipts WHERE state<>'complete'")]
with sqlite3.connect('file:'+str(SLOT.parent/'controller.sqlite')+'?mode=ro',uri=True) as c:
    collected=c.execute("SELECT count(*) FROM operations WHERE operation='collect' AND state='complete'").fetchone()[0]
report={'run':{'id':run.id,'state':run.state,'unresolved':run.unresolved},'phases':phases,
    'pending_safety':pending_safety(s,state),'pending_bridge':bridge,'collected':collected,'scheduled_episodes':72,
    'provider_grants_sha256':digest(canonical(grants)),'latest_migration':migrations[-1],
    'source_manifest_sha256':state['source_manifest_sha256'],'active_amendment_sha256':digest((ROOT/'.local/batch3/b35c/gateway-recovery/SOURCE_AMENDMENT.json').read_bytes()),
    'diagnostic_read_sha256':digest((OUT/'schema-diagnostic/DIAGNOSIS.json').read_bytes()),
    'new_allocation_usd':'0','new_certificates':0,'installed_migrations_this_continuation':0,
    'development_tool_costs':'outside_product_ledger_unreconciled'}
path=OUT/'LIVE_CHECKPOINT.json';assert not path.exists();path.write_text(canonical(report)+'\n')
print(canonical(report))
