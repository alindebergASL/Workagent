"""A20/A27: native controls, frozen CAS, honest parked-state guidance.

Pilot uses synthetic HTTP; this is not the parent's real EC2/PTY acceptance.
"""
import asyncio
import copy
import pytest
from textual.widgets import Button, Select, Static, TabbedContent, TextArea
from workagent.models import Assignment, Conversation
from workagent.operator_client import OperatorClient
from workagent.operator_journal import OperatorError, DomainRejection
from workagent.responsibility_models import ResponsibilityDetail, ResponsibilityLifecycle
from workagent.tui.app import WorkagentApp
from workagent.tui.continuity import status_text
from workagent.tui.session import Session
from test_tui_composer import FakeClient, private_state


ACTIONS = ('responsibility-pause', 'responsibility-resume', 'responsibility-takeover', 'conversation-cancel')


def responsibility(state='active', version=7):
    return ResponsibilityDetail(
        assignment=Assignment(id='a1', workspace_id='workspace', conversation_id='c1', owner_id='human',
            goal='Retain the notes', completion_criteria=['Keep human edits'], selected_source_refs=[], work_version=version),
        lifecycle=ResponsibilityLifecycle(state=state, current_outcome='Saved note retained',
            next_action={'kind':'request_decision','description':'Choose the next useful step'}, conversation_work_version=3),
        local_review_eligible=False).model_dump(mode='json')


def conversation(state='open', version=3):
    return Conversation(id='c1',workspace_id='workspace',owner_id='human',title='Retained work',
                        state=state,work_version=version).model_dump(mode='json')


def snapshot(reason=None):
    from workagent.work_event_models import WorkSnapshot
    return WorkSnapshot(conversation_id='c1',work_version=3,access_generation=1,
        checked_at='2026-10-28T00:00:00Z',snapshot_cursor='cursor',execution={'run_id':'r1','state':'blocked','reason':reason},
        responsibility=[],artifacts=[],pending_proposals=[]).model_dump(mode='json')


@pytest.mark.parametrize('action', ACTIONS)
def test_lifecycle_pure_prepare_uses_displayed_version_and_frozen_replay(action):
    client=OperatorClient();calls=[]
    client.request=lambda *a,**k: calls.append((a,k))
    args=['c1'] if action=='conversation-cancel' else ['c1','a1']
    record=client.prepare('workspace',action,args,principal_id='human',expected_work_version=7)
    assert not calls
    assert record['format']==5 and record['body']['expected_work_version']==7
    if action=='conversation-cancel':
        assert record['path']=='/workspace/conversations/c1/cancel'
    else:
        assert record['path']=='/workspace/assignments/a1/responsibility/control'
        assert record['body']['operation']==action.removeprefix('responsibility-')
    client.journal.reserve(record);client.journal.outcome(record['command_id'],'outcome_unknown')
    restored=client.journal.read(record['command_id'])['record']
    client.validate_record(restored,'workspace',principal_id='human')
    assert client.wire_body(restored['body'])==client.wire_body(record['body'])
    for change in ({'principal_id':'other'},{'base':'http://127.0.0.1:9999'},{'path':'/workspace/conversations/other/cancel'}):
        with pytest.raises(OperatorError):client.validate_record({**restored,**change},'workspace',principal_id='human')
    with pytest.raises(OperatorError):client.prepare('workspace',action,args,principal_id='human',expected_work_version=True)


@pytest.mark.parametrize('case, expected', [
    ('no-progress','No new progress'),('malformed','Malformed'),('tool-rejected','Tool rejected'),('unknown','Unknown external outcome')])
