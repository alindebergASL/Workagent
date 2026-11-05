"""Review-only probes. Creates one quarantined disposable restore; no provider I/O.
Run from repository root. Never connects to the installed primary database.
"""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal as D
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid

ROOT = Path('/home/ubuntu/workagent-continuation-20261026')
sys.path.insert(0, str(ROOT / 'evaluation'))
import verify_accounting_correction as v

OUT = Path(__file__).resolve().parent
DB = 'workagent_test_correction_review_' + uuid.uuid4().hex[:12]
C = v.CAND['candidates']
AUTH = v.AUTH
q = v.quote
REPORT = {'database': DB, 'source_mutations': 0, 'provider_calls': 0, 'checks': {}}


def raw(sql, db=DB):
    return subprocess.run(['sudo', '-n', '-u', 'postgres', 'psql', '-XqAt',
                           '-v', 'ON_ERROR_STOP=1', '-d', db],
                          input=sql, text=True, capture_output=True, timeout=120)


def pg(sql):
    p = raw(sql)
    if p.returncode:
        raise RuntimeError(p.stderr[-1200:])
    return p.stdout.strip()


def denied(sql, token):
    p = raw(sql)
    assert p.returncode and token in p.stderr, (p.returncode, p.stderr[-500:])


def release(row):
    return v.apply([row])


def issue(ident, amount, target='workagent_test_review_target'):
    return 'SELECT test_budget_correction.issue_exact(' + ','.join([
        q(ident), q(target), q('a' * 64), str(amount)]) + ');'


def mark(key):
    REPORT['checks'][key] = True


