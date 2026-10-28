"""Headless Pilot checks exercise real widgets, with explicitly fake HTTP."""
import asyncio
import threading
from textual.widgets import TextArea, Select, Static
from workagent.tui.app import WorkagentApp
from workagent.tui.safe_text import literal


class FakeClient:
    base='http://127.0.0.1:8765'
    def __init__(self):
        from workagent.operator_client import OperatorClient
        self.real=OperatorClient();self.real.base=self.base;self.real.request=self.request
        self.journal=self.real.journal;self.calls=[];self.block=None;self.fail=False;self.messages=[]
    def identity(self,ws):return 'human'
    def prepare(self,*a,**kw):return self.real.prepare(*a,**kw)
    def validate_record(self,*a,**kw):return self.real.validate_record(*a,**kw)
    def execute(self,record,announce):
        self.calls.append((record['workspace'],record['action'],record['args'],{'command_id':record['command_id']}))
        return self.real.execute(record,announce)
    def browse(self,path):return self.request(path)
    def run(self,ws,action,args,**kw):
        if action=='show':return self.request('/'+ws+'/conversations/'+args[0])
        return self.real.run(ws,action,args,**kw)
    def request(self,path,body=None):
        if body is not None:
            if path.endswith('/conversations'):
                return {'id':'new1','owner_id':'human','work_version':1}
            if path.endswith('/messages'):
                if self.block:self.block.wait(5)
                if self.fail:
                    from workagent.operator_journal import OperatorError
                    raise OperatorError('outcome/readback may be unknown. No automatic retry was sent')
                message={'id':body['command_id'],'author_kind':'human','text':body['text'],
                         'target':body['target'],'attachments':body['attachments']}
                self.messages.append(message)
                return {'message':message,'run':{'id':'run'}}
            raise AssertionError(path)
        if path.endswith('/conversations'):return {'items':[{'id':'c1','title':'Named work [red]literal'}]}
        if path.endswith('/execution'):return {'state':'idle','checked_at':'2026-10-26T00:00:00Z','runs':[]}
        if path.endswith('/conversation-work'):return {'items':[]}
        # Canonical B2 continuity reads are separate from the legacy workspace
        # execution summary. Unknown endpoints still fail loudly below.
        from urllib.parse import urlsplit,parse_qs
        from workagent.work_event_models import WorkSnapshot,EventPage,AttentionPage
        url=urlsplit(path);stamp='2026-10-26T00:00:00Z'
        if url.path.endswith('/work-snapshot'):
            conversation=parse_qs(url.query)['conversation_id'][0]
            return WorkSnapshot(conversation_id=conversation,work_version=1,access_generation=1,
                checked_at=stamp,snapshot_cursor='snapshot',execution={'state':'idle'},
                responsibility=[],artifacts=[],pending_proposals=[]).model_dump(mode='json')
        if url.path.endswith('/events'):
            return EventPage(events=[],next_cursor='events',has_more=False,checked_at=stamp).model_dump(mode='json')
        if url.path.endswith('/attention'):
            return AttentionPage(facts=[],next_cursor='attention',has_more=False,checked_at=stamp).model_dump(mode='json')
        if url.path.endswith(('/queued-messages','/checkpoints','/documents')):return {'items':[]}
        if path.endswith('/work-context'):return {'responsibilities':[]}
        if '/conversations/' in path:return {'conversation':{'id':path.rsplit('/',1)[1],'title':'Named work','work_version':1},'messages':self.messages,'runs':[]}
        raise AssertionError(path)


import pytest

@pytest.fixture(autouse=True)
def private_state(monkeypatch,tmp_path):
    monkeypatch.setenv('LOCAL_BEARER_TOKEN','x'*40)
    monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL',str(tmp_path/'commands'))
    monkeypatch.setenv('WORKAGENT_TUI_DRAFTS',str(tmp_path/'drafts'))


