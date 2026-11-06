"""Public deterministic parser vectors; the signing key is test-only data."""
from datetime import datetime, timezone

from .work_cursors import CursorCodec
from .work_event_api import frame
from .work_event_models import EventPage, WorkEvent


def vectors():
    codec=CursorCodec('public-fixture-only-not-a-credential'*2)
    scope={'workspace_id':'fixture-workspace','principal_id':'fixture-person',
           'conversation_id':'fixture-conversation','access_generation':1}
    events=[WorkEvent(event_id=f'00000000-0000-4000-8000-{i:012d}',
        type=kind,conversation_id=scope['conversation_id'],artifact_id='fixture-artifact',
        occurred_at=datetime(2026,10,26,0,0,i,tzinfo=timezone.utc),reason_code=reason)
        for i,kind,reason in [(1,'artifact.changed','material_change'),(2,'revision.created','created')]]
    cursors=[codec.encode(e.event_id,scope['workspace_id'],scope['principal_id'],scope['conversation_id'],1)
             for e in events]
    frames=[frame('work.changed',e.model_dump(mode='json'),cursor) for e,cursor in zip(events,cursors)]
    return {'schema_version':'workagent/work-event-fixtures-v1','scope':scope,
        'page':EventPage(events=events,next_cursor=cursors[-1],has_more=False,
            checked_at=datetime(2026,10,26,0,1,tzinfo=timezone.utc)).model_dump(mode='json'),
        'cursors':cursors,'sse_frames':frames,
        'heartbeat':': heartbeat\n\n',
        'reset':frame('snapshot.required',{'reason':'cursor_reset'}),
        'access_changed':frame('snapshot.required',{'reason':'access_changed'}),
        'duplicate_delivery':frames+[frames[-1]],'out_of_order_delivery':list(reversed(frames)),
        'byte_chunk_sizes':[1,2,3,5,64,1024],
        'expected_unique_event_ids':[e.event_id for e in events]}
