"""Actual consumer/admission; NEW normally provisioned restricted fixture only.

Parent runs serial PG. No external transport: ControlledTransport or explicit
AlphaProvider MockTransport. No claim/effect of the newly admitted dependent run.
"""
from hashlib import sha256
import pytest
from test_domain import context, cmd
from test_workspace_files_pg import make
from test_conversations import post
from test_general_alpha_runtime import activate
from post_freeze_packets import review_proposal, collect_packet
from post_freeze_transition import Transition, admit_transition
from workagent.db import Database
from workagent.errors import DomainError
from workagent.general_worker import GeneralWorker, ControlledTransport
from workagent.models import AcceptProposal, DismissProposal, ExactTarget, HumanSave, AttachmentInput
from workagent.service import Service, canonical, digest
from workagent.workspace_file_models import ProposeFilePatch

PROTECTED='Human protected paragraph.'


def snapshot(s, ws):
    # Domain/receipt/effect tables, not ephemeral clock values.
    tables=('runs','run_configurations','run_dispatches','commands','audit','outbox',
            'conversation_messages','artifacts','revisions','proposals','provider_attempts',
            'responses_steps','tool_attempts')
    with s.db.transaction() as c:
        result={}
        for table in tables:
            if table=='responses_steps':
                # 006: steps own attempt_id, NOT workspace_id. Provider attempts
                # bind the owning run/workspace (004); retain the complete step.
                source='''responses_steps t JOIN provider_attempts a ON a.id=t.attempt_id
                    JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id'''
                scope='r.workspace_id'
            else:
                # Includes tool_attempts: 053 has workspace_id and a composite
                # (workspace_id,run_id) FK to runs. No provider-attempt join there.
                source=f'{table} t'
                scope='t.workspace_id'
            result[table]=c.execute(f'SELECT to_jsonb(t) row FROM {source} WHERE {scope}=%s ORDER BY to_jsonb(t)::text',(ws,)).fetchall()
        return result


def setup(context):
    s,p,ws,_,_=context
    cv,file,_=make(context,PROTECTED+'\nObsolete paragraph to remove.\n')
    cv=s.get_conversation(p,ws,cv.id).conversation
    prior=post(context,cv,'Keep the saved human work available for later review.')
    transport=ControlledTransport()
    assert GeneralWorker(s,transport=transport).work(p,ws,prior.run.id).state=='ready'
    cv=s.get_conversation(p,ws,cv.id).conversation
    value=PROTECTED+'\nReviewed replacement.\n'
    proposal=s.propose_file_patch(p,ws,file.workspace_file_id,cmd(ProposeFilePatch,
        expected_work_version=cv.work_version,base_version_id=file.current.version_id,
        base_sha256=file.current.sha256,content=value,sha256=sha256(value.encode()).hexdigest(),reason='Explicit review'))
    activate(context,cv)  # synthetic admission authority; no provider invocation
    return prior.run.id,file.workspace_file_id,proposal


def review(context, aid, proposal, decision, ack=True):
    s,p,ws,_,_=context;art=s.get_artifact(p,ws,aid)
    command=(cmd(AcceptProposal,expected_current_revision_id=art.current_revision_id,acknowledge_removed_content=ack)
        if decision=='accept' else cmd(DismissProposal,expected_current_revision_id=art.current_revision_id,resolution='keep_current'))
    return review_proposal(s,p,ws,proposal.id,current_revision_id=art.current_revision_id,
        base_revision_id=proposal.base_revision_id,body_hash=proposal.body_hash,decision=decision,
        justification='Explicit operational decision; preserve protected human work.',command=command,protected_text=[PROTECTED])


def transition(context, source, aid, receipts, kind='resume'):
    s,p,ws,_,_=context;art=s.get_artifact(p,ws,aid)
    cv=s.get_conversation(p,ws,art.conversation_id).conversation
    return cmd(Transition,kind=kind,source_run_id=source,conversation_id=cv.id,
        saved=ExactTarget(artifact_id=aid,revision_id=art.current_revision_id,body_hash=art.current_revision.body_hash),
        receipts=receipts,protected_text=[PROTECTED],expected_work_version=cv.work_version,
        text='Continue using exactly the reviewed saved work.',changed_inputs=(
            [AttachmentInput(filename='changed-input.txt',mime_type='text/plain',content='New authorized input: revised deadline.')]
            if kind=='changed-input' else []))


