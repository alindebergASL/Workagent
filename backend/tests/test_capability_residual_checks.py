"""Bounded continuation probes; original inherited red tests remain unchanged."""
from decimal import Decimal

import pytest

from test_domain import context
from test_conversations import conversation, post
from test_general_responses import activate, Provider, worker
from test_ledger_summary_projection import legacy_summary
from test_capability_gateway import setup
from workagent.db import Database
from workagent.service import encoded
from workagent.responses_ledger import summary
from workagent.capabilities import broker


class AggregateOnly:
    """Inspect exactly what the real SQL cursor transfers, not the old row query."""
    def __init__(self, connection):
        self.connection = connection
        self.model_rows = []
        self.other_rows = []

    def execute(self, sql, *args):
        cursor = self.connection.execute(sql, *args)
        rows = cursor.fetchall()
        if 'FROM responses_events e' in sql:
            self.model_rows.extend(rows)
        else:
            self.other_rows.extend(rows)

        class Rows:
            def fetchone(self):
                assert len(rows) == 1
                return rows[0]

            def fetchall(self):
                return rows

        return Rows()


@pytest.mark.parametrize('shared', [False, True])
@pytest.mark.parametrize('lose_id', [False, True])
def test_aggregate_transfer_exact_amounts_and_unknown_liabilities(context, tmp_path, shared, lose_id):
    service, principal, ws, _, _ = context
    cv = conversation(context)
    grant = activate(context, [cv])
    fake = Provider(lose_id=lose_id)
    run = post(context, cv, 'Explain this synthetic tradeoff.')
    worker(context, fake, tmp_path).work(principal, ws, run.run.id)
    with service.db.transaction() as connection:
        spy = AggregateOnly(connection)
        actual = summary(spy, grant.id, shared=shared)
        legacy = legacy_summary(connection, grant.id, shared)
    # Do not alter the inherited exact-string assertion. This additional probe
    # distinguishes representation from monetary equality using exact Decimal.
    cost = 'conservatively_calculated_cost_usd'
    assert {k: v for k, v in actual.items() if k != cost} == {
        k: v for k, v in legacy.items() if k != cost}
    if lose_id:
        assert actual[cost] is None and legacy[cost] is None
        assert actual['unknown_usage_steps'] > 0
    else:
        assert actual[cost] == '0.0075'
        assert legacy[cost] == '0.00750'
        assert Decimal(actual[cost]) == Decimal(legacy[cost])
        assert actual['unknown_usage_steps'] == 0
    assert actual['billed_cost_usd'] is None
    assert actual['request_counts']['dispatch'] > 0
    assert len(spy.model_rows) == 1
    assert set(spy.model_rows[0]) == {
        'count_send', 'dispatch', 'read', 'cancel', 'reserved_input',
        'reserved_output', 'reserved_cost', 'usages', 'reported_input', 'reported_output'}
    assert all(type(value) in (int, Decimal) for row in spy.model_rows + spy.other_rows
               for value in row.values())
    assert len(spy.other_rows) == (1 if shared else 0)  # carry only; no tool entries


@pytest.mark.parametrize('change', ['grant', 'generation'])
def test_stale_existing_receipt_is_redacted_without_rewrite_or_refund(context, monkeypatch, change):
    service, _, ws, _, admin = context
    cap, grant, call, _ = setup(context)
    receipt = 'synthetic-receipt-secret-for-replay-probe'
    monkeypatch.setattr(broker.secrets, 'token_urlsafe', lambda _: receipt)
    first = broker.CapabilityBroker(service, cap).call(call)
    assert first.status == 'observed' and first.output is not None
    with service.db.transaction() as connection:
        before = connection.execute(
            'SELECT * FROM tool_cost_entries WHERE attempt_id=%s ORDER BY kind',
            (first.attempt_id,)).fetchall()
    with Database(admin).transaction() as connection:
        if change == 'grant':
            connection.execute('UPDATE tool_grants SET active=false WHERE id=%s', (grant.id,))
        else:
            connection.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s', (ws,))
    with service.db.transaction() as connection:
        replay = connection.execute('SELECT settle_tool_call(%s,%s,%s) AS result',
                                    (first.attempt_id, receipt, encoded(first))).fetchone()['result']
        assert replay['status'] == 'cost_only'
        assert replay['output'] is None and replay['output_sha256'] is None
        assert all(replay[key] == [] for key in ('input_refs', 'output_refs', 'source_refs', 'omissions'))
        assert replay['error'] == {'code': 'authority_changed', 'retryable': False}
        assert connection.execute('SELECT * FROM tool_cost_entries WHERE attempt_id=%s ORDER BY kind',
                                  (first.attempt_id,)).fetchall() == before
        stored = connection.execute("SELECT data FROM tool_attempt_events WHERE attempt_id=%s AND kind='observation'",
                                    (first.attempt_id,)).fetchone()['data']
        assert stored == first.model_dump(mode='json')
