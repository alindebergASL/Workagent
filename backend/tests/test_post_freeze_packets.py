"""Future operational-review seam; offline doubles do not claim PG authority."""
from types import SimpleNamespace as N
from unittest.mock import MagicMock
import pytest
from post_freeze_packets import review_proposal,require_reviewed_transition
from workagent.errors import DomainError
from workagent.models import AcceptProposal,DismissProposal


def fixture():
    s=MagicMock();body=N(content='Protected human text. Old rest.')
    art=N(current_revision_id='r1',current_revision=N(body_hash='old',body=body))
    proposal=N(id='p',artifact_id='a',base_revision_id='r1',body_hash='new',
        body=N(content='Protected human text. New rest.'),status='pending',accepted_revision_id=None)
    s.get_artifact.return_value=art;s._proposal.return_value=(proposal,None,None)
    s.proposals.return_value=N(items=[proposal],next_cursor=None)
    return s,art,proposal


def args(command,**extra):
    return dict(current_revision_id='r1',base_revision_id='r1',body_hash='new',decision='accept',
        justification='Reviewed changed rest, preserving protected text.',command=command,
        protected_text=['Protected human text.'],**extra)


def command(cls=AcceptProposal,**kw):
    return cls(schema_version='workagent/v1',request_id='request',command_id='command',expected_current_revision_id='r1',**kw)


@pytest.mark.parametrize('damage',['protected','current','body','base','no_justification'])
def test_review_denies_before_effect(damage):
    s,art,proposal=fixture();a=args(command())
    if damage=='protected':proposal.body.content='Lost protected text'
    elif damage=='current':art.current_revision_id='r2'
    elif damage=='body':a['body_hash']='other'
    elif damage=='base':a['base_revision_id']='other'
    else:a['justification']=' '
    with pytest.raises(DomainError):review_proposal(s,None,'w','p',**a)
    s.accept_proposal.assert_not_called();s.dismiss_proposal.assert_not_called()


def test_acknowledgment_not_invented_or_caught():
    s,_,_=fixture();cmd=command()
    s.accept_proposal.side_effect=DomainError('review_required',fields=['acknowledge_removed_content'])
    with pytest.raises(DomainError,match='review_required'):review_proposal(s,None,'w','p',**args(cmd))
    assert s.accept_proposal.call_args.args[-1] is cmd and not cmd.acknowledge_removed_content


@pytest.mark.parametrize('decision',['accept','retain-current'])
def test_explicit_review_readback_and_next_transition(decision):
    s,art,proposal=fixture()
    with pytest.raises(DomainError,match='review_required'):require_reviewed_transition(s,None,'w','a',{})
    cmd=command(acknowledge_removed_content=True) if decision=='accept' else command(DismissProposal,resolution='keep_current')
    def accept(*_):
        art.current_revision_id='r2';art.current_revision=N(body_hash='new',body=proposal.body)
        proposal.status='accepted';proposal.accepted_revision_id='r2'
    s.accept_proposal.side_effect=accept
    s.dismiss_proposal.side_effect=lambda *_:setattr(proposal,'status','dismissed')
    a=args(cmd);a['decision']=decision
    receipt=review_proposal(s,None,'w','p',**a)
    assert receipt['human_time_measured'] is False and receipt['decision']==decision
    assert review_proposal(s,None,'w','p',**a)==receipt
    proof=require_reviewed_transition(s,None,'w','a',{'p':receipt})
    assert proof['revision_id']==art.current_revision_id and proof['body_hash']==art.current_revision.body_hash
    art.current_revision.body_hash='changed'
    with pytest.raises(DomainError,match='source_changed'):require_reviewed_transition(s,None,'w','a',{'p':receipt})


@pytest.mark.parametrize('case',['missing','withdrawn','wrong_artifact','stale','wrong_key'])
def test_supplied_receipt_cannot_disappear_from_authorized_pages(case):
    s,art,proposal=fixture();proposal.status='dismissed'
    receipt=dict(proposal_id='p',artifact_id='a',base_revision_id='r1',proposed_body_hash='new',
        current_revision_id='r1',current_body_hash='old',decision='retain-current',justification='Keep human work.')
    if case in ('missing','withdrawn','stale','wrong_key'):s.proposals.return_value=N(items=[],next_cursor=None)
    if case=='withdrawn':s._proposal.side_effect=DomainError('not_found_or_not_authorized')
    if case=='stale':art.current_revision_id='r2';art.current_revision.body_hash='changed'
    if case=='wrong_artifact':proposal.artifact_id='another-artifact'
    with pytest.raises(DomainError,match='source_changed'):
        require_reviewed_transition(s,None,'w','a',{'other' if case=='wrong_key' else 'p':receipt})
    s.accept_proposal.assert_not_called();s.dismiss_proposal.assert_not_called()


def test_review_receipt_completeness_preserves_pagination_and_unrelated_history():
    from copy import deepcopy
    s,art,proposal=fixture();proposal.status='dismissed'
    historic=deepcopy(proposal);historic.id='old';historic.base_revision_id='old-base'
    receipt=dict(proposal_id='p',artifact_id='a',base_revision_id='r1',proposed_body_hash='new',
        current_revision_id='r1',current_body_hash='old',decision='retain-current',justification='Keep current.')
    s.proposals.side_effect=[N(items=[historic],next_cursor='after-old'),N(items=[proposal],next_cursor=None)]
    assert require_reviewed_transition(s,None,'w','a',{'p':receipt})['revision_id']=='r1'
    assert [c.kwargs['cursor'] for c in s.proposals.call_args_list]==[None,'after-old']
    s.proposals.side_effect=None;s.proposals.return_value=N(items=[historic],next_cursor=None)
    assert require_reviewed_transition(s,None,'w','a',{})['revision_id']=='r1'
    proposal.status='pending';s.proposals.return_value=N(items=[historic,proposal],next_cursor=None)
    with pytest.raises(DomainError,match='review_required'):require_reviewed_transition(s,None,'w','a',{'p':receipt})
