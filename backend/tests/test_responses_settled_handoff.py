"""Only settled synchronous work may hand its fenced lease back early."""
import pytest
from test_domain import context
from test_responses_leases import setup_family,visit
from test_general_responses import totals
from workagent.models import now
from workagent.service import WorkerCapability
from workagent.errors import DomainError


@pytest.mark.parametrize('family',['intake','general','adaptive'])
def test_slow_count_hands_off_and_reuses_exact_count(context,tmp_path,monkeypatch,family):
    from datetime import timedelta
    from types import SimpleNamespace
    import httpx
    import workagent.responses_worker as worker_module
    import workagent.service as service_module
    import workagent.provider_attempts as attempts_module
    from workagent.responses_ledger import RESERVED_INPUT,RESERVED_OUTPUT,RESERVED_COST
    s,p,ws,_,_=context;g,q,fake,w,phases=setup_family(context,tmp_path,family)
    origin=now();clock=[0.0]
    current=lambda:origin+timedelta(seconds=clock[0])
    monkeypatch.setattr(worker_module,'time',SimpleNamespace(monotonic=lambda:clock[0],sleep=lambda _:None))
    for module in (worker_module,service_module,attempts_module):
        monkeypatch.setattr(module,'now',current)
    # Use production timeouts: the returned count consumes the admission window,
    # while 90 seconds of the original lease remain. No expiry helper is used.
    phases.transport._client.timeout=httpx.Timeout(30.0,connect=5.0)
    count=phases.transport.count;created=[];create=phases.transport.create
    def slow_count(request):
        result=count(request);clock[0]+=30
        return result
    def capture_create(request,**kwargs):
        created.append((request,kwargs['count']))
        return create(request,**kwargs)
    monkeypatch.setattr(phases.transport,'count',slow_count)
    monkeypatch.setattr(phases.transport,'create',capture_create)
    # Bound this regression to the counted selection; final generation is separate.
    step=phases._step
    monkeypatch.setattr(phases,'_step',lambda ledger,request,*args,**kwargs:
        None if request.phase=='final' else step(ledger,request,*args,**kwargs))
    visit(context,w,q.run.id)
    parked=s.get_run(p,ws,q.run.id)
    assert parked.state=='running' and parked.lease_expires_at<=current()
    assert totals(s,g)['request_counts']=={'count_send':1,'dispatch':0,'read':0,'cancel':0}
    saved=phases.state.load(ws,q.run.id);old=WorkerCapability(**saved['worker'])
    attempt=saved['receipt']['attempt_id']
    def retained():
        with s.db.transaction() as c:
            request=c.execute("SELECT * FROM responses_steps WHERE attempt_id=%s AND phase='selection'",(attempt,)).fetchone()
            count_event=c.execute("SELECT * FROM responses_events WHERE attempt_id=%s AND phase='selection' AND kind='count_result'",(attempt,)).fetchone()
        return request,count_event
    request,count_event=retained()
    with pytest.raises(DomainError):
        with s.db.transaction() as c:s._check_capability(c,old)
    visit(context,w,q.run.id)
    resumed=s.get_run(p,ws,q.run.id)
    assert resumed.fence==old.fence+1 and resumed.lease_expires_at>current()
    assert phases.state.load(ws,q.run.id)['receipt']==saved['receipt']
    assert retained()==(request,count_event)
    assert len(created)==1 and created[0][0].sha256==request['request_sha256']
    assert created[0][0].body.decode()==request['request_bytes']
    assert created[0][0].count_body().decode()==request['count_bytes']
    assert created[0][1].request_sha256==count_event['data']['request_sha256']
    assert created[0][1].count_sha256==count_event['data']['count_sha256']
    assert created[0][1].input_tokens==count_event['data']['input_tokens']
    assert len(fake.calls)==2  # One synthetic count and one generation send.
    counts=totals(s,g)
    assert counts['request_counts']=={'count_send':1,'dispatch':1,'read':0,'cancel':0}
    assert counts['reserved_input_tokens']==RESERVED_INPUT
    assert counts['reserved_output_tokens']==RESERVED_OUTPUT
    assert counts['reserved_cost_usd']==str(RESERVED_COST)
    with pytest.raises(DomainError):
        with s.db.transaction() as c:s._check_capability(c,old)
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM audit WHERE workspace_id=%s AND object_id=%s AND operation='yield_settled_responses_lease'",(ws,q.run.id)).fetchone()['n']==1


