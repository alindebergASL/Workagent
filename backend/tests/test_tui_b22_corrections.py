"""B2.2 review reproductions; fake HTTP only, no running service required."""
import asyncio
import copy
import io
import json
import threading
import urllib.error

import pytest
from textual.widgets import TextArea, Select, Checkbox
from workagent.operator_client import OperatorClient
from workagent.operator_journal import OperatorError
from workagent.errors import DomainError
from workagent.tui.app import WorkagentApp
from workagent.tui.session import Session
from test_tui_composer import FakeClient, private_state


def reject(client, record, *, status=409, response=None, header=True):
    response=response if response is not None else DomainError('version_conflict',current_version=9).envelope(record['command_id']).model_dump(mode='json')
    calls=[]
    class Opener:
        def open(self,request,timeout):
            calls.append(request)
            raise urllib.error.HTTPError(request.full_url,status,'failure',
                {'X-Request-Id':record['command_id']} if header else {},io.BytesIO(json.dumps(response).encode()))
    client.opener=Opener()
    return calls


def pending(client):
    session=Session(client,'workspace','human');session.select('c1')
    session.edit(text=' exact\r\n雪 ',attachments=[{'filename':'note.txt','mime_type':'text/plain','content':'keep\r\n'}])
    session.displayed(1)
    record=session.prepare(session.draft,'follow',['c1',session.draft['text']],expected_work_version=1,attachments=session.draft['attachments'])
    return session,record


def test_startup_readonly_until_saved_draft_restored():
    async def scenario():
        client=FakeClient();saved=Session(client,'workspace','human');saved.edit(text='saved prior draft')
        gate=threading.Event();entered=threading.Event()
        def identity(ws):entered.set();gate.wait(5);return 'human'
        client.identity=identity
        app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            while not entered.is_set():await asyncio.sleep(.001)
            composer=app.query_one('#composer',TextArea)
            assert composer.read_only
            composer.focus();await pilot.press('N','E','W')
            assert composer.text==''
            gate.set();await app.workers.wait_for_complete();await pilot.pause()
            assert composer.text=='saved prior draft' and not composer.read_only
            await pilot.press('end','!');await pilot.pause()
            assert app.session.draft['text']=='saved prior draft!'
    asyncio.run(scenario())


@pytest.mark.parametrize('failed',['context','execution','catalog','conversation'])
def test_independent_reads_render_success_and_explicit_failures(failed):
    async def scenario():
        client=FakeClient();original=client.request
        def request(path,body=None):
            if path.endswith({'context':'/work-context','execution':'/execution','catalog':'/conversation-work','conversation':'/conversations/c1'}[failed]):
                raise OperatorError('HTTP 500: internal_error')
            if path.endswith('/conversation-work'):
                return {'items':[{'artifact_id':'a1','conversation_id':'c1','title':'Saved result'}]}
            if path.endswith('/conversations/c1'):
                return {'conversation':{'id':'c1','title':'Named work','work_version':2},'messages':[
                    {'text':'FIRST MESSAGE','author_kind':'human'},{'text':'SECOND MESSAGE','author_kind':'assistant'}],'runs':[]}
            if '/work-snapshot?' in path:
                result=original(path,body)
                result['work_version']=2
                result['artifacts']=[{'id':'a1','title':'Saved result','kind':'document',
                    'current_revision_id':'r1','body_hash':'a'*64}]
                return result
            return original(path,body)
        client.request=request
        app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            app.query_one('#work',Select).value='c1';await pilot.pause();await app.workers.wait_for_complete()
            if failed!='conversation':
                assert 'FIRST MESSAGE' in app.render_cache['timeline'] and 'SECOND MESSAGE' in app.render_cache['timeline']
            else:assert 'unavailable' in app.render_cache['timeline'] and 'Start' not in app.render_cache['timeline']
            if failed!='catalog':assert 'a1' in app.query_one('#artifact',Select)._legal_values
            else:assert 'unavailable' in app.render_cache['catalog-status']
            assert failed in app.read_errors
    asyncio.run(scenario())


def test_real_client_refresh_reads_execution_once():
    client=OperatorClient();calls=[]
    class Response(io.BytesIO):headers={'X-Workagent-Principal':'human'}
    class Opener:
        def open(self,request,timeout):
            calls.append(request.full_url)
            return Response(json.dumps({'state':'idle','runs':[]} if request.full_url.endswith('/execution') else {'items':[]}).encode())
    client.opener=Opener();app=WorkagentApp(client,'workspace')
    try:
        data=app.read_bundle((None,None,None,None))
        assert data['identity']=='human' and not data['errors']
        assert sum(url.endswith('/execution') for url in calls)==1
    finally:app.read_lane.close();app.write_pool.shutdown()


