"""Gateway security/cost proof against actual restricted PostgreSQL, never mocks of persistence."""
import json
import secrets
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal

import psycopg
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from test_domain import context, cmd
from test_conversations import conversation, post
from workagent.api import Settings, create_app
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import now, new_id, CancelConversation
from workagent.service import Principal, digest, encoded
from workagent.capabilities import registry, policy, observations
from workagent.capabilities.models import ToolGrantV1, CapabilityPin, ToolCallV1
from workagent.capabilities.broker import CapabilityBroker


def setup(ctx, *, limit=10, name='context.read', provider_grant_id=None, account_id=None, cv=None, q=None, cap=None, claim=True):
    s,p,ws,_,admin=ctx
    cv=cv or conversation(ctx); q=q or post(ctx,cv)
    cap=cap or (s.claim_run(p,ws,q.run.id) if claim else None)
    d=registry.adapters()[name].descriptor
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,
                                    implementation_sha256=d.implementation_sha256)],
        resource_selectors=[],effects=d.effects,privacy_classes=d.privacy_classes,
        egress='public_https' if name=='research.fetch' else 'none',expires_at=now()+timedelta(hours=1),
        access_generation=q.run.access_generation,budget_account_id=account_id or new_id())
    policy.install(Database(admin),g,limits={d.cost_profile.category:limit},provider_grant_id=provider_grant_id)
    call=ToolCallV1(call_id=new_id(),capability_id=d.id,capability_version=d.version,
        arguments={'kind':'read_context','section':'messages'},input_refs=[],expected_work_version=q.conversation.work_version)
    return cap,g,call,q


def test_gateway_read_and_idempotency(context):
    s,p,ws,_,_=context;cap,g,call,q=setup(context)
    broker=CapabilityBroker(s,cap); first=broker.call(call); again=broker.call(call)
    assert first==again and first.status=='observed'
    assert first.output['capability']=='read_context' and first.output_sha256==digest(first.output)
    assert first.cost.elapsed_ms>=0 and first.cost.cpu_ms>=0 and first.cost.billed_cost_usd is None
    assert observations.page(s,p,ws,q.run.id).items[0].observation==first
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM tool_cost_entries WHERE attempt_id=%s',(first.attempt_id,)).fetchone()['n']==2
        assert c.execute('SELECT run_id FROM work_events WHERE workspace_id=%s AND type=%s ORDER BY position DESC',
                         (ws,'audit.recorded')).fetchone()['run_id']==q.run.id


def test_descriptor_is_not_grant_and_forged_fields(context):
    s,p,ws,_,_=context; cv=conversation(context); q=post(context,cv); cap=s.claim_run(p,ws,q.run.id)
    call=ToolCallV1(call_id=new_id(),capability_id='context.read',capability_version='1',
                   arguments={'kind':'read_context','section':'messages'},input_refs=[],expected_work_version=q.conversation.work_version)
    assert all(x.availability_reason!='available' for x in policy.discover(s,p,ws,q.run.id).items)
    with pytest.raises(DomainError): CapabilityBroker(s,cap).call(call)
    for field,value in [('principal_id',p.id),('effects',['external_write']),('grant_id',new_id()),('token','secret'),('accept',True)]:
        with pytest.raises(ValidationError): ToolCallV1.model_validate({**call.model_dump(),field:value})
    with pytest.raises(DomainError): policy.discover(s,Principal('different'),ws,q.run.id)


