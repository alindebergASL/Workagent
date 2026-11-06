"""Synthetic HTTP/offscreen tests; actual PTY and confinement recorded separately."""
import asyncio
import copy
import json
import pytest
from textual.app import App
from textual.widgets import Select,TextArea
from workagent.capabilities.models import ToolAttemptView
from workagent.operator_journal import OperatorError
from workagent.tui.tool_activity import compute_result,receipt_text,ToolActivityController
from workagent.tui.tool_activity_screen import ToolActivityScreen


def example():
    result=dict(version=1,profile='python-analysis-v1',profile_sha256='a'*64,runtime_version='test',image='test',
        status='failed',exit_code=1,code_sha256='b'*64,inputs=[],stdout='[red]<script>BAD</script>\x1b[31m\u202e',
        stderr='assertion failed',elapsed_ms=10,resources=dict(cpu_usec=2,memory_peak_bytes=3,oom_kill=0,pids_peak=2),
        omissions=[],outputs=[],cleanup_verified=True)
    observation=dict(call_id='call',attempt_id='attempt',run_id='run',capability_id='compute.python',capability_version='1',
        implementation_sha256='a'*64,execution_profile='python-analysis-v1',input_refs=[dict(kind='run_scope',id='run',version='1',sha256='a'*64)],
        output_refs=[],output_sha256='a'*64,output=dict(capability='compute_python',version='1',result=result),
        status='observed',error=None,started_at='2026-10-29T00:00:00Z',ended_at='2026-10-29T00:00:00Z',truncated=False,
        omissions=[],source_refs=[],privacy_label='workspace_private',cost=dict(unit='call',category='local_compute',
        reserved_units=1,reserved_cost_usd='0',basis='estimated',elapsed_ms=10,cpu_ms=1))
    return dict(attempt_id='attempt',run_id='run',call_id='call',capability_id='compute.python',state='observed',observation=observation)


def manifest():
    return dict(exporter_version='compute-python-v1',export_id='export',workspace_id='ws',conversation_id='cv',
        run_id='run',tool_attempt_id='attempt',code_sha256='b'*64,profile_sha256='a'*64,input_refs=[],format='txt',
        filename='patch.txt',blob=dict(kind='generated_blob',blob_id='blob',sha256='c'*64,byte_length=3,mime_type='text/plain'),
        created_at='2026-10-29T00:00:00Z',omissions=[],sandbox_sha256='c'*64)


class HTTP:
    base='http://127.0.0.1:9000'
    def __init__(self):self.item=example();self.denied=False;self.principal='human';self.downloads=[]
    def identity(self,ws):return self.principal
    def request(self,path):
        if self.denied:raise OperatorError('private error not for display')
        return copy.deepcopy(dict(items=[self.item],next_after=None) if '/runs/' in path else self.item)
    def download_export(self,ws,m,dest):self.downloads.append((ws,m,dest));return m


def test_truthful_failures_unknown_and_unavailable():
    d=example();item=ToolAttemptView.model_validate_json(json.dumps(d))
    assert 'Execution not successful: failed' in receipt_text(item,'ws')
    assert 'Exit code: 1' in receipt_text(item,'ws') and 'assertion failed' in receipt_text(item,'ws')
    d['state']='outcome_unknown';assert compute_result(ToolAttemptView.model_validate_json(json.dumps(d)),'ws') is None
    d['state']='cost_only';assert compute_result(ToolAttemptView.model_validate_json(json.dumps(d)),'ws') is None
    d['state']='observed';d['observation']['output']['result']=dict(status='unavailable',omissions=['not installed'],outputs=[])
    assert 'no tests executed' in receipt_text(ToolAttemptView.model_validate_json(json.dumps(d)),'ws')


@pytest.mark.parametrize('field',['run_id','attempt_id','call_id','capability_id'])
def test_observation_identity_rejected(field):
    d=example();d['observation'][field]='wrong.value'
    with pytest.raises(OperatorError):compute_result(ToolAttemptView.model_validate_json(json.dumps(d)),'ws')


@pytest.mark.parametrize('field',['workspace_id','run_id','tool_attempt_id','code_sha256','profile_sha256','input_refs'])
def test_export_binding_rejected(field):
    d=example();m=manifest();m[field]=[dict(kind='workspace_file',id='wrong',version='1',sha256='d'*64)] if field=='input_refs' else ('d'*64 if field.endswith('sha256') else 'wrong')
    d['observation']['output']['result']['outputs']=[m]
    with pytest.raises(OperatorError):compute_result(ToolAttemptView.model_validate_json(json.dumps(d)),'ws')


def test_run_scope_is_not_export_input_and_refreshes_before_download():
    client=HTTP();client.item['observation']['output']['result']['outputs']=[manifest()]
    ctrl=ToolActivityController(client,'ws','human','run');item=ctrl.listing().items[0];m=compute_result(item,'ws').outputs[0]
    ctrl.download(item,m,'/new');assert len(client.downloads)==1
    client.item['observation']['output']['result']['stderr']='changed'
    with pytest.raises(OperatorError):ctrl.download(item,m,'/other')
    client.principal='someone-else'
    with pytest.raises(OperatorError):ctrl.listing()
    client.principal='human';client.base='http://127.0.0.1:9001'
    with pytest.raises(OperatorError):ctrl.listing()


@pytest.mark.parametrize('size',[(120,40),(80,24)])
def test_actual_widgets_read_clear_refusal_inert_output(size):
    async def check():
        client=HTTP();app=App();screen=ToolActivityScreen(client,'ws','human',[dict(id='run',state='ready')])
        async with app.run_test(size=size) as pilot:
            app.push_screen(screen)
            for _ in range(40):
                await pilot.pause(.1)
                if screen.page is not None:break
            assert screen.page is not None, (screen.query_one('#tool-notice').render(),screen.controller,screen.busy,[(w.state,w.error) for w in app.workers])
            screen.query_one('#tool-attempt',Select).value='attempt';await pilot.pause(.1)
            text=screen.query_one('#tool-receipt',TextArea).text
            assert 'Execution not successful: failed' in text and '<script>BAD</script>' in text
            assert '\x1b' not in text and '\u202e' not in text
            client.denied=True;screen.action_refresh()
            for _ in range(40):
                await pilot.pause(.1)
                if not screen.busy:break
            assert screen.page is None and screen.query_one('#tool-receipt',TextArea).text==''
            assert screen.exports=={}
    asyncio.run(check())