@pytest.mark.parametrize('decision,kind',[('accept','resume'),('retain-current','changed-input')])
def test_actual_reviewed_admission_restart_exact_input(context,decision,kind):
    s,p,ws,_,_=context;source,aid,proposal=setup(context)
    receipt=review(context,aid,proposal,decision)
    action=transition(context,source,aid,{proposal.id:receipt},kind)
    original=collect_packet(s,p,ws,source)
    result=admit_transition(s,p,ws,action)
    assert result.source_packet['state']==original['state']
    assert result.source_packet['run_id']==original['run_id']
    assert result.source_packet['run_produced_revisions']==original['run_produced_revisions']
    assert result.source_packet_sha256==digest(result.source_packet)
    assert result.human_time_measured is False and result.scoring=='unscored'
    assert result.admission.run.state=='queued' and result.admission.run.id!=source
    detail=s.get_conversation(p,ws,action.conversation_id)
    message=next(m for m in detail.messages if m.run_id==result.admission.run.id)
    assert message.target==action.saved and message.text==action.text
    body=s.get_artifact(p,ws,aid).current_revision.body
    assert message.attachments[0].content==canonical(body)
    assert message.attachments[0].sha256==result.saved_input_sha256
    assert [x.content for x in message.attachments[1:]]==[x.content for x in action.changed_inputs]
    before=snapshot(s,ws)
    restarted=Service(Database(s.db.dsn))
    assert admit_transition(restarted,p,ws,action)==result
    assert snapshot(restarted,ws)==before
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM provider_attempts WHERE run_id=%s',(result.admission.run.id,)).fetchone()
        assert not c.execute('SELECT 1 FROM tool_attempts WHERE run_id=%s',(result.admission.run.id,)).fetchone()
        retained=c.execute('SELECT result FROM commands WHERE workspace_id=%s AND command_id=%s',(ws,action.command_id)).fetchone()['result']
    assert retained==result.model_dump(mode='json')
    # Retry cannot bypass newer human CAS even though both receipts exist.
    art=s.get_artifact(p,ws,aid);content=body.content+'New human work.'
    s.human_save(p,ws,aid,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,
        body=body.model_copy(update={'content':content,'content_sha256':sha256(content.encode()).hexdigest()})))
    before=snapshot(s,ws)
    with pytest.raises(DomainError,match='source_changed'):admit_transition(restarted,p,ws,action)
    assert snapshot(s,ws)==before


@pytest.mark.parametrize('damage',['pending','missing','missing_ack','stale_receipt','wrong_revision','protected','work_version','authority'])
def test_consumer_denial_has_zero_dependent_admission(context,damage):
    s,p,ws,_,admin=context;source,aid,proposal=setup(context)
    receipts={}
    if damage=='missing_ack':
        before=snapshot(s,ws)
        with pytest.raises(DomainError,match='review_required'):review(context,aid,proposal,'accept',ack=False)
        assert snapshot(s,ws)==before
    elif damage!='pending':
        receipt=review(context,aid,proposal,'retain-current');receipts={proposal.id:receipt}
    action=transition(context,source,aid,receipts)
    if damage=='missing':action.receipts={}
    if damage=='stale_receipt':action.receipts[proposal.id]['current_body_hash']='0'*64
    if damage=='wrong_revision':action.saved=action.saved.model_copy(update={'revision_id':'wrong-revision'})
    if damage=='protected':action.protected_text=['Protected text that is absent']
    if damage=='work_version':action.expected_work_version+=1
    if damage=='authority':
        with Database(admin).transaction() as c:c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
    before=snapshot(s,ws)
    with pytest.raises(DomainError):admit_transition(s,p,ws,action)
    assert snapshot(s,ws)==before


