"""Real restricted PostgreSQL and synthetic transport; no provider requests."""
import json
from contextlib import contextmanager
from types import SimpleNamespace

import psycopg
import pytest

from test_domain import context, cmd
from test_responsibilities import conversation
from test_responsibility_execution import activate, dispatch
from workagent.db import Database
from workagent.models import PostMessage
from workagent.responses_dispatcher import serve


def test_empty_responsibility_scan_does_not_take_exclusive_workspace_lock(context, monkeypatch):
    s,p,ws,_,admin=context
    cv=conversation(context);g=activate(context,cv)
    transaction=s.db.transaction
    @contextmanager
    def short_lock_wait():
        with transaction() as c:
            c.execute("SET LOCAL lock_timeout='100ms'")
            yield c
    monkeypatch.setattr(s.db,'transaction',short_lock_wait)
    # Ordinary readers may overlap an empty scan. No mutation is being claimed.
    with Database(admin).transaction() as reader:
        reader.execute('SELECT id FROM workspaces WHERE id=%s FOR SHARE',(ws,))
        s.advance_responsibilities(ws,g.id)


@pytest.mark.parametrize('stage',['responsibilities','local'])
def test_scheduler_failure_does_not_block_an_independent_admitted_run(context,tmp_path,monkeypatch,caplog,stage):
    s,p,ws,_,_=context
    cv=conversation(context);g=activate(context,cv)
    posted=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Explain the supplied synthetic constraint.'))
    from test_general_alpha_runtime import AlphaProvider
    d,fake,w=dispatch(context,tmp_path,g,AlphaProvider([{'kind':'reply','text':'A short, source-free explanation.'}]))
    def unavailable(*args,**kwargs):raise psycopg.errors.QueryCanceled('SECRET SQL and parameters')
    if stage=='responsibilities':monkeypatch.setattr(s,'advance_responsibilities',unavailable)
    else:monkeypatch.setattr(d.local_dispatcher,'once',unavailable)
    result=d.once()
    assert result['results']==[{'run_id':posted.run.id,'status':'completed'}]
    assert result['responsibility_status' if stage=='responsibilities' else 'local_status']=='runtime_error'
    record=json.loads(caplog.records[-1].message)
    assert record['category']=='database_timeout'
    assert record['run_id'] is None
    assert 'SECRET' not in caplog.text


@pytest.mark.parametrize('fails_in',['verify','visit'])
def test_serving_loop_survives_transient_database_failure(monkeypatch,caplog,fails_in):
    import time
    class StopProbe(BaseException):pass
    calls=[];progress=[]
    def verify():
        calls.append('verify')
        if fails_in=='verify' and calls.count('verify')==1:
            raise psycopg.errors.QueryCanceled('SECRET statement')
    def once(**kwargs):
        calls.append('visit')
        if fails_in=='visit' and calls.count('visit')==1:
            raise psycopg.OperationalError('SECRET connection')
        raise StopProbe()
    monkeypatch.setattr(time,'sleep',lambda _:None)
    dispatcher=SimpleNamespace(once=once,progress=lambda **kw:progress.append(kw))
    with pytest.raises(StopProbe):serve(dispatcher,verify,0.1)
    assert calls.count('verify')==2
    assert progress==[{'authorized':fails_in=='visit','status':'runtime_error'}]
    assert 'SECRET' not in caplog.text
    assert json.loads(caplog.records[-1].message)['run_id'] is None


def test_structural_failure_exits_and_database_backoff_is_bounded(monkeypatch):
    import time
    pauses=[];visits=[];progress=[]
    def once():
        visits.append(True)
        if len(visits)<12:raise psycopg.OperationalError('synthetic connection failure')
        raise TypeError('synthetic programming defect')
    monkeypatch.setattr(time,'sleep',pauses.append)
    d=SimpleNamespace(once=once,progress=lambda **kw:progress.append(kw))
    with pytest.raises(TypeError):serve(d,lambda:None,1)
    assert len(visits)==12
    assert pauses==[2,4,8,16,32,60,60,60,60,60,60]
    assert all(p=={'authorized':True,'status':'runtime_error'} for p in progress)


def test_local_failure_is_visible_even_without_model_results(monkeypatch,capsys):
    import time
    class StopProbe(BaseException):pass
    def stop(_):raise StopProbe()
    monkeypatch.setattr(time,'sleep',stop)
    d=SimpleNamespace(once=lambda:{'local':{},'results':[],'local_status':'runtime_error'})
    with pytest.raises(StopProbe):serve(d,lambda:None,0.1)
    assert json.loads(capsys.readouterr().out)['local_status']=='runtime_error'


def test_runtime_failure_is_unavailable_without_falsely_revoking_authority(context,tmp_path):
    from test_adaptive_execution import setup
    from workagent.execution_status import publish,heartbeat,read
    s,p,ws,_,_=context
    cv,g,_,_,_=setup(context,tmp_path)
    path=tmp_path/'execution.json'
    publish(path,ws,g.id,authorized=True,status='runtime_error')
    assert heartbeat(path,ws)['authorized'] is True
    result=read(s,p,ws,str(path))
    assert result.state=='unavailable' and not result.can_advance_authorized_work
    publish(path,ws,g.id,authorized=True)
    assert read(s,p,ws,str(path)).can_advance_authorized_work


def test_transient_postclaim_failure_preserves_bounded_wake_recovery(context,tmp_path,monkeypatch):
    from test_responsibility_execution import setup,edit,admitted
    from workagent.models import now
    from datetime import datetime
    s,p,ws,_,admin=context
    cv,art,a,g,_=setup(context)
    edit(context,art)
    d,_,_=dispatch(context,tmp_path,g)
    original=s.continue_responsibility
    def unavailable(*args,**kwargs):raise psycopg.errors.QueryCanceled('synthetic pre-admission timeout')
    monkeypatch.setattr(s,'continue_responsibility',unavailable)
    assert d.once()['responsibility_status']=='runtime_error'
    assert admitted(s,ws)==[]
    with Database(admin).transaction() as c:
        lease=c.execute('SELECT responsibility_lease FROM assignments WHERE workspace_id=%s AND id=%s',(ws,a.id)).fetchone()['responsibility_lease']
        assert 0<(datetime.fromisoformat(lease['expires_at'])-now()).total_seconds()<=30
        # Controlled clock advancement, never a production lease bypass.
        c.execute("UPDATE assignments SET responsibility_lease=jsonb_set(responsibility_lease,'{expires_at}',to_jsonb((now()-interval '1 second')::text)) WHERE workspace_id=%s AND id=%s",(ws,a.id))
    monkeypatch.setattr(s,'continue_responsibility',original)
    d.once();assert len(admitted(s,ws))==1
    d.once();assert len(admitted(s,ws))==1
