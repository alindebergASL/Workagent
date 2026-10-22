"""Cancelled responsibility selections must remain observable, never executable.

Synthetic HTTP and the existing disposable PostgreSQL fixture only. The known-ID
regression deliberately fails on the unchanged runtime: cancellation currently
returns before receipt recovery. No sleep, lease expiry, or invented recovery API.
"""
from types import SimpleNamespace

import httpx

from test_domain import context
from test_general_responses import totals, worker
from test_responsibility_execution import (
    SequenceProvider, admitted, answer, edit, setup,
)
from workagent.errors import DomainError
from workagent.general_responses import has_unresolved_attempt
from workagent.provider_attempts import ReceiptCapability
from workagent.responses_ledger import Ledger
from workagent.service import Service, WorkerCapability


class PendingSelection(SequenceProvider):
    """Retain one exact response; release its terminal body on an explicit GET.

    The first GET loses its synthetic read response, so the worker yields without
    its pending-response sleep. The create has already retained the exact ID.
    """

    def __init__(self, *, unknown_identity=False):
        super().__init__([answer], lose_phase='selection' if unknown_identity else None)
        self.release = False
        self.on_terminal_get = None

    def handle(self, request):
        if request.method == 'GET':
            self.calls.append((request.method, request.url.path))
            response_id = request.url.path.rsplit('/', 1)[1]
            assert response_id in self.responses, 'Must retrieve the original response'
            if not self.release:
                raise httpx.ReadTimeout('Synthetic pending read interrupted', request=request)
            if self.on_terminal_get is not None:
                callback, self.on_terminal_get = self.on_terminal_get, None
                callback()
            return httpx.Response(200, json=self.responses[response_id])
        response = super().handle(request)
        if request.url.path == '/v1/responses':
            return httpx.Response(200, json={
                **response.json(), 'status': 'in_progress', 'usage': None, 'output': [],
            })
        return response


def journal(case):
    with case.s.db.transaction() as c:
        steps = c.execute(
            'SELECT * FROM responses_steps WHERE attempt_id=%s ORDER BY phase',
            (case.receipt.attempt_id,),
        ).fetchall()
        rows = c.execute(
            'SELECT * FROM responses_events WHERE attempt_id=%s ORDER BY created_at,id',
            (case.receipt.attempt_id,),
        ).fetchall()
    return steps, rows, {row['kind']: row['data'] for row in rows}


def pending(context, tmp_path, *, unknown_identity=False):
    s, p, ws, _, _ = context
    cv, art, assignment, grant, _ = setup(context)
    bound = edit(context, art, 'Dependency revision that admits this execution.')
    s.advance_responsibilities(ws, grant.id)
    rows = admitted(s, ws)
    assert len(rows) == 1
    assert rows[0]['config']['responsibility']['assignment_id'] == assignment.id
    assert rows[0]['config']['responsibility']['observations'][0]['observed_version'] == bound.current_revision_id
    rid = rows[0]['run_id']
    fake = PendingSelection(unknown_identity=unknown_identity)
    w = worker(context, fake, tmp_path, poll_limit=1)
    assert w.work(p, ws, rid).state == 'running'
    saved_state = w.phases.state.load(ws, rid)
    receipt = ReceiptCapability(**saved_state['receipt'])
    cap = WorkerCapability(**saved_state['worker'])
    request, events = Ledger(s, receipt).snapshot('selection', cap)
    assert request is not None
    assert {'count_send', 'count_result', 'dispatch'} <= events.keys()
    assert 'result' not in events and 'tool_result' not in events
    assert ('identity' in events) == (not unknown_identity)
    if not unknown_identity:
        assert events['identity']['response_id'] == next(iter(fake.responses))
        assert events['identity']['request_sha256'] == request.sha256
        assert events['identity']['metadata'] == request.metadata.model_dump()
        assert fake.calls[-1] == ('GET', '/v1/responses/' + events['identity']['response_id'])
    assert totals(s, grant)['request_counts']['count_send'] == 1
    assert totals(s, grant)['request_counts']['dispatch'] == 1
    assert totals(s, grant)['unknown_usage_steps'] == 1
    return SimpleNamespace(s=s, p=p, ws=ws, cv=cv, art=art, grant=grant,
                           rid=rid, fake=fake, receipt=receipt, request=request,
                           saved_state=saved_state, original_worker=w)


def cancel_by_human_save(case, context):
    before = case.s.get_run(case.p, case.ws, case.rid)
    saved = edit(context, case.art, 'Human revision wins; do not apply the stale selection.')
    cancelled = case.s.get_run(case.p, case.ws, case.rid)
    assert cancelled.state == 'cancelled'
    assert cancelled.fence == before.fence + 1
    assert cancelled.lease_expires_at is None
    with case.s.db.transaction() as c:
        dispatch = c.execute(
            'SELECT acknowledged_at FROM run_dispatches WHERE workspace_id=%s AND run_id=%s',
            (case.ws, case.rid),
        ).fetchone()
        assert dispatch is not None and dispatch['acknowledged_at'] is not None
    case.saved = saved
    case.cancelled = cancelled
    return saved


def assert_no_application(case):
    assert case.s.get_run(case.p, case.ws, case.rid) == case.cancelled
    current = case.s.get_artifact(case.p, case.ws, case.art.id)
    assert current.current_revision_id == case.saved.current_revision_id
    assert current.current_revision == case.saved.current_revision
    assert current.current_revision.body.notes == [
        'Human revision wins; do not apply the stale selection.',
    ]
    _, _, events = journal(case)
    assert 'tool_result' not in events
    with case.s.db.transaction() as c:
        assert not c.execute(
            'SELECT 1 FROM run_publications WHERE workspace_id=%s AND run_id=%s',
            (case.ws, case.rid),
        ).fetchone()
        assert not c.execute(
            "SELECT 1 FROM conversation_messages WHERE workspace_id=%s AND run_id=%s AND author_kind='assistant'",
            (case.ws, case.rid),
        ).fetchone()


