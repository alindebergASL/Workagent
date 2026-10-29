"""Recovery controls through real loopback HTTP/restricted PG; no provider calls."""
import base64
import copy
import hashlib
import io
import urllib.error
import zipfile

import pytest
from test_domain import context
from test_conversations import conversation, post
from test_tui_real_stack_pg import live_client
from workagent.operator_client import OperatorClient, OperatorError
from workagent.tui.session import Session
from workagent.tui.continuity import can_stop
from workagent.models import TurnResult, TextResult
from workagent.errors import DomainError


def selected(client,p,ws,cv,version):
    session=Session(client,ws,p.id);session.select(cv.id)
    session.edit(text=' preserve exact\r\n雪 ');session.displayed(version)
    return session


def test_stop_completion_race_real_http_restart_abandon_and_fresh_send(live_client,context):
    client,s,p,ws=live_client;cv=conversation(context);q=post(context,cv)
    session=selected(client,p,ws,cv,q.conversation.work_version)
    record=session.prepare(session.draft,'stop',[cv.id,q.run.id],expected_work_version=q.conversation.work_version)
    cap=s.claim_run(p,ws,q.run.id)
    s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='Synthetic finished turn')]))
    with pytest.raises(OperatorError,match='rejected'):client.execute(record,lambda _:None)
    retained=client.journal.read(record['command_id'])
    assert retained['outcome']['state']=='rejected' and retained['outcome']['rejection']['status']==409
    assert retained['outcome']['rejection']['response']['code']=='action_unresolved'
    assert s.get_conversation(p,ws,cv.id).conversation.work_version==q.conversation.work_version
    restarted=OperatorClient();restored=Session(restarted,ws,p.id)
    restored.abandon_rejected(restored.draft)
    assert restored.draft['text']==' preserve exact\r\n雪 ' and restored.draft['pending'] is None
    detail=restarted.request('/'+ws+'/conversations/'+cv.id)
    restored.displayed(detail['conversation']['work_version'],deliberate=True)
    follow=restored.prepare(restored.draft,'follow',[cv.id,restored.draft['text']],
        expected_work_version=restored.draft['expected_work_version'])
    result=restarted.execute(follow,lambda _:None);restored.complete(restored.draft,result)
    assert result['receipt']['message']['text']==' preserve exact\r\n雪 '
    assert restarted.journal.read(record['command_id'])['record']==retained['record']
    assert len(s.get_conversation(p,ws,cv.id).runs)==2


@pytest.mark.parametrize('failure',[None,'internal_error'])
def test_stale_or_blocked_run_stop_lost_ack_replay_fences_worker(live_client,context,failure):
    client,s,p,ws=live_client;cv=conversation(context);q=post(context,cv)
    cap=s.claim_run(p,ws,q.run.id)
    if failure:
        with s.db.transaction() as c:
            c.execute('UPDATE run_dispatches SET failure_reason=%s WHERE workspace_id=%s AND run_id=%s',
                      (failure,ws,q.run.id))
    snapshot=client.request('/'+ws+'/work-snapshot?conversation_id='+cv.id)
    detail=client.request('/'+ws+'/conversations/'+cv.id)
    assert snapshot['execution']['state']==('blocked' if failure else 'stale')
    assert can_stop(snapshot,detail)
    session=selected(client,p,ws,cv,snapshot['work_version'])
    record=session.prepare(session.draft,'stop',[cv.id,snapshot['execution']['run_id']],
                           expected_work_version=snapshot['work_version'])
    original=client.opener;posts=[]
    class LostAck:
        def open(self,request,timeout):
            response=original.open(request,timeout=timeout)
            if request.method=='POST':
                posts.append(request.data);response.read();response.close()
                raise urllib.error.URLError('synthetic lost STOP acknowledgement after commit')
            return response
    client.opener=LostAck()
    with pytest.raises(OperatorError):client.execute(record,lambda _:None)
    assert len(posts)==1 and client.journal.read(record['command_id'])['outcome']['state']=='outcome_unknown'
    stopped=s.get_run(p,ws,q.run.id)
    assert stopped.state=='cancelled' and stopped.fence==cap.fence+1
    restarted=OperatorClient();restored=Session(restarted,ws,p.id)
    assert restored.inspect(restored.draft)['record']==record
    with pytest.raises(OperatorError,match='unknown effects'):restored.abandon_rejected(restored.draft)
    result=restarted.run(ws,'replay',[record['command_id']],principal_id=p.id)
    restored.complete(restored.draft,result)
    assert s.get_run(p,ws,q.run.id)==stopped
    assert s.get_conversation(p,ws,cv.id).conversation.work_version==snapshot['work_version']+1
    assert restored.draft['text']==' preserve exact\r\n雪 ' and restored.draft['pending'] is None
    with pytest.raises(DomainError):s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='Late publication')]))
    # A fresh worker instance cannot claim this stopped run either.
    from workagent.service import Service
    with pytest.raises(DomainError):Service(s.db).claim_run(p,ws,q.run.id)
    assert not can_stop(client.request('/'+ws+'/work-snapshot?conversation_id='+cv.id),
                        client.request('/'+ws+'/conversations/'+cv.id))


def test_real_confined_container_rejection_can_be_abandoned(live_client,context):
    client,s,p,ws=live_client;cv=conversation(context)
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as archive:archive.writestr('ordinary.txt','not an Office container')
    raw=output.getvalue()
    document={'filename':'wrong.docx','mime_type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'content_base64':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest()}
    session=selected(client,p,ws,cv,cv.work_version);session.edit(documents=[document])
    # Mirror the sender's persisted frozen delivery before its first upload;
    # a pending upload without that lifecycle must remain unrecoverable.
    d=session.draft
    d['delivery']={k:copy.deepcopy(d[k]) for k in ('text','attachments','documents','target','generation')}
    d['delivery'].update(action='follow',refs=[],version=cv.work_version);session.save()
    record=session.prepare(session.draft,'document',[cv.id],document=document)
    with pytest.raises(OperatorError,match='rejected'):client.execute(record,lambda _:None)
    outcome=client.journal.read(record['command_id'])['outcome']
    assert outcome['state']=='rejected' and outcome['rejection']['status']==422
    assert outcome['rejection']['response']['code']=='validation_error'
    assert s.list_documents(p,ws,cv.id).items==[]
    restored=Session(OperatorClient(),ws,p.id);restored.abandon_rejected(restored.draft)
    assert restored.draft['documents']==[document] and restored.draft['text']==' preserve exact\r\n雪 '
    assert restored.draft['pending'] is None and restored.draft['stage']=='refresh_required'
