"""Deferred real screen-consumer regressions; transport is a test double."""
import asyncio
import copy
import threading
import pytest
from textual.app import App
from textual.widgets import Input, TextArea, Select
from workagent.operator_journal import OperatorError
from workagent.tui.memory_screen import MemoryScreen
from workagent.tui.memory import MemoryController
from test_tui_procedures import LessonHTTP


@pytest.mark.parametrize('action',['evidence','inspect','why','refresh'])
@pytest.mark.parametrize('change',['owner','endpoint','token','denied'])
def test_delayed_read_does_not_render_old_authority(action,change):
    async def check():
        class Delayed(LessonHTTP):
            token='original-session'
            armed=False
            denied=False
            entered=threading.Event()
            release=threading.Event()
            def identity(self,ws):
                if self.denied: raise OperatorError('Identity denied')
                return super().identity(ws)
            def request(self,path,body=None):
                result=super().request(path,body)
                if self.armed:
                    self.armed=False
                    self.entered.set()
                    assert self.release.wait(5)
                return result
        client=Delayed(); screen=MemoryScreen(client,'ws-a','human-a','task-a'); app=App()
        async with app.run_test(size=(100,50)) as pilot:
            app.push_screen(screen); await pilot.pause(.3)
            screen.controller.inspect('memory-a')
            screen.show_detail(screen.controller.selected)
            screen.query_one('#memory-list',Select).value='memory-a'
            screen.query_one('#memory-run',Input).value='run-a'
            client.armed=True
            task=asyncio.create_task(screen.perform(action))
            for _ in range(100):
                if client.entered.is_set(): break
                await asyncio.sleep(.01)
            assert client.entered.is_set()
            if change=='owner': client.principal='another-human'
            elif change=='endpoint': client.base='http://127.0.0.1:9001'
            elif change=='token': client.token='replacement-session'
            else: client.denied=True
            client.release.set(); await task
            assert screen.controller.selected is None
            assert not screen.evidence_options and screen.inspected_procedure is None
            assert not screen.query_one('#memory-content',TextArea).text
            assert not screen.query_one('#memory-details',TextArea).text
            assert not screen.query_one('#memory-usage',TextArea).text
    asyncio.run(check())


def test_resource_denied_write_clears_view_but_retains_exact_envelope():
    from workagent.operator_journal import AccessDenied
    async def check():
        class Denied(LessonHTTP):
            def request(self,path,body=None):
                if body is not None: raise AccessDenied('HTTP 404: not_found')
                return super().request(path,body)
        client=Denied(); screen=MemoryScreen(client,'ws-a','human-a','task-a'); app=App()
        async with app.run_test(size=(100,50)) as pilot:
            app.push_screen(screen); await pilot.pause(.3)
            screen.show_detail(screen.controller.inspect('memory-a'))
            before=screen.controller.prepare('correct',content='retained exact human edit',mode='permanent')
            await screen.perform('replay')
            assert screen.controller.access_lost and screen.controller.selected is None
            assert screen.controller.pending['body']==before['body']
            assert screen.controller.pending['state']=='outcome_unknown'
            assert not screen.query_one('#memory-content',TextArea).text
            assert not screen.query_one('#memory-details',TextArea).text
            with pytest.raises(OperatorError): screen.controller.send()
    asyncio.run(check())


@pytest.mark.parametrize('status',[401,403,404])
def test_http_transport_types_denial_without_settling_mutation(status):
    import io, urllib.error
    from types import SimpleNamespace
    from workagent.operator_client import OperatorClient
    from workagent.operator_journal import AccessDenied
    def deny(*args,**kwargs):
        raise urllib.error.HTTPError('http://127.0.0.1:9000',status,'denied',{},io.BytesIO(b'{"code":"not_found"}'))
    client=object.__new__(OperatorClient);client.base='http://127.0.0.1:9000';client.token='synthetic';client.opener=SimpleNamespace(open=deny)
    with pytest.raises(AccessDenied):client.request('/ws/memory/m/correct',{'request_id':'r'})


def test_denied_refresh_clears_controller_selection():
    client=LessonHTTP(); ctrl=MemoryController(client,'ws-a','human-a','task-a')
    ctrl.inspect('memory-a')
    client.identity=lambda ws: (_ for _ in ()).throw(OperatorError('Denied'))
    with pytest.raises(OperatorError):ctrl.listing()
    assert ctrl.selected is None and ctrl.access_lost
