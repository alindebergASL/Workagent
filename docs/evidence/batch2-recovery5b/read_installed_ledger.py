"""Read-only installed-authority accounting; never reads or logs receipt bodies."""
from pathlib import Path
import sys, json, hashlib
from datetime import datetime, timezone
from decimal import Decimal
import psycopg
from psycopg.rows import dict_row
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'backend'))
from workagent.responses_ledger import summary
proc=Path('/proc/875172')
assert (proc/'cwd').resolve()==Path('/home/ubuntu/workagent-candidates/general-review-20261023/backend')
env=dict(x.split(b'=',1) for x in (proc/'environ').read_bytes().split(b'\0') if b'=' in x)
with psycopg.connect(env[b'DATABASE_URL'].decode(),row_factory=dict_row) as c:
 c.execute('SET TRANSACTION READ ONLY')
 grants=c.execute("SELECT id,active,data FROM provider_grants WHERE data->'responses'->>'transport_mode'='official_api'").fetchall()
 grouped={}
 for g in grants:
  b=g['data']['responses'];k=b['project_id'];row=grouped.setdefault(k,{'grants':[]})
  row['grants'].append({'active':g['active'],'model_id':g['data'].get('model_id'),'expires_at':g['data'].get('expires_at'),'cost_limit_usd':b['cost_limit_usd'],'synthetic_only':b['synthetic_data_only']})
  if 'summary' not in row:row['summary']=summary(c,g['id'],shared=True)
 for k,row in grouped.items():
  row['allocated_grant_caps_usd']=str(sum((Decimal(str(x['cost_limit_usd'])) for x in row['grants']),Decimal(0)))
  row['grant_count']=len(row['grants'])
  row['active_count']=sum(x['active'] for x in row['grants'])
  row['source_database_fingerprint']=hashlib.sha256(env[b'DATABASE_URL']).hexdigest()
 proof={'at':datetime.now(timezone.utc).isoformat(),'installed_api_pid':875172,'read_only_transaction':True,'projects':grouped,'authority_ceiling_usd':'100','product_provider_calls_this_card':0,'billing_queried':False,'warning':'Installed ledger read only. Caps are allocations, reservations are liabilities, reported usage is not billing. This does not enumerate other databases or authorize fresh grants. No paid trial started.'}
path=ROOT/'docs/evidence/batch2-recovery5b/installed-ledger-readonly.json'
with path.open('x') as f:json.dump(proof,f,indent=2,default=str)
for k,v in grouped.items():print(k, {x:v[x] for x in ['grant_count','active_count','allocated_grant_caps_usd','summary']})
