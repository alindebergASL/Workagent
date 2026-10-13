"""Provider-free lifecycle integration: real PostgreSQL, canonical domain events.

No model transport/worker loop. The local product fixture uses the existing
capability-bound deterministic domain operation solely to obtain canonical saved
artifacts and proposals; it is not natural-language selection evidence.
"""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
import time

import psycopg
import pytest
from pydantic import ValidationError

from test_domain import context, cmd, raises
from workagent.db import Database
from workagent.models import (CreateConversation, DelegateConversation, PostMessage, HumanSave,
                              AcceptProposal, CancelConversation, ControlAssignment, now)
from workagent.product_models import ReconcileCSV
from workagent.responsibilities import Responsibilities
from workagent.responsibility_models import (ActivateResponsibility, UpdateResponsibility,
    ControlResponsibility, ResponsibilityDependency, ResponsibilityNextAction,
    ResponsibilityWait, ResponsibilityPlan)
from workagent.service import Service, Principal, encoded


LifecycleService = Service  # Exercise the actual production MRO, not a test-only adapter.


@pytest.fixture
def lifecycle(context):
    s, p, ws, refs, admin = context
    return LifecycleService(s.db), p, ws, refs, admin


def conversation(ctx, refs=()):
    s, p, ws, _, _ = ctx
    return s.create_conversation(p, ws, cmd(CreateConversation, selected_source_refs=list(refs)))


def delegate(ctx, cv, goal='Keep venue preparation current'):
    s, p, ws, _, _ = ctx
    current = s.get_conversation(p, ws, cv.id).conversation
    return s.delegate_conversation(p, ws, cv.id, cmd(DelegateConversation,
        expected_work_version=current.work_version, goal=goal,
        completion_criteria=['Independently verified outcome, not a prepared document']))


def product(ctx, cv, operation=None):
    s, p, ws, _, _ = ctx
    cv = s.get_conversation(p, ws, cv.id).conversation
    operation = operation or ReconcileCSV(kind='reconcile_csv', input_csv=
        'id,quantity,unit_price,reported_total\nA,2,3.00,6.00\n')
    turn = s.post_message(p, ws, cv.id, cmd(PostMessage, expected_work_version=cv.work_version,
        text='Synthetic local calculation fixture, no model selection', operation=operation))
    cap = s.claim_run(p, ws, turn.run.id)
    run = s.execute_local_product(cap, 'reconcile_csv')
    detail = s.get_conversation(p, ws, cv.id)
    result = next(r for r in detail.messages[-1].result.results if r.kind == 'table')
    return s.get_artifact(p, ws, result.artifact_id), run


def plan(artifact=None, **overrides):
    value = dict(current_outcome='Prepared context only; outcome remains unverified.',
        next_action=ResponsibilityNextAction(kind='await_event', description='Review when saved context changes.'),
        dependencies=[] if artifact is None else [ResponsibilityDependency(kind='artifact_revision',
            object_id=artifact.id, expected_version=artifact.current_revision_id)],
        wait=None if artifact is None else ResponsibilityWait(kind='dependency_change', reason='Await a material edit.'))
    value.update(overrides)
    return value


def activate(ctx, a, **values):
    s, p, ws, _, _ = ctx
    return s.activate_responsibility(p, ws, a.id, cmd(ActivateResponsibility,
        expected_work_version=a.work_version, **plan(**values)))


def control(ctx, detail, operation):
    s, p, ws, _, _ = ctx
    return s.control_responsibility(p, ws, detail.assignment.id, cmd(ControlResponsibility,
        expected_work_version=detail.assignment.work_version, operation=operation))


def edit(ctx, artifact, note):
    s, p, ws, _, _ = ctx
    body = artifact.current_revision.body.model_copy(deep=True)
    body.notes.append(note)
    return s.human_save(p, ws, artifact.id, cmd(HumanSave,
        expected_current_revision_id=artifact.current_revision_id, body=body))


