import base64
import copy
import hashlib
import json
import io
import pytest
from workagent.operator_client import OperatorClient
from workagent.operator_journal import OperatorError, MAX_BYTES
from workagent.operator_attachments import stage_documents, save_download
from workagent.tui.session import Session
from workagent.tui.drafts import new_draft
from test_tui_composer import private_state


def document(raw=b'%PDF-1.4\r\nexact\x00bytes'):
    return {'filename':'test.pdf','mime_type':'application/pdf','content_base64':base64.b64encode(raw).decode(),
            'sha256':hashlib.sha256(raw).hexdigest()}


def test_actual_command_shapes_and_exact_journal_replay():
    from workagent.models import PostMessage, IngestDocument
    from workagent.checkpoint_models import StopRun,ContinueRun,CancelQueuedMessage
    from workagent.work_event_models import AttentionSeen
    client=OperatorClient()
    cases=[('stop',['c','r'],StopRun,{}),('continue',['c','cp','a'*64],ContinueRun,{}),
        ('queue-cancel',['c','q','3'],CancelQueuedMessage,{}),('seen',['c','opaque'],AttentionSeen,{}),
        ('queue',['c',' exact\r\ntext '],PostMessage,{}),('document',['c'],IngestDocument,{'document':document()}),
        ('follow',['c','docs'],PostMessage,{'document_refs':[{'document_id':'d','sha256':'a'*64}]})]
    for action,args,model,extra in cases:
        record=client.prepare('ws',action,args,principal_id='human',expected_work_version=2,**extra)
        model.model_validate(record['body']);client.journal.reserve(record)
        before=client.wire_body(record['body'],document_upload=action=='document')
        client.journal.outcome(record['command_id'],'outcome_unknown')
        restored=client.journal.read(record['command_id'])['record']
        client.validate_record(restored,'ws',principal_id='human')
        assert client.wire_body(restored['body'],document_upload=action=='document')==before
        with pytest.raises(OperatorError):client.validate_record(restored,'ws',principal_id='different')


def test_binary_bounds_scoped_and_original_never_reread(tmp_path):
    raw=b'%PDF-'+b'\x00'*(5*1024*1024-5);path=tmp_path/'test.pdf';path.write_bytes(raw)
    docs=stage_documents([path]);path.unlink()
    client=OperatorClient();record=client.prepare('ws','document',['c'],principal_id='human',document=docs[0])
    assert len(client.wire_body(record['body'],document_upload=True))>MAX_BYTES
    with pytest.raises(OperatorError):client.wire_body(record['body'])
    client.journal.reserve(record);assert client.journal.read(record['command_id'])['record']==record
    session=Session(client,'ws','human');session.edit(documents=docs)
    restored=Session(client,'ws','human');assert restored.draft['documents']==docs
    path.write_bytes(raw+b'x')
    with pytest.raises(OperatorError):stage_documents([path])
    bad=copy.deepcopy(record);bad['action']='follow';bad['command_id']='oversize-other'
    with pytest.raises(OperatorError):client.journal.reserve(bad)


def test_download_exclusive_hash_and_symlinks(tmp_path):
    raw=b'%PDF- bytes';sha=hashlib.sha256(raw).hexdigest();dest=tmp_path/'saved.pdf'
    save_download(str(dest),raw,sha);assert dest.read_bytes()==raw
    with pytest.raises(OperatorError):save_download(str(dest),b'changed',hashlib.sha256(b'changed').hexdigest())
    assert dest.read_bytes()==raw
    with pytest.raises(OperatorError):save_download(str(tmp_path/'bad.pdf'),raw,'0'*64)
    link=tmp_path/'link';link.symlink_to(tmp_path,target_is_directory=True)
    with pytest.raises(OperatorError):save_download(str(link/'copy.pdf'),raw,sha)


def test_unknown_upload_restarts_with_same_envelope_and_no_new_effect():
    client=OperatorClient();session=Session(client,'ws','human');session.select('c');session.edit(text='frozen',documents=[document()]);session.displayed(1)
    d=session.draft;d['delivery']={k:copy.deepcopy(d[k]) for k in ('text','attachments','documents','target','generation')}
    d['delivery'].update(action='follow',refs=[],version=1);session.save()
    record=session.prepare(d,'document',['c'],document=d['documents'][0]);calls=[]
    def unknown(path,body=None):calls.append(copy.deepcopy(body));raise OperatorError('unknown')
    client.request=unknown
    with pytest.raises(OperatorError):client.execute(record,lambda _:None)
    restarted=Session(client,'ws','human');assert restarted.draft['delivery']['text']=='frozen'
    with pytest.raises(OperatorError):restarted.prepare(restarted.draft,'document',['c'],document=document())
    assert len(calls)==1
    with pytest.raises(OperatorError):client.run('ws','replay',[record['command_id']],principal_id='human')
    assert calls==[record['body'],record['body']]


