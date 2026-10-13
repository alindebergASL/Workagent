"""Actual worker/ledger regression: count failures are retained, never retried."""
import json
import httpx
import pytest
from test_domain import context
from test_conversations import conversation,post
from test_general_responses import activate,Provider,worker,totals


class CountFailure(Provider):
    def __init__(self,mode):
        super().__init__(); self.mode=mode

    def handle(self,request):
        if request.url.path.endswith('input_tokens'):
            self.calls.append((request.method,request.url.path))
            if self.mode=='network':
                raise httpx.ReadError('SECRET diagnostic must not escape')
            if self.mode=='http':
                return httpx.Response(429,json={'error':'SECRET body'})
            if self.mode=='malformed':
                return httpx.Response(200,content='SECRET not JSON')
            return httpx.Response(200,json={'object':'response.input_tokens','input_tokens':20001})
        return super().handle(request)


@pytest.mark.parametrize('mode,code,step_state',[
    ('excessive','input_count_exceeds_limit','invalid'),
    ('network','observation_unavailable','count_unknown'),
    ('http','http_error','count_unknown'),
    ('malformed','malformed_response','count_unknown'),
])
def test_count_failure_keeps_safe_diagnostic_and_no_retry(context,tmp_path,mode,code,step_state):
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,[cv]);fake=CountFailure(mode)
    q=post(context,cv,'Explain a simple reversible choice.')
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    with s.db.transaction() as c:
        attempt=c.execute('SELECT id FROM provider_attempts WHERE run_id=%s',(q.run.id,)).fetchone()['id']
        rows=c.execute('SELECT kind,data FROM responses_events WHERE attempt_id=%s',(attempt,)).fetchall()
    events={r['kind']:r['data'] for r in rows}
    assert events['problem']['code']==code
    assert events['problem']['operation']=='count'
    assert 'SECRET' not in json.dumps(events)
    assert 'dispatch' not in events and 'count_result' not in events
    turn=s.get_conversation(p,ws,cv.id).turns[0]
    assert turn.response_steps[0].state==step_state
    assert ('20000' in turn.reason) if mode=='excessive' else ('count' in turn.reason.lower())
    if mode=='excessive': assert events['problem']['input_tokens']==20001
    if mode=='http': assert events['problem']['http_status']==429
    calls=len(fake.calls)
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert len(fake.calls)==calls==1
    assert totals(s,g)['request_counts']=={'count_send':1,'dispatch':0,'read':0,'cancel':0}


def test_wire_context_does_not_duplicate_policy_and_tool_schema(context,tmp_path):
    s,p,ws,_,_=context;cv=conversation(context);activate(context,[cv]);fake=Provider()
    q=post(context,cv,'Explain a simple reversible choice.')
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    with s.db.transaction() as c:
        rows=c.execute('SELECT request_bytes FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id WHERE a.run_id=%s',(q.run.id,)).fetchall()
    assert len(rows)==2
    for row in rows:
        payload=json.loads(row['request_bytes']);ctx=json.loads(payload['input'][0]['content'])
        assert 'instructions' not in ctx and 'tools' not in ctx
        assert payload['instructions']
        assert ctx['messages'][0]['text']=='Explain a simple reversible choice.'
    assert s.get_conversation(p,ws,cv.id).turns[0].state=='replied'


