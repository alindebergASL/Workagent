"""Reviewed model-facing schemas only; parent broker binds a WorkerCapability.
Human HTTP save/accept endpoints are intentionally absent. Annotations are not grants.
"""
from .models import *

class GetAssignmentInput(Request):
    workspace_id: Id
    assignment_id: Id

class GetArtifactInput(Request):
    workspace_id: Id
    artifact_id: Id
    revision_id: Id | None = None

class GetTaskInput(Request):
    workspace_id: Id
    task_id: Id
    expected_version: Version | None = None
    expected_desired_result: Text | None = None

class ProposeArtifactRevisionInput(Command):
    workspace_id: Id
    artifact_id: Id
    base_revision_id: Id
    body: Body
    source_dependencies: list[SourceRef] = Field(max_length=50)

TOOLS = {
    'get_assignment': (GetAssignmentInput, Assignment, True),
    'get_artifact': (GetArtifactInput, Artifact, True),
    # Inspection persists evidence; not strictly read-only even though HTTP is GET.
    'get_task': (GetTaskInput, TaskInspection, False),
    'propose_artifact_revision': (ProposeArtifactRevisionInput, Run, False),
}

def registry():
    return {'schema_version':'workagent/v1','exposure':'assignment-capability-only; broker integration required',
            'tools':[{'name':name,'inputSchema':inp.model_json_schema(),'outputSchema':out.model_json_schema(),
                      'annotations':{'readOnlyHint':read_only,'destructiveHint':False,'openWorldHint':False}}
                     for name,(inp,out,read_only) in TOOLS.items()]}
