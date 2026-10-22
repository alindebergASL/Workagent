"""New Home draft -> discovery -> exact ownership in one ordinary human turn.

Real GeneralWorker and current Service API, controlled AlphaProvider HTTP, and
disposable PostgreSQL only. No pre-saved artifact, direct draft publication,
invented dependency, proposal acceptance, live provider, or receipt rewriting.
The initial regression was RED on the parent runtime. Its same-turn assertions
remain unchanged. Assertions about missing capabilities happen after settlement,
outside HTTP callbacks, so assertion errors cannot masquerade as unknown sends.
"""
import copy
from datetime import timedelta
from unittest.mock import patch

import pytest

from test_adaptive_execution import finish_safe_visits
from test_conversations import conversation, post
from test_domain import context, cmd
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import target, totals, worker
from test_sustained_continuity import activate, draft
from workagent.models import HumanSave, StandingResponsesBinding, now


def activate_home(ctx, cv, *, max_steps):
    """Synthetic standing authority; no prelisted conversation or forced action."""
    def standing_binding(**kwargs):
        return StandingResponsesBinding(**(kwargs | {'conversation_ids': []}))

    with patch('test_general_alpha_runtime.GeneralAlphaResponsesBinding', standing_binding):
        return activate(ctx, cv, max_steps=max_steps, admission_policy='principal-workspace-v1')


@pytest.mark.parametrize('read_work_area', [False, True], ids=['discover', 'context-then-discover'])
def test_new_home_draft_is_discoverable_and_bindable_in_same_turn(context, tmp_path, read_work_area):
    s, p, ws, _, _ = context
    cv = conversation(context)
    grant = activate_home(context, cv, max_steps=5)
    assert not s.get_conversation(p, ws, cv.id).artifact_ids
    assert not s.get_conversation(p, ws, cv.id).assignment_ids
    request = post(context, cv,
        'Draft an editable equipment handoff document and own a check-in tomorrow '
        'bound to that document. Preserve later human edits; do not send anything.')
    selected_draft = draft('Equipment handoff')
    observed = {}

    def discover(ctx):
        observed['before_discovery'] = copy.deepcopy(ctx)
        return {'kind': 'discover_saved_work', 'after_artifact_id': None, 'limit': 12}

    def bind_if_offered(ctx):
        observed['binding_context'] = copy.deepcopy(ctx)
        page = ctx['adaptive']['observations'][-1]['capability_result']['result']
        observed['page'] = copy.deepcopy(page)
        items = page['items']
        offered = ctx['responsibility_offer']['dependencies']
        matching = [dep for dep in offered if dep['kind'] == 'artifact_revision'
                    and any(dep['object_id'] == item['target']['artifact_id']
                            and dep['expected_version'] == item['target']['revision_id']
                            for item in items)]
        if len(items) != 1 or len(matching) != 1:
            # Settle through the ordinary worker. Never fill the gap by making up
            # a target, manually saving the draft, or recording dependencies=[].
            return {'kind': 'reply', 'text':
                    'The draft has no discoverable, offered document dependency yet.'}
        observed['selected_dependency'] = copy.deepcopy(matching[0])
        return {'kind': 'record_responsibility',
                'goal': 'Keep the equipment handoff document current',
                'completion_criteria': ['A human confirms the handoff is complete'],
                'plan': {'current_outcome': 'Prepared the initial editable document.',
                         'next_action': {'kind': 'review_dependency',
                                         'description': 'Review the bound document and preserve human edits.'},
                         'dependencies': matching,
                         'wait': {'kind': 'check_in', 'reason': 'Check the document tomorrow.'},
                         'next_check_in_at': (now() + timedelta(days=1)).isoformat()}}

    decisions = [selected_draft]
    if read_work_area:
        decisions.append({'kind': 'read_context', 'section': 'work_area'})
    decisions.extend([discover, bind_if_offered,
                      {'kind': 'reply', 'text': 'Prepared the document and recorded its local check-in.'}])
    provider = AlphaProvider(decisions, explanation='Local preparation only; no external effects.')
    result = finish_safe_visits(context, worker(context, provider, tmp_path), request.run.id)
    assert result.state in ('ready', 'partial')
    detail = s.get_conversation(p, ws, cv.id)
    assert len(detail.artifact_ids) == 1
    artifact = s.get_artifact(p, ws, detail.artifact_ids[0])
    assert artifact.current_revision.body.title == selected_draft['body']['title']
    before = observed['before_discovery']
    retained = before['adaptive']['observations'][0]
    assert before['run_id'] == observed['binding_context']['run_id'] == request.run.id
    assert retained['status'] == 'observed'
    assert retained['output']['kind'] == 'artifact_draft'
    assert retained['body'] == selected_draft['body']
    assert retained['decision']['target'] is None
    mapping = before['published_preparations']
    assert len(mapping) == 1 and mapping[0]['phase'] == 'selection'
    assert mapping[0]['binding'] == retained['binding']
    assert mapping[0]['artifact_id'] == artifact.id
    assert mapping[0]['revision_id'] == artifact.current_revision_id
    assert mapping[0]['goal_status'] == 'needs_validation'
    if read_work_area:
        read = before['adaptive']['observations'][1]['capability_result']['result']['value']
        assert [a['artifact_id'] for a in read['artifacts']] == [artifact.id]
    # Expected RED: the actual worker retained a new draft in selection, but the
    # subsequent real discovery receipt contains items=[] until final publication.
    assert len(observed['page']['items']) == 1, (
        'Same-turn draft/discovery gap: retained publish_artifact(target=None), '
        f"but discover_saved_work returned {observed['page']!r}; "
        f"dependency offer={observed['binding_context']['responsibility_offer']!r}")
    assert observed['page']['items'][0]['target'] == target(artifact).model_dump(mode='json')
    assert 'selected_dependency' in observed, 'Discovery alone is insufficient: offer the exact dependency too'
    # Local ownership remains unverified; recording intentionally makes this
    # terminal turn partial rather than claiming the ongoing goal is complete.
    assert result.state == 'partial'
    assert len(detail.assignment_ids) == 1
    responsibility = s.get_responsibility(p, ws, detail.assignment_ids[0])
    assert [d.model_dump(mode='json') for d in responsibility.lifecycle.dependencies] == [observed['selected_dependency']]
    assert responsibility.lifecycle.state == 'waiting_event'
    assert not responsibility.lifecycle.check_in_due
    assert not responsibility.assignment.run_ids
    assert not s.proposals(p, ws, artifact.id).items
    calls, accounting = list(provider.calls), totals(s, grant)
    assert worker(context, provider, tmp_path).work(p, ws, request.run.id).state == result.state
    assert provider.calls == calls and totals(s, grant) == accounting
    replayed = s.get_conversation(p, ws, cv.id)
    assert replayed.artifact_ids == detail.artifact_ids
    assert replayed.assignment_ids == detail.assignment_ids


