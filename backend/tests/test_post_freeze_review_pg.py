"""Ordinary file CAS/acknowledgment; fresh restricted disposable PG only."""
from hashlib import sha256
import pytest
from test_domain import context,cmd
from test_workspace_files_pg import make
from post_freeze_packets import review_proposal,require_reviewed_transition
from workagent.errors import DomainError
from workagent.models import AcceptProposal,DismissProposal,HumanSave
from workagent.workspace_file_models import ProposeFilePatch


@pytest.mark.parametrize('decision',['accept','retain-current'])
def test_future_review_exact_cas_ack_and_protected_text(context,decision):
    s,p,ws,_,_=context
    protected='Human protected paragraph.'
    cv,file,_=make(context,protected+'\nObsolete paragraph to remove.\n')
    aid=file.workspace_file_id;ref=file.current;value=protected+'\nReviewed replacement.\n'
    proposal=s.propose_file_patch(p,ws,aid,cmd(ProposeFilePatch,expected_work_version=cv.work_version,
        base_version_id=ref.version_id,base_sha256=ref.sha256,content=value,
        sha256=sha256(value.encode()).hexdigest(),reason='Explicit review'))
    before=s.history(p,ws,aid)
    with pytest.raises(DomainError,match='review_required'):require_reviewed_transition(s,p,ws,aid,{})
    args=dict(current_revision_id=ref.version_id,base_revision_id=proposal.base_revision_id,
        body_hash=proposal.body_hash,decision=decision,justification='Reviewed whole-file change and protected paragraph.',protected_text=[protected])
    if decision=='accept':
        with pytest.raises(DomainError,match='review_required'):
            review_proposal(s,p,ws,proposal.id,command=cmd(AcceptProposal,expected_current_revision_id=ref.version_id),**args)
        assert s.history(p,ws,aid)==before
        command=cmd(AcceptProposal,expected_current_revision_id=ref.version_id,acknowledge_removed_content=True)
    else:command=cmd(DismissProposal,expected_current_revision_id=ref.version_id,resolution='keep_current')
    with pytest.raises(DomainError,match='validation_error'):
        review_proposal(s,p,ws,proposal.id,command=command,**{**args,'protected_text':['absent text']})
    receipt=review_proposal(s,p,ws,proposal.id,command=command,**args)
    assert review_proposal(s,p,ws,proposal.id,command=command,**args)==receipt
    proof=require_reviewed_transition(s,p,ws,aid,{proposal.id:receipt})
    current=s.get_artifact(p,ws,aid)
    assert proof['revision_id']==current.current_revision_id and proof['body_hash']==current.current_revision.body_hash
    assert protected in current.current_revision.body.content
    assert s.get_artifact(p,ws,aid,ref.version_id).requested_revision.body.content==protected+'\nObsolete paragraph to remove.\n'
    # A later ordinary human save makes the retained transition receipt stale.
    body=current.current_revision.body.model_copy(update={'content':current.current_revision.body.content+'New human work.','content_sha256':sha256((current.current_revision.body.content+'New human work.').encode()).hexdigest()})
    s.human_save(p,ws,aid,cmd(HumanSave,expected_current_revision_id=current.current_revision_id,body=body))
    with pytest.raises(DomainError,match='source_changed'):require_reviewed_transition(s,p,ws,aid,{proposal.id:receipt})


def test_withdrawn_producer_receipt_blocks_readable_human_transition(context,tmp_path):
    """Existing memory/source revocation fixture, actual scoped product reads."""
    from test_work_area_context import saved,document
    from test_memory_pg import remember
    from test_memory_parent_worker import activated
    from test_general_alpha_runtime import AlphaProvider
    from test_general_responses import worker
    from test_adaptive_execution import finish_safe_visits
    from test_conversations import post
    from test_local_rejection_settlement import journal,requests
    from workagent.memory.models import MemorySource
    from workagent.db import Database
    from workagent.service import Service
    s,p,ws,refs,admin=context
    cv,a=saved(context)
    protected='PRESERVED HUMAN BASE'
    a=s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=document(protected)))
    remember(context,cv,source_refs=[MemorySource(ref=refs[0])])
    activated(context,cv)
    q=post(context,s.get_conversation(p,ws,cv.id).conversation,'Prepare a reviewable alternative from the current memory.')
    def choose(ctx):
        return dict(kind='publish_artifact',target=ctx['work_area_context']['offered_targets'][0],body=document(protected+' Candidate.'))
    fake=AlphaProvider([choose,dict(kind='reply',text='Proposal awaits explicit human review.')])
    finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    proposal,=s.proposals(p,ws,a.id).items
    receipt=review_proposal(s,p,ws,proposal.id,current_revision_id=a.current_revision_id,
        base_revision_id=proposal.base_revision_id,body_hash=proposal.body_hash,
        decision='retain-current',justification='Keep the human baseline; candidate not selected.',
        command=cmd(DismissProposal,expected_current_revision_id=a.current_revision_id,resolution='keep_current'),protected_text=[protected])
    assert require_reviewed_transition(s,p,ws,a.id,{proposal.id:receipt})['revision_id']==a.current_revision_id
    events=journal(s,ws,q.run.id);prepared=requests(s,ws,q.run.id);sent=list(fake.calls)
    with s.db.transaction() as c:
        before=c.execute('SELECT data FROM proposals WHERE workspace_id=%s AND id=%s',(ws,proposal.id)).fetchone()['data']
        assert c.execute('SELECT memory_proposal_visible(%s,%s) ok',(ws,proposal.id)).fetchone()['ok']
    # Only this NEW disposable fixture's source access is withdrawn; never reset.
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    s=Service(s.db)
    assert s.get_artifact(p,ws,a.id).current_revision==a.current_revision
    assert s.proposals(p,ws,a.id).items==[]
    with s.db.transaction() as c:
        assert not c.execute('SELECT memory_proposal_visible(%s,%s) ok',(ws,proposal.id)).fetchone()['ok']
        with pytest.raises(DomainError,match='not_found_or_not_authorized'):s._proposal(c,p,ws,proposal.id)
        assert c.execute('SELECT data FROM proposals WHERE workspace_id=%s AND id=%s',(ws,proposal.id)).fetchone()['data']==before
    with pytest.raises(DomainError,match='source_changed'):require_reviewed_transition(s,p,ws,a.id,{proposal.id:receipt})
    # Historical hidden proposal is not a new review obligation without a claim
    # to use its receipt; the current human artifact remains independently read.
    assert require_reviewed_transition(s,p,ws,a.id,{})['revision_id']==a.current_revision_id
    assert journal(s,ws,q.run.id)==events and requests(s,ws,q.run.id)==prepared and fake.calls==sent
