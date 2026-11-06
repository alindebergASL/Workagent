"""Lease admission/reclaim: disposable PostgreSQL and synthetic HTTP only."""
from dataclasses import asdict
from datetime import datetime, timedelta
from types import SimpleNamespace
import json

import httpx
import pytest

from test_domain import context
from test_runtime import expire
from test_conversations import conversation, post
from test_general_responses import activate, Provider, worker, totals
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import now
from workagent.responses_dispatcher import ResponsesDispatcher
from workagent.responses_transport import ResponsesTransport
from workagent.responses_worker import ResponsesWorker
from workagent.service import Service, WorkerCapability


def setup_family(context, tmp_path, family):
    if family == 'intake':
        from test_responses_worker import setup
        grant, queued, fake, w = setup(context, tmp_path)
        return grant, queued, fake, w, w
    if family == 'adaptive':
        from test_adaptive_execution import setup
    else:
        from test_general_responses import setup
    _, grant, fake, queued, w = setup(context, tmp_path, **({'wait': True} if family == 'adaptive' else {}))
    # General/adaptive fixtures use a tiny timeout for ordinary in-process
    # MockTransport tests. These tests exercise the production HTTP admission
    # window itself, so restore its actual allowance instead of weakening gates.
    w.phases.transport._client.timeout = httpx.Timeout(30.0, connect=5.0)
    return grant, queued, fake, w, w.phases


def visit(context, w, rid):
    if isinstance(w, ResponsesWorker):
        return w.run(context[2], rid)
    return w.work(context[1], context[2], rid)


@pytest.mark.parametrize('timeout,allowed', [(None, False), (30.0, False), (1.0, True)])
def test_http_admission_uses_configured_phase_timeouts(tmp_path, monkeypatch, timeout, allowed):
    import workagent.responses_worker as module
    transport = ResponsesTransport.synthetic(httpx.MockTransport(lambda _: pytest.fail('no HTTP expected')))
    transport._client.timeout = httpx.Timeout(timeout)
    w = ResponsesWorker(None, transport, tmp_path)
    monkeypatch.setattr(w, '_fresh', lambda _: SimpleNamespace(lease_expires_at=now() + timedelta(seconds=40)))
    assert w._http_ready(None, module.time.monotonic() + 90) is allowed


@pytest.mark.parametrize('family', ['intake', 'general', 'adaptive'])
@pytest.mark.parametrize('operation', ['count_send', 'dispatch'])
def test_reservation_delay_rolls_back_unsent_slot(context, tmp_path, monkeypatch, family, operation):
    import workagent.responses_worker as module
    import workagent.service as service_module
    from workagent.responses_ledger import Ledger
    grant, queued, fake, w, phases = setup_family(context, tmp_path, family)
    clock = [0.0]
    origin = now()
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda _: None))
    monkeypatch.setattr(module, 'now', lambda: origin + timedelta(seconds=clock[0]))
    monkeypatch.setattr(service_module, 'now', lambda: origin + timedelta(seconds=clock[0]))
    monkeypatch.setattr('workagent.models.now', lambda: origin + timedelta(seconds=clock[0]))
    original = Ledger.event
    def delayed(self, c, phase, kind, data):
        result = original(self, c, phase, kind, data)
        if kind == operation:
            lease=datetime.fromisoformat(c.execute("SELECT data->>'lease_expires_at' lease FROM runs WHERE id=%s",
                (queued.run.id,)).fetchone()['lease'])
            clock[0]=(lease-origin).total_seconds()-sum(phases.transport._client.timeout.as_dict().values())-10+0.1
            # Cross the actual lease/handoff boundary, independent of claim duration.
        return result
    monkeypatch.setattr(Ledger, 'event', delayed)
    visit(context, w, queued.run.id)
    counts = totals(context[0], grant)['request_counts']
    assert counts == {'count_send': int(operation == 'dispatch'), 'dispatch': 0, 'read': 0, 'cancel': 0}
    assert len(fake.calls) == int(operation == 'dispatch')
    with context[0].db.transaction() as c:
        attempt = c.execute("SELECT data->>'state' state FROM provider_attempts WHERE run_id=%s", (queued.run.id,)).fetchone()
    assert attempt['state'] == 'prepared', 'Rollback must also undo the dispatched attempt transition'
    monkeypatch.setattr(Ledger, 'event', original)
    expire(context, queued.run.id)
    visit(context, w, queued.run.id)
    assert context[0].get_run(context[1], context[2], queued.run.id).state in ('ready', 'partial')
    assert totals(context[0], grant)['request_counts']['count_send'] == 2