def test_parked_status_has_exact_current_diagnosis_and_reachable_safe_action(case,expected):
    snap=snapshot('invalid_response' if case=='malformed' else 'unknown_external_outcome' if case=='unknown' else 'work_blocked')
    raw={'id':'r1','state':'partial','stop_reason':'step_limit' if case=='no-progress' else 'blocked'}
    turn={'run_id':'r1','provider_observation':'invalid' if case=='malformed' else 'received'}
    if case=='tool-rejected':turn['retained_local_result']={'status':'rejected','reason':'unsupported_operation','published':False}
    cp={'run_id':'r1','conversation_id':'c1','assignment_id':None,'checkpoint_kind':'settlement',
        'data':{'waiting':'blocked','next_safe_action':'await_person'}}
    detail={'conversation':conversation(),'runs':[raw], 'turns':[turn]}
    text=status_text(snap,detail=detail,checkpoints=[cp])
    assert expected in text
    if case=='tool-rejected':assert 'unsupported_operation' in text
    assert 'Work tab' in text and 'Details tab' in text
    assert 'Retry now' not in text
    if case in ('unknown','malformed'):assert 'Do not replay' in text
    # Cancellation or completion cannot resurrect an earlier parked diagnosis.
    for terminal in ('cancelled','completed'):
        current=copy.deepcopy(snap);current['execution']['state']=terminal
        assert expected not in status_text(current,detail=detail,checkpoints=[cp])
    # An old run's rejection/checkpoint must never diagnose a newer run.
    snap['execution']['run_id']='newer';snap['execution']['reason']=None
    assert expected not in status_text(snap,detail=detail,checkpoints=[cp])


class LifecycleClient(FakeClient):
    def __init__(self):
        super().__init__();self.item=responsibility();self.cv=conversation();self.posts=[];self.receipts={}
        self.reject=False;self.lose=False
    def request(self,path,body=None):
        if body is not None and path.endswith(('/responsibility/control','/cancel')):
            self.posts.append((path,copy.deepcopy(body)))
            if self.reject:
                from workagent.errors import DomainError
                raise DomainRejection({'status':409,'response':DomainError('version_conflict').envelope(body['request_id']).model_dump(mode='json')})
            cid=body['command_id']
            if cid not in self.receipts:
                if path.endswith('/responsibility/control'):
                    assert body['expected_work_version']==self.item['assignment']['work_version']
                    self.item['assignment']['work_version']+=1
                    self.item['lifecycle']['state']={'pause':'paused','resume':'active','takeover':'taken_over'}[body['operation']]
                    self.receipts[cid]=copy.deepcopy(self.item)
                else:
                    assert body['expected_work_version']==self.cv['work_version']
                    self.cv['state']='cancelled';self.cv['work_version']+=1;self.receipts[cid]=copy.deepcopy(self.cv)
            if self.lose:raise OperatorError('synthetic lost response')
            return copy.deepcopy(self.receipts[cid])
        if path.endswith('/assignments/a1/responsibility'):return copy.deepcopy(self.item)
        if path.endswith('/conversations/c1'):return {'conversation':copy.deepcopy(self.cv),'runs':[],'messages':[]}
        if path.endswith('/work-context'):
            return {'conversation_id':'c1','conversation_work_version':self.cv['work_version'], 'truncated':False,
                'responsibilities':[{'assignment_id':'a1','work_version':self.item['assignment']['work_version'],
                    'owner_id':'human','lifecycle':copy.deepcopy(self.item['lifecycle']),'lifecycle_omitted':False}]}
        if '/work-snapshot?' in path:
            value=snapshot();value['work_version']=self.cv['work_version']
            value['execution']['run_id']=None;value['execution']['state']='idle'
            value['responsibility']=[{'assignment_id':'a1','state':self.item['lifecycle']['state'],
                'next_action':self.item['lifecycle']['next_action'],'next_check_in_at':None,'historical_observation':None,'review_required':False}]
            return value
        return super().request(path,body)


