"""Real loopback HTTP + subprocess prompt CLI; synthetic provider only, real PG/tools."""
import json
import os
import socket
import subprocess
import sys
import threading
import time
from contextlib import contextmanager

import httpx
import pytest
import uvicorn
from workagent.api import create_app, Settings
from workagent.models import *
from workagent.product_models import TableBody, ToolBody
from workagent.service import Service
from workagent.db import Database
from workagent.responses_dispatcher import ResponsesDispatcher, general_status, serve
from test_domain import context, cmd, raises
from test_general_responses import Provider, activate, conversation, worker, CSV

TOKEN='synthetic-local-journey-not-a-live-credential'

@contextmanager
def api(context):
    s,p,_,_,_=context
    sock=socket.socket(); sock.bind(('127.0.0.1',0)); sock.listen(128)
    server=uvicorn.Server(uvicorn.Config(create_app(Settings(s.db.dsn,True,TOKEN,p.id)),log_level='critical',lifespan='off'))
    thread=threading.Thread(target=lambda:server.run(sockets=[sock]),daemon=True); thread.start()
    try:
        for _ in range(500):
            if server.started: break
            if not thread.is_alive(): raise AssertionError('local HTTP server exited')
            time.sleep(.01)
        assert server.started
        with httpx.Client(base_url=f'http://127.0.0.1:{sock.getsockname()[1]}',headers={
            'Authorization':'Bearer '+TOKEN,'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()}) as client:
            yield client
    finally:
        server.should_exit=True; thread.join(timeout=10); sock.close()
        assert not thread.is_alive()

class ExactFourProvider(Provider):
    def __init__(self):
        super().__init__(); self.local_results=[]; self.inputs=[]
    def handle(self,request):
        if request.method=='POST' and request.url.path=='/v1/responses':
            payload=json.loads(request.content)
            if payload['metadata']['step_id']=='selection':
                current=json.loads(payload['input'][0]['content']); self.inputs.append(current)
            else:
                item=next(i for i in payload['input'] if i.get('type')=='function_call_output')
                self.local_results.append(json.loads(item['output']))
        return super().handle(request)

@pytest.mark.parametrize('entry',['http','cli'])
def test_exact_four_natural_turns_real_http_cli_and_home_recipe(context,tmp_path,entry):
    s,p,ws,_,_=context
    with api(context) as client:
        base=f'/v1/workspaces/{ws}'
        def post(path,command,code=200):
            response=client.post(base+path,json=command.model_dump(mode='json'))
            assert response.status_code==code,response.text
            return response.json()
        cv1=post('/conversations',cmd(CreateConversation,title='Invoice reconciliation'),201)
        cv2=post('/conversations',cmd(CreateConversation,title='Invoice calculator'),201)
        grant=activate(context,[Conversation.model_validate(cv1),Conversation.model_validate(cv2)])
        fixture=ExactFourProvider()
        def dispatch():
            # New runtime/service each time, stable private recovery state, no fixture worker.
            restarted=(Service(Database(s.db.dsn)),p,ws,[],context[-1])
            result=ResponsesDispatcher(worker(restarted,fixture,tmp_path/'worker'),workspace=ws,grant_id=grant.id).once()
            assert result['results'] and all(r['status']=='completed' for r in result['results']),result
        def send(cv,text,attachment=None,target=None):
            version=client.get(base+'/conversations/'+cv['id']).json()['conversation']['work_version']
            command=cmd(PostMessage,expected_work_version=version,text=text,attachments=[attachment] if attachment else [],target=target)
            if entry=='http':
                result=post('/conversations/'+cv['id']+'/messages',command,202)
                replay=post('/conversations/'+cv['id']+'/messages',command,202)
                assert replay['run']['id']==result['run']['id']
            else:
                args=[sys.executable,'-m','workagent.prompt_cli','--general-responses','--workspace',ws,'continue',cv['id'],text]
                if attachment:
                    attachment_path=tmp_path/attachment.filename; attachment_path.write_text(attachment.content)
                    args+=['--attach',str(attachment_path)]
                if target: args+=['--target-artifact',target.artifact_id,'--target-revision',target.revision_id,'--target-body-hash',target.body_hash]
                result=subprocess.run(args,env={**os.environ,'LOCAL_BEARER_TOKEN':TOKEN},capture_output=True,text=True,timeout=30)
                assert result.returncode==0,result.stderr
                assert 'general-responses-v1' in result.stdout
            dispatch()
            detail=client.get(base+'/conversations/'+cv['id']).json()
            assert detail['assignment_ids']==[]
            assert detail['turns'][-1]['provider_observation']=='received'
            assert detail['turns'][-1]['evidence_origin']=='synthetic_provider_receipt'
            return detail['messages'][-1]['result']['results'][1]
        def artifact(id):
            response=client.get(base+'/artifacts/'+id); assert response.status_code==200
            return Artifact.model_validate(response.json())
        from workagent.message_models import AttachmentInput,ExactTarget
        first=send(cv1,'Reconcile this invoice CSV. Keep original values and notes; show discrepancies and give me a downloadable result.',AttachmentInput(filename='invoices.csv',mime_type='text/csv',content=CSV))
        table=artifact(first['artifact_id'])
        observed_csv=client.get(base+'/observations/'+first['observation_id']).json()['observation']['output']
        assert observed_csv['reported_sum']=='78.40' and observed_csv['expected_sum']=='77.40' and observed_csv['discrepancies']==['B']
        assert client.get(base+'/artifacts/'+table.id+'/download').status_code==200
        body=table.current_revision.body.model_dump(mode='json'); body['rows'][1]['unit_price']='12.495'; body['rows'][1]['note']='Human: keep my corrected price and note.'
        saved=Artifact.model_validate(post('/artifacts/'+table.id+'/save',cmd(HumanSave,expected_current_revision_id=table.current_revision_id,body=TableBody.model_validate(body))))
        target=ExactTarget(artifact_id=saved.id,revision_id=saved.current_revision_id,body_hash=saved.current_revision.body_hash)
        revision=send(cv1,'Recalculate my saved table using round-half-even. Preserve my edits and propose the change.',target=target)
        proposal=client.get(base+'/artifacts/'+saved.id+'/proposals').json()['items'][0]
        assert proposal['id']==revision['proposal_id'] and proposal['status']=='pending'
        assert proposal['base_revision_id']==saved.current_revision_id
        assert proposal['body']['rows'][1]['note']==body['rows'][1]['note']
        assert proposal['body']['rows'][1]['calculated_total']=='37.48' and proposal['body']['rows'][1]['difference']=='1.02'
        assert client.get(base+'/observations/'+revision['observation_id']).json()['observation']['output']['expected_sum']=='77.38'
        assert artifact(saved.id).current_revision_id==saved.current_revision_id
        initial_tool=send(cv2,'Build a small local invoice-total calculator with quantity and unit price in cents. Test quantity3 and price1250.')
        tool=artifact(initial_tool['artifact_id']); toolbody=tool.current_revision.body.model_dump(mode='json'); toolbody['notes']=['Human: keep cents, not dollars.']
        edited=Artifact.model_validate(post('/artifacts/'+tool.id+'/save',cmd(HumanSave,expected_current_revision_id=tool.current_revision_id,body=ToolBody.model_validate(toolbody))))
        revised_tool=send(cv2,'Add shipping as a separate cents input. Test3 items at1250 cents plus500 shipping. Preserve my note and propose the update.',target=ExactTarget(artifact_id=edited.id,revision_id=edited.current_revision_id,body_hash=edited.current_revision.body_hash))
        observed=client.get(base+'/observations/'+revised_tool['observation_id']).json()
        assert observed['observation']['output']['value']=='4250'
        assert observed['binding_state']=='pending_proposal'
        assert observed['observation']['evidence_origin']=='local_tool'
        assert [r['output']['value'] for r in fixture.local_results if r['output']['kind']=='run_wasm']==[3750,4250]
        assert len(fixture.inputs)==4 and len(fixture.local_results)==4
        status=general_status(s.db,ws,grant.id)
        assert status['budget']['request_counts']=={'count_send':8,'dispatch':8,'read':0,'cancel':0}
        assert status['budget']['reserved_input_tokens']==160000 and status['budget']['reserved_output_tokens']==65536
        assert ResponsesDispatcher(worker(context,fixture,tmp_path/'worker'),workspace=ws,grant_id=grant.id).once()['results']==[]
        # Real read recipe, including pagination; canonical products and decisions survive restart.
        listed=client.get(base+'/conversations',params={'limit':1}).json(); nextpage=client.get(base+'/conversations',params={'limit':1,'cursor':listed['next_cursor']}).json()
        assert {c['id'] for c in listed['items']+nextpage['items']}=={cv1['id'],cv2['id']}
        # A new human edit makes the old pending proposal stale, never rewrites it.
        latest=artifact(saved.id); changed=latest.current_revision.body.model_copy(deep=True); changed.rows[0]['note']='Further human edit after proposal'
        newest=Artifact.model_validate(post('/artifacts/'+saved.id+'/save',cmd(HumanSave,expected_current_revision_id=latest.current_revision_id,body=changed)))
        stale=client.get(base+'/artifacts/'+saved.id+'/proposals').json()['items'][0]
        assert stale['status']=='pending' and stale['base_revision_id']!=newest.current_revision_id
        rejected=client.post(base+'/proposals/'+stale['id']+'/accept',json=cmd(AcceptProposal,expected_current_revision_id=newest.current_revision_id).model_dump(mode='json'))
        assert rejected.status_code==409 and rejected.json()['code']=='version_conflict'
        assert client.get(base+'/observations/'+revision['observation_id']).json()['binding_state']=='historical'
        # No assignment was manufactured and publication effects were not duplicated.
        with s.db.transaction() as c:
            assert c.execute('SELECT count(*) n FROM assignments WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
            assert c.execute('SELECT count(*) n FROM artifacts WHERE workspace_id=%s',(ws,)).fetchone()['n']==4
            assert c.execute('SELECT count(*) n FROM product_observations WHERE workspace_id=%s',(ws,)).fetchone()['n']==6
    # New actual HTTP server process state; SQL remains authoritative.
    with api(context) as client:
        detail=client.get(base+'/conversations/'+cv1['id']).json()
        assert saved.id in detail['artifact_ids']
        assert client.get(base+'/artifacts/'+saved.id).json()['current_revision']['body']['rows'][0]['note']=='Further human edit after proposal'
        assert client.get(base+'/artifacts/'+saved.id+'/proposals').json()['items'][0]['status']=='pending'


def test_home_reads_recheck_source_scope(context,tmp_path):
    s,p,ws,refs,admin=context
    # The general grant correctly excludes source-backed conversations; the same
    # canonical read recipe must also preserve controlled existing source scope.
    from test_general_products import execute,csvop
    cv=s.create_conversation(p,ws,cmd(CreateConversation,selected_source_refs=refs[:1]))
    detail,products=execute(context,csvop(),cv); prod=products[0]
    with api(context) as client:
        base=f'/v1/workspaces/{ws}'
        assert client.get(base+'/conversations').json()['items']
        with Database(admin).transaction() as c:
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',(ws,p.id,refs[0].source_id))
        assert client.get(base+'/conversations').json()['items']==[]
        for path in ['/conversations/'+cv.id,'/artifacts/'+prod.artifact_id,'/artifacts/'+prod.artifact_id+'/proposals','/observations/'+prod.observation_id]:
            assert client.get(base+path).status_code==404


def test_serve_continues_polling_at_bounded_intervals(monkeypatch):
    class Dispatcher:
        calls=0
        def once(self):
            self.calls+=1
            return {'results':[{'status':'incomplete'}]}
    dispatcher=Dispatcher(); checked=[]
    def pause(interval):
        assert interval==.1
        if dispatcher.calls==2: raise KeyboardInterrupt
    monkeypatch.setattr('time.sleep',pause)
    with pytest.raises(KeyboardInterrupt): serve(dispatcher,lambda:checked.append(True),.1)
    assert dispatcher.calls==2 and checked==[True,True]


def test_status_cli_no_provider_key_or_network(context,tmp_path):
    s,p,ws,_,_=context; cv=conversation(context); grant=activate(context,[cv])
    result=subprocess.run([sys.executable,'-m','workagent.responses_dispatcher','--general-responses','--workspace',ws,'--grant-id',grant.id,'--status'],env={k:v for k,v in os.environ.items() if 'OPENAI' not in k},capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stdout
    data=json.loads(result.stdout)
    assert data['active'] and data['mode']=='synthetic' and data['budget']['request_counts']['dispatch']==0