def events(s, ws, aid, operation='responsibility_wake'):
    with s.db.transaction() as c:
        return c.execute('SELECT * FROM outbox WHERE workspace_id=%s AND object_id=%s AND operation=%s '
                         'ORDER BY created_at,id', (ws, aid, operation)).fetchall()


def test_two_unrelated_responsibilities_event_pause_restart_and_no_inference(lifecycle):
    s, p, ws, _, _ = lifecycle
    venue, garden = conversation(lifecycle), conversation(lifecycle)
    table, _ = product(lifecycle, venue)
    a = delegate(lifecycle, venue, 'Coordinate venue preparation')
    b = delegate(lifecycle, garden, 'Maintain a rainwater collection decision')
    owned = activate(lifecycle, a, artifact=table)
    separate = activate(lifecycle, b, wait=ResponsibilityWait(kind='person', reason='Choose a tank size.'))
    assert owned.lifecycle.state == 'waiting_event'
    assert separate.lifecycle.state == 'waiting_person'
    paused = control(lifecycle, owned, 'pause')
    saved = edit(lifecycle, table, 'Human: preserve the accessible entrance requirement.')
    fresh = LifecycleService(Database(s.db.dsn))
    current = fresh.get_responsibility(p, ws, a.id)
    assert current.lifecycle.state == 'paused' and current.lifecycle.review_required
    assert current.lifecycle.observations[0].observed_version == saved.current_revision_id
    assert current.lifecycle.wake_status == 'none'
    assert fresh.get_responsibility(p, ws, b.id) == separate
    resumed = control((fresh, *lifecycle[1:]), current, 'resume')
    assert resumed.assignment.id == a.id and resumed.lifecycle.state == 'blocked'
    assert resumed.lifecycle.blocker == 'grant_required'
    assert resumed.local_review_eligible and not resumed.provider_execution_queued
    assert resumed.lifecycle.next_action.kind == 'review_dependency'
    cap = fresh.claim_responsibility_wake(Principal(p.id, 'worker'), ws, a.id, resumed.assignment.work_version)
    restarted = LifecycleService(Database(s.db.dsn))
    result = restarted.review_responsibility_wake(cap)
    assert result.provider_execution_started is False
    assert result.continuation is not None
    assert result.continuation.assignment_id == a.id
    assert result.continuation.wake_id == cap.wake_id
    assert result.continuation.expected_work_version == resumed.assignment.work_version
    assert result.continuation.expected_conversation_work_version == resumed.lifecycle.conversation_work_version
    assert result.continuation.observations[0].observed_version == saved.current_revision_id
    assert result.continuation.execution_admitted is False
    assert result.responsibility.lifecycle.wake_status == 'reviewed'
    assert restarted.review_responsibility_wake(cap) == result  # lost ACK replay
    assert not events(s, ws, a.id)[-1]['consumed_at'] is None
    assert restarted.get_artifact(p, ws, saved.id).current_revision == saved.current_revision
    assert len(restarted.history(p, ws, saved.id).items) == 2
    assert restarted.get_responsibility(p, ws, b.id) == separate
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM assignments WHERE workspace_id=%s', (ws,)).fetchone()['n'] == 2
        assert c.execute('SELECT count(*) AS n FROM provider_attempts WHERE workspace_id=%s', (ws,)).fetchone()['n'] == 0
        assert c.execute('SELECT count(*) AS n FROM runs WHERE workspace_id=%s AND assignment_id IS NOT NULL', (ws,)).fetchone()['n'] == 0
        assert c.execute('SELECT count(*) AS n FROM run_dispatches d JOIN outbox o ON o.id=d.outbox_id '
                         "WHERE o.workspace_id=%s AND o.operation='responsibility_wake'", (ws,)).fetchone()['n'] == 0


