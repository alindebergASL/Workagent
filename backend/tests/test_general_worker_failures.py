"""Controlled worker failure isolation against real disposable PostgreSQL."""
import json

import pytest

from test_domain import context, cmd
from test_conversations import conversation, post
from workagent.db import Database
from workagent.dispatcher import Dispatcher
from workagent.errors import DomainError
from workagent.general_worker import ControlledTransport, GeneralWorker
from workagent.models import CancelConversation
from workagent.product_models import ReconcileCSV


PRIVATE_MARKER = 'synthetic-private-exception-must-not-be-published'


def queue(ctx, product=False, refs=None):
    cv = conversation(ctx, refs)
    kwargs = {}
    if product:
        kwargs['operation'] = ReconcileCSV(
            kind='reconcile_csv',
            input_csv='id,quantity,unit_price,reported_total\nA,2,3,6\n')
    return post(ctx, cv, **kwargs)


def sweep(service, ws, route):
    if route == 'direct':
        return GeneralWorker(service, transport=ControlledTransport()).once(workspace=ws)
    return Dispatcher(service, workspace=ws, general_controlled=True).once()


def durable(ctx, rid):
    service, _, ws, _, admin = ctx
    with Database(admin).transaction() as c:
        run = c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',
                        (ws, rid)).fetchone()['data']
        dispatch = c.execute('''SELECT d.acknowledged_at,o.consumed_at FROM run_dispatches d
            JOIN outbox o ON o.id=d.outbox_id WHERE d.workspace_id=%s AND d.run_id=%s''',
                             (ws, rid)).fetchone()
        events = c.execute('SELECT operation FROM audit WHERE workspace_id=%s AND object_id=%s ORDER BY operation',
                           (ws, rid)).fetchall()
        messages = c.execute('SELECT data FROM conversation_messages WHERE workspace_id=%s AND data->>\'run_id\'=%s ORDER BY sequence',
                             (ws, rid)).fetchall()
        observations = c.execute('SELECT data FROM product_observations WHERE workspace_id=%s AND run_id=%s ORDER BY id',
                                 (ws, rid)).fetchall()
        assert c.execute('SELECT count(*) n FROM provider_attempts WHERE workspace_id=%s',
                         (ws,)).fetchone()['n'] == 0
    return run, dispatch, events, messages, observations


@pytest.mark.parametrize('route', ['direct', 'dispatcher'])
@pytest.mark.parametrize('fault,product', [('runtime', False), ('runtime', True), ('validation', False)])
def test_failure_then_healthy_same_sweep_and_replay(context, monkeypatch, route, fault, product):
    s, p, ws, _, _ = context
    failed = queue(context, product)
    healthy = queue(context)
    original = ControlledTransport.respond
    calls = []

    def respond(self, current):
        calls.append(current['run_id'])
        if current['run_id'] == failed.run.id:
            if fault == 'runtime':
                raise RuntimeError(PRIVATE_MARKER)
            return {'results': [{'kind': 'text', 'text': {'private': PRIVATE_MARKER}}]}
        return original(self, current)

    monkeypatch.setattr(ControlledTransport, 'respond', respond)
    counts = sweep(s, ws, route)
    assert counts['completed'] == 2 and counts['denied'] == counts['deferred'] == 0
    snapshot = durable(context, failed.run.id)
    run, dispatch, events, messages, observations = snapshot
    assert run['state'] == 'partial' and run['used_units'] == 1 and run['lease_expires_at'] is None
    assert dispatch['acknowledged_at'] and dispatch['consumed_at']
    assert [x['operation'] for x in events].count('local_operation_rejected') == 1
    assert not any(x['data']['author_kind'] == 'assistant' for x in messages)
    assert not observations
    assert PRIVATE_MARKER not in json.dumps([run, events, messages, observations])
    detail = s.get_conversation(p, ws, failed.conversation.id)
    assert detail.turns[0].state == 'failed' and not detail.artifact_ids
    assert s.get_run(p, ws, healthy.run.id).state == 'ready'
    assert calls == [failed.run.id, healthy.run.id]
    assert sweep(s, ws, route)['completed'] == 0
    assert GeneralWorker(s, transport=ControlledTransport()).work(p, ws, failed.run.id).state == 'partial'
    assert durable(context, failed.run.id) == snapshot
    assert calls == [failed.run.id, healthy.run.id]