def test_forged_worker_and_raw_sql_authority_denied(context):
    s,p,ws,_,_=context; cap,g,call,q=setup(context)
    for forged in [replace(cap,principal_id='different'),replace(cap,secret='guessed'),replace(cap,fence=cap.fence+1)]:
        with pytest.raises(DomainError): CapabilityBroker(s,forged).call(call)
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s)',
                (ws,q.run.id,cap.fence,digest('forged'),encoded(call),digest('receipt')))
    for statement in ['UPDATE tool_grants SET active=false', 'DELETE FROM tool_cost_entries',
                      "INSERT INTO capability_installations VALUES ('evil.read','1','{}',true)"]:
        with pytest.raises(psycopg.Error):
            with s.db.transaction() as c: c.execute(statement)
    raw={**call.model_dump(mode='json'),'effects':['external_write']}
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s)',
                (ws,q.run.id,cap.fence,digest(cap.secret),encoded(raw),digest('receipt')))


@pytest.mark.parametrize('change',['generation','grant','cancel','installation'])
def test_pre_io_fences(context,monkeypatch,change):
    s,p,ws,_,admin=context; cap,g,call,q=setup(context)
    installed=registry.adapters(); invoked=[]; native=installed['context.read']
    installed['context.read']=replace(native,invoke=lambda *_:invoked.append(True))
    monkeypatch.setattr(registry,'adapters',lambda:installed)
    if change=='cancel':
        s.cancel_conversation(p,ws,q.conversation.id,cmd(CancelConversation,expected_work_version=q.conversation.work_version))
    else:
        with Database(admin).transaction() as c:
            if change=='generation': c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
            if change=='grant': c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
            if change=='installation': c.execute("UPDATE capability_installations SET enabled=false WHERE id='context.read'")
    with pytest.raises((DomainError,psycopg.Error)): CapabilityBroker(s,cap).call(call)
    assert not invoked
    # Restore global installation only in this disposable owner fixture.
    if change=='installation':
        with Database(admin).transaction() as c: c.execute("UPDATE capability_installations SET enabled=true WHERE id='context.read'")


@pytest.mark.parametrize('change',['generation','grant','cancel','lease','source'])
def test_late_result_cost_only_and_never_context(context,monkeypatch,change):
    s,p,ws,refs,admin=context
    cv=conversation(context,refs[:1])
    cap,g,call,q=setup(context,cv=cv)
    installed=registry.adapters(); native=installed['context.read']
    def adapter(*args):
        output=native.invoke(*args)
        if change=='cancel':
            s.cancel_conversation(p,ws,q.conversation.id,cmd(CancelConversation,expected_work_version=q.conversation.work_version))
        else:
            with Database(admin).transaction() as c:
                if change=='generation': c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
                if change=='grant': c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
                if change=='source': c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s',(ws,))
                if change=='lease':
                    c.execute("UPDATE runs SET data=jsonb_set(data,'{lease_expires_at}',%s) WHERE workspace_id=%s AND id=%s",(encoded((now()-timedelta(seconds=1)).isoformat()),ws,q.run.id))
        return output
    installed['context.read']=replace(native,invoke=adapter);monkeypatch.setattr(registry,'adapters',lambda:installed)
    result=CapabilityBroker(s,cap).call(call)
    assert result.status=='cost_only' and result.output is None and result.output_sha256 is None
    with s.db.transaction() as c:
        stored=c.execute("SELECT data FROM tool_attempt_events WHERE attempt_id=%s AND kind='observation'",(result.attempt_id,)).fetchone()['data']
        assert stored['output'] is None
        assert c.execute('SELECT count(*) AS n FROM tool_cost_entries WHERE attempt_id=%s',(result.attempt_id,)).fetchone()['n']==2
    with pytest.raises((DomainError,psycopg.Error)): CapabilityBroker(s,cap).call(call)


def test_schema_drift_fails_before_io(context,monkeypatch):
    s,p,ws,_,_=context;cap,g,call,q=setup(context)
    installed=registry.adapters(); original=installed['context.read']
    installed['context.read']=replace(original,descriptor=original.descriptor.model_copy(update={'schema_sha256':'a'*64}))
    monkeypatch.setattr(registry,'adapters',lambda:installed)
    with pytest.raises(DomainError): CapabilityBroker(s,cap).call(call)
    assert next(x for x in policy.discover(s,p,ws,q.run.id).items if x.id=='context.read').availability_reason=='temporarily_unavailable'


