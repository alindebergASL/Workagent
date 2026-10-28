"""A30 transient transcript repaint regression; Pilot supplements native PTY."""
import asyncio
import io
import urllib.error
import pytest
from textual.widgets import Static,TextArea,Button
from textual.document._document import Selection
from workagent.operator_client import OperatorClient
from workagent.tui.app import WorkagentApp
from workagent.tui.session import Session
from test_tui_composer import private_state
from test_tui_continuity_ui import ContinuityClient

class LongClient(ContinuityClient):
    failure=None
    def request(self,path,body=None):
        if path=='/workspace/conversations/c1' and self.failure:
            class Opener:
                def open(_,req,timeout):
                    raise urllib.error.HTTPError(req.full_url,self.failure,'fixture outage',{},io.BytesIO(b'{}'))
            client=OperatorClient.__new__(OperatorClient);client.base='http://127.0.0.1:1';client.token='x'*32;client.opener=Opener()
            return client.request(path)
        result=super().request(path,body)
        if path=='/workspace/conversations/c1':
            result['messages']=[{'id':str(i),'author_kind':'human','text':f'Synthetic history {i} '+('readable long text '*35)} for i in range(80)]
        return result

@pytest.mark.parametrize('size',[(120,40),(80,24)])
def test_transient_transcript_retains_scroll_without_granting_writes(size):
    async def scenario():
        client=LongClient();session=Session(client,'workspace','human');session.select('c1');session.edit(text='unsent draft')
        app=WorkagentApp(client,'workspace')
        async with app.run_test(size=size) as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            scroll=app.query_one('#timeline-scroll');scroll.scroll_to(y=30,animate=False);composer=app.query_one('#composer',TextArea);composer.focus();composer.selection=Selection((0,2),(0,6));await pilot.pause()
            before=(scroll.scroll_y,composer.text,composer.selection,str(app.query_one('#timeline',Static).content))
            assert before[0]>0
            for _ in range(2):
                client.failure=503;app.action_refresh();await app.workers.wait_for_complete();await pilot.pause()
                assert (scroll.scroll_y,composer.text,composer.selection,str(app.query_one('#timeline',Static).content))==before
                assert app.detail is None and not app.read_authorized
                assert 'last read' in str(app.query_one('#status',Static).content)
                assert 'Refresh' in str(app.query_one('#status',Static).content)
                app.action_send();await pilot.pause()
                assert not app.sending and not client.posts and app.pending_command is None
            client.failure=None;app.action_refresh();await app.workers.wait_for_complete();await pilot.pause()
            assert (scroll.scroll_y,composer.text,composer.selection,str(app.query_one('#timeline',Static).content))==before
            assert app.read_authorized
    asyncio.run(scenario())

@pytest.mark.parametrize('failure,generation,deny',[(403,1,False),(404,1,False),(503,2,False),(503,1,True)])
def test_stale_transcript_never_survives_denial_or_scope_change(failure,generation,deny):
    async def scenario():
        client=LongClient();session=Session(client,'workspace','human');session.select('c1')
        app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            assert 'Synthetic history' in str(app.query_one('#timeline',Static).content)
            client.failure=failure;client.generation=generation;client.deny=deny
            app.action_refresh();await app.workers.wait_for_complete();await pilot.pause()
            assert 'Synthetic history' not in str(app.query_one('#timeline',Static).content)
            assert not app.read_authorized
    asyncio.run(scenario())

@pytest.mark.parametrize('transition',['identity','conversation'])
def test_display_cache_dropped_when_principal_or_conversation_changes(transition):
    async def scenario():
        from textual.widgets import Select
        client=LongClient();session=Session(client,'workspace','human');session.select('c1')
        app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            client.failure=503;app.action_refresh();await app.workers.wait_for_complete();await pilot.pause()
            assert app.stale_timeline
            if transition=='identity':
                client.identity=lambda ws:'other-human';app.action_refresh();await app.workers.wait_for_complete()
            else:
                app.query_one('#work',Select).value='__new__';await pilot.pause();await app.workers.wait_for_complete()
            assert app.timeline_snapshot is None and not app.stale_timeline
            assert 'Synthetic history' not in str(app.query_one('#timeline',Static).content)
    asyncio.run(scenario())

@pytest.mark.parametrize('status',[403,404,408,429,503])
@pytest.mark.parametrize('mutation',[False,True])
def test_read_failure_classification_cannot_classify_mutations_as_transient_reads(status,mutation):
    from workagent.operator_journal import OperatorError,ReadUnavailable
    class Opener:
        def open(self,req,timeout):
            raise urllib.error.HTTPError(req.full_url,status,'fixture',{},io.BytesIO(b'{}'))
    client=OperatorClient.__new__(OperatorClient);client.base='http://127.0.0.1:1';client.token='x'*32;client.opener=Opener()
    with pytest.raises(OperatorError) as error:client.request('/workspace/conversations/c1',{'request_id':'r'} if mutation else None)
    assert isinstance(error.value,ReadUnavailable)==(not mutation and status in (408,429,503))