def test_new_home_document_later_human_edit_still_requires_proposal_acceptance(context, tmp_path):
    """Companion control: early creation must never become auto-accept for edits."""
    s, p, ws, _, _ = context
    cv = conversation(context)
    activate_home(context, cv, max_steps=3)
    request = post(context, cv, 'Draft an editable equipment handoff document.')
    initial = AlphaProvider([draft('Equipment handoff'), {'kind': 'reply', 'text': 'Prepared the draft.'}])
    assert finish_safe_visits(context, worker(context, initial, tmp_path), request.run.id).state == 'ready'
    detail = s.get_conversation(p, ws, cv.id)
    assert len(detail.artifact_ids) == 1
    artifact = s.get_artifact(p, ws, detail.artifact_ids[0])
    human_body = artifact.current_revision.body.model_dump(mode='json')
    human_body['blocks'].append({'block_id': 'human-note', 'kind': 'protected_note',
                                'text': 'Keep the spare key with the local owner. Ω', 'checked': None})
    edited = s.human_save(p, ws, artifact.id, cmd(HumanSave,
        expected_current_revision_id=artifact.current_revision_id, body=human_body))
    cv = s.get_conversation(p, ws, cv.id).conversation
    followup = post(context, cv, 'Propose a clearer title, preserving my note.', target=target(edited))
    proposed_body = copy.deepcopy(human_body)
    proposed_body['title'] = 'Equipment handoff — proposed clarification'
    provider = AlphaProvider([
        {'kind': 'publish_artifact', 'target': target(edited).model_dump(mode='json'), 'body': proposed_body},
        {'kind': 'reply', 'text': 'Proposed the title change for your review.'}])
    assert finish_safe_visits(context, worker(context, provider, tmp_path), followup.run.id).state == 'ready'
    proposals = s.proposals(p, ws, artifact.id).items
    assert len(proposals) == 1
    assert proposals[0].status == 'pending'
    assert proposals[0].base_revision_id == edited.current_revision_id
    assert proposals[0].body.model_dump(mode='json') == proposed_body
    current = s.get_artifact(p, ws, artifact.id)
    assert current.current_revision_id == edited.current_revision_id
    assert current.current_revision.body.model_dump(mode='json') == human_body
    calls = list(provider.calls)
    assert worker(context, provider, tmp_path).work(p, ws, followup.run.id).state == 'ready'
    assert provider.calls == calls
    assert len(s.proposals(p, ws, artifact.id).items) == 1


