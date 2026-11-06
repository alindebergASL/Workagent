"""Actual HTTP process restart over retained PG state; synthetic data, no model calls."""
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid
import httpx

from test_domain import context
from document_fixtures import pdf,docx,xlsx


def command(**values):
    return {'schema_version':'workagent/v1','command_id':str(uuid.uuid4()),
            'request_id':str(uuid.uuid4()),**values}


@contextmanager
def server(context,port):
    service,principal,_,_,_=context
    env={**os.environ,'DATABASE_URL':service.db.dsn,'LOCAL_TEST_MODE':'true',
         'LOCAL_BEARER_TOKEN':'synthetic-batch2-process-proof-'+'x'*40,
         'LOCAL_PRINCIPAL_ID':principal.id}
    process=subprocess.Popen([sys.executable,'-m','uvicorn','workagent.api:app',
                              '--host','127.0.0.1','--port',str(port),'--log-level','critical'],
                             cwd=Path(__file__).resolve().parents[1],env=env,
                             stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=25,
            headers={'Authorization':'Bearer '+env['LOCAL_BEARER_TOKEN'],
                     'X-Schema-Version':'workagent/v1','X-Request-Id':str(uuid.uuid4())}) as client:
            deadline=time.monotonic()+25
            while True:
                assert process.poll() is None,'Disposable API process exited'
                try:
                    if client.get('/v1/identity',timeout=1).status_code==200:break
                except httpx.TransportError:pass
                assert time.monotonic()<deadline,'Disposable API readiness timeout'
                time.sleep(.05)
            yield client
    finally:
        process.terminate()
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        assert process.poll() is not None


def test_process_restart_retains_originals_exact_commands_and_event_cursor(context,record_property):
    _,_,ws,_,_=context
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    create=command(title='Process restart evidence',selected_source_refs=[])
    root=f'/v1/workspaces/{ws}'
    records=[];started=time.monotonic()
    with server(context,port) as client:
        response=client.post(root+'/conversations',json=create);assert response.status_code==201,response.text
        conversation=response.json();cid=conversation['id'];path=root+'/conversations/'+cid
        snap=client.get(root+'/work-snapshot',params={'conversation_id':cid}).json()
        cursor=snap['snapshot_cursor']
        for kind,fixture,mime in [('pdf',pdf,'application/pdf'),('docx',docx,'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),('xlsx',xlsx,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')]:
            raw=fixture();digest=hashlib.sha256(raw).hexdigest()
            upload=command(filename='process.'+kind,mime_type=mime,sha256=digest,
                           content_base64=base64.b64encode(raw).decode())
            response=client.post(path+'/documents',json=upload);assert response.status_code==201,response.text
            detail=response.json();assert detail['status']=='extracted'
            records.append((upload,detail,raw))
        events=client.get(root+'/events',params={'conversation_id':cid,'after':cursor}).json()
        assert events['events'] and not events['reset_required']
        ids=[e['event_id'] for e in events['events']]
        assert len(ids)==len(set(ids))
        assert all(e['conversation_id']==cid for e in events['events'])
        last_cursor=events['next_cursor']
    # Entire API process gone. Commands are retried exactly after reconnect.
    with server(context,port) as client:
        assert client.post(root+'/conversations',json=create).json()==conversation
        assert len(client.get(path+'/documents').json()['items'])==3
        for upload,detail,raw in records:
            assert client.post(path+'/documents',json=upload).json()==detail
            response=client.get(path+'/documents/'+detail['document_id']+'/download')
            assert response.status_code==200 and response.content==raw
            assert response.headers['x-content-type-options']=='nosniff'
            assert client.get(path+'/documents/'+detail['document_id']).json()==detail
        resumed=client.get(root+'/events',params={'conversation_id':cid,'after':last_cursor}).json()
        assert resumed['events']==[] and not resumed['reset_required']
        replay=client.get(root+'/events',params={'conversation_id':cid,'after':cursor}).json()
        assert [e['event_id'] for e in replay['events']]==ids
        snapshot=client.get(root+'/work-snapshot',params={'conversation_id':cid}).json()
        assert snapshot['snapshot_cursor']==last_cursor and snapshot['execution']['state']=='idle'
    record_property('http_process_restarts',1)
    record_property('exact_originals',len(records))
    record_property('elapsed_seconds',time.monotonic()-started)
