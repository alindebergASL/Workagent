"""The supported HTTP host never substitutes a fixture for missing authority."""
import secrets
import pytest
from fastapi.testclient import TestClient
from test_domain import context, cmd
from test_conversations import conversation, post
from test_general_products import wasmop
from test_general_alpha_runtime import activate
from workagent.api import Settings, create_app
from workagent.models import PostMessage


@pytest.mark.parametrize('operation',[None,wasmop()])
def test_ungranted_http_turn_denied_without_mutation(context,operation):
    s,p,ws,_,_=context
    cv=conversation(context)
    settings=Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id)
    body=cmd(PostMessage,expected_work_version=cv.work_version,text='A real question',operation=operation)
    before=s.get_conversation(p,ws,cv.id)
    with TestClient(create_app(settings)) as client:
        response=client.post(f'/v1/workspaces/{ws}/conversations/{cv.id}/messages',
            headers={'Authorization':'Bearer '+settings.local_bearer},json=body.model_dump(mode='json'))
    assert response.status_code==422 and response.json()['code']=='unsupported_operation'
    assert s.get_conversation(p,ws,cv.id)==before
    with s.db.transaction() as c:
        for table in ('runs','conversation_messages','run_dispatches','provider_attempts'):
            assert c.execute('SELECT count(*) n FROM '+table+' WHERE workspace_id=%s',(ws,)).fetchone()['n']==0


def test_explicit_fixture_mode_preserves_historical_harness(context):
    s,p,ws,_,_=context;cv=conversation(context)
    settings=Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id,fixture_mode=True)
    with TestClient(create_app(settings)) as client:
        response=client.post(f'/v1/workspaces/{ws}/conversations/{cv.id}/messages',
            headers={'Authorization':'Bearer '+settings.local_bearer},
            json=cmd(PostMessage,expected_work_version=cv.work_version,text='Fixture only').model_dump(mode='json'))
    assert response.status_code==202 and response.json()['run']['execution']['mode']=='fixture'


def test_granted_managed_http_turn_keeps_model_route(context):
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,cv)
    settings=Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id)
    with TestClient(create_app(settings)) as client:
        response=client.post(f'/v1/workspaces/{ws}/conversations/{cv.id}/messages',
            headers={'Authorization':'Bearer '+settings.local_bearer},
            json=cmd(PostMessage,expected_work_version=cv.work_version,text='A real question').model_dump(mode='json'))
    assert response.status_code==202
    assert response.json()['run']['execution']['mode']=='managed'
    assert response.json()['run']['execution']['grant_id']==g.id


def test_managed_mode_keeps_exact_old_command_replay_not_new_fallback(context):
    s,p,ws,_,_=context;cv=conversation(context)
    body=cmd(PostMessage,expected_work_version=cv.work_version,text='Historical fixture')
    old=s.post_message(p,ws,cv.id,body)
    settings=Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id)
    with TestClient(create_app(settings)) as client:
        url=f'/v1/workspaces/{ws}/conversations/{cv.id}/messages'
        headers={'Authorization':'Bearer '+settings.local_bearer}
        replay=client.post(url,headers=headers,json=body.model_dump(mode='json'))
        assert replay.status_code==202 and replay.json()['run']['id']==old.run.id
        next_turn=client.post(url,headers=headers,json=cmd(PostMessage,
            expected_work_version=old.conversation.work_version,text='Not a fixture').model_dump(mode='json'))
        assert next_turn.status_code==422
    assert len(s.get_conversation(p,ws,cv.id).messages)==1


def test_environment_is_managed_unless_explicitly_fixture(monkeypatch):
    monkeypatch.delenv('WORKAGENT_FIXTURE_MODE',raising=False)
    assert not Settings.environment().fixture_mode
    monkeypatch.setenv('WORKAGENT_FIXTURE_MODE','true')
    assert Settings.environment().fixture_mode
