"""Additional admission-review probes; synthetic transport and disposable PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Event
import json
import time

import pytest

from test_domain import context
from test_responses_worker import setup, totals
from workagent.db import Database
from workagent.errors import DomainError
from workagent.provider_attempts import ReceiptCapability, revoke_grant
from workagent.responses_ledger import Ledger, ReservationDeferred
from workagent.service import WorkerCapability


def counted(context, tmp_path):
    grant, queued, fake, worker = setup(context, tmp_path)
    def stop(name):
        if name == 'after_count':raise RuntimeError('controlled before-reservation stop')
    worker.hook = stop
    with pytest.raises(RuntimeError):worker.run(context[2], queued.run.id)
    saved = worker.state.load(context[2], queued.run.id)
    cap = WorkerCapability(**saved['worker'])
    ledger = Ledger(context[0], ReceiptCapability(**saved['receipt']))
    request, _ = ledger.snapshot('selection', cap)
    return grant, queued, fake, worker, ledger, request, cap


def test_deferred_reservation_preserves_full_budget_and_prior_guards(context, tmp_path):
    grant, queued, fake, worker, ledger, request, cap = counted(context, tmp_path)
    before = totals(context[0], grant)
    with pytest.raises(ReservationDeferred):
        ledger.reserve_operation(request, 'dispatch', cap, ready=lambda _: False)
    assert totals(context[0], grant) == before
    assert 'dispatch' not in ledger.snapshot('selection', cap)[1]
    assert context[0].get_provider_attempt(context[1], context[2], queued.run.id).state == 'prepared'
    ledger.reserve_operation(request, 'dispatch', cap)
    committed = totals(context[0], grant)
    assert committed['request_counts']['dispatch'] == 1
    def forbidden(_):pytest.fail('Existing reservation must be rejected before the callback')
    with pytest.raises(DomainError) as caught:
        ledger.reserve_operation(request, 'dispatch', cap, ready=forbidden)
    assert caught.value.code.value == 'action_unresolved'
    assert totals(context[0], grant) == committed and len(fake.calls) == 1


def test_postcommit_revocation_diagnostic_contains_only_safe_metadata(context, tmp_path, caplog):
    grant, queued, fake, worker = setup(context, tmp_path)
    def revoke(name):
        if name == 'after_predispatch':revoke_grant(Database(context[4]), grant.id)
    worker.hook = revoke
    with pytest.raises(DomainError):worker.run(context[2], queued.run.id)
    records = [json.loads(r.message) for r in caplog.records if r.name == 'workagent.responses_worker']
    assert len(records) == 1
    assert records[0] == {'event': 'provider_io_not_started', 'run_id': queued.run.id,
        'attempt_id': worker.state.load(context[2], queued.run.id)['receipt']['attempt_id'],
        'phase': 'selection', 'operation': 'dispatch', 'reason': 'authority_changed',
        'reservation_committed': True}
    assert len(fake.calls) == 1
    assert totals(context[0], grant)['request_counts']['dispatch'] == 1


def test_real_advisory_lock_wait_can_roll_back_without_io(context, tmp_path, monkeypatch):
    grant, queued, fake, worker, ledger, request, cap = counted(context, tmp_path)
    before = totals(context[0], grant)
    held, entering = Event(), Event()
    def hold():
        with Database(context[4]).transaction() as c:
            c.execute('SELECT pg_advisory_xact_lock(721004120)')
            held.set()
            assert entering.wait(10)
            time.sleep(0.4)
    transaction = context[0].db.transaction
    waited = []
    class Connection:
        def __init__(self, c):self.c = c
        def execute(self, sql, *args, **kwargs):
            if sql == 'SELECT pg_advisory_xact_lock(721004120)':
                entering.set()
                started = time.monotonic()
                result = self.c.execute(sql, *args, **kwargs)
                waited.append(time.monotonic() - started)
                return result
            return self.c.execute(sql, *args, **kwargs)
    @contextmanager
    def instrumented():
        with transaction() as c:yield Connection(c)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(hold)
        assert held.wait(10)
        monkeypatch.setattr(context[0].db, 'transaction', instrumented)
        deadline = time.monotonic() + 0.2
        with pytest.raises(ReservationDeferred):
            ledger.reserve_operation(request, 'dispatch', cap, ready=lambda _: time.monotonic() < deadline)
        future.result(timeout=10)
    assert waited and waited[0] >= 0.3
    assert totals(context[0], grant) == before and len(fake.calls) == 1
    assert 'dispatch' not in ledger.snapshot('selection', cap)[1]
