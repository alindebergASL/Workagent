"""Schema-validated illustrative contract examples, NOT execution evidence."""
from datetime import datetime, timezone
from .models import *
from .errors import DomainError
from .service import digest, fixture_pins


def examples():
    at=datetime(2026,10,2,tzinfo=timezone.utc)
    meta={'schema_version':'workagent/v1','request_id':'request-example','command_id':'command-example'}
    ref=SourceRef(source_id='SG-F2',external_version='1',observed_at=at)
    a=Assignment(id='assignment-example',workspace_id='workspace-example',owner_id='local-human',goal='Improve private intake review',completion_criteria=['A reusable checklist'],selected_source_refs=[ref],run_ids=['run-example'],observed_at=at)
    r=Run(id='run-example',workspace_id=a.workspace_id,assignment_id=a.id,principal_id=a.owner_id,kind='initial',access_generation=1,bundle_hash=fixture_pins()[0],tool_registry_hash=fixture_pins()[1],observed_at=at)
    body=Body(title='Private working plan',blocks=[Block(block_id='next-action',kind='checklist',text='Record an owner and a next action for the next personal intake case.')])
    revision=Revision(id='revision-1',artifact_id='artifact-example',revision_number=1,parent_revision_id=None,author_id='local-human',author_kind='worker',body=body,body_hash=digest(body),source_dependencies=[ref],created_at=at)
    artifact=Artifact(id=revision.artifact_id,workspace_id=a.workspace_id,assignment_id=a.id,current_revision_id=revision.id,current_revision=revision,observed_at=at)
    proposal=Proposal(id='proposal-example',workspace_id=a.workspace_id,assignment_id=a.id,artifact_id=artifact.id,base_revision_id=revision.id,base_work_version=1,body=body,body_hash=digest(body),source_dependencies=[ref],reason='Make the next action concrete',created_at=at)
    saved_revision=revision.model_copy(update={'id':'revision-2','revision_number':2,'parent_revision_id':revision.id,'author_kind':'human'})
    saved=artifact.model_copy(update={'current_revision_id':saved_revision.id,'current_revision':saved_revision})
    def dump(v): return v.model_dump(mode='json')
    scenarios={
        'creation':dump(AssignmentCreated(assignment=a,run=r)),
        'progress':dump(r.model_copy(update={'state':'running','fence':1,'lease_expires_at':at})),
        'ready':dump(a.model_copy(update={'state':'ready','artifact_ids':[artifact.id],'work_version':3})),
        'artifact':dump(artifact),'human_save':dump(saved),'stale_proposal':dump(proposal),
        'stale':dump(DomainError('version_conflict',current_revision_id=saved_revision.id,proposal_id=proposal.id).envelope('request-example')),
        'denied':dump(DomainError('not_found_or_not_authorized').envelope('request-example')),
        'command_conflict':dump(DomainError('command_conflict').envelope('request-example')),
        'partial':dump(r.model_copy(update={'state':'partial','unresolved':['No usable intake rows supplied; the baseline cannot be quantified.']})),
        'reopen_saved_work':dump(saved),
    }
    operations={
        'create_assignment':{'request':dump(CreateAssignment(**meta,goal=a.goal,completion_criteria=a.completion_criteria,selected_source_refs=[ref])),'response':scenarios['creation']},
        'get_assignment':{'response':scenarios['ready']},'get_run':{'response':scenarios['progress']},
        'get_artifact':{'response':scenarios['artifact']},
        'human_save':{'request':dump(HumanSave(**meta,expected_current_revision_id=revision.id,body=body)),'response':scenarios['human_save']},
        'request_revision':{'request':dump(RequestRevision(**meta,expected_work_version=3,base_revision_id=revision.id,instruction='Make next action concrete'))},
        'accept_revision':{'request':dump(AcceptProposal(**meta,expected_current_revision_id=revision.id))},
        'dismiss_proposal':{'request':dump(DismissProposal(**meta,expected_current_revision_id=saved_revision.id,resolution='keep_current'))},
        'create_task':{'request':dump(CreateTask(**meta,expected_work_version=3,owner_id='local-human',desired_result='Review checklist',evidence_refs=[ref]))},
        'control_assignment':{'request':dump(ControlAssignment(**meta,expected_work_version=3,operation='pause'))}
    }
    return {'label':'Illustrative schema examples; not live provider or test evidence','scenarios':scenarios,'operations':operations}
