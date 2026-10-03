"""B1 integration contract. Every DB test uses real, disposable PostgreSQL."""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import psycopg
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from test_domain import context, cmd, raises
from workagent.api import Settings, create_app
from workagent.db import Database
from workagent.models import *
from workagent.service import Service, Principal, encoded
from workagent.general_worker import GeneralWorker, ControlledTransport


def conversation(ctx, refs=None):
    s,p,ws,_,_=ctx
    return s.create_conversation(p,ws,cmd(CreateConversation,selected_source_refs=refs or []))


def post(ctx, cv, text='Help me think', **kwargs):
    s,p,ws,_,_=ctx
    return s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text=text,**kwargs))


def test_source_free_replay_restart_and_worker(context):
    s,p,ws,_,_=context
    cv=conversation(context)
    request=cmd(PostMessage,expected_work_version=1,text='Help me think')
    with ThreadPoolExecutor(max_workers=4) as pool:
        receipts=list(pool.map(lambda _:s.post_message(p,ws,cv.id,request),range(4)))
    assert len({r.run.id for r in receipts})==1
    receipt=receipts[0]
    assert receipt.run.assignment_id is None and receipt.run.conversation_id==cv.id
    assert s.list_assignments(p,ws).items==[]
    transport=ControlledTransport()
    worker=GeneralWorker(s,transport=transport)
    worker.work(p,ws,receipt.run.id)
    worker.work(p,ws,receipt.run.id)
    assert transport.calls==1
    detail=Service(Database()).get_conversation(p,ws,cv.id)
    assert [m.author_kind for m in detail.messages]==['human','assistant']
    assert detail.messages[1].evidence_origin=='controlled_transport'
    follow=post(context,detail.conversation,'Keep it short')
    worker.work(p,ws,follow.run.id)
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.messages)==4
    assert [m['text'] for m in transport.contexts[-1]['messages'] if m['author_kind']=='human']==['Help me think','Keep it short']
    assert 'not model usefulness' in detail.messages[-1].text
    assert s.post_message(p,ws,cv.id,request)==receipt
    raises('command_conflict',lambda:s.post_message(p,ws,cv.id,request.model_copy(update={'text':'Different'})))
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM runs WHERE workspace_id=%s',(ws,)).fetchone()['n']==2
        assert c.execute('SELECT count(*) AS n FROM run_dispatches WHERE workspace_id=%s AND acknowledged_at IS NULL',(ws,)).fetchone()['n']==0
        assert c.execute('SELECT count(*) AS n FROM provider_attempts WHERE workspace_id=%s',(ws,)).fetchone()['n']==0


def test_steering_cas_cancel_and_fences(context):
    s,p,ws,_,admin=context
    cv=conversation(context); first=post(context,cv)
    cap=s.claim_run(p,ws,first.run.id)
    raises('version_conflict',lambda:post(context,cv,'stale'))
    detail=s.get_conversation(p,ws,cv.id)
    second=post(context,detail.conversation,'Actually compare two options')
    raises('not_found_or_not_authorized',lambda:s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='stale')])) )
    assert s.get_run(p,ws,first.run.id).state=='cancelled'
    cap=s.claim_run(p,ws,second.run.id)
    cancel=cmd(CancelConversation,expected_work_version=second.conversation.work_version)
    closed=s.cancel_conversation(p,ws,cv.id,cancel)
    assert closed.state=='cancelled'
    raises('not_found_or_not_authorized',lambda:s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='cancelled')])) )
    assert all(m.author_kind=='human' for m in s.get_conversation(p,ws,cv.id).messages)
    raises('action_unresolved',lambda:post(context,closed))


