"""Read-only budget report; no source adoption, certificate or provider effects."""
import json,sys
from pathlib import Path
from decimal import Decimal
from datetime import datetime,timezone
from hashlib import sha256
ROOT=Path.cwd();sys.path.insert(0,str(ROOT/'evaluation'))
from test_accounting_correction import pg,PRIMARY
OUT=Path(__file__).resolve().parent
old_path=ROOT/'.local/batch3/b35c/retained-read-recovery/option1-parent/PREFLIGHT-20261101T014236Z.json'
old=json.loads(old_path.read_text())
plans_path=ROOT/'.local/batch3/b35c/live-study/recipient-plans-file-target.json'
plans=json.loads(plans_path.read_text())['plans']
issuer=json.loads(pg(PRIMARY,"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s';
SELECT jsonb_build_object('at',clock_timestamp(),'oid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()),'released',(SELECT sum(released_usd)::text FROM test_budget_correction.releases),'certificates',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM test_budget_correction.certificates c)); ROLLBACK;"""))
assert issuer['oid']==7704275
assert issuer['released']==old['issuer']['released']
assert issuer['certificates']==old['issuer']['certificates']
bydb={p['database']:p for p in plans}
dbs=sorted(set(bydb)|{c['target_database'] for c in issuer['certificates']})
rows=[]
for db in dbs:
 sql="""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s'; SELECT jsonb_build_object(
 'database',current_database(),'oid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()),
 'grants',(SELECT jsonb_agg(jsonb_build_object('id',id,'hash',md5(data::text),'active',active) ORDER BY id) FROM provider_grants),
 'events',(SELECT count(*) FROM responses_events),
 'migrations',(SELECT count(*) FROM schema_migrations),
 'active_leases',(SELECT count(*) FROM runs WHERE (data->>'lease_expires_at')::timestamptz>clock_timestamp()),
 'funding_present',to_regnamespace('study_funding') IS NOT NULL); ROLLBACK;"""
 row=json.loads(pg(db,sql));assert row['active_leases']==0
 if db in bydb:
  plan=bydb[db];assert row['oid']==plan['database_oid']
  assert {g['id']:g['hash'] for g in row['grants']}=={g['id']:g['hash'] for g in plan['grant_hashes']}
  assert all(g['active'] for g in row['grants'])
  previous=next(r for r in old['recipients'] if r['trial']==plan['blind_id'])
  assert row['events']==previous['events']
  row['original_identity_and_event_count_unchanged']=True
 if row['funding_present']:
  funding=json.loads(pg(db,"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s'; SELECT jsonb_build_object('certificates',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM study_funding.certificates c),'retained',(SELECT coalesce(sum(study_funding.retained_cost(e)),0)::text FROM responses_events e WHERE kind='dispatch')); ROLLBACK;"""))
  for c in funding['certificates'] or []:
   issued=next(x for x in issuer['certificates'] if x['id']==c['id'])
   assert all(str(issued[k])==str(c[k]) for k in ['id','target_database','target_binding_sha256','amount_usd'])
  row['funding']=funding
 rows.append(row)
retained=Decimal('99.605960')-Decimal(issuer['released'])
issued=sum((Decimal(str(c['amount_usd'])) for c in issuer['certificates']),Decimal(0))
encumbered=retained+issued
reserve=(Decimal(50000)*Decimal('2.5')+Decimal(8192)*Decimal(10))/Decimal(1000000)
# Proposed no-credit upper planning envelope, NOT installed authority or tariff claim.
generations=9;reads_per_generation=16;contingency=Decimal('.001')
per_episode=generations*reserve+generations*(1+reads_per_generation)*contingency
scope={}
for name,episodes in [('fresh_AB_current_B1_M1_one_variation_each',24),('fresh_original_sized_AB_all_arms_two_variations',72)]:
 envelope=episodes*per_episode
 scope[name]={'episodes':episodes,'generations_max':episodes*generations,'counts_max':episodes*generations,'reads_max':episodes*generations*reads_per_generation,'reserve_usd':str(envelope),'cumulative_ceiling_usd':str(encumbered+envelope),'increase_over_100_usd':str(encumbered+envelope-100)}
report={'at':datetime.now(timezone.utc).isoformat(),'evidence':'READ_ONLY_NOT_BILLING_NOT_EXECUTION_AUTHORITY','previous_sha256':sha256(old_path.read_bytes()).hexdigest(),'plans_sha256':sha256(plans_path.read_bytes()).hexdigest(),'issuer':issuer,'recipients':rows,'retained_historical_usd':str(retained),'issued_usd':str(issued),'encumbered_usd':str(encumbered),'unallocated_usd':str(Decimal(100)-encumbered),'billing':None,'unknown_liabilities_released':False,'original_recipients':len(bydb),'total_recipient_stores':len(rows),'new_allocations_usd':'0','provider_calls':0,'generation_reserve_usd':str(reserve),'per_episode_upper_usd':str(per_episode),'planning_assumptions':{'max_tool_selections':8,'final_generation':1,'input_tokens':50000,'output_tokens':8192,'reads_per_generation':reads_per_generation,'count_or_read_contingency_usd':str(contingency),'contingency_is_provider_tariff':False,'assumes_no_usage_credit':True,'paid_search_judge_children':False,'not_new_installed_caps':True},'proposed_scopes':scope}
p=OUT/'BUDGET_READBACK.json'
with p.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['issuer','recipients']},indent=2))
