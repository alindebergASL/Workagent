"""Local-only HTTP adapter. No provider runtime, OAuth, or public credentials."""
import os
import re
import secrets
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, Query, Request as HTTPRequest
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from .db import Database
from .errors import DomainError, STATUS
from .models import *
from .service import Service, Principal


@dataclass(frozen=True)
class Settings:
    database_url: str
    local_test_mode: bool
    local_bearer: str
    principal_id: str = 'local-human'
    frontend_origin: str | None = None

    @classmethod
    def environment(cls):
        return cls(os.environ.get('DATABASE_URL',''),os.environ.get('LOCAL_TEST_MODE')=='true',
                   os.environ.get('LOCAL_BEARER_TOKEN',''),os.environ.get('LOCAL_PRINCIPAL_ID','local-human'),
                   os.environ.get('FRONTEND_ORIGIN'))

    def validate(self):
        if not self.local_test_mode or len(self.local_bearer)<32 or not self.database_url:
            raise RuntimeError('Explicit LOCAL_TEST_MODE=true, DATABASE_URL and a private random LOCAL_BEARER_TOKEN (32+ characters) are required.')
        if self.frontend_origin and not re.fullmatch(r'http://(localhost|127\.0\.0\.1):[0-9]{1,5}',self.frontend_origin):
            raise RuntimeError('Only a loopback frontend origin is allowed in local fixture mode.')


security=HTTPBearer(auto_error=False)