@pytest.mark.parametrize('family', ['intake', 'general', 'adaptive'])
def test_window_closing_after_commit_is_logged_without_retry(context, tmp_path, monkeypatch, caplog, family):
    import workagent.responses_worker as module
    import workagent.service as service_module
    grant, queued, fake, w, phases = setup_family(context, tmp_path, family)
    clock = [0.0]
    origin = now()
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda _: None))
    monkeypatch.setattr(module, 'now', lambda: origin + timedelta(seconds=clock[0]))
    monkeypatch.setattr(service_module, 'now', lambda: origin + timedelta(seconds=clock[0]))
    monkeypatch.setattr('workagent.models.now', lambda: origin + timedelta(seconds=clock[0]))
    def close_lease(name):
        if name == 'after_predispatch':
            lease=context[0].get_run(context[1],context[2],queued.run.id).lease_expires_at
            clock[0]=(lease-origin).total_seconds()-sum(phases.transport._client.timeout.as_dict().values())-5+0.1
    phases.hook = close_lease
    visit(context, w, queued.run.id)
    messages = [json.loads(r.message) for r in caplog.records if r.name == module.__name__]
    assert len(messages) == 1
    assert messages[0] == {'event': 'provider_io_not_started', 'run_id': queued.run.id,
                           'attempt_id': phases.state.load(context[2], queued.run.id)['receipt']['attempt_id'],
                           'phase': 'selection', 'operation': 'dispatch', 'reason': 'http_window_closed',
                           'reservation_committed': True}
    before = totals(context[0], grant)
    assert before['request_counts'] == {'count_send': 1, 'dispatch': 1, 'read': 0, 'cancel': 0}
    assert len(fake.calls) == 1
    expire(context, queued.run.id)
    phases.hook = None
    visit(context, w, queued.run.id)
    assert totals(context[0], grant) == before and len(fake.calls) == 1


@pytest.mark.parametrize('operation', ['read', 'cancel'])
def test_reservation_delay_rolls_back_observation_slot(context, tmp_path, monkeypatch, operation):
    import workagent.responses_worker as module
    import workagent.service as service_module
    from workagent.provider_attempts import ReceiptCapability
    from workagent.responses_ledger import Ledger
    from test_responses_worker import setup
    grant, queued, fake, w = setup(context, tmp_path, queued=True)
    w.poll_limit = 0
    # Fixture setup is not the timeout probe. Its synthetic HTTP is immediate;
    # restore the production allowance before exercising the short lease.
    timeout = w.transport._client.timeout
    w.transport._client.timeout = httpx.Timeout(1)
    assert w.run(context[2], queued.run.id) == 'provider_pending'
    w.transport._client.timeout = timeout
    saved = w.state.load(context[2], queued.run.id)
    cap = WorkerCapability(**saved['worker'])
    ledger = Ledger(context[0], ReceiptCapability(**saved['receipt']))
    request, events = ledger.snapshot('selection', cap)
    before = totals(context[0], grant)
    calls = list(fake.calls)
    clock = [0.0]
    origin = now()
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda _: None))
    monkeypatch.setattr(module, 'now', lambda: origin + timedelta(seconds=clock[0]))
    monkeypatch.setattr(service_module, 'now', lambda: origin + timedelta(seconds=clock[0]))
    monkeypatch.setattr('workagent.models.now', lambda: origin + timedelta(seconds=clock[0]))
    original = Ledger.event
    def delayed(self, c, phase, kind, data):
        result = original(self, c, phase, kind, data)
        if kind == operation:
            lease=datetime.fromisoformat(c.execute("SELECT data->>'lease_expires_at' lease FROM runs WHERE id=%s",
                (queued.run.id,)).fetchone()['lease'])
            clock[0]=(lease-origin).total_seconds()-sum(w.transport._client.timeout.as_dict().values())-10+0.1
        return result
    monkeypatch.setattr(Ledger, 'event', delayed)
    if operation == 'cancel':
        with pytest.raises(DomainError) as caught:
            w.cancel(ledger, request, cap)
        assert caught.value.code.value == 'action_unresolved'
    else:
        w.poll_limit = 1
        assert w.run(context[2], queued.run.id) == 'provider_pending'
    assert totals(context[0], grant) == before and fake.calls == calls
    # A safe returned-ID handoff may have ended this exact lease. Do not use
    # the retired worker capability as a read credential; inspect the retained
    # immutable identity through the human-authorized fixture database instead.
    with context[0].db.transaction() as c:
        retained = c.execute("SELECT data FROM responses_events WHERE attempt_id=%s "
                             "AND phase='selection' AND kind='identity'",
                             (saved['receipt']['attempt_id'],)).fetchone()['data']
    assert retained == events['identity']
    current = context[0].get_run(context[1], context[2], queued.run.id)
    if current.lease_expires_at <= now():
        with pytest.raises(DomainError):
            ledger.snapshot('selection', cap)


