"""Canonical endpoint fixtures, not claims about a running backend or parser."""
import asyncio
import copy
import hashlib
import base64
import threading
from urllib.parse import urlsplit,parse_qs
import pytest
from textual.widgets import TextArea, Select, Button, TabbedContent
from workagent.operator_journal import OperatorError
from workagent.tui.app import WorkagentApp
from workagent.tui.session import Session
from workagent.tui.continuity import read,can_continue
from workagent.work_event_models import WorkSnapshot, EventPage, AttentionPage
from workagent.document_models import DocumentDetail,LIMITS,PARSER_VERSION
from test_tui_composer import FakeClient,private_state
from test_tui_continuity_commands import document

STAMP='2026-10-26T00:00:00Z'

class ContinuityClient(FakeClient):
    def __init__(self):
        super().__init__();self.generation=1;self.reads=[];self.docs={};self.posts=[];self.upload_gate=None;self.upload_entered=threading.Event();self.deny=False
    def request(self,path,body=None):
        url=urlsplit(path);query=parse_qs(url.query);cid=query.get('conversation_id',['c1'])[0]
        if body is not None:
            self.posts.append((path,copy.deepcopy(body)))
            if path.endswith('/documents'):
                self.upload_entered.set()
                if self.upload_gate:self.upload_gate.wait(8)
                d=DocumentDetail(document_id='d'+str(len(self.docs)),workspace_id='workspace',conversation_id=path.split('/')[3],owner_id='human',
                    filename=body['filename'],mime_type=body['mime_type'],sha256=body['sha256'],byte_length=len(base64.b64decode(body['content_base64'])),
                    status='unavailable',reason='fixture parser unavailable',parser_version=PARSER_VERSION,text='',text_bytes=0,
                    text_sha256=hashlib.sha256(b'').hexdigest(),coverage={'omissions':['No parser in fixture']},limits=LIMITS).model_dump(mode='json')
                self.docs[d['document_id']]=d;return d
            if path.endswith('/messages'):
                message={'id':body['command_id'],'author_kind':'human','text':body['text'],'target':body['target'],
                         'attachments':body['attachments'],'document_refs':[self.docs[r['document_id']] for r in body.get('document_refs',[])]}
                self.messages.append(message);return {'message':message,'run':{'id':'run'}}
            if path.endswith('/attention/seen'):return {'conversation_id':body['conversation_id'],'cursor':body['cursor']}
        self.reads.append(path)
        if self.deny and '/work-snapshot' in path:raise OperatorError('HTTP 404: access denied')
        if '/work-snapshot' in path:
            return WorkSnapshot(conversation_id=cid,work_version=1,access_generation=self.generation,checked_at=STAMP,snapshot_cursor='snap'+str(self.generation),
                execution={'state':'idle'},responsibility=[],artifacts=[],pending_proposals=[]).model_dump(mode='json')
        if '/events?' in path:return EventPage(events=[],next_cursor='page'+str(self.generation),has_more=False,checked_at=STAMP).model_dump(mode='json')
        if '/attention?' in path:return AttentionPage(facts=[],next_cursor='attention'+str(self.generation),has_more=False,checked_at=STAMP).model_dump(mode='json')
        if path.endswith(('/queued-messages','/checkpoints')):return {'items':[]}
        if path.endswith('/documents'):return {'items':list(self.docs.values()),'next_cursor':None}
        if '/documents/' in path:return self.docs[path.rsplit('/',1)[1]]
        return super().request(path,body)


def test_cursor_scoped_retained_and_generation_reset():
    client=ContinuityClient()
    first=read(client,'workspace','c1');read(client,'workspace','c1',first['continuity'])
    assert 'after=page1' in client.reads[-2]
    client.generation=2;new=read(client,'workspace','c1',first['continuity'])
    assert new['generation_changed'] and 'after=snap2' in client.reads[-2]
    cp={'conversation_id':'c1','data':{'waiting':'unknown','next_safe_action':'continue_slice','access_generation':2,'conversation_work_version':1}}
    assert not can_continue(cp,new['snapshot'])


