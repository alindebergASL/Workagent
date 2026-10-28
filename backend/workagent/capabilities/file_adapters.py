"""Reviewed file operations; all principals, grants and scope come from the broker."""
from typing import Literal
from types import SimpleNamespace
from pydantic import Field, model_validator, create_model
from ..composition import ReadDecision
from ..model_base import Model, Id, Hash
from ..workspace_file_models import (WorkingText, FileVersionRef, WorkspaceFile, WorkspaceFilePage,
    FileRange, FileComparison, ExportManifest, Content, ExportFormat)
from ..errors import DomainError, deny
from .models import InputRef


class FilesList(ReadDecision):
    kind: Literal['files_list']
    after: Id | None
    limit: int = Field(strict=True, ge=1, le=100)


class FilesReadRange(ReadDecision):
    kind: Literal['files_read_range']
    ref: FileVersionRef
    offset: int = Field(strict=True, ge=0)
    limit: int = Field(strict=True, ge=1, le=8192)


class DraftText(WorkingText):
    kind: Literal['text']


class FilesCreateDraft(ReadDecision):
    kind: Literal['files_create_draft']
    source: DraftText


class FilesProposePatch(ReadDecision):
    kind: Literal['files_propose_patch']
    ref: FileVersionRef
    content: Content
    sha256: Hash
    reason: str = Field(min_length=1, max_length=10000)


class FilesCompare(ReadDecision):
    kind: Literal['files_compare']
    left: FileVersionRef
    right: FileVersionRef

    @model_validator(mode='after')
    def same_file(self):
        if self.left.workspace_file_id != self.right.workspace_file_id:
            raise ValueError('compare requires versions of the same file')
        return self


class ExportInputRef(InputRef):
    kind: Literal['workspace_file', 'artifact_revision']


class ArtifactsExport(ReadDecision):
    kind: Literal['artifacts_export']
    input_ref: ExportInputRef
    format: ExportFormat


FILE_OPERATIONS = (FilesList, FilesReadRange, FilesCreateDraft, FilesProposePatch, FilesCompare, ArtifactsExport)
IDS = {'files_list':'files.list', 'files_read_range':'files.read_range', 'files_create_draft':'files.create_draft',
       'files_propose_patch':'files.propose_patch', 'files_compare':'files.compare', 'artifacts_export':'artifacts.export'}


def input_refs(request):
    def ref(value):
        return InputRef(kind='workspace_file', id=value.workspace_file_id, version=value.version_id, sha256=value.sha256)
    if isinstance(request, (FilesReadRange, FilesProposePatch)):
        return [ref(request.ref)]
    if isinstance(request, FilesCompare):
        return [ref(request.left), ref(request.right)]
    if isinstance(request, ArtifactsExport):
        return [InputRef.model_validate(request.input_ref.model_dump())]
    return []


def scope_targets(service, c, p, run, scope):
    if not run.conversation_id or scope.owner_id != p.id:
        deny()
    cfg = c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                    (run.workspace_id, run.id)).fetchone()['data']
    allowed = None
    if cfg.get('responsibility'):
        allowed = {d['object_id'] for d in cfg['responsibility']['observations'] if d['kind'] == 'artifact_revision'}
    row = c.execute("SELECT data->'target' AS target FROM conversation_messages WHERE workspace_id=%s AND conversation_id=%s AND run_id=%s AND author_kind IN ('human','system') ORDER BY sequence LIMIT 1",
                    (run.workspace_id, scope.id, run.id)).fetchone()
    target = row['target'] if row else None
    if target:
        allowed = {target['artifact_id']} if allowed is None else allowed & {target['artifact_id']}
    return allowed


def authorize_resources(service, c, p, run, scope, call, adapter):
    request = adapter.input_model.model_validate(call.arguments, strict=True)
    expected = input_refs(request)
    if call.input_refs != expected:
        deny()
    allowed = scope_targets(service, c, p, run, scope)
    if isinstance(request, FilesCreateDraft) and allowed is not None:
        deny()  # A targeted run cannot create unrelated workspace objects.
    for ref in expected:
        if ref.kind == 'workspace_file':
            row, actual, _, _ = service._file_version(c, p, run.workspace_id, ref.id, ref.version)
            if row['conversation_id'] != scope.id or actual.sha256 != ref.sha256:
                deny()
            if allowed is not None and row['artifact_id'] not in allowed:
                deny()
            if isinstance(request, FilesProposePatch):
                service._file_base(c, p, run.workspace_id, ref.id, ref.version, ref.sha256)
        elif ref.kind == 'artifact_revision':
            row, _ = service._export_artifact_input(c, p, run.workspace_id, ref.id, ref.version, ref.sha256)
            if row.get('conversation_id') != scope.id or (allowed is not None and ref.id not in allowed):
                deny()
        else:
            deny()
    return request, allowed


