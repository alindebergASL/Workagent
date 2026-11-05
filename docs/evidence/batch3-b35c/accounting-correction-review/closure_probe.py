"""R1/R2 closure: installed reads, rollback-only disposable lock probes."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal as D
from hashlib import sha256
from pathlib import Path
import json
import subprocess
import sys
import time

ROOT = Path('/home/ubuntu/workagent-continuation-20261026')
sys.path.insert(0, str(ROOT / 'evaluation'))
from test_accounting_correction import pg, PRIMARY, OUT
from verify_accounting_correction import apply, inventory
import install_accounting_correction as installer

FILES = list(installer.PINS) + [
    'evaluation/install_accounting_correction.py',
    'docs/evidence/batch3-b35c/accounting-correction/RUNBOOK.md',
    '.local/batch3/b35c/accounting-correction/primary-readonly-01.private.json',
    '.local/batch3/b35c/accounting-correction/restored-before-inventory-02.json',
    'docs/evidence/batch3-b35c/accounting-correction-review/closure_probe.py',
]
def hashes():
    return {p: sha256((ROOT / p).read_bytes()).hexdigest() for p in FILES}


def main():
    start_hashes = hashes()
    proof = json.loads((OUT / 'disposable-verification-02.json').read_text())
    db = proof['disposable_database']
    assert db == 'workagent_test_correction_3a60e0f9ff55'
    assert pg(db, 'SELECT current_database();').strip() == db
    checks = installer.preflight()
    primary_before = inventory(PRIMARY)
    clone_before = inventory(db)
    expected_inventory = json.loads((OUT / 'restored-before-inventory-02.json').read_text())
    assert primary_before == clone_before == expected_inventory
    cand = json.loads((OUT / 'candidate-01.json').read_text())
    snap_bytes = (OUT / 'primary-readonly-01.private.json').read_bytes()
    assert cand['snapshot_sha256'] == sha256(snap_bytes).hexdigest()
    snap = json.loads(snap_bytes)
    results = {r['id']: r for r in snap['events'] if r['kind'] == 'result'}
    actual_rows = json.loads(pg(db, "BEGIN READ ONLY; SELECT json_agg(to_jsonb(r)-'created_at' ORDER BY dispatch_id) FROM test_budget_correction.releases r; ROLLBACK;"))
    assert len(actual_rows) == len(cand['candidates']) == 186
    for actual, expected in zip(actual_rows, cand['candidates']):
        for field in ('dispatch_id', 'result_id', 'grant_id', 'dispatch_hash', 'result_hash'):
            assert actual[field] == expected[field]
        assert actual['response_id'] == results[expected['result_id']]['data']['response_id']
        assert actual['authority_sha256'] == installer.PINS['docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md']
        for field, expected_field in [('reserved_usd', 'reserved_usd'), ('released_usd', 'release_usd'), ('retained_usage_upper_usd', 'retained_usage_upper_usd')]:
            assert D(str(actual[field])) == D(expected[expected_field])
    reserved = sum((D(r['reserved_usd']) for r in cand['candidates']), D(0))
    retained = sum((D(r['retained_usage_upper_usd']) for r in cand['candidates']), D(0))
    released = sum((D(r['release_usd']) for r in cand['candidates']), D(0))
    assert reserved == retained + released == D('38.48712')
    assert retained == D('6.9408600') and released == D('31.5462600')
    certificate_before = pg(db, 'BEGIN READ ONLY; SELECT to_jsonb(c)::text FROM test_budget_correction.certificates c ORDER BY id; ROLLBACK;')
    orders = []
    for order in ('advisory_first', 'table_first'):
        first_lock = 'SELECT pg_advisory_xact_lock(721004120);'
        second_lock = 'LOCK TABLE public.responses_events IN ROW EXCLUSIVE MODE;'
        if order == 'table_first':
            first_lock, second_lock = second_lock, first_lock
        sender = "BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'; SET LOCAL application_name='accounting_closure_probe';" + first_lock + 'SELECT pg_sleep(1);' + second_lock + 'ROLLBACK;'
        correction = "BEGIN READ ONLY; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'; SELECT pg_advisory_xact_lock(721004120);" + apply() + 'ROLLBACK;'
        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(pg, db, sender)
            for _ in range(80):
                paused = pg(db, "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='accounting_closure_probe' AND wait_event='PgSleep';").strip()
                if paused == '1':
                    break
                time.sleep(.025)
            else:
                raise AssertionError('sender_pause_missing')
            b = pool.submit(pg, db, correction)
            a.result()
            b.result()
        orders.append(order)
    assert inventory(PRIMARY) == primary_before
    assert inventory(db) == clone_before
    assert certificate_before == pg(db, 'BEGIN READ ONLY; SELECT to_jsonb(c)::text FROM test_budget_correction.certificates c ORDER BY id; ROLLBACK;')
    assert pg(PRIMARY, "BEGIN READ ONLY; SELECT to_regnamespace('test_budget_correction') IS NULL; ROLLBACK;").strip() == 't'
    assert start_hashes == hashes(), 'reviewed_bytes_changed_during_probe'
    report = dict(
        head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        checked_at=pg(PRIMARY, 'SELECT clock_timestamp();').strip(),
        preflight=checks, installed_schema_absent=True,
        source_snapshot_binding_matches=True, exact_disposable_release_rows_including_response_id=True,
        original_tables=len(primary_before), original_rows=sum(r['n'] for r in primary_before),
        original_inventories_match_backup_and_remain_unchanged=True,
        rollback_only_sender_orders_completed=orders,
        disposable_certificate_journal_unchanged=True,
        reserved_usd=str(reserved), retained_usage_upper_usd=str(retained),
        released_usd=str(released), retained_existing_allocation_usd=str(D('99.605960')-released),
        unallocated_ceiling_usd=str(D('100')-D('99.605960')+released),
        installed_mutations=0, provider_calls=0, hashes=start_hashes,
    )
    target = ROOT / 'docs/evidence/batch3-b35c/accounting-correction-review/closure-results.json'
    with target.open('x') as f:
        f.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