def test_native_lifecycle_controls_use_assignment_cas_and_keep_draft():
    async def scenario():
        client=LifecycleClient();app=WorkagentApp(client,'workspace')
        async with app.run_test(size=(80,24)) as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            app.query_one('#work',Select).value='c1'
            await pilot.pause();await app.workers.wait_for_complete();await pilot.pause()
            composer=app.query_one('#composer',TextArea);composer.load_text('Keep human draft\n雪')
            await pilot.pause()
            app.query_one('#panels',TabbedContent).active='status-panel'
            selector=app.query_one('#responsibility',Select);selector.value='a1'
            await pilot.pause()
            for action,state in zip(ACTIONS,('paused','active','taken_over','cancelled')):
                button=app.query_one('#'+action,Button)
                assert not button.disabled,action
                button.focus();await pilot.pause()
                button.scroll_visible(animate=False,force=True);await pilot.pause()
                assert await pilot.click('#'+action,offset=(2,1)),action
                await pilot.pause();await app.workers.wait_for_complete();await pilot.pause()
                assert composer.text=='Keep human draft\n雪'
                assert app.pending_command is None
                assert state in str(app.query_one('#lifecycle-receipt',Static).render()), {
                    'action':action,'posts':client.posts,'sending':app.sending,'authorized':app.read_authorized,
                    'disabled':button.disabled,'selection':app.lifecycle_selection(),
                    'status':str(app.query_one('#status',Static).render()),'errors':app.read_errors}
            assert [body['expected_work_version'] for _,body in client.posts]==[7,8,9,3]
            assert app.query_one('#responsibility-resume',Button).disabled
            assert app.query_one('#conversation-cancel',Button).disabled
    asyncio.run(scenario())


@pytest.mark.parametrize('action',ACTIONS)
def test_unknown_lifecycle_replay_keeps_receipt_separate_from_later_current_state(action):
    client=LifecycleClient();session=Session(client,'workspace','human');session.select('c1')
    from test_tui_continuity_commands import document
    retained={'text':' exact human work\r\n雪 ', 'attachments':[{'filename':'note.txt','mime_type':'text/plain','content':'human note'}],
              'documents':[document()], 'target':{'artifact_id':'artifact','revision_id':'revision','body_hash':'a'*64}}
    session.edit(**retained);session.displayed(3)
    if action=='responsibility-resume':client.item['lifecycle']['state']='paused'
    args=['c1'] if action=='conversation-cancel' else ['c1','a1']
    record=session.prepare(session.draft,action,args,expected_work_version=3 if action=='conversation-cancel' else 7)
    client.lose=True
    with pytest.raises(OperatorError):client.execute(record,lambda _:None)
    restarted=Session(client,'workspace','human');assert restarted.inspect(restarted.draft)['outcome']['state']=='outcome_unknown'
    with pytest.raises(OperatorError):restarted.prepare(restarted.draft,action,args,expected_work_version=99)
    client.lose=False
    if action!='conversation-cancel':
        client.item['lifecycle']['state']='taken_over';client.item['assignment']['work_version']+=2
    result=client.run('workspace','replay',[record['command_id']],principal_id='human')
    restarted.complete(restarted.draft,result)
    assert {k:restarted.draft[k] for k in retained}==retained
    assert client.posts==[client.posts[0],client.posts[0]]
    if action!='conversation-cancel':
        assert result['receipt']['assignment']['work_version']==8
        assert result['readback']['assignment']['work_version']==10
        assert result['readback']['lifecycle']['state']=='taken_over'


def test_stale_lifecycle_rejection_requires_deliberate_refresh_no_hidden_retry():
    client=LifecycleClient();client.reject=True;session=Session(client,'workspace','human');session.select('c1');session.edit(text='keep')
    record=session.prepare(session.draft,'responsibility-pause',['c1','a1'],expected_work_version=6)
    with pytest.raises(OperatorError):client.execute(record,lambda _:None)
    assert client.journal.read(record['command_id'])['outcome']['state']=='rejected'
    session.abandon_rejected(session.draft)
    assert session.draft['text']=='keep' and session.draft['stage']=='refresh_required' and len(client.posts)==1
    with pytest.raises(OperatorError):session.prepare(session.draft,'responsibility-pause',['c1','a1'],expected_work_version=7)