def remaining(context, rid, seconds):
    with Database(context[4]).transaction() as c:
        c.execute("UPDATE runs SET data=jsonb_set(data,'{lease_expires_at}',to_jsonb(%s::text)) "
                  "WHERE workspace_id=%s AND id=%s",
                  ((now() + timedelta(seconds=seconds)).isoformat(), context[2], rid))


def drive_settled_visits(context, w, rid, *, until, step=None):
    """Separate functional recovery from one-visit wall-clock assumptions.

    Only synthetic, returned operations may have their lease advanced here.
    Unknown/in-flight operations fail the probe rather than being replayed.
    Exact total send counts and stale-fence assertions remain in each caller.
    """
    from workagent.responses_io import active
    for _ in range(12):
        result = step() if step else visit(context, w, rid)
        if until():
            return result
        with context[0].db.transaction() as c:
            rows = c.execute('SELECT a.id,e.phase,e.kind FROM provider_attempts a '
                             'LEFT JOIN responses_events e ON e.attempt_id=a.id '
                             'WHERE a.run_id=%s', (rid,)).fetchall()
            for phase in {r['phase'] for r in rows if r['phase']}:
                events = {r['kind'] for r in rows if r['phase'] == phase}
                assert not events.intersection({'problem', 'cancel'})
                assert 'count_send' not in events or 'count_result' in events
                assert 'dispatch' not in events or 'identity' in events
                assert not any(active(c, rows[0]['id'], phase, kind)
                               for kind in ('count_send', 'dispatch', 'read', 'cancel'))
        expire(context, rid)
    raise AssertionError('Synthetic settled recovery did not reach its asserted condition')


def test_short_lease_does_not_reserve_cancel(context, tmp_path):
    from test_responses_worker import setup
    from workagent.provider_attempts import ReceiptCapability
    from workagent.responses_ledger import Ledger
    grant, queued, fake, w = setup(context, tmp_path, queued=True)
    w.poll_limit = 0
    # Fixture setup is not the timeout probe. Its synthetic HTTP is immediate;
    # restore the production allowance before exercising the short lease.
    timeout = w.transport._client.timeout
    w.transport._client.timeout = httpx.Timeout(1)
    assert w.run(context[2], queued.run.id) == 'provider_pending'
    w.transport._client.timeout = timeout
    saved = w.state.load(context[2], queued.run.id)
    cap = WorkerCapability(**saved['worker'])
    ledger = Ledger(context[0], ReceiptCapability(**saved['receipt']))
    request, _ = ledger.snapshot('selection', cap)
    before = totals(context[0], grant)
    calls = len(fake.calls)
    remaining(context, queued.run.id, 10)
    with pytest.raises(DomainError) as caught:
        w.cancel(ledger, request, cap)
    assert caught.value.code.value == 'action_unresolved'
    assert totals(context[0], grant) == before
    assert len(fake.calls) == calls


@pytest.mark.parametrize('family', ['intake', 'general', 'adaptive'])
def test_short_saved_lease_defers_without_reserving_and_reclaims(context, tmp_path, family):
    s, p, ws, _, _ = context
    grant, queued, fake, w, phases = setup_family(context, tmp_path, family)
    def interrupt(name):
        if name == 'after_count':
            raise RuntimeError('synthetic interruption')
    phases.hook = interrupt
    with pytest.raises(RuntimeError):
        visit(context, w, queued.run.id)
    before = totals(s, grant)
    calls = len(fake.calls)
    old = WorkerCapability(**phases.state.load(ws, queued.run.id)['worker'])
    remaining(context, queued.run.id, 10)
    phases.hook = None
    visit(context, w, queued.run.id)
    assert len(fake.calls) == calls, 'A fresh visit must not outlive its saved lease'
    assert totals(s, grant) == before, 'Deferral must not create an ambiguous send slot'
    assert s.get_run(p, ws, queued.run.id).fence == old.fence
    expire(context, queued.run.id)
    visit(context, w, queued.run.id)
    assert s.get_run(p, ws, queued.run.id).fence == old.fence + 1
    if s.get_run(p, ws, queued.run.id).state == 'running':
        drive_settled_visits(context, w, queued.run.id,
            until=lambda: s.get_run(p, ws, queued.run.id).state in ('ready', 'partial'))
    assert s.get_run(p, ws, queued.run.id).state in ('ready', 'partial')
    assert totals(s, grant)['request_counts']['count_send'] == 2
    with pytest.raises(DomainError):
        with s.db.transaction() as c:
            s._check_capability(c, old)