def receipts(s, ws, rid):
    """Exact historical bytes; additions may occur, retained rows cannot change."""
    with s.db.transaction() as c:
        return {r['id']: r['bytes'] for r in c.execute(
            "SELECT e.id,e.data::text bytes FROM responses_events e JOIN provider_attempts a "
            "ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s", (ws, rid)).fetchall()}


def early_rows(s, ws, rid):
    with s.db.transaction() as c:
        return [r['data'] for r in c.execute(
            'SELECT data FROM product_observations WHERE workspace_id=%s AND run_id=%s ORDER BY id',
            (ws, rid)).fetchall()]


@pytest.mark.parametrize('boundary', ['before-material', 'before-commit', 'after-commit', 'legacy-retained'])
def test_new_draft_atomic_crash_replay_and_exact_final_mapping(context, tmp_path, boundary):
    from test_sustained_continuity import Interrupted
    from test_runtime import expire
    from workagent.service import Service
    s, p, ws, _, _ = context
    cv = conversation(context)
    grant = activate_home(context, cv, max_steps=4)
    q = post(context, cv, 'Prepare two separate copies of this same draft, then explain.')
    provider = AlphaProvider([draft('Same content'), draft('Same content'), {'kind': 'reply', 'text': 'Two drafts prepared.'}])
    w = worker(context, provider, tmp_path)
    publish = s._publish_product

    def fail_publish(*args, **kwargs):
        if boundary == 'before-material':
            raise Interrupted()
        publish(*args, **kwargs)
        raise Interrupted()  # rolls back material, observation AND tool_result

    def interrupt(name):
        if name == 'after_tool_result':
            raise Interrupted()

    if boundary in ('before-material', 'before-commit'):
        with patch.object(s, '_publish_product', side_effect=fail_publish), pytest.raises(Interrupted):
            finish_safe_visits(context, w, q.run.id)
    else:
        w.phases.hook = interrupt
        if boundary == 'legacy-retained':
            with patch.object(s, '_publish_new_draft', return_value=None), pytest.raises(Interrupted):
                finish_safe_visits(context, w, q.run.id)
        else:
            with pytest.raises(Interrupted):
                finish_safe_visits(context, w, q.run.id)
    before = receipts(s, ws, q.run.id)
    material = early_rows(s, ws, q.run.id)
    assert len(material) == (1 if boundary == 'after-commit' else 0)
    detail = s.get_conversation(p, ws, cv.id)
    assert not any(m.author_kind == 'assistant' for m in detail.messages)
    if material:
        assert material[0]['output']['goal_status'] == 'needs_validation'
    expire(context, q.run.id)
    fresh = (Service(s.db), *context[1:])
    assert finish_safe_visits(fresh, worker(fresh, provider, tmp_path), q.run.id).state == 'ready'
    after = receipts(s, ws, q.run.id)
    assert all(after[key] == value for key, value in before.items())
    rows = early_rows(s, ws, q.run.id)
    assert len(rows) == 2
    assert rows[0]['operation_hash'] == rows[1]['operation_hash']
    assert rows[0]['model_selection']['selection_request_sha256'] != rows[1]['model_selection']['selection_request_sha256']
    assert len({r['artifact_id'] for r in rows}) == 2
    assert all(r in rows for r in material)
    final = s.get_conversation(p, ws, cv.id).messages[-1]
    actual = {(r.artifact_id, r.revision_id, r.observation_id) for r in final.result.results if hasattr(r, 'artifact_id')}
    assert actual == {(r['artifact_id'], r['revision_id'], r['id']) for r in rows}
    calls, accounting = list(provider.calls), totals(s, grant)
    worker(fresh, provider, tmp_path).work(p, ws, q.run.id)
    assert provider.calls == calls and totals(s, grant) == accounting
    assert early_rows(s, ws, q.run.id) == rows


