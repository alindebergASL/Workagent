"""Known local rejection must settle, not leave a received turn running forever.

Grounded in synthetic run 55c77132-dddb-4310-a9cd-035cb5d625a2, selection_5:
table -> bound responsibility -> discovery -> read -> document at table target.
The supplied fresh-actions.json SHA256 is
97db4604141bcea55ae4df8217bc7ab6c3bd074fc4fe4f6ffc55b0318d993b28.
These are NEW controlled HTTP / disposable PostgreSQL runs, not live replays.
No runtime patch, direct journal write, proposal acceptance, or kind conversion.
Both cases intentionally require the existing durable rejection mechanism to
cover this in-scope invalid operation; they are expected RED before that fix.
"""
import copy
from datetime import timedelta
from unittest.mock import patch

import pytest

from test_adaptive_execution import finish_safe_visits
from test_conversations import post
from test_domain import context, cmd
from test_flexible_work import publish
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import target, totals, worker
from test_runtime import expire
from test_same_turn_draft_binding import activate_home, early_rows, receipts
from test_sustained_continuity import Interrupted, draft
from workagent.composition import ContinuityDecision
from workagent.errors import DomainError
from workagent.models import HumanSave, now
from workagent.responses_dispatcher import ResponsesDispatcher
from workagent.service import Service, digest


def readiness_table():
    return {'kind': 'structured_table', 'version': 'structured-table/v1',
            'title': 'Library desk readiness',
            'fields': [{'key': 'item', 'type': 'text', 'label': 'Readiness item',
                        'editable': True, 'unit': None, 'scale': None, 'enum': None}],
            'rows': [{'row_id': key, 'cells': [{'field_key': 'item', 'value': text}]}
                     for key, text in [('materials', 'materials'),
                                       ('accessible-layout', 'accessible layout'),
                                       ('questions', 'questions for me')]],
            'notes': []}


def readiness_document():
    return {'title': 'Library desk readiness',
            'blocks': [{'block_id': row['row_id'], 'kind': 'paragraph',
                        'text': '• ' + row['cells'][0]['value'], 'checked': None}
                       for row in readiness_table()['rows']]}


def journal(s, ws, rid):
    with s.db.transaction() as c:
        rows = c.execute(
            'SELECT e.phase,e.kind,e.data FROM responses_events e '
            'JOIN provider_attempts a ON a.id=e.attempt_id '
            'WHERE a.workspace_id=%s AND a.run_id=%s', (ws, rid)).fetchall()
    return {(row['phase'], row['kind']): row['data'] for row in rows}


def requests(s, ws, rid):
    with s.db.transaction() as c:
        return {row['phase']: row for row in c.execute(
            'SELECT step.* FROM responses_steps step JOIN provider_attempts a '
            'ON a.id=step.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s',
            (ws, rid)).fetchall()}


