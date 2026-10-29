"""Local durable state and HTTP protocol regressions. No service or provider calls."""
import asyncio
import json
import os
import threading
import pytest
from workagent.operator_client import OperatorClient, OperatorError
from workagent.operator_attachments import stage_text_files
from workagent.tui.drafts import DraftStore, new_draft
from workagent.tui.transport import ReadLane


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv('LOCAL_BEARER_TOKEN', 'x'*40)
    monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL', str(tmp_path/'commands'))
    return OperatorClient()


def test_draft_restart_exact_scope_and_generation(tmp_path):
    scope=('http://127.0.0.1:8000','workspace','actual-human')
    store=DraftStore(*scope,path=tmp_path/'drafts')
    draft=new_draft();draft.update(text=' \ufeff雪\r\n\t ',generation=7,
        target={'artifact_id':'a','revision_id':'r','body_hash':'a'*64},
        pending={'command_id':'cid','action':'chat','generation':7},stage='creating')
    file=tmp_path/'source.txt';file.write_bytes(b'\xef\xbb\xbfexact\r\n')
    draft['attachments']=[s.payload() for s in stage_text_files([file])]
    store.save({'selected':'__new__','drafts':{'__new__':draft}})
    file.unlink()
    assert DraftStore(*scope,path=tmp_path/'drafts').load()['drafts']['__new__']==draft
    assert DraftStore(scope[0],scope[1],'another-human',path=tmp_path/'drafts').load() is None
    assert (tmp_path/'drafts').stat().st_mode & 0o777==0o700
    assert all(p.stat().st_mode & 0o777==0o600 for p in (tmp_path/'drafts').iterdir())


@pytest.mark.parametrize('damage',['symlink','parent','mode','corrupt','scope','hardlink'])
def test_draft_unsafe_storage_fails_closed(tmp_path,damage):
    store=DraftStore('http://localhost:8000','w','p',path=tmp_path/'drafts')
    store.save({'selected':'__new__','drafts':{'__new__':new_draft()}})
    file=next((tmp_path/'drafts').iterdir())
    if damage=='symlink':
        other=tmp_path/'other';file.rename(other);file.symlink_to(other)
    elif damage=='parent':
        other=tmp_path/'other';(tmp_path/'drafts').rename(other);(tmp_path/'drafts').symlink_to(other)
    elif damage=='mode':file.chmod(0o644)
    elif damage=='corrupt':file.write_text('{')
    elif damage=='hardlink':os.link(file,tmp_path/'other')
    else:
        from workagent.operator_journal import digest
        data=json.loads(file.read_text());data['record']['scope']['principal']='different'
        data['digest']=digest(data['record']);file.write_text(json.dumps(data))
    with pytest.raises(OperatorError):store.load()


def test_explicit_version_and_attachment_replay_never_read_path_or_cas(client,tmp_path):
    file=tmp_path/'note.txt';file.write_bytes('\ufeff雪\r\n'.encode())
    attachments=[s.payload() for s in stage_text_files([file])]
    posts=[];reads=[]
    def request(path,body=None):
        if body is not None:
            posts.append(body)
            raise OperatorError('unknown')
        reads.append(path);raise AssertionError('No hidden version read')
    client.request=request
    with pytest.raises(OperatorError):
        client.run('w','follow',['c',' exact ','a','r','a'*64],command_id='exact',
                   expected_work_version=7,attachments=attachments,principal_id='p')
    file.unlink()
    with pytest.raises(OperatorError):client.run('w','replay',['exact'],principal_id='p')
    assert posts[0]==posts[1] and posts[0]['expected_work_version']==7
    assert posts[0]['attachments']==attachments and not reads
    with pytest.raises(OperatorError):client.run('w','replay',['exact'],principal_id='other')
    assert len(posts)==2


