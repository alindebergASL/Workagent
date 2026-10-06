"""Reject snapshot-isolated general admissions/reservations; no provider I/O."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import psycopg
import pytest

from test_domain import context
from test_conversations import conversation, post
from test_general_responses import activate, Provider, worker
from test_general_responses_blockers import admitted, no_attempts, revision_turn, queue_final, events
from workagent.models import new_id
from workagent.responses_ledger import Ledger
from workagent.service import encoded


@pytest.mark.parametrize('isolation', ['REPEATABLE READ', 'SERIALIZABLE'])
def test_snapshot_admission_rejected_without_effects(context, tmp_path, isolation):
    s,p,ws,_,_=context
    cvs=[conversation(context),conversation(context)]; grant=activate(context,cvs)
    q1=post(context,cvs[0],'One'); q2=post(context,cvs[1],'Two')
    q1=post(context,q1.conversation,'Three')
    barrier=Barrier(2)
    def insert(q):
        rid=new_id()
        run=q.run.model_copy(update={'id':rid})
        message=q.message.model_copy(update={'id':new_id(),'run_id':rid,'sequence':q.message.sequence+1})
        try:
            with s.db.transaction() as c:
                c.execute('SET TRANSACTION ISOLATION LEVEL '+isolation)
                c.execute('INSERT INTO runs(workspace_id,id,conversation_id,data) VALUES (%s,%s,%s,%s)',
                          (ws,rid,run.conversation_id,encoded(run)))
                cfg=c.execute('SELECT activation_id,data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                              (ws,q.run.id)).fetchone()
                barrier.wait(timeout=10)
                c.execute('INSERT INTO run_configurations(workspace_id,run_id,activation_id,data) VALUES (%s,%s,%s,%s)',
                          (ws,rid,cfg['activation_id'],encoded(cfg['data'])))
                s._append_message(c,ws,message)
        except psycopg.Error as exc:
            return rid,exc.diag.message_primary
        return rid,None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(insert,[q1,q2]))
    assert all(reason=='general authority requires read committed isolation' for _,reason in results)
    assert admitted(s,grant)==3
    with s.db.transaction() as c:
        for table in ('runs','run_configurations','conversation_messages'):
            assert c.execute('SELECT count(*) n FROM '+table+' WHERE workspace_id=%s',(ws,)).fetchone()['n']==3
    fake=Provider()
    for rid,_ in results:
        with pytest.raises(Exception): worker(context,fake,tmp_path).work(p,ws,rid)
    no_attempts(s,ws,fake)
    # Supported ordinary admission still consumes the remaining slot normally.
    post(context,q1.conversation,'Fourth via supported API')
    assert admitted(s,grant)==4


@pytest.mark.parametrize('isolation',['REPEATABLE READ','SERIALIZABLE'])
@pytest.mark.parametrize('kind',['count_send','dispatch','read'])
def test_snapshot_provider_reservation_denied(context,tmp_path,monkeypatch,isolation,kind):
    s,p,ws,_,_=context
    grant,fake,w,q,art,edit=revision_turn(context,tmp_path)
    if kind=='read': queue_final(w,monkeypatch)
    reserve=Ledger.reserve_operation; captured=[]
    def stop(ledger,request,operation,cap):
        if request.phase=='final' and operation==kind:
            captured.append(ledger.receipt.attempt_id)
            raise RuntimeError('stop before reservation')
        return reserve(ledger,request,operation,cap)
    monkeypatch.setattr(Ledger,'reserve_operation',stop)
    with pytest.raises(RuntimeError,match='stop before reservation'): w.work(p,ws,q.run.id)
    before=events(s,q.run.id); calls=len(fake.calls)
    data={'reserved_input_tokens':20000,'reserved_output_tokens':8192,'reserved_cost_usd':'0.131920'} if kind=='dispatch' else {}
    with pytest.raises(psycopg.Error,match='general authority requires read committed isolation'):
        with s.db.transaction() as c:
            c.execute('SET TRANSACTION ISOLATION LEVEL '+isolation)
            c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,'final',%s,%s)",
                      (new_id(),captured[0],kind,encoded(data)))
    assert events(s,q.run.id)==before and len(fake.calls)==calls