def test_human_save_automatically_wakes_only_subscriber_and_dedupes(lifecycle):
    s, p, ws, _, _ = lifecycle
    cv = conversation(lifecycle); table, _ = product(lifecycle, cv)
    a = delegate(lifecycle, cv)
    before = activate(lifecycle, a, artifact=table)
    saved = edit(lifecycle, table, 'Human edited budget.')
    current = s.get_responsibility(p, ws, a.id)
    assert current.assignment.work_version == before.assignment.work_version + 1
    assert current.lifecycle.state == 'blocked' and current.lifecycle.review_required
    assert current.lifecycle.blocker == 'grant_required' and current.local_review_eligible
    assert current.lifecycle.outcome_status == 'needs_review'
    wake = current.lifecycle.wake_id
    for _ in range(2):
        # Duplicate canonical event delivery does not manufacture another change.
        with s.db.transaction() as c:
            s._scope(c, p, ws, write=True)
            s._event(c, p, ws, 'human_save', saved.id)
        assert s.reconcile_responsibility(p, ws, a.id) == current
    assert len(events(s, ws, a.id)) == 1
    assert s.get_responsibility(p, ws, a.id).lifecycle.wake_id == wake
    raises('version_conflict', lambda: s.update_responsibility(p, ws, a.id, cmd(UpdateResponsibility,
        expected_work_version=before.assignment.work_version, **plan(artifact=table))))
    # Acknowledgement must bind the current saved revision, never silently rebase.
    raises('version_conflict', lambda: s.update_responsibility(p, ws, a.id, cmd(UpdateResponsibility,
        expected_work_version=current.assignment.work_version, **plan(artifact=table))))
    acknowledged = s.update_responsibility(p, ws, a.id, cmd(UpdateResponsibility,
        expected_work_version=current.assignment.work_version, **plan(artifact=saved)))
    assert acknowledged.lifecycle.state == 'waiting_event' and not acknowledged.lifecycle.review_required
    assert events(s, ws, a.id)[0]['consumed_at'] is not None
    assert s.get_artifact(p, ws, saved.id).current_revision_id == saved.current_revision_id


def test_replay_cas_noop_and_concurrent_claim(lifecycle):
    s, p, ws, _, _ = lifecycle
    a = delegate(lifecycle, conversation(lifecycle))
    request = cmd(ActivateResponsibility, expected_work_version=a.work_version, **plan())
    with ThreadPoolExecutor(max_workers=3) as pool:
        values = list(pool.map(lambda _: s.activate_responsibility(p, ws, a.id, request), range(3)))
    assert values[0] == values[1] == values[2]
    current = values[0]
    assert len(events(s, ws, a.id)) == 1
    raises('command_conflict', lambda: s.activate_responsibility(p, ws, a.id,
        request.model_copy(update={'current_outcome': 'different'})))
    no_change = cmd(UpdateResponsibility, expected_work_version=current.assignment.work_version, **plan())
    assert s.update_responsibility(p, ws, a.id, no_change) == current
    assert s.update_responsibility(p, ws, a.id, no_change) == current
    assert len(events(s, ws, a.id)) == 1
    worker = Principal(p.id, 'worker')
    cap = s.claim_responsibility_wake(worker, ws, a.id, current.assignment.work_version)
    raises('action_unresolved', lambda: s.claim_responsibility_wake(worker, ws, a.id, current.assignment.work_version))
    raises('not_found_or_not_authorized', lambda: s.review_responsibility_wake(replace(cap, secret='forged')))
    raises('not_found_or_not_authorized', lambda: s.claim_responsibility_wake(p, ws, a.id, current.assignment.work_version))
    # Pause invalidates a live claim, including after a process restart.
    paused = control(lifecycle, current, 'pause')
    raises('not_found_or_not_authorized', lambda: LifecycleService(s.db).review_responsibility_wake(cap))
    resumed = control(lifecycle, paused, 'resume')
    assert resumed.lifecycle.wake_id != cap.wake_id
    with s.db.transaction() as c:
        assert c.execute('SELECT data FROM assignments WHERE workspace_id=%s AND id=%s', (ws, a.id)).fetchone()['data']['goal'] == a.goal


