"""B2/B3 real PostgreSQL + exact kernel execution, never inference evidence."""
import json
import os
from pathlib import Path
import subprocess
import sys
from dataclasses import replace
from concurrent.futures import ThreadPoolExecutor
import pytest
import psycopg
from pydantic import ValidationError
from fastapi.testclient import TestClient
from test_domain import context,cmd,raises
from test_conversations import conversation,post
from workagent.models import *
from workagent.product_models import *
from workagent.service import Service,Principal,encoded,digest,canonical
from workagent.db import Database
from workagent.general_worker import GeneralWorker,ControlledTransport
from workagent.api import Settings,create_app
from workagent.dispatcher import Dispatcher

ROOT=Path(__file__).resolve().parents[2]
FIX=ROOT/'fixtures/general-work'
CSV=(FIX/'invoices.csv').read_text()
CODE=(FIX/'invoice-total.wat').read_text()
SHIPPING=(FIX/'invoice-total-with-shipping.wat').read_text()

def csvop(**kw):
    return ReconcileCSV(kind='reconcile_csv',input_csv=CSV,**kw)

def wasmop(code=CODE,**kw):
    return RunWasm(kind='run_wasm',code=code,arguments=[3,1250],input_form=[InputField(name='quantity',label='Quantity'),InputField(name='price',label='Unit price cents')],**kw)

def execute(ctx,operation,cv=None):
    s,p,ws,_,_=ctx
    cv=cv or conversation(ctx)
    queued=post(ctx,cv,'Perform explicitly selected local operation',operation=operation)
    run=GeneralWorker(s,transport=ControlledTransport()).work(p,ws,queued.run.id)
    detail=s.get_conversation(p,ws,cv.id)
    products=[x for x in detail.messages[-1].result.results if isinstance(x,ProductResult)] if run.state=='ready' else []
    return detail,products

def test_csv_persist_replay_cells_notes_and_exact_proposal(context):
    s,p,ws,_,_=context
    detail,products=execute(context,csvop())
    table,file=products
    body=s.get_artifact(p,ws,table.artifact_id).current_revision.body
    row=next(x for x in body.rows if x['id']=='B')
    assert row['reported_total']=='38.50' and row['calculated_total']=='37.50'
    assert s.download_product(p,ws,file.artifact_id).content==s.download_product(p,ws,table.artifact_id).content
    obs=s.get_product_observation(p,ws,table.observation_id)
    assert obs.observation.output.expected_sum=='77.40'
    assert obs.observation.output.reported_sum=='78.40' and obs.observation.output.discrepancies==['B']
    assert obs.observation.output.formula=='calculated_total = round(quantity * unit_price, 2); difference = reported_total - calculated_total'
    import hashlib
    assert obs.observation.output.input_sha256==hashlib.sha256(CSV.encode()).hexdigest()
    assert obs.binding_state=='current_revision' and obs.current_scope
    assert not s.list_assignments(p,ws).items
    original=body.model_dump()
    forged=body.model_copy(update={'source_csv':'id,quantity,unit_price,reported_total\nFORGED,1,1,1\n'})
    raises('unsupported_operation',lambda:s.human_save(p,ws,table.artifact_id,cmd(HumanSave,expected_current_revision_id=table.revision_id,body=forged)))
    edited=body.model_copy(deep=True); edited.notes=['Human: keep this note.']
    edited.rows[1]['note']='Human edited row note'
    saved=s.human_save(p,ws,table.artifact_id,cmd(HumanSave,expected_current_revision_id=table.revision_id,body=edited))
    assert s.get_product_observation(p,ws,table.observation_id).binding_state=='historical'
    changed=ReconcileCSV(kind='reconcile_csv',artifact_id=table.artifact_id,base_revision_id=saved.current_revision_id,rounding='ROUND_HALF_EVEN')
    detail,results=execute(context,changed,detail.conversation)
    proposal=s.proposals(p,ws,table.artifact_id).items[0]
    assert proposal.body.notes==edited.notes and proposal.body.rows[1]['note']=='Human edited row note'
    assert proposal.body.source_csv==CSV and proposal.body.rounding=='ROUND_HALF_EVEN'
    assert s.get_artifact(p,ws,table.artifact_id).current_revision_id==saved.current_revision_id
    accepted=s.accept_proposal(p,ws,proposal.id,cmd(AcceptProposal,expected_current_revision_id=saved.current_revision_id))
    assert accepted.current_revision.body==proposal.body
    assert s.get_product_observation(p,ws,results[0].observation_id).binding_state=='current_revision'
    old=s.get_artifact(p,ws,table.artifact_id,table.revision_id).requested_revision
    assert old.body.model_dump()==original

