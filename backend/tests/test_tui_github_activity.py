"""Canonical GitHub DTO native rendering; synthetic offscreen fixtures."""
import asyncio,json
import pytest
from textual.app import App
from textual.widgets import Select,TextArea
from workagent.capabilities.models import ToolAttemptView
from workagent.operator_journal import OperatorError
from workagent.tui.tool_activity import github_result,receipt_text
from workagent.tui.tool_activity_screen import ToolActivityScreen
from test_tui_tool_activity import example,HTTP

def item(status='rate_limited'):
 d=example();d['capability_id']='connectors.github.discover'
 d['observation'].update(capability_id=d['capability_id'],execution_profile='native-github-public-v1',output=dict(capability='github_discover',version='1',result=dict(status=status,snapshot=None,retry_after_seconds=60,reset_epoch_seconds=None)))
 return d

def parsed(d):return ToolAttemptView.model_validate_json(json.dumps(d))

@pytest.mark.parametrize('status',['rate_limited','unavailable','not_found','denied','changed_source'])
def test_explicit_connector_failure_not_success(status):
 text=receipt_text(parsed(item(status)),'ws')
 assert 'Connector status: '+status in text
 assert 'Execution succeeded' not in text and 'No retained source bytes' in text
 assert 'no automatic retry' in text

@pytest.mark.parametrize('field',['run_id','attempt_id','call_id','capability_id'])
def test_mismatched_receipt_rejected(field):
 d=item();d['observation'][field]='wrong.id'
 with pytest.raises(OperatorError):github_result(parsed(d),'ws')

def test_wrong_operation_rejected():
 d=item();d['observation']['output']['capability']='github_read'
 with pytest.raises(OperatorError):github_result(parsed(d),'ws')

@pytest.mark.parametrize('size',[(120,40),(80,24)])
def test_rate_limit_and_denial_clear_actual_widgets(size):
 async def check():
  client=HTTP();client.item=item();app=App();screen=ToolActivityScreen(client,'ws','human',[dict(id='run',state='ready')])
  async with app.run_test(size=size) as pilot:
   app.push_screen(screen)
   for _ in range(40):
    await pilot.pause(.1)
    if screen.page is not None:break
   assert screen.page is not None
   screen.query_one('#tool-attempt',Select).value='attempt';await pilot.pause(.1)
   assert 'Connector status: rate_limited' in screen.query_one('#tool-receipt',TextArea).text
   client.denied=True;screen.action_refresh()
   for _ in range(40):
    await pilot.pause(.1)
    if not screen.busy:break
   assert screen.page is None and screen.query_one('#tool-receipt',TextArea).text==''
   assert screen.exports=={}
 asyncio.run(check())