def test_atomic_capacity_and_duplicate_call(context,monkeypatch):
    s,p,ws,_,_=context;cap,g,call,q=setup(context,limit=1)
    installed=registry.adapters(); native=installed['context.read']; invoked=[]
    def adapter(*args): invoked.append(True); return native.invoke(*args)
    installed['context.read']=replace(native,invoke=adapter);monkeypatch.setattr(registry,'adapters',lambda:installed)
    def run(i):
        try: return CapabilityBroker(s,cap).call(call.model_copy(update={'call_id':str(i)})).status
        except (DomainError,psycopg.Error): return 'denied'
    with ThreadPoolExecutor(max_workers=6) as pool: results=list(pool.map(run,range(6)))
    assert results.count('observed')==1 and len(invoked)==1
    with s.db.transaction() as c:
        assert c.execute("SELECT sum(e.units) AS n FROM tool_cost_entries e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.account_id=%s AND e.kind='reserved'",(g.budget_account_id,)).fetchone()['n']==1


def test_unknown_effect_never_resent_after_restart(context,monkeypatch):
    s,p,ws,_,_=context;cap,g,call,q=setup(context)
    installed=registry.adapters(); native=installed['context.read']; invoked=[]
    def adapter(*_): invoked.append(True); raise TimeoutError('timeout after possible effect')
    installed['context.read']=replace(native,invoke=adapter);monkeypatch.setattr(registry,'adapters',lambda:installed)
    first=CapabilityBroker(s,cap).call(call)
    assert first.status=='outcome_unknown' and first.cost.basis=='unknown'
    assert CapabilityBroker(s,cap).call(call)==first and len(invoked)==1
    from workagent.service import Service
    assert CapabilityBroker(Service(Database(s.db.dsn)),cap).call(call)==first and len(invoked)==1


def test_crash_after_dispatch_does_not_resend(context):
    s,p,ws,_,_=context;cap,g,call,q=setup(context); secret='write-only-receipt'
    with s.db.transaction() as c:
        aid=c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s) AS id',
            (ws,q.run.id,cap.fence,digest(cap.secret),encoded(call),digest(secret))).fetchone()['id']
        assert c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s) AS sent',(aid,cap.fence,digest(cap.secret),secret)).fetchone()['sent']
    with pytest.raises(DomainError): CapabilityBroker(s,cap).call(call)
    assert observations.page(s,p,ws,q.run.id).items[0].state=='outcome_unknown'


def test_http_projections_and_no_execute_surface(context):
    s,p,ws,_,_=context;cap,g,call,q=setup(context)
    result=CapabilityBroker(s,cap).call(call)
    token=secrets.token_urlsafe(32)
    app=create_app(Settings(s.db.dsn,True,token))
    headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()}
    with TestClient(app) as client:
        urls=[f'/v1/workspaces/{ws}/capabilities?run_id={q.run.id}',f'/v1/workspaces/{ws}/runs/{q.run.id}/tool-attempts',
              f'/v1/workspaces/{ws}/tool-attempts/{result.attempt_id}']
        for url in urls:
            assert client.get(url,headers=headers).status_code==200
            assert client.get(url).status_code==401
        detail=client.get(urls[-1],headers=headers).json()
        assert detail['run_id']==q.run.id and detail['observation']['output_sha256']==result.output_sha256
        rejected=client.post(urls[-1],headers=headers,json=call.model_dump(mode='json'))
        assert rejected.status_code==422 and rejected.json()['code']=='unsupported_operation'
        assert client.get(f'/v1/workspaces/not-ours/tool-attempts/{result.attempt_id}',headers=headers).status_code==404
        spec=client.get('/openapi.json').json()
        assert all('execute' not in name for name in spec['paths'] if 'tool' in name or 'capabilit' in name)
