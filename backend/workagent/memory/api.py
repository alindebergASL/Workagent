"""Human-only memory commands, existing authentication and command envelopes."""
from typing import Annotated
from fastapi import Depends, Query
from ..model_base import Id
from ..models import Request
from ..service import Principal
from .models import (MemoryReceipt, MemoryInspection, MemoryPage, RememberMemory, ProposeMemory,
    ReviewMemory, CorrectMemory, NarrowMemory, MemoryCAS, BindMemoryScope, MemoryScopeBinding,
    MemoryUsagePage, Kind, Status, Key)


def register(app, service, principal, query_meta, errors):
    P = Annotated[Principal, Depends(principal)]
    Meta = Annotated[Request, Depends(query_meta)]
    root = '/v1/workspaces/{workspace_id}/memory'

    @app.get(root, response_model=MemoryPage, operation_id='list_memory', responses=errors)
    def list_memory(workspace_id:Id, conversation_id:Id, p:P, meta:Meta,
                    query:Annotated[str, Query(max_length=500)]='', kind:Kind|None=None,
                    status:Status|None=None, subject_key:Key|None=None, predicate_key:Key|None=None):
        return service.list_memory(p, workspace_id, conversation_id, query=query, kind=kind,
            status=status, subject_key=subject_key, predicate_key=predicate_key)

    @app.post(root+'/remember', response_model=MemoryReceipt, status_code=201, operation_id='remember_memory', responses=errors)
    def remember(workspace_id:Id, body:RememberMemory, p:P):
        return service.remember_memory(p, workspace_id, body)

    @app.post(root+'/candidates', response_model=MemoryReceipt, status_code=201, operation_id='propose_memory', responses=errors)
    def propose(workspace_id:Id, body:ProposeMemory, p:P):
        return service.propose_memory(p, workspace_id, body)

    @app.post(root+'/scope-bindings', response_model=MemoryScopeBinding, operation_id='bind_memory_scope', responses=errors)
    def bind(workspace_id:Id, body:BindMemoryScope, p:P):
        return service.bind_memory_scope(p, workspace_id, body)

    @app.get('/v1/workspaces/{workspace_id}/runs/{run_id}/memory-usage', response_model=MemoryUsagePage,
             operation_id='memory_usage', responses=errors)
    def usage(workspace_id:Id, run_id:Id, p:P, meta:Meta):
        return service.memory_usage(p, workspace_id, run_id)

    @app.get(root+'/scope-bindings/{conversation_id}', response_model=MemoryScopeBinding|None,
             operation_id='get_memory_scope_binding', responses=errors)
    def get_binding(workspace_id:Id, conversation_id:Id, p:P, meta:Meta):
        return service.memory_scope_binding(p, workspace_id, conversation_id)

    @app.get(root+'/{memory_id}', response_model=MemoryInspection, operation_id='inspect_memory', responses=errors)
    def inspect(workspace_id:Id, memory_id:Id, p:P, meta:Meta):
        return service.inspect_memory(p, workspace_id, memory_id)

    @app.post(root+'/{memory_id}/review', response_model=MemoryReceipt, operation_id='review_memory', responses=errors)
    def review(workspace_id:Id, memory_id:Id, body:ReviewMemory, p:P):
        return service.review_memory(p, workspace_id, memory_id, body)

    @app.post(root+'/{memory_id}/correct', response_model=MemoryReceipt, operation_id='correct_memory', responses=errors)
    def correct(workspace_id:Id, memory_id:Id, body:CorrectMemory, p:P):
        return service.correct_memory(p, workspace_id, memory_id, body)

    @app.post(root+'/{memory_id}/narrow', response_model=MemoryReceipt, operation_id='narrow_memory', responses=errors)
    def narrow(workspace_id:Id, memory_id:Id, body:NarrowMemory, p:P):
        return service.narrow_memory(p, workspace_id, memory_id, body)

    @app.post(root+'/{memory_id}/expire', response_model=MemoryReceipt, operation_id='expire_memory', responses=errors)
    def expire(workspace_id:Id, memory_id:Id, body:MemoryCAS, p:P):
        return service.expire_memory(p, workspace_id, memory_id, body)

    @app.post(root+'/{memory_id}/forget', response_model=MemoryReceipt, operation_id='forget_memory', responses=errors)
    def forget(workspace_id:Id, memory_id:Id, body:MemoryCAS, p:P):
        return service.forget_memory(p, workspace_id, memory_id, body)
