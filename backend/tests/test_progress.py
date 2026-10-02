from test_domain import context, create, cmd, raises
from workagent.fixture import run_fixture, run_claimed
from workagent.models import RequestRevision, AcceptProposal


def test_revision_progress_remains_active_until_every_admitted_run_finishes(context):
    s,p,ws,refs,admin=context
    created=create(context)
    run_fixture(s,p,ws,created.run.id)
    a=s.get_assignment(p,ws,created.assignment.id)
    art=s.get_artifact(p,ws,a.artifact_ids[0])
    first=s.request_revision(p,ws,art.id,cmd(RequestRevision,base_revision_id=art.current_revision_id,expected_work_version=a.work_version,instruction='First bounded revision'))
    a=s.get_assignment(p,ws,a.id)
    assert a.state=='queued'
    second=s.request_revision(p,ws,art.id,cmd(RequestRevision,base_revision_id=art.current_revision_id,expected_work_version=a.work_version,instruction='Second independent revision'))
    cap=s.claim_run(p,ws,first.run.id)
    assert s.get_assignment(p,ws,a.id).state=='running'
    result=run_claimed(s,cap)
    assert s.get_assignment(p,ws,a.id).state=='queued'
    approved=s.accept_proposal(p,ws,result.proposal_id,cmd(AcceptProposal,expected_current_revision_id=art.current_revision_id))
    assert s.get_assignment(p,ws,a.id).state=='queued'  # Approval cannot finish another active run.
    cap=s.claim_run(p,ws,second.run.id)
    assert s.get_assignment(p,ws,a.id).state=='running'
    later=run_claimed(s,cap)
    assert s.get_assignment(p,ws,a.id).state=='ready'
    raises('version_conflict',lambda:s.accept_proposal(p,ws,later.proposal_id,cmd(AcceptProposal,expected_current_revision_id=approved.current_revision_id)))
    assert s.get_artifact(p,ws,art.id).current_revision_id==approved.current_revision_id