@pytest.mark.parametrize('fault',['unknown_count','unknown_generation','revoked',
    'active_count_send','active_dispatch','active_read','active_cancel'])
def test_count_handoff_keeps_unsettled_or_unauthorized_lease(context,tmp_path,monkeypatch,fault):
    from contextlib import nullcontext
    from workagent.db import Database
    from workagent.provider_attempts import ReceiptCapability,revoke_grant
    from workagent.responses_ledger import Ledger
    from workagent.responses_io import interval
    s,p,ws,_,owner=context;g,q,fake,w,phases=setup_family(context,tmp_path,'general')
    def interrupt(name):
        if name==('after_predispatch' if fault=='unknown_generation' else 'after_count'):
            raise RuntimeError('synthetic interruption')
    phases.hook=interrupt
    if fault=='unknown_count':
        def lost_count(request):raise RuntimeError('synthetic interruption')
        monkeypatch.setattr(phases.transport,'count',lost_count)
    with pytest.raises(RuntimeError,match='synthetic interruption'):visit(context,w,q.run.id)
    saved=phases.state.load(ws,q.run.id)
    cap=WorkerCapability(**saved['worker']);receipt=ReceiptCapability(**saved['receipt'])
    ledger=Ledger(s,receipt);request,events=ledger.snapshot('selection',cap)
    assert ('count_result' in events)==(fault!='unknown_count')
    if fault=='revoked':revoke_grant(Database(owner),g.id)
    before=s.get_run(p,ws,q.run.id);counts=totals(s,g);calls=list(fake.calls)
    guard=interval(ledger,request,fault.removeprefix('active_'),cap) if fault.startswith('active_') else nullcontext()
    with guard:
        if fault=='revoked':
            with pytest.raises(DomainError):s.yield_settled_responses_lease(cap,receipt)
        else:assert s.yield_settled_responses_lease(cap,receipt) is False
        monkeypatch.setattr(phases,'_http_window',lambda *args,**kwargs:False)
        assert phases._yield_if_settled(ws,q.run.id) is False
    assert s.get_run(p,ws,q.run.id)==before and before.lease_expires_at>now()
    assert totals(s,g)==counts and fake.calls==calls


@pytest.mark.parametrize('family',['intake','general','adaptive'])
def test_settled_phase_handoff_resumes_without_waiting_or_resending(context,tmp_path,monkeypatch,family):
    s,p,ws,_,_=context;grant,queued,fake,w,phases=setup_family(context,tmp_path,family)
    closed=[False];original=phases._http_window
    phases.hook=lambda name:closed.__setitem__(0,True) if name=='after_response' else None
    monkeypatch.setattr(phases,'_http_window',lambda *args,**kwargs:False if closed[0] else original(*args,**kwargs))
    visit(context,w,queued.run.id)
    parked=s.get_run(p,ws,queued.run.id)
    assert parked.state=='running' and parked.lease_expires_at<=now()
    before=totals(s,grant)['request_counts']
    assert before['count_send']==before['dispatch']==1
    old=WorkerCapability(**phases.state.load(ws,queued.run.id)['worker'])
    with pytest.raises(DomainError):
        with s.db.transaction() as c:s._check_capability(c,old)
    with pytest.raises(DomainError):s.claim_run(p,ws,queued.run.id)  # Receipt still required.
    closed[0]=False;phases.hook=None
    visit(context,w,queued.run.id)
    final=s.get_run(p,ws,queued.run.id)
    assert final.state in ('ready','partial') and final.fence==parked.fence+1
    assert totals(s,grant)['request_counts']=={'count_send':2,'dispatch':2,'read':0,'cancel':0}
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM provider_attempts WHERE workspace_id=%s AND run_id=%s",(ws,queued.run.id)).fetchone()['n']==1
        assert c.execute("SELECT count(*) n FROM audit WHERE workspace_id=%s AND object_id=%s AND operation='yield_settled_responses_lease'",(ws,queued.run.id)).fetchone()['n']==1


