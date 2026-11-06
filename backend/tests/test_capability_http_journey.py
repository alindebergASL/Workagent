"""Actual loopback TCP API + controlled adapter + existing worker/checkpoint journal."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
from types import SimpleNamespace

import httpx

from test_domain import context,cmd
from test_capability_gateway import setup
from test_b24_runtime_pg import activate
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.models import CreateConversation,PostMessage,Run,new_id,Conversation
from workagent.db import Database


def test_tcp_admission_gateway_events_checkpoint_restart_and_revoke(context,tmp_path):
    s,p,ws,_,admin=context
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
    token=secrets.token_urlsafe(32)
    env={**os.environ,'DATABASE_URL':s.db.dsn,'LOCAL_TEST_MODE':'true','LOCAL_BEARER_TOKEN':token,
         'LOCAL_PRINCIPAL_ID':p.id,'WORKAGENT_FIXTURE_MODE':'false',
         'PYTHONPATH':str(Path(__file__).resolve().parents[1])}
    url=f'http://127.0.0.1:{port}'
    headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()}
    output=(tmp_path/'api.log').open('w')
    process=None
    def start():
        nonlocal process
        process=subprocess.Popen([sys.executable,'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port',str(port)],
                                  env=env,stdout=output,stderr=subprocess.STDOUT)
        for _ in range(150):
            if process.poll() is not None: raise AssertionError('disposable API exited')
            try:
                if httpx.get(url+'/openapi.json',timeout=1).status_code==200:return
            except httpx.HTTPError: pass
            time.sleep(.1)
        raise AssertionError('disposable API failed to start')
    def stop():
        if process and process.poll() is None:
            process.terminate();process.wait(timeout=15)
    def get(path):
        response=httpx.get(url+path,headers=headers,timeout=10)
        assert response.status_code==200,response.text
        return response.json()
    try:
        start()
        response=httpx.post(url+f'/v1/workspaces/{ws}/conversations',headers=headers,
            json=cmd(CreateConversation,selected_source_refs=[]).model_dump(mode='json'),timeout=10)
        assert response.status_code==201,response.text
        cv=Conversation.model_validate(response.json());pg=activate(context,cv,max_steps=3)
        response=httpx.post(url+f'/v1/workspaces/{ws}/conversations/{cv.id}/messages',headers=headers,
            json=cmd(PostMessage,expected_work_version=cv.work_version,text='Read this run context and state what was reviewed.').model_dump(mode='json'),timeout=10)
        assert response.status_code==202,response.text
        admission=response.json();q=SimpleNamespace(run=Run.model_validate(admission['run']),conversation=Conversation.model_validate(admission['conversation']))
        _,tg,_,_=setup(context,cv=cv,q=q,claim=False,provider_grant_id=pg.id)
        installed=get(f'/v1/workspaces/{ws}/capabilities?run_id={q.run.id}')
        assert next(d for d in installed['items'] if d['id']=='context.read')['availability_reason']=='available'
        fake=AlphaProvider([{'kind':'read_context','section':'messages'},
                            {'kind':'reply','text':'I reviewed the retained request context; no external action was taken.'}])
        assert finish_safe_visits(context,worker(context,fake,tmp_path/'worker'),q.run.id).state=='ready'
        attempts=get(f'/v1/workspaces/{ws}/runs/{q.run.id}/tool-attempts')
        assert len(attempts['items'])==1 and attempts['items'][0]['state']=='observed'
        observation=attempts['items'][0]['observation']
        detail=get(f'/v1/workspaces/{ws}/conversations/{cv.id}')
        cps=get(f'/v1/workspaces/{ws}/conversations/{cv.id}/checkpoints')
        events=get(f'/v1/workspaces/{ws}/events?conversation_id={cv.id}')
        assert any(cp['run_id']==q.run.id for cp in cps['items'])
        assert any(e['run_id']==q.run.id for e in events['events'])
        assert detail['messages'][-1]['text']=='I reviewed the retained request context; no external action was taken.'
        sends=len(fake.calls)
        stop();start()
        assert get(f'/v1/workspaces/{ws}/runs/{q.run.id}/tool-attempts')==attempts
        assert get(f'/v1/workspaces/{ws}/conversations/{cv.id}/checkpoints')==cps
        restarted_events=get(f'/v1/workspaces/{ws}/events?conversation_id={cv.id}')
        assert restarted_events['checked_at']>events['checked_at']
        assert {k:v for k,v in restarted_events.items() if k!='checked_at'}=={k:v for k,v in events.items() if k!='checked_at'}
        assert len(fake.calls)==sends
        with Database(admin).transaction() as c: c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(tg.id,))
        denied=httpx.get(url+f'/v1/workspaces/{ws}/tool-attempts/{observation["attempt_id"]}',headers=headers,timeout=10)
        assert denied.status_code==404 and observation['output_sha256'] not in denied.text
        # Compact synthetic-only journey evidence, no credentials or raw context.
        (tmp_path/'journey.json').write_text(json.dumps({'evidence_level':'controlled_adapter_real_tcp_pg',
            'run_id':q.run.id,'attempt_id':observation['attempt_id'],'output_sha256':observation['output_sha256'],
            'checkpoint_hashes':[cp['checkpoint_hash'] for cp in cps['items']],
            'events':[{'event_id':e['event_id'],'run_id':e['run_id']} for e in events['events']],
            'restart_equal':True,'revoked_detail_status':denied.status_code,'paid_product_calls':0},indent=2)+'\n')
    finally:
        stop();output.close()
