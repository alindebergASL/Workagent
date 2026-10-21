"""Synthetic HTTP + disposable PostgreSQL; not model judgment or UI evidence.

Only scheduler time advances. Stored requests/receipts are never rewritten.
"""
from datetime import timedelta
from unittest.mock import patch

from test_domain import context, cmd
from test_adaptive_execution import finish_safe_visits
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import target, totals, worker
from test_responsibility_execution import admitted, dispatch, edit
from test_responsibility_resume import control
from test_runtime import expire
from test_sustained_continuity import Interrupted, advance, draft, setup
from workagent.db import Database
from workagent.models import HumanSave, ProviderGrant, new_id, now
from workagent.provider_attempts import configure_grant
from workagent.responsibility_models import ResponsibilityPlan, UpdateResponsibility
from workagent.service import Service


def test_repeated_due_ownership_restart_steering_pause_and_review(context, tmp_path, monkeypatch):
    s, p, ws, _, admin = context
    clock = [now()]
    monkeypatch.setattr('workagent.responsibilities.now', lambda: clock[0])
    # Construct both fixtures before installing one shared synthetic grant.
    # Only grant construction is deferred; both lifecycles use real commands.
    with patch('test_general_alpha_runtime.configure_grant', side_effect=lambda db, g: g):
        first = setup(context)
        second = setup(context)
    data = first[3].model_dump(mode='json')
    data['id'] = new_id()
    data['responses']['conversation_ids'] = [first[0].id, second[0].id]
    grant = configure_grant(Database(admin), ProviderGrant.model_validate(data))
    lanes = []
    for name, created in zip(('VENUE', 'GARDEN'), (first, second)):
        cv, art, assignment, _, _ = created
        saved = edit(context, art, name + '_HUMAN_ORIGINAL')
        lanes.append(dict(name=name, cv=cv, art=art, assignment=assignment,
                          saved=saved, runs=[], review=False,
                          instruction=None, proposal_target=None))

    def lane_for(ctx):
        return next(x for x in lanes if x['assignment'].id == ctx['responsibility']['assignment_id'])

    def make_provider():
        def prepare(ctx):
            lane = lane_for(ctx)
            binding = ctx['responsibility']
            assert binding['conversation_id'] == lane['cv'].id
            expected_dependencies = {lane['art'].id}
            if lane['proposal_target'] is not None:
                expected_dependencies.add(lane['proposal_target'].id)
            assert {d['binding']['object_id'] for d in ctx['dependencies']} == expected_dependencies
            assert {r['run_id'] for r in ctx['durable_work']['prior_results']} == set(lane['runs'])
            observed = next(d for d in ctx['dependencies'] if d['binding']['object_id'] == lane['art'].id)
            assert observed['content']['notes'] == lane['saved'].current_revision.body.notes
            assert observed['binding']['observed_version'] == lane['saved'].current_revision_id
            if lane['instruction']:
                assert binding['next_action']['description'] == lane['instruction']
            if lane['proposal_target'] is not None:
                saved = lane['proposal_target']
                body = saved.current_revision.body.model_dump(mode='json')
                body['title'] = 'Proposed garden review; awaiting human decision'
                return dict(kind='publish_artifact', target=target(saved).model_dump(mode='json'), body=body)
            result = draft(lane['name'] + ' preparation ' + ctx['run_id'])
            result['body']['blocks'][0]['text'] = observed['content']['notes'][0]
            return result

        def next_plan(ctx):
            lane = lane_for(ctx)
            decision = advance(ctx)
            decision['plan']['next_check_in_at'] = (clock[0] + timedelta(hours=1)).isoformat()
            if lane['review']:
                decision['plan'].update(
                    current_outcome='A proposed revision needs the human decision; saved work is unchanged.',
                    next_action=dict(kind='request_decision', description='Review the pending proposal.'),
                    wait=dict(kind='person', reason='The person owns acceptance of this revision.'),
                    next_check_in_at=None)
            return decision
        return AlphaProvider([prepare, next_plan, dict(kind='reply', text='Preparation retained; follow the saved next action.')])

    def assert_idle():
        fake = make_provider()
        fresh = (Service(s.db), *context[1:])
        before = [s.get_conversation(p, ws, lane['cv'].id) for lane in lanes]
        rows, budget = admitted(s, ws), totals(s, grant)
        d, _, _ = dispatch(fresh, tmp_path, grant, fake)
        for _ in range(3):
            d.once()
        if fake.failures:
            raise fake.failures[0]
        assert not fake.calls and totals(s, grant) == budget
        assert admitted(s, ws) == rows
        assert [s.get_conversation(p, ws, lane['cv'].id) for lane in lanes] == before

    def run_wave(expected_lanes, *, interrupt_lane=None):
        fresh = (Service(s.db), *context[1:])
        fake = make_provider()
        d, fake, w = dispatch(fresh, tmp_path, grant, fake)
        previous = {r['run_id'] for r in admitted(s, ws)}
        if interrupt_lane is not None:
            def crash(name):
                if name == 'before_publication' and lane_for(fake.contexts[-1]) is interrupt_lane:
                    raise Interrupted()
            w.phases.hook = crash
        interrupted = False
        try:
            d.once()
            for row in admitted(s, ws):
                if row['run_id'] not in previous:
                    finish_safe_visits(fresh, w, row['run_id'])
        except Interrupted:
            interrupted = True
        if fake.failures:
            raise fake.failures[0]
        new = [r for r in admitted(s, ws) if r['run_id'] not in previous]
        assert {r['config']['responsibility']['assignment_id'] for r in new} == {
            lane['assignment'].id for lane in expected_lanes}
        assert len(new) == len(expected_lanes)
        assert interrupted == (interrupt_lane is not None)
        if interrupted:
            row = next(r for r in new if r['config']['responsibility']['assignment_id'] == interrupt_lane['assignment'].id)
            rid = row['run_id']
            attempt = s.get_provider_attempt(p, ws, rid)
            calls = list(fake.calls)
            with s.db.transaction() as c:
                requests = c.execute('SELECT phase,request_bytes FROM responses_steps '
                    'WHERE attempt_id=%s ORDER BY phase', (attempt.id,)).fetchall()
            expire(fresh, rid)  # Fully observed synthetic lease, not unknown I/O.
            w = worker((Service(s.db), *context[1:]), fake, tmp_path)
            assert finish_safe_visits(fresh, w, rid).state == 'ready'
            assert s.get_provider_attempt(p, ws, rid).id == attempt.id
            assert fake.calls == calls
            with s.db.transaction() as c:
                assert c.execute('SELECT phase,request_bytes FROM responses_steps '
                    'WHERE attempt_id=%s ORDER BY phase', (attempt.id,)).fetchall() == requests
        for row in new:
            lane = next(x for x in expected_lanes if x['assignment'].id == row['config']['responsibility']['assignment_id'])
            rid = row['run_id']
            assert finish_safe_visits(fresh, w, rid).state == 'ready'
            lane['runs'].append(rid)
            state = s.get_responsibility(p, ws, lane['assignment'].id)
            assert state.lifecycle.outcome_status == 'evidenced_preparation'
            assert state.lifecycle.outcome_evidence['run_id'] == rid
            assert len(state.lifecycle.outcome_evidence['evidence']) == 1
            assert state.lifecycle.state == ('waiting_person' if lane['review'] else 'waiting_event')
            assert state.lifecycle.wait.kind == ('person' if lane['review'] else 'check_in')
            if not lane['review']:
                assert state.lifecycle.next_action.kind == 'continue_work'
                assert state.lifecycle.next_check_in_at > clock[0]
                assert not state.lifecycle.review_required
            assert s.get_artifact(p, ws, lane['art'].id).current_revision == lane['saved'].current_revision
        assert_idle()

    venue, garden = lanes
    run_wave(lanes)
    venue['saved'] = edit(context, venue['art'], 'VENUE_HUMAN_CHANGED: printed copies only')
    venue['instruction'] = 'Use printed copies only; preserve my saved notes.'
    current = s.get_responsibility(p, ws, venue['assignment'].id)
    plan = current.lifecycle.model_dump(include=set(ResponsibilityPlan.model_fields))
    plan['next_action'] = dict(kind='continue_work', description=venue['instruction'])
    for dependency in plan['dependencies']:
        if dependency['object_id'] == venue['art'].id:
            dependency['expected_version'] = venue['saved'].current_revision_id
    s.update_responsibility(p, ws, venue['assignment'].id, cmd(UpdateResponsibility,
        expected_work_version=current.assignment.work_version, **plan))
    assert_idle()
    assert len(admitted(s, ws)) == 2
    clock[0] += timedelta(hours=1, seconds=1)
    run_wave(lanes, interrupt_lane=garden)
    control(context, venue['assignment'].id, 'pause')
    paused = s.get_responsibility(p, ws, venue['assignment'].id)
    garden_state = s.get_responsibility(p, ws, garden['assignment'].id)
    document = s.get_artifact(p, ws, garden_state.assignment.artifact_ids[0])
    body = document.current_revision.body.model_dump(mode='json')
    body['blocks'].append(dict(block_id='human', kind='protected_note', text='Keep my garden contribution exactly.', checked=None))
    saved_document = s.human_save(p, ws, document.id, cmd(HumanSave,
        expected_current_revision_id=document.current_revision_id, body=body))
    garden['proposal_target'] = saved_document
    garden['review'] = True
    current = s.get_responsibility(p, ws, garden['assignment'].id)
    plan = current.lifecycle.model_dump(include=set(ResponsibilityPlan.model_fields))
    plan['dependencies'].append(dict(kind='artifact_revision', object_id=document.id,
                                     expected_version=saved_document.current_revision_id))
    s.update_responsibility(p, ws, garden['assignment'].id, cmd(UpdateResponsibility,
        expected_work_version=current.assignment.work_version, **plan))
    clock[0] += timedelta(hours=1, seconds=1)
    run_wave([garden])
    assert len(venue['runs']) == 2 and len(garden['runs']) == 3
    assert len(admitted(s, ws)) == 5
    assert s.get_artifact(p, ws, document.id).current_revision == saved_document.current_revision
    proposals = s.proposals(p, ws, document.id).items
    assert len(proposals) == 1 and proposals[0].status == 'pending'
    assert proposals[0].base_revision_id == saved_document.current_revision_id
    assert proposals[0].body.blocks == saved_document.current_revision.body.blocks
    clock[0] += timedelta(days=1)
    assert_idle()
    held = s.get_responsibility(p, ws, venue['assignment'].id)
    assert held.lifecycle.state == 'paused'
    # Due-time reconciliation can advance the projection/CAS version while
    # paused. It must not change the saved plan or admit another execution.
    assert held.lifecycle.check_in_due
    assert held.lifecycle.next_action == paused.lifecycle.next_action
    assert held.lifecycle.wait == paused.lifecycle.wait
    assert held.lifecycle.next_check_in_at == paused.lifecycle.next_check_in_at
    assert s.get_responsibility(p, ws, garden['assignment'].id).lifecycle.state == 'waiting_person'
    assert len(admitted(s, ws)) == 5
    assert s.proposals(p, ws, document.id).items == proposals
    assert s.get_artifact(p, ws, document.id).current_revision == saved_document.current_revision
