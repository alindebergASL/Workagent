"""Independent review regressions; real isolated PostgreSQL, controlled HTTP only."""
from pathlib import Path

import pytest

from test_domain import context, cmd, raises
from test_general_alpha_runtime import launch, calculate
from test_general_responses import worker
from test_responsibilities import conversation, delegate, activate
from test_runtime import expire
from workagent.db import Database
from workagent.models import ControlAssignment, new_id
from workagent.service import Service, digest


@pytest.mark.parametrize('module', ['responsibilities.py', 'responsibility_models.py'])
@pytest.mark.parametrize('profile', ['alpha', 'legacy'])
def test_lifecycle_byte_drift_rejects_admitted_pin_before_transport(context, tmp_path, monkeypatch, module, profile):
    s, p, ws, _, _ = context
    assert Service._event.__module__ == 'workagent.responsibilities'
    if profile == 'alpha':
        from workagent.general_responses import consumer_hash
        _, grant, queued, fake, runtime = launch(context, tmp_path, [{'kind': 'reply', 'text': 'Hello'}])
        run = lambda: runtime.work(p, ws, queued.run.id)
    else:
        from test_responses_worker import setup
        from workagent.responses_worker import consumer_hash
        grant, queued, fake, runtime = setup(context, tmp_path)
        run = lambda: runtime.run(ws, queued.run.id)
    assert consumer_hash() == grant.consumer_sha256
    original = Path.read_bytes
    def changed_bytes(path):
        material = original(path)
        return material + b'\n# lifecycle implementation changed\n' if path.name == module else material
    monkeypatch.setattr(Path, 'read_bytes', changed_bytes)
    # Prove the worker itself fails closed, not just the pure hash function.
    from workagent.errors import DomainError
    from workagent.runtime_config import BundleDenied
    with pytest.raises((DomainError, BundleDenied)):
        run()
    assert fake.calls == []
    assert consumer_hash() != grant.consumer_sha256
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s', (ws,)).fetchone()['n'] == 0


@pytest.mark.parametrize('outcome', ['blocked', 'waiting_for_user', 'needs_validation'])
@pytest.mark.parametrize('character', ['x', '界'])
def test_boundary_publication_restart_and_exact_sql(context, tmp_path, outcome, character):
    s, p, ws, _, _ = context
    full = character * 10000
    stop = outcome != 'needs_validation'
    selected = {'kind': 'stop', 'outcome': outcome, 'text': full} if stop else calculate
    cv, grant, queued, fake, runtime = launch(context, tmp_path, [selected], explanation=full)
    def crash(point):
        if point == 'before_publication':
            raise RuntimeError('controlled restart before publication')
    runtime.phases.hook = crash
    with pytest.raises(RuntimeError, match='controlled restart'):
        runtime.work(p, ws, queued.run.id)
    before = list(fake.calls)
    with s.db.transaction() as c:
        rows = c.execute('SELECT e.phase,e.kind,e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.phase,e.kind', (queued.run.id,)).fetchall()
        stage = next(r['data'] for r in rows if r['kind'] == 'tool_result')
        final = next(r['data'] for r in rows if r['phase'] == 'final' and r['kind'] == 'result')
        if stop:
            assert stage['decision']['text'] == full
            assert stage['reason'].endswith(full)
        assert final['value']['text'] == full
    expire(context, queued.run.id)
    fresh = Service(Database(s.db.dsn))
    fresh_context = (fresh, *context[1:])
    assert worker(fresh_context, fake, tmp_path).work(p, ws, queued.run.id).state == 'partial'
    detail = fresh.get_conversation(p, ws, cv.id)
    display = detail.messages[-1].text
    assert len(display) == 10000
    assert detail.turns[0].adaptive.outcome == outcome
    assert detail.turns[0].explanation.text == full
    assert not detail.turns[0].adaptive.steps[0].verification.satisfied
    if stop:
        assert display.startswith(f'Execution stopped ({outcome}); the requested goal is not verified. ')
        assert 'Stop display shortened' in display
        assert detail.turns[0].adaptive.steps[0].reason.endswith(full)
    else:
        assert 'Explanation shortened' in display
        assert '\n\nExecution status: ' in display
        assert display.endswith(stage['reason'])
    with s.db.transaction() as c:
        config = c.execute('SELECT data FROM run_configurations WHERE run_id=%s', (queued.run.id,)).fetchone()['data']
        from workagent.service import encoded
        sql_text = c.execute('SELECT general_publication_text(%s,%s,%s) AS text', (encoded(stage), encoded(final), encoded(config))).fetchone()['text']
        assert sql_text == display
        assert c.execute('SELECT e.phase,e.kind,e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.phase,e.kind', (queued.run.id,)).fetchall() == rows
    assert worker(fresh_context, fake, tmp_path).work(p, ws, queued.run.id).state == 'partial'
    assert Service(Database(s.db.dsn)).get_conversation(p, ws, cv.id).messages == detail.messages
    assert fake.calls == before


