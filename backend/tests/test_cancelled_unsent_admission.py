"""A cancelled prepared-only attempt is history, not an unknown external send."""
import httpx
import pytest
from test_domain import context
from test_responsibility_execution import setup, edit, admitted, answer, SequenceProvider
from test_general_responses import worker, totals
from workagent.general_responses import has_unresolved_attempt
from workagent.responses_ledger import Ledger
from workagent.responses_dispatcher import ResponsesDispatcher


def journal(s,ws,rid):
    with s.db.transaction() as c:
        attempt=c.execute('SELECT * FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchone()
        aid=attempt['id']
        return (attempt,
            c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s',(aid,)).fetchall(),
            c.execute('SELECT * FROM responses_events WHERE attempt_id=%s ORDER BY id',(aid,)).fetchall())


@pytest.mark.parametrize('boundary',['prepared_only','prepared_step','count_reserved','unknown_send'])
def test_human_edit_cancelled_attempt_only_releases_provably_unsent_admission(context,tmp_path,monkeypatch,boundary):
    s,p,ws,_,_=context
    cv,art,a,g,life=setup(context)
    edit(context,art)
    s.advance_responsibilities(ws,g.id)
    rows=admitted(s,ws); assert len(rows)==1
    rid=rows[0]['run_id']
    fake=SequenceProvider([answer]); w=worker(context,fake,tmp_path)
    w.phases.transport._client.timeout=httpx.Timeout(.5)
    def crash(*args,**kwargs):raise RuntimeError('synthetic stop before external I/O')
    with monkeypatch.context() as patch:
        if boundary in ('prepared_only','prepared_step'):
            prepare=Ledger.prepare
            def stop(self,*args,**kwargs):
                if boundary=='prepared_step':prepare(self,*args,**kwargs)
                crash()
            patch.setattr(Ledger,'prepare',stop)
        elif boundary=='count_reserved':
            patch.setattr(w.transport,'count',crash)
        else:
            def hook(name):
                if name=='after_predispatch':crash()
            w.phases.hook=hook
        with pytest.raises(RuntimeError,match='synthetic stop'):w.work(p,ws,rid)
    before=journal(s,ws,rid)
    if boundary=='prepared_only':
        assert before[0]['data']['state']=='prepared' and before[1:]==([],[])
    elif boundary=='count_reserved':
        assert [e['kind'] for e in before[2]]==['count_send']
    with s.db.transaction() as c:
        assert has_unresolved_attempt(c,ws,cv.id)  # Prepared but LIVE is never bypassed.
    counts=totals(s,g); calls=list(fake.calls)
    edit(context,art,'Human edit cancels the stale continuation, without sending it.')
    s.reconcile_responsibility(p,ws,a.id)
    assert s.get_run(p,ws,rid).state=='cancelled'
    assert journal(s,ws,rid)==before and totals(s,g)==counts
    with s.db.transaction() as c:
        assert has_unresolved_attempt(c,ws,cv.id)==(boundary!='prepared_only')
    s.advance_responsibilities(ws,g.id)
    assert journal(s,ws,rid)==before and fake.calls==calls
    rows=admitted(s,ws)
    if boundary=='prepared_only':
        assert len(rows)==2  # Actual SQL config + runtime-message guards accepted.
        new=next(r for r in rows if r['run_id']!=rid)
        assert new['data']['state']=='queued'
        assert new['config']['responsibility']['assignment_id']==a.id
        resumed=worker(context,fake,tmp_path); resumed.phases.transport._client.timeout=httpx.Timeout(.5)
        d=ResponsesDispatcher(resumed,workspace=ws,grant_id=g.id)
        for _ in range(5):
            d.once()
            if s.get_run(p,ws,new['run_id']).state=='ready':break
        assert s.get_run(p,ws,new['run_id']).state=='ready'
        assert journal(s,ws,rid)==before
    else:
        assert len(rows)==1
