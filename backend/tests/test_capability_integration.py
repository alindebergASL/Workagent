"""Cross-boundary regressions: actual ledger, checkpoint, typed legacy adapters."""
from dataclasses import replace
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import pytest
import psycopg

from test_domain import context, create, ready, cmd
from test_conversations import conversation, post
from test_capability_gateway import setup
from test_runtime import expire
from test_alpha_budget import prepared, count, reserve, raw
from test_general_responses import worker
from test_general_alpha_runtime import AlphaProvider
from test_b24_runtime_pg import activate
from test_adaptive_execution import finish_safe_visits
from workagent.models import new_id, RequestRevision
from workagent.db import Database
from workagent.errors import DomainError
from workagent.service import encoded, digest
from workagent.responses_ledger import summary, RESERVED_COST, RESERVED_INPUT, RESERVED_OUTPUT
from workagent.capabilities import registry, policy
from workagent.capabilities.broker import CapabilityBroker
from workagent.capabilities.models import ToolCallV1


def test_completed_tool_reused_by_reclaimed_worker_without_send(context,monkeypatch):
    s,p,ws,_,_=context; cap,g,call,q=setup(context)
    installed=registry.adapters(); native=installed['context.read']; calls=[]
    def invoke(*args): calls.append(True); return native.invoke(*args)
    installed['context.read']=replace(native,invoke=invoke);monkeypatch.setattr(registry,'adapters',lambda:installed)
    first=CapabilityBroker(s,cap).call(call)
    expire(context,q.run.id); current=s.claim_run(p,ws,q.run.id)
    assert current.fence>cap.fence
    assert CapabilityBroker(s,current).call(call)==first and len(calls)==1


@pytest.mark.parametrize('name',['legacy.get_assignment','legacy.get_artifact'])
def test_legacy_read_adapter_keeps_typed_datetime_results(context,name):
    s,p,ws,_,_=context
    a,artifact=ready(context)
    q=s.request_revision(p,ws,artifact.id,cmd(RequestRevision,expected_work_version=a.work_version,
        base_revision_id=artifact.current_revision_id,instruction='Review this retained synthetic draft.'))
    cap=s.claim_run(p,ws,q.run.id); a=s.get_assignment(p,ws,a.id)
    # Shared installer takes the same run-derived task scope, independent of UI kind.
    wrapped=SimpleNamespace(run=q.run,conversation=a)
    cap,g,_,_=setup(context,name=name,cv=a,q=wrapped,cap=cap)
    args={'workspace_id':ws,'assignment_id':a.id} if name=='legacy.get_assignment' else {
        'workspace_id':ws,'artifact_id':artifact.id,'revision_id':None}
    args.update(schema_version='workagent/v1',request_id=new_id())
    call=ToolCallV1(call_id=new_id(),capability_id=name,capability_version='1',arguments=args,
                   input_refs=[],expected_work_version=a.work_version)
    result=CapabilityBroker(s,cap).call(call)
    assert result.status=='observed' and result.output['id']==(a.id if name=='legacy.get_assignment' else artifact.id)
    from workagent.broker import Broker
    assert Broker(s,cap).call(name.removeprefix('legacy.'),args).id==result.output['id']
    with pytest.raises(DomainError,match='unsupported_operation'):
        Broker(s,cap).call('propose_artifact_revision',args)


def test_same_call_concurrency_never_steals_receipt_secret(context,monkeypatch):
    s,p,ws,_,_=context;cap,g,call,q=setup(context)
    installed=registry.adapters(); native=installed['context.read']; calls=[]
    def invoke(*args): calls.append(True); return native.invoke(*args)
    installed['context.read']=replace(native,invoke=invoke);monkeypatch.setattr(registry,'adapters',lambda:installed)
    def run(_):
        try:return CapabilityBroker(s,cap).call(call).status
        except DomainError:return 'pending'
    with ThreadPoolExecutor(max_workers=5) as pool: results=list(pool.map(run,range(5)))
    assert 'observed' in results and len(calls)==1
    assert CapabilityBroker(s,cap).call(call).status=='observed'


def test_revoke_prevents_consumption_and_publication_not_only_new_calls(context):
    s,p,ws,_,admin=context;cap,g,call,q=setup(context)
    CapabilityBroker(s,cap).call(call)
    with Database(admin).transaction() as c: c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
    with pytest.raises(DomainError): s.conversation_worker_context(cap)
    with pytest.raises(DomainError): CapabilityBroker(s,cap).call(call)
    with pytest.raises(psycopg.Error,match='tool publication authority revoked'):
        with s.db.transaction() as c:
            c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE workspace_id=%s AND id=%s',(ws,q.run.id))