def test_legacy_formats_wire_bytes_unchanged():
    client=OperatorClient()
    for fmt in (1,2,3):
        cid='legacy'+str(fmt);args=['c',' exact 雪\r\n ']
        path,fields=(client.payload_v1 if fmt==1 else client.payload)('follow',args,1)
        record={'format':fmt,'command_id':cid,'base':client.base,'workspace':'ws','action':'follow','args':args,
                'path':'/ws'+path,'body':{'schema_version':'workagent/v1','request_id':cid,'command_id':cid,**fields}}
        if fmt==3:record['principal_id']='human'
        client.journal.reserve(record);before=json.dumps(record['body']).encode()
        client.journal.outcome(cid,'outcome_unknown');saved=client.journal.read(cid)['record']
        client.validate_record(saved,'ws',principal_id='human');assert client.wire_body(saved['body'])==before


def test_document_request_scoped_limit_and_exact_request_id():
    client=OperatorClient();captured=[]
    class Response(io.BytesIO):headers={}
    class Opener:
        def open(self,request,timeout):captured.append(request);return Response(b'{}')
    client.opener=Opener();body={'request_id':'exact','content_base64':'x'*300000}
    client.request('/ws/conversations/c/documents',body)
    assert captured[0].headers['X-request-id']=='exact'
    for path in ('/ws/conversations/c/messages','/ws/conversations/c/documents/d','/ws/documents'):
        with pytest.raises(OperatorError):client.request(path,body)
    assert len(captured)==1


def test_queue_stop_continue_and_seen_readback_actual_field_shapes():
    from workagent.checkpoint_models import QueuedMessage
    from workagent.tui.commands import readback
    client=OperatorClient()
    queue=client.prepare('ws','queue',['c','held exact\r\n'],principal_id='human',expected_work_version=7)
    saved=QueuedMessage(id='q',conversation_id='c',owner_id='human',position=3,created_at='2026-10-26T00:00:00Z',
        intent=queue['body'],admission_work_version=7,access_generation=1,dependency_fingerprint='a'*64,
        state='held',reason='work_changed').model_dump(mode='json')
    reads=[]
    def request(path,body=None):
        reads.append(path)
        if '/queued-messages' in path:return {'items':[saved]}
        if '/attention?' in path:return {'facts':[]}
        return {'id':path.rsplit('/',1)[1],'conversation_id':'c'}
    client.request=request
    assert readback(client,queue,saved)['items'][0]['state']=='held'
    assert reads[-1].endswith('?after=2')
    cancel=client.prepare('ws','queue-cancel',['c','q','1'],principal_id='human')
    saved={**saved,'state':'cancelled','reason':None,'queue_version':2}
    readback(client,cancel,saved)
    stop=client.prepare('ws','stop',['c','exact-run'],principal_id='human',expected_work_version=7)
    readback(client,stop,{'id':'exact-run'})
    with pytest.raises(OperatorError):readback(client,stop,{'id':'other-run'})
    continuation=client.prepare('ws','continue',['c','checkpoint','b'*64],principal_id='human',expected_work_version=7)
    readback(client,continuation,{'id':'successor'})
    seen=client.prepare('ws','seen',['c','earlier-cursor'],principal_id='human')
    readback(client,seen,{'conversation_id':'c','cursor':'server-monotonic-newer'})


def test_ordinary_draft_bound_not_raised_for_metadata():
    client=OperatorClient();session=Session(client,'ws','human')
    state=copy.deepcopy(session.state)
    for n in range(64):
        d=new_draft();d.update(conversation='c'+str(n),text='雪'*10000)
        state['drafts']['c'+str(n)]=d
    state['drafts'].pop('__new__');state['selected']='c0'
    with pytest.raises(OperatorError):session.store.save(state)


def test_confirmed_dispatch_requires_exact_reserved_body():
    client=OperatorClient();record=client.prepare('ws','stop',['c','r'],principal_id='human',expected_work_version=1)
    client.journal.reserve(record);changed=copy.deepcopy(record);changed['body']['run_id']='other'
    client.request=lambda *a:pytest.fail('modified envelope dispatched')
    with pytest.raises(OperatorError,match='reserved'):client.execute(changed,lambda _:None)