def test_rejected_abandon_restart_refresh_and_resend_preserves_history():
    client=OperatorClient();session,record=pending(client);draft=copy.deepcopy(session.draft)
    calls=reject(client,record)
    with pytest.raises(OperatorError):client.execute(record,lambda _:None)
    data=client.journal.read(record['command_id'])
    assert data['outcome']['state']=='rejected'
    session=Session(client,'workspace','human')
    with pytest.raises(OperatorError):session.prepare(session.draft,'follow',['c1','changed'],expected_work_version=9)
    with pytest.raises(OperatorError):client.run('workspace','replay',[record['command_id']],principal_id='human')
    assert len(calls)==1
    session.abandon_rejected(session.draft)
    session=Session(client,'workspace','human')
    assert session.draft['text']==draft['text'] and session.draft['attachments']==draft['attachments']
    assert session.draft['target']==draft['target'] and session.draft['pending'] is None
    retained=client.journal.read(record['command_id'])
    assert retained['record']==data['record'] and retained['digest']==data['digest']
    assert retained['outcome']['rejection']==data['outcome']['rejection']
    assert retained['outcome']['state']=='abandoned_rejection'
    session.displayed(9)
    with pytest.raises(OperatorError,match='Refresh'):session.prepare(session.draft,'follow',['c1','changed'],expected_work_version=9)
    session.displayed(9,deliberate=True)
    fresh=session.prepare(session.draft,'follow',['c1',session.draft['text']],expected_work_version=session.draft['expected_work_version'],attachments=session.draft['attachments'])
    assert fresh['command_id']!=record['command_id'] and fresh['body']['expected_work_version']==9
    assert len(calls)==1  # Preparation/abandon/refresh never sends.


@pytest.mark.parametrize('kind',['proxy','missing_header','wrong_request','server_500','unresolved','replay_unknown','readback_unknown'])
def test_uncertain_failures_cannot_be_abandoned(kind):
    client=OperatorClient();session,record=pending(client)
    response=DomainError('version_conflict',current_version=9).envelope(record['command_id']).model_dump(mode='json')
    status=409;header=True
    if kind=='proxy':response={'code':'version_conflict'}
    if kind=='missing_header':header=False
    if kind=='wrong_request':response['request_id']='unrelated'
    if kind=='server_500':status=500
    if kind=='unresolved':response['code']='action_unresolved'
    if kind=='replay_unknown':client.journal.outcome(record['command_id'],'outcome_unknown')
    if kind=='readback_unknown':client.journal.outcome(record['command_id'],'readback_unknown',{'message':{'id':'m'}})
    calls=reject(client,record,status=status,response=response,header=header)
    with pytest.raises(OperatorError):client.execute(record,lambda _:None)
    assert client.journal.read(record['command_id'])['outcome']['state']=='outcome_unknown'
    with pytest.raises(OperatorError,match='unknown effects'):session.abandon_rejected(session.draft)
    assert Session(client,'workspace','human').draft['pending'] and len(calls)==1


def test_new_rejection_state_requires_valid_evidence_legacy_states_unchanged():
    client=OperatorClient();session,record=pending(client)
    from pathlib import Path
    file=Path(client.journal.path)/(record['command_id']+'.json')
    data=json.loads(file.read_text())
    for state in ('prepared','outcome_unknown','readback_unknown','confirmed'):
        data['outcome']={'state':state};file.write_text(json.dumps(data))
        assert client.journal.read(record['command_id'])['record']==record
    for outcome in ({'state':'rejected'},{'state':'abandoned_rejection','rejection':{'status':409,'response':{}}}):
        data['outcome']=outcome;file.write_text(json.dumps(data))
        with pytest.raises(OperatorError,match='rejection evidence'):client.journal.read(record['command_id'])


@pytest.mark.parametrize('kind',['verified','proxy','missing_header','wrong_request','server_500','unresolved'])
def test_transport_only_classifies_verified_domain_rejection(kind):
    from workagent.operator_journal import DomainRejection
    client=OperatorClient()
    record=client.prepare('workspace','follow',['c1','retain'],principal_id='human',expected_work_version=1)
    response=DomainError('version_conflict',current_version=9).envelope(record['command_id']).model_dump(mode='json')
    if kind=='proxy':response={'code':'version_conflict'}
    if kind=='wrong_request':response['request_id']='other'
    if kind=='unresolved':response['code']='action_unresolved'
    calls=reject(client,record,response=response,status=500 if kind=='server_500' else 409,header=kind!='missing_header')
    with pytest.raises(OperatorError) as caught:client.request(record['path'],record['body'])
    assert isinstance(caught.value,DomainRejection)==(kind=='verified')
    assert len(calls)==1