def test_wasm_actual_shipping_change_preserves_human_notes(context):
    s,p,ws,_,_=context
    detail,products=execute(context,wasmop())
    tool=products[0]
    observation=s.get_product_observation(p,ws,tool.observation_id).observation
    assert observation.output.value==3750 and observation.output.host_imports==0
    artifact=s.get_artifact(p,ws,tool.artifact_id)
    body=artifact.current_revision.body.model_copy(deep=True); body.notes=['Human: keep cents, not dollars']
    saved=s.human_save(p,ws,tool.artifact_id,cmd(HumanSave,expected_current_revision_id=artifact.current_revision_id,body=body))
    operation=RunWasm(kind='run_wasm',artifact_id=tool.artifact_id,base_revision_id=saved.current_revision_id,
        code=SHIPPING,arguments=[3,1250,500],input_form=[*body.input_form,InputField(name='shipping',label='Shipping cents')])
    detail,result=execute(context,operation,detail.conversation)
    observed=s.get_product_observation(p,ws,result[0].observation_id)
    assert observed.observation.output.value==4250 and observed.binding_state=='pending_proposal'
    proposal=s.proposals(p,ws,tool.artifact_id).items[0]
    assert proposal.body.notes==body.notes and proposal.body.arguments==[3,1250,500]
    accepted=s.accept_proposal(p,ws,proposal.id,cmd(AcceptProposal,expected_current_revision_id=saved.current_revision_id))
    assert s.download_product(p,ws,tool.artifact_id).content==SHIPPING
    assert s.get_product_observation(p,ws,result[0].observation_id).binding_state=='current_revision'
    assert s.get_artifact(p,ws,tool.artifact_id,tool.revision_id).requested_revision.body.code==CODE

def test_observations_immutable_not_human_forged_or_carried_to_new_revision(context):
    s,p,ws,_,admin=context
    detail,products=execute(context,wasmop()); tool=products[0]
    artifact=s.get_artifact(p,ws,tool.artifact_id)
    forged=artifact.current_revision.body.model_dump(); forged['execution_observed']=True
    with pytest.raises(ValidationError):
        HumanSave(**cmd(HumanSave,expected_current_revision_id=tool.revision_id,body=artifact.current_revision.body).model_dump(exclude={'body'}),body=forged)
    # Even identical human bytes create a new revision, never an inherited run assertion.
    s.human_save(p,ws,tool.artifact_id,cmd(HumanSave,expected_current_revision_id=tool.revision_id,body=artifact.current_revision.body))
    assert s.get_product_observation(p,ws,tool.observation_id).binding_state=='historical'
    with pytest.raises(psycopg.Error):
        with Database(admin).transaction() as c:
            c.execute("UPDATE product_observations SET data=data || '{\"forged\":true}' WHERE workspace_id=%s",(ws,))
    caprun=post(context,detail.conversation,operation=wasmop())
    cap=s.claim_run(p,ws,caprun.run.id)
    raises('unsupported_operation',lambda:s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='forged observed output')])) )
    raises('not_found_or_not_authorized',lambda:s.execute_local_product(replace(cap,secret='bad'),'run_wasm'))

def test_replay_concurrent_delivery_and_process_restart(context):
    s,p,ws,_,_=context
    cv=conversation(context)
    request=cmd(PostMessage,expected_work_version=1,text='calculate',operation=csvop())
    with ThreadPoolExecutor(max_workers=3) as pool:
        receipts=list(pool.map(lambda _:s.post_message(p,ws,cv.id,request),range(3)))
    assert len({x.run.id for x in receipts})==1
    child=subprocess.run([sys.executable,'-m','workagent.general_worker','--controlled','--workspace',ws],capture_output=True,text=True,env=os.environ)
    assert child.returncode==0,child.stderr
    again=subprocess.run([sys.executable,'-m','workagent.prompt_cli','--controlled','--workspace',ws,'inspect',cv.id],capture_output=True,text=True,env=os.environ)
    assert again.returncode==0,again.stderr
    detail=json.loads(again.stdout)
    assert detail['runs'][0]['state']=='ready' and len(detail['artifact_ids'])==2
    transport=ControlledTransport(); GeneralWorker(s,transport=transport).work(p,ws,receipts[0].run.id)
    assert transport.calls==0
    assert s.post_message(p,ws,cv.id,request).run.id==receipts[0].run.id
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM product_observations WHERE workspace_id=%s',(ws,)).fetchone()['n']==2
        assert c.execute('SELECT count(*) n FROM provider_attempts WHERE workspace_id=%s',(ws,)).fetchone()['n']==0

