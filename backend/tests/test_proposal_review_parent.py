"""Parent-owned behavior reproductions, usable on unchanged baseline."""
import pytest
from test_domain import context,cmd
from test_work_area_context import saved,propose,document
from workagent.models import AcceptProposal,HumanSave
from workagent.errors import DomainError

def test_older_same_base_cannot_apply_without_explicit_choice(context):
 s,p,ws,_,_=context; cv,a=saved(context)
 earlier=propose(context,cv,a,'CONTROLLED original')
 later=propose(context,cv,a,'CONTROLLED original')
 with pytest.raises(DomainError) as caught:
  s.accept_proposal(p,ws,earlier.id,cmd(AcceptProposal,expected_current_revision_id=a.current_revision_id))
 assert str(caught.value)=='review_required'
 assert s.get_artifact(p,ws,a.id).current_revision_id==a.current_revision_id
 assert {x.status for x in s.proposals(p,ws,a.id).items}=={'pending'}

def test_removed_human_note_requires_review(context):
 s,p,ws,_,_=context; cv,a=saved(context)
 body=document();body['blocks'].append({'block_id':'human-note','kind':'paragraph','text':'Human-approved accessibility wording must remain.','checked':None})
 edited=s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=body))
 candidate=propose(context,cv,edited,'CONTROLLED original')
 with pytest.raises(DomainError) as caught:
  s.accept_proposal(p,ws,candidate.id,cmd(AcceptProposal,expected_current_revision_id=edited.current_revision_id))
 assert str(caught.value)=='review_required'
 assert s.get_artifact(p,ws,a.id).current_revision_id==edited.current_revision_id

def test_unmodified_latest_candidate_still_works(context):
 s,p,ws,_,_=context; cv,a=saved(context)
 candidate=propose(context,cv,a,'CONTROLLED original')
 accepted=s.accept_proposal(p,ws,candidate.id,cmd(AcceptProposal,expected_current_revision_id=a.current_revision_id))
 assert accepted.current_revision_id!=a.current_revision_id
