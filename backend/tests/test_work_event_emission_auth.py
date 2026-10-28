"""Regression proof for authorization at each backpressured SSE yield."""
import asyncio
from types import SimpleNamespace
from uuid import uuid4
import pytest
from workagent.errors import DomainError
from workagent.models import now
from workagent.work_cursors import CursorCodec
from workagent.work_event_models import WorkEvent, EventPage
from workagent.work_event_api import stream

@pytest.mark.parametrize('count', [1,2])
@pytest.mark.parametrize('credential_revoked', [False,True])
def test_revoke_during_buffered_batch_or_before_heartbeat(monkeypatch,count,credential_revoked):
    import workagent.work_event_api as adapter
    monkeypatch.setattr(adapter,'HEARTBEAT_SECONDS',0)
    codec=CursorCodec('synthetic-event-review-key'*3)
    events=[WorkEvent(event_id=str(uuid4()),type='run.changed',conversation_id='conversation',
                     occurred_at=now(),reason_code='state_changed') for _ in range(count)]
    cursor=codec.encode(events[-1].event_id,'ws','person','conversation',1)
    page=EventPage(events=events,next_cursor=cursor,has_more=False,checked_at=now())
    revoked=False
    class Lane:
        def authorize_stream(self,*args):
            if revoked and not credential_revoked:raise DomainError('not_found_or_not_authorized')
        def token(self,e,p,ws,cid,generation):return codec.encode(e,ws,p.id,cid,generation)
    lane=Lane();lane.codec=codec
    class Request:
        async def is_disconnected(self):return False
    def authenticate():
        if revoked and credential_revoked:raise DomainError('unauthenticated')
    async def check():
        nonlocal revoked
        iterator=stream(lane,SimpleNamespace(id='person'),'ws','conversation',None,100,Request(),authenticate,page)
        assert (await anext(iterator)).startswith('id: ')
        revoked=True
        assert await anext(iterator)=='event: snapshot.required\ndata: {"reason":"access_changed"}\n\n'
        with pytest.raises(StopAsyncIteration):await anext(iterator)
    asyncio.run(check())