@pytest.mark.parametrize('boundary', ['after_tool_result', 'before_publication'])
def test_human_edit_of_early_draft_fences_same_turn_without_recreation(context, tmp_path, boundary):
    from test_sustained_continuity import Interrupted
    from workagent.errors import DomainError
    s, p, ws, _, _ = context
    cv = conversation(context)
    activate_home(context, cv, max_steps=3)
    q = post(context, cv, 'Prepare a draft and then explain.')
    provider = AlphaProvider([draft(), {'kind': 'reply', 'text': 'Prepared.'}])
    w = worker(context, provider, tmp_path)
    def interrupt(name):
        if name == boundary:
            raise Interrupted()
    w.phases.hook = interrupt
    with pytest.raises(Interrupted):
        finish_safe_visits(context, w, q.run.id)
    rows = early_rows(s, ws, q.run.id)
    assert len(rows) == 1
    artifact = s.get_artifact(p, ws, rows[0]['artifact_id'])
    body = artifact.current_revision.body.model_dump(mode='json')
    body['blocks'].append({'block_id': 'human', 'kind': 'protected_note', 'text': 'Human correction Ω', 'checked': None})
    edited = s.human_save(p, ws, artifact.id, cmd(HumanSave,
        expected_current_revision_id=artifact.current_revision_id, body=body))
    before, calls = receipts(s, ws, q.run.id), list(provider.calls)
    with pytest.raises(DomainError) as error:
        worker(context, provider, tmp_path).work(p, ws, q.run.id)
    assert error.value.code.value in ('version_conflict', 'source_changed')
    assert receipts(s, ws, q.run.id) == before and provider.calls == calls
    assert early_rows(s, ws, q.run.id) == rows
    assert s.get_artifact(p, ws, artifact.id).current_revision_id == edited.current_revision_id
    assert not s.proposals(p, ws, artifact.id).items
    assert not any(m.author_kind == 'assistant' for m in s.get_conversation(p, ws, cv.id).messages)


@pytest.mark.parametrize('lose_phase', ['selection', 'selection_2', 'final'])
def test_unknown_send_never_completes_or_recreates_early_draft(context, tmp_path, lose_phase):
    s, p, ws, _, _ = context
    cv = conversation(context)
    grant = activate_home(context, cv, max_steps=3)
    q = post(context, cv, 'Prepare a draft, then explain.')
    provider = AlphaProvider([draft(), {'kind': 'reply', 'text': 'Prepared.'}], lose_phase=lose_phase)
    w = worker(context, provider, tmp_path)
    expected_responses = {'selection': 1, 'selection_2': 2, 'final': 3}[lose_phase]
    finish_safe_visits(context, w, q.run.id, stop_when=lambda: len(provider.responses) >= expected_responses)
    rows, before = early_rows(s, ws, q.run.id), receipts(s, ws, q.run.id)
    assert len(rows) == (0 if lose_phase == 'selection' else 1)
    calls, accounting = list(provider.calls), totals(s, grant)
    worker(context, provider, tmp_path).work(p, ws, q.run.id)
    assert provider.calls == calls and totals(s, grant) == accounting
    assert early_rows(s, ws, q.run.id) == rows and receipts(s, ws, q.run.id) == before
    assert s.get_run(p, ws, q.run.id).state != 'ready'
    assert not any(m.author_kind == 'assistant' for m in s.get_conversation(p, ws, cv.id).messages)


def test_early_draft_survives_budget_stop_as_unverified_preparation(context, tmp_path):
    s, p, ws, _, _ = context
    cv = conversation(context)
    # Same synthetic standing fixture, with just one generation reservation.
    def standing_binding(**kwargs):
        return StandingResponsesBinding(**(kwargs | {'conversation_ids': []}))
    with patch('test_general_alpha_runtime.GeneralAlphaResponsesBinding', standing_binding):
        grant = activate(context, cv, max_steps=3, generation_limit=1, admission_policy='principal-workspace-v1')
    q = post(context, cv, 'Prepare a useful draft and continue.')
    provider = AlphaProvider([draft(), {'kind': 'reply', 'text': 'Not sent.'}])
    run = finish_safe_visits(context, worker(context, provider, tmp_path), q.run.id)
    assert run.state == 'partial' and run.stop_reason == 'budget_limit'
    rows = early_rows(s, ws, q.run.id)
    assert len(rows) == 1 and rows[0]['output']['goal_status'] == 'needs_validation'
    assert s.get_artifact(p, ws, rows[0]['artifact_id']).current_revision_id == rows[0]['revision_id']
    assert not any(m.author_kind == 'assistant' for m in s.get_conversation(p, ws, cv.id).messages)
    calls, accounting = list(provider.calls), totals(s, grant)
    worker(context, provider, tmp_path).work(p, ws, q.run.id)
    assert provider.calls == calls and totals(s, grant) == accounting
    assert early_rows(s, ws, q.run.id) == rows