def test_revocation_reauthorizes_reads_replay_and_commit(context):
    s,p,ws,refs,admin=context
    cv=conversation(context,refs[:1])
    request=cmd(PostMessage,expected_work_version=1,text='Use permitted context')
    receipt=s.post_message(p,ws,cv.id,request)
    cap=s.claim_run(p,ws,receipt.run.id)
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s',(ws,))
    for action in [lambda:s.get_conversation(p,ws,cv.id),lambda:s.get_run(p,ws,receipt.run.id),lambda:s.post_message(p,ws,cv.id,request),lambda:s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='denied')]))]:
        raises('not_found_or_not_authorized',action)
    assert s.list_conversations(p,ws).items==[]
    sourcefree=conversation(context)
    turn=post(context,sourcefree)
    cap=s.claim_run(p,ws,turn.run.id)
    with Database(admin).transaction() as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    raises('not_found_or_not_authorized',lambda:s.get_conversation(p,ws,sourcefree.id))
    raises('not_found_or_not_authorized',lambda:s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='denied')])) )


def test_source_content_drift_and_lease_reclaim(context):
    s,p,ws,refs,admin=context
    cv=conversation(context,refs[:1]); turn=post(context,cv)
    old=s.claim_run(p,ws,turn.run.id)
    raises('action_unresolved',lambda:s.claim_run(p,ws,turn.run.id))
    with Database(admin).transaction() as c:
        run=s.get_run(p,ws,turn.run.id)
        run.lease_expires_at=now().replace(year=2020)
        c.execute('UPDATE runs SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(run),ws,run.id))
    current=s.claim_run(p,ws,turn.run.id)
    raises('not_found_or_not_authorized',lambda:s.complete_conversation_turn(old,TurnResult(results=[TextResult(text='old')])) )
    with Database(admin).transaction() as c:
        c.execute("UPDATE sources SET content=content || '{\"changed\": true}'::jsonb WHERE workspace_id=%s",(ws,))
    raises('source_changed',lambda:s.complete_conversation_turn(current,TurnResult(results=[TextResult(text='drift')])) )


def test_explicit_delegate_is_only_assignment_and_is_not_autonomy(context):
    s,p,ws,_,_=context
    cv=conversation(context); receipt=post(context,cv)
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,receipt.run.id)
    assert not s.list_assignments(p,ws).items
    cv=s.get_conversation(p,ws,cv.id).conversation
    request=cmd(DelegateConversation,expected_work_version=cv.work_version,goal='Carry this forward',completion_criteria=['Review an outcome'])
    assignment=s.delegate_conversation(p,ws,cv.id,request)
    assert assignment.conversation_id==cv.id and assignment.state=='paused'
    assert assignment.run_ids==[] and assignment.selected_source_refs==[]
    assert s.delegate_conversation(p,ws,cv.id,request)==assignment
    assert s.get_assignment(p,ws,assignment.id).id==assignment.id
    assert s.get_conversation(p,ws,cv.id).assignment_ids==[assignment.id]
    raises('unsupported_operation',lambda:s.control_assignment(p,ws,assignment.id,cmd(ControlAssignment,expected_work_version=assignment.work_version,operation='resume')))


def test_forgery_and_exactly_one_db_owner(context):
    s,p,ws,_,admin=context
    cv=conversation(context); receipt=post(context,cv)
    raises('not_found_or_not_authorized',lambda:s.post_message(Principal(p.id,'worker'),ws,cv.id,cmd(PostMessage,expected_work_version=2,text='forged')))
    raises('not_found_or_not_authorized',lambda:s.complete_conversation_turn(p,TurnResult(results=[TextResult(text='forged')])) )
    cap=s.claim_run(p,ws,receipt.run.id)
    raises('not_found_or_not_authorized',lambda:s.complete_conversation_turn(replace(cap,secret='forged'),TurnResult(results=[TextResult(text='forged')])) )
    with pytest.raises(ValidationError):
        PostMessage(schema_version='workagent/v1',request_id='r',command_id='c',expected_work_version=2,text='forged',author_kind='assistant')
    with pytest.raises(ValidationError):
        TurnResult(results=[{'kind':'text','text':'forged','accepted':True}])
    with pytest.raises(psycopg.Error):
        with Database(admin).transaction() as c:
            c.execute('UPDATE runs SET conversation_id=NULL WHERE workspace_id=%s AND id=%s',(ws,receipt.run.id))


