"""Finite SSE leases let Uvicorn drain before ASGI lifespan shutdown."""
import asyncio
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from types import SimpleNamespace
from uuid import uuid4

from workagent.work_event_api import stream
from workagent.work_event_models import EventPage, WorkEvent
from workagent.work_cursors import CursorCodec
from workagent.models import now


def lane_and_page():
    codec=CursorCodec('synthetic-stream-key-'*4)
    event=WorkEvent(event_id=str(uuid4()),type='run.changed',conversation_id='conversation',
                    occurred_at=now(),reason_code='state_changed')
    cursor=codec.encode(event.event_id,'ws','person','conversation',1)
    page=EventPage(events=[event],next_cursor=cursor,has_more=False,checked_at=now())
    class Lane:
        def authorize_stream(self,*args): pass
        def page(self,*args):
            return EventPage(events=[],next_cursor=cursor,has_more=False,checked_at=now())
        def token(self,event_id,p,ws,cid,generation):
            return codec.encode(event_id,ws,p.id,cid,generation)
    lane=Lane(); lane.codec=codec
    return lane,page


class Connected:
    async def is_disconnected(self): return False


def test_idle_stream_lease_ends_without_reset_or_fake_event(monkeypatch):
    import workagent.work_event_api as adapter
    monkeypatch.setattr(adapter,'STREAM_SECONDS',0.05)
    lane,page=lane_and_page()
    async def collect():
        return [x async for x in stream(lane,SimpleNamespace(id='person'),'ws','conversation',
            None,100,Connected(),lambda:None,page)]
    started=time.monotonic()
    frames=asyncio.run(asyncio.wait_for(collect(),0.5))
    assert time.monotonic()-started<0.5
    assert len(frames)==1 and 'event: work.changed' in frames[0]
    assert 'snapshot.required' not in frames[0]


def test_uvicorn_sigterm_drains_real_open_stream_before_lifespan(tmp_path):
    # Isolated loopback server, no installed service, database, or real credential.
    script='''
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import uvicorn
import workagent.work_event_api as adapter
from test_event_stream_shutdown import lane_and_page
adapter.STREAM_SECONDS=0.4
@asynccontextmanager
async def lifespan(app):
    yield
    print('LIFESPAN_FINISHED',flush=True)
app=FastAPI(lifespan=lifespan)
@app.get('/')
async def events(request: Request):
    lane,page=lane_and_page()
    return StreamingResponse(adapter.stream(lane,SimpleNamespace(id='person'),'ws','conversation',
        None,100,request,lambda:None,page),media_type='text/event-stream')
uvicorn.run(app,fd=int(sys.argv[1]),timeout_graceful_shutdown=2,log_level='info')
'''
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); sock.listen()
        port=sock.getsockname()[1]
        env=os.environ.copy()
        env['PYTHONPATH']=os.pathsep.join([os.getcwd(),os.path.dirname(__file__)])
        with (tmp_path/'server.log').open('w+') as log:
            proc=subprocess.Popen([sys.executable,'-c',script,str(sock.fileno())],
                pass_fds=(sock.fileno(),),stdout=log,stderr=log,env=env)
            try:
                # Bound retry only for interpreter startup; the listening socket
                # is already reserved so no other service can be contacted.
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=8) as response:
                    assert response.status==200
                    assert response.readline().startswith(b'id: ')
                    started=time.monotonic()
                    proc.send_signal(signal.SIGTERM)
                    remainder=response.read()
                    proc.wait(timeout=4)
                    elapsed=time.monotonic()-started
                assert elapsed<3
                assert b'snapshot.required' not in remainder
                log.seek(0); output=log.read()
                assert 'LIFESPAN_FINISHED' in output
                assert 'Application shutdown complete' in output
                assert 'Cancel' not in output and 'Traceback' not in output
            finally:
                if proc.poll() is None:
                    proc.terminate(); proc.wait(timeout=5)
