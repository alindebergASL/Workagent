"""Real 040 -> 041 upgrade, with historical evidence retained before migration."""
import json
import os
from pathlib import Path
import shutil
from unittest.mock import patch
from decimal import Decimal
import psycopg
import pytest
from dev_db import provision
from test_domain import context as context_fixture
from test_alpha_budget import prepared, raw, reserve
from test_input_ceiling import retain_count, NEW_DISPATCH
from workagent.db import Database, migrate
from workagent.responses_ledger import summary
from workagent.responses_transport import TransportError
from workagent.general_responses import known_input_rejection_is_settled, has_unresolved_attempt


def snapshot(db):
    tables = ('provider_grants', 'provider_attempts', 'responses_steps', 'responses_events',
              'run_configurations', 'run_contexts', 'runs', 'conversation_messages', 'responses_budget_carry')
    with db.transaction() as c:
        return {table: sorted(json.dumps(r['row'], sort_keys=True, default=str) for r in
            c.execute(f'SELECT row_to_json(t) AS row FROM {table} t').fetchall()) for table in tables}


def test_upgrade_preserves_historical_receipts_and_unknown_liabilities(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    prefix = tmp_path / 'prefix'
    (prefix / 'workagent').mkdir(parents=True)
    (prefix / 'migrations').mkdir()
    for path in sorted((root / 'migrations').glob('*.sql')):
        if path.name < '041':
            shutil.copyfile(path, prefix / 'migrations' / path.name)
    env = tmp_path / 'upgrade.env'
    # Explicit owner migration of the exact historical prefix, not just seed().
    with patch('workagent.db.__file__', str(prefix / 'workagent' / 'db.py')):
        provision(env)
    values = dict(line.removeprefix('export ').split('=', 1) for line in env.read_text().splitlines())
    assert '/workagent_test_' in values['DATABASE_URL']
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    owner = values['MIGRATION_DATABASE_URL']
    db = Database(values['DATABASE_URL'])
    db.check_runtime_role()
    historical = []
    for index, mode in enumerate((20039, 22428, 'unknown_count', 'unknown_dispatch', 'late_problem', 'late_count')):
        ctx = context_fixture.__wrapped__()
        g, fake, x = prepared(ctx, tmp_path / str(index))
        raw(x, 'count_send', {})  # legitimate pre-041 material, restricted role
        if isinstance(mode, int):
            raw(x, 'problem', {'operation': 'count', 'code': 'input_count_exceeds_limit',
                              'received': True, 'input_tokens': mode, 'limit': 20000})
        elif mode == 'unknown_dispatch':
            retain_count(x, fake, 700)
            raw(x, 'dispatch', dict(reserved_input_tokens=20000, reserved_output_tokens=8192,
                                   reserved_cost_usd='0.131920', billed_cost_usd=None))
        historical.append((mode, ctx, g, fake, x))
    before = snapshot(db)
    migrate(owner)
    migrate(owner)  # idempotent replay; journal checksums remain exact
    assert snapshot(db) == before
    db.check_runtime_role()
    with db.transaction() as c:
        row = c.execute("SELECT checksum FROM schema_migrations WHERE name='041_input_ceiling.sql'").fetchone()
        from hashlib import sha256
        assert row['checksum'] == sha256((root / 'migrations' / '041_input_ceiling.sql').read_bytes()).hexdigest()
        for mode, ctx, g, fake, x in historical:
            aid = x['ledger'].receipt.attempt_id
            settled = isinstance(mode, int)
            assert known_input_rejection_is_settled(c, aid) is settled
            cv = c.execute('SELECT conversation_id FROM runs WHERE id=%s', (x['cap'].run_id,)).fetchone()['conversation_id']
            assert has_unresolved_attempt(c, ctx[2], cv) is True
            assert has_unresolved_attempt(c, ctx[2], cv, allow_known_input_rejection=True) is not settled
            totals = summary(c, g.id)
            assert totals['reserved_input_tokens'] == (20000 if mode == 'unknown_dispatch' else 0)
            assert totals['unknown_usage_steps'] == int(mode == 'unknown_dispatch')
    # No retry/receipt rewrite: exact duplicate retention of an old rejection is idempotent.
    mode, ctx, g, fake, x = historical[0]
    x['ledger'].count_problem(x['request'], TransportError('input_count_exceeds_limit', input_tokens=mode))
    assert snapshot(db) == before
    # A delayed old count observation must retain the OLD 20k policy after upgrade.
    _, ctx, g, fake, x = historical[-2]
    x['ledger'].count_problem(x['request'], TransportError('input_count_exceeds_limit', input_tokens=22428))
    with db.transaction() as c:
        assert x['ledger']._events(c, 'selection')['problem']['limit'] == 20000
        assert known_input_rejection_is_settled(c, x['ledger'].receipt.attempt_id)
    _, ctx, g, fake, x = historical[-1]
    with pytest.raises(psycopg.Error, match='invalid exact count material'):
        retain_count(x, fake, 22428)
    retain_count(x, fake, 20000)
    # A NEW dispatch on a previously counted request still reserves today's full ceiling.
    reserve(x, 'dispatch')
    with db.transaction() as c:
        dispatch = x['ledger']._events(c, 'selection')['dispatch']
        assert dispatch | {'reserved_cost_usd': '0.206920'} == NEW_DISPATCH
        assert Decimal(dispatch['reserved_cost_usd']) == Decimal('0.206920')
    # Old unknown generation remains reserved alongside new sends sharing its project.
    _, ctx, old_grant, fake, old = historical[3]
    g, fake, x = prepared(context_fixture.__wrapped__(), tmp_path / 'mixed',
                          project=old_grant.responses.project_id)
    reserve(x, 'count_send')
    retain_count(x, fake, 50000)
    reserve(x, 'dispatch')
    with db.transaction() as c:
        totals = summary(c, g.id, shared=True)
        assert totals['reserved_input_tokens'] == 70000
        assert Decimal(totals['reserved_cost_usd']) == Decimal('0.338840')
        assert totals['unknown_usage_steps'] == 2
        assert not known_input_rejection_is_settled(c, old['ledger'].receipt.attempt_id)
        assert not c.execute("SELECT has_table_privilege(current_user,'responses_events','UPDATE') AS allowed").fetchone()['allowed']
    # No legacy grants or historical requests were altered by new activity.
    after = snapshot(db)
    for table in ('provider_grants', 'responses_steps', 'responses_events', 'run_configurations', 'run_contexts'):
        assert set(before[table]).issubset(after[table])
    # Exercise the actual human admission path, not just its proof predicate.
    from test_conversations import post
    from test_domain import raises
    for mode, ctx, g, fake, x in historical[:4]:
        s, p, ws, _, _ = ctx
        with db.transaction() as c:
            cv_id = c.execute('SELECT conversation_id FROM runs WHERE id=%s', (x['cap'].run_id,)).fetchone()['conversation_id']
        cv = s.get_conversation(p, ws, cv_id).conversation
        journal_before = snapshot(db)
        if isinstance(mode, int):
            queued = post(ctx, cv, 'Explicit new human steering after the historical rejection.')
            assert queued.run.id != x['cap'].run_id
        else:
            raises('action_unresolved', lambda: post(ctx, cv, 'Do not replay the old unknown send.'))
        journal_after = snapshot(db)
        for table in ('provider_attempts', 'responses_steps', 'responses_events'):
            assert journal_after[table] == journal_before[table]
