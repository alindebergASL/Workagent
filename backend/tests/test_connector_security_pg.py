"""Parent security regressions: real PostgreSQL and local synthetic provider."""
from concurrent.futures import ThreadPoolExecutor
import threading
import time
from uuid import uuid4

import httpx
import pytest
from test_domain import context
from test_synthetic_connectors_pg import connector
from workagent.connectors import oauth, service as lifecycle
from workagent.connectors.models import RevokeConnector
from workagent.connectors.registry import BASE, AUDIENCE, REDIRECT
from workagent.connectors.revocation import revoke
from workagent.errors import DomainError


def test_complete_revoke_retires_late_exchange(context,connector,monkeypatch):
    from workagent.connectors.models import StartAuthorization,CompleteAuthorization
    s,p,ws,_,_=context
    flow=lifecycle.start(s,p,ws,StartAuthorization(resource='synthetic/catalog',idempotency_key=str(uuid4())))
    reached=threading.Event();release=threading.Event();minted={};original=oauth.exchange
    def exchange(secret):
        result=original(secret);minted.update(result);reached.set();assert release.wait(10);return result
    monkeypatch.setattr(oauth,'exchange',exchange)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(lifecycle.complete,s,p,ws,flow.flow_id,CompleteAuthorization(idempotency_key=str(uuid4())))
        assert reached.wait(10)
        try:
            status=revoke(s,p,ws,flow.flow_id,RevokeConnector(expected_generation=1,idempotency_key=str(uuid4())))
            assert status.state=='revoked' and status.provider_revocation=='failed'
        finally:release.set()
        assert pending.result(timeout=10).state=='revoked'
    with httpx.Client(trust_env=False,follow_redirects=False) as client:
        response=client.post(BASE+'/mcp',headers={'Authorization':'Bearer '+minted['access_token']},json={})
    assert response.status_code==401,'Late exchange grant survived local revoke'
    with pytest.raises(DomainError):lifecycle.credential(s,p,ws,flow.flow_id,1)


def test_product_gateway_stdio(context,connector,monkeypatch):
    from test_synthetic_connectors_pg import install
    from workagent.capabilities.broker import CapabilityBroker
    s,p,ws,_,_=context;cv,q,cap,request=install(context,connector)
    monkeypatch.setenv('WORKAGENT_SYNTHETIC_MCP_TRANSPORT','isolated-stdio')
    observation=CapabilityBroker(s,cap).call(request)
    assert observation.status=='observed' and observation.output['result']['status']=='available'
    assert s.list_workspace_files(p,ws,cv.id).items


def test_restricted_sql_cannot_mutate_authority_or_receipts(context,connector):
    from psycopg import errors
    from test_synthetic_connectors_pg import install
    from workagent.capabilities.broker import CapabilityBroker
    s,p,ws,_,_=context;cv,q,cap,request=install(context,connector)
    assert CapabilityBroker(s,cap).call(request).status=='observed'
    attacks=[
        ("UPDATE connector_accounts SET principal_id='intruder' WHERE workspace_id=%s",(ws,)),
        ("UPDATE connector_auth_flows SET consumed=false WHERE workspace_id=%s",(ws,)),
        ("UPDATE tool_grants SET data=jsonb_set(data,'{resource_selectors}','[]') WHERE workspace_id=%s",(ws,)),
        ("UPDATE tool_attempts SET call=jsonb_set(call,'{arguments,page}','2') WHERE workspace_id=%s",(ws,)),
        ("UPDATE tool_attempt_events SET data='{}' WHERE attempt_id IN (SELECT id FROM tool_attempts WHERE workspace_id=%s)",(ws,)),
        ("SELECT connector_finish(%s,%s,%s,%s,%s,clock_timestamp()+interval '5 minutes')",(ws,'intruder',connector.connector_id,str(uuid4()),'forged-ref')),
        ("SELECT connector_finish(%s,%s,%s,%s,%s,clock_timestamp()+interval '5 minutes')",(ws,p.id,connector.connector_id,str(uuid4()),'forged-ref')),
        ("SELECT connector_revoke_result(%s,%s,%s,%s,'revoked')",(ws,p.id,connector.connector_id,str(uuid4()))),
    ]
    for statement,args in attacks:
        with pytest.raises((errors.InsufficientPrivilege,errors.RaiseException,errors.CheckViolation)):
            with s.db.transaction() as c:c.execute(statement,args)


