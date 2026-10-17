"""Real PostgreSQL operation ownership + synthetic HTTP (no paid inference)."""
import json
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest

from test_domain import context
from test_conversations import conversation, post
from test_general_responses import activate, Provider, worker, totals
from workagent.db import Database
from workagent.models import now
from workagent.provider_attempts import ReceiptCapability
from workagent.responses_ledger import observations
from workagent.responses_transport import ResponsesTransport
from workagent.service import Service, WorkerCapability


def steps(s, run_id):
    with s.db.transaction() as c:
        attempt=c.execute('SELECT id FROM provider_attempts WHERE run_id=%s',(run_id,)).fetchone()
        return observations(c,attempt['id'])


def test_exact_http_interval_is_live_without_generic_worker_heartbeat(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,[cv]); queued=post(context,cv,'Please answer.')
    fake=Provider(); w=worker(context,fake,tmp_path); original=fake.handle; seen=[]
    def inspect(request):
        state=steps(s,queued.run.id)[-1].state
        expected='counting' if request.url.path.endswith('input_tokens') else 'dispatching'
        assert state==expected
        assert s.get_conversation(p,ws,cv.id).turns[-1].provider_observation=='pending'
        seen.append(state)
        saved=w.phases.state.load(ws,queued.run.id)
        assert not s.yield_settled_responses_lease(WorkerCapability(**saved['worker']),ReceiptCapability(**saved['receipt']))
        return original(request)
    w.transport=w.phases.transport=ResponsesTransport.synthetic(httpx.MockTransport(inspect))
    for _ in range(4):
        if w.work(p,ws,queued.run.id).state=='ready':break
    assert s.get_run(p,ws,queued.run.id).state=='ready'
    assert seen==['counting','dispatching','counting','dispatching']
    assert all(step.state=='received' for step in steps(s,queued.run.id))


def test_failed_http_releases_interval_unknown_does_not_turn_into_live(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); grant=activate(context,[cv]); queued=post(context,cv,'Please answer.')
    fake=Provider(lose_id=True); w=worker(context,fake,tmp_path)
    w.work(p,ws,queued.run.id)
    assert steps(s,queued.run.id)[-1].state=='outcome_unknown'
    before=totals(s,grant)
    worker(context,fake,tmp_path).work(p,ws,queued.run.id)
    assert totals(s,grant)==before
    assert len(fake.calls)==2


def test_returned_known_id_can_handoff_without_waiting_for_lease_expiry(context,tmp_path,monkeypatch):
    import workagent.responses_worker as module
    import workagent.service as service_module
    s,p,ws,_,_=context
    cv=conversation(context); grant=activate(context,[cv]); queued=post(context,cv,'Please answer.')
    fake=Provider(); w=worker(context,fake,tmp_path); original=fake.handle
    clock=[0.0]; origin=now(); pending=[True]
    monkeypatch.setattr(module,'time',SimpleNamespace(monotonic=lambda:clock[0],sleep=lambda _:None))
    monkeypatch.setattr(module,'now',lambda:origin+timedelta(seconds=clock[0]),raising=False)
    monkeypatch.setattr(service_module,'now',lambda:origin+timedelta(seconds=clock[0]))
    def asynchronous(request):
        response=original(request)
        if request.method=='POST' and request.url.path=='/v1/responses' and pending[0]:
            pending[0]=False; clock[0]+=30
            body=response.json(); body.update(status='in_progress',output=[],usage=None)
            return httpx.Response(200,json=body)
        return response
    w.transport=w.phases.transport=ResponsesTransport.synthetic(httpx.MockTransport(asynchronous))
    assert w.work(p,ws,queued.run.id).state=='running'
    first=s.get_run(p,ws,queued.run.id)
    assert first.lease_expires_at<=service_module.now()
    assert steps(s,queued.run.id)[-1].state=='accepted'
    before=len(fake.calls)
    restarted=worker((Service(Database()),*context[1:]),fake,tmp_path)
    restarted.transport=restarted.phases.transport=w.transport
    assert restarted.work(p,ws,queued.run.id).state=='ready'
    assert s.get_run(p,ws,queued.run.id).fence==first.fence+1
    assert fake.calls[before][0]=='GET'
    assert totals(s,grant)['request_counts']=={'count_send':2,'dispatch':2,'read':1,'cancel':0}
    assert len(s.get_conversation(p,ws,cv.id).messages)==2