def test_utf8_size_preflight_precedes_journal_and_network(client):
    # Within attachment input limit but JSON escaping makes the real body too big.
    with pytest.raises(OperatorError,match='request'):
        client.prepare('w','follow',['c','text'],command_id='large',expected_work_version=1,
                       attachments=[{'filename':'a.txt','mime_type':'text/plain','content':'\n'*150000}],principal_id='p')
    assert not list(__import__('pathlib').Path(client.journal.path).glob('*.json'))


def test_cancelled_read_waiter_does_not_release_actual_thread():
    async def scenario():
        lane=ReadLane();release=threading.Event();started=threading.Event();calls=[]
        def blocked():
            calls.append(1);started.set();release.wait(3);return 1
        task=asyncio.create_task(lane.read(blocked))
        while not started.is_set():await asyncio.sleep(.001)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):await task
        for _ in range(20):assert await lane.read(blocked) is None
        assert len(calls)==1
        release.set()
        while lane.busy:await asyncio.sleep(.001)
        assert await lane.read(lambda:2)==2
        lane.close()
    asyncio.run(scenario())


def make_session(client,tmp_path):
    from workagent.tui.session import Session
    return Session(client,'w','p',store=DraftStore(client.base,'w','p',path=tmp_path/'drafts'))


def test_create_readback_restart_reuses_created_identity(client,tmp_path):
    session=make_session(client,tmp_path);session.edit(text=' exact\n雪 ')
    draft=session.draft
    record=session.prepare(draft,'chat',['A title'])
    # Receipt retained, but its readback was interrupted before the UI transition.
    receipt={'id':'created','owner_id':'p','work_version':1}
    client.journal.outcome(record['command_id'],'readback_unknown',receipt)
    restarted=make_session(client,tmp_path)
    assert restarted.draft['stage']=='creating'
    calls=[]
    def request(path,body=None):
        assert body is None,'Read back must not POST'
        calls.append(path)
        return {'conversation':receipt}
    client.request=request
    result=client.run('w','readback',[record['command_id']],principal_id='p')
    restarted.complete(restarted.draft,result)
    again=make_session(client,tmp_path)
    assert again.key=='created' and again.draft['conversation']=='created'
    assert again.draft['text']==' exact\n雪 ' and again.draft['pending'] is None
    assert calls==['/w/conversations/created']


def test_unknown_create_stays_locked_on_restart(client,tmp_path):
    session=make_session(client,tmp_path);session.edit(text='hello')
    record=session.prepare(session.draft,'chat',['hello'])
    client.journal.outcome(record['command_id'],'outcome_unknown')
    restarted=make_session(client,tmp_path)
    with pytest.raises(OperatorError,match='Resolve'):
        restarted.prepare(restarted.draft,'chat',['new'])
    assert not restarted.recover_unprepared(restarted.draft)
    client.request=lambda *a,**kw:pytest.fail('No HTTP without receipt on readback')
    with pytest.raises(OperatorError,match='No retained receipt'):
        client.run('w','readback',[record['command_id']],principal_id='p')


def test_prejournal_errors_do_not_permanently_lock(client,tmp_path,monkeypatch):
    session=make_session(client,tmp_path);session.select('c');session.edit(text='hello')
    with pytest.raises(OperatorError):session.prepare(session.draft,'follow',['c','hello'],expected_work_version=None)
    assert session.draft['pending'] is None
    def failed(record):raise OperatorError('disk full before reservation')
    monkeypatch.setattr(client.journal,'reserve',failed)
    with pytest.raises(OperatorError):session.prepare(session.draft,'follow',['c','hello'],expected_work_version=1)
    assert session.draft['pending'] is None
    # Also cover a crash after marker fsync and before envelope reservation.
    session.draft['pending']={'command_id':'missing','action':'follow','generation':1}
    session.draft['stage']='following';session.save()
    restarted=make_session(client,tmp_path)
    assert restarted.recover_unprepared(restarted.draft)
    assert restarted.draft['pending'] is None


