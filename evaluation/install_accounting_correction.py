"""Bounded one-off install/readback. No issuance, credentials or provider I/O.
Run --check before review; --apply only after the focused review is complete.
All immutable expected values below identify this particular authorized correction.
"""
import argparse
from datetime import datetime, timezone
from decimal import Decimal as D
from hashlib import sha256
import json
import re
from test_accounting_correction import ROOT, OUT, PRIMARY, pg
from verify_accounting_correction import apply, inventory, CAND

PINS={
 'evaluation/test_accounting_correction.py':'03c84a36abd3e3fe48f7146d7acb519141ce0239929e4ebfe11c778d036da12c',
 'evaluation/verify_accounting_correction.py':'51bb63809595530aafd0382fd3850bd0ca6dca593c3d3b9ab8b97eb3994e0b98',
 'evaluation/accounting_correction.sql':'d141fe3c1dc863a28a9852314f4d676dd9ba01a143734988d391e1b66d968f6e',
 'docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md':'73d61b550c50d04caa83077ba0883536b2012ca9eabd430de5f05c2212496965',
 '.local/batch3/b35c/accounting-correction/candidate-01.json':'91c3c7d9e2542a7a55bbfd75c1675e556318c5957e279078aeac14ca6700ad37',
 '.local/batch3/b35c/accounting-correction/primary-before.dump':'c72935850cfef1729ea6a0461030435c203c5f6205abfe370549eb187ee9e60e',
 '.local/batch3/b35c/accounting-correction/disposable-verification-02.json':'68d5933583faeb23beeed125b8461b00423213547372c22a81a9405e8ce6504a',
 '.local/batch3/b35c/execution/ledger/current-reconciliation.json':'53306d858e4c04d3eaa64e923a7a72950d44cf681eaab5061025d64d63af4673',
}