def test_ordinary_typing_newlines_send_and_detach():
    async def scenario():
        client=FakeClient();app=WorkagentApp(client,'workspace')
        async with app.run_test(size=(80,24)) as pilot:
            await app.workers.wait_for_complete()
            composer=app.query_one('#composer',TextArea)
            composer.focus()
            await pilot.press('q','a','enter','b')
            assert composer.text=='qa\nb'
            await pilot.press('ctrl+enter')
            await app.workers.wait_for_complete();await pilot.pause()
            assert [call[1] for call in client.calls].count('follow')==1
            assert next(call for call in client.calls if call[1]=='follow')[2]==['new1','qa\nb']
            assert composer.text==''
            await pilot.press('ctrl+q')
            assert not any(call[1]=='cancel' for call in client.calls)
    asyncio.run(scenario())


def test_refresh_preserves_composer_and_named_work_navigation():
    async def scenario():
        client=FakeClient();app=WorkagentApp(client,'workspace')
        async with app.run_test(size=(120,40)) as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            app.query_one('#work',Select).value='c1'
            await pilot.pause();await app.workers.wait_for_complete()
            composer=app.query_one('#composer',TextArea);composer.load_text('Do not erase\n雪')
            await pilot.press('ctrl+r');await app.workers.wait_for_complete()
            assert composer.text=='Do not erase\n雪'
            assert app.conversation=='c1'
            await pilot.resize_terminal(80,24)
            assert composer.text=='Do not erase\n雪'
    asyncio.run(scenario())


def test_slow_send_does_not_freeze_typing_or_double_post():
    async def scenario():
        client=FakeClient();client.block=threading.Event();app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete()
            composer=app.query_one('#composer',TextArea);composer.load_text('first')
            await pilot.press('ctrl+enter');await pilot.pause()
            await pilot.press('ctrl+enter')
            composer.focus();composer.move_cursor((0,5));await pilot.press('x')
            assert composer.text=='firstx'
            client.block.set();await app.workers.wait_for_complete();await pilot.pause()
            assert composer.text=='firstx'
            assert sum(c[1]=='follow' for c in client.calls)==1
    asyncio.run(scenario())


def test_unknown_result_retains_input_and_disallows_new_send():
    async def scenario():
        client=FakeClient();client.fail=True;app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete()
            composer=app.query_one('#composer',TextArea);composer.load_text('retain this')
            await pilot.press('ctrl+enter');await app.workers.wait_for_complete();await pilot.pause()
            await pilot.press('ctrl+enter');await pilot.pause()
            assert composer.text=='retain this'
            assert sum(c[1]=='follow' for c in client.calls)==1
            assert app.pending_command is not None
    asyncio.run(scenario())


def test_untrusted_terminal_controls_are_not_executed():
    value='[red]text\x1b[2J\u202e'
    rendered=literal(value)
    assert '\x1b' not in rendered and '\u202e' not in rendered
    assert '[red]' in rendered


def test_slow_refresh_has_one_actual_thread_and_typing_selection_survives():
    async def scenario():
        client=FakeClient();app=WorkagentApp(client,'workspace')
        async with app.run_test(size=(80,24)) as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            original=client.browse;release=threading.Event();started=threading.Event();count=[]
            def slow(path):
                if path.endswith('/conversations'):
                    count.append(1);started.set();release.wait(4)
                return original(path)
            client.browse=slow
            app.action_refresh()
            while not started.is_set():await asyncio.sleep(.01)
            for _ in range(30):app.action_refresh()
            composer=app.query_one('#composer',TextArea);composer.focus()
            await pilot.press('雪','enter','x')
            assert composer.text=='雪\nx' and len(count)==1
            selection=composer.selection
            client.browse=original;release.set()
            await app.workers.wait_for_complete();await pilot.pause();await app.workers.wait_for_complete()
            assert composer.text=='雪\nx' and composer.selection==selection and app.focused is composer
            assert len(count)==1
    asyncio.run(scenario())