def test_http_admission_same_worker_and_denials(context):
    import secrets
    s,p,ws,_,_=context
    settings=Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id)
    headers={'Authorization':'Bearer '+settings.local_bearer,'X-Schema-Version':'workagent/v1','X-Request-Id':'b1'}
    with TestClient(create_app(settings)) as client:
        base=f'/v1/workspaces/{ws}/conversations'
        assert client.get(base).status_code==401
        cv=client.post(base,headers=headers,json=cmd(CreateConversation).model_dump(mode='json'))
        assert cv.status_code==201
        path=base+'/'+cv.json()['id']
        body=cmd(PostMessage,expected_work_version=1,text='HTTP prompt').model_dump(mode='json')
        assert client.post(path+'/messages',headers=headers,json={**body,'author_kind':'assistant'}).status_code==422
        response=client.post(path+'/messages',headers=headers,json=body)
        assert response.status_code==202
        run=response.json()['run']
        assert run['state']=='queued'
        assert GeneralWorker(s,transport=ControlledTransport()).once(workspace=ws)['completed']==1
        reopened=client.get(path,headers=headers).json()
        assert reopened['runs'][0]['id']==run['id'] and reopened['runs'][0]['state']=='ready'
        assert len(reopened['messages'])==2
        assert client.get(base,headers=headers).json()['items'][0]['id']==cv.json()['id']


def test_live_refusal_before_environment_or_import(monkeypatch):
    from workagent.prompt_cli import main
    def forbidden(*args,**kwargs):
        raise AssertionError('environment touched before live refusal')
    monkeypatch.setattr(os.environ,'get',forbidden)
    for args in [['--live','prompt','hello'],['--provider','openai','prompt','hello'],['prompt','hello']]:
        with pytest.raises(SystemExit) as exc:
            main(args)
        assert exc.value.code==2


def test_cli_process_restart_retains_followup(context):
    s,p,ws,_,_=context
    def cli(*args):
        child=subprocess.run([sys.executable,'-m','workagent.prompt_cli','--controlled','--workspace',ws,*args],capture_output=True,text=True,env=os.environ)
        assert child.returncode==0,child.stderr
        return json.loads(child.stdout)
    first=cli('prompt','Help me consider a direction')
    cid=first['conversation']['id']
    second=cli('continue',cid,'Keep it short')
    inspected=cli('inspect',cid)
    assert len(inspected['messages'])==4
    assert inspected['messages'][2]['text']=='Keep it short'
    assert second['runs'][-1]['id']==inspected['runs'][-1]['id']
    delegated=cli('delegate',cid,'Continue later','--criterion','Review together')
    assert delegated['conversation_id']==cid
    cancelled=cli('cancel',cid)
    assert cancelled['state']=='cancelled'


def test_atomic_rollback_and_duplicate_completion(context,monkeypatch):
    s,p,ws,_,_=context
    cv=conversation(context)
    original=s._event
    def failed(*args):
        raise RuntimeError('injected audit fault')
    monkeypatch.setattr(s,'_event',failed)
    with pytest.raises(RuntimeError):
        post(context,cv)
    assert s.get_conversation(p,ws,cv.id).messages==[]
    assert s.get_conversation(p,ws,cv.id).conversation.work_version==1
    monkeypatch.setattr(s,'_event',original)
    queued=post(context,cv)
    cap=s.claim_run(p,ws,queued.run.id)
    result=TurnResult(results=[TextResult(text='Controlled injected clarification')])
    monkeypatch.setattr(s,'_event',failed)
    with pytest.raises(RuntimeError):
        s.complete_conversation_turn(cap,result)
    assert len(s.get_conversation(p,ws,cv.id).messages)==1
    assert s.get_run(p,ws,queued.run.id).state=='running'
    monkeypatch.setattr(s,'_event',original)
    first=s.complete_conversation_turn(cap,result)
    assert s.complete_conversation_turn(cap,result)==first
    raises('command_conflict',lambda:s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='different')])) )
    assert len(s.get_conversation(p,ws,cv.id).messages)==2
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) AS n FROM audit WHERE workspace_id=%s AND operation='complete_run'",(ws,)).fetchone()['n']==1
        assert c.execute('SELECT count(*) AS n FROM run_dispatches WHERE workspace_id=%s',(ws,)).fetchone()['n']==1


