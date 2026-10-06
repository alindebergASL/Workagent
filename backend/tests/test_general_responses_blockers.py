"""R1/R2 regressions: real restricted PostgreSQL, synthetic HTTP only."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier

import psycopg
import pytest
from pydantic import ValidationError

from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_general_responses import activate, Provider, worker, attach, target, totals
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import HumanSave, ProviderGrant, CancelConversation, new_id
from workagent.provider_attempts import revoke_grant
from workagent.responses_ledger import Ledger
from workagent.service import encoded


def revision_turn(ctx, tmp_path):
    s,p,ws,_,_=ctx
    cv=conversation(ctx); grant=activate(ctx,[cv]); fake=Provider(); w=worker(ctx,fake,tmp_path)
    first=post(ctx,cv,'Reconcile CSV',attachments=[attach()])
    assert w.work(p,ws,first.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    art=s.get_artifact(p,ws,detail.messages[-1].result.results[1].artifact_id)
    q=post(ctx,detail.conversation,'Recalculate my saved CSV',target=target(art))
    def edit():
        body=art.current_revision.body.model_copy(deep=True); body.notes=['New human context']
        s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
    return grant,fake,w,q,art,edit


def events(s,rid):
    with s.db.transaction() as c:
        return c.execute('''SELECT e.id,e.phase,e.kind,e.data FROM responses_events e
            JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.id''',(rid,)).fetchall()


@pytest.mark.parametrize('point,occurrence',[
    ('after_tool_result',1),('after_predispatch',1),('after_predispatch',2),('after_count',1),('after_count',2)])
def test_drift_stops_all_subsequent_io_and_keeps_reservations(context,tmp_path,point,occurrence):
    s,p,ws,_,_=context; g,fake,w,q,art,edit=revision_turn(context,tmp_path)
    seen=[]; checkpoint=[]
    def hook(name):
        if name!=point:return
        seen.append(name)
        if len(seen)==occurrence:
            edit(); checkpoint.append((len(fake.calls),events(s,q.run.id),totals(s,g)['request_counts']))
    w.phases.hook=hook
    raises('version_conflict',lambda:w.work(p,ws,q.run.id))
    calls,journal,counts=checkpoint[0]
    assert len(fake.calls)==calls and events(s,q.run.id)==journal
    assert totals(s,g)['request_counts']==counts
    assert s.proposals(p,ws,art.id).items==[]
    raises('version_conflict',lambda:worker(context,fake,tmp_path).work(p,ws,q.run.id))
    assert len(fake.calls)==calls and events(s,q.run.id)==journal


def queue_final(w,monkeypatch):
    create=w.transport.create
    def queued(request,**kwargs):
        result=create(request,**kwargs)
        return replace(result,state='queued',value=None,usage=None) if request.phase=='final' else result
    monkeypatch.setattr(w.transport,'create',queued)


@pytest.mark.parametrize('kind',['count_send','dispatch','read'])
def test_exact_target_rechecked_after_committed_slot_before_io(context,tmp_path,monkeypatch,kind):
    s,p,ws,_,_=context; g,fake,w,q,art,edit=revision_turn(context,tmp_path)
    if kind=='read':queue_final(w,monkeypatch)
    reserve=Ledger.reserve_operation; checkpoint=[]
    def intercept(ledger,request,operation,cap):
        result=reserve(ledger,request,operation,cap)
        if request.phase=='final' and operation==kind:
            edit(); checkpoint.append((len(fake.calls),events(s,q.run.id),totals(s,g)['request_counts']))
        return result
    monkeypatch.setattr(Ledger,'reserve_operation',intercept)
    raises('version_conflict',lambda:w.work(p,ws,q.run.id))
    calls,journal,counts=checkpoint[0]
    assert len(fake.calls)==calls and events(s,q.run.id)==journal
    assert totals(s,g)['request_counts']==counts
    assert s.proposals(p,ws,art.id).items==[]


@pytest.mark.parametrize('kind',['count_send','dispatch','read'])
def test_raw_sql_stale_target_reservation_rejected(context,tmp_path,monkeypatch,kind):
    s,p,ws,_,_=context; g,fake,w,q,art,edit=revision_turn(context,tmp_path)
    if kind=='read':queue_final(w,monkeypatch)
    reserve=Ledger.reserve_operation; captured=[]
    def stop(ledger,request,operation,cap):
        if request.phase=='final' and operation==kind:
            captured.append(ledger.receipt.attempt_id)
            raise RuntimeError('stop before requested reservation')
        return reserve(ledger,request,operation,cap)
    monkeypatch.setattr(Ledger,'reserve_operation',stop)
    with pytest.raises(RuntimeError,match='stop before'):w.work(p,ws,q.run.id)
    edit(); before=events(s,q.run.id); calls=len(fake.calls)
    data={'reserved_input_tokens':20000,'reserved_output_tokens':8192,'reserved_cost_usd':'0.131920'} if kind=='dispatch' else {}
    with pytest.raises(psycopg.Error,match='exact current scoped publication target required'):
        with s.db.transaction() as c:
            c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,'final',%s,%s)",
                      (new_id(),captured[0],kind,encoded(data)))
    assert events(s,q.run.id)==before and len(fake.calls)==calls


@pytest.mark.parametrize('operation,retained',[('count','count_result'),('create','result'),('retrieve','result')])
def test_inflight_receipt_retained_after_target_drift(context,tmp_path,monkeypatch,operation,retained):
    s,p,ws,_,_=context; g,fake,w,q,art,edit=revision_turn(context,tmp_path)
    if operation=='retrieve':queue_final(w,monkeypatch)
    original=getattr(w.transport,operation); checkpoint=[]
    def inflight(*args,**kwargs):
        request=kwargs['request'] if operation=='retrieve' else args[0]
        if request.phase=='final':
            # The request has already been dispatched; its result must survive
            # loss of continuation authority, without another provider operation.
            edit()
            result=original(*args,**kwargs)
            checkpoint.append(len(fake.calls))
            return result
        return original(*args,**kwargs)
    monkeypatch.setattr(w.transport,operation,inflight)
    raises('version_conflict',lambda:w.work(p,ws,q.run.id))
    assert len(fake.calls)==checkpoint[0]
    assert any(e['phase']=='final' and e['kind']==retained for e in events(s,q.run.id))
    assert s.proposals(p,ws,art.id).items==[]
    journal=events(s,q.run.id)
    raises('version_conflict',lambda:worker(context,fake,tmp_path).work(p,ws,q.run.id))
    assert events(s,q.run.id)==journal and len(fake.calls)==checkpoint[0]


def raw_turn(s,ws,q,*,include_config=True,include_message=True,barrier=None):
    rid=new_id(); run=q.run.model_copy(update={'id':rid})
    message=q.message.model_copy(update={'id':new_id(),'run_id':rid,'sequence':q.message.sequence+1,'text':'Raw admitted turn'})
    with s.db.transaction() as c:
        c.execute('INSERT INTO runs(workspace_id,id,conversation_id,data) VALUES (%s,%s,%s,%s)',(ws,rid,run.conversation_id,encoded(run)))
        if barrier:barrier.wait(timeout=10)
        if include_config:
            config=c.execute('SELECT activation_id,data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()
            c.execute('INSERT INTO run_configurations(workspace_id,run_id,activation_id,data) VALUES (%s,%s,%s,%s)',
                      (ws,rid,config['activation_id'],encoded(config['data'])))
        if include_message:s._append_message(c,ws,message)
    return rid


def test_current_conversation_context_drift_stops_pre_io(context,tmp_path):
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,[cv]);q=post(context,cv,'Hello')
    fake=Provider();w=worker(context,fake,tmp_path);checkpoint=[]
    def change(name):
        if name=='after_predispatch' and not checkpoint:
            # A raw but bounded second admission does not call application
            # supersession. The old lease alone must not authorize stale context.
            raw_turn(s,ws,q)
            checkpoint.append((len(fake.calls),events(s,q.run.id)))
    w.phases.hook=change
    raises('source_changed',lambda:w.work(p,ws,q.run.id))
    calls,journal=checkpoint[0]
    assert len(fake.calls)==calls and events(s,q.run.id)==journal
    assert admitted(s,g)==2
    raises('source_changed',lambda:worker(context,fake,tmp_path).work(p,ws,q.run.id))
    assert len(fake.calls)==calls and events(s,q.run.id)==journal


def admitted(s,g):
    with s.db.transaction() as c:
        return c.execute("SELECT count(*) n FROM run_configurations WHERE data->>'grant_id'=%s",(g.id,)).fetchone()['n']


def no_attempts(s,ws,fake):
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM provider_attempts WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
    assert fake.calls==[]


@pytest.mark.parametrize('maximum',[1,4])
def test_cumulative_admission_api_sql_cancellation_and_revocation(context,tmp_path,maximum):
    s,p,ws,_,admin=context; cv=conversation(context); other=conversation(context)
    g=activate(context,[cv,other],max_runs=maximum); fake=Provider()
    for i in range(maximum):
        q=post(context,cv,'Unexecuted '+str(i));cv=q.conversation
    # Supersession has cancelled earlier turns, but never frees an admission.
    assert admitted(s,g)==maximum
    raises('budget_exhausted',lambda:post(context,other,'Cannot reset on second conversation'))
    with pytest.raises(psycopg.Error,match='cumulative general admission limit'):raw_turn(s,ws,q)
    s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=cv.work_version))
    raises('budget_exhausted',lambda:post(context,other,'Cancellation cannot reset'))
    assert revoke_grant(Database(admin),g.id)
    assert admitted(s,g)==maximum
    with pytest.raises(psycopg.Error,match='exact general admission authority required'):raw_turn(s,ws,q)
    # Restart/delivery cannot execute an unadmitted run lacking its configuration.
    rid=raw_turn(s,ws,q,include_config=False,include_message=False)
    with pytest.raises(DomainError):worker(context,fake,tmp_path).work(p,ws,rid)
    no_attempts(s,ws,fake)


def test_partial_raw_admission_without_human_message_cannot_execute(context,tmp_path):
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,[cv]);q=post(context,cv,'First')
    rid=raw_turn(s,ws,q,include_message=False); fake=Provider()
    raises('action_unresolved',lambda:worker(context,fake,tmp_path).work(p,ws,rid))
    assert admitted(s,g)==2  # Immutable reservation is not refunded.
    no_attempts(s,ws,fake)


@pytest.mark.parametrize('entry',['api','sql'])
def test_concurrent_admissions_serialize_at_four_across_two_conversations(context,tmp_path,entry):
    s,p,ws,_,_=context; cvs=[conversation(context),conversation(context)];g=activate(context,cvs)
    q1=post(context,cvs[0],'One');q2=post(context,cvs[1],'Two');q1=post(context,q1.conversation,'Three')
    barrier=Barrier(2)
    def admit(q):
        try:
            if entry=='sql':return raw_turn(s,ws,q,barrier=barrier)
            barrier.wait(timeout=10)
            return post(context,q.conversation,'Last slot').run.id
        except DomainError as exc:
            assert exc.code.value=='budget_exhausted';return None
        except psycopg.Error as exc:
            assert entry=='sql' and 'cumulative general admission limit' in str(exc);return None
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(admit,[q1,q2]))
    assert sum(r is not None for r in results)==1 and admitted(s,g)==4
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM runs WHERE workspace_id=%s',(ws,)).fetchone()['n']==4
        assert c.execute("SELECT count(*) n FROM conversation_messages WHERE workspace_id=%s AND author_kind='human'",(ws,)).fetchone()['n']==4
    no_attempts(s,ws,Provider())


@pytest.mark.parametrize('maximum',[5,8])
def test_general_grant_above_four_rejected_by_model_and_sql(context,maximum):
    s,p,ws,_,admin=context;cv=conversation(context);g=activate(context,[cv])
    bad=g.model_dump(mode='json')|{'id':new_id(),'max_runs':maximum}
    with pytest.raises(ValidationError):ProviderGrant.model_validate(bad)
    with pytest.raises(psycopg.Error,match='exact bounded general authorization required'):
        with Database(admin).transaction() as c:
            c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,active,data) VALUES (%s,%s,%s,false,%s)',
                      (bad['id'],ws,p.id,encoded(bad)))
    historical={k:v for k,v in bad.items() if k not in ('responses','profile','expires_at','model')}
    from datetime import timedelta
    from workagent.models import now
    old=ProviderGrant(**historical,model='historical-model',expires_at=now()+timedelta(minutes=15))
    with Database(admin).transaction() as c:
        c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,active,data) VALUES (%s,%s,%s,false,%s)',
                  (old.id,ws,p.id,encoded(old)))
    assert old.max_runs==maximum