def invoke(service, cap, request, call):
    from . import policy, registry
    from ..workspace_files import range_result
    with service.db.transaction() as c:
        # The effect and final authority check share the workspace mutation lock.
        # No human API or forged human command is called from a model adapter.
        service._scope(c, SimpleNamespace(id=cap.principal_id), cap.workspace_id, write=True)
        adapter = registry.adapters()[call.capability_id]
        p, run, scope, grant = policy.authorize(service, c, cap, call, adapter)
        _, allowed = authorize_resources(service, c, p, run, scope, call, adapter)
        ws = run.workspace_id
        attempt = c.execute('SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=%s AND call_id=%s',
                            (ws, run.id, call.call_id)).fetchone()
        if not attempt: deny()
        if isinstance(request, FilesList):
            selectors = [x for x in grant.resource_selectors if allowed is None or x.id in allowed]
            result = service._list_workspace_files(c, p, ws, scope.id, request.after, request.limit, selectors)
        elif isinstance(request, FilesReadRange):
            _, ref, raw, snapshot = service._file_version(c, p, ws, request.ref.workspace_file_id, request.ref.version_id)
            result = range_result(ref, raw, request.offset, request.limit, snapshot)
        elif isinstance(request, FilesCreateDraft):
            attempt = c.execute('SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=%s AND call_id=%s',
                                (ws, run.id, call.call_id)).fetchone()
            if not attempt:
                deny()
            result = service._create_text_file(c, p, ws, scope, request.source, 'worker', file_id=attempt['id'])
        elif isinstance(request, FilesProposePatch):
            patch = SimpleNamespace(base_version_id=request.ref.version_id, base_sha256=request.ref.sha256,
                content=request.content, sha256=request.sha256, reason=request.reason, expected_work_version=call.expected_work_version)
            proposal = service._propose_file_patch(c, p, ws, request.ref.workspace_file_id, patch)
            result = {'proposal_id':proposal.id, 'workspace_file_id':proposal.artifact_id,
                      'base':request.ref.model_dump(mode='json'), 'proposed_sha256':request.sha256, 'status':'pending'}
        elif isinstance(request, FilesCompare):
            result = service._compare_workspace_files(c, p, ws, request.left.workspace_file_id,
                request.left.version_id, request.left.sha256, request.right.version_id, request.right.sha256)
        elif request.input_ref.kind == 'workspace_file':
            ref = request.input_ref
            result = service._export_workspace_file(c, p, ws, ref.id, ref.version, ref.sha256, request.format, tool_attempt_id=attempt['id'])
        else:
            ref = request.input_ref
            result = service._export_artifact(c, p, ws, ref.id, ref.version, ref.sha256, request.format, tool_attempt_id=attempt['id'])
        policy.authorize(service, c, cap, call, adapter)
        return {'capability':request.kind, 'version':'1',
                'result':result.model_dump(mode='json') if hasattr(result, 'model_dump') else result}


class FilePatchReceipt(Model):
    proposal_id: Id
    workspace_file_id: Id
    base: FileVersionRef
    proposed_sha256: Hash
    status: Literal['pending']


def adapters():
    from .registry import _adapter, ReadOutput
    result = {}
    result_types = {FilesList:WorkspaceFilePage, FilesReadRange:FileRange, FilesCreateDraft:WorkspaceFile,
                    FilesProposePatch:FilePatchReceipt, FilesCompare:FileComparison, ArtifactsExport:ExportManifest}
    for model in FILE_OPERATIONS:
        kind = next(iter(model.model_fields['kind'].annotation.__args__))
        name = IDS[kind]
        effects = ['read', 'draft'] if model in (FilesCreateDraft, FilesProposePatch) else ['read', 'local_compute', 'draft'] if model is ArtifactsExport else ['read']
        output_model = create_model(model.__name__+'Output', __base__=ReadOutput,
                                    capability=(Literal[kind], ...), result=(result_types[model], ...))
        adapter = _adapter(name, model, output_model, None,
            ('capabilities/file_adapters.py', 'workspace_files.py', 'workspace_file_models.py', 'source_snapshots.py',
             'artifact_exports.py', '../migrations/054_workspace_files.sql', '../migrations/055_file_gateway.sql'),
            version='1', effects=effects, resource_kinds=['workspace_file', 'artifact_revision'],
            profile='native-bounded-files-v1', category='rendering' if model is ArtifactsExport else 'local_compute')
        from dataclasses import replace
        result[name] = replace(adapter, invoke_fenced=invoke)
    return result