def test_pending_follow_restart_readback_keeps_edits_and_created_conversation():
    async def scenario():
        client=FakeClient();client.fail=True;app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete()
            composer=app.query_one('#composer',TextArea);composer.load_text('retained')
            await pilot.press('f5');await app.workers.wait_for_complete();await pilot.pause()
            assert app.conversation=='new1' and app.pending_command
            command=app.pending_command
        restarted=WorkagentApp(client,'workspace')
        async with restarted.run_test(size=(80,24)) as pilot:
            await restarted.workers.wait_for_complete();await pilot.pause();await restarted.workers.wait_for_complete()
            assert restarted.conversation=='new1' and restarted.pending_command==command, str(restarted.query_one('#status',Static).content)
            composer=restarted.query_one('#composer',TextArea)
            assert composer.text=='retained'
            await pilot.press('f5');await pilot.pause()
            assert sum(c[1]=='chat' for c in client.calls)==1
            assert sum(c[1]=='follow' for c in client.calls)==1
            client.fail=False
            restarted.start_write(restarted.recover('replay'))
            await restarted.workers.wait_for_complete();await pilot.pause()
            assert restarted.pending_command is None and composer.text==''
            assert sum(c[1]=='chat' for c in client.calls)==1
    asyncio.run(scenario())


def test_named_search_narrow_layout_and_safe_labels():
    from textual.widgets import Input, Button
    async def scenario():
        client=FakeClient();app=WorkagentApp(client,'workspace')
        async with app.run_test(size=(80,24)) as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            app.query_one('#search',Input).value='named';await pilot.pause()
            assert 'c1' in app.query_one('#work',Select)._legal_values
            for id in ('send','composer','work','search'):
                widget=app.query_one('#'+id)
                assert widget.region.x>=0 and widget.region.right<=80
                assert widget.region.y>=0 and widget.region.bottom<=24
            assert app.query_one('#composer',TextArea).region.height>=3
            await pilot.resize_terminal(120,40)
            assert app.query_one('#send',Button).region.bottom<40
    asyncio.run(scenario())