def test_expired_claim_reclaimed_fenced_and_restart_safe(lifecycle):
    s, p, ws, _, admin = lifecycle
    a = delegate(lifecycle, conversation(lifecycle)); current = activate(lifecycle, a)
    worker = Principal(p.id, 'worker')
    old = s.claim_responsibility_wake(worker, ws, a.id, current.assignment.work_version)
    with Database(admin).transaction() as c:
        c.execute("UPDATE assignments SET responsibility_lease=jsonb_set(responsibility_lease,'{expires_at}',%s) "
                  'WHERE workspace_id=%s AND id=%s', (encoded((now()-timedelta(seconds=1)).isoformat()), ws, a.id))
    raises('not_found_or_not_authorized', lambda: s.review_responsibility_wake(old))
    fresh = LifecycleService(Database(s.db.dsn))
    new = fresh.claim_responsibility_wake(worker, ws, a.id, current.assignment.work_version)
    assert new.fence == old.fence + 1 and new.wake_id == old.wake_id
    raises('not_found_or_not_authorized', lambda: fresh.review_responsibility_wake(old))
    receipt = fresh.review_responsibility_wake(new)
    assert receipt.reviewed_wake_id == current.lifecycle.wake_id
    assert len(events(s, ws, a.id, 'responsibility_reviewed')) == 1


@pytest.mark.parametrize('operation,terminal', [('cancel', 'cancelled'), ('takeover', 'taken_over')])
def test_cancel_takeover_terminal_no_resurrection(lifecycle, operation, terminal):
    s, p, ws, _, _ = lifecycle
    cv = conversation(lifecycle); table, _ = product(lifecycle, cv)
    a = delegate(lifecycle, cv); current = activate(lifecycle, a, artifact=table, wait=None)
    cap = s.claim_responsibility_wake(Principal(p.id, 'worker'), ws, a.id, current.assignment.work_version)
    stopped = control(lifecycle, current, operation)
    assert stopped.lifecycle.state == terminal
    saved = edit(lifecycle, table, 'Human retains ownership and final saved edits.')
    assert s.reconcile_responsibility(p, ws, a.id) == stopped
    assert s.get_artifact(p, ws, saved.id).current_revision == saved.current_revision
    raises('not_found_or_not_authorized', lambda: s.review_responsibility_wake(cap))
    raises('unsupported_operation', lambda: control(lifecycle, stopped, 'resume'))
    assert all(x['consumed_at'] is not None for x in events(s, ws, a.id))


def test_check_in_due_once_using_database_restart_and_real_clock(lifecycle):
    s, p, ws, _, _ = lifecycle
    a = delegate(lifecycle, conversation(lifecycle))
    due = now() + timedelta(seconds=1)
    current = activate(lifecycle, a, wait=ResponsibilityWait(kind='check_in', reason='Review once due.'),
                       next_check_in_at=due)
    assert current.lifecycle.state == 'waiting_event' and not current.lifecycle.check_in_due
    # Actual elapsed time, no fabricated tick or human state update.
    worker = Principal(p.id, 'worker')
    assert s.reconcile_due_responsibilities(worker, ws) == []
    time.sleep(1.1)
    assert LifecycleService(s.db).reconcile_due_responsibilities(worker, ws) == [a.id]
    update = s.get_responsibility(p, ws, a.id)
    assert update.lifecycle.check_in_due and update.lifecycle.state == 'blocked'
    assert update.lifecycle.blocker == 'grant_required' and update.local_review_eligible
    assert update.lifecycle.review_required
    assert s.reconcile_due_responsibilities(worker, ws) == []
    for _ in range(3):
        assert LifecycleService(s.db).reconcile_responsibility(p, ws, a.id) == update
    assert len(events(s, ws, a.id)) == 1


