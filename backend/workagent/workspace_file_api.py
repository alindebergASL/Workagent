"""Authenticated file APIs share the existing Command and nonenumerating ACL path."""
from typing import Annotated
from fastapi import Depends, Query, Response
from .model_base import Id, Hash
from .models import Request, Proposal
from .service import Principal
from .workspace_file_models import (CreateWorkspaceFile, WorkspaceFile, WorkspaceFilePage, FileRange,
    ProposeFilePatch, EditWorkspaceFile, AcceptFileProposal, FileComparison, ExportFile, ExportArtifact,
    ExportManifest, SourceSnapshot, ImportOfficeDraft)


def register(app, service, principal, query_meta, errors):
    P = Annotated[Principal, Depends(principal)]
    Meta = Annotated[Request, Depends(query_meta)]
    root = '/v1/workspaces/{workspace_id}'

    @app.get(root + '/work-areas/{conversation_id}/files', response_model=WorkspaceFilePage, operation_id='list_workspace_files', responses=errors)
    def list_files(workspace_id:Id, conversation_id:Id, p:P, meta:Meta,
                   after:Id|None=None, limit:Annotated[int,Query(ge=1,le=100)]=25):
        return service.list_workspace_files(p, workspace_id, conversation_id, after, limit)

    @app.post(root + '/work-areas/{conversation_id}/files', response_model=WorkspaceFile, status_code=201, operation_id='create_workspace_file', responses=errors)
    def create_file(workspace_id:Id, conversation_id:Id, body:CreateWorkspaceFile, p:P):
        return service.create_workspace_file(p, workspace_id, conversation_id, body)

    @app.get(root + '/files/{file_id}/versions/{version_id}', response_model=FileRange, operation_id='read_workspace_file', responses=errors)
    def read_file(workspace_id:Id, file_id:Id, version_id:Id, sha256:Hash, p:P, meta:Meta,
                  offset:Annotated[int,Query(ge=0)]=0, limit:Annotated[int,Query(ge=1,le=8192)]=8192):
        return service.read_workspace_file(p, workspace_id, file_id, version_id, sha256, offset, limit)

    @app.post(root + '/files/{file_id}/versions', response_model=WorkspaceFile, status_code=201, operation_id='edit_workspace_file', responses=errors)
    def edit_file(workspace_id:Id, file_id:Id, body:EditWorkspaceFile, p:P):
        return service.edit_workspace_file(p, workspace_id, file_id, body)

    @app.post(root + '/files/{file_id}/proposals', response_model=Proposal, status_code=201, operation_id='propose_file_patch', responses=errors)
    def propose(workspace_id:Id, file_id:Id, body:ProposeFilePatch, p:P):
        return service.propose_file_patch(p, workspace_id, file_id, body)

    @app.post(root + '/files/{file_id}/proposals/{proposal_id}/accept', response_model=WorkspaceFile, operation_id='accept_file_proposal', responses=errors)
    def accept(workspace_id:Id, file_id:Id, proposal_id:Id, body:AcceptFileProposal, p:P):
        return service.accept_file_proposal(p, workspace_id, file_id, proposal_id, body)

    @app.get(root + '/files/{file_id}/compare', response_model=FileComparison, operation_id='compare_workspace_files', responses=errors)
    def compare(workspace_id:Id, file_id:Id, left_version_id:Id, left_sha256:Hash,
                right_version_id:Id, right_sha256:Hash, p:P, meta:Meta):
        return service.compare_workspace_files(p, workspace_id, file_id, left_version_id, left_sha256, right_version_id, right_sha256)

    @app.post(root + '/files/{file_id}/exports', response_model=ExportManifest, status_code=201, operation_id='export_workspace_file', responses=errors)
    def export_file(workspace_id:Id, file_id:Id, body:ExportFile, p:P):
        return service.export_workspace_file(p, workspace_id, file_id, body)

    @app.post(root + '/artifacts/{artifact_id}/exports', response_model=ExportManifest, status_code=201, operation_id='export_artifact', responses=errors)
    def export_artifact(workspace_id:Id, artifact_id:Id, body:ExportArtifact, p:P):
        return service.export_artifact(p, workspace_id, artifact_id, body)

    @app.get(root + '/exports/{export_id}/download', operation_id='download_export', responses={**errors, 200:{'content':{'application/octet-stream':{'schema':{'type':'string','format':'binary'}}}}})
    def download(workspace_id:Id, export_id:Id, p:P, meta:Meta):
        manifest, raw = service.download_export(p, workspace_id, export_id)
        return Response(content=raw, media_type=manifest.blob.mime_type, headers={
            'Content-Disposition':f'attachment; filename="{manifest.filename}"',
            'X-Content-Type-Options':'nosniff', 'X-Content-SHA256':manifest.blob.sha256,
            'Cache-Control':'private, no-store'})

    @app.post(root + '/work-areas/{conversation_id}/office-drafts',response_model=WorkspaceFile,status_code=201,operation_id='import_office_draft',responses=errors)
    def import_office(workspace_id:Id,conversation_id:Id,body:ImportOfficeDraft,p:P):
        return service.import_office_draft(p,workspace_id,conversation_id,body)

    @app.get(root + '/source-snapshots/{snapshot_id}', response_model=SourceSnapshot, operation_id='get_source_snapshot', responses=errors)
    def snapshot(workspace_id:Id, snapshot_id:Id, p:P, meta:Meta):
        return service.get_source_snapshot(p, workspace_id, snapshot_id)
