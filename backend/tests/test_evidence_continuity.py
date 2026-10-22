"""Delayed evidence continuity regression; synthetic HTTP, disposable PostgreSQL.

Run only in the parent's isolated test database. These exercise existing broker
reads, not a proposed retrieval API. No fixture accepts proposals, injects context,
rewrites receipts, or copies source text into the accepted artifact to pass.
"""
import json
from datetime import timedelta

import pytest

from test_domain import context, cmd
from test_conversations import conversation, post
from test_adaptive_execution import finish_safe_visits
from test_general_responses import worker, target
from test_saved_work_retrieval import CheckedProvider
from test_sustained_continuity import activate
from test_responsibilities import delegate
from test_responsibility_execution import admitted
from test_work_area_context import document, saved, propose
from workagent.models import AttachmentInput, HumanSave, now
from workagent.responsibility_models import (
    ActivateResponsibility, ResponsibilityDependency, ResponsibilityNextAction,
    ResponsibilityWait,
)
from workagent.service import Service


ORIGINAL = 'Original supplied terms: 24 desks, delivery by 18 November, warranty two years.'
AMENDMENT = 'Signed amendment Q-7: delivery AND assembly by 16 November; warranty four years.'
HUMAN_NOTE = 'Human correction: 30 identical desks, firm budget 9000; no split deliveries.'
PENDING_ONLY = 'Proposed assessment: the amended offer meets the revised constraints; awaiting human review.'
FOREIGN = 'OTHER_CONVERSATION_PRIVATE_EVIDENCE_7491'
REPLY = {'kind': 'reply', 'text': 'Read-only check completed; no proposal accepted or external action performed.'}


def _run(context, tmp_path, run_id, choices):
    fake = CheckedProvider(choices)
    result = finish_safe_visits(context, worker(context, fake, tmp_path), run_id)
    if fake.failures:
        raise fake.failures[0]
    assert result.state == 'ready'
    return fake


@pytest.fixture
def delayed_evidence(context, tmp_path):
    s, p, ws, _, _ = context
    # Same owner and workspace: conversation isolation must still exclude this.
    foreign_cv, foreign_art = saved(context)
    foreign_proposal = propose(context, foreign_cv, foreign_art, FOREIGN)
    foreign_cv = s.get_conversation(p, ws, foreign_cv.id).conversation
    foreign_grant = activate(context, foreign_cv, max_steps=5)
    foreign_turn = post(context, foreign_cv, 'Separate private task', attachments=[
        AttachmentInput(filename='private.txt', mime_type='text/plain', content=FOREIGN)])
    _run(context, tmp_path, foreign_turn.run.id, [REPLY])
    from workagent.db import Database
    from workagent.provider_attempts import revoke_grant
    revoke_grant(Database(context[4]), foreign_grant.id)

    cv = conversation(context)
    grant = activate(context, cv, max_steps=5)
    first = post(context, cv, 'Compare the supplied terms and save a decision note.', attachments=[
        AttachmentInput(filename='original.txt', mime_type='text/plain', content=ORIGINAL)])
    _run(context, tmp_path, first.run.id, [
        {'kind': 'publish_artifact', 'target': None, 'body': document('Historical assessment retained verbatim.')}, REPLY])
    detail = s.get_conversation(p, ws, cv.id)
    art = s.get_artifact(p, ws, detail.artifact_ids[0])
    original_revision = art.current_revision
    body = art.current_revision.body.model_dump(mode='json')
    body['blocks'].append({'block_id': 'human-note', 'kind': 'protected_note',
                           'text': HUMAN_NOTE, 'checked': None})
    art = s.human_save(p, ws, art.id, cmd(HumanSave,
        expected_current_revision_id=art.current_revision_id, body=body))
    cv = s.get_conversation(p, ws, cv.id).conversation
    changed = post(context, cv, 'Use the amendment with my saved correction; propose an update, then recheck later.',
        target=target(art), attachments=[
            AttachmentInput(filename='amendment.txt', mime_type='text/plain', content=AMENDMENT)])
    candidate = art.current_revision.body.model_dump(mode='json')
    candidate['blocks'].extend([
        {'block_id': 'assessment', 'kind': 'paragraph', 'text': PENDING_ONLY, 'checked': None},
        {'block_id': 'full-amendment', 'kind': 'paragraph', 'text': AMENDMENT, 'checked': None},
    ])
    _run(context, tmp_path, changed.run.id, [
        {'kind': 'publish_artifact', 'target': target(art).model_dump(mode='json'), 'body': candidate}, REPLY])
    proposal, = s.proposals(p, ws, art.id).items
    assert proposal.status == 'pending' and proposal.accepted_revision_id is None
    assert proposal.base_revision_id == art.current_revision_id
    assert s.get_artifact(p, ws, art.id).current_revision == art.current_revision

    assignment = delegate(context, cv, 'Recheck the supplied evidence and pending assessment without accepting it.')
    s.activate_responsibility(p, ws, assignment.id, cmd(ActivateResponsibility,
        expected_work_version=assignment.work_version,
        current_outcome='A human-edited note and an unaccepted proposal are retained.',
        next_action=ResponsibilityNextAction(kind='continue_work', description='Reread supplied evidence and pending work.'),
        dependencies=[ResponsibilityDependency(kind='artifact_revision', object_id=art.id,
                                              expected_version=art.current_revision_id)],
        wait=ResponsibilityWait(kind='check_in', reason='Scheduled evidence review'),
        next_check_in_at=now()-timedelta(seconds=1)))
    # Recreate the service; admit an actual scheduled system turn, no context injection.
    fresh = (Service(s.db), *context[1:])
    fresh[0].advance_responsibilities(ws, grant.id)
    row, = admitted(s, ws)
    assert row['config']['responsibility']['observations'][0]['observed_version'] == art.current_revision_id
    detail = s.get_conversation(p, ws, cv.id)
    wake = next(m for m in detail.messages if m.run_id == row['run_id'])
    assert wake.author_kind == 'system' and wake.evidence_origin == 'runtime'
    fake = _run(fresh, tmp_path, row['run_id'], [
        {'kind': 'read_context', 'section': 'attachments'},
        {'kind': 'read_context', 'section': 'work_area'},
        {'kind': 'discover_saved_work', 'after_artifact_id': None, 'limit': 12},
        REPLY,
    ])
    detail = s.get_conversation(p, ws, cv.id)
    turn = next(t for t in detail.turns if t.run_id == row['run_id'])
    reads = [step.capability_result['result'] for step in turn.adaptive.steps if step.capability_result]
    assert len(reads) == 3
    # Preservation checks run before either expected RED assertion.
    assert s.get_artifact(p, ws, art.id).current_revision == art.current_revision
    assert s.proposals(p, ws, art.id).items == [proposal]
    assert s.get_artifact(p, ws, art.id, original_revision.id).requested_revision == original_revision
    return dict(reads=reads, contexts=fake.contexts, art=art, proposal=proposal,
                attachments=[first.message.attachments[0], changed.message.attachments[0]],
                foreign_ids=[foreign_cv.id, foreign_art.id, foreign_proposal.id])