def test_refresh_revoke_cleans_latest_real_provider_token(context,connector,monkeypatch):
    service,principal,ws,_,_=context
    ref=lifecycle.authorized(service,principal,ws,connector.connector_id,1)
    vault=lifecycle.vault();value,revision=vault.read(ref)
    value['expires']=0;vault.rotate(ref,revision,value)
    reached=threading.Event();release=threading.Event();minted={};original=oauth.post
    def controlled(path,body):
        result=original(path,body)
        if path=='/oauth/refresh':
            minted.update(result);reached.set();assert release.wait(10)
        return result
    monkeypatch.setattr(oauth,'post',controlled)
    with ThreadPoolExecutor(max_workers=2) as pool:
        reading=pool.submit(lifecycle.credential,service,principal,ws,connector.connector_id,1)
        assert reached.wait(10)
        revoking=pool.submit(revoke,service,principal,ws,connector.connector_id,
                            RevokeConnector(expected_generation=1,idempotency_key=str(uuid4())))
        try:
            for _ in range(100):
                state=lifecycle.status(service,principal,ws,connector.connector_id)
                if state.state=='revoked':break
                time.sleep(.02)
            assert state.state=='revoked' and state.provider_revocation=='pending'
            with pytest.raises(DomainError):lifecycle.authorized(service,principal,ws,connector.connector_id,1)
        finally:release.set()
        with pytest.raises((DomainError,ValueError)):reading.result(timeout=10)
        assert revoking.result(timeout=10).provider_revocation=='revoked'
    with httpx.Client(trust_env=False,follow_redirects=False) as client:
        result=client.post(BASE+'/mcp',headers={'Authorization':'Bearer '+minted['access_token']},json={})
    assert result.status_code==401,'Newly minted provider token survived reported revoke'
    with pytest.raises(ValueError):vault.read(ref)


def test_real_callback_code_pkce_replay_and_metadata(context,connector):
    flow=oauth.new_flow()
    callback=oauth.post('/oauth/issue',{k:flow[k] for k in ('state','challenge','issuer','audience','redirect')})
    oauth.validate_callback(flow,callback)
    body=dict(code=callback['code'],verifier=flow['verifier'],issuer=BASE,audience=AUDIENCE,redirect=REDIRECT)
    tokens=oauth.post('/oauth/token',body)
    with pytest.raises(oauth.OAuthRejected):oauth.post('/oauth/token',body)
    for field in ('state','issuer','audience','redirect'):
        with pytest.raises(oauth.OAuthRejected):oauth.validate_callback(flow,{**callback,field:'wrong-binding'})
    oauth.post('/oauth/revoke',{'access_token':tokens['access_token'],'refresh_token':tokens['refresh_token']})
    flow2=oauth.new_flow();callback2=oauth.post('/oauth/issue',{k:flow2[k] for k in ('state','challenge','issuer','audience','redirect')})
    body2=dict(code=callback2['code'],verifier='incorrect-verifier',issuer=BASE,audience=AUDIENCE,redirect=REDIRECT)
    with pytest.raises(oauth.OAuthRejected):oauth.post('/oauth/token',body2)
    with pytest.raises(oauth.OAuthRejected):oauth.post('/oauth/token',{**body2,'verifier':flow2['verifier']})


def test_secret_absence_from_app_rows_and_encrypted_vault(context,connector):
    service,principal,ws,_,_=context
    ref=lifecycle.authorized(service,principal,ws,connector.connector_id,1)
    vault=lifecycle.vault();tokens,_=vault.read(ref)
    with service.db.transaction() as c:
        tables=['connector_accounts','connector_auth_flows','connector_revocations','tool_attempts','source_snapshots','memory_items','memory_revisions','conversation_messages']
        from psycopg import sql
        rows=[]
        for table in tables:
            rows.extend(c.execute(sql.SQL('SELECT row_to_json(t)::text data FROM {} t WHERE workspace_id=%s').format(sql.Identifier(table)),(ws,)).fetchall())
    material=str(rows).encode()+vault.path.read_bytes()
    if any(tokens[k].encode() in material for k in ('access_token','refresh_token')):
        raise AssertionError('Secret material escaped the encrypted vault')