@pytest.mark.parametrize('family', ['intake', 'general', 'adaptive'])
def test_receiptless_interrupted_claim_uses_existing_claim_authority(context, tmp_path, family):
    s, p, ws, _, _ = context
    _, queued, _, w, phases = setup_family(context, tmp_path, family)
    cap = s.claim_run(p, ws, queued.run.id)
    phases.state.save(ws, queued.run.id, {'worker': asdict(cap), 'receipt': None})
    expire(context, queued.run.id)
    visit(context, w, queued.run.id)
    assert s.get_run(p, ws, queued.run.id).fence == cap.fence + 1
    if s.get_run(p, ws, queued.run.id).state == 'running':
        drive_settled_visits(context, w, queued.run.id,
            until=lambda: s.get_run(p, ws, queued.run.id).state in ('ready', 'partial'))
    assert s.get_run(p, ws, queued.run.id).state in ('ready', 'partial')


@pytest.mark.parametrize('family', ['intake', 'general', 'adaptive'])
def test_short_lease_before_first_count_does_not_spend(context, tmp_path, family):
    s, p, ws, _, _ = context
    grant, queued, fake, w, phases = setup_family(context, tmp_path, family)
    cap = s.claim_run(p, ws, queued.run.id)
    phases.state.save(ws, queued.run.id, {'worker': asdict(cap), 'receipt': None})
    remaining(context, queued.run.id, 10)
    visit(context, w, queued.run.id)
    assert fake.calls == []
    assert totals(s, grant)['request_counts'] == {'count_send': 0, 'dispatch': 0, 'read': 0, 'cancel': 0}


@pytest.mark.parametrize('family', ['intake', 'general', 'adaptive'])
def test_reclaim_without_receipt_cannot_replace_prepared_attempt(context, tmp_path, family):
    grant, queued, fake, w, phases = setup_family(context, tmp_path, family)
    def interrupt(name):
        if name == 'after_count':
            raise RuntimeError('synthetic interruption')
    phases.hook = interrupt
    with pytest.raises(RuntimeError):
        visit(context, w, queued.run.id)
    saved = phases.state.load(context[2], queued.run.id)
    saved['receipt'] = None
    phases.state.save(context[2], queued.run.id, saved)
    before = totals(context[0], grant)
    expire(context, queued.run.id)
    with pytest.raises(DomainError) as caught:
        visit(context, w, queued.run.id)
    assert caught.value.code.value == 'action_unresolved'
    assert len(fake.calls) == 1
    assert totals(context[0], grant) == before


@pytest.mark.parametrize('family', ['intake', 'general'])
def test_final_delivered_after_lease_expiry_is_retained_not_regenerated(context, tmp_path, family):
    s, p, ws, _, _ = context
    grant, queued, fake, w, phases = setup_family(context, tmp_path, family)
    original = fake.handle
    final_returned = []
    def expires_during_final(request):
        response = original(request)
        if request.method == 'POST' and request.url.path == '/v1/responses':
            if json.loads(request.content)['metadata']['step_id'] == 'final':
                expire(context, queued.run.id)
                final_returned.append(True)
        return response
    transport = ResponsesTransport.synthetic(httpx.MockTransport(expires_during_final))
    phases.transport = transport
    if hasattr(w, 'phases'):
        w.transport = transport
    dispatcher = ResponsesDispatcher(w, workspace=ws, grant_id=grant.id)
    first = drive_settled_visits(context, w, queued.run.id,
        until=lambda: bool(final_returned), step=dispatcher.once)
    assert first['results'] == [{'run_id': queued.run.id, 'status': 'denied_or_deferred',
                                'reason': 'action_unresolved'}]
    with s.db.transaction() as c:
        retained = c.execute("SELECT e.kind FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id "
                             "WHERE a.run_id=%s AND e.phase='final'", (queued.run.id,)).fetchall()
    assert {'identity', 'result'} <= {row['kind'] for row in retained}
    before = len(fake.calls)
    assert dispatcher.once()['results'] == [{'run_id': queued.run.id, 'status': 'completed'}]
    assert s.get_run(p, ws, queued.run.id).state == 'ready'
    assert len(fake.calls) == before
    assert totals(s, grant)['request_counts'] == {'count_send': 2, 'dispatch': 2, 'read': 0, 'cancel': 0}