@pytest.mark.parametrize('size',[(80,24),(120,40)])
def test_keyboard_layout_scope_loss_and_preserved_draft(size):
    async def scenario():
        client=ContinuityClient();session=Session(client,'workspace','human');session.select('c1');session.edit(text='saved draft')
        app=WorkagentApp(client,'workspace')
        async with app.run_test(size=size) as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            assert app.canonical and app.read_authorized
            composer=app.query_one('#composer',TextArea);assert composer.text=='saved draft'
            assert composer.region.bottom<=size[1]
            assert app.query_one('#queue',Button).region.right<=size[0]
            app.query_one('#panels',TabbedContent).active='status-panel';await pilot.pause()
            await pilot.press('tab','tab','tab');assert app.focused is not None
            client.generation=2;app.action_refresh();await app.workers.wait_for_complete()
            assert app.session.draft['continuity']['access_generation']==2 and composer.text=='saved draft'
            client.deny=True;app.action_refresh();await app.workers.wait_for_complete()
            assert not app.read_authorized and app.canonical is None and composer.text=='saved draft'
            assert app.detail is None and app.documents==[]
    asyncio.run(scenario())


def test_upload_pending_edits_keep_frozen_message_and_new_draft():
    async def scenario():
        client=ContinuityClient();client.upload_gate=threading.Event()
        session=Session(client,'workspace','human');session.edit(text='frozen text',documents=[document()])
        app=WorkagentApp(client,'workspace')
        async with app.run_test(size=(80,24)) as pilot:
            await app.workers.wait_for_complete();app.action_send()
            for _ in range(1000):
                if client.upload_entered.is_set():break
                await asyncio.sleep(.005)
            assert client.upload_entered.is_set()
            composer=app.query_one('#composer',TextArea);composer.load_text('edited while uploading');await pilot.pause()
            app.persist(documents=[document(b'%PDF-CHANGED')])
            client.upload_gate.set();await app.workers.wait_for_complete();await pilot.pause()
            assert [p[0].rsplit('/',1)[1] for p in client.posts]==['conversations','documents','messages']
            sent=client.posts[-1][1];assert sent['text']=='frozen text' and sent['document_refs']==[{'document_id':'d0','sha256':document()['sha256']}]
            assert composer.text=='edited while uploading' and app.session.draft['documents'][0]['sha256']!=document()['sha256']
            assert app.session.draft['delivery'] is None and app.pending_command is None
            assert client.docs['d0']['status']=='unavailable' and not client.docs['d0']['text']
    asyncio.run(scenario())


def test_lost_upload_ack_restart_replays_exact_then_sends_without_new_upload():
    async def scenario():
        client=ContinuityClient();original=client.request;cached={};lost=[False]
        def request(path,body=None):
            if body is not None and path.endswith('/documents'):
                cid=body['command_id']
                if cid in cached:return cached[cid]
                cached[cid]=original(path,body);lost[0]=True
                raise OperatorError('lost upload acknowledgement')
            return original(path,body)
        client.request=request;client.real.request=request
        session=Session(client,'workspace','human');session.select('c1');session.edit(text='retained',documents=[document()])
        app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete();app.action_send();await app.workers.wait_for_complete()
            assert lost[0] and app.pending_command
            saved=app.session.inspect(app.session.draft)['record'];assert saved['action']=='document'
            assert len(client.docs)==1 and len(client.messages)==0
        app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete();assert app.pending_command==saved['command_id']
            app.action_send();await pilot.pause();assert len(client.messages)==0
            app.start_write(app.recover('replay'));await app.workers.wait_for_complete()
            assert app.pending_command is None and app.session.draft['delivery']['refs']==[{'document_id':'d0','sha256':document()['sha256']}]
            app.action_send();await app.workers.wait_for_complete()
            assert len(client.docs)==1 and len(client.messages)==1 and app.session.draft['text']==''
    asyncio.run(scenario())


@pytest.mark.parametrize('name',['test_ordinary_typing_newlines_send_and_detach','test_slow_send_does_not_freeze_typing_or_double_post'])
def test_b22_interactions_with_current_endpoint_fixtures(monkeypatch,name):
    import test_tui_composer as legacy
    monkeypatch.setattr(legacy,'FakeClient',ContinuityClient)
    # The fixture keeps the old blocking message behavior for this regression.
    original=ContinuityClient.request
    def request(self,path,body=None):
        if body is not None and path.endswith('/messages') and self.block:self.block.wait(5)
        return original(self,path,body)
    monkeypatch.setattr(ContinuityClient,'request',request)
    getattr(legacy,name)()