@pytest.mark.parametrize('kind', ['membership', 'generation', 'source_access', 'source', 'cancel', 'lease', 'fence'])
def test_failure_publication_reauthorizes_capability(context, monkeypatch, kind):
    s, p, ws, refs, admin = context
    queued = queue(context, refs=refs[:1])

    def respond(self, current):
        if kind == 'cancel':
            s.cancel_conversation(p, ws, queued.conversation.id,
                                  cmd(CancelConversation, expected_work_version=queued.conversation.work_version))
        else:
            queries = {
                'membership': 'UPDATE memberships SET active=false WHERE workspace_id=%s',
                'generation': 'UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',
                'source_access': 'UPDATE source_access SET active=false WHERE workspace_id=%s',
                'source': "UPDATE sources SET content=content || '{\"drift\":true}' WHERE workspace_id=%s",
                'lease': "UPDATE runs SET data=jsonb_set(data,'{lease_expires_at}',to_jsonb(now()-interval '1 second')) WHERE workspace_id=%s",
                'fence': "UPDATE runs SET data=jsonb_set(data,'{fence}',to_jsonb((data->>'fence')::int+1)) WHERE workspace_id=%s",
            }
            with Database(admin).transaction() as c:
                c.execute(queries[kind], (ws,))
        raise RuntimeError(PRIVATE_MARKER)

    monkeypatch.setattr(ControlledTransport, 'respond', respond)
    with pytest.raises(DomainError) as denied:
        GeneralWorker(s, transport=ControlledTransport()).work(p, ws, queued.run.id)
    import traceback
    assert PRIVATE_MARKER not in ''.join(traceback.format_exception(denied.value))
    run, dispatch, events, messages, observations = durable(context, queued.run.id)
    assert run['state'] == ('cancelled' if kind == 'cancel' else 'running')
    assert run['used_units'] == 0 and not run['unresolved']
    assert not any(x['operation'] == 'local_operation_rejected' for x in events)
    assert not any(x['data']['author_kind'] == 'assistant' for x in messages)
    assert not observations
    if kind != 'cancel':
        assert dispatch['acknowledged_at'] is None and dispatch['consumed_at'] is None


@pytest.mark.parametrize('route', ['direct', 'dispatcher'])
@pytest.mark.parametrize('kind', ['source', 'cancel'])
def test_revoked_at_failure_commit_cannot_publish_or_block_next_turn(context, monkeypatch, route, kind):
    s, p, ws, refs, admin = context
    queued = queue(context, refs=refs[:1])
    healthy = queue(context)
    original_respond = ControlledTransport.respond
    original_fail = s.fail_local_turn

    def respond(self, current):
        if current['run_id'] == queued.run.id:
            raise RuntimeError(PRIVATE_MARKER)
        return original_respond(self, current)

    def revoke_then_fail(cap, reason):
        if kind == 'cancel':
            s.cancel_conversation(p, ws, queued.conversation.id,
                                  cmd(CancelConversation, expected_work_version=queued.conversation.work_version))
        else:
            with Database(admin).transaction() as c:
                c.execute("UPDATE sources SET content=content || '{\"drift\":true}' WHERE workspace_id=%s", (ws,))
        return original_fail(cap, reason)

    monkeypatch.setattr(ControlledTransport, 'respond', respond)
    monkeypatch.setattr(s, 'fail_local_turn', revoke_then_fail)
    counts = sweep(s, ws, route)
    assert counts['completed'] == 1 and counts['denied'] + counts['deferred'] == 1
    assert s.get_run(p, ws, healthy.run.id).state == 'ready'
    run, dispatch, events, messages, observations = durable(context, queued.run.id)
    assert run['state'] == ('cancelled' if kind == 'cancel' else 'running')
    assert run['used_units'] == 0 and not run['unresolved']
    assert not any(x['operation'] == 'local_operation_rejected' for x in events)
    assert not any(x['data']['author_kind'] == 'assistant' for x in messages)
    assert not observations


