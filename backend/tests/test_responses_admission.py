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


@pytest.mark.parametrize('damage',['revoked','stale','context'])
def test_scheduling16_postcommit_cutoff_still_checks_current_authority(context,tmp_path,monkeypatch,damage):
    from types import SimpleNamespace
    from test_responses_leases import setup_family,visit
    import workagent.responses_worker as module
    s,p,ws,refs,admin=context
    grant,queued,fake,w,phases=setup_family(context,tmp_path,'general')
    clock=[0.0];deadlines=[];reserve=phases._reserve_http;original_deadline=phases._visit_deadline
    monkeypatch.setattr(module,'time',SimpleNamespace(monotonic=lambda:clock[0],sleep=lambda _:None))
    def deadline(cap):
        result=original_deadline(cap);deadlines.append(result);return result
    monkeypatch.setattr(phases,'_visit_deadline',deadline)
    committed=[]
    def invalidate(*args,**kwargs):
        result=reserve(*args,**kwargs)
        if args[2]=='dispatch' and result is not None:
            clock[0]=deadlines[0]+0.1
            with Database(admin).transaction() as c:
                committed.extend(c.execute('SELECT to_jsonb(e) v FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.id',(queued.run.id,)).fetchall())
                if damage=='revoked':c.execute('UPDATE provider_grants SET active=false WHERE id=%s',(grant.id,))
                elif damage=='stale':c.execute("UPDATE runs SET data=jsonb_set(data,'{fence}',to_jsonb((data->>'fence')::int+1)) WHERE id=%s",(queued.run.id,))
                else:
                    # Current valid source access remains, but the previously
                    # frozen context no longer equals the current conversation.
                    c.execute("UPDATE conversations SET data=jsonb_set(data,'{selected_source_refs}',%s::jsonb) WHERE workspace_id=%s AND id=%s",
                              (json.dumps([refs[0].model_dump(mode='json')]),ws,queued.run.conversation_id))
        return result
    monkeypatch.setattr(phases,'_reserve_http',invalidate)
    with pytest.raises(DomainError) as denied:visit(context,w,queued.run.id)
    if damage=='context':assert denied.value.code.value=='source_changed'
    assert len(deadlines)==1 and len(fake.calls)==1
    with s.db.transaction() as c:
        after=c.execute('SELECT to_jsonb(e) v FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.id',(queued.run.id,)).fetchall()
    assert committed and after==committed
    assert totals(s,grant)['request_counts']==dict(count_send=1,dispatch=1,read=0,cancel=0)