def readback():
    actual=json.loads(pg(PRIMARY,"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SELECT jsonb_build_object(
      'release_rows',(SELECT jsonb_agg(to_jsonb(r)-'created_at' ORDER BY dispatch_id) FROM test_budget_correction.releases r),
      'certificates',(SELECT coalesce(jsonb_agg(to_jsonb(c)-'created_at' ORDER BY id),'[]') FROM test_budget_correction.certificates c),
      'functions',(SELECT jsonb_object_agg(p.proname,p.prosrc) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='test_budget_correction'),
      'runtime_schema_access',has_schema_privilege('workagent_test_47b87fe3b82e_runtime','test_budget_correction','USAGE'),
      'schema_owner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='test_budget_correction')
    ); ROLLBACK;"""))
    rows=actual['release_rows']; assert len(rows)==186
    expected={r['dispatch_id']:r for r in CAND['candidates']}
    for r in rows:
        e=expected[r['dispatch_id']]
        assert all(r[k]==e[k] for k in ('dispatch_id','result_id','grant_id','dispatch_hash','result_hash'))
        assert D(str(r['reserved_usd']))==D(e['reserved_usd'])
        assert D(str(r['retained_usage_upper_usd']))==D(e['retained_usage_upper_usd'])
        assert D(str(r['released_usd']))==D(e['release_usd'])
        assert r['authority_sha256']==PINS['docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md']
    assert not actual['runtime_schema_access'] and actual['schema_owner']=='postgres'
    # Verify exact stored function bodies, not merely successful CREATE response.
    sql=(ROOT/'evaluation/accounting_correction.sql').read_text()
    for name,body in actual['functions'].items():
        pattern=r'CREATE OR REPLACE FUNCTION test_budget_correction\.'+re.escape(name)+r'\([\s\S]*?AS \$\$([\s\S]*?)\$\$;'
        match=re.search(pattern,sql)
        assert match is not None,(name,'missing_expected_function')
        assert body==match.group(1),(name,'stored_function_drift')
    assert set(actual['functions'])=={'immutable','release_exact','issue_exact'}
    released=sum((D(str(r['released_usd'])) for r in rows),D(0))
    issued=sum((D(str(r['amount_usd'])) for r in actual['certificates']),D(0))
    assert released==D('31.5462600') and D('99.605960')-released+issued<=100
    return actual,dict(released_unused_usd=str(released),retained_existing_allocation_usd=str(D('99.605960')-released),
      issued_certificate_usd=str(issued),unallocated_ceiling_usd=str(D(100)-D('99.605960')+released-issued),
      known_usage_upper_for_released_rows_usd='6.9408600',billed_usd=None)

def preflight():
    for p,expected in PINS.items():
        assert sha256((ROOT/p).read_bytes()).hexdigest()==expected,(p,'hash_drift')
    identity=pg(PRIMARY,"SELECT current_database(),oid FROM pg_database WHERE datname=current_database();").strip()
    assert identity==PRIMARY+'|7704275','not_canonical_primary'
    snap=json.loads((OUT/'primary-readonly-01.private.json').read_text())
    grants=json.loads(pg(PRIMARY,"BEGIN READ ONLY; SELECT json_agg(json_build_array(id,active,md5(data::text)) ORDER BY id) FROM provider_grants WHERE data->'responses'->>'transport_mode'='official_api'; ROLLBACK;"))
    assert grants==[[g['id'],g['active'],g['hash']] for g in snap['grants']],'primary_grant_change'
    frozen=json.loads((ROOT/'.local/batch3/b35c/execution/ledger/current-reconciliation.json').read_text())
    # Refresh ONLY the three recent competing pools; older allowances remain fully
    # encumbered, with no attempt to collect/credit their usage or unused reserves.
    checks=[]
    for s in frozen['stores'][1:4]:
        db=s['identity']['database']
        grants=json.loads(pg(db,"BEGIN READ ONLY; SELECT coalesce(json_agg(json_build_array(id,active,md5(data::text)) ORDER BY id),'[]') FROM provider_grants WHERE data->'responses'->>'transport_mode'='official_api'; ROLLBACK;"))
        assert grants==[[g['id'],g['active'],g['immutable_data_hash']] for g in s['grants']],(db,'competing_grant_change')
        if s.get('campaign'):
            actual=json.loads(pg(db,"BEGIN READ ONLY; SELECT json_agg(json_build_array(id,prior_allocation::text,allocation::text,linkage_sha256,clock_timestamp()>=deadline OR clock_timestamp()>=expires_at) ORDER BY id) FROM evaluation_campaign; ROLLBACK;"))
            expected=[[r['id'],r['prior_allocation'],r['allocation'],r['linkage_sha256'],True] for r in s['campaign']]
            assert actual==expected,(db,'competing_allocation_change')
        checks.append(db)
    return dict(canonical_identity=identity,competing_grants_and_allocations_unchanged=checks,baseline_usd='99.605960',
        baseline_scope='Known Workagent test-authority lineage; historical other allowances fully retained. Parent notified sole-lane issuance. Not provider-account invoice reconciliation.')

def main():
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--check',action='store_true');a=p.parse_args()
    assert a.apply!=a.check,'choose exactly --check or --apply'
    checks=preflight()
    before=inventory(PRIMARY)
    restored=json.loads((OUT/'restored-before-inventory-02.json').read_text())
    assert before==restored,'original_store_changed_since_backup; retain and investigate, no automatic overwrite'
    exists=pg(PRIMARY,"SELECT to_regnamespace('test_budget_correction') IS NOT NULL;").strip()=='t'
    if a.apply:
        # Bound wait; no conflicting table lock. Failed transaction/ACK is resolved
        # by exact readback/replay, NEVER by restoring pre-issuance history.
        if exists:
            actual,amounts=readback()
        else:
            sql="BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='45s'; SELECT pg_advisory_xact_lock(721004120);\n"
            sql+=(ROOT/'evaluation/accounting_correction.sql').read_text()+'\n'+apply()+'\nCOMMIT;'
            pg(PRIMARY,sql)
            actual,amounts=readback()
        after=inventory(PRIMARY)
        assert before==after,'original_rows_changed; inspect legitimate concurrent appends before asserting preservation'
        stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        report=dict(at=stamp,preflight=checks,pins=PINS,amounts=amounts,original_tables=len(before),original_rows=sum(x['n'] for x in before),
          original_public_rows_unchanged=True,provider_calls=0,certificates=actual['certificates'],runtime_schema_access=False,
          live_release=None,paid_admission='not_yet_bound_to_recipient',source_sql_sha256=PINS['evaluation/accounting_correction.sql'])
        with (OUT/('installed-readback-'+stamp+'.json')).open('x') as f: f.write(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    else:
        print(json.dumps(dict(preflight=checks,installed_correction_exists=exists,original_inventory_matches_backup=True,installed_mutations=0,provider_calls=0),indent=2))

if __name__=='__main__':main()