@pytest.mark.parametrize('action',ACTIONS)
def test_lifecycle_rejects_wrong_receipt_or_readback_scope(action):
    client=LifecycleClient();args=['c1'] if action=='conversation-cancel' else ['c1','a1']
    if action=='responsibility-resume':client.item['lifecycle']['state']='paused'
    record=client.prepare('workspace',action,args,principal_id='human',expected_work_version=3 if action=='conversation-cancel' else 7)
    saved=client.request(record['path'],record['body'])
    for field,value in [('workspace_id','elsewhere'),('id','another'),('work_version',1)]:
        broken=copy.deepcopy(saved);target=broken.get('assignment',broken);target[field]=value
        with pytest.raises(OperatorError):client.real.readback(record,broken)
    # A retained valid receipt must not be paired with another object's readback.
    if action=='conversation-cancel':client.cv['id']='other'
    else:client.item['assignment']['conversation_id']='other'
    with pytest.raises(OperatorError):client.real.readback(record,saved)


def test_lifecycle_pending_cannot_move_to_another_conversation():
    client=LifecycleClient();session=Session(client,'workspace','human');session.select('c1')
    session.prepare(session.draft,'responsibility-pause',['c1','a1'],expected_work_version=7)
    other=copy.deepcopy(session.draft);other['conversation']='c2'
    with pytest.raises(OperatorError,match='conversation binding'):session.inspect(other)


def test_native_lifecycle_controls_lock_missing_access_terminal_and_stale_context():
    async def scenario():
        client=LifecycleClient();app=WorkagentApp(client,'workspace')
        async with app.run_test(size=(60,24)) as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            app.query_one('#work',Select).value='c1'
            await pilot.pause();await app.workers.wait_for_complete();await pilot.pause()
            app.read_authorized=False;app.render_lifecycle_controls()
            assert all(app.query_one('#'+a,Button).disabled for a in ACTIONS)
            app.read_authorized=True;app.context['conversation_work_version']=2;app.render_lifecycle_controls()
            assert all(app.query_one('#'+a,Button).disabled for a in ACTIONS)
            app.context['conversation_work_version']=3
            app.context['responsibilities'][0]['owner_id']='other';app.render_lifecycle_controls()
            assert all(app.query_one('#'+a,Button).disabled for a in ACTIONS if a!='conversation-cancel')
            app.context['responsibilities'][0]['owner_id']='human'
            for state in ('taken_over','cancelled'):
                app.context['responsibilities'][0]['lifecycle']['state']=state
                app.canonical['responsibility'][0]['state']=state;app.render_lifecycle_controls()
                assert all(app.query_one('#'+a,Button).disabled for a in ACTIONS if a!='conversation-cancel')
            assert not client.posts
    asyncio.run(scenario())


def test_conversation_cancel_readback_uses_authorized_scope_not_assumed_ownership():
    client=LifecycleClient();client.cv['owner_id']='another-member'
    result=client.run('workspace','conversation-cancel',['c1'],principal_id='human',expected_work_version=3)
    assert result['receipt']['state']=='cancelled'
    assert result['readback']['conversation']['owner_id']=='another-member'


def test_native_control_freezes_displayed_assignment_cas_before_later_read():
    async def scenario():
        client=LifecycleClient();app=WorkagentApp(client,'workspace')
        async with app.run_test() as pilot:
            await app.workers.wait_for_complete();await pilot.pause()
            app.query_one('#work',Select).value='c1'
            await pilot.pause();await app.workers.wait_for_complete();await pilot.pause()
            frozen=app.lifecycle_selection()
            app.context['responsibilities'][0]['work_version']=8
            client.reject=True
            with pytest.raises(OperatorError,match='rejected'):
                await app.lifecycle_write('responsibility-pause',frozen)
            assert len(client.posts)==1 and client.posts[0][1]['expected_work_version']==7
            assert app.pending_command
    asyncio.run(scenario())
