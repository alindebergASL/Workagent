"""Draft ownership is revision provenance, never a model's block label."""
import copy

import pytest
from test_domain import context, cmd, raises
from test_flexible_work import publish
from workagent.models import HumanSave, AcceptProposal


def document(title='Preparation'):
    return {'title': title, 'blocks': [
        {'block_id': 'constraint', 'kind': 'protected_note',
         'text': 'Wait for my approval before external action.', 'checked': None},
        {'block_id': 'task', 'kind': 'checklist', 'text': 'Prepare the materials.', 'checked': False}]}


def test_agent_draft_advances_immutable_history_and_protects_transcribed_constraint(context):
    s,p,ws,_,_=context
    cv,first,art=publish(context,document())
    updated=document('Complete preparation')
    updated['blocks'].append({'block_id':'detail','kind':'paragraph','text':'Useful complete content.', 'checked':None})
    cv,second,current=publish(context,updated,cv,artifact_id=art.id,base_revision_id=art.current_revision_id)
    assert current.id==art.id and current.current_revision_id!=art.current_revision_id
    assert current.current_revision.author_kind=='worker'
    assert current.current_revision.parent_revision_id==art.current_revision_id
    assert second.revision_id==current.current_revision_id and second.proposal_id is None
    assert not s.proposals(p,ws,art.id).items
    assert s.get_product_observation(p,ws,first.observation_id).observation.revision_id==art.current_revision_id
    assert s.get_artifact(p,ws,art.id,art.current_revision_id).requested_revision.body.title=='Preparation'
    with s.db.transaction() as c:
        rows=c.execute('SELECT producer_run_id FROM revisions WHERE workspace_id=%s AND artifact_id=%s',(ws,art.id)).fetchall()
    assert all(r['producer_run_id'] for r in rows)
    removed=copy.deepcopy(updated); removed['blocks']=removed['blocks'][1:]
    from workagent.product_models import PublishArtifact
    with pytest.raises(ValueError,match='protected notes'):
        s._calculate_product(PublishArtifact(kind='publish_artifact',body=removed,
            artifact_id=art.id,base_revision_id=current.current_revision_id),current.current_revision)


def test_human_save_and_acceptance_end_agent_ownership_with_current_candidate_identity(context):
    s,p,ws,_,_=context
    cv,_,art=publish(context,document())
    human=document('Human title')
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=human))
    cv,one,_=publish(context,document('Candidate one'),cv,artifact_id=art.id,base_revision_id=saved.current_revision_id)
    cv,two,current=publish(context,document('Candidate two'),cv,artifact_id=art.id,base_revision_id=saved.current_revision_id)
    assert current.current_revision_id==saved.current_revision_id
    proposals={x.id:x for x in s.proposals(p,ws,art.id).items}
    assert not proposals[one.proposal_id].review.is_latest
    assert proposals[two.proposal_id].review.is_latest
    accepted=s.accept_proposal(p,ws,two.proposal_id,cmd(AcceptProposal,
        expected_current_revision_id=saved.current_revision_id,acknowledge_removed_content=True))
    cv,three,current=publish(context,document('Candidate three'),cv,artifact_id=art.id,base_revision_id=accepted.current_revision_id)
    assert current.current_revision_id==accepted.current_revision_id
    assert three.proposal_id
    proposals={x.id:x for x in s.proposals(p,ws,art.id).items}
    assert proposals[two.proposal_id].status=='accepted'
    assert not proposals[one.proposal_id].review.is_latest
    assert proposals[three.proposal_id].review.is_latest
    raises('version_conflict',lambda:s.accept_proposal(p,ws,one.proposal_id,cmd(AcceptProposal,
        expected_current_revision_id=accepted.current_revision_id,acknowledge_removed_content=True,acknowledge_older_proposal=True)))