@pytest.mark.parametrize('max_steps', [6, 5], ids=['observe-then-block', 'step-bound'])
def test_known_kind_rejection_settles_after_exact_received_restart(context, tmp_path, max_steps):
    s, p, ws, _, _ = context
    # Genuine prior saved work and an unaccepted proposal in this conversation.
    # They predate admission, so preserving them does not bypass a stale fence.
    cv, _, prior = publish(context, draft('Prior human work')['body'])
    human_body = prior.current_revision.body.model_dump(mode='json')
    human_body['blocks'].append({'block_id': 'human', 'kind': 'protected_note',
                                'text': 'Human correction: keep this exactly. Ω', 'checked': None})
    human = s.human_save(p, ws, prior.id, cmd(HumanSave,
        expected_current_revision_id=prior.current_revision_id, body=human_body))
    proposed = copy.deepcopy(human_body)
    proposed['title'] = 'Pending human review'
    cv, _, _ = publish(context, proposed, s.get_conversation(p, ws, cv.id).conversation,
                       artifact_id=prior.id, base_revision_id=human.current_revision_id)
    prior_history = s.history(p, ws, prior.id)
    prior_proposals = s.proposals(p, ws, prior.id)
    assert len(prior_proposals.items) == 1 and prior_proposals.items[0].status == 'pending'
    prior_messages = s.get_conversation(p, ws, cv.id).messages
    grant = activate_home(context, cv, max_steps=max_steps)
    q = post(context, cv,
        'Create a short editable Library desk readiness document with three bullets: '
        'materials, accessible layout, questions for me. Bind local responsibility '
        'to it, check in ten minutes from now and four minutes later, then await '
        'my decision. Preserve saved work; no external actions.')
    seen = {}

    def record(ctx):
        # Use only exact identities actually offered after early publication.
        material = ctx['published_preparations'][0]
        dependency = next(d for d in ctx['responsibility_offer']['dependencies']
                          if d['kind'] == 'artifact_revision'
                          and d['object_id'] == material['artifact_id']
                          and d['expected_version'] == material['revision_id'])
        seen['dependency'] = copy.deepcopy(dependency)
        return {'kind': 'record_responsibility', 'goal': 'Keep Library desk preparation current',
                'completion_criteria': ['Two preparation check-ins, then await a human decision'],
                'plan': {'current_outcome': 'A table draft exists; bullet document is unfinished.',
                         'next_action': {'kind': 'continue_work', 'description':
                             'Use latest saved work, preserve edits, prepare a separate note; '
                             'check again four minutes later, then await the human.'},
                         'dependencies': [dependency], 'wait': None,
                         'next_check_in_at': (now() + timedelta(minutes=10)).isoformat()}}

    def read(ctx):
        page = ctx['adaptive']['observations'][-1]['capability_result']['result']
        item = next(item for item in page['items']
                    if item['target']['artifact_id'] == seen['dependency']['object_id'])
        seen['target'] = copy.deepcopy(item['target'])
        return {'kind': 'read_saved_work', 'target': item['target']}

    def convert(ctx):
        seen['read'] = copy.deepcopy(ctx['adaptive']['observations'][-1]['capability_result']['result'])
        seen['conversion_context'] = copy.deepcopy(ctx)
        return {'kind': 'publish_artifact', 'target': seen['target'], 'body': readiness_document()}

    def stop(ctx):
        # Capture here; assert outside HTTP so fixture assertion failures never
        # masquerade as unknown sends in the transport journal.
        seen['after_rejection'] = copy.deepcopy(ctx['adaptive']['observations'][-1])
        return {'kind': 'stop', 'outcome': 'blocked', 'text':
                'The document conversion was rejected. The original table and local '
                'responsibility remain saved; the requested bullet document is unfinished.'}

    provider = AlphaProvider([
        {'kind': 'publish_artifact', 'target': None, 'body': readiness_table()}, record,
        {'kind': 'discover_saved_work', 'after_artifact_id': None, 'limit': 12}, read,
        convert, stop], explanation='The table remains saved. Document conversion was rejected.')
    w = worker(context, provider, tmp_path)
    stage = s.stage_general_product

    def crash_before_local_stage(cap, receipt, phase='selection'):
        if phase == 'selection_5':
            raise Interrupted()  # receipt committed; no local action attempted yet
        return stage(cap, receipt, phase)

    with patch.object(s, 'stage_general_product', side_effect=crash_before_local_stage), pytest.raises(Interrupted):
        finish_safe_visits(context, w, q.run.id)
    before = journal(s, ws, q.run.id)
    selected = before['selection_5', 'result']
    assert selected['state'] == 'function_call' and selected['issue'] is None
    ContinuityDecision.model_validate(selected['value'], strict=True)
    assert selected['value']['decision'] == {
        'kind': 'publish_artifact', 'target': seen['target'], 'body': readiness_document()}
    assert seen['read']['status'] == 'complete'
    assert seen['read']['target'] == seen['target']
    read_body = seen['read']['body']
    if 'body_reference' in read_body:
        # Request packing may refer to an identical body already in the context.
        import re
        ref = read_body['body_reference']
        assert re.fullmatch(r'#/work_area_context/artifacts/[0-9]+/body', ref['path'])
        read_body = seen['conversion_context']
        for token in ref['path'][2:].split('/'):
            read_body = read_body[int(token)] if isinstance(read_body, list) else read_body[token]
        assert digest(read_body) == ref['sha256'] == seen['target']['body_hash']
    assert read_body == readiness_table()
    assert ('selection_5', 'tool_result') not in before
    assert len([key for key in before if key[1] == 'tool_result']) == 4
    rows = early_rows(s, ws, q.run.id)
    assert len(rows) == 1
    artifact = s.get_artifact(p, ws, rows[0]['artifact_id'])
    assert target(artifact).model_dump(mode='json') == seen['target']
    ownership = s.get_conversation(p, ws, cv.id).assignment_ids
    assert len(ownership) == 1
    responsibility = s.get_responsibility(p, ws, ownership[0])
    assert [d.model_dump(mode='json') for d in responsibility.lifecycle.dependencies] == [seen['dependency']]
    assert responsibility.lifecycle.state == 'waiting_event'
    old_receipts, calls, budget = receipts(s, ws, q.run.id), list(provider.calls), totals(s, grant)
    old_requests = requests(s, ws, q.run.id)
    assert budget['request_counts']['dispatch'] == 5
    # No unknown I/O: every sent phase has an exact receipt before lease expiry.
    assert all((phase, 'result') in before for phase, kind in before if kind == 'dispatch')
    assert all((phase, 'count_result') in before for phase, kind in before if kind == 'count_send')
    expire(context, q.run.id)
    fresh = (Service(s.db), *context[1:])
    restarted = worker(fresh, provider, tmp_path)
    rejection = None
    try:
        finish_safe_visits(fresh, restarted, q.run.id)
    except DomainError as error:
        # Baseline diagnosis, not the success criterion. A schema/budget/authority
        # failure is not allowed to satisfy this regression.
        assert error.code.value == 'unsupported_operation'
        rejection = error.code.value
        frames = []
        tb = error.__traceback__
        while tb:
            frames.append(tb.tb_frame.f_code.co_name)
            tb = tb.tb_next
        assert '_product_base' in frames
        dispatcher = ResponsesDispatcher(restarted, workspace=ws, grant_id=grant.id)
        for _ in range(2):
            result = next(r for r in dispatcher.once()['results'] if r['run_id'] == q.run.id)
            assert result == {'run_id': q.run.id, 'status': 'denied_or_deferred',
                              'reason': 'unsupported_operation'}
        assert provider.calls == calls and totals(s, grant) == budget
        assert s.get_run(p, ws, q.run.id).state == 'running'
        assert not any(m.run_id == q.run.id and m.author_kind == 'assistant'
                       for m in s.get_conversation(p, ws, cv.id).messages)

    # Preservation assertions run even on the defective baseline.
    after = journal(s, ws, q.run.id)
    retained = receipts(s, ws, q.run.id)
    assert all(retained[key] == value for key, value in old_receipts.items())
    current_requests = requests(s, ws, q.run.id)
    assert all(current_requests[key] == value for key, value in old_requests.items())
    assert early_rows(s, ws, q.run.id) == rows
    assert s.get_artifact(p, ws, artifact.id).current_revision == artifact.current_revision
    assert not s.proposals(p, ws, artifact.id).items
    assert s.get_artifact(p, ws, prior.id).current_revision == human.current_revision
    assert s.history(p, ws, prior.id) == prior_history
    assert s.proposals(p, ws, prior.id) == prior_proposals
    assert s.get_responsibility(p, ws, ownership[0]).assignment == responsibility.assignment
    detail = s.get_conversation(p, ws, cv.id)
    assert detail.messages[:len(prior_messages)] == prior_messages
    assert set(detail.artifact_ids) == {prior.id, artifact.id}
    assert detail.assignment_ids == ownership

    local = after.get(('selection_5', 'tool_result'))
    assert local is not None, (
        'Known received in-scope kind mismatch must produce a durable rejection; '
        f'currently {rejection=}, selection_5 has no tool_result and dispatch repeats forever')
    assert local['status'] == 'rejected'
    assert local['body'] is None and local['file'] is None and local['output'] is None
    assert local['decision'] == selected['value']['decision']
    assert local['binding']['selection_request_sha256'] == selected['request_sha256']
    assert local['binding']['selection_response_id'] == selected['response_id']
    assert local['binding']['decision_sha256'] == digest(selected['value'])
    assert local['binding']['base_hash'] == artifact.current_revision.body_hash
    assert not local['verification']['satisfied']
    assert local['diagnostic']['code'] and local['diagnostic']['detail']
    expected = 'blocked' if max_steps == 6 else 'step_limit'
    if max_steps == 6:
        assert seen['after_rejection']['status'] == 'rejected'
        assert seen['after_rejection']['binding'] == local['binding']
    else:
        assert 'after_rejection' not in seen
    run = s.get_run(p, ws, q.run.id)
    assert run.state == 'partial' and run.stop_reason == expected
    detail = s.get_conversation(p, ws, cv.id)
    turn = next(t for t in detail.turns if t.run_id == q.run.id)
    assert turn.adaptive.outcome == expected
    reply = next(m for m in detail.messages if m.run_id == q.run.id and m.author_kind == 'assistant')
    assert expected.replace('_', ' ') in reply.text.lower().replace('_', ' ')
    with s.db.transaction() as c:
        assert c.execute('SELECT acknowledged_at FROM run_dispatches '
                         'WHERE workspace_id=%s AND run_id=%s', (ws, q.run.id)).fetchone()['acknowledged_at'] is not None
    assert totals(s, grant)['request_counts']['dispatch'] == max_steps + 1
    calls, budget, retained = list(provider.calls), totals(s, grant), receipts(s, ws, q.run.id)
    assert worker(fresh, provider, tmp_path).work(p, ws, q.run.id).state == 'partial'
    assert provider.calls == calls and totals(s, grant) == budget
    assert receipts(s, ws, q.run.id) == retained