@pytest.mark.parametrize('family', ['intake', 'general', 'adaptive'])
def test_in_visit_elapsed_http_time_stops_before_next_reservation(context, tmp_path, monkeypatch, family):
    import workagent.responses_worker as module
    import workagent.service as service_module
    grant, queued, fake, w, phases = setup_family(context, tmp_path, family)
    clock = [0.0]
    origin = now()
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda _: None))
    monkeypatch.setattr(module, 'now', lambda: origin + timedelta(seconds=clock[0]), raising=False)
    monkeypatch.setattr(service_module, 'now', lambda: origin + timedelta(seconds=clock[0]))
    monkeypatch.setattr('workagent.models.now', lambda: origin + timedelta(seconds=clock[0]))
    original = fake.handle
    delay = []
    def slow(request):
        response = original(request)
        if not delay:
            lease=context[0].get_run(context[1],context[2],queued.run.id).lease_expires_at
            allowance=sum(phases.transport._client.timeout.as_dict().values())+5
            delay.append(((lease-origin).total_seconds()-allowance)/2+1)
        clock[0] += delay[0]
        return response
    transport = ResponsesTransport.synthetic(httpx.MockTransport(slow))
    phases.transport = transport
    if hasattr(w, 'phases'):
        w.transport = transport
    visit(context, w, queued.run.id)
    # Derive elapsed time from the actual claim and configured HTTP allowance.
    # One response leaves handoff capacity; two cross the lease allowance.
    assert len(fake.calls) == 2
    assert totals(context[0], grant)['request_counts'] == {
        'count_send': 1, 'dispatch': 1, 'read': 0, 'cancel': 0}
    assert context[0].get_run(context[1], context[2], queued.run.id).state == 'running'


def test_dispatcher_recovers_known_final_and_progresses_beside_unknown(context, tmp_path):
    s, p, ws, _, _ = context
    cvs = [conversation(context) for _ in range(2)]
    grant = activate(context, cvs)
    queued = [post(context, cv, 'Please answer this question.') for cv in cvs]
    fake = Provider()
    original = fake.handle
    unknown_id = queued[1].run.id
    def selective_loss(request):
        data = json.loads(request.content) if request.content else {}
        fake.lose_id = data.get('metadata', {}).get('request_id') == unknown_id
        return original(request)
    fake.handle = selective_loss
    w = worker(context, fake, tmp_path)
    responses = [0]
    def interrupt(name):
        if name == 'after_response':
            responses[0] += 1
            if responses[0] == 2:
                raise RuntimeError('synthetic interruption after final identity retention')
    w.phases.hook = interrupt
    dispatcher = ResponsesDispatcher(w, workspace=ws, grant_id=grant.id)
    first = {r['run_id']: r['status'] for r in dispatcher.once()['results']}
    known_id = queued[0].run.id
    assert first == {known_id: 'internal_error', unknown_id: 'outcome_unknown'}
    with s.db.transaction() as c:
        identity = c.execute("SELECT e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id "
                             "WHERE a.run_id=%s AND e.phase='final' AND e.kind='identity'", (known_id,)).fetchone()['data']
    remaining(context, known_id, 10)
    before = len(fake.calls)
    restarted = worker((Service(Database()), *context[1:]), fake, tmp_path)
    dispatcher = ResponsesDispatcher(restarted, workspace=ws, grant_id=grant.id)
    assert {r['run_id']: r['status'] for r in dispatcher.once()['results']} == {
        known_id: 'provider_pending', unknown_id: 'outcome_unknown'}
    assert len(fake.calls) == before
    expire(context, known_id)
    assert {r['run_id']: r['status'] for r in dispatcher.once()['results']} == {
        known_id: 'completed', unknown_id: 'outcome_unknown'}
    assert fake.calls[before:] == [('GET', '/v1/responses/' + identity['response_id'])]
    assert totals(s, grant)['request_counts'] == {'count_send': 3, 'dispatch': 3, 'read': 1, 'cancel': 0}
    assert len(s.get_conversation(p, ws, cvs[0].id).messages) == 2
    # Another admitted request progresses on the same canonical dispatcher,
    # while the unrelated conversation's unknown request stays quarantined.
    detail = s.get_conversation(p, ws, cvs[0].id)
    next_turn = post(context, detail.conversation, 'A separate follow-up question.')
    assert {r['run_id']: r['status'] for r in dispatcher.once()['results']} == {
        next_turn.run.id: 'completed', unknown_id: 'outcome_unknown'}
    assert totals(s, grant)['request_counts'] == {'count_send': 5, 'dispatch': 5, 'read': 1, 'cancel': 0}
    assert totals(s, grant)['unknown_usage_steps'] == 1
    assert len(s.get_conversation(p, ws, cvs[0].id).messages) == 4
    assert len(s.get_conversation(p, ws, cvs[1].id).messages) == 1
    assert dispatcher.once()['results'] == [{'run_id': unknown_id, 'status': 'outcome_unknown'}]
    assert len(fake.calls) == before + 5
    with s.db.transaction() as c:
        rows = c.execute('SELECT run_id,acknowledged_at FROM run_dispatches WHERE workspace_id=%s', (ws,)).fetchall()
    assert {r['run_id'] for r in rows if r['acknowledged_at']} == {known_id, next_turn.run.id}