def test_alpha_final_count_limit_preserves_stage_and_never_retries(context,tmp_path):
    from test_general_alpha_runtime import activate as alpha_activate, AlphaProvider
    class FinalExcessive(AlphaProvider):
        def handle(self,request):
            if request.url.path.endswith('input_tokens') and json.loads(request.content)['tools']==[]:
                self.calls.append((request.method,request.url.path))
                return httpx.Response(200,json={'object':'response.input_tokens','input_tokens':20001})
            return super().handle(request)
    s,p,ws,_,_=context;cv=conversation(context);g=alpha_activate(context,cv)
    fake=FinalExcessive([{'kind':'reply','text':'A useful response retained before final counting.'}])
    q=post(context,cv,'A bounded question with no external effects.')
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    detail=s.get_conversation(p,ws,cv.id);turn=detail.turns[0]
    assert len(detail.messages)==1 and not detail.artifact_ids
    assert turn.response_steps[-1].phase=='final' and turn.response_steps[-1].state=='invalid'
    assert turn.retained_local_result is not None and not turn.retained_local_result.published
    assert '20000' in turn.reason
    assert all('instructions' not in ctx and 'tools' not in ctx for ctx in fake.contexts)
    before=list(fake.calls);worker(context,fake,tmp_path).work(p,ws,q.run.id);assert fake.calls==before
    assert totals(s,g)['request_counts']=={'count_send':2,'dispatch':1,'read':0,'cancel':0}


def test_projection_removes_only_control_copies():
    from copy import deepcopy
    from workagent.general_worker import GeneralWorker
    ctx={'instructions':'policy','tools':[{'schema':'exact'}],
         'messages':[{'text':'keep human instruction','attachments':[{'content':'source text'}]}],
         'target_body':{'notes':['exact human note']},'composition':{'skills':[{'id':'method'}]},
         'dependencies':[{'content':'bound source'}], 'responsibility':{'status':'waiting_person'}}
    before=deepcopy(ctx);projected=GeneralWorker._request_context(ctx)
    assert projected=={k:v for k,v in before.items() if k not in ('instructions','tools')}
    assert ctx==before


@pytest.fixture
def unresolved_count(context,tmp_path,monkeypatch):
    from workagent.responses_ledger import Ledger
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,[cv])
    q=post(context,cv,'A bounded count isolation regression.')
    reserve=Ledger.reserve_operation
    def stop_after_count_send(ledger,request,kind,cap):
        result=reserve(ledger,request,kind,cap)
        if kind=='count_send':
            raise RuntimeError('stop after durable count send')
        return result
    monkeypatch.setattr(Ledger,'reserve_operation',stop_after_count_send)
    fake=Provider()
    with pytest.raises(RuntimeError,match='stop after durable count send'):
        worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert fake.calls==[]
    with s.db.transaction() as c:
        step=c.execute('SELECT s.* FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id WHERE a.run_id=%s',(q.run.id,)).fetchone()
    data={
        'problem':{'operation':'count','code':'observation_unavailable','received':False},
        'count_result':{k:step[k] for k in ('request_sha256','count_sha256','metadata')},
        'dispatch':{'reserved_input_tokens':20000,'reserved_output_tokens':8192,
                    'reserved_cost_usd':'0.131920','billed_cost_usd':None},
    }
    data['count_result']['input_tokens']=700
    return s,g,step['attempt_id'],data


def insert_count_event(c,aid,kind,data):
    from workagent.models import new_id
    from workagent.service import encoded
    c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,'selection',%s,%s)",
              (new_id(),aid,kind,encoded(data[kind])))


def assert_count_winner(s,g,aid,winner):
    from decimal import Decimal
    with s.db.transaction() as c:
        kinds={r['kind'] for r in c.execute('SELECT kind FROM responses_events WHERE attempt_id=%s',(aid,)).fetchall()}
    dispatched=winner=='count_result'
    assert kinds==({'count_send','count_result','dispatch'} if dispatched else {'count_send','problem'})
    t=totals(s,g)
    assert t['request_counts']=={'count_send':1,'dispatch':int(dispatched),'read':0,'cancel':0}
    assert t['reserved_input_tokens']==(20000 if dispatched else 0)
    assert t['reserved_output_tokens']==(8192 if dispatched else 0)
    assert Decimal(t['reserved_cost_usd'])==(Decimal('0.131920') if dispatched else 0)