@pytest.mark.parametrize('operation',[wasmop(code='(module (import "wasi_snapshot_preview1" "x" (func)))'),wasmop(code='(module (func (export "total") (param i64 i64) (result i64) (loop $l br $l) i64.const 0))'),ReconcileCSV(kind='reconcile_csv',input_csv='id,quantity,unit_price,reported_total\nA,1,=EVIL(),0\n')])
def test_malicious_input_terminal_no_fake_product(context,operation):
    s,p,ws,_,_=context
    detail,products=execute(context,operation)
    assert not products and not detail.artifact_ids
    assert detail.runs[0].state=='partial' and detail.turns[0].state=='failed'
    assert detail.runs[0].unresolved and len(detail.messages)==1
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,detail.runs[0].id)

@pytest.mark.parametrize('kind',['membership','generation','source','cancel'])
def test_current_authority_rechecked_after_execution(context,monkeypatch,kind):
    import workagent.products as module
    s,p,ws,refs,admin=context
    cv=conversation(context,refs[:1]); queued=post(context,cv,operation=wasmop())
    actual=module.run_wasm_tool
    def revoked(*args):
        result=actual(*args)
        if kind=='cancel':
            s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=queued.conversation.work_version))
        else:
            with Database(admin).transaction() as c:
                query={'membership':'UPDATE memberships SET active=false WHERE workspace_id=%s',
                       'generation':'UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',
                       'source':"UPDATE sources SET content=content || '{\"drift\":true}' WHERE workspace_id=%s"}[kind]
                c.execute(query,(ws,))
        return result
    monkeypatch.setattr(module,'run_wasm_tool',revoked)
    with pytest.raises(Exception):
        GeneralWorker(s,transport=ControlledTransport()).work(p,ws,queued.run.id)
    with Database(admin).transaction() as c:
        assert c.execute('SELECT count(*) n FROM artifacts WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
        assert c.execute('SELECT count(*) n FROM product_observations WHERE workspace_id=%s',(ws,)).fetchone()['n']==0

def test_human_edit_during_execution_never_overwritten(context,monkeypatch):
    import workagent.products as module
    s,p,ws,_,_=context
    detail,products=execute(context,wasmop()); tool=products[0]
    artifact=s.get_artifact(p,ws,tool.artifact_id)
    operation=wasmop(artifact_id=tool.artifact_id,base_revision_id=tool.revision_id)
    queued=post(context,detail.conversation,operation=operation)
    actual=module.run_wasm_tool
    def editing(*args):
        result=actual(*args)
        body=artifact.current_revision.body.model_copy(deep=True); body.notes=['Concurrent human edit survives']
        s.human_save(p,ws,artifact.id,cmd(HumanSave,expected_current_revision_id=tool.revision_id,body=body))
        return result
    monkeypatch.setattr(module,'run_wasm_tool',editing)
    run=GeneralWorker(s,transport=ControlledTransport()).work(p,ws,queued.run.id)
    assert run.state=='partial'
    assert s.get_artifact(p,ws,artifact.id).current_revision.body.notes==['Concurrent human edit survives']
    assert s.proposals(p,ws,artifact.id).items==[]

def test_http_download_and_normal_dispatcher_route(context):
    import secrets
    s,p,ws,_,_=context
    settings=Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id)
    headers={'Authorization':'Bearer '+settings.local_bearer,'X-Schema-Version':'workagent/v1','X-Request-Id':'products'}
    with TestClient(create_app(settings)) as client:
        prefix=f'/v1/workspaces/{ws}'
        cv=client.post(prefix+'/conversations',headers=headers,json=cmd(CreateConversation).model_dump(mode='json')).json()
        queued=client.post(prefix+'/conversations/'+cv['id']+'/messages',headers=headers,json=cmd(PostMessage,expected_work_version=1,text='CSV',operation=csvop()).model_dump(mode='json'))
        assert queued.status_code==202
        # Legacy dispatcher must not steal a lease. Normal server explicitly enables same worker.
        Dispatcher(s,workspace=ws).once()
        assert s.get_run(p,ws,queued.json()['run']['id']).state=='queued'
        assert Dispatcher(s,workspace=ws,general_controlled=True).once()['completed']==1
        detail=client.get(prefix+'/conversations/'+cv['id'],headers=headers).json()
        assert detail['turns'][0]['state']=='replied'
        products=detail['messages'][-1]['result']['results'][1:]
        file=products[1]
        response=client.get(prefix+'/artifacts/'+file['artifact_id']+'/download',headers=headers)
        assert response.status_code==200 and response.headers['x-content-type-options']=='nosniff'
        assert response.headers['content-disposition']=='attachment; filename="reconciled.csv"'
        import hashlib
        assert hashlib.sha256(response.content).hexdigest()==response.headers['x-content-sha256']
        obs=client.get(prefix+'/observations/'+file['observation_id'],headers=headers)
        assert obs.status_code==200 and obs.json()['current_scope']