@pytest.mark.parametrize('route', ['direct', 'dispatcher'])
@pytest.mark.parametrize('publication', ['complete_conversation_turn', 'execute_local_product', 'fail_local_turn', 'recovery_failure'])
def test_commit_then_raise_preserves_exact_durable_result(context, monkeypatch, route, publication):
    s, p, ws, _, _ = context
    queued = queue(context, product=publication not in ('complete_conversation_turn', 'recovery_failure'))
    healthy = queue(context)
    recovery_failure = publication == 'recovery_failure'
    if recovery_failure:
        publication = 'fail_local_turn'
    if publication == 'fail_local_turn':
        original_respond = ControlledTransport.respond

        def invalid(self, current):
            if current['run_id'] == queued.run.id:
                if recovery_failure:
                    raise RuntimeError(PRIVATE_MARKER)
                return {}
            return original_respond(self, current)

        monkeypatch.setattr(ControlledTransport, 'respond', invalid)
    original = getattr(s, publication)
    snapshots = []

    def lost_ack(cap, *args):
        result = original(cap, *args)
        if cap.run_id == queued.run.id:
            snapshots.append(durable(context, queued.run.id))
            raise RuntimeError(PRIVATE_MARKER)
        return result

    monkeypatch.setattr(s, publication, lost_ack)
    assert sweep(s, ws, route)['completed'] == 2
    assert len(snapshots) == 1 and durable(context, queued.run.id) == snapshots[0]
    run, dispatch, events, messages, observations = snapshots[0]
    assert run['state'] == ('partial' if publication == 'fail_local_turn' else 'ready')
    assert run['used_units'] == 1
    assert dispatch['acknowledged_at'] and dispatch['consumed_at']
    assert s.get_run(p, ws, healthy.run.id).state == 'ready'
    assert GeneralWorker(s, transport=ControlledTransport()).work(p, ws, queued.run.id).state == run['state']
    assert durable(context, queued.run.id) == snapshots[0]
    assert sweep(s, ws, route)['completed'] == 0


@pytest.mark.parametrize('route', ['direct', 'dispatcher'])
@pytest.mark.parametrize('crash', [SystemExit, KeyboardInterrupt])
def test_process_control_exceptions_still_escape(context, monkeypatch, route, crash):
    s, _, ws, _, _ = context
    queued = queue(context)
    healthy = queue(context)

    def respond(self, current):
        raise crash()

    monkeypatch.setattr(ControlledTransport, 'respond', respond)
    with pytest.raises(crash):
        sweep(s, ws, route)
    run, dispatch, events, messages, observations = durable(context, queued.run.id)
    assert run['state'] == 'running' and run['used_units'] == 0
    assert dispatch['acknowledged_at'] is None
    assert durable(context, healthy.run.id)[0]['state'] == 'queued'
    assert not any(x['operation'] == 'local_operation_rejected' for x in events)


@pytest.mark.parametrize('route', ['direct', 'dispatcher'])
def test_failure_publication_unavailable_defers_without_stopping_sweep(context, monkeypatch, route):
    s, p, ws, _, _ = context
    queued = queue(context)
    healthy = queue(context)
    original = ControlledTransport.respond
    attempts = []

    def respond(self, current):
        if current['run_id'] == queued.run.id:
            raise RuntimeError(PRIVATE_MARKER)
        return original(self, current)

    def unavailable(cap, reason):
        attempts.append(cap.run_id)
        raise RuntimeError(PRIVATE_MARKER)

    monkeypatch.setattr(ControlledTransport, 'respond', respond)
    monkeypatch.setattr(s, 'fail_local_turn', unavailable)
    counts = sweep(s, ws, route)
    assert counts['completed'] == 1 and counts['deferred'] == 1
    assert attempts == [queued.run.id]
    assert s.get_run(p, ws, healthy.run.id).state == 'ready'
    run, dispatch, events, messages, observations = durable(context, queued.run.id)
    assert run['state'] == 'running' and run['used_units'] == 0
    assert dispatch['acknowledged_at'] is None
    assert not any(x['operation'] == 'local_operation_rejected' for x in events)