@pytest.mark.parametrize('fault',['pending','lost_id','count_problem','malformed'])
def test_final_handoff_distinguishes_known_pending_from_unsettled(context,tmp_path,monkeypatch,fault):
    import json
    import httpx
    from test_conversations import conversation,post
    from test_general_responses import activate,Provider,worker
    from workagent.provider_attempts import ReceiptCapability
    class Fault(Provider):
        def handle(self,request):
            body=json.loads(request.content) if request.content else {}
            final=body.get('tool_choice')=='none'
            if final and fault=='count_problem' and request.url.path.endswith('/input_tokens'):
                self.calls.append((request.method,request.url.path))
                return httpx.Response(503,json={'error':{'message':'synthetic'}})
            self.lose_id=final and fault=='lost_id' and request.url.path.endswith('/responses')
            response=super().handle(request)
            if final and request.url.path.endswith('/responses') and fault in ('pending','malformed'):
                data=response.json();data['output']=[]
                if fault=='pending':data['status']='queued'
                return httpx.Response(200,json=data)
            return response
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,[cv]);fake=Fault()
    w=worker(context,fake,tmp_path);w.phases.poll_limit=0
    q=post(context,cv,'A synthetic settled first phase and unfinished final.')
    assert w.work(p,ws,q.run.id).state=='running'
    before=s.get_run(p,ws,q.run.id);counts=totals(s,g);calls=list(fake.calls)
    saved=w.phases.state.load(ws,q.run.id)
    cap=WorkerCapability(**saved['worker']);receipt=ReceiptCapability(**saved['receipt'])
    if fault=='pending':
        # Returned HTTP plus a durable response ID is settled local I/O, not an
        # unknown send. Retire the old fence, then GET that exact response once.
        with s.db.transaction() as c:
            identity=c.execute("SELECT data FROM responses_events WHERE attempt_id=%s "
                               "AND phase='final' AND kind='identity'",(receipt.attempt_id,)).fetchone()['data']
        assert s.yield_settled_responses_lease(cap,receipt) is True
        with pytest.raises(DomainError):
            with s.db.transaction() as c:s._check_capability(c,cap)
        assert fake.calls==calls and totals(s,g)==counts
        w.phases.poll_limit=1
        assert w.work(p,ws,q.run.id).state=='ready'
        assert fake.calls[len(calls):]==[('GET','/v1/responses/'+identity['response_id'])]
        assert totals(s,g)['request_counts']==dict(counts['request_counts'],read=1)
        assert s.get_run(p,ws,q.run.id).fence==cap.fence+1
        with s.db.transaction() as c:
            rows=c.execute('SELECT id FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchall()
        assert [row['id'] for row in rows]==[receipt.attempt_id]
        return
    assert s.yield_settled_responses_lease(cap,receipt) is False
    monkeypatch.setattr(w.phases,'_http_window',lambda *args,**kwargs:False)
    assert w.phases._yield_if_settled(ws,q.run.id) is False
    assert s.get_run(p,ws,q.run.id)==before and before.lease_expires_at>now()
    assert fake.calls==calls and totals(s,g)==counts


@pytest.mark.parametrize('mutation',['wrong_worker','wrong_receipt','cross_workspace','expired','revoked','viewer','paused'])
def test_handoff_rechecks_exact_current_authority(context,tmp_path,monkeypatch,mutation):
    from dataclasses import replace
    from test_domain import cmd
    from test_runtime import expire
    from workagent.db import Database
    from workagent.models import ControlAssignment
    from workagent.provider_attempts import ReceiptCapability,revoke_grant
    s,p,ws,_,_=context;g,q,fake,w,phases=setup_family(context,tmp_path,'intake' if mutation=='paused' else 'general')
    original=phases._step
    monkeypatch.setattr(phases,'_step',lambda ledger,request,*args,**kwargs:
        None if request.phase=='final' else original(ledger,request,*args,**kwargs))
    visit(context,w,q.run.id)
    saved=phases.state.load(ws,q.run.id)
    cap=WorkerCapability(**saved['worker']);receipt=ReceiptCapability(**saved['receipt'])
    if mutation=='wrong_worker':cap=replace(cap,secret='invalid')
    elif mutation=='wrong_receipt':receipt=replace(receipt,secret='invalid')
    elif mutation=='cross_workspace':receipt=replace(receipt,workspace_id=ws+'-other')
    elif mutation=='expired':expire(context,q.run.id)
    elif mutation=='revoked':revoke_grant(Database(context[4]),g.id)
    elif mutation=='viewer':
        with Database(context[4]).transaction() as c:c.execute("UPDATE memberships SET role='viewer' WHERE workspace_id=%s AND principal_id=%s",(ws,p.id))
    elif mutation=='paused':
        a=s.get_assignment(p,ws,q.run.assignment_id)
        s.control_assignment(p,ws,a.id,cmd(ControlAssignment,expected_work_version=a.work_version,operation='pause'))
    with s.db.transaction() as c:
        before=c.execute('SELECT data,lease_hash FROM runs WHERE workspace_id=%s AND id=%s',(ws,q.run.id)).fetchone()
    with pytest.raises(DomainError):s.yield_settled_responses_lease(cap,receipt)
    with s.db.transaction() as c:
        assert c.execute('SELECT data,lease_hash FROM runs WHERE workspace_id=%s AND id=%s',(ws,q.run.id)).fetchone()==before


@pytest.mark.parametrize('family',['intake','general','adaptive'])
def test_crash_after_response_never_runs_handoff(context,tmp_path,family):
    s,p,ws,_,_=context;g,q,fake,w,phases=setup_family(context,tmp_path,family)
    def crash(name):
        if name=='after_response':raise RuntimeError('synthetic interrupted visit')
    phases.hook=crash
    with pytest.raises(RuntimeError,match='synthetic interrupted visit'):visit(context,w,q.run.id)
    assert s.get_run(p,ws,q.run.id).lease_expires_at>now()
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM audit WHERE workspace_id=%s AND object_id=%s AND operation='yield_settled_responses_lease'",(ws,q.run.id)).fetchone()['n']==0


def test_handoff_uses_actual_reservation_margin(context,tmp_path,monkeypatch):
    import time
    from datetime import timedelta
    import workagent.responses_worker as module
    s,p,ws,_,_=context;g,q,fake,w,phases=setup_family(context,tmp_path,'general')
    original=phases._step
    monkeypatch.setattr(phases,'_step',lambda ledger,request,*args,**kwargs:
        None if request.phase=='final' else original(ledger,request,*args,**kwargs))
    visit(context,w,q.run.id)
    run=s.get_run(p,ws,q.run.id);allowance=sum(phases.transport._client.timeout.as_dict().values())+5
    # A real HTTP window in the reservation-only five-second band, not a
    # fabricated ready=False result. Domain authority still uses its real clock.
    clock=run.lease_expires_at-timedelta(seconds=allowance+5)
    monkeypatch.setattr(module,'now',lambda:clock)
    assert phases._http_window(run,time.monotonic()+90)
    assert not phases._http_window(run,time.monotonic()+90,handoff=True)
    assert phases._yield_if_settled(ws,q.run.id) is True
    assert s.get_run(p,ws,q.run.id).lease_expires_at<=now()


def test_workspace_lock_serializes_operator_revocation(context,tmp_path,monkeypatch):
    import time
    from threading import Event
    from concurrent.futures import ThreadPoolExecutor
    from workagent.db import Database
    from workagent.provider_attempts import ReceiptCapability
    s,p,ws,_,owner=context;g,q,fake,w,phases=setup_family(context,tmp_path,'general')
    original=phases._step
    monkeypatch.setattr(phases,'_step',lambda ledger,request,*args,**kwargs:
        None if request.phase=='final' else original(ledger,request,*args,**kwargs))
    visit(context,w,q.run.id)
    saved=phases.state.load(ws,q.run.id)
    cap=WorkerCapability(**saved['worker']);receipt=ReceiptCapability(**saved['receipt'])
    before=s.get_run(p,ws,q.run.id);started=Event();pids=[];check=s._check_capability
    def observed(c,worker):
        pids.append(c.info.backend_pid);started.set();return check(c,worker)
    monkeypatch.setattr(s,'_check_capability',observed)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with Database(owner).transaction() as c:
            # Same lock/update order as operator-only revoke_grant.
            c.execute('SELECT id FROM workspaces WHERE id=%s FOR UPDATE',(ws,))
            future=pool.submit(s.yield_settled_responses_lease,cap,receipt)
            assert started.wait(3)
            deadline=time.monotonic()+1;blocked=False
            while time.monotonic()<deadline:
                blocked=c.execute('SELECT %s=ANY(pg_blocking_pids(%s)) blocked',(c.info.backend_pid,pids[0])).fetchone()['blocked']
                if blocked:break
                time.sleep(.01)
            assert blocked and not future.done()
            c.execute('UPDATE provider_grants SET active=false WHERE id=%s',(g.id,))
        with pytest.raises(DomainError):future.result(timeout=5)
    assert s.get_run(p,ws,q.run.id)==before
