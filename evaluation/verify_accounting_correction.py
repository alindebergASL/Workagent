"""Disposable restored-copy correction tests; never issues provider requests."""
import concurrent.futures
from decimal import Decimal as D
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
import uuid
from test_accounting_correction import ROOT, OUT, pg, canonical

DB='workagent_test_correction_'+uuid.uuid4().hex[:12]
AUTH=sha256((ROOT/'docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md').read_bytes()).hexdigest()
CAND=json.loads((OUT/'candidate-01.json').read_text())

def quote(s):
    return "'"+str(s).replace("'","''")+"'"

def apply(rows=None):
    return '\n'.join('SELECT test_budget_correction.release_exact('+','.join(map(quote,
      [r['dispatch_id'],r['result_id'],r['dispatch_hash'],r['result_hash'],AUTH]))+');'
      for r in (CAND['candidates'] if rows is None else rows))

def inventory(db):
    tables=json.loads(pg(db,"BEGIN READ ONLY; SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'; ROLLBACK;"))
    sql='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'+ '\n'.join(
     'SELECT json_build_object(\'table\','+quote(t)+",'n',count(*),'hash',md5(string_agg(h,'' ORDER BY h))) FROM (SELECT md5(row_to_json(x)::text) h FROM public.\""+t+'\" x) q;' for t in tables)+'\nROLLBACK;'
    return [json.loads(x) for x in pg(db,sql).splitlines() if x]

def assert_fail(sql, token=None):
    try:
        pg(DB,sql)
    except RuntimeError as e:
        if token:
            assert token in str(e),str(e)
        return True
    raise AssertionError('unexpected SQL acceptance')

