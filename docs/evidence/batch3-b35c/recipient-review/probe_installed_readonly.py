"""Read only exact prepared recipients; no issuer query or credential output."""
from pathlib import Path
import sys,json
from decimal import Decimal
ROOT=Path(__file__).resolve().parents[4]
sys.path[:0]=[str(ROOT/'evaluation'),str(ROOT/'backend')]
import install_recipient_funding as I
plans,bindings=I.mapping()
rows=[]
for key,p in sorted(plans.items()):
    I.identity(p,bindings[key])
    r=json.loads(I.pg(p['database'],"""BEGIN READ ONLY;
      SELECT jsonb_build_object('database',current_database(),
      'oid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()),
      'grant_count',(SELECT count(*) FROM provider_grants),
      'active_grant_count',(SELECT count(*) FROM provider_grants WHERE active),
      'workspace_count',(SELECT count(DISTINCT workspace_id) FROM provider_grants),
      'raw_cost_limits',(SELECT jsonb_agg(data->'responses'->>'cost_limit_usd' ORDER BY id) FROM provider_grants),
      'modes',(SELECT jsonb_agg(data->'responses'->>'transport_mode' ORDER BY id) FROM provider_grants),
      'events',(SELECT count(*) FROM responses_events),
      'deny_all_trigger',(SELECT tgenabled FROM pg_trigger WHERE tgrelid='responses_events'::regclass AND tgname='a_study_unfunded_denial'),
      'recipient_schema_absent',to_regnamespace('study_funding') IS NULL); ROLLBACK;"""))
    assert r['grant_count']==r['active_grant_count']==r['workspace_count']==2
    assert all(Decimal(x)==12 for x in r['raw_cost_limits'])
    assert r['modes']==['official_api','official_api']
    assert r['events']==0 and r['deny_all_trigger']=='O' and r['recipient_schema_absent']
    r['blind_id']=key
    rows.append(r)
assert len(rows)==12 and len({r['oid'] for r in rows})==12
result=dict(status='PASS',scope='exact12 identity and unfunded-state read-only; no issuer inspection',rows=rows,
            verified_databases=len(rows),verified_grants=sum(r['grant_count'] for r in rows),provider_calls=0,
            issuer_certificates_not_queried=True)
with Path(__file__).with_name('installed-readonly.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({k:v for k,v in result.items() if k!='rows'},sort_keys=True))
