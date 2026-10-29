from typing import Annotated
from fastapi import Depends
from ..model_base import Id
from ..models import Request
from ..service import Principal
from .models import (UUID, StartAuthorization, CompleteAuthorization, RevokeConnector,
                     AuthorizationFlow, ConnectorStatus, ConnectorPage)
from . import service as lifecycle
from .revocation import revoke

def register(app,service,principal,query_meta,errors):
    P=Annotated[Principal,Depends(principal)]
    Meta=Annotated[Request,Depends(query_meta)]
    @app.get('/v1/workspaces/{workspace_id}/connectors',response_model=ConnectorPage,operation_id='list_connectors',responses=errors)
    def listing(workspace_id:Id,p:P,meta:Meta):return lifecycle.listing(service,p,workspace_id)
    @app.post('/v1/workspaces/{workspace_id}/connectors/authorization-flows',response_model=AuthorizationFlow,operation_id='start_connector_authorization',responses=errors)
    def start(workspace_id:Id,body:StartAuthorization,p:P,meta:Meta):return lifecycle.start(service,p,workspace_id,body)
    @app.post('/v1/workspaces/{workspace_id}/connectors/authorization-flows/{flow_id}/complete',response_model=ConnectorStatus,operation_id='complete_connector_authorization',responses=errors)
    def complete(workspace_id:Id,flow_id:UUID,body:CompleteAuthorization,p:P,meta:Meta):return lifecycle.complete(service,p,workspace_id,flow_id,body)
    @app.get('/v1/workspaces/{workspace_id}/connectors/{connector_id}/status',response_model=ConnectorStatus,operation_id='get_connector_status',responses=errors)
    def status(workspace_id:Id,connector_id:UUID,p:P,meta:Meta):return lifecycle.status(service,p,workspace_id,connector_id)
    @app.post('/v1/workspaces/{workspace_id}/connectors/{connector_id}/revoke',response_model=ConnectorStatus,operation_id='revoke_connector',responses=errors)
    def remove(workspace_id:Id,connector_id:UUID,body:RevokeConnector,p:P,meta:Meta):return revoke(service,p,workspace_id,connector_id,body)