@pytest.mark.parametrize('value', [1000000000000000001, -1000000000000000001, 9223372036854775807, -9223372036854775808])
def test_i64_readback_transport_is_lossless_without_rewriting_storage(context, value):
    import secrets
    s,p,ws,_,_=context
    code=f'(module (func (export "total") (result i64) i64.const {value}))'
    detail,products=execute(context,RunWasm(kind='run_wasm',code=code,arguments=[],input_form=[]))
    tool=products[0]
    with s.db.transaction() as c:
        before=c.execute('SELECT data::text bytes FROM product_observations WHERE workspace_id=%s AND id=%s', (ws,tool.observation_id)).fetchone()['bytes']
    stored=json.loads(before)
    assert stored['output']['value']==value and type(stored['output']['value']) is int
    read=s.get_product_observation(p,ws,tool.observation_id)
    assert read.observation.output.value==value and type(read.observation.output.value) is int
    assert json.loads(read.model_dump_json())['observation']['output']['value']==str(value)
    settings=Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id)
    headers={'Authorization':'Bearer '+settings.local_bearer,'X-Schema-Version':'workagent/v1','X-Request-Id':'exact-i64'}
    with TestClient(create_app(settings)) as client:
        response=client.get(f'/v1/workspaces/{ws}/observations/{tool.observation_id}',headers=headers)
        assert response.status_code==200
        assert response.json()['observation']['output']['value']==str(value)
        schema=client.get('/openapi.json').json()['components']['schemas']
        assert schema['WasmObservationResponse']['properties']['value']['type']=='string'
    with s.db.transaction() as c:
        after=c.execute('SELECT data::text bytes FROM product_observations WHERE workspace_id=%s AND id=%s', (ws,tool.observation_id)).fetchone()['bytes']
    assert before==after
    assert s.get_artifact(p,ws,tool.artifact_id,tool.revision_id).requested_revision.body.code==code


def test_pending_proposal_does_not_revoke_current_saved_observation(context):
    s,p,ws,_,_=context
    detail,products=execute(context,wasmop()); tool=products[0]
    detail,proposed=execute(context,wasmop(artifact_id=tool.artifact_id,base_revision_id=tool.revision_id),detail.conversation)
    assert s.get_product_observation(p,ws,tool.observation_id).binding_state=='current_revision'
    assert s.get_product_observation(p,ws,proposed[0].observation_id).binding_state=='pending_proposal'
    proposal=s.proposals(p,ws,tool.artifact_id).items[0]
    saved=s.accept_proposal(p,ws,proposal.id,cmd(AcceptProposal,expected_current_revision_id=tool.revision_id))
    detail,newer=execute(context,wasmop(artifact_id=tool.artifact_id,base_revision_id=saved.current_revision_id),detail.conversation)
    assert s.get_product_observation(p,ws,proposed[0].observation_id).binding_state=='current_revision'
    assert s.get_product_observation(p,ws,newer[0].observation_id).binding_state=='pending_proposal'


def test_legacy_body_bytes_unchanged():
    body=Body(title='Legacy',blocks=[Block(block_id='x',kind='paragraph',text='Keep')])
    assert canonical(body)=='{"blocks":[{"block_id":"x","checked":null,"kind":"paragraph","text":"Keep"}],"title":"Legacy"}'

def test_missing_engine_truthful_terminal(context,monkeypatch):
    import workagent.wasm_tool as module
    monkeypatch.setattr(module.importlib.metadata,'version',lambda _: '0.0.0')
    detail,products=execute(context,wasmop())
    assert detail.runs[0].state=='partial' and not products
    assert 'engine version' in detail.turns[0].reason