def main():
    OUT.mkdir(exist_ok=True)
    # CREATE DATABASE is intentionally outside any transaction; disposable only.
    pg('workagent_test_47b87fe3b82e', 'CREATE DATABASE "'+DB+'"; REVOKE CONNECT ON DATABASE "'+DB+'" FROM PUBLIC;')
    dump=OUT/'primary-before.dump'
    with dump.open('rb') as f:
        p=subprocess.run(['sudo','-n','-u','postgres','pg_restore','--exit-on-error','--no-owner','-d',DB],stdin=f,capture_output=True,timeout=180)
    assert p.returncode==0,p.stderr[-2000:]
    before=inventory(DB)
    (OUT/'restored-before-inventory-02.json').write_text(json.dumps(before,indent=2)+'\n')
    source_sql=(ROOT/'evaluation/accounting_correction.sql').read_text()
    pg(DB,'BEGIN;\n'+source_sql+'\nCOMMIT;')
    assert_fail(apply([CAND['candidates'][0]]),'canonical_issuer_required')
    assert_fail("SELECT test_budget_correction.issue_exact('clone','workagent_test_target','"+'a'*64+"',1);",'canonical_issuer_required')
    # Explicit TEST-ONLY name/OID substitution. No restore is a production issuer.
    oid=pg(DB,'SELECT oid FROM pg_database WHERE datname=current_database();').strip()
    test_sql=source_sql.replace("current_database()<>'workagent_test_47b87fe3b82e'", "current_database()<>'"+DB+"'").replace('())<>7704275','())<>'+oid)
    assert test_sql!=source_sql and '())<>7704275' not in test_sql
    pg(DB,'BEGIN;\n'+test_sql+'\nCOMMIT;')
    checks={'unmodified_source_denies_restored_copy_release_and_issue':True}
    # A failed second receipt must roll back the already accepted first receipt.
    bad=dict(CAND['candidates'][1]);bad['result_hash']='0'*32
    assert_fail('BEGIN;'+apply([CAND['candidates'][0],bad])+'COMMIT;', 'exact_terminal_receipt_required')
    assert int(pg(DB,'SELECT count(*) FROM test_budget_correction.releases;'))==0
    checks['mid_batch_failure_rollback']=True
    pg(DB,'BEGIN; SET LOCAL lock_timeout=\'10s\'; SELECT pg_advisory_xact_lock(721004120);'+apply()+'COMMIT;')
    initial=pg(DB,"SELECT count(*),sum(released_usd),sum(retained_usage_upper_usd) FROM test_budget_correction.releases;")
    n,released,retained=initial.strip().split('|')
    assert int(n)==CAND['candidate_count'] and D(released)==D(CAND['release_usd']) and D(retained)==D(CAND['retained_usage_upper_usd'])
    checks['exact_release_recomputed']=True
    pg(DB,'BEGIN;'+apply()+'COMMIT;')
    assert pg(DB,"SELECT count(*),sum(released_usd),sum(retained_usage_upper_usd) FROM test_budget_correction.releases;")==initial
    checks['retry_idempotency']=True
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(lambda _:pg(DB,'BEGIN;'+apply()+'COMMIT;'),range(4)))
    assert pg(DB,"SELECT count(*),sum(released_usd),sum(retained_usage_upper_usd) FROM test_budget_correction.releases;")==initial
    checks['four_concurrent_replays_no_duplicate_release']=True
    # Actual PostgreSQL interleavings for Python advisory-first and SQL
    # table-first senders. Correction never takes a conflicting table lock.
    import time
    for order in ('advisory_first','table_first'):
        locks=("SELECT pg_advisory_xact_lock(721004120); SELECT pg_sleep(1); LOCK TABLE public.responses_events IN ROW EXCLUSIVE MODE;" if order=='advisory_first' else
               "LOCK TABLE public.responses_events IN ROW EXCLUSIVE MODE; SELECT pg_sleep(1); SELECT pg_advisory_xact_lock(721004120);")
        sender="BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL application_name='correction_sender_probe';"+locks+'COMMIT;'
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            first=ex.submit(pg,DB,sender)
            for _ in range(60):
                if pg(DB,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='correction_sender_probe' AND wait_event='PgSleep';").strip()=='1':break
                time.sleep(.025)
            else:raise AssertionError('sender_pause_missing')
            second=ex.submit(pg,DB,"BEGIN; SET LOCAL lock_timeout='5s'; SELECT pg_advisory_xact_lock(721004120);"+apply()+'COMMIT;')
            first.result();second.result()
        checks[order+'_sender_completes_without_deadlock']=True
    assert_fail("UPDATE test_budget_correction.releases SET released_usd=0;",'immutable_test_accounting_history')
    assert_fail("TRUNCATE test_budget_correction.releases;",'immutable_test_accounting_history')
    checks['history_update_delete_truncate_denied']=True
    # Existing restricted runtime has no permission to mint releases/certificates.
    role=pg(DB,"SELECT grantee FROM information_schema.role_table_grants WHERE table_name='responses_events' AND privilege_type='INSERT' AND grantee<>'postgres' LIMIT 1;").strip()
    assert role and role.replace('_','').isalnum()
    assert_fail('SET ROLE "'+role+'";'+apply([CAND['candidates'][0]]),'permission denied')
    checks['runtime_cannot_release']=True
    # Concurrent allocations each fit alone but together exceed the $100 cap.
    issue=lambda ident: "SELECT test_budget_correction.issue_exact("+quote(ident)+",'workagent_test_disposable_target',"+quote('a'*64)+",20);"
    def contender(x):
        try:
            pg(DB,issue(x)); return 'accepted'
        except RuntimeError as e:
            assert 'cumulative_100_exceeded' in str(e);return 'denied'
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        results=list(ex.map(contender,['race-a','race-b']))
    assert sorted(results)==['accepted','denied']
    accepted='race-'+('a' if results[0]=='accepted' else 'b')
    pg(DB,issue(accepted))
    assert int(pg(DB,'SELECT count(*) FROM test_budget_correction.certificates;'))==1
    assert_fail(issue(accepted).replace(',20)',',21)'),'certificate_replay_mismatch')
    assert_fail('BEGIN ISOLATION LEVEL REPEATABLE READ;'+issue('repeatable')+'COMMIT;','read_committed_required')
    checks['concurrent_allocation_cap_and_exact_retry']=True
    checks['non_read_committed_denied']=True
    assert_fail("DELETE FROM test_budget_correction.certificates;",'immutable_test_accounting_history')
    checks['certificate_history_immutable']=True
    after=inventory(DB)
    assert before==after
    checks['all_original_public_tables_unchanged']=True
    report=dict(disposable_database=DB,backup_sha256=sha256(dump.read_bytes()).hexdigest(),backup_bytes=dump.stat().st_size,
      restore_succeeded=True,original_tables=len(before),original_rows=sum(x['n'] for x in before),
      checks=checks,release_count=int(n),release_usd=released,retained_usage_upper_usd=retained,
      source_mutations=0,provider_calls=0,billed_cost=None,
      sql_sha256=sha256((ROOT/'evaluation/accounting_correction.sql').read_bytes()).hexdigest())
    with (OUT/'disposable-verification-02.json').open('x') as f:
        f.write(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    try:main()
    except Exception:
        print('retained_disposable_database='+DB,file=sys.stderr)
        raise