def test_viewer_outsider_cross_workspace_and_generation(context):
    s,p,ws,_,admin=context
    cv=conversation(context); queued=post(context,cv)
    cap=s.claim_run(p,ws,queued.run.id)
    raises('not_found_or_not_authorized',lambda:s.get_conversation(Principal('outsider'),ws,cv.id))
    raises('not_found_or_not_authorized',lambda:s.get_conversation(p,'missing-workspace',cv.id))
    with Database(admin).transaction() as c:
        c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
    raises('source_changed',lambda:s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='stale generation')])) )
    with Database(admin).transaction() as c:
        c.execute("UPDATE memberships SET role='viewer' WHERE workspace_id=%s",(ws,))
    assert s.get_conversation(p,ws,cv.id).conversation.id==cv.id
    raises('not_found_or_not_authorized',lambda:post(context,queued.conversation,'viewer cannot write'))
    raises('not_found_or_not_authorized',lambda:s.claim_run(p,ws,queued.run.id))


def test_profile_and_result_schema_fail_closed(context,monkeypatch):
    import workagent.conversations as module
    s,p,ws,_,_=context
    cv=conversation(context); queued=post(context,cv)
    cap=s.claim_run(p,ws,queued.run.id)
    with pytest.raises(ValidationError):
        s.complete_conversation_turn(cap,{'results':[{'kind':'file','path':'/secret'}]})
    monkeypatch.setattr(module,'PROFILE_HASH','0'*64)
    raises('unsupported_operation',lambda:s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='bad pin')])) )
    assert len(s.get_conversation(p,ws,cv.id).messages)==1
    assert s.get_run(p,ws,queued.run.id).state=='running'


def test_no_provider_imports_or_key_reads_in_cli_subprocess(context):
    s,p,ws,_,_=context
    # Fresh interpreter with guarded provider modules, keys and non-loopback sockets.
    script='''
import importlib.abc, os, socket, sys
class DenyProvider(importlib.abc.MetaPathFinder):
    def find_spec(self,fullname,*args):
        if fullname.split('.')[0] in ('openai','anthropic','agents','litellm') or fullname.startswith('workagent.responses'):
            raise AssertionError('provider import denied')
sys.meta_path.insert(0,DenyProvider())
old=os._Environ.__getitem__
def guarded(self,key):
    if any(word in key.upper() for word in ('OPENAI','ANTHROPIC','API_KEY','PROVIDER')):
        raise AssertionError('provider credential lookup denied')
    return old(self,key)
os._Environ.__getitem__=guarded
connect=socket.socket.connect
def local(self,address):
    if isinstance(address,tuple) and address[0] not in ('127.0.0.1','localhost','::1'):
        raise AssertionError('external network denied')
    return connect(self,address)
socket.socket.connect=local
from workagent.prompt_cli import main
raise SystemExit(main(['--controlled','--workspace',sys.argv[1],'prompt','No provider path']))
'''
    child=subprocess.run([sys.executable,'-c',script,ws],env=os.environ,capture_output=True,text=True)
    assert child.returncode==0,child.stderr
    detail=json.loads(child.stdout)
    assert detail['runs'][0]['state']=='ready'
    assert detail['messages'][1]['evidence_origin']=='controlled_transport'


def test_pre_b1_registry_pins_remain_resolvable():
    from workagent.tool_registry import registry_for_hash
    from workagent.service import digest
    pinned='a6ea2514e19db3a54319397736691b55302b2a1d700938adec8e7ebf225ecf3b'
    assert digest(registry_for_hash(pinned))==pinned