@pytest.mark.parametrize('general,lease_seconds,validation_seconds,expected', [
    (False,180,10,90),(True,180,10,165),(True,300,10,285),
    (True,600,10,585),(True,900,10,600),
    (True,80,10,65),(True,4,0,0)])
def test_scheduling16_offline_deadline_from_actual_lease(tmp_path,monkeypatch,general,lease_seconds,validation_seconds,expected):
    import workagent.responses_worker as module
    origin=now();clock=[0.0];calls=[]
    w=ResponsesWorker(None,ResponsesTransport.synthetic(httpx.MockTransport(lambda _:pytest.fail('no I/O'))),
                      tmp_path,general_responses=general)
    monkeypatch.setattr(module,'time',SimpleNamespace(monotonic=lambda:clock[0]))
    monkeypatch.setattr(module,'now',lambda:origin+timedelta(seconds=clock[0]))
    def fresh(cap):
        calls.append(cap);clock[0]+=validation_seconds
        return SimpleNamespace(profile='general-responses-v1' if general else 'intake',
                               lease_expires_at=origin+timedelta(seconds=lease_seconds))
    monkeypatch.setattr(w,'_fresh',fresh)
    assert w._visit_deadline('cap')==expected
    assert calls==['cap'] and w.deadline_seconds==90
    with pytest.raises(ValueError):ResponsesWorker(None,w.transport,tmp_path/'other',deadline_seconds=180)


def test_scheduling16_offline_general_requires_general_profile(tmp_path,monkeypatch):
    w=ResponsesWorker(None,ResponsesTransport.synthetic(httpx.MockTransport(lambda _:pytest.fail('no I/O'))),
                      tmp_path,general_responses=True)
    monkeypatch.setattr(w,'_fresh',lambda _:SimpleNamespace(profile='intake',lease_expires_at=now()+timedelta(seconds=180)))
    with pytest.raises(DomainError):w._visit_deadline(None)
    with pytest.raises(DomainError):w._after_reservation_ready(scheduling_request(),'dispatch',None,0)


def scheduling_request():
    return SimpleNamespace(phase='selection',metadata=SimpleNamespace(request_id='synthetic-run',attempt_id='synthetic-attempt'))


@pytest.mark.parametrize('kind',['count_send','dispatch','read','cancel'])
@pytest.mark.parametrize('fault',['none','short_lease','revoked','stale','context'])
def test_scheduling16_offline_immediate_continuation(tmp_path,monkeypatch,kind,fault):
    import workagent.responses_worker as module
    w=ResponsesWorker(None,ResponsesTransport.synthetic(httpx.MockTransport(lambda _:pytest.fail('no I/O'))),
                      tmp_path,general_responses=True)
    origin=now();calls=[]
    monkeypatch.setattr(module,'time',SimpleNamespace(monotonic=lambda:200.0))
    monkeypatch.setattr(module,'now',lambda:origin)
    allowance=sum(w.transport._client.timeout.as_dict().values())+5
    def fresh(cap):
        calls.append(cap)
        if fault in ('revoked','stale','context'):raise DomainError('source_changed' if fault=='context' else 'not_found_or_not_authorized')
        return SimpleNamespace(profile='general-responses-v1',lease_expires_at=origin+timedelta(seconds=allowance+(0 if fault=='short_lease' else 1)))
    monkeypatch.setattr(w,'_fresh',fresh)
    assert w._http_ready('cap',175) is False and calls==[]
    if fault in ('revoked','stale','context'):
        with pytest.raises(DomainError):w._after_reservation_ready(scheduling_request(),kind,'cap',175)
    else:assert w._after_reservation_ready(scheduling_request(),kind,'cap',175) is (fault=='none')
    assert calls==['cap']


def test_scheduling16_offline_intake_cutoff_and_unknown_no_resend(tmp_path,monkeypatch):
    import workagent.responses_worker as module
    monkeypatch.setattr(module,'time',SimpleNamespace(monotonic=lambda:200.0))
    w=ResponsesWorker(None,ResponsesTransport.synthetic(httpx.MockTransport(lambda _:pytest.fail('no I/O'))),tmp_path)
    monkeypatch.setattr(w,'_fresh',lambda _:pytest.fail('legacy expired deadline remains early refusal'))
    assert w._after_reservation_ready(scheduling_request(),'dispatch',None,175) is False
    w.general_responses=True
    marked=[];w.service=SimpleNamespace(mark_provider_unknown=lambda receipt:marked.append(receipt))
    ledger=SimpleNamespace(receipt='receipt',snapshot=lambda *args:(None,{'dispatch':{}}))
    assert w._step(ledger,scheduling_request(),None,300) is None
    assert marked==['receipt']


