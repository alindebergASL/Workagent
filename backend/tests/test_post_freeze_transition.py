"""Offline sequencing only; restricted-PG controls are in the sibling file."""
from contextlib import contextmanager
from types import SimpleNamespace as N
from unittest.mock import MagicMock
import pytest
import post_freeze_transition as T
from workagent.errors import DomainError
from workagent.models import ExactTarget
from workagent.service import canonical


def command(**kw):
    args=dict(schema_version='workagent/v1',request_id='req',command_id='transition',
        kind='resume',source_run_id='source',conversation_id='cv',
        saved=ExactTarget(artifact_id='a',revision_id='r',body_hash='a'*64),
        receipts={'p':{'decision':'retain-current','justification':'Preserve human work.'}},
        protected_text=['Protected'],expected_work_version=2,text='Continue from reviewed saved work.')
    args.update(kw)
    return T.Transition(**args)


def test_transaction_adapter_never_opens_or_commits_connection():
    connection=MagicMock();db=T._TransactionDatabase(connection)
    with db.transaction() as outer:
        with db.transaction() as inner:assert inner is outer is connection
    connection.commit.assert_not_called();connection.close.assert_not_called()


@pytest.mark.parametrize('case',['missing','pending','stale','protected','conversation','source_run'])
def test_actual_consumer_denies_before_packet_or_admission(monkeypatch,case):
    s=MagicMock();scoped=MagicMock();s.allow_controlled_turns=False
    monkeypatch.setattr(T,'Service',lambda *a,**k:scoped)
    c=command(receipts={} if case=='missing' else command().receipts)
    gate=MagicMock(return_value=c.saved.model_dump())
    if case=='pending':gate.side_effect=DomainError('review_required')
    if case=='stale':gate.return_value={**c.saved.model_dump(),'revision_id':'later'}
    monkeypatch.setattr(T,'require_reviewed_transition',gate)
    scoped.get_artifact.return_value=N(conversation_id='other' if case=='conversation' else 'cv',
        current_revision=N(body=N(content='Gone' if case=='protected' else 'Protected')))
    scoped.get_run.return_value=N(conversation_id='other' if case=='source_run' else 'cv')
    packet=MagicMock();monkeypatch.setattr(T,'collect_packet',packet)
    with pytest.raises(DomainError):T.admit_transition(s,None,'w',c)
    scoped.post_message.assert_not_called();packet.assert_not_called();scoped._command.assert_not_called()


def test_actual_consumer_atomic_order_raw_saved_input_and_error_propagation(monkeypatch):
    s=MagicMock();s.allow_controlled_turns=False;scoped=MagicMock();order=[]
    @contextmanager
    def transaction():
        order.append('begin')
        try:yield object()
        except DomainError:
            order.append('rollback');raise
        else:order.append('commit')
    s.db.transaction=transaction
    monkeypatch.setattr(T,'Service',lambda *a,**k:scoped)
    monkeypatch.setattr(T,'require_reviewed_transition',lambda *a:command().saved.model_dump())
    from workagent.product_models import FileBody
    from hashlib import sha256
    body=FileBody(title='Human',filename='human.txt',mime_type='text/plain',content='Protected',content_sha256=sha256(b'Protected').hexdigest())
    scoped.get_artifact.return_value=N(conversation_id='cv',current_revision=N(body=body))
    scoped.get_run.return_value=N(conversation_id='cv')
    def collect(*a):order.append('collect');return {'state':'partial','external_unknown':False}
    monkeypatch.setattr(T,'collect_packet',collect)
    def post(*args):
        order.append('post');msg=args[-1]
        assert msg.target==command().saved
        assert msg.attachments[0].content==canonical(body)
        assert msg.command_id!=command().command_id
        raise DomainError('version_conflict')
    scoped.post_message.side_effect=post
    with pytest.raises(DomainError,match='version_conflict'):T.admit_transition(s,None,'w',command())
    assert order==['begin','collect','post','rollback']
    scoped._command.assert_not_called()


@pytest.mark.parametrize('fail_receipt',[False,True])
def test_consumer_runs_real_post_boundary_then_durable_packet_in_same_transaction(monkeypatch,fail_receipt):
    from workagent.models import Conversation, ConversationMessage, Run, MessageQueued
    from workagent.product_models import FileBody
    from hashlib import sha256
    s=MagicMock();s.allow_controlled_turns=False;scoped=MagicMock();order=[];connection=object()
    @contextmanager
    def transaction():
        order.append('begin')
        try:yield connection
        except DomainError:order.append('rollback');raise
        else:order.append('commit')
    s.db.transaction=transaction
    def bind(db,**kw):
        assert db.connection is connection and kw=={'allow_controlled_turns':False}
        return scoped
    monkeypatch.setattr(T,'Service',bind)
    monkeypatch.setattr(T,'require_reviewed_transition',lambda *a:command().saved.model_dump())
    body=FileBody(title='Saved',filename='saved.txt',mime_type='text/plain',content='Protected',content_sha256=sha256(b'Protected').hexdigest())
    scoped.get_artifact.return_value=N(conversation_id='cv',current_revision=N(body=body))
    scoped.get_run.return_value=N(conversation_id='cv')
    packet={'state':'partial','run_id':'source','external_unknown':False,'scoring':'unscored'}
    def collect(*_):order.append('collect');return packet
    monkeypatch.setattr(T,'collect_packet',collect)
    cv=Conversation(id='cv',workspace_id='w',owner_id='human',title='Review')
    run=Run(id='next',workspace_id='w',conversation_id='cv',principal_id='human',kind='conversation_turn',
            access_generation=1,profile='general-controlled-v1',bundle_hash='0'*64,tool_registry_hash='0'*64)
    message=ConversationMessage(id='m',conversation_id='cv',run_id='next',sequence=3,author_id='human',author_kind='human',text='Next',evidence_origin='human')
    admission=MessageQueued(conversation=cv,message=message,run=run)
    def post(*args):order.append('post');assert args[-1].target==command().saved;return admission
    scoped.post_message.side_effect=post
    def ledger(*args):
        order.append('retain')
        assert args[2]=='future_reviewed_transition' and args[4]==command()
        if fail_receipt:raise DomainError('command_conflict')
        return args[-1](connection,None)
    scoped._command.side_effect=ledger
    if fail_receipt:
        with pytest.raises(DomainError,match='command_conflict'):T.admit_transition(s,None,'w',command())
    else:
        result=T.admit_transition(s,None,'w',command())
        assert result.source_packet==packet and result.admission==admission
        assert result.source_packet_sha256==T.digest(packet) and result.human_time_measured is False
    assert order==['begin','collect','post','retain','rollback' if fail_receipt else 'commit']