@pytest.mark.parametrize('kind,blocker', [('obtain_grant', 'grant_required'), ('obtain_tool', 'tool_required')])
def test_missing_capability_is_blocker_not_loss_of_ownership(lifecycle, kind, blocker):
    s, p, ws, _, _ = lifecycle
    a = delegate(lifecycle, conversation(lifecycle))
    owned = activate(lifecycle, a, next_action=ResponsibilityNextAction(kind=kind, description='Missing execution prerequisite.'))
    assert owned.lifecycle.state == 'blocked' and owned.lifecycle.blocker == blocker
    assert owned.assignment.owner_id == a.owner_id and owned.assignment.id == a.id
    assert owned.lifecycle.execution_status == 'not_admitted'
    assert not owned.local_review_eligible and not events(s, ws, a.id)
    paused = control(lifecycle, owned, 'pause')
    resumed = control(lifecycle, paused, 'resume')
    assert resumed.lifecycle.state == 'blocked' and resumed.lifecycle.blocker == blocker


def test_cross_workspace_conversation_source_and_owner_denials(lifecycle):
    s, p, ws, refs, admin = lifecycle
    cv = conversation(lifecycle); other = conversation(lifecycle)
    table, _ = product(lifecycle, other)
    a = delegate(lifecycle, cv)
    request = cmd(ActivateResponsibility, expected_work_version=a.work_version, **plan(artifact=table))
    raises('not_found_or_not_authorized', lambda: s.activate_responsibility(p, ws, a.id, request))
    source = ResponsibilityDependency(kind='source_version', object_id=refs[0].source_id,
                                      expected_version=refs[0].external_version)
    raises('not_found_or_not_authorized', lambda: activate(lifecycle, a, dependencies=[source]))
    raises('not_found_or_not_authorized', lambda: s.activate_responsibility(p, 'other-workspace', a.id, request))
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,'other-editor','editor')", (ws,))
    raises('not_found_or_not_authorized', lambda: s.activate_responsibility(Principal('other-editor'), ws, a.id,
        cmd(ActivateResponsibility, expected_work_version=a.work_version, **plan())))
    assert not events(s, ws, a.id)


def test_source_version_and_same_version_content_drift_catch_up(lifecycle):
    s, p, ws, refs, admin = lifecycle
    cv = conversation(lifecycle, refs[:1]); a = delegate(lifecycle, cv)
    dep = ResponsibilityDependency(kind='source_version', object_id=refs[0].source_id,
                                   expected_version=refs[0].external_version)
    owned = activate(lifecycle, a, dependencies=[dep],
        wait=ResponsibilityWait(kind='dependency_change', reason='Wait for scoped source update.'))
    with Database(admin).transaction() as c:
        c.execute("UPDATE sources SET content=content || '{\"human_correction\": true}'::jsonb "
                  'WHERE workspace_id=%s AND id=%s', (ws, dep.object_id))
    current = LifecycleService(s.db).reconcile_responsibility(p, ws, a.id)
    assert current.lifecycle.review_required and current.lifecycle.state == 'blocked'
    assert current.lifecycle.blocker == 'grant_required' and current.local_review_eligible
    assert current.lifecycle.observations[0].content_hash != owned.lifecycle.observations[0].content_hash
    assert current.lifecycle.observations[0].observed_version == dep.expected_version
    assert s.reconcile_responsibility(p, ws, a.id) == current
    with Database(admin).transaction() as c:
        c.execute("UPDATE sources SET data=jsonb_set(data,'{external_version}','\"version-new\"') "
                  'WHERE workspace_id=%s AND id=%s', (ws, dep.object_id))
    changed = s.reconcile_responsibility(p, ws, a.id)
    assert changed.lifecycle.observations[0].changed
    assert changed.lifecycle.observations[0].observed_version == 'version-new'
    assert changed.assignment.work_version == current.assignment.work_version + 1


def test_revocation_denies_read_command_replay_and_review(lifecycle):
    s, p, ws, refs, admin = lifecycle
    a = delegate(lifecycle, conversation(lifecycle, refs[:1]))
    request = cmd(ActivateResponsibility, expected_work_version=a.work_version, **plan())
    owned = s.activate_responsibility(p, ws, a.id, request)
    cap = s.claim_responsibility_wake(Principal(p.id, 'worker'), ws, a.id, owned.assignment.work_version)
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s', (ws,))
    for action in [lambda: s.get_responsibility(p, ws, a.id),
                   lambda: s.activate_responsibility(p, ws, a.id, request),
                   lambda: s.review_responsibility_wake(cap),
                   lambda: s.reconcile_responsibility(p, ws, a.id)]:
        raises('not_found_or_not_authorized', action)