def test_edited_generation_survives_exact_follow_completion(client,tmp_path):
    session=make_session(client,tmp_path);session.select('c');session.edit(text='first')
    draft=session.draft
    record=session.prepare(draft,'follow',['c','first'],expected_work_version=7)
    session.edit(text='first + next')
    client.journal.outcome(record['command_id'],'confirmed',{'message':{'id':'m'}})
    session.complete(draft,{'command_id':record['command_id'],'receipt':{'message':{'id':'m'}},'readback':{}})
    assert session.draft['text']=='first + next'
    assert make_session(client,tmp_path).draft['text']=='first + next'


def test_wrong_message_readback_does_not_confirm(client):
    record=client.prepare('w','follow',['c','exact'],principal_id='p',expected_work_version=2)
    client.journal.reserve(record)
    message={'id':'m','text':'exact','target':None,'attachments':[]}
    client.request=lambda path,body=None: {'message':message} if body else {'messages':[{**message,'text':'different'}]}
    with pytest.raises(OperatorError,match='readback mismatch'):client.execute(record,lambda value:None)
    assert client.journal.read(record['command_id'])['outcome']['state']=='readback_unknown'


def test_v3_mutation_replay_refuses_scope_body_and_consent_changes(client):
    record=client.prepare('w','accept',['p1','a','rev'],principal_id='p',
                          acknowledge_removed_content=True,acknowledge_older_proposal=False)
    client.validate_record(record,'w',principal_id='p')
    for key,value in [('path','/w/proposals/other/accept'),('principal_id','someone'),('base','http://localhost:9999')]:
        modified={**record,key:value}
        with pytest.raises(OperatorError):client.validate_record(modified,'w',principal_id='p')
    modified={**record,'body':{**record['body'],'acknowledge_removed_content':'true'}}
    with pytest.raises(OperatorError):client.validate_record(modified,'w',principal_id='p')


def test_identity_never_uses_owner_or_token(client):
    client.request=lambda *a,**kw:{'owner_id':'someone','principal_id':'untrusted-body-field'}
    with pytest.raises(OperatorError,match='identity'):client.identity('w')


def test_http_principal_is_from_authenticated_header_and_missing_fails_closed(client):
    import io
    class Response(io.BytesIO):
        headers={'X-Workagent-Principal':'actual-human'}
    class Opener:
        def open(self,request,timeout):return Response(b'{}')
    client.opener=Opener()
    assert client.identity('w')=='actual-human'
    Response.headers={}
    with pytest.raises(OperatorError):client.identity('w')


def test_failed_durable_completion_keeps_pending_lock(client,tmp_path,monkeypatch):
    session=make_session(client,tmp_path);session.select('c');session.edit(text='sent')
    draft=session.draft
    record=session.prepare(draft,'follow',['c','sent'],expected_work_version=1)
    client.journal.outcome(record['command_id'],'confirmed',{'message':{'id':'m'}})
    def fail(state):raise OperatorError('fsync failed')
    monkeypatch.setattr(session.store,'save',fail)
    with pytest.raises(OperatorError):
        session.complete(draft,{'command_id':record['command_id'],'receipt':{'message':{'id':'m'}},'readback':{}})
    assert session.draft['pending']['command_id']==record['command_id']
    assert session.draft['text']=='sent'
    assert make_session(client,tmp_path).draft['pending']==session.draft['pending']


def test_completion_without_confirmed_receipt_cannot_clear_draft(client,tmp_path):
    session=make_session(client,tmp_path);session.select('c');session.edit(text='retain')
    record=session.prepare(session.draft,'follow',['c','retain'],expected_work_version=1)
    with pytest.raises(OperatorError,match='confirmed'):
        session.complete(session.draft,{'command_id':record['command_id'],'receipt':{},'readback':{}})
    assert session.draft['text']=='retain' and session.draft['pending']


def test_two_local_sessions_cannot_overwrite_each_others_drafts(client,tmp_path):
    first=make_session(client,tmp_path)
    second=make_session(client,tmp_path)
    first.edit(text='Human edit in first terminal')
    with pytest.raises(OperatorError,match='another session'):
        second.edit(text='Stale second terminal')
    assert make_session(client,tmp_path).draft['text']=='Human edit in first terminal'