def main():
    p = raw('CREATE DATABASE "' + DB + '"; REVOKE CONNECT ON DATABASE "' + DB + '" FROM PUBLIC;', db='postgres')
    assert p.returncode == 0, p.stderr
    dump = v.OUT / 'primary-before.dump'
    with dump.open('rb') as f:
        p = subprocess.run(['sudo', '-n', '-u', 'postgres', 'pg_restore', '--exit-on-error',
                            '--no-owner', '-d', DB], stdin=f, capture_output=True, timeout=180)
    assert p.returncode == 0, p.stderr[-1000:]
    before = v.inventory(DB)
    REPORT.update(backup_sha256=sha256(dump.read_bytes()).hexdigest(),
                  public_tables=len(before), public_rows=sum(x['n'] for x in before))
    mark('fresh_quarantined_restore')
    pg('BEGIN;' + (ROOT / 'evaluation/accounting_correction.sql').read_text() + 'COMMIT;')
    bad = dict(C[1], result_hash='0' * 32)
    denied('BEGIN;' + release(C[0]) + release(bad) + 'COMMIT;', 'exact_terminal_receipt_required')
    assert pg('SELECT count(*) FROM test_budget_correction.releases;') == '0'
    mark('mid_batch_rollback')
    # Different from author's proof: race the first INSERT, not only existing-row replays.
    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(lambda _: pg('BEGIN;' + release(C[0]) + 'COMMIT;'), range(4)))
    assert pg('SELECT count(*) FROM test_budget_correction.releases;') == '1'
    mark('four_concurrent_first_release_inserts')
    pg('BEGIN;' + v.apply() + 'COMMIT;')
    totals = pg('SELECT count(*),sum(reserved_usd),sum(retained_usage_upper_usd),sum(released_usd) FROM test_budget_correction.releases;')
    n, reserved, retained, released = totals.split('|')
    assert (int(n), D(reserved), D(retained), D(released)) == (186, D('38.48712'), D('6.94086'), D('31.54626'))
    REPORT['totals'] = dict(count=int(n), reserved=reserved, retained=retained, released=released,
                           corrected_retained=str(D('99.605960') - D(released)),
                           unallocated=str(D('100') - D('99.605960') + D(released)))
    mark('exact_totals')
    for table in ('releases', 'certificates'):
        for action in ('DELETE FROM', 'TRUNCATE'):
            denied(action + ' test_budget_correction.' + table + ';', 'immutable_test_accounting_history')
    mark('delete_and_truncate_both_histories')
    role = 'workagent_test_47b87fe3b82e_runtime'
    assert pg("SELECT has_database_privilege(" + q(role) + ",current_database(),'CONNECT');") == 'f'
    for sql in (release(C[0]), issue('runtime', 1), 'SELECT * FROM test_budget_correction.releases;',
                "INSERT INTO test_budget_correction.certificates VALUES ('forged','x','" + 'a'*64 + "',1000,now());"):
        denied('SET ROLE "' + role + '";' + sql, 'permission denied')
    mark('runtime_schema_read_write_execute_and_connect_denied')
    for amount in (0, -1, "'NaN'::numeric", "'Infinity'::numeric", "'-Infinity'::numeric"):
        denied(issue('invalid', amount), 'invalid_fixed_target')
    denied('BEGIN ISOLATION LEVEL REPEATABLE READ;' + issue('rr', 1), 'read_committed_required')
    denied('BEGIN ISOLATION LEVEL SERIALIZABLE;' + release(C[0]), 'read_committed_required')
    mark('nonfinite_negative_and_non_read_committed_denied')
    def contender(ident):
        p = raw(issue(ident, 20))
        if p.returncode:
            assert 'cumulative_100_exceeded' in p.stderr
            return 'denied'
        return 'accepted'
    with ThreadPoolExecutor(max_workers=2) as ex:
        outcomes = list(ex.map(contender, ['race-a', 'race-b']))
    assert sorted(outcomes) == ['accepted', 'denied']
    assert pg('SELECT count(*),sum(amount_usd) FROM test_budget_correction.certificates;') == '1|20'
    winner = 'race-a' if outcomes[0] == 'accepted' else 'race-b'
    pg(issue(winner, 20))
    denied(issue(winner, 21), 'certificate_replay_mismatch')
    denied(issue(winner, 20, 'workagent_test_other_target'), 'certificate_replay_mismatch')
    mark('certificate_race_cap_and_replay_binding')
    # Demonstrate a real lock-order conflict using only table LOCK statements.
    # Sender's Python path owns advisory before inserting; correction owns table SHARE first.
    sender = "BEGIN; SET LOCAL application_name='accounting_review_sender'; SELECT pg_advisory_xact_lock(721004120); SELECT pg_sleep(2); LOCK TABLE public.responses_events IN ROW EXCLUSIVE MODE; COMMIT;"
    correction = 'BEGIN; SET LOCAL deadlock_timeout=\'100ms\'; LOCK TABLE public.responses_events,public.responses_steps,public.provider_grants IN SHARE MODE;' + release(C[0]) + 'COMMIT;'
    with ThreadPoolExecutor(max_workers=2) as ex:
        fs = ex.submit(raw, sender)
        for _ in range(50):
            if pg("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='accounting_review_sender' AND wait_event='PgSleep';") == '1':
                break
            time.sleep(.05)
        else:
            raise AssertionError('sender did not reach controlled pause')
        fc = ex.submit(raw, correction)
        ps, pc = fs.result(), fc.result()
    assert sum(p.returncode != 0 for p in (ps, pc)) == 1
    assert any('deadlock detected' in p.stderr for p in (ps, pc))
    REPORT['findings'] = {'table_then_advisory_deadlock_reproduced': True,
                          'deadlock_victim': 'sender' if ps.returncode else 'correction'}
    assert pg('SELECT count(*),sum(reserved_usd),sum(retained_usage_upper_usd),sum(released_usd) FROM test_budget_correction.releases;') == totals
    assert before == v.inventory(DB)
    mark('all_original_public_rows_unchanged')
    # All-source readback is exact; write no raw contents/receipts to public evidence.
    REPORT['source_sha256'] = {p: sha256((ROOT/p).read_bytes()).hexdigest() for p in [
        'evaluation/accounting_correction.sql', 'evaluation/test_accounting_correction.py',
        'evaluation/verify_accounting_correction.py', 'docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md']}
    assert pg('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();') == '0'
    mark('no_remaining_disposable_sessions')
    REPORT['check_count'] = len(REPORT['checks'])
    (OUT/'independent-results.json').write_text(json.dumps(REPORT, indent=2)+'\n')
    print(json.dumps(REPORT, indent=2))


if __name__ == '__main__':
    print('review_disposable=' + DB, flush=True)
    main()