def create_app(settings: Settings | None=None) -> FastAPI:
    # Exporting OpenAPI is offline; startup, not module import, validates credentials.
    settings=settings or Settings.environment()
    service=Service(Database(settings.database_url)) if settings.database_url else None

    @asynccontextmanager
    async def lifespan(app):
        settings.validate()
        service.db.check_runtime_role()
        yield

    app=FastAPI(title='Workagent local domain baseline',version='1.0.0',openapi_version='3.1.0',lifespan=lifespan,
                description='Isolated PostgreSQL-backed fixture/scenario service. Not a live provider runtime. Bearer is a private local human credential; no model-callable approval surface.')
    app.state.service=service
    if settings.frontend_origin:
        app.add_middleware(CORSMiddleware,allow_origins=[settings.frontend_origin],allow_methods=['GET','POST'],allow_headers=['Authorization','Content-Type','X-Request-Id','X-Schema-Version'],allow_credentials=False)

    def principal(credentials: Annotated[HTTPAuthorizationCredentials | None,Depends(security)]):
        if not settings.local_test_mode or not credentials or not secrets.compare_digest(credentials.credentials,settings.local_bearer):
            raise DomainError('unauthenticated')
        return Principal(settings.principal_id)

    def query_meta(x_schema_version: Annotated[Literal['workagent/v1'],Header()],x_request_id: Annotated[Id,Header()]):
        return Request(schema_version=x_schema_version,request_id=x_request_id)

    P=Annotated[Principal,Depends(principal)]
    Meta=Annotated[Request,Depends(query_meta)]
    Limit=Annotated[int,Query(ge=1,le=100)]
    Cursor=Annotated[Id | None,Query()]

    @app.middleware('http')
    async def boundary(request,call_next):
        request.state.request_id=request.headers.get('x-request-id','request-unavailable')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}',request.state.request_id):
            request.state.request_id='request-unavailable'
        if request.method=='POST':
            raw=await request.body()
            if len(raw)>256_000:
                e=DomainError('validation_error',fields=['body'])
                return JSONResponse(e.envelope(request.state.request_id).model_dump(mode='json'),status_code=422)
            try:
                import json
                rid=json.loads(raw).get('request_id')
                if isinstance(rid,str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}',rid):
                    request.state.request_id=rid
            except (ValueError,AttributeError):
                pass
        response=await call_next(request)
        response.headers['Cache-Control']='no-store'
        response.headers['X-Request-Id']=request.state.request_id
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request: HTTPRequest,exc: DomainError):
        return JSONResponse(exc.envelope(request.state.request_id).model_dump(mode='json'),status_code=STATUS[exc.code])

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: HTTPRequest,exc: RequestValidationError):
        fields=['.'.join(str(v) for v in e['loc'])[:200] for e in exc.errors()[:50]]
        e=DomainError('validation_error',fields=fields)
        return JSONResponse(e.envelope(request.state.request_id).model_dump(mode='json'),status_code=422)

    @app.exception_handler(Exception)
    async def internal_error(request: HTTPRequest,exc: Exception):
        e=DomainError('internal_error')
        return JSONResponse(e.envelope(getattr(request.state,'request_id','request-unavailable')).model_dump(mode='json'),status_code=500,headers={'Cache-Control':'no-store'})

    from starlette.exceptions import HTTPException
    @app.exception_handler(HTTPException)
    async def transport_error(request: HTTPRequest,exc: HTTPException):
        e=DomainError('not_found_or_not_authorized' if exc.status_code==404 else 'unsupported_operation')
        return JSONResponse(e.envelope(request.state.request_id).model_dump(mode='json'),status_code=404 if exc.status_code==404 else 422)

    errors={status:{'model':ErrorEnvelope,'description':description} for status,description in {
        401:'Missing or invalid local authentication',404:'Absent and inaccessible resources are indistinguishable',
        409:'Domain conflict, unavailable source, decision, budget or unresolved state',422:'Schema validation or unsupported operation',
        500:'Sanitized internal adapter/storage failure; inspect state before retrying a mutation'}.items()}
    def route(path,method,operation_id,model,status=200):
        return app.api_route(path,methods=[method],operation_id=operation_id,response_model=model,status_code=status,responses=errors)

    @route('/v1/workspaces','GET','list_workspaces',WorkspacePage)
    def list_workspaces(p:P,meta:Meta,cursor:Cursor=None,limit:Limit=25):
        return service.list_workspaces(p,cursor,limit)

    @route('/v1/workspaces/{workspace_id}/sources','GET','list_sources',SourcePage)
    def list_sources(workspace_id:Id,p:P,meta:Meta,cursor:Cursor=None,limit:Limit=25):
        return service.list_sources(p,workspace_id,cursor,limit)

    @route('/v1/workspaces/{workspace_id}/assignments','GET','list_assignments',AssignmentPage)
    def list_assignments(workspace_id:Id,p:P,meta:Meta,cursor:Cursor=None,limit:Limit=25):
        return service.list_assignments(p,workspace_id,cursor,limit)

    @route('/v1/workspaces/{workspace_id}/assignments','POST','create_assignment',AssignmentCreated,202)
    def create_assignment(workspace_id:Id,body:CreateAssignment,p:P):
        return service.create_assignment(p,workspace_id,body)

    @route('/v1/workspaces/{workspace_id}/assignments/{assignment_id}','GET','get_assignment',Assignment)
    def get_assignment(workspace_id:Id,assignment_id:Id,p:P,meta:Meta):
        return service.get_assignment(p,workspace_id,assignment_id)

    @route('/v1/workspaces/{workspace_id}/assignments/{assignment_id}/control','POST','control_assignment',Assignment)
    def control_assignment(workspace_id:Id,assignment_id:Id,body:ControlAssignment,p:P):
        return service.control_assignment(p,workspace_id,assignment_id,body)

    @route('/v1/workspaces/{workspace_id}/runs/{run_id}','GET','get_run',Run)
    def get_run(workspace_id:Id,run_id:Id,p:P,meta:Meta):
        return service.get_run(p,workspace_id,run_id)

    @route('/v1/workspaces/{workspace_id}/artifacts/{artifact_id}','GET','get_artifact',Artifact)
    def get_artifact(workspace_id:Id,artifact_id:Id,p:P,meta:Meta,revision_id:Id | None=None):
        return service.get_artifact(p,workspace_id,artifact_id,revision_id)

    @route('/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/history','GET','get_artifact_history',RevisionPage)
    def history(workspace_id:Id,artifact_id:Id,p:P,meta:Meta,cursor:Cursor=None,limit:Limit=25):
        return service.history(p,workspace_id,artifact_id,cursor,limit)

    @route('/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/proposals','GET','list_proposals',ProposalPage)
    def proposals(workspace_id:Id,artifact_id:Id,p:P,meta:Meta,cursor:Cursor=None,limit:Limit=25):
        return service.proposals(p,workspace_id,artifact_id,cursor,limit)

    @route('/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/save','POST','human_save',Artifact)
    def save(workspace_id:Id,artifact_id:Id,body:HumanSave,p:P):
        return service.human_save(p,workspace_id,artifact_id,body)

    @route('/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/request-revision','POST','request_revision',RevisionQueued,202)
    def revise(workspace_id:Id,artifact_id:Id,body:RequestRevision,p:P):
        return service.request_revision(p,workspace_id,artifact_id,body)

    @route('/v1/workspaces/{workspace_id}/proposals/{proposal_id}/accept','POST','accept_revision',Artifact)
    def accept(workspace_id:Id,proposal_id:Id,body:AcceptProposal,p:P):
        return service.accept_proposal(p,workspace_id,proposal_id,body)

    @route('/v1/workspaces/{workspace_id}/proposals/{proposal_id}/dismiss','POST','dismiss_proposal',Proposal)
    def dismiss(workspace_id:Id,proposal_id:Id,body:DismissProposal,p:P):
        return service.dismiss_proposal(p,workspace_id,proposal_id,body)

    @route('/v1/workspaces/{workspace_id}/assignments/{assignment_id}/tasks','POST','create_task',TaskReceipt,201)
    def create_task(workspace_id:Id,assignment_id:Id,body:CreateTask,p:P):
        return service.create_task(p,workspace_id,assignment_id,body)

    @route('/v1/workspaces/{workspace_id}/tasks/{task_id}','GET','get_task',TaskInspection)
    def get_task(workspace_id:Id,task_id:Id,p:P,meta:Meta,expected_version:Annotated[int | None,Query(ge=1,le=2147483647)]=None,expected_desired_result:Text | None=None):
        return service.get_task(p,workspace_id,task_id,expected_version,expected_desired_result)

    def canonical_openapi():
        if app.openapi_schema:
            return app.openapi_schema
        from fastapi.openapi.utils import get_openapi
        from .examples import examples
        spec=get_openapi(title=app.title,version=app.version,description=app.description,routes=app.routes,openapi_version='3.1.0')
        sample=examples()
        for path in spec['paths'].values():
            for operation in path.values():
                illustration=sample['operations'].get(operation.get('operationId'),{})
                if 'request' in illustration:
                    operation['requestBody']['content']['application/json']['example']=illustration['request']
                for status,response in operation['responses'].items():
                    if status.startswith('2') and 'response' in illustration:
                        response['content']['application/json']['example']=illustration['response']
                    if status=='404':
                        response['content']['application/json']['example']=sample['scenarios']['denied']
                    if status=='409':
                        response['content']['application/json']['examples']={name:{'value':sample['scenarios'][name]} for name in ['stale','command_conflict']}
        app.openapi_schema=spec
        return spec
    app.openapi=canonical_openapi
    return app

app=create_app()
