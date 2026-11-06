"""Offline contract tests; storage/locking evidence lives in test_work_events_pg."""
from types import SimpleNamespace
from uuid import uuid4

import pytest

from workagent.errors import DomainError
from workagent.work_cursors import CursorCodec
from workagent.work_snapshot import classify_current
from workagent.work_event_api import frame, stream
from workagent.work_event_models import WorkEvent, EventPage
from workagent.models import now
import asyncio
import json


def test_cursor_scope_tampering_generation_and_no_counter():
    codec = CursorCodec('private-test-key-' * 4)
    event = str(uuid4())
    token = codec.encode(event, 'ws', 'person', 'conversation', 7)
    assert len(token) < 200 and event in token
    assert codec.decode(token, 'ws', 'person', 'conversation') == (event, 7)
    for ws, person, conversation in [('other', 'person', 'conversation'),
                                     ('ws', 'other', 'conversation'),
                                     ('ws', 'person', 'other')]:
        with pytest.raises(DomainError):
            codec.decode(token, ws, person, conversation)
    for bad in [token[:-1] + ('a' if token[-1] != 'a' else 'b'), '', 'x' * 10000,
                token.replace('.7.', '.8.'), '../bad']:
        with pytest.raises(DomainError):
            codec.decode(bad, 'ws', 'person', 'conversation')


@pytest.mark.parametrize('run_state,steps,available,canonical,expected', [
    ('queued', [], True, None, 'queued'),
    ('running', ['accepted'], True, None, 'awaiting_provider'),
    ('running', [], False, None, 'stale'),
    ('running', [], True, None, 'recovering'),
    ('ready', [], True, None, 'idle'),
    ('cancelled', [], True, None, 'stopped'),
    ('cancelled', ['outcome_unknown'], True, None, 'unknown'),
    ('running', ['count_unknown'], True, None, 'unknown'),
    ('partial', [], True, 'budget_limit', 'blocked'),
    ('partial', [], True, 'blocked', 'blocked'),
    ('partial', [], True, 'waiting_for_user', 'waiting_person'),
])
def test_current_state_is_not_objective_completion(run_state, steps, available, canonical, expected):
    run = SimpleNamespace(id='run', state=run_state)
    state, _ = classify_current(run, [SimpleNamespace(state=s) for s in steps],
                                available, canonical_status=canonical)
    assert state == expected


def test_frame_is_one_json_record_with_exact_opaque_id():
    event = WorkEvent(event_id=str(uuid4()),type='run.changed',conversation_id='conversation',
                      occurred_at=now(),reason_code='state_changed')
    codec = CursorCodec('private-test-key-' * 4)
    token = codec.encode(event.event_id,'ws','person','conversation',1)
    wire = frame('work.changed',event.model_dump(mode='json'),token)
    assert wire.startswith('id: '+token+'\nevent: work.changed\ndata: ')
    assert json.loads(wire.split('data: ',1)[1]) == event.model_dump(mode='json')
    assert len(wire.encode()) < 2048 and wire.endswith('\n\n')


def test_stream_reauthorizes_and_stops_without_disclosing_on_revocation(monkeypatch):
    # Transport-only test. The real storage/revocation test is in the PG module.
    import workagent.work_event_api as adapter
    monkeypatch.setattr(adapter,'POLL_SECONDS',0)
    codec = CursorCodec('private-test-key-' * 4)
    event = WorkEvent(event_id=str(uuid4()),type='run.changed',conversation_id='conversation',
                      occurred_at=now(),reason_code='state_changed')
    cursor = codec.encode(event.event_id,'ws','person','conversation',1)
    initial = EventPage(events=[event],next_cursor=cursor,has_more=False,checked_at=now())
    calls=[]
    class Lane:
        def authorize_stream(self,*args): pass
        def page(self,*args):
            calls.append(args)
            raise DomainError('not_found_or_not_authorized')
        def token(self,event_id,p,ws,cid,generation):
            return codec.encode(event_id,ws,p.id,cid,generation)
    lane=Lane(); lane.codec=codec
    class Request:
        async def is_disconnected(self): return False
    async def collect():
        return [item async for item in stream(lane,SimpleNamespace(id='person'),'ws','conversation',
                None,100,Request(),lambda:None,initial)]
    # Explicit loop close keeps a broken executor handoff from hanging pytest
    # during asyncio.run's executor shutdown; the actual handoff must still pass.
    loop=asyncio.new_event_loop()
    try:
        frames=loop.run_until_complete(asyncio.wait_for(collect(),5))
    finally:
        loop.close()
    assert len(frames)==2 and frames[0].startswith('id: '+cursor)
    assert frames[1]=='event: snapshot.required\ndata: {"reason":"access_changed"}\n\n'
    assert calls[0][3]==cursor


def test_reset_stream_has_no_event_id_or_foreign_metadata():
    initial=EventPage(events=[],next_cursor='unused',has_more=False,reset_required=True,checked_at=now())
    class Request:
        async def is_disconnected(self): return False
    async def collect():
        return [item async for item in stream(None,None,'ws','conversation',None,100,
                Request(),lambda:None,initial)]
    assert asyncio.run(collect())==['event: snapshot.required\ndata: {"reason":"cursor_reset"}\n\n']