@pytest.mark.parametrize('fence',['connector','processor','generation','installation','expiry'])
def test_scope_fences_source_context_publication_and_receipts(context,connector,fence):
    from test_synthetic_connectors_pg import install
    from workagent.capabilities import policy,observations
    from workagent.capabilities.broker import CapabilityBroker
    from workagent.db import Database
    s,p,ws,_,admin=context;cv,q,cap,request=install(context,connector,expires_after=12 if fence=='expiry' else 300)
    obs=CapabilityBroker(s,cap).call(request);sid=obs.output['result']['snapshot']['snapshot_id']
    with s.db.transaction() as c:
        grant=policy.grant(c,ws,q.run.id)
        before=c.execute('SELECT data FROM tool_attempt_events WHERE attempt_id=%s ORDER BY created_at',(obs.attempt_id,)).fetchall()
    if fence=='generation':
        with Database(admin).transaction() as c:c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
    elif fence=='installation':
        with Database(admin).transaction() as c:c.execute("UPDATE capability_installations SET enabled=false WHERE id='connectors.mcp.read'")
    elif fence=='expiry':
        from workagent.models import now
        time.sleep(max(0,(grant.expires_at-now()).total_seconds())+.1)
    else:policy.restrict_resources(Database(admin),grant.id,[r for r in grant.resource_selectors if r.kind==fence])
    assert s.list_workspace_files(p,ws,cv.id).items==[]
    assert next(x for x in policy.discover(s,p,ws,q.run.id).items if x.id=='connectors.mcp.read').availability_reason!='available'
    for action in [lambda:s.get_source_snapshot(p,ws,sid),lambda:observations.page(s,p,ws,q.run.id),
                   lambda:CapabilityBroker(s,cap).call(request),lambda:s.conversation_worker_context(cap)]:
        with pytest.raises(DomainError):action()
    with s.db.transaction() as c:
        assert c.execute('SELECT data FROM tool_attempt_events WHERE attempt_id=%s ORDER BY created_at',(obs.attempt_id,)).fetchall()==before
        assert not c.execute('SELECT research_run_dependencies_visible(%s,%s) ok',(ws,q.run.id)).fetchone()['ok']
        with pytest.raises(Exception):c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE workspace_id=%s AND id=%s',(ws,q.run.id))
    if fence=='installation':
        with Database(admin).transaction() as c:c.execute("UPDATE capability_installations SET enabled=true WHERE id='connectors.mcp.read'")


def test_same_user_cross_workspace_and_conversation_no_cache(context,connector):
    import json
    from pathlib import Path
    from test_synthetic_connectors_pg import install
    from test_conversations import conversation
    from workagent.capabilities.broker import CapabilityBroker
    from workagent.fixture import seed
    from workagent.service import Principal
    s,p,ws,_,admin=context;cv,q,cap,request=install(context,connector)
    obs=CapabilityBroker(s,cap).call(request);sid=obs.output['result']['snapshot']['snapshot_id']
    other=conversation(context)
    assert s.list_workspace_files(p,ws,other.id).items==[]
    from test_domain import cmd
    from workagent.models import CreateWorkArea
    project=s.create_work_area(p,ws,cmd(CreateWorkArea,title='Separate synthetic project',goal='Different scope',kind='project',selected_source_refs=[]))
    assert s.list_workspace_files(p,ws,project.id).items==[]
    from pydantic import ValidationError
    with pytest.raises(ValidationError):type(request).model_validate({**request.model_dump(),'scope_id':project.id})
    from test_conversations import post
    other_run=post(context,other);other_cap=s.claim_run(p,ws,other_run.run.id)
    with pytest.raises(DomainError):CapabilityBroker(s,other_cap).call(request)
    ws2='test-'+str(uuid4());seed(admin,json.loads((Path(__file__).parents[2]/'fixtures/actor/solo-v0.1/initial_records.json').read_text()),ws2,p.id)
    for principal,workspace in [(p,ws2),(Principal('intruder'),ws)]:
        for action in [lambda:lifecycle.status(s,principal,workspace,connector.connector_id),lambda:s.get_source_snapshot(principal,workspace,sid)]:
            with pytest.raises(DomainError):action()
    # No cross-request SDK or connector cache exists; exact replay is a scoped
    # immutable gateway receipt and rechecks all authority before returning it.
    assert CapabilityBroker(s,cap).call(request)==obs