def restart(case, context, tmp_path):
    # Rehydrate both the service and worker from the same DB/private state path.
    fresh_context = (Service(case.s.db), *context[1:])
    w = worker(fresh_context, case.fake, tmp_path, poll_limit=1)
    assert w is not case.original_worker
    assert w.phases.state.load(case.ws, case.rid) == case.saved_state
    return w


def assert_history_preserved(case, before):
    steps, old_rows, _ = before
    current_steps, current_rows, _ = journal(case)
    assert current_steps == steps  # No replacement request or extra phase.
    current_by_id = {row['id']: row for row in current_rows}
    assert all(current_by_id.get(row['id']) == row for row in old_rows)
    assert case.s.get_provider_attempt(case.p, case.ws, case.rid).id == case.receipt.attempt_id


def test_cancelled_known_selection_recovers_receipt_after_restart(context, tmp_path):
    case = pending(context, tmp_path)
    before = journal(case)
    identity = before[2]['identity']
    accounting = totals(case.s, case.grant)
    cancel_by_human_save(case, context)
    assert_no_application(case)
    assert_history_preserved(case, before)
    assert journal(case)[2]['identity'] == identity
    assert 'result' not in journal(case)[2]

    case.fake.release = True  # The SAME response's next GET has selection + usage.
    calls = list(case.fake.calls)
    w = restart(case, context, tmp_path)
    assert w.work(case.p, case.ws, case.rid).state == 'cancelled'

    # Check every safety precondition before the deliberate root-cause RED.
    assert_no_application(case)
    assert_history_preserved(case, before)
    after = totals(case.s, case.grant)
    for kind in ('count_send', 'dispatch', 'cancel'):
        assert after['request_counts'][kind] == accounting['request_counts'][kind]
    for key in ('reserved_input_tokens', 'reserved_output_tokens', 'reserved_cost_usd'):
        assert after[key] == accounting[key]
    assert [call for call in case.fake.calls if call[0] == 'POST'] == [
        call for call in calls if call[0] == 'POST'
    ]
    events = journal(case)[2]
    assert events['identity'] == identity
    recovery_calls = case.fake.calls[len(calls):]
    assert (recovery_calls == [('GET', '/v1/responses/' + identity['response_id'])]
            and 'result' in events), (
        'Cancelled known response must be GET-observed and its terminal receipt retained; '
        f'post-cancellation calls={recovery_calls}, result_retained={"result" in events}'
    )
    result = events['result']
    assert result['state'] == 'function_call'
    assert result['response_id'] == identity['response_id']
    assert result['request_sha256'] == case.request.sha256
    assert result['metadata'] == identity['metadata']
    assert result['usage']['input_tokens'] == 700
    assert result['usage']['output_tokens'] == 200
    assert after['reported_usage'] == {'input_tokens': 700, 'output_tokens': 200}
    assert after['unknown_usage_steps'] == 0


def test_cancelled_unknown_identity_is_never_resent(context, tmp_path):
    case = pending(context, tmp_path, unknown_identity=True)
    before = journal(case)
    cancel_by_human_save(case, context)
    accounting = totals(case.s, case.grant)
    calls = list(case.fake.calls)
    case.fake.release = True
    for _ in range(2):
        w = restart(case, context, tmp_path)
        assert w.work(case.p, case.ws, case.rid).state == 'cancelled'
    assert_no_application(case)
    assert journal(case) == before
    assert case.fake.calls == calls
    assert totals(case.s, case.grant) == accounting
    assert accounting['unknown_usage_steps'] == 1
    with case.s.db.transaction() as c:
        assert has_unresolved_attempt(c, case.ws, case.cv.id)


def test_cancelled_arriving_selection_receipt_can_settle_without_tool_result(context, tmp_path):
    case = pending(context, tmp_path)
    before = journal(case)
    case.fake.release = True
    # Cancellation occurs inside the already-authorized synthetic GET, before
    # its terminal response is returned. Native Ledger.retain survives the fence.
    case.fake.on_terminal_get = lambda: cancel_by_human_save(case, context)
    try:
        case.original_worker.work(case.p, case.ws, case.rid)
    except DomainError:
        # Staging with the cancelled capability is correctly denied. The exact
        # retained receipt and untouched human work below prove the boundary.
        assert case.s.get_run(case.p, case.ws, case.rid).state == 'cancelled'
    assert_no_application(case)
    assert_history_preserved(case, before)
    events = journal(case)[2]
    assert events['result']['state'] == 'function_call'
    assert events['result']['response_id'] == before[2]['identity']['response_id']
    assert events['result']['request_sha256'] == case.request.sha256
    assert events['result']['usage']['input_tokens'] == 700
    assert events['result']['usage']['output_tokens'] == 200
    assert totals(case.s, case.grant)['unknown_usage_steps'] == 0
    calls = list(case.fake.calls)
    accounting = totals(case.s, case.grant)
    w = restart(case, context, tmp_path)
    assert w.work(case.p, case.ws, case.rid).state == 'cancelled'
    assert_no_application(case)
    assert_history_preserved(case, before)
    assert case.fake.calls == calls
    assert totals(case.s, case.grant) == accounting
    # Existing admission predicate, no new run, invented disposition, or stale
    # tool execution. Current code leaves this fully received selection blocked.
    with case.s.db.transaction() as c:
        assert not has_unresolved_attempt(c, case.ws, case.cv.id), (
            'Cancelled terminal selection with usage must settle without applying '
            'the stale action or fabricating a tool_result'
        )
