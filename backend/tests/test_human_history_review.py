"""Narrow review regressions. In-memory query/gate doubles, no PG/provider.

Mixed fixture uses the real Assignment's <=100 original-ID constraint. The
137-original case separately tests discovery robustness, not schema admission.
"""
from copy import deepcopy
from types import SimpleNamespace as NS
from unittest.mock import Mock

import pytest
from test_human_history_discovery import ServiceDouble, Rows, P, collect, http
from workagent.outcomes import project_responsibility_artifacts
from workagent.checkpoint_models import CheckpointData
from workagent.service import digest


@pytest.mark.parametrize('mixed', [False, True])
@pytest.mark.parametrize('limit', [1, 25, 100])
def test_original_owner_outputs_beyond_first_100_are_preserved(mixed, limit):
    s = ServiceDouble(237 if mixed else 137)
    originals = list(s.db.outputs)[137:] if mixed else list(s.db.outputs)
    s.assignment.artifact_ids = originals.copy()
    for aid in originals:
        s.db.outputs[aid].update(assignment_id='assignment', conversation_id=None,
                                binding='original', title='Human saved ' + aid)
    before = deepcopy(s.db.outputs)
    # Projection is a read copy; never mutate the stored original membership.
    summary = deepcopy(s.assignment)
    project_responsibility_artifacts(s, s.db, P, summary)
    assert len(summary.artifact_ids) == 100
    assert set(originals) - set(summary.artifact_ids)
    pages = []
    def read(after):
        page = s.list_responsibility_outputs(P, 'ws', 'assignment', after, limit)
        pages.extend(page.items)
        return page
    assert collect(read, 'artifact_id') == sorted(s.db.outputs)
    for item in pages:
        source = before[item.artifact_id]
        assert (item.assignment_id, item.conversation_id, item.title, item.revision_id) == (
            source['assignment_id'], source['conversation_id'], source['title'], source['current_revision_id'])
    assert s.db.outputs == before
    assert s.assignment.artifact_ids == originals


def test_mixed_originals_on_actual_get_route_keep_owner_and_current_human_revision(http):
    client, headers, s = http
    s.db = ServiceDouble(237).db
    originals = list(s.db.outputs)[137:]
    s.assignment.artifact_ids = originals.copy()  # 100 original IDs, valid legacy model bound
    for aid in originals:
        s.db.outputs[aid].update(assignment_id='assignment', conversation_id=None,
                                binding='original', title='Human saved ' + aid)
    s.db.outputs[originals[-1]]['current_revision_id'] = 'human-revision'
    before = deepcopy(s.db.outputs)
    url = '/v1/workspaces/ws/assignments/assignment/responsibility/outputs'
    items = []; after = None
    while True:
        response = client.get(url, headers=headers, params={'limit':25, **({'after':after} if after else {})})
        assert response.status_code == 200
        page = response.json(); items.extend(page['items'])
        if not page['has_more']: break
        after = page['next_after']
    assert [item['artifact_id'] for item in items] == sorted(s.db.outputs)
    assert len(items) == 237
    assert [item['artifact_id'] for item in items if item['assignment_id'] == 'assignment'] == originals
    assert items[-1]['revision_id'] == 'human-revision'
    assert items[-1]['title'] == 'Human saved ' + originals[-1]
    s.denied.add(originals[-1])
    denied = client.get(url, headers=headers, params={'after': originals[-1]})
    assert denied.status_code == 404
    assert originals[-1] not in denied.text
    assert 'Human saved' not in denied.text
    assert s.db.outputs == before


@pytest.mark.parametrize('newer', ['same-run', 'other-run', 'other-principal'])
@pytest.mark.parametrize('page_history', [False, True])
def test_history_does_not_change_baseline_legitimate_continuation(monkeypatch, newer, page_history):
    import workagent.run_successors as successors
    import workagent.general_responses as general
    import workagent.responsibility_execution as execution
    import workagent.responses_recovery as recovery

    s = ServiceDouble()
    s.cv.state = 'open'; s.cv.work_version = 1
    cp = s.db.checkpoints[0]
    if newer == 'other-run':
        s.cv.run_ids.append('newer-run')
        s.db.checkpoints[-1]['run_id'] = 'newer-run'
    elif newer == 'other-principal':
        s.db.checkpoints[-1]['data']['principal_id'] = 'someone-else'
    config = {**s.db.config, 'grant_id': 'grant'}
    material = {'text': 'Keep doing the authorized work'}
    cp['data'].update(configuration_sha256=digest(config), intent_sha256=digest(material))
    cp['checkpoint_hash'] = digest(CheckpointData.model_validate(cp['data']))
    original = NS(id='intent', text=material['text'], target=None, attachments=[], acceptance_checks=None)
    predecessor = NS(id='run', state='partial', stop_reason='step_limit', fence=0)
    successor = NS(id='successor')
    query = s.db.execute
    writes = []
    def execute(sql, args=()):
        if sql.startswith('SELECT data FROM runs'):
            return Rows([{'data': predecessor}])
        if sql.startswith('SELECT 1 FROM runs'):
            return Rows([])
        if sql.startswith('SELECT data FROM conversation_messages'):
            return Rows([{'data': material}])
        if sql.startswith('INSERT INTO run_successors'):
            writes.append((sql, args)); return Rows([])
        return query(sql, args)
    s.db.execute = execute
    monkeypatch.setattr(successors.Run, 'model_validate', lambda data: data)
    monkeypatch.setattr(general, 'check_pins', Mock(return_value=config))
    monkeypatch.setattr(general, 'consumer_hash', lambda: '0'*64)
    monkeypatch.setattr(successors, 'scope_fingerprint', Mock(return_value='0'*64))
    monkeypatch.setattr(successors, 'latest_human_intent', lambda *args: 'intent')
    monkeypatch.setattr(general, 'has_unresolved_attempt', Mock(return_value=False))
    admission = Mock(return_value=NS(id='grant'))
    monkeypatch.setattr(general, 'admission', admission)
    expiry = Mock(return_value=None)
    monkeypatch.setattr(recovery, 'effective_expiry', expiry)
    budget = Mock()
    monkeypatch.setattr(execution, 'check_admission_budget', budget)
    s._conversation_messages = Mock(return_value=[original])
    s._admit_conversation_turn = Mock(return_value=NS(run=successor))
    s._materialize_general_context = Mock()
    s._event = Mock()
    before = deepcopy(s.db.checkpoints)
    if page_history:
        ids = collect(lambda after: s.list_run_checkpoints(P, 'ws', 'cv', after, 19), 'checkpoint_id')
        assert len(ids) == (136 if newer == 'other-principal' else 137)
        assert not writes
        admission.assert_not_called()
        s._admit_conversation_turn.assert_not_called()
    assert s.db.checkpoints == before
    result = s._admit_run_successor(s.db, P, 'ws', s.cv, cp['checkpoint_id'], cp['checkpoint_hash'])
    assert result is successor
    admission.assert_called_once(); expiry.assert_called_once(); budget.assert_called_once()
    s._admit_conversation_turn.assert_called_once()
    assert s._admit_conversation_turn.call_args.kwargs['continuation']['checkpoint_id'] == cp['checkpoint_id']
    assert len(writes) == 1