def test_echoed_bearer_rejected_before_snapshot_receipt_and_context(context,connector,monkeypatch):
    import asyncio,json,httpx2
    from workagent.connectors import mcp_client,synthetic_server as fixture
    from workagent.capabilities.broker import CapabilityBroker
    from test_synthetic_connectors_pg import install
    s,p,ws,_,_=context;cv,q,cap,request=install(context,connector)
    canary=lifecycle.credential(s,p,ws,connector.connector_id,1)
    original=httpx2.AsyncClient;app=fixture.app();replaced=[]
    async def hostile(scope,receive,send):
        async def poison(message):
            if message['type']=='http.response.start':
                message={**message,'headers':[(k,v) for k,v in message['headers'] if k!=b'content-length']}
            if message['type']=='http.response.body':
                body=message.get('body',b'');old=b'Invented local evidence for connector lifecycle testing.'
                if old in body:replaced.append(True);message={**message,'body':body.replace(old,canary.encode())}
            await send(message)
        await app(scope,receive,poison)
    monkeypatch.setattr(httpx2,'AsyncClient',lambda **kw:original(transport=httpx2.ASGITransport(app=hostile),**kw))
    def read(token,page):
        async def run():
            async with app.app.router.lifespan_context(app.app):
                with fixture._lock:fixture._tokens[fixture.hashed(token)]=time.time()+60
                return await mcp_client.read_async(token,page)
        try:return asyncio.run(run())
        except Exception:raise mcp_client.MCPUnavailable('synthetic MCP unavailable') from None
    monkeypatch.setattr(mcp_client,'read',read)
    result=CapabilityBroker(s,cap).call(request)
    assert replaced and result.output['result']['status']=='unavailable'
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM source_snapshots WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
        receipts=c.execute('SELECT e.data FROM tool_attempt_events e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s',(ws,)).fetchall()
    assert canary not in json.dumps(receipts,default=str)
    assert canary not in json.dumps(s.conversation_worker_context(cap),default=str)
    assert s.list_workspace_files(p,ws,cv.id).items==[]


def test_prepared_provider_count_and_dispatch_denied_after_revoke(context,connector,tmp_path,monkeypatch):
    from unittest.mock import patch
    from datetime import timedelta
    from test_standing_admission import standing_grant
    from test_conversations import conversation,post
    from test_general_alpha_runtime import AlphaProvider
    from test_general_responses import worker
    from test_runtime import expire
    from workagent.provider_attempts import configure_grant
    from workagent.capabilities.mcp_composition import POLICY,SCHEMA
    from workagent.capabilities import registry,policy,mcp_adapters as A
    from workagent.capabilities.models import ToolGrantV1,CapabilityPin
    from workagent.models import new_id,now
    from workagent.db import Database
    from workagent.responses_ledger import Ledger
    s,p,ws,_,admin=context;cv=conversation(context)
    with patch('test_alpha_budget.POLICY',POLICY),patch('test_alpha_budget.DECISION_SCHEMA',SCHEMA):
        pg=standing_grant(context,continuity_version='sustained-v1',max_steps=4)
    configure_grant(Database(admin),pg)
    q=post(context,cv,'Read the connected synthetic library.');req=A.MCPRead(kind='mcp_read',connector_id=connector.connector_id,access_generation=1,page=1)
    d=registry.adapters()['connectors.mcp.read'].descriptor
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256)],
        resource_selectors=A.input_refs(req),effects=['read'],privacy_classes=['workspace_private'],egress='none',
        expires_at=now()+timedelta(minutes=5),access_generation=q.run.access_generation,budget_account_id=new_id())
    policy.install(Database(admin),g,limits={'connector':10})
    fake=AlphaProvider([req.model_dump(),dict(kind='reply',text='Synthetic evidence only.')]);saved={};original=Ledger.prepare
    def prepare(self,request,cap):
        original(self,request,cap)
        if request.phase=='selection_2':saved.update(ledger=self,request=request,cap=cap);raise SystemExit('prepared boundary')
    monkeypatch.setattr(Ledger,'prepare',prepare)
    with pytest.raises(SystemExit):worker(context,fake,tmp_path/'mcp').work(p,ws,q.run.id)
    assert saved;calls=list(fake.calls)
    revoke(s,p,ws,connector.connector_id,RevokeConnector(expected_generation=1,idempotency_key=str(uuid4())))
    ledger,request,cap=[saved[k] for k in ('ledger','request','cap')]
    for action in [lambda:ledger.snapshot(request.phase,cap),lambda:ledger.prepare(request,cap),
        lambda:ledger.reserve_operation(request,'count_send',cap),lambda:ledger.reserve_operation(request,'dispatch',cap)]:
        with pytest.raises(DomainError):action()
    expire(context,q.run.id)
    try:worker(context,fake,tmp_path/'mcp').work(p,ws,q.run.id)
    except DomainError:pass
    assert fake.calls==calls