@pytest.mark.parametrize('revocation', ['membership', 'source'])
def test_legacy_pause_receipt_survives_activation_with_current_authority(context, revocation):
    s, p, ws, refs, admin = context
    cv = conversation(context, refs[:1])
    assignment = delegate(context, cv)
    request = cmd(ControlAssignment, expected_work_version=assignment.work_version, operation='pause')
    paused = s.control_assignment(p, ws, assignment.id, request)
    assert s.control_assignment(p, ws, assignment.id, request) == paused
    active = activate(context, paused)
    fresh = Service(Database(s.db.dsn))
    # Changed request IDs do not change durable command identity.
    retry = request.model_copy(update={'request_id': new_id()})
    assert fresh.control_assignment(p, ws, assignment.id, retry) == paused
    assert fresh.get_responsibility(p, ws, assignment.id) == active
    raises('command_conflict', lambda: fresh.control_assignment(p, ws, assignment.id,
        request.model_copy(update={'operation': 'cancel'})))
    with Database(admin).transaction() as c:
        if revocation == 'membership':
            c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s', (ws,))
        else:
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s', (ws,))
    raises('not_found_or_not_authorized', lambda: fresh.control_assignment(p, ws, assignment.id, retry))


def test_new_legacy_control_after_activation_keeps_assignment_namespace(context):
    s, p, ws, _, _ = context
    assignment = delegate(context, conversation(context))
    active = activate(context, assignment)
    request = cmd(ControlAssignment, expected_work_version=active.assignment.work_version, operation='pause')
    paused = s.control_assignment(p, ws, assignment.id, request)
    assert s.get_responsibility(p, ws, assignment.id).lifecycle.state == 'paused'
    assert s.control_assignment(p, ws, assignment.id, request) == paused
    with s.db.transaction() as c:
        row = c.execute('SELECT payload_hash,result FROM commands WHERE command_id=%s', (request.command_id,)).fetchone()
        assert row['payload_hash'] == digest({'operation': 'control_assignment', 'arguments': {'assignment_id': assignment.id},
            'payload': request.model_dump(mode='json', exclude={'request_id', 'command_id'})})
        assert row['result'] == paused.model_dump(mode='json')


@pytest.mark.parametrize('length', [9999, 10000, 10001, 10074])
@pytest.mark.parametrize('outcome', ['blocked', 'waiting_for_user', 'step_limit', 'budget_limit'])
def test_stop_display_boundary_sql_parity_and_legacy_unchanged(context, length, outcome):
    from workagent.composition import publication_text
    from workagent.service import encoded
    s, _, _, _, _ = context
    reason = 'Status: ' + '界' * (length - len('Status: '))
    stage = {'terminal_outcome': outcome, 'reason': reason}
    final = {'value': {'text': 'Model prose is not trusted status.'}}
    alpha = {'responses': {'runtime_extension': 'general-alpha-v1', 'policy_version': 'adaptive-local-v1'}}
    display = publication_text(stage, final['value']['text'])
    assert len(display) == min(length, 10000)
    if length <= 10000:
        assert display == reason
    else:
        assert display.startswith('Status: ')
        assert display.endswith('\n[Stop display shortened; full stop text is retained in turn details.]')
    with s.db.transaction() as c:
        def sql_text(config):
            return c.execute('SELECT general_publication_text(%s,%s,%s) AS text',
                (encoded(stage), encoded(final), encoded(config))).fetchone()['text']
        assert sql_text(alpha) == display
        # Non-alpha branches are byte-for-byte legacy policy, including budget_limit.
        assert sql_text({'responses': {'policy_version': 'adaptive-local-v1'}}) == (
            final['value']['text'] if outcome == 'budget_limit' else reason)
        assert sql_text({'responses': {}}) == final['value']['text']


def test_sql_publication_guard_rejects_noncanonical_shortening(context, tmp_path, monkeypatch):
    import psycopg
    import workagent.composition as composition
    s, p, ws, _, _ = context
    cv, _, queued, fake, runtime = launch(context, tmp_path,
        [{'kind': 'stop', 'outcome': 'blocked', 'text': 'x' * 10000}])
    original = composition.publication_text
    monkeypatch.setattr(composition, 'publication_text', lambda stage, generated: 'Fabricated completion')
    with pytest.raises(psycopg.errors.RaiseException):
        runtime.work(p, ws, queued.run.id)
    assert len(s.get_conversation(p, ws, cv.id).messages) == 1
    before = list(fake.calls)
    monkeypatch.setattr(composition, 'publication_text', original)
    expire(context, queued.run.id)
    assert worker((Service(Database(s.db.dsn)), *context[1:]), fake, tmp_path).work(p, ws, queued.run.id).state == 'partial'
    assert fake.calls == before