def test_review_consent_resets_on_changed_candidate_and_current_body():
    import copy
    from textual.widgets import Checkbox, Button
    async def scenario():
        app=WorkagentApp(FakeClient(),'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete()
            current={'id':'r','revision_number':1,'author_kind':'human','body_hash':'a'*64,
                     'body':{'title':'Plan','blocks':[{'kind':'paragraph','text':'Human exact'}]}}
            app.artifact={'id':'a','current_revision_id':'r','current_revision':current}
            app.history=[current];app.selected_proposal='p'
            candidate={'id':'p','artifact_id':'a','base_revision_id':'r','body_hash':'b'*64,
                       'body':{'title':'Plan','blocks':[{'kind':'paragraph','text':'Changed'}]},'status':'pending',
                       'review':{'is_latest':False,'latest_pending_proposal_id':'p2','removed_content_count':4,'removed_content':[]}}
            app.proposals=[candidate];app.render_work()
            assert not app.query_one('#ack-removed',Checkbox).value
            assert not app.query_one('#ack-older',Checkbox).value
            app.query_one('#ack-removed',Checkbox).value=True
            app.query_one('#ack-older',Checkbox).value=True
            app.render_work()
            assert app.query_one('#ack-removed',Checkbox).value
            candidate['review']['latest_pending_proposal_id']='p3';app.render_work()
            assert not app.query_one('#ack-removed',Checkbox).value
            assert not app.query_one('#ack-older',Checkbox).value
            app.query_one('#ack-removed',Checkbox).value=True
            app.artifact['current_revision_id']='r2';app.artifact['current_revision']={**current,'id':'r2','body_hash':'c'*64}
            app.render_work()
            assert app.query_one('#accept',Button).disabled
            assert not app.query_one('#ack-removed',Checkbox).value
    asyncio.run(scenario())


def test_composer_preserves_mixed_line_endings_controls_and_exact_restart():
    async def scenario():
        from workagent.tui.widgets import Composer
        text=' \ufeff雪\r\nsecond\nthird\r\u2028\t[red]\x1b]8;;bad\x07\u202e '
        app=WorkagentApp(FakeClient(),'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            composer=app.query_one('#composer',Composer);composer.load_text(text)
            await pilot.pause()
            assert composer.text==text and app.session.draft['text']==text
            segments=''.join(segment.text for y in range(composer.size.height) for segment in composer.render_line(y))
            for control in ('\x1b','\x07','\u202e','\ufeff'):assert control not in segments
        restarted=WorkagentApp(FakeClient(),'workspace')
        async with restarted.run_test(size=(80,24)) as pilot:
            await restarted.workers.wait_for_complete();await pilot.pause()
            assert restarted.query_one('#composer',Composer).text==text
    asyncio.run(scenario())


def test_single_writer_across_conversation_switch_keeps_both_drafts():
    async def scenario():
        client=FakeClient();client.block=threading.Event();app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete()
            composer=app.query_one('#composer',TextArea);composer.load_text('original')
            await pilot.press('f5');await pilot.pause()
            # Creation has finished, follow is outstanding. A different named
            # conversation can be read/edited but cannot launch a second write.
            app.query_one('#work',Select).value='c1';await pilot.pause()
            composer.load_text('next draft');await pilot.press('f5');await pilot.pause()
            assert sum(c[1]=='follow' for c in client.calls)==1
            client.block.set();await app.workers.wait_for_complete();await pilot.pause()
            assert app.conversation=='c1' and composer.text=='next draft'
            assert app.session.state['drafts']['new1']['text']==''
    asyncio.run(scenario())


def test_detach_during_http_keeps_pending_and_never_cancels_server_work():
    async def scenario():
        client=FakeClient();client.block=threading.Event();app=WorkagentApp(client,'workspace')
        async with app.run_test(size=(80,24)) as pilot:
            await app.workers.wait_for_complete()
            app.query_one('#composer',TextArea).load_text('continue after detach')
            await pilot.press('f5');await pilot.pause()
            pending=app.pending_command
            assert pending and app.session.draft['stage']=='following'
            await pilot.press('ctrl+q')
        # No server cancellation: release the already outstanding fake HTTP call.
        client.block.set()
        for _ in range(100):
            if client.journal.read(pending)['outcome']['state']=='confirmed':break
            await asyncio.sleep(.025)
        assert client.journal.read(pending)['outcome']['state']=='confirmed'
        assert not any(c[1]=='cancel' for c in client.calls)
        from workagent.tui.session import Session
        restored=Session(client,'workspace','human')
        assert restored.draft['pending']['command_id']==pending
        assert restored.draft['text']=='continue after detach'
    asyncio.run(scenario())


def test_redirect_label_uses_selected_conversation_execution_only():
    from textual.widgets import Button
    async def scenario():
        client=FakeClient();original=client.request;active_run='other-run'
        def request(path,body=None):
            result=original(path,body)
            if path.endswith('/execution'):
                return {'state':'working','checked_at':'now','runs':[{'run_id':active_run,'state':'working'}]}
            if '/work-snapshot?' in path:
                assert result['conversation_id']=='c1'
                result['execution'].update(state='queued' if active_run=='own-run' else 'idle',run_id='own-run')
            if path.endswith('/conversations/c1'):
                result['runs']=[{'id':'own-run','state':'queued','observed_at':'now'}]
            return result
        client.request=request
        app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete()
            app.query_one('#work',Select).value='c1';await pilot.pause();await app.workers.wait_for_complete()
            assert str(app.query_one('#send',Button).label)=='Send · F5'
            active_run='own-run';app.action_refresh();await app.workers.wait_for_complete()
            assert str(app.query_one('#send',Button).label)=='Redirect · F5'
    asyncio.run(scenario())
