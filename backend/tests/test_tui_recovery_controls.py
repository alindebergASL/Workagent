"""Review regressions: definitive first rejection vs unknown, exact STOP availability."""
import asyncio
import copy
import pytest
from textual.widgets import Button
from workagent.errors import DomainError
from workagent.operator_client import OperatorClient
from workagent.operator_journal import OperatorError
from workagent.tui.app import WorkagentApp
from workagent.tui.session import Session
from test_tui_composer import FakeClient, private_state
from test_tui_b22_corrections import reject
from test_tui_continuity_commands import document


def prepared(action):
    client=OperatorClient();session=Session(client,'workspace','human');session.select('c1')
    session.edit(text=' preserve\r\n雪 ',documents=[document()] if action=='document' else [])
    session.displayed(1)
    if action=='document':
        d=session.draft;d['delivery']={k:copy.deepcopy(d[k]) for k in ('text','attachments','documents','target','generation')}
        d['delivery'].update(action='follow',refs=[],version=1);session.save()
    record=session.prepare(session.draft,action,['c1','run1'] if action=='stop' else ['c1'],
        expected_work_version=1,**({'document':document()} if action=='document' else {}))
    return client,session,record


@pytest.mark.parametrize('action,code,status',[('stop','action_unresolved',409),('document','validation_error',422)])
def test_definitive_control_rejection_restart_abandon_preserves_exact_draft(action,code,status):
    client,session,record=prepared(action);before=copy.deepcopy(session.draft)
    response=DomainError(code).envelope(record['command_id']).model_dump(mode='json')
    calls=reject(client,record,status=status,response=response)
    with pytest.raises(OperatorError):client.execute(record,lambda _:None)
    retained=client.journal.read(record['command_id'])
    assert retained['outcome']['state']=='rejected'
    restarted=Session(client,'workspace','human');restarted.abandon_rejected(restarted.draft)
    restored=Session(client,'workspace','human')
    assert restored.draft['text']==before['text'] and restored.draft['documents']==before['documents']
    assert restored.draft['pending'] is None and restored.draft['delivery'] is None
    assert restored.draft['stage']=='refresh_required'
    after=client.journal.read(record['command_id'])
    assert after['record']==retained['record'] and after['digest']==retained['digest']
    assert after['outcome']['state']=='abandoned_rejection'
    with pytest.raises(OperatorError,match='Refresh'):
        restored.prepare(restored.draft,'follow',['c1','fresh'],expected_work_version=1)
    restored.displayed(1,deliberate=True)
    fresh=restored.prepare(restored.draft,'follow',['c1',restored.draft['text']],expected_work_version=1)
    assert fresh['command_id']!=record['command_id'] and len(calls)==1


@pytest.mark.parametrize('action,code,status',[('stop','action_unresolved',409),('document','validation_error',422)])
@pytest.mark.parametrize('ambiguity',['prior_unknown','missing_header','wrong_request','wrong_status'])
def test_control_rejection_cannot_settle_ambiguity(action,code,status,ambiguity):
    client,session,record=prepared(action)
    response=DomainError(code).envelope(record['command_id']).model_dump(mode='json')
    if ambiguity=='prior_unknown':client.journal.outcome(record['command_id'],'outcome_unknown')
    if ambiguity=='wrong_request':response['request_id']='unrelated'
    if ambiguity=='wrong_status':status=500
    calls=reject(client,record,status=status,response=response,header=ambiguity!='missing_header')
    with pytest.raises(OperatorError):client.execute(record,lambda _:None)
    assert client.journal.read(record['command_id'])['outcome']['state']=='outcome_unknown'
    with pytest.raises(OperatorError,match='unknown effects'):session.abandon_rejected(session.draft)
    assert Session(client,'workspace','human').draft['pending'] and len(calls)==1


def test_stop_uses_exact_raw_lifecycle_not_worker_health():
    async def scenario():
        app=WorkagentApp(FakeClient(),'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            app.read_authorized=True
            app.canonical={'conversation_id':'c1','execution':{'run_id':'r1','state':'stale'}}
            app.detail={'conversation':{'id':'c1'},'runs':[{'id':'r1','state':'running'}]}
            for state in ('stale','blocked','unknown','running','queued'):
                app.canonical['execution']['state']=state;app.render_continuity_details()
                assert not app.query_one('#stop',Button).disabled,state
            # Terminal raw runs can still project unknown/blocked. Never infer
            # cancelability from their diagnostic label or another run's state.
            for raw in ('ready','partial','blocked','cancelled'):
                app.detail['runs'][0]['state']=raw;app.render_continuity_details()
                assert app.query_one('#stop',Button).disabled,raw
            app.detail['runs']=[{'id':'other','state':'running'}];app.render_continuity_details()
            assert app.query_one('#stop',Button).disabled
            app.detail['runs']=[{'id':'r1','state':'running'}];app.read_authorized=False
            app.render_continuity_details();assert app.query_one('#stop',Button).disabled
    asyncio.run(scenario())
