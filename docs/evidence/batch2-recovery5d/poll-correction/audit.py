"""Read-only provider/state preservation audit for bounded poll correction."""
from pathlib import Path
import sys, os, json, hashlib
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'backend'))
from workagent.db import Database
assert '/workagent_test_' in os.environ['DATABASE_URL']
out=Path(__file__).parent
label=sys.argv[1]
assert label in ('before','after')
prior=json.loads((out.parent/'provider-final.json').read_text())['tables']
def fingerprint(rows):
    return {'count':len(rows),'sha256':hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()}
with Database().transaction() as c:
    c.execute('SET TRANSACTION READ ONLY')
    tables={}
    names=set(prior)|{'memberships','source_access','conversations','run_dispatches'}
    names|={r['tablename'] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE '%grant%' OR tablename LIKE '%ledger%' OR tablename LIKE '%usage%')").fetchall()}
    for name in sorted(names):
        tables[name]=fingerprint(c.execute('SELECT to_jsonb(t) value FROM '+name+' t ORDER BY to_jsonb(t)::text').fetchall())
assert {n:tables[n] for n in prior}==prior, 'Provider state changed since retained evidence'
result={'tables':tables,'provider_matches_prior':True,'database_mutations':0,'new_product_provider_calls':0,'new_product_spend':0}
if label=='after':
    assert tables==json.loads((out/'audit-before.json').read_text())['tables']
    result['all_audited_state_unchanged']=True
with (out/f'audit-{label}.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(label, 'read-only audit PASS; provider/state hashes retained;',len(tables),'tables')
