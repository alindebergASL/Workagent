"""Real loopback HTTP + restricted PostgreSQL conversational client proof."""
import copy
import socket
import threading
import time
import urllib.error

import pytest
pytest.importorskip('textual')
import uvicorn
from test_domain import context
from workagent.api import Settings, create_app
from workagent.operator_client import OperatorClient, OperatorError
from workagent.operator_attachments import stage_text_files
from workagent.tui.session import Session


@pytest.fixture
def live_client(context, tmp_path, monkeypatch):
    service, principal, workspace, _, _ = context
    token='synthetic-real-tui-'+'x'*40
    sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen()
    port=sock.getsockname()[1]
    config=uvicorn.Config(create_app(Settings(service.db.dsn,True,token,principal.id,fixture_mode=True)),
                          log_level='critical',access_log=False)
    server=uvicorn.Server(config)
    thread=threading.Thread(target=server.run,kwargs={'sockets':[sock]},daemon=True)
    thread.start()
    deadline=time.monotonic()+10
    while not server.started and thread.is_alive() and time.monotonic()<deadline:time.sleep(.02)
    assert server.started,'Real disposable API did not start'
    monkeypatch.setenv('LOCAL_BEARER_TOKEN',token)
    monkeypatch.setenv('WORKAGENT_OPERATOR_URL',f'http://127.0.0.1:{port}')
    monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL',str(tmp_path/'journal'))
    monkeypatch.setenv('WORKAGENT_TUI_DRAFTS',str(tmp_path/'drafts'))
    client=OperatorClient()
    try:yield client,service,principal,workspace
    finally:
        server.should_exit=True;thread.join(10);sock.close()
        assert not thread.is_alive(),'Disposable HTTP process did not stop'


def test_real_http_restart_unknown_ack_exact_attachment_replay(live_client,tmp_path,context):
    client,service,principal,workspace=live_client
    assert client.identity(workspace)==principal.id
    session=Session(client,workspace,principal.id)
    text='  Plan the volunteer shift ♪\nKeep the notes.\n'
    session.edit(text=text)
    draft=session.draft
    create=session.prepare(draft,'chat',['Garden volunteer plan'])
    result=client.execute(create,lambda _:None)
    session.complete(draft,result)
    conversation=session.draft['conversation']
    # Text attachments require the explicit synthetic Responses admission scope;
    # no worker/provider call occurs in this transport/deduplication test.
    from test_general_responses import activate
    activate(context,[service.get_conversation(principal,workspace,conversation).conversation])
    file=tmp_path/'notes.txt';raw=b'\xef\xbb\xbfKeep Tuesday.\r\n  human note\r\n';file.write_bytes(raw)
    snapshots=[s.payload() for s in stage_text_files([file])]
    session.edit(attachments=snapshots)
    record=session.prepare(session.draft,'follow',[conversation,text],
        expected_work_version=session.draft['expected_work_version'],attachments=snapshots)
    file.unlink()
    original=client.opener
    class LostAck:
        def open(self,request,timeout):
            response=original.open(request,timeout=timeout)
            if request.method=='POST':
                response.read();response.close()
                raise urllib.error.URLError('synthetic acknowledgement loss')
            return response
    client.opener=LostAck()
    with pytest.raises(OperatorError):client.execute(record,lambda _:None)
    restarted_client=OperatorClient()
    restored=Session(restarted_client,workspace,principal.id)
    assert restored.key==conversation and restored.draft['text']==text
    assert restored.draft['attachments']==snapshots
    pending=restored.inspect(restored.draft)
    assert pending['record']==record
    receipt=restarted_client.run(workspace,'replay',[record['command_id']],principal_id=principal.id)
    restored.complete(restored.draft,receipt)
    detail=service.get_conversation(principal,workspace,conversation)
    assert len(detail.messages)==1 and detail.messages[0].text==text
    assert detail.messages[0].attachments[0].content.encode()==raw
    assert restored.draft['text']=='' and restored.draft['pending'] is None
    assert Session(OperatorClient(),workspace,principal.id).draft['text']==''
    with service.db.transaction() as connection:
        assert connection.execute('SELECT count(*) n FROM runs WHERE workspace_id=%s AND conversation_id=%s',
                                  (workspace,conversation)).fetchone()['n']==1