def test_dispatch_fence_after_reservation(context):
    s,p,ws,_,admin=context;cap,g,call,q=setup(context)
    with s.db.transaction() as c:
        aid=c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s) AS id',
            (ws,q.run.id,cap.fence,digest(cap.secret),encoded(call),digest('receipt'))).fetchone()['id']
    with Database(admin).transaction() as c: c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
    with pytest.raises(psycopg.Error,match='tool authority denied'):
        with s.db.transaction() as c: c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s)',(aid,cap.fence,digest(cap.secret),'receipt'))
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM tool_attempt_events WHERE attempt_id=%s',(aid,)).fetchone()['n']==0
        assert c.execute('SELECT count(*) AS n FROM tool_cost_entries WHERE attempt_id=%s',(aid,)).fetchone()['n']==1


def priced(monkeypatch,price):
    installed=registry.adapters(); original=installed['context.read']
    name='test.cost_'+new_id().replace('-','')
    descriptor=original.descriptor.model_copy(update={'id':name,'cost_profile':original.descriptor.cost_profile.model_copy(
        update={'reserved_cost_usd':str(price),'category':'connector'})})
    installed[name]=replace(original,descriptor=descriptor)
    monkeypatch.setattr(registry,'adapters',lambda:installed)
    return name


def attach_prepared(ctx,x,g,name):
    s,p,ws,_,_=ctx
    run=s.get_run(p,ws,x['cap'].run_id)
    cv=s.get_conversation(p,ws,run.conversation_id).conversation
    q=SimpleNamespace(run=run,conversation=cv)
    return setup(ctx,name=name,provider_grant_id=g.id,cap=x['cap'],cv=cv,q=q)


@pytest.mark.parametrize('first',['model','tool'])
def test_model_and_tool_share_existing_money_without_refund(context,tmp_path,monkeypatch,first):
    s,p,ws,_,_=context
    g,f,x=prepared(context,tmp_path,cost_limit_usd='1.00');count(x,f)
    name=priced(monkeypatch,Decimal('1')-RESERVED_COST+Decimal('0.000001'))
    cap,tg,call,q=attach_prepared(context,x,g,name)
    if first=='model':
        reserve(x,'dispatch')
        with pytest.raises(psycopg.Error,match='budget exhausted'): CapabilityBroker(s,cap).call(call)
    else:
        assert CapabilityBroker(s,cap).call(call).status=='observed'
        with pytest.raises(DomainError,match='budget_exhausted'): reserve(x,'dispatch')
        with pytest.raises(psycopg.Error,match='budget exhausted'):
            raw(x,'dispatch',dict(reserved_input_tokens=RESERVED_INPUT,reserved_output_tokens=RESERVED_OUTPUT,
                                  reserved_cost_usd=str(RESERVED_COST),billed_cost_usd=None))
    with s.db.transaction() as c:
        result=summary(c,g.id,shared=True)
        assert Decimal(result['reserved_cost_usd'])<=1
        if first=='tool':
            assert result['tool_accounting']['entries'][0]['category']=='connector'
            assert result['billed_cost_usd'] is None


def test_concurrent_model_tool_reservations_are_atomic(context,tmp_path,monkeypatch):
    s,p,ws,_,_=context;g,f,x=prepared(context,tmp_path,cost_limit_usd='1.00');count(x,f)
    name=priced(monkeypatch,Decimal('1')-RESERVED_COST+Decimal('0.000001'))
    cap,tg,call,q=attach_prepared(context,x,g,name)
    def model():
        try:reserve(x,'dispatch');return 'model'
        except (DomainError,psycopg.Error):return 'denied'
    def tool():
        try:CapabilityBroker(s,cap).call(call);return 'tool'
        except (DomainError,psycopg.Error):return 'denied'
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(model),pool.submit(tool)]; results=[f.result() for f in futures]
    assert results.count('denied')==1
    with s.db.transaction() as c: assert Decimal(summary(c,g.id,shared=True)['reserved_cost_usd'])<=1


