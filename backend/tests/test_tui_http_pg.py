"""Parent-run real API/PG proof for the TUI's format-3 protocol.

No provider calls. This test receives principal identity from the provisioned
fixture, not an invented owner inference. Missing-identity behavior is covered
by the offline protocol tests. The parent provisions PostgreSQL and runs this file.
"""
import pytest
from fastapi.testclient import TestClient
from test_domain import context
from test_operator_review_http_pg import ASGIOpener
from workagent.api import create_app, Settings
from workagent.operator_client import OperatorClient, OperatorError
from workagent.operator_attachments import stage_text_files


def test_exact_attachment_unknown_post_replay_and_displayed_cas(context,monkeypatch,tmp_path):
    service,principal,workspace,_,_=context
    token='synthetic-tui-api-'+('x'*40)
    monkeypatch.setenv('LOCAL_BEARER_TOKEN',token)
    monkeypatch.setenv('WORKAGENT_OPERATOR_URL','http://127.0.0.1:8765')
    monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL',str(tmp_path/'commands'))
    with TestClient(create_app(Settings(service.db.dsn,True,token,principal.id))) as api:
        client=OperatorClient();opener=ASGIOpener(api);client.opener=opener
        created=client.run(workspace,'chat',['TUI exact snapshots'],principal_id=principal.id)
        conversation=created['receipt']['id'];version=created['readback']['conversation']['work_version']
        # Text attachment admission requires an explicit synthetic Responses
        # grant. No dispatcher/provider runs in this replay test.
        from test_general_responses import activate
        activate(context,[service.get_conversation(principal,workspace,conversation).conversation])
        file=tmp_path/'evidence.txt';raw=b'\xef\xbb\xbfretained\r\nexact\r\n';file.write_bytes(raw)
        snapshots=[a.payload() for a in stage_text_files([file])]
        original_open=opener.open;lost=False;calls=[]
        def lose_ack(request,timeout):
            nonlocal lost
            calls.append(request.method)
            response=original_open(request,timeout)
            if request.method=='POST' and request.full_url.endswith('/messages') and not lost:
                lost=True
                raise OSError('synthetic lost acknowledgement after server commit')
            return response
        opener.open=lose_ack
        with pytest.raises(OperatorError,match='outcome/readback'):
            client.run(workspace,'follow',[conversation,' \n雪\r\n '],command_id='retained-message',
                       expected_work_version=version,attachments=snapshots,principal_id=principal.id)
        assert calls==['POST'] # absolutely no invisible fresh CAS GET
        original_post=opener.posts[-1]
        file.unlink()
        restarted=OperatorClient();restarted.opener=opener
        result=restarted.run(workspace,'replay',['retained-message'],principal_id=principal.id)
        assert opener.posts[-1]==original_post
        assert result['receipt']['message']['attachments'][0]['content'].encode()==raw
        assert result['receipt']['message']['text']==' \n雪\r\n '
        assert restarted.journal.read('retained-message')['outcome']['state']=='confirmed'
        assert len([m for m in result['readback']['messages'] if m['author_kind']=='human'])==1
        before=len(calls)
        with pytest.raises(OperatorError,match='version_conflict'):
            restarted.run(workspace,'follow',[conversation,'Stale displayed version'],command_id='stale-message',
                          expected_work_version=version,principal_id=principal.id)
        assert calls[before:]==['POST']