def test_partial_packet_stays_partial_and_recollected_source_is_retained(context,tmp_path):
    from test_sustained_continuity import activate as continuity
    from test_general_alpha_runtime import AlphaProvider
    from test_general_responses import worker
    from test_adaptive_execution import finish_safe_visits
    from test_local_rejection_settlement import journal,requests
    s,p,ws,_,_=context
    cv,file,_=make(context,PROTECTED+'\nObsolete paragraph to remove.\n')
    cv=s.get_conversation(p,ws,cv.id).conversation;continuity(context,cv,max_steps=2)
    prior=post(context,cv,'Review context before preparing further work.')
    fake=AlphaProvider([dict(kind='read_context',section='messages'),dict(kind='read_context',section='messages')])
    result=finish_safe_visits(context,worker(context,fake,tmp_path),prior.run.id)
    assert result.state=='partial' and result.stop_reason=='step_limit'
    old=collect_packet(s,p,ws,prior.run.id);sent=list(fake.calls);events=journal(s,ws,prior.run.id);prepared=requests(s,ws,prior.run.id)
    cv=s.get_conversation(p,ws,cv.id).conversation;value=PROTECTED+'\nReviewed replacement.'
    proposal=s.propose_file_patch(p,ws,file.workspace_file_id,cmd(ProposeFilePatch,expected_work_version=cv.work_version,
        base_version_id=file.current.version_id,base_sha256=file.current.sha256,content=value,sha256=sha256(value.encode()).hexdigest(),reason='Review partial work context'))
    receipt=review(context,file.workspace_file_id,proposal,'retain-current')
    action=transition(context,prior.run.id,file.workspace_file_id,{proposal.id:receipt})
    result=admit_transition(s,p,ws,action)
    assert result.source_packet['state']==old['state']=='partial'
    assert result.source_packet['explanatory_unresolved']==old['explanatory_unresolved']
    assert result.source_packet['scoring']=='unscored' and 'goal_complete' not in result.source_packet
    assert result.source_packet['proposals']!=old['proposals']  # truthful recollection AFTER review
    assert s.get_run(p,ws,prior.run.id).state=='partial'
    assert fake.calls==sent and journal(s,ws,prior.run.id)==events and requests(s,ws,prior.run.id)==prepared


def test_withdrawn_receipt_blocks_actual_consumer_while_human_work_readable(context,tmp_path):
    from test_work_area_context import saved,document
    from test_memory_pg import remember
    from test_memory_parent_worker import activated
    from test_general_alpha_runtime import AlphaProvider
    from test_general_responses import worker
    from test_adaptive_execution import finish_safe_visits
    from workagent.memory.models import MemorySource
    s,p,ws,refs,admin=context
    cv,art=saved(context)
    art=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=document(PROTECTED)))
    remember(context,cv,source_refs=[MemorySource(ref=refs[0])]);activated(context,cv)
    prior=post(context,s.get_conversation(p,ws,cv.id).conversation,'Prepare a candidate using current memory.')
    fake=AlphaProvider([lambda ctx:dict(kind='publish_artifact',target=ctx['work_area_context']['offered_targets'][0],body=document(PROTECTED+' Candidate.')),
        dict(kind='reply',text='Candidate awaits explicit review.')])
    finish_safe_visits(context,worker(context,fake,tmp_path),prior.run.id)
    proposal,=s.proposals(p,ws,art.id).items
    receipt=review(context,art.id,proposal,'retain-current')
    action=transition(context,prior.run.id,art.id,{proposal.id:receipt})
    sent=list(fake.calls)
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    assert Service(s.db).get_artifact(p,ws,art.id).current_revision==art.current_revision
    assert s.proposals(p,ws,art.id).items==[]
    before=snapshot(s,ws)
    with pytest.raises(DomainError,match='source_changed'):admit_transition(Service(s.db),p,ws,action)
    assert snapshot(s,ws)==before and fake.calls==sent


def test_current_provider_revocation_blocks_new_dependent_admission(context):
    s,p,ws,_,admin=context;source,aid,proposal=setup(context)
    receipt=review(context,aid,proposal,'retain-current')
    action=transition(context,source,aid,{proposal.id:receipt})
    with Database(admin).transaction() as c:
        c.execute('UPDATE provider_grants SET active=false WHERE workspace_id=%s',(ws,))
    before=snapshot(s,ws)
    with pytest.raises(DomainError,match='action_unresolved'):admit_transition(s,p,ws,action)
    assert snapshot(s,ws)==before


def test_evidence_failure_rolls_back_real_post_admission(context,monkeypatch):
    s,p,ws,_,_=context;source,aid,proposal=setup(context)
    receipt=review(context,aid,proposal,'retain-current')
    action=transition(context,source,aid,{proposal.id:receipt})
    before=snapshot(s,ws);original=Service._command;observed=[]
    def fail_evidence(self,*args,**kwargs):
        if args[2]=='future_reviewed_transition':
            with self.db.transaction() as c:
                observed.extend(c.execute('SELECT id FROM runs WHERE workspace_id=%s AND id<>%s',(ws,source)).fetchall())
            raise DomainError('command_conflict')
        return original(self,*args,**kwargs)
    with monkeypatch.context() as m:
        m.setattr(Service,'_command',fail_evidence)
        with pytest.raises(DomainError,match='command_conflict'):admit_transition(s,p,ws,action)
    assert len(observed)==1  # real admission existed INSIDE the rolled-back transaction
    assert snapshot(s,ws)==before
    assert admit_transition(s,p,ws,action).admission.run.state=='queued'