def test_existing_carry_is_charged_to_tools(context,tmp_path,monkeypatch):
    s,p,ws,_,admin=context; project='proj_carry_'+new_id()
    from workagent.budget_carryforward import install_carry
    install_carry(Database(admin),project_id=project,transport_mode='synthetic',source_database='synthetic_prior',
        source_grant_id=new_id(),source_manifest_sha256='a'*64,reserved_cost_usd='0.9')
    g,f,x=prepared(context,tmp_path,project=project,cost_limit_usd='1.00')
    name=priced(monkeypatch,'0.2');cap,tg,call,q=attach_prepared(context,x,g,name)
    with pytest.raises(psycopg.Error,match='budget exhausted'):CapabilityBroker(s,cap).call(call)
    with s.db.transaction() as c:
        totals=summary(c,g.id,shared=True)
        assert Decimal(totals['carried_reserved_cost_usd'])==Decimal('0.9')
        assert Decimal(totals['reserved_cost_usd'])==Decimal('0.9')


def test_real_worker_stage_checkpoint_and_restart_use_gateway(context,tmp_path,monkeypatch):
    s,p,ws,_,_=context;cv=conversation(context);pg=activate(context,cv,max_steps=3)
    q=post(context,cv,'Read this run context then answer in one sentence.')
    _,tg,call,_=setup(context,cv=cv,q=q,claim=False,provider_grant_id=pg.id)
    fake=AlphaProvider([{'kind':'read_context','section':'messages'},{'kind':'reply','text':'The retained context was reviewed.'}])
    w=worker(context,fake,tmp_path)
    final=finish_safe_visits(context,w,q.run.id)
    assert final.state=='ready'
    with s.db.transaction() as c:
        attempt=c.execute('SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()
        obs=c.execute("SELECT data FROM tool_attempt_events WHERE attempt_id=%s AND kind='observation'",(attempt['id'],)).fetchone()['data']
        staged=c.execute("SELECT e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s AND e.kind='tool_result' AND e.phase='selection'",(ws,q.run.id)).fetchone()['data']
        assert staged['capability_result']==obs['output'] and obs['status']=='observed'
    cps=s.list_run_checkpoints(p,ws,cv.id).items
    assert any(cp.run_id==q.run.id for cp in cps)
    before=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==before
    assert s.get_conversation(p,ws,cv.id).messages[-1].text=='The retained context was reviewed.'


def test_discovery_reports_current_permission_not_legacy_hints(context):
    s,p,ws,_,_=context
    cap,g,call,q=setup(context,name='capabilities.discover_legacy')
    call=call.model_copy(update={'arguments':{'kind':'discover_capabilities'}})
    result=CapabilityBroker(s,cap).call(call)
    assert result.status=='observed'
    items=result.output['result']['items']
    assert next(d for d in items if d['id']=='capabilities.discover_legacy')['availability_reason']=='available'
    assert all(d['availability_reason']!='available' for d in items if d['id']!='capabilities.discover_legacy')


def test_revoke_after_stage_blocks_next_model_request_and_publication(context,tmp_path):
    s,p,ws,_,admin=context;cv=conversation(context);pg=activate(context,cv,max_steps=3)
    q=post(context,cv,'Read then answer; revocation must stop further consumption.')
    _,g,_,_=setup(context,cv=cv,q=q,claim=False,provider_grant_id=pg.id)
    fake=AlphaProvider([{'kind':'read_context','section':'messages'},{'kind':'reply','text':'Must not publish.'}])
    w=worker(context,fake,tmp_path);revoked=[]
    def hook(point):
        if point=='after_tool_result' and not revoked:
            with Database(admin).transaction() as c: c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
            revoked.append(True)
    w.phases.hook=hook
    try: finish_safe_visits(context,w,q.run.id)
    except DomainError: pass
    assert revoked and len(fake.contexts)==1
    detail=s.get_conversation(p,ws,cv.id)
    assert all(m.author_kind!='assistant' for m in detail.messages)
    with s.db.transaction() as c:
        assert c.execute('SELECT tool_run_available(%s,%s) AS ok',(ws,q.run.id)).fetchone()['ok'] is False


def test_revoked_tool_binding_denies_direct_model_dispatch(context,tmp_path,monkeypatch):
    g,f,x=prepared(context,tmp_path);count(x,f)
    name=priced(monkeypatch,'0');cap,tg,call,q=attach_prepared(context,x,g,name)
    with Database(context[4]).transaction() as c: c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(tg.id,))
    with pytest.raises(psycopg.Error,match='tool publication authority revoked'):
        raw(x,'dispatch',dict(reserved_input_tokens=RESERVED_INPUT,reserved_output_tokens=RESERVED_OUTPUT,
                             reserved_cost_usd=str(RESERVED_COST),billed_cost_usd=None))
