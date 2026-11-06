"""Read-only authenticated projections. No public tool execution or grant endpoint."""
from typing import Annotated
from fastapi import Depends, Query
from ..model_base import Id
from ..models import Request
from ..service import Principal
from ..errors import deny
from .models import CapabilityPage, ToolAttemptPage, ToolAttemptView
from .policy import discover
from .observations import page


def register(app,service,principal,query_meta,errors):
    P=Annotated[Principal,Depends(principal)]
    Meta=Annotated[Request,Depends(query_meta)]
    Limit=Annotated[int,Query(ge=1,le=100)]

    @app.get('/v1/workspaces/{workspace_id}/capabilities',response_model=CapabilityPage,
             operation_id='list_capabilities',responses=errors)
    def capabilities(workspace_id:Id,run_id:Id,p:P,meta:Meta):
        return discover(service,p,workspace_id,run_id)

    @app.get('/v1/workspaces/{workspace_id}/runs/{run_id}/tool-attempts',response_model=ToolAttemptPage,
             operation_id='list_tool_attempts',responses=errors)
    def attempts(workspace_id:Id,run_id:Id,p:P,meta:Meta,limit:Limit=50,after:Id|None=None):
        return page(service,p,workspace_id,run_id,after=after,limit=limit)

    @app.get('/v1/workspaces/{workspace_id}/tool-attempts/{attempt_id}',response_model=ToolAttemptView,
             operation_id='get_tool_attempt',responses=errors)
    def attempt(workspace_id:Id,attempt_id:Id,p:P,meta:Meta):
        with service.db.transaction() as c:
            service._scope(c,p,workspace_id)
            row=c.execute('SELECT run_id FROM tool_attempts WHERE workspace_id=%s AND id=%s',
                          (workspace_id,attempt_id)).fetchone()
            if not row:
                deny()
        result=page(service,p,workspace_id,row['run_id'],attempt_id=attempt_id,limit=1)
        if not result.items:
            deny()
        return result.items[0]