def test_event_pages_retained_no_domain_patch_and_reset_fail_closed():
    client=ContinuityClient();original=client.request
    def request(path,body=None):
        if '/events?' in path:
            after=parse_qs(urlsplit(path).query)['after'][0]
            return EventPage(events=[],next_cursor='next-page' if after!='next-page' else 'done-page',
                has_more=after!='next-page',checked_at=STAMP).model_dump(mode='json')
        return original(path,body)
    client.request=request
    first=read(client,'workspace','c1');assert first['events']['has_more']
    second=read(client,'workspace','c1',first['continuity']);assert second['continuity']['cursor']=='done-page'
    assert second['snapshot']['execution']['state']=='idle'
    def reset(path,body=None):
        if '/events?' in path:return EventPage(events=[],next_cursor='reset',has_more=False,reset_required=True,checked_at=STAMP).model_dump(mode='json')
        return original(path,body)
    client.request=reset
    with pytest.raises(OperatorError,match='scope reset'):read(client,'workspace','c1',second['continuity'])


def test_continue_exact_boundary_fail_closed():
    client=ContinuityClient();snapshot=read(client,'workspace','c1')['snapshot'];snapshot['execution']['run_id']='r'
    cp={'continuation_supported':True,'run_id':'r','conversation_id':'c1','checkpoint_kind':'settlement','data':{
        'waiting':'none','next_safe_action':'continue_slice','access_generation':1,'conversation_work_version':1}}
    assert can_continue(cp,snapshot)
    for supported in (False,None):
        altered=copy.deepcopy(cp);altered['continuation_supported']=supported
        assert not can_continue(altered,snapshot)
    altered=copy.deepcopy(cp);del altered['continuation_supported']
    assert not can_continue(altered,snapshot)
    for state in ('unknown','recovering','running','queued','awaiting_provider'):
        altered=copy.deepcopy(snapshot);altered['execution']['state']=state
        assert not can_continue(cp,altered)
    cp['data']['waiting']='unknown';assert not can_continue(cp,snapshot)


def test_stop_uses_clicked_run_even_when_refresh_changes_snapshot():
    async def scenario():
        client=ContinuityClient();original=client.request
        def request(path,body=None):
            if body is not None and path.endswith('/stop'):
                client.posts.append((path,copy.deepcopy(body)));return {'id':body['run_id']}
            if path.endswith('/runs/clicked-run'):return {'id':'clicked-run','conversation_id':'c1'}
            return original(path,body)
        client.request=request;client.real.request=request
        session=Session(client,'workspace','human');session.select('c1');session.edit(text='keep me')
        app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete()
            await pilot.pause();await app.workers.wait_for_complete()
            assert app.canonical is not None
            app.canonical['execution'].update(state='running',run_id='clicked-run');selection=app.control_selection()
            app.canonical['execution']['run_id']='newer-run';app.canonical['work_version']=9
            app.start_write(app.continuity_write('stop',selection));await app.workers.wait_for_complete()
            body=client.posts[-1][1];assert body['run_id']=='clicked-run' and body['expected_work_version']==1
            assert app.session.draft['text']=='keep me' and app.pending_command is None
    asyncio.run(scenario())


@pytest.mark.parametrize('failed',['context','execution','catalog','conversation'])
def test_b22_independent_reads_with_canonical_endpoint_fixture(monkeypatch,failed):
    import test_tui_b22_corrections as legacy
    original=ContinuityClient.request
    def request(self,path,body=None):
        result=original(self,path,body)
        if '/work-snapshot?' in path:
            result['artifacts']=[{'id':'a1','title':'Saved result','kind':'document','current_revision_id':'rev','body_hash':'a'*64}]
        return result
    monkeypatch.setattr(ContinuityClient,'request',request)
    monkeypatch.setattr(legacy,'FakeClient',ContinuityClient)
    legacy.test_independent_reads_render_success_and_explicit_failures(failed)