def test_conversation_steering_and_cancel_invalidate_claim(lifecycle):
    s, p, ws, _, _ = lifecycle
    cv = conversation(lifecycle); a = delegate(lifecycle, cv); owned = activate(lifecycle, a)
    cap = s.claim_responsibility_wake(Principal(p.id, 'worker'), ws, a.id, owned.assignment.work_version)
    cv = s.get_conversation(p, ws, cv.id).conversation
    # A normal no-model queued conversation turn is steering, not lifecycle execution.
    queued = s.post_message(p, ws, cv.id, cmd(PostMessage, expected_work_version=cv.work_version,
        text='Human: the event must be accessible.'))
    updated = s.get_responsibility(p, ws, a.id)
    assert updated.lifecycle.review_required and updated.assignment.work_version > owned.assignment.work_version
    raises('not_found_or_not_authorized', lambda: s.review_responsibility_wake(cap))
    s.cancel_conversation(p, ws, cv.id, cmd(CancelConversation,
        expected_work_version=queued.conversation.work_version))
    blocked = s.get_responsibility(p, ws, a.id)
    assert blocked.lifecycle.state == 'blocked' and blocked.lifecycle.blocker == 'conversation_closed'
    assert blocked.lifecycle.wake_status == 'none'


def test_prepared_and_approved_products_never_complete_responsibility(lifecycle):
    s, p, ws, _, _ = lifecycle
    cv = conversation(lifecycle); table, run = product(lifecycle, cv)
    assert run.state == 'ready'
    a = delegate(lifecycle, cv); owned = activate(lifecycle, a, artifact=table)
    assert owned.lifecycle.outcome_status == 'unverified'
    operation = ReconcileCSV(kind='reconcile_csv', artifact_id=table.id,
                             base_revision_id=table.current_revision_id, rounding='ROUND_HALF_EVEN')
    _, run = product(lifecycle, cv, operation)
    proposal = s.proposals(p, ws, table.id).items[0]
    assert proposal.status == 'pending'
    prepared = s.get_responsibility(p, ws, a.id)
    assert prepared.lifecycle.outcome_status != 'completed'
    approved = s.accept_proposal(p, ws, proposal.id, cmd(AcceptProposal,
        expected_current_revision_id=table.current_revision_id))
    current = s.get_responsibility(p, ws, a.id)
    assert current.lifecycle.observations[0].observed_version == approved.current_revision_id
    assert current.lifecycle.review_required and current.lifecycle.outcome_status == 'needs_review'
    assert current.lifecycle.execution_status == 'not_admitted'
    with pytest.raises(ValidationError):
        ControlResponsibility(**cmd(ControlResponsibility, expected_work_version=current.assignment.work_version,
                                     operation='pause').model_dump(exclude={'operation'}), operation='complete')


def test_old_handover_and_intake_are_not_silently_opted_in(lifecycle):
    s, p, ws, refs, _ = lifecycle
    a = delegate(lifecycle, conversation(lifecycle))
    raises('unsupported_operation', lambda: s.get_responsibility(p, ws, a.id))
    raises('unsupported_operation', lambda: s.control_assignment(p, ws, a.id,
        cmd(ControlAssignment, expected_work_version=a.work_version, operation='resume')))
    from workagent.models import CreateAssignment
    intake = s.create_assignment(p, ws, cmd(CreateAssignment, goal='Legacy intake',
        completion_criteria=['Historical plan'], selected_source_refs=refs))
    raises('unsupported_operation', lambda: activate(lifecycle, intake.assignment))
    with s.db.transaction() as c:
        assert c.execute('SELECT responsibility_lifecycle FROM assignments WHERE workspace_id=%s AND id=%s',
                         (ws, intake.assignment.id)).fetchone()['responsibility_lifecycle'] is None
    owned = activate(lifecycle, a)
    paused = s.control_assignment(p, ws, a.id, cmd(ControlAssignment,
        expected_work_version=owned.assignment.work_version, operation='pause'))
    assert s.get_responsibility(p, ws, a.id).lifecycle.state == 'paused'
    assert paused.work_version == owned.assignment.work_version + 1


