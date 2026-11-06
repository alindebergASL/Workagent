"""Authenticated canonical research metadata; source text uses existing file ranges."""
from typing import Annotated
from fastapi import Depends, Query
from .model_base import Model, Id, Hash
from .models import Request
from .service import Principal
from .workspace_file_models import SourceSnapshot
from .research_models import ArtifactClaims


class ResearchSnapshotPage(Model):
    items: list[SourceSnapshot]
    next_after: Id | None = None


def register(app, service, principal, query_meta, errors):
    P = Annotated[Principal, Depends(principal)]
    Meta = Annotated[Request, Depends(query_meta)]
    root = '/v1/workspaces/{workspace_id}'

    @app.get(root+'/work-areas/{conversation_id}/research/snapshots', response_model=ResearchSnapshotPage, operation_id='list_research_snapshots', responses=errors)
    def snapshots(workspace_id:Id, conversation_id:Id, p:P, meta:Meta, after:Id|None=None,
                  limit:Annotated[int,Query(ge=1,le=100)]=25):
        with service.db.transaction() as c:
            service._scope(c,p,workspace_id)
            service._document_scope(c,p,workspace_id,conversation_id)
            rows = c.execute("SELECT s.id FROM source_snapshots s JOIN workspace_files f ON f.workspace_id=s.workspace_id AND f.id=s.workspace_file_id "
                "WHERE f.workspace_id=%s AND f.conversation_id=%s AND f.owner_id=%s AND s.id>%s AND s.data->'locator'->>'kind'='public_source' "
                "AND research_source_visible(s.workspace_id,s.id) ORDER BY s.id LIMIT %s", (workspace_id,conversation_id,p.id,after or '',limit+1)).fetchall()
            from .source_snapshots import read
            items = [read(service,c,p,workspace_id,r['id'])[0] for r in rows[:limit]]
            return ResearchSnapshotPage(items=items,next_after=items[-1].snapshot_id if len(rows)>limit else None)

    @app.get(root+'/research/snapshots/{snapshot_id}', response_model=SourceSnapshot, operation_id='get_research_snapshot', responses=errors)
    def snapshot(workspace_id:Id,snapshot_id:Id,p:P,meta:Meta):
        return service.get_source_snapshot(p,workspace_id,snapshot_id)

    @app.get(root+'/artifacts/{artifact_id}/revisions/{revision_id}/research/claims', response_model=ArtifactClaims, operation_id='get_artifact_research_claims', responses=errors)
    def artifact_claims(workspace_id:Id,artifact_id:Id,revision_id:Id,body_hash:Hash,p:P,meta:Meta):
        from .research import claims
        return claims(service,p,workspace_id,artifact_id,revision_id,body_hash)