def test_scheduling16_offline_no_phase_deadline_reset():
    import ast,inspect,textwrap
    from workagent.general_worker import GeneralWorker
    # Assert the actual loop passes its one visit deadline to every phase path.
    tree=ast.parse(textwrap.dedent(inspect.getsource(GeneralWorker._responses_work)))
    calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)]
    assert sum(n.func.attr=='_visit_deadline' for n in calls)==1
    phase_calls=[n for n in calls if n.func.attr in ('_step','_prepared_final','_prepared_selection')]
    assert phase_calls
    for call in phase_calls:assert any(isinstance(a,ast.Name) and a.id=='deadline' for a in call.args)


@pytest.mark.parametrize('operation',['count_send','dispatch'])
def test_scheduling16_precommit_cutoff_rolls_back_with_lease_slack(context,tmp_path,monkeypatch,operation):
    import workagent.responses_worker as module
    from workagent.responses_ledger import Ledger
    grant,queued,fake,w,phases=setup_family(context,tmp_path,'general')
    clock=[0.0];deadlines=[];original_deadline=phases._visit_deadline;event=Ledger.event
    monkeypatch.setattr(module,'time',SimpleNamespace(monotonic=lambda:clock[0],sleep=lambda _:None))
    def deadline(cap):
        result=original_deadline(cap);deadlines.append(result);return result
    monkeypatch.setattr(phases,'_visit_deadline',deadline)
    def delayed(self,c,phase,kind,data):
        result=event(self,c,phase,kind,data)
        if kind==operation:
            clock[0]=deadlines[0]+0.1
            lease=datetime.fromisoformat(c.execute("SELECT data->>'lease_expires_at' lease FROM runs WHERE id=%s",(queued.run.id,)).fetchone()['lease'])
            assert (lease-now()).total_seconds()>sum(phases.transport._client.timeout.as_dict().values())+10
        return result
    monkeypatch.setattr(Ledger,'event',delayed)
    visit(context,w,queued.run.id)
    assert len(deadlines)==1 and len(fake.calls)==int(operation=='dispatch')
    assert totals(context[0],grant)['request_counts']==dict(count_send=int(operation=='dispatch'),dispatch=0,read=0,cancel=0)
    with context[0].db.transaction() as c:
        assert c.execute("SELECT data->>'state' state FROM provider_attempts WHERE run_id=%s",(queued.run.id,)).fetchone()['state']=='prepared'