def test_sql_shape_rejects_invalid_lifecycle_without_weakening_existing_storage(lifecycle):
    s, p, ws, _, _ = lifecycle
    a = delegate(lifecycle, conversation(lifecycle))
    with pytest.raises(psycopg.errors.CheckViolation):
        with s.db.transaction() as c:
            c.execute("UPDATE assignments SET responsibility_lifecycle='{}'::jsonb WHERE workspace_id=%s AND id=%s", (ws, a.id))
    with pytest.raises(ValidationError):
        ResponsibilityPlan(**plan(wait=ResponsibilityWait(kind='check_in', reason='No time provided.')))
    with pytest.raises(ValidationError):
        ResponsibilityPlan(**plan(wait=ResponsibilityWait(kind='dependency_change', reason='No reference.')))


def test_continue_work_without_installed_grant_is_blocked_not_execution(lifecycle):
    s, p, ws, _, _ = lifecycle
    a = delegate(lifecycle, conversation(lifecycle))
    owned = activate(lifecycle, a, next_action=ResponsibilityNextAction(
        kind='continue_work', description='Continue only after scoped admission.'))
    assert owned.lifecycle.state == 'blocked'
    assert owned.lifecycle.blocker == 'grant_required'
    assert not owned.provider_execution_queued
    assert owned.assignment.id == a.id and owned.assignment.owner_id == p.id
    assert owned.lifecycle.execution_status == 'not_admitted'
    assert not events(s, ws, a.id)


def test_concurrent_cas_steering_has_one_winner(lifecycle):
    s, p, ws, _, _ = lifecycle
    a = delegate(lifecycle, conversation(lifecycle)); owned = activate(lifecycle, a)
    from workagent.errors import DomainError
    def steer(index):
        try:
            return s.update_responsibility(p, ws, a.id, cmd(UpdateResponsibility,
                expected_work_version=owned.assignment.work_version,
                **plan(current_outcome=f'Human plan revision {index}')))
        except DomainError as exc:
            return exc.code.value
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(steer, range(2)))
    assert result.count('version_conflict') == 1
    winner = next(r for r in result if not isinstance(r, str))
    assert s.get_responsibility(p, ws, a.id) == winner
    assert len([r for r in events(s, ws, a.id) if r['consumed_at'] is None]) == 1


def test_stale_ack_refused_and_claim_commits_missed_event_catchup(lifecycle):
    s, p, ws, refs, admin = lifecycle
    a = delegate(lifecycle, conversation(lifecycle, refs[:1]))
    dep = ResponsibilityDependency(kind='source_version', object_id=refs[0].source_id,
                                    expected_version=refs[0].external_version)
    owned = activate(lifecycle, a, dependencies=[dep])
    worker = Principal(p.id, 'worker')
    cap = s.claim_responsibility_wake(worker, ws, a.id, owned.assignment.work_version)
    s.review_responsibility_wake(cap)
    with Database(admin).transaction() as c:
        c.execute("UPDATE sources SET content=content || '{\"late_correction\": true}'::jsonb "
                  'WHERE workspace_id=%s AND id=%s', (ws, dep.object_id))
    raises('version_conflict', lambda: s.review_responsibility_wake(cap))
    raises('version_conflict', lambda: s.claim_responsibility_wake(worker, ws, a.id, owned.assignment.work_version))
    current = LifecycleService(s.db).get_responsibility(p, ws, a.id)
    assert current.assignment.work_version == owned.assignment.work_version + 1
    assert current.lifecycle.review_required and current.local_review_eligible
    assert current.lifecycle.wake_id != cap.wake_id
    new_cap = s.claim_responsibility_wake(worker, ws, a.id, current.assignment.work_version)
    assert s.review_responsibility_wake(new_cap).continuation.assignment_id == a.id
