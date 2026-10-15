"""Readiness requires live dispatcher AND current authority, not an HTTP 200."""
import json
import os
import time
from types import SimpleNamespace as S
import pytest
from fastapi.testclient import TestClient
from test_domain import context, raises
from test_adaptive_execution import setup
from workagent.api import Settings, create_app
from workagent.execution_status import publish, heartbeat, classify, read
from workagent.responses_dispatcher import ResponsesDispatcher
from workagent.provider_attempts import revoke_grant
from workagent.db import Database
from workagent.service import Principal


def test_heartbeat_no_secrets_stale_wrong_workspace_and_dead_pid(tmp_path):
    path=tmp_path/'execution.json'
    publish(path,'ws','grant',authorized=True,run_id='run',status='visiting')
    assert heartbeat(path,'ws')['run_id']=='run'
    assert heartbeat(path,'other') is None
    assert path.stat().st_mode & 0o077==0
    d=json.loads(path.read_text());d['at']=time.time()-121;path.write_text(json.dumps(d))
    assert heartbeat(path,'ws') is None
    d['at']=time.time();d['pid']=999999999;path.write_text(json.dumps(d))
    assert heartbeat(path,'ws') is None


@pytest.mark.parametrize('run,steps,live,expected',[
    ('running',['accepted'],True,('awaiting_provider',None)),
    ('running',['count_unknown'],True,('blocked','unknown_external_outcome')),
    ('running',['invalid'],True,('blocked','invalid_response')),
    ('running',[],True,('recovering',None)),
    ('queued',[],False,('unavailable','worker_unavailable')),
    ('partial',['received'],True,('waiting_for_person',None)),
    ('ready',['received'],False,('completed',None)),
])
def test_status_categories(run,steps,live,expected):
    assert classify(S(state=run,id='run'),[S(state=s) for s in steps],live)==expected


def test_http_readiness_and_revocation_scope(context,tmp_path,monkeypatch):
    s,p,ws,_,admin=context
    cv,g,fake,q,w=setup(context,tmp_path)
    path=tmp_path/'execution.json';monkeypatch.setenv('WORKAGENT_EXECUTION_STATUS',str(path))
    token='synthetic-bearer-token-for-local-tests-only'
    app=create_app(Settings(os.environ['DATABASE_URL'],True,token,p.id))
    headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':'read-status'}
    with TestClient(app) as client:
        url=f'/v1/workspaces/{ws}/execution'
        assert client.get(url).status_code==401
        first=client.get(url,headers=headers)
        assert first.status_code==200 and not first.json()['can_advance_authorized_work']
        assert first.json()['runs'][0]['state']=='unavailable'
        publish(path,ws,g.id,authorized=True)
        live=client.get(url,headers=headers)
        assert live.status_code==200 and live.json()['can_advance_authorized_work'],live.text
        assert client.get('/v1/workspaces/not-member/execution',headers=headers).status_code==404
        raises('not_found_or_not_authorized',lambda:read(s,Principal('other-human'),ws,str(path)))
        revoke_grant(Database(admin),g.id)
        assert not client.get(url,headers=headers).json()['can_advance_authorized_work']


def test_dispatcher_records_progress_without_payload(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path)
    path=tmp_path/'execution.json'
    result=ResponsesDispatcher(w,workspace=ws,grant_id=g.id,status_path=path).once()
    h=heartbeat(path,ws)
    assert h['run_id']==q.run.id and h['status']==result['results'][0]['status']
    assert set(h)=={'workspace_id','grant_id','pid','consumer_sha256','at','authorized','run_id','status'}
    current=read(s,p,ws,str(path))
    assert current.can_advance_authorized_work
    assert current.runs[0].state=='waiting_for_person'


def test_quarantined_only_conversation_is_not_admission_capacity(context,tmp_path):
    from test_conversations import post
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,lose_phase='selection')
    path=tmp_path/'execution.json'
    d=ResponsesDispatcher(w,workspace=ws,grant_id=g.id,status_path=path)
    d.once();before=len(fake.calls);d.once()
    assert len(fake.calls)==before
    current=s.get_conversation(p,ws,cv.id).conversation
    raises('action_unresolved',lambda:post(context,current,'A different request'))
    status=read(s,p,ws,str(path))
    assert status.runs[0].failure_category=='unknown_external_outcome'
    assert not status.can_advance_authorized_work
    assert status.state=='blocked'


def test_retained_count_can_dispatch_without_another_count_slot(context,tmp_path):
    from test_general_alpha_runtime import activate, AlphaProvider
    from test_general_responses import worker, totals
    from test_conversations import conversation,post
    from test_runtime import expire
    s,p,ws,_,_=context
    cv=conversation(context)
    g=activate(context,cv,count_limit=1,generation_limit=1)
    fake=AlphaProvider([{'kind':'reply','text':'A useful answer.'}])
    q=post(context,cv,'Explain the tradeoff.')
    def interrupt(phase):
        if phase=='after_count':raise RuntimeError('synthetic interruption')
    w=worker(context,fake,tmp_path,hook=interrupt)
    with pytest.raises(RuntimeError):w.work(p,ws,q.run.id)
    expire(context,q.run.id)
    path=tmp_path/'execution.json';publish(path,ws,g.id,authorized=True)
    assert totals(s,g)['request_counts']=={'count_send':1,'dispatch':0,'read':0,'cancel':0}
    assert read(s,p,ws,str(path)).can_advance_authorized_work
    resumed=worker(context,fake,tmp_path)
    ResponsesDispatcher(resumed,workspace=ws,grant_id=g.id,status_path=path).once()
    counts=totals(s,g)['request_counts']
    assert counts['count_send']==1 and counts['dispatch']==1
    status=read(s,p,ws,str(path))
    assert status.runs[0].state=='blocked'
    assert status.runs[0].failure_category=='authority_or_budget'
    assert not status.can_advance_authorized_work


def test_canonical_blocked_is_not_a_human_review_wait(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,lie=True)
    path=tmp_path/'execution.json'
    result=ResponsesDispatcher(w,workspace=ws,grant_id=g.id,status_path=path).once()
    assert result['results'][0]['status']=='blocked'
    current=read(s,p,ws,str(path))
    assert current.runs[0].state=='blocked'
    assert current.runs[0].failure_category=='work_blocked'


def test_quarantine_does_not_stop_unrelated_authorized_conversation(context,tmp_path):
    from test_general_responses import activate,Provider,worker
    from test_conversations import conversation,post
    s,p,ws,_,_=context
    first=conversation(context);second=conversation(context)
    g=activate(context,[first,second])
    fake=Provider(lose_id=True);w=worker(context,fake,tmp_path)
    q=post(context,first,'First request, whose response will be lost.')
    path=tmp_path/'execution.json'
    d=ResponsesDispatcher(w,workspace=ws,grant_id=g.id,status_path=path)
    d.once()
    assert read(s,p,ws,str(path)).can_advance_authorized_work
    fake.lose_id=False
    other=post(context,second,'An unrelated authorized request.')
    result=d.once()
    statuses={r['run_id']:r['status'] for r in result['results']}
    assert statuses[q.run.id]=='outcome_unknown'
    assert statuses[other.run.id]=='completed'
    current=read(s,p,ws,str(path))
    states={r.run_id:r.state for r in current.runs}
    assert states[q.run.id]=='blocked' and states[other.run.id]=='completed'
