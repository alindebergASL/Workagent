"""Diagnostic readback never changes request identity or grants retry authority."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from test_domain import context
from test_conversations import conversation, post
from test_general_responses import activate, Provider, worker, totals
from test_general_responses_blockers import raw_turn, events
from test_runtime import expire
from workagent.api import Settings, create_app
from workagent.errors import DomainError
from workagent.execution_status import read, publish
from workagent.responses_dispatcher import ResponsesDispatcher
from workagent.responses_transport import TransportError


def setup(ctx, tmp_path):
    s,p,ws,_,_=ctx
    first=conversation(ctx); second=conversation(ctx)
    g=activate(ctx,[first,second]); fake=Provider()
    q=post(ctx,first,'Keep this exact request.')
    w=worker(ctx,fake,tmp_path)
    path=tmp_path/'execution.json'
    return first,second,g,fake,q,w,path


def retained(s,ws,rid):
    with s.db.transaction() as c:
        return {
            'context':c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchone(),
            'requests':c.execute('SELECT s.* FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id WHERE a.run_id=%s ORDER BY phase',(rid,)).fetchall(),
            'events':events(s,rid),
            'admission':c.execute('SELECT cursor,workspace_id,run_id,outbox_id,acknowledged_at FROM run_dispatches WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchone(),
        }


def run_status(s,p,ws,path,rid):
    return next(r for r in read(s,p,ws,str(path)).runs if r.run_id==rid)


def interrupt_known_id(w):
    def interrupt(name):
        if name=='after_response':raise RuntimeError('private interrupted response')
    w.phases.hook=interrupt


def test_genuine_source_drift_visible_after_other_run_and_restart(context,tmp_path):
    s,p,ws,_,_=context
    first,second,g,fake,q,w,path=setup(context,tmp_path)
    interrupt_known_id(w)
    with pytest.raises(RuntimeError):w.work(p,ws,q.run.id)
    # Change canonical current context, without superseding/cancelling the old
    # request. The actual worker must deny it before any additional provider I/O.
    raw_turn(s,ws,q)
    before=retained(s,ws,q.run.id); calls=list(fake.calls); budget=totals(s,g)
    resumed=worker(context,fake,tmp_path)
    d=ResponsesDispatcher(resumed,workspace=ws,grant_id=g.id,status_path=path)
    result=d.once()
    assert result['results'][0]['reason']=='source_changed'
    assert fake.calls==calls and totals(s,g)==budget
    assert retained(s,ws,q.run.id)==before
    status=run_status(s,p,ws,path,q.run.id)
    assert status.state=='blocked' and status.failure_category=='work_blocked'
    assert status.failure_reason=='source_changed'
    assert 'Review' in status.next_action
    assert not read(s,p,ws,str(path)).runs[0].state=='awaiting_provider'
    other=post(context,second,'An unrelated request must finish.')
    for _ in range(5):
        d.once()
        if s.get_run(p,ws,other.run.id).state=='ready':break
    assert s.get_run(p,ws,other.run.id).state=='ready'
    assert run_status(s,p,ws,path,other.run.id).state=='completed'
    # Last heartbeat belongs to a different run, and a restart erases no denial.
    publish(path,ws,g.id,authorized=True)
    assert run_status(s,p,ws,path,q.run.id).failure_reason=='source_changed'
    assert retained(s,ws,q.run.id)==before
    assert before['admission']['acknowledged_at'] is None


@pytest.mark.parametrize('reason',['source_changed','not_found_or_not_authorized','budget_exhausted','unsupported_operation'])
def test_safe_http_reason_and_recovery_of_same_known_id(context,tmp_path,monkeypatch,reason):
    s,p,ws,_,_=context
    first,second,g,fake,q,w,path=setup(context,tmp_path)
    public_reason='authority_unavailable' if reason=='unsupported_operation' else reason
    def denial(name):
        if name=='after_response':
            raise DomainError(reason,current_version=987654321)
    w.phases.hook=denial
    d=ResponsesDispatcher(w,workspace=ws,grant_id=g.id,status_path=path)
    d.once()
    before=retained(s,ws,q.run.id)
    assert before['admission']['acknowledged_at'] is None
    monkeypatch.setenv('WORKAGENT_EXECUTION_STATUS',str(path))
    import os
    token='synthetic-status-test-token-local-only'
    app=create_app(Settings(os.environ['DATABASE_URL'],True,token,p.id))
    headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':'safe-status'}
    with TestClient(app) as client:
        response=client.get(f'/v1/workspaces/{ws}/execution',headers=headers)
        assert response.status_code==200
        row=next(r for r in response.json()['runs'] if r['run_id']==q.run.id)
        assert row['state']=='blocked' and row['failure_reason']==public_reason and row['next_action']
        assert '987654321' not in response.text and 'private' not in response.text
        assert client.get('/v1/workspaces/not-member/execution',headers=headers).status_code==404
    # Contention / unresolved authority isn't successful recovery and must not
    # erase an earlier actionable denial. Nor may private transport text leak.
    for error in (BlockingIOError(),DomainError('action_unresolved'),TransportError('PRIVATE_PROVIDER_DETAIL')):
        def fail(*args,**kwargs):raise error
        with monkeypatch.context() as patch:
            patch.setattr(w,'work',fail)
            result=d.once()
            assert 'PRIVATE_PROVIDER_DETAIL' not in json.dumps(result)
        assert run_status(s,p,ws,path,q.run.id).failure_reason==public_reason
    # A compatible code-only correction uses the existing known ID; no reset,
    # request rewrite, new admission or duplicate selection generation.
    expire(context,q.run.id)
    resumed=worker(context,fake,tmp_path)
    d=ResponsesDispatcher(resumed,workspace=ws,grant_id=g.id,status_path=path)
    for _ in range(5):
        d.once()
        with s.db.transaction() as c:
            assert c.execute('SELECT failure_reason FROM run_dispatches WHERE workspace_id=%s AND run_id=%s',
                (ws,q.run.id)).fetchone()['failure_reason'] is None
        if s.get_run(p,ws,q.run.id).state=='ready':break
    status=run_status(s,p,ws,path,q.run.id)
    assert status.state=='completed'
    assert status.failure_category is None and status.failure_reason is None and status.next_action is None
    assert totals(s,g)['request_counts']=={'count_send':2,'dispatch':2,'read':1,'cancel':0}
    after=retained(s,ws,q.run.id)
    assert after['context']==before['context']
    assert all(r in after['requests'] for r in before['requests'])
    assert all(e in after['events'] for e in before['events'])
    assert after['admission']['cursor']==before['admission']['cursor']


def test_blocked_known_id_is_not_read_capacity(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); g=activate(context,[cv],max_runs=1)
    fake=Provider(); q=post(context,cv,'One admitted request.')
    w=worker(context,fake,tmp_path); interrupt_known_id(w)
    with pytest.raises(RuntimeError):w.work(p,ws,q.run.id)
    def deny(*args,**kwargs):raise DomainError('source_changed')
    w.work=deny
    path=tmp_path/'execution.json'
    ResponsesDispatcher(w,workspace=ws,grant_id=g.id,status_path=path).once()
    status=read(s,p,ws,str(path))
    assert status.state=='blocked' and not status.can_advance_authorized_work
    assert status.runs[0].failure_reason=='source_changed'
    # A stopped worker does not hide a durable actionable denial.
    path.unlink()
    assert run_status(s,p,ws,path,q.run.id).failure_reason=='source_changed'


def test_revoked_authority_and_unknown_send_keep_canonical_precedence(context,tmp_path):
    from workagent.db import Database
    from workagent.provider_attempts import revoke_grant
    from workagent.execution_status import record_dispatch_failure
    s,p,ws,_,admin=context
    first,second,g,fake,q,w,path=setup(context,tmp_path)
    interrupt_known_id(w)
    with pytest.raises(RuntimeError):w.work(p,ws,q.run.id)
    before=retained(s,ws,q.run.id); calls=list(fake.calls)
    revoke_grant(Database(admin),g.id)
    d=ResponsesDispatcher(w,workspace=ws,grant_id=g.id,status_path=path)
    d.once()
    status=run_status(s,p,ws,path,q.run.id)
    assert status.state=='blocked' and status.failure_reason=='authority_unavailable'
    assert not read(s,p,ws,str(path)).can_advance_authorized_work
    assert fake.calls==calls and retained(s,ws,q.run.id)==before

    # A separate active grant with an unknown-send reservation remains quarantined,
    # even when an earlier diagnostic says source_changed. No worker reentry.
    third=conversation(context); other_grant=activate(context,[third])
    other=post(context,third,'Unknown send.')
    lost=Provider(lose_id=True); other_worker=worker(context,lost,tmp_path/'other')
    other_worker.work(p,ws,other.run.id)
    record_dispatch_failure(s.db,ws,other.run.id,'source_changed',datetime.now(timezone.utc))
    publish(path,ws,other_grant.id,authorized=True)
    status=run_status(s,p,ws,path,other.run.id)
    assert status.failure_category=='unknown_external_outcome' and status.failure_reason is None
    before=retained(s,ws,other.run.id); calls=list(lost.calls)
    for _ in range(2):
        ResponsesDispatcher(other_worker,workspace=ws,grant_id=other_grant.id,status_path=path).once()
    assert lost.calls==calls and retained(s,ws,other.run.id)==before


def test_diagnostic_update_is_ordered_closed_and_not_admission_authority(context,tmp_path):
    import psycopg
    from workagent.execution_status import record_dispatch_failure
    s,p,ws,_,_=context
    first,second,g,fake,q,w,path=setup(context,tmp_path)
    before=retained(s,ws,q.run.id)
    old=datetime.now(timezone.utc); newer=old+timedelta(seconds=1)
    record_dispatch_failure(s.db,ws,q.run.id,'source_changed',old)
    record_dispatch_failure(s.db,ws,q.run.id,None,newer)
    record_dispatch_failure(s.db,ws,q.run.id,'source_changed',old)
    with s.db.transaction() as c:
        row=c.execute('SELECT failure_reason,failure_checked_at FROM run_dispatches WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()
    assert row=={'failure_reason':None,'failure_checked_at':newer}
    with pytest.raises(ValueError,match='invalid dispatch failure reason'):
        record_dispatch_failure(s.db,ws,q.run.id,'PRIVATE_EXCEPTION_TEXT',newer)
    with pytest.raises(psycopg.errors.CheckViolation):
        with s.db.transaction() as c:
            c.execute("UPDATE run_dispatches SET failure_reason='PRIVATE_EXCEPTION_TEXT' WHERE workspace_id=%s AND run_id=%s",(ws,q.run.id))
    with pytest.raises(psycopg.Error,match='immutable dispatch admission'):
        with s.db.transaction() as c:
            c.execute("UPDATE run_dispatches SET outbox_id='cannot-rebind' WHERE workspace_id=%s AND run_id=%s",(ws,q.run.id))
    assert retained(s,ws,q.run.id)==before and not fake.calls
