"""Real restricted PostgreSQL; synthetic provider only, never paid calls."""
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
import httpx
import pytest
from test_domain import context,cmd
from test_conversations import conversation,post
from test_general_responses import activate,Provider,worker,totals
from workagent.db import Database
from workagent.service import Service,Principal,digest,encoded
from workagent.models import now
from workagent.provider_attempts import ReceiptCapability,revoke_grant
from workagent.receipt_observer import install,observe_once
from workagent.retained_reply import ApplyRetainedReply,apply
from workagent.errors import DomainError
from workagent.runtime_config import BundleDenied

class Pending(Provider):
    release=False
    def handle(self,request):
        if request.method=='GET' and not self.release:
            self.calls.append(('GET',request.url.path))
            raise httpx.ReadTimeout('synthetic pending',request=request)
        result=super().handle(request)
        if request.method=='POST' and request.url.path=='/v1/responses':
            return httpx.Response(200,json={**result.json(),'status':'in_progress','output':[],'usage':None})
        return result

def prepared(context,tmp_path):
    s,p,ws,_,admin=context;cv=conversation(context);grant=activate(context,[cv])
    reply=post(context,cv,'Suggest a useful reading meetup');fake=Pending();w=worker(context,fake,tmp_path,poll_limit=1)
    assert w.work(p,ws,reply.run.id).state=='running'
    receipt=ReceiptCapability(**w.phases.state.load(ws,reply.run.id)['receipt'])
    owner=Service(Database(admin));revoke_grant(owner.db,grant.id)
    with s.db.transaction() as c:
        step=c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s',(receipt.attempt_id,)).fetchone()
    authority=install(owner.db,observer_id='observe-'+receipt.attempt_id,receipt=receipt,principal=p,
        phase='selection',response_id=next(iter(fake.responses)),request_sha256=step['request_sha256'],
        expires_at=now()+timedelta(minutes=5),read_limit=1)
    fake.release=True;observe_once(s,receipt,authority,w.transport)
    with owner.db.transaction() as c:
        r=s.get_run(p,ws,reply.run.id);r.lease_expires_at=now()-timedelta(seconds=1);owner._store_run(c,r)
        config=c.execute('SELECT data FROM run_configurations WHERE run_id=%s',(r.id,)).fetchone()['data']
        context_data=c.execute('SELECT data FROM run_contexts WHERE run_id=%s',(r.id,)).fetchone()['data']
        result=c.execute("SELECT data FROM responses_events WHERE attempt_id=%s AND kind='result'",(receipt.attempt_id,)).fetchone()['data']
    command=cmd(ApplyRetainedReply,expected_run_sha256=digest(r),expected_context_sha256=digest(context_data),
        expected_configuration_sha256=digest(config),request_sha256=step['request_sha256'],result_sha256=digest(result),
        expected_work_version=s.get_conversation(p,ws,cv.id).conversation.work_version,expires_at=now()+timedelta(minutes=5))
    return owner,receipt,command,fake,grant

def test_application_replay_concurrent_no_generation(context,tmp_path):
    owner,receipt,command,fake,grant=prepared(context,tmp_path);s,p,ws,*_=context
    calls=list(fake.calls);before=totals(s,grant)
    # Direct SQL insertion cannot elevate runtime receipt observation authority.
    from workagent.models import ConversationMessage,TurnResult,TextResult,new_id
    import psycopg
    run=s.get_run(p,ws,receipt.run_id)
    message=ConversationMessage(id=new_id(),conversation_id=run.conversation_id,run_id=run.id,sequence=2,
        author_id='general-responses-worker',author_kind='assistant',text='How can I help?',
        result=TurnResult(results=[TextResult(kind='text',text='How can I help?')]),
        model_receipt=receipt.attempt_id,evidence_origin='synthetic_provider_receipt')
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        s._append_message(c,ws,message)
    with pytest.raises(psycopg.Error),owner.db.transaction() as c:
        owner._append_message(c,ws,message.model_copy(update={'text':'fabricated'}))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:apply(owner,p,receipt,command),range(2)))
    assert results[0]==results[1] and results[0].state=='ready'
    assert results[0].fence==2 and results[0].lease_expires_at is None
    detail=s.get_conversation(p,ws,results[0].conversation_id)
    assert len(detail.messages)==2 and detail.messages[-1].text=='How can I help?'
    assert detail.messages[-1].model_receipt==receipt.attempt_id
    assert detail.messages[-1].evidence_origin=='synthetic_provider_receipt'
    assert totals(s,grant)==before and fake.calls==calls
    with owner.db.transaction() as c:
        assert not c.execute('SELECT active FROM provider_grants WHERE id=%s',(grant.id,)).fetchone()['active']
        assert c.execute('SELECT lease_hash FROM runs WHERE id=%s',(receipt.run_id,)).fetchone()['lease_hash'] is None
        assert c.execute("SELECT count(*) n FROM commands WHERE workspace_id=%s AND command_id=%s",(ws,command.command_id)).fetchone()['n']==1

@pytest.mark.parametrize('barrier',['runtime','principal','membership','generation','run_hash','context_hash','config_hash','result_hash','request_hash','expiry','active_lease','cancel','source','document','later_human','receipt'])
def test_denial_no_application(context,tmp_path,barrier):
    owner,receipt,command,fake,grant=prepared(context,tmp_path);s,p,ws,*_=context
    calls=list(fake.calls)
    if barrier=='runtime':owner=s
    elif barrier=='principal':p=Principal('other')
    elif barrier in ('run_hash','context_hash','config_hash','result_hash','request_hash'):
        field={'run_hash':'expected_run_sha256','context_hash':'expected_context_sha256','config_hash':'expected_configuration_sha256','result_hash':'result_sha256','request_hash':'request_sha256'}[barrier]
        command=command.model_copy(update={field:'0'*64})
    elif barrier=='expiry':command=command.model_copy(update={'expires_at':now()-timedelta(seconds=1)})
    elif barrier=='receipt':
        from dataclasses import replace
        receipt=replace(receipt,secret='bad')
    else:
        with owner.db.transaction() as c:
            if barrier=='membership':c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
            elif barrier=='generation':c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
            elif barrier in ('active_lease','cancel'):
                r=s.get_run(p,ws,receipt.run_id)
                if barrier=='active_lease':r.lease_expires_at=now()+timedelta(minutes=1)
                else:r.state='cancelled'
                owner._store_run(c,r);command=command.model_copy(update={'expected_run_sha256':digest(r)})
            elif barrier=='source':
                c.execute("UPDATE conversations SET data=jsonb_set(data,'{selected_source_refs}',%s) WHERE workspace_id=%s",(encoded([context[3][0].model_dump(mode='json')]),ws))
            elif barrier=='document':
                # Immutable message mutation forbidden by product; fixture tests the
                # guard directly by swapping its authorized read projection below.
                from unittest.mock import patch
                original=owner._conversation_messages
                def read(*args):
                    messages=original(*args);messages[0]=messages[0].model_copy(update={'document_refs':[object()]});return messages
                owner._conversation_messages=read
            else:
                r=s.get_run(p,ws,receipt.run_id)
                c.execute("UPDATE conversations SET data=jsonb_set(data,'{work_version}',to_jsonb((data->>'work_version')::int+1)) WHERE id=%s",(r.conversation_id,))
    with pytest.raises((DomainError,BundleDenied)):
        apply(owner,p,receipt,command)
    with Database(context[4]).transaction() as c:
        assert not c.execute("SELECT 1 FROM conversation_messages WHERE run_id=%s AND author_kind='assistant'",(receipt.run_id,)).fetchone()
    assert fake.calls==calls
