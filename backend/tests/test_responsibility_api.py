"""Actual HTTP/Service wiring; controlled domain fixtures are not model proof."""
import os
import secrets

from fastapi.testclient import TestClient

from test_domain import context, cmd
from workagent.api import Settings, create_app
from workagent.models import CreateConversation, DelegateConversation, HumanSave
from workagent.responsibility_models import ActivateResponsibility, ControlResponsibility


def http(p):
    token = secrets.token_urlsafe(40)
    client = TestClient(create_app(Settings(os.environ['DATABASE_URL'], True, token, p.id)))
    client.headers.update({'Authorization': 'Bearer ' + token, 'X-Schema-Version': 'workagent/v1', 'X-Request-Id': 'responsibility-api'})
    return client


def make_assignment(s, p, ws):
    cv = s.create_conversation(p, ws, cmd(CreateConversation, selected_source_refs=[]))
    a = s.delegate_conversation(p, ws, cv.id, cmd(DelegateConversation,
        expected_work_version=cv.work_version, goal='Keep this work current', completion_criteria=['Evidence supports the requested result']))
    return cv, a


def test_responsibility_http_uses_production_service_and_truthful_controls(context):
    s, p, ws, _, _ = context
    cv, a = make_assignment(s, p, ws)
    base = f'/v1/workspaces/{ws}/assignments/{a.id}/responsibility'
    activation = cmd(ActivateResponsibility, expected_work_version=a.work_version,
        current_outcome='Waiting for a local update, no external effect',
        next_action={'kind': 'await_event', 'description': 'Review the next material update'})
    with http(p) as client:
        response = client.post(base, json=activation.model_dump(mode='json'))
        assert response.status_code == 201, response.text
        detail = response.json()
        assert detail['assignment']['id'] == a.id
        assert detail['provider_execution_queued'] is False
        assert detail['lifecycle']['execution_status'] == 'not_admitted'
        assert client.get(base).json()['lifecycle'] == detail['lifecycle']
        pause = cmd(ControlResponsibility, expected_work_version=detail['assignment']['work_version'], operation='pause')
        stopped = client.post(base + '/control', json=pause.model_dump(mode='json'))
        assert stopped.status_code == 200, stopped.text
        assert stopped.json()['lifecycle']['state'] == 'paused'
        assert client.post(base + '/control', json=pause.model_dump(mode='json')).json()['lifecycle']['state'] == 'paused'
        forged = activation.model_dump(mode='json') | {'provider_execution_queued': True}
        assert client.post(base, json=forged).status_code == 422
    assert s.get_conversation(p, ws, cv.id).runs == []


def test_production_service_human_save_drives_same_responsibility(context):
    from test_responsibilities import product, plan
    s, p, ws, _, _ = context
    cv = s.create_conversation(p, ws, cmd(CreateConversation, selected_source_refs=[]))
    artifact, _ = product(context, cv)
    latest = s.get_conversation(p, ws, cv.id).conversation
    a = s.delegate_conversation(p, ws, cv.id, cmd(DelegateConversation,
        expected_work_version=latest.work_version, goal='Maintain the same work', completion_criteria=['Preserve human edits']))
    base = f'/v1/workspaces/{ws}/assignments/{a.id}/responsibility'
    activation = cmd(ActivateResponsibility, expected_work_version=a.work_version, **plan(artifact=artifact))
    with http(p) as client:
        initial = client.post(base, json=activation.model_dump(mode='json'))
        assert initial.status_code == 201, initial.text
        assert initial.json()['lifecycle']['state'] == 'waiting_event'
        body = artifact.current_revision.body.model_copy(deep=True)
        body.notes.append('Keep this human contribution intact.')
        saved = s.human_save(p, ws, artifact.id, cmd(HumanSave, expected_current_revision_id=artifact.current_revision_id, body=body))
        changed = client.get(base)
        assert changed.status_code == 200, changed.text
        assert changed.json()['lifecycle']['review_required'] is True
        assert changed.json()['lifecycle']['observations'][0]['observed_version'] == saved.current_revision_id
        assert changed.json()['provider_execution_queued'] is False
        # GETs neither mutate the version nor create another model turn.
        assert client.get(base).json()['assignment']['work_version'] == changed.json()['assignment']['work_version']
    assert len(s.get_conversation(p, ws, cv.id).runs) == 1