@pytest.mark.parametrize('operation',['count_send','dispatch','read'])
def test_scheduling16_postcommit_cutoff_sends_once(context,tmp_path,monkeypatch,operation):
    from collections import Counter
    from hashlib import sha256
    from test_gateway_target_rejection import material
    from workagent.product_models import ReconcileCSV,CSVObservation,FileBody,TableBody
    from workagent.service import canonical,digest
    import workagent.responses_worker as module
    from workagent.provider_attempts import ReceiptCapability
    from workagent.responses_ledger import Ledger
    grant,queued,fake,w,phases=setup_family(context,tmp_path,'general')
    before_material=material(context)
    clock=[0.0];deadlines=[];original_deadline=phases._visit_deadline;reserve=phases._reserve_http
    monkeypatch.setattr(module,'time',SimpleNamespace(monotonic=lambda:clock[0],sleep=lambda _:None))
    def deadline(cap):
        value=original_deadline(cap);deadlines.append(value);return value
    monkeypatch.setattr(phases,'_visit_deadline',deadline)
    # For GET, retain an acknowledged in-progress response from the same local
    # provider. Only the GET returns its already constructed completed result.
    handle=fake.handle
    def handle_async(request):
        response=handle(request)
        if operation=='read' and request.method=='POST' and request.url.path=='/v1/responses':
            value=response.json();value['status']='in_progress';value['output']=[]
            return httpx.Response(200,json=value)
        return response
    monkeypatch.setattr(fake,'handle',handle_async)
    phases.transport._client._transport=httpx.MockTransport(handle_async)
    def crossing(*args,**kwargs):
        result=reserve(*args,**kwargs)
        if args[2]==operation and result is not None:clock[0]=deadlines[0]+0.1
        return result
    monkeypatch.setattr(phases,'_reserve_http',crossing)
    visit(context,w,queued.run.id)
    assert len(deadlines)==1
    saved=phases.state.load(context[2],queued.run.id)
    ledger=Ledger(context[0],ReceiptCapability(**saved['receipt']))
    request,events=ledger.snapshot('selection',WorkerCapability(**saved['worker']))
    expected={'count_send','count_result'}
    if operation!='count_send':expected|={'dispatch','identity','result','tool_result'}
    assert set(events)==expected
    with context[0].db.transaction() as c:
        rows=c.execute('SELECT phase,kind FROM responses_events WHERE attempt_id=%s',
                       (saved['receipt']['attempt_id'],)).fetchall()
        steps={row['phase']:row for row in c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s',
                       (saved['receipt']['attempt_id'],)).fetchall()}
        assert c.execute('SELECT count(*) n FROM tool_attempts WHERE run_id=%s',(queued.run.id,)).fetchone()['n']==0
        assert c.execute('SELECT count(*) n FROM product_observations WHERE run_id=%s',(queued.run.id,)).fetchone()['n']==0
    # Snapshot deliberately omits read/cancel; raw rows prove exact multiplicity
    # and that the prepared final has no count/send/read/native effect.
    expected_counts={('selection',kind):1 for kind in expected}
    if operation=='read':expected_counts['selection','read']=1
    assert Counter((row['phase'],row['kind']) for row in rows)==expected_counts
    assert set(steps)==({'selection'} if operation=='count_send' else {'selection','final'})
    assert steps['selection']['request_bytes'].encode()==request.body
    assert steps['selection']['request_sha256']==request.sha256
    assert steps['selection']['count_bytes'].encode()==request.count_body()
    assert steps['selection']['count_sha256']==sha256(request.count_body()).hexdigest()
    assert events['count_result']['count_sha256']==steps['selection']['count_sha256']
    for kind in ('count_result',) if operation=='count_send' else ('count_result','identity','result'):
        assert events[kind]['request_sha256']==request.sha256
        assert events[kind]['metadata']==request.metadata.model_dump()
    if operation!='count_send':
        attachment=queued.message.attachments[0]
        decision={'kind':'reconcile_csv','attachment':{'ref':attachment.ref,'sha256':attachment.sha256},
                  'target':None,'rounding':'ROUND_HALF_UP'}
        selected=events['result'];staged=events['tool_result']
        assert selected['value']=={'decision':decision} and selected['state']=='function_call'
        assert selected['response_id']==events['identity']['response_id']
        assert set(fake.responses)=={selected['response_id']}
        resolved=ReconcileCSV(kind='reconcile_csv',input_csv=attachment.content,rounding='ROUND_HALF_UP')
        assert set(staged)=={'status','body','file','output','binding'} and staged['status']=='observed'
        assert staged['binding']==dict(attempt_id=saved['receipt']['attempt_id'],
            selection_request_sha256=request.sha256,selection_response_id=selected['response_id'],
            decision_sha256=digest(selected['value']),operation_hash=digest(resolved),base_hash=None)
        observed=CSVObservation.model_validate(staged['output'],strict=True)
        assert observed.input_sha256==sha256(attachment.content.encode()).hexdigest()
        assert observed.rounding=='ROUND_HALF_UP' and observed.expected_sum=='77.40' and observed.source_values_preserved
        body=TableBody.model_validate(staged['body'],strict=True)
        file=FileBody.model_validate(staged['file'],strict=True)
        assert body.source_csv==attachment.content and body.rounding==observed.rounding
        assert file.filename=='reconciled.csv' and file.mime_type=='text/csv'
        assert json.loads(steps['final']['request_bytes'])['input'][-1]==dict(
            type='function_call_output',call_id=selected['call_id'],output=canonical(staged))
    assert material(context)==before_material
    assert totals(context[0],grant)['request_counts']==dict(count_send=1,dispatch=int(operation!='count_send'),read=int(operation=='read'),cancel=0)
    assert len(fake.calls)==1+int(operation!='count_send')+int(operation=='read')
    # No next phase reservation despite successful same-call continuation.
    assert context[0].get_run(context[1],context[2],queued.run.id).state=='running'


@pytest.mark.parametrize('remaining,handoff,allowed',[(100,False,False),(100.01,False,True),(105,True,False),(105.01,True,True)])
def test_scheduling16_offline_production_http_boundaries(tmp_path,monkeypatch,remaining,handoff,allowed):
    import workagent.responses_worker as module
    origin=now()
    monkeypatch.setattr(module,'now',lambda:origin)
    monkeypatch.setattr(module,'time',SimpleNamespace(monotonic=lambda:0))
    w=ResponsesWorker(None,ResponsesTransport.synthetic(httpx.MockTransport(lambda _:pytest.fail('no I/O'))),tmp_path,general_responses=True)
    w.transport._client.timeout=httpx.Timeout(30,connect=5)
    run=SimpleNamespace(lease_expires_at=origin+timedelta(seconds=remaining))
    assert w._http_window(run,180,handoff=handoff) is allowed
