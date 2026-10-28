"""Authenticated polling/SSE adapters. No command execution on GET/reconnect."""
import asyncio
import json
import os
import secrets
import time
from typing import Annotated

from fastapi import Depends, Header, Query, Request as HTTPRequest
from fastapi.responses import StreamingResponse

from .errors import DomainError
from .model_base import Id
from .models import Request
from .service import Principal
from .work_cursors import CursorCodec
from .work_event_models import (AttentionPage, AttentionSeen, AttentionSeenResult,
    EventPage, Identity, OpaqueCursor, WorkSnapshot)
from .work_events import WorkEvents
from .work_snapshot import read

POLL_SECONDS = 2
HEARTBEAT_SECONDS = 15


def frame(name, data, cursor=None):
    prefix = f'id: {cursor}\n' if cursor else ''
    return prefix + f'event: {name}\ndata: ' + json.dumps(data,separators=(',',':')) + '\n\n'


async def stream(events, p, ws, cid, after, limit, request, authenticate, initial):
    page = initial
    last_heartbeat = time.monotonic()
    while True:
        if await request.is_disconnected():
            return
        try:
            authenticate()
            if page is None:
                page = await asyncio.to_thread(events.page,p,ws,cid,after,limit)
        except DomainError:
            yield frame('snapshot.required', {'reason':'access_changed'})
            return
        if page.reset_required:
            yield frame('snapshot.required', {'reason':'cursor_reset'})
            return
        _, generation = events.codec.decode(page.next_cursor,ws,p.id,cid)
        for event in page.events:
            if await request.is_disconnected():
                return
            cursor = events.token(event.event_id,p,ws,cid,generation)
            try:
                authenticate()
                await asyncio.to_thread(events.authorize_stream,p,ws,cid,cursor)
            except DomainError:
                yield frame('snapshot.required', {'reason':'access_changed'})
                return
            yield frame('work.changed',event.model_dump(mode='json'),cursor)
            after = cursor
        # Every empty batch also reauthorizes. No transaction/connection is held
        # across a yield, sleep, heartbeat or client disconnect.
        if time.monotonic() - last_heartbeat >= HEARTBEAT_SECONDS:
            try:
                authenticate()
                await asyncio.to_thread(events.authorize_stream,p,ws,cid,after or page.next_cursor)
            except DomainError:
                yield frame('snapshot.required', {'reason':'access_changed'})
                return
            yield ': heartbeat\n\n'
            last_heartbeat = time.monotonic()
        more = page.has_more
        page = None
        if not more:
            await asyncio.sleep(min(POLL_SECONDS,max(0,HEARTBEAT_SECONDS-(time.monotonic()-last_heartbeat))))


def register(app, service, settings, principal, query_meta, errors):
    P = Annotated[Principal, Depends(principal)]
    Meta = Annotated[Request, Depends(query_meta)]
    Limit = Annotated[int, Query(ge=1,le=100)]
    After = Annotated[str | None, Query(max_length=128)]
    LastEvent = Annotated[str | None, Header(alias='Last-Event-ID',max_length=128)]

    def events():
        # OpenAPI export has no credential. Instantiate only on authenticated use.
        return WorkEvents(service,CursorCodec(settings.local_bearer))

    def route(path, method, name, model):
        return app.api_route(path,methods=[method],operation_id=name,response_model=model,responses=errors)

    @route('/v1/identity','GET','get_identity',Identity)
    def identity(p:P,meta:Meta):
        return Identity(principal_id=p.id)

    @route('/v1/workspaces/{workspace_id}/work-snapshot','GET','get_work_snapshot',WorkSnapshot)
    def snapshot(workspace_id:Id,conversation_id:Id,p:P,meta:Meta):
        return read(events(),p,workspace_id,conversation_id,os.environ.get('WORKAGENT_EXECUTION_STATUS'))

    @route('/v1/workspaces/{workspace_id}/events','GET','get_work_events',EventPage)
    def page(workspace_id:Id,conversation_id:Id,p:P,meta:Meta,after:After=None,limit:Limit=100):
        return events().page(p,workspace_id,conversation_id,after,limit)

    @app.get('/v1/workspaces/{workspace_id}/events/stream',operation_id='stream_work_events',
             response_class=StreamingResponse,responses={**errors,200:{'content':{'text/event-stream':{}}}})
    async def subscribe(workspace_id:Id,conversation_id:Id,p:P,meta:Meta,request:HTTPRequest,
                        after:After=None,limit:Limit=100,last_event_id:LastEvent=None):
        lane = events()
        cursor = after if after is not None else last_event_id
        initial = await asyncio.to_thread(lane.page,p,workspace_id,conversation_id,cursor,limit)

        def authenticate():
            scheme, _, credential = request.headers.get('authorization','').partition(' ')
            if not settings.local_test_mode or scheme.lower()!='bearer' or not secrets.compare_digest(
                    credential, settings.local_bearer):
                raise DomainError('unauthenticated')

        return StreamingResponse(stream(lane,p,workspace_id,conversation_id,cursor,limit,request,authenticate,initial),
            media_type='text/event-stream',headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'})

    @route('/v1/workspaces/{workspace_id}/attention','GET','get_work_attention',AttentionPage)
    def attention(workspace_id:Id,conversation_id:Id,p:P,meta:Meta,after:After=None,limit:Limit=100):
        return events().attention(p,workspace_id,conversation_id,after,limit)

    @route('/v1/workspaces/{workspace_id}/attention/seen','POST','mark_work_attention_seen',AttentionSeenResult)
    def seen(workspace_id:Id,body:AttentionSeen,p:P):
        return events().seen(p,workspace_id,body)