@pytest.mark.parametrize('isolation',['REPEATABLE READ','SERIALIZABLE'])
@pytest.mark.parametrize('winner',['problem','count_result'])
def test_count_exclusion_rejects_stale_snapshot(unresolved_count,isolation,winner):
    import psycopg
    s,g,aid,data=unresolved_count
    loser='count_result' if winner=='problem' else 'problem'
    with pytest.raises(psycopg.Error,match='shared budget authority requires read committed isolation'):
        with s.db.transaction() as stale:
            stale.execute('SET TRANSACTION ISOLATION LEVEL '+isolation)
            assert stale.execute('SELECT count(*) n FROM responses_events WHERE attempt_id=%s',(aid,)).fetchone()['n']==1
            with s.db.transaction() as current:
                insert_count_event(current,aid,winner,data)
                if winner=='count_result': insert_count_event(current,aid,'dispatch',data)
            # A workspace lock cannot refresh this already-pinned snapshot.
            assert stale.execute('SELECT count(*) n FROM responses_events WHERE attempt_id=%s',(aid,)).fetchone()['n']==1
            insert_count_event(stale,aid,loser,data)
    assert_count_winner(s,g,aid,winner)


@pytest.mark.parametrize('winner',['problem','count_result'])
def test_count_exclusion_read_committed_waits_and_rejects(unresolved_count,winner):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from time import monotonic, sleep
    import psycopg
    s,g,aid,data=unresolved_count
    loser='count_result' if winner=='problem' else 'problem'
    started=Event(); pids=[]
    def insert_loser():
        with s.db.transaction() as c:
            c.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
            pids.append(c.execute('SELECT pg_backend_pid() pid').fetchone()['pid'])
            started.set()
            insert_count_event(c,aid,loser,data)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with s.db.transaction() as current:
            insert_count_event(current,aid,winner,data)
            if winner=='count_result': insert_count_event(current,aid,'dispatch',data)
            winner_pid=current.execute('SELECT pg_backend_pid() pid').fetchone()['pid']
            future=pool.submit(insert_loser)
            assert started.wait(5)
            deadline=monotonic()+5
            while monotonic()<deadline:
                blockers=current.execute('SELECT pg_blocking_pids(%s) pids',(pids[0],)).fetchone()['pids']
                if winner_pid in blockers: break
                assert not future.done(), 'loser must wait for the workspace lock'
                sleep(0.01)
            else:
                pytest.fail('did not observe the workspace lock wait')
        message='count diagnostic is terminal' if winner=='problem' else 'count diagnostic requires unresolved count slot'
        with pytest.raises(psycopg.Error,match=message): future.result(timeout=5)
    assert_count_winner(s,g,aid,winner)


def test_sql_count_diagnostic_shape_and_terminal_slot(context,tmp_path,monkeypatch):
    import psycopg
    from workagent.responses_ledger import Ledger
    from workagent.models import new_id
    from workagent.service import encoded
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,[cv]);fake=CountFailure('network')
    q=post(context,cv,'A bounded question.')
    monkeypatch.setattr(Ledger,'count_problem',lambda *_:None)
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    with s.db.transaction() as c:
        aid=c.execute('SELECT id FROM provider_attempts WHERE run_id=%s',(q.run.id,)).fetchone()['id']
    valid={'operation':'count','code':'observation_unavailable','received':False}
    for bad in [valid|{'operation':None},valid|{'code':None},valid|{'received':True},
                valid|{'body':'must not store'},valid|{'http_status':429},valid|{'input_tokens':20001},
                {'operation':'count','code':'input_count_exceeds_limit','received':True,'input_tokens':True,'limit':20000}]:
        with pytest.raises(psycopg.Error):
            with s.db.transaction() as c:
                c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,'selection','problem',%s)",(new_id(),aid,encoded(bad)))
    with s.db.transaction() as c:
        c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,'selection','problem',%s)",(new_id(),aid,encoded(valid)))
    for kind in ('count_result','dispatch'):
        with pytest.raises(psycopg.Error,match='count diagnostic is terminal'):
            with s.db.transaction() as c:
                c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,'selection',%s,'{}')",(new_id(),aid,kind))
    assert totals(s,g)['request_counts']=={'count_send':1,'dispatch':0,'read':0,'cancel':0}