def test_own_addition_does_not_authorize_other_conversation_target(context, tmp_path):
    from test_flexible_work import publish
    from workagent.errors import DomainError
    s, p, ws, _, _ = context
    other, _, foreign = publish(context, draft('Other conversation')['body'])
    cv = conversation(context)
    activate_home(context, cv, max_steps=3)
    q = post(context, cv, 'Prepare my draft.')
    provider = AlphaProvider([draft(), {'kind': 'publish_artifact',
        'target': target(foreign).model_dump(mode='json'), 'body': draft('Unauthorized')['body']}])
    with pytest.raises(DomainError) as error:
        finish_safe_visits(context, worker(context, provider, tmp_path), q.run.id)
    assert error.value.code.value == 'not_found_or_not_authorized'
    assert len(early_rows(s, ws, q.run.id)) == 1
    assert s.get_artifact(p, ws, foreign.id).current_revision_id == foreign.current_revision_id
    assert not s.proposals(p, ws, foreign.id).items
    assert not any(m.author_kind == 'assistant' for m in s.get_conversation(p, ws, cv.id).messages)


def test_database_rejects_duplicate_new_ids_for_exact_selection(context, tmp_path):
    import psycopg
    from test_sustained_continuity import Interrupted
    from workagent.service import WorkerCapability
    from workagent.provider_attempts import ReceiptCapability
    s, p, ws, _, _ = context
    cv = conversation(context)
    activate_home(context, cv, max_steps=3)
    q = post(context, cv, 'Prepare a draft.')
    provider = AlphaProvider([draft(), {'kind': 'reply', 'text': 'Prepared.'}])
    w = worker(context, provider, tmp_path)
    def interrupt(name):
        if name == 'after_tool_result':
            raise Interrupted()
    w.phases.hook = interrupt
    with pytest.raises(Interrupted):
        finish_safe_visits(context, w, q.run.id)
    saved = w.phases.state.load(ws, q.run.id)
    cap, receipt = WorkerCapability(**saved['worker']), ReceiptCapability(**saved['receipt'])
    rows, before = early_rows(s, ws, q.run.id), receipts(s, ws, q.run.id)
    assert len(rows) == 1
    # Simulate a broken application replay check. The DB uniqueness key must
    # reject a second random artifact/revision, independently of artifact_id.
    with patch.object(s, '_new_draft_results', return_value=[]), pytest.raises(psycopg.errors.UniqueViolation) as error:
        s.stage_general_product(cap, receipt)
    assert error.value.diag.constraint_name == 'product_new_draft_selection_once'
    assert early_rows(s, ws, q.run.id) == rows and receipts(s, ws, q.run.id) == before
    assert s.get_conversation(p, ws, cv.id).artifact_ids == [rows[0]['artifact_id']]


def test_own_draft_does_not_normalize_human_change_to_frozen_old_work(context, tmp_path):
    from test_flexible_work import publish
    from test_sustained_continuity import Interrupted
    from workagent.errors import DomainError
    s, p, ws, _, _ = context
    cv, _, original = publish(context, draft('Original')['body'])
    activate_home(context, cv, max_steps=3)
    q = post(context, cv, 'Prepare another separate draft.')
    provider = AlphaProvider([draft('New'), {'kind': 'reply', 'text': 'Prepared.'}])
    w = worker(context, provider, tmp_path)
    def interrupt(name):
        if name == 'after_tool_result':
            raise Interrupted()
    w.phases.hook = interrupt
    with pytest.raises(Interrupted):
        finish_safe_visits(context, w, q.run.id)
    assert len(early_rows(s, ws, q.run.id)) == 1
    body = original.current_revision.body.model_dump(mode='json')
    body['title'] = 'Human updated original'
    edited = s.human_save(p, ws, original.id, cmd(HumanSave,
        expected_current_revision_id=original.current_revision_id, body=body))
    calls = list(provider.calls)
    with pytest.raises(DomainError) as error:
        worker(context, provider, tmp_path).work(p, ws, q.run.id)
    assert error.value.code.value == 'source_changed'
    assert provider.calls == calls
    assert s.get_artifact(p, ws, original.id).current_revision_id == edited.current_revision_id
    assert len(early_rows(s, ws, q.run.id)) == 1