def test_stale_proposal_after_human_edit_and_revoked_reads(context):
    s,p,ws,_,admin=context
    detail,products=execute(context,wasmop()); tool=products[0]
    detail,revision=execute(context,wasmop(artifact_id=tool.artifact_id,base_revision_id=tool.revision_id),detail.conversation)
    artifact=s.get_artifact(p,ws,tool.artifact_id)
    body=artifact.current_revision.body.model_copy(deep=True); body.notes=['Newer human note']
    saved=s.human_save(p,ws,tool.artifact_id,cmd(HumanSave,expected_current_revision_id=tool.revision_id,body=body))
    raises('version_conflict',lambda:s.accept_proposal(p,ws,revision[0].proposal_id,cmd(AcceptProposal,expected_current_revision_id=saved.current_revision_id)))
    assert s.get_product_observation(p,ws,revision[0].observation_id).binding_state=='historical'
    with Database(admin).transaction() as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    raises('not_found_or_not_authorized',lambda:s.get_product_observation(p,ws,tool.observation_id))
    raises('not_found_or_not_authorized',lambda:s.download_product(p,ws,tool.artifact_id))

@pytest.mark.parametrize('operation',[csvop(),wasmop()])
def test_crash_after_kernel_before_commit_reclaims_pure_operation(context,operation):
    s,p,ws,_,admin=context
    cv=conversation(context); queued=post(context,cv,operation=operation)
    child_code='''import os
from workagent.db import Database
from workagent.service import Service,Principal
from workagent.general_worker import GeneralWorker,ControlledTransport
import workagent.products as module
name='reconcile_csv' if os.environ['OPERATOR']=='reconcile_csv' else 'run_wasm_tool'
original=getattr(module,name)
def crash(*args,**kwargs):
    original(*args,**kwargs)
    os._exit(73)
setattr(module,name,crash)
GeneralWorker(Service(Database()),transport=ControlledTransport()).work(Principal('local-human'),os.environ['WS'],os.environ['RID'])
'''
    child=subprocess.run([sys.executable,'-c',child_code],env={**os.environ,'WS':ws,'RID':queued.run.id,'OPERATOR':operation.kind},capture_output=True,text=True)
    assert child.returncode==73,child.stderr
    with Database(admin).transaction() as c:
        assert c.execute('SELECT count(*) n FROM product_observations WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
        c.execute("UPDATE runs SET data=jsonb_set(data,'{lease_expires_at}',to_jsonb(now()-interval '1 second')) WHERE workspace_id=%s AND id=%s",(ws,queued.run.id))
    run=GeneralWorker(Service(Database()),transport=ControlledTransport()).work(p,ws,queued.run.id)
    assert run.state=='ready' and run.fence==2
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM product_observations WHERE workspace_id=%s',(ws,)).fetchone()['n']==2

def test_original_b1_inflight_process_can_resume_after_upgrade(context,tmp_path):
    import io,tarfile
    s,p,ws,_,admin=context
    archive=subprocess.check_output(['git','archive','9a8944b','backend','runtime','agent'],cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(tmp_path,filter='data')
    source='''import json,os
from workagent.db import Database
from workagent.service import Service,Principal
from workagent.models import *
s=Service(Database());p=Principal('local-human');ws=os.environ['WS']
def cmd(cls,**kw): return cls(schema_version='workagent/v1',request_id=new_id(),command_id=new_id(),**kw)
cv=s.create_conversation(p,ws,cmd(CreateConversation))
r=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=1,text='Legacy in-flight B1 turn'))
cap=s.claim_run(p,ws,r.run.id)
s.conversation_worker_context(cap)
print(json.dumps({'conversation':cv.id,'run':r.run.id}))
'''
    child=subprocess.run([sys.executable,'-c',source],cwd=tmp_path,env={**os.environ,'PYTHONPATH':str(tmp_path/'backend'),'WS':ws},capture_output=True,text=True)
    assert child.returncode==0,child.stderr
    ids=json.loads(child.stdout)
    with Database(admin).transaction() as c:
        c.execute("UPDATE runs SET data=jsonb_set(data,'{lease_expires_at}',to_jsonb(now()-interval '1 second')) WHERE workspace_id=%s AND id=%s",(ws,ids['run']))
    run=GeneralWorker(s,transport=ControlledTransport()).work(p,ws,ids['run'])
    assert run.state=='ready' and run.fence==2
    assert s.get_conversation(p,ws,ids['conversation']).turns[0].state=='replied'


def test_preexecution_revocation_no_kernel_and_unknown_consumer_projection(context,monkeypatch):
    import workagent.products as module
    s,p,ws,_,admin=context
    cv=conversation(context); queued=post(context,cv,operation=wasmop())
    with Database(admin).transaction() as c:
        c.execute("UPDATE runs SET data=jsonb_set(data,'{observed_at}',to_jsonb(now()-interval '15 seconds')) WHERE workspace_id=%s AND id=%s",(ws,queued.run.id))
    assert s.get_conversation(p,ws,cv.id).turns[0].state=='unavailable'
    with Database(admin).transaction() as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    monkeypatch.setattr(module,'run_wasm_tool',lambda *args:pytest.fail('must authorize before execution'))
    raises('not_found_or_not_authorized',lambda:GeneralWorker(s,transport=ControlledTransport()).work(p,ws,queued.run.id))


def test_real_http_and_controlled_dispatcher_processes(context):
    import socket,time,secrets,httpx
    s,p,ws,_,_=context
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0)); port=probe.getsockname()[1]
    token=secrets.token_urlsafe(32)
    env={**os.environ,'LOCAL_TEST_MODE':'true','LOCAL_BEARER_TOKEN':token,'LOCAL_PRINCIPAL_ID':p.id}
    env.pop('MIGRATION_DATABASE_URL',None)
    for name in list(env):
        if name.endswith('API_KEY') or name in ('ANTHROPIC_AUTH_TOKEN','OPENAI_ACCESS_TOKEN'):
            env.pop(name,None)
    children=[]
    try:
        children.append(subprocess.Popen([sys.executable,'-m','uvicorn','workagent.api:create_app','--factory','--host','127.0.0.1','--port',str(port)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
        children.append(subprocess.Popen([sys.executable,'-m','workagent.dispatcher','--general-controlled','--workspace',ws,'--interval','0.1'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
        headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':'http-products'}
        with httpx.Client(base_url=f'http://127.0.0.1:{port}',headers=headers,timeout=3) as client:
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                assert all(child.poll() is None for child in children)
                try:
                    if client.get('/v1/workspaces').status_code==200:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(.05)
            else:
                pytest.fail('server readiness timeout')
            prefix=f'/v1/workspaces/{ws}/conversations'
            cv=client.post(prefix,json=cmd(CreateConversation).model_dump(mode='json')).json()
            admitted=client.post(prefix+'/'+cv['id']+'/messages',json=cmd(PostMessage,expected_work_version=1,text='Run local Wasm',operation=wasmop()).model_dump(mode='json'))
            assert admitted.status_code==202
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                assert all(child.poll() is None for child in children)
                response=client.get(prefix+'/'+cv['id']); assert response.status_code==200
                detail=response.json()
                if detail['runs'][0]['state']=='ready':
                    break
                time.sleep(.05)
            else:
                pytest.fail('normal controlled consumer did not advance HTTP turn')
            assert detail['turns'][0]['state']=='replied'
            result=detail['messages'][-1]['result']['results'][1]
            observation=client.get(f'/v1/workspaces/{ws}/observations/'+result['observation_id'])
            assert observation.status_code==200 and observation.json()['observation']['output']['value']=='3750'
            assert client.get(f'/v1/workspaces/{ws}/conversations').json()['items'][0]['last_message_preview']
    finally:
        for child in children:
            child.terminate()
        for child in children:
            child.wait(timeout=10)


def test_safe_files_and_tool_form_bounds():
    from workagent.products import byte_hash
    for filename,mime in [('../evil.csv','text/csv'),('a.html','text/plain'),('ok.csv','text/plain')]:
        with pytest.raises(ValidationError):
            FileBody(title='Bad',filename=filename,mime_type=mime,content='x',content_sha256=byte_hash('x'))
    for content in ['x\n=EVIL()\n','x\n"unclosed']:
        with pytest.raises(ValidationError):
            FileBody(title='Bad CSV',filename='ok.csv',mime_type='text/csv',content=content,content_sha256=byte_hash(content))
    with pytest.raises(ValidationError):
        FileBody(title='Bad digest',filename='ok.txt',mime_type='text/plain',content='x',content_sha256='0'*64)
    with pytest.raises(ValidationError):
        RunWasm(kind='run_wasm',code=CODE,arguments=[True],input_form=[InputField(name='x',label='x')])
    with pytest.raises(ValidationError):
        RunWasm(kind='run_wasm',code=CODE,arguments=[1,2],input_form=[InputField(name='x',label='x'),InputField(name='x',label='again')])