def test_delayed_read_retains_human_origin_attachment_bodies(delayed_evidence):
    data = delayed_evidence
    observed = data['reads'][0]
    assert observed['section'] == 'attachments'
    serialized = json.dumps(observed['value'])
    for attachment in data['attachments']:
        assert attachment.content in serialized, (
            'A scheduled read lost already-supplied human attachment content; omission is not absence')
        assert attachment.ref in serialized and attachment.sha256 in serialized


def test_delayed_read_retains_pending_proposal_body_as_unaccepted_evidence(delayed_evidence):
    data = delayed_evidence
    observed = data['reads'][1]
    assert observed['section'] == 'work_area'
    serialized = json.dumps(observed['value'])
    assert PENDING_ONLY in serialized and AMENDMENT in serialized, (
        'Scheduled work cannot reread the retained unaccepted proposal, including its full amendment')
    proposal = data['proposal']
    # Bind the evidence to its existing descriptor; do not invent an edit target.
    assert proposal.id in serialized and proposal.body_hash in serialized
    assert proposal.base_revision_id in serialized and '"pending"' in serialized


def test_delayed_reads_exclude_other_conversation(delayed_evidence):
    data = delayed_evidence
    serialized = json.dumps({'reads': data['reads'], 'contexts': data['contexts']})
    assert FOREIGN not in serialized
    for foreign_id in data['foreign_ids']:
        assert foreign_id not in serialized


def test_pending_proposal_does_not_replace_current_saved_revision(delayed_evidence):
    data = delayed_evidence
    # Discovery remains current-revision discovery; a pending body is evidence,
    # never silently promoted to an accepted/current artifact or editable target.
    page = data['reads'][2]
    targets = [item['target'] for item in page['items']]
    assert targets == [target(data['art']).model_dump(mode='json')]
    assert data['proposal'].body_hash not in {item['body_hash'] for item in targets}
    dependency = data['contexts'][0]['dependencies'][0]['content']
    assert HUMAN_NOTE in json.dumps(dependency)
    assert PENDING_ONLY not in json.dumps(dependency)
    assert AMENDMENT not in json.dumps(dependency)
