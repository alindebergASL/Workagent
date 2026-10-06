"""Reviewed model-facing schemas only; parent broker binds a WorkerCapability.
Human HTTP save/accept endpoints are intentionally absent. Annotations are not grants.
"""
import hashlib
import json
from pathlib import Path
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


def responses_registry():
    """Separate profile-scoped registration; archived fixture pins remain intact."""
    from .responses_schema import scope_registry
    return scope_registry()


def registry_for_hash(expected):
    """Preserve pre-checkpoint fixture pins; archives are byte-bound, not trusted by name."""
    from .service import digest
    current=registry()
    if digest(current)==expected:
        return current
    # Exact pre-Responses schema is an additive projection, avoiding another
    # archived JSON snapshot. Its known digest must still match byte-for-byte
    # canonical semantics; this is not a permissive fallback for arbitrary pins.
    if expected=='5b4ec700d49b2b2debe28efc5230543b861763a37207b73c84f7e61de9019f10':
        def previous(value):
            if isinstance(value,list):
                return [previous(x) for x in value if x not in ('openai-responses-v1','provider_response_pending','provider_result_rejected')]
            if isinstance(value,dict):
                return {k:previous(v) for k,v in value.items() if k not in ('ResponseStepObservation','response_steps')}
            return value
        old=previous(registry_for_hash('a6ea2514e19db3a54319397736691b55302b2a1d700938adec8e7ebf225ecf3b'))
        if digest(old)!=expected:
            raise ValueError('pre-Responses registry projection drift')
        return old
    archives={
        '25398eb8d3e1a90265ee8c525a728c3662c920585744ef54e3ff21f5ee687b14':
            ('b1_tool_registry.json','2bf42c3fbd21a59b2ce34567ead7cd0f31e94894224e01daaecaf93835a0a036'),
        'a6ea2514e19db3a54319397736691b55302b2a1d700938adec8e7ebf225ecf3b':
            ('pre_b1_tool_registry.json','88a5ffa71414f234ea9eb8662edbb0f952903f4e6bd7ca572cea1ba2b9a11508'),
        '3e2f8620ade8655d26866eaed34e383d3f0a4ee31a96ad1fcc65909a28018572':
            ('legacy_tool_registry.json','2adb7311d13fdc420278f48b35b8432a107046cfce9ed77c21c882fe5a559aa2'),
        'b33dadca5b8c9c4b3e2f01041cd1c31d4b56723194edc0057d468f6de2f5d480':
            ('checkpoint_tool_registry.json','8739e9a6bdd078d6ea65903f30a6d4a7858ff18f6ff3a545c6055c45b8932647'),
    }
    if expected not in archives:
        raise ValueError('unreviewed tool registry')
    name,byte_hash=archives[expected]
    raw=Path(__file__).with_name(name).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=byte_hash or digest(json.loads(raw))!=expected:
        raise ValueError('unreviewed tool registry')
    return json.loads(raw)