@pytest.mark.parametrize('fence', ['cancel', 'revoke', 'expired-lease'])
def test_early_material_replay_keeps_current_authority_fences(context, tmp_path, fence):
    from test_sustained_continuity import Interrupted
    from test_runtime import expire
    from workagent.service import WorkerCapability
    from workagent.provider_attempts import ReceiptCapability, revoke_grant
    from workagent.models import CancelConversation
    from workagent.db import Database
    from workagent.errors import DomainError
    s, p, ws, _, admin = context
    cv = conversation(context)
    grant = activate_home(context, cv, max_steps=3)
    q = post(context, cv, 'Prepare a draft.')
    provider = AlphaProvider([draft(), {'kind': 'reply', 'text': 'Prepared.'}])
    w = worker(context, provider, tmp_path)
    def interrupt(name):
        if name == 'after_tool_result':
            raise Interrupted()
    w.phases.hook = interrupt
    with pytest.raises(Interrupted):
        finish_safe_visits(context, w, q.run.id)
    saved = w.phases.state.load(ws, q.run.id)
    cap, receipt = WorkerCapability(**saved['worker']), ReceiptCapability(**saved['receipt'])
    before, rows = receipts(s, ws, q.run.id), early_rows(s, ws, q.run.id)
    calls, accounting = list(provider.calls), totals(s, grant)
    if fence == 'cancel':
        current = s.get_conversation(p, ws, cv.id).conversation
        s.cancel_conversation(p, ws, cv.id, cmd(CancelConversation, expected_work_version=current.work_version))
    elif fence == 'revoke':
        revoke_grant(Database(admin), grant.id)
    else:
        expire(context, q.run.id)
    with pytest.raises(DomainError):
        s.stage_general_product(cap, receipt)
    assert receipts(s, ws, q.run.id) == before and early_rows(s, ws, q.run.id) == rows
    assert provider.calls == calls and totals(s, grant) == accounting


def test_same_turn_new_draft_revision_is_only_a_proposal(context, tmp_path):
    s, p, ws, _, _ = context
    cv = conversation(context)
    activate_home(context, cv, max_steps=5)
    q = post(context, cv, 'Prepare a draft, then propose a clearer title for review.')
    selected = {}
    def read(ctx):
        selected['target'] = ctx['adaptive']['observations'][-1]['capability_result']['result']['items'][0]['target']
        return {'kind': 'read_saved_work', 'target': selected['target']}
    def revise(ctx):
        body = copy.deepcopy(ctx['adaptive']['observations'][-1]['capability_result']['result']['body'])
        # Input packing can point to the identical complete saved body.
        if 'body_reference' in body:
            body = copy.deepcopy(ctx['work_area_context']['artifacts'][0]['body'])
        body['title'] = 'Proposed clarification'
        return {'kind': 'publish_artifact', 'target': selected['target'], 'body': body}
    provider = AlphaProvider([draft('Original title'),
        {'kind': 'discover_saved_work', 'after_artifact_id': None, 'limit': 12},
        read, revise, {'kind': 'reply', 'text': 'Prepared the draft and proposed a title change.'}])
    result = finish_safe_visits(context, worker(context, provider, tmp_path), q.run.id)
    assert result.state == 'ready'
    detail = s.get_conversation(p, ws, cv.id)
    assert len(detail.artifact_ids) == 1
    artifact = s.get_artifact(p, ws, detail.artifact_ids[0])
    assert target(artifact).model_dump(mode='json') == selected['target']
    assert artifact.current_revision.body.title == 'Original title'
    proposals = s.proposals(p, ws, artifact.id).items
    assert len(proposals) == 1 and proposals[0].status == 'pending'
    assert proposals[0].base_revision_id == artifact.current_revision_id
    assert proposals[0].body.title == 'Proposed clarification'
    calls = list(provider.calls)
    worker(context, provider, tmp_path).work(p, ws, q.run.id)
    assert provider.calls == calls and len(s.proposals(p, ws, artifact.id).items) == 1
