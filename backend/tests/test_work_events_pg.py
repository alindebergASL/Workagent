"""Real disposable PG only. These tests deliberately fail without DB fixtures."""
import pytest
import psycopg
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from contextlib import contextmanager

from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_home_work_summary import artifact
from workagent.db import Database, migrate
from workagent.models import HumanSave
from workagent.service import Principal, encoded
from workagent.work_cursors import CursorCodec
from workagent.work_events import WorkEvents
from workagent.work_event_models import AttentionSeen
from workagent.work_snapshot import read
from workagent.api import create_app, Settings
from fastapi.testclient import TestClient


def lane(ctx):
    return WorkEvents(ctx[0], CursorCodec('test-only-key-' * 4))


def test_canonical_producers_snapshot_and_exact_seen_replay(context):
    s,p,ws,_,_ = context
    cv = conversation(context)
    events = lane(context)
    before = read(events, p, ws, cv.id)
    aid,rev = artifact(context, cv)
    page = events.page(p, ws, cv.id, before.snapshot_cursor)
    assert {e.type for e in page.events} >= {'artifact.changed', 'revision.created'}
    restarted=WorkEvents(type(s)(Database(s.db.dsn)),events.codec)
    assert restarted.page(p,ws,cv.id,before.snapshot_cursor).events==page.events
    snapshot = read(events, p, ws, cv.id)
    assert snapshot.artifacts[0].current_revision_id == rev.id
    assert 'PRIVATE_BODY' not in snapshot.model_dump_json()
    assert events.page(p, ws, cv.id, snapshot.snapshot_cursor).events == []
    seen = cmd(AttentionSeen, conversation_id=cv.id, cursor=page.next_cursor)
    receipt = events.seen(p, ws, seen)
    assert events.seen(p, ws, seen.model_copy(update={'request_id':'replay'})) == receipt
    assert not events.attention(p, ws, cv.id).facts
    raises('command_conflict', lambda: events.seen(p, ws,
        seen.model_copy(update={'cursor':before.snapshot_cursor})))


def test_runtime_cannot_forge_log_or_head_and_rollback_is_invisible(context):
    s,p,ws,_,_ = context
    cv = conversation(context)
    events = lane(context)
    before = read(events, p, ws, cv.id)
    with pytest.raises(RuntimeError), s.db.transaction() as c:
        c.execute("UPDATE conversations SET data=jsonb_set(data,'{title}','\"rolled back\"') WHERE workspace_id=%s AND id=%s", (ws,cv.id))
        c.execute('SET CONSTRAINTS ALL IMMEDIATE')
        raise RuntimeError('rollback')
    assert events.page(p, ws, cv.id, before.snapshot_cursor).events == []
    for sql in ['UPDATE work_event_heads SET position=position+1',
                'DELETE FROM work_events', 'DELETE FROM work_event_projection']:
        with pytest.raises(psycopg.Error), s.db.transaction() as c:
            c.execute(sql)


def test_cursor_scope_generation_expiry_and_no_get_writes(context):
    s,p,ws,_,admin = context
    cv, other = conversation(context), conversation(context)
    events = lane(context)
    snapshot = read(events,p,ws,cv.id)
    raises('not_found_or_not_authorized', lambda: events.page(p,ws,other.id,snapshot.snapshot_cursor))
    with Database(admin).transaction() as c:
        c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
    assert events.page(p,ws,cv.id,snapshot.snapshot_cursor).reset_required
    snapshot = read(events,p,ws,cv.id)
    with Database(admin).transaction() as c:
        c.execute('UPDATE work_event_heads SET retained_floor=position+1 WHERE workspace_id=%s',(ws,))
    assert events.page(p,ws,cv.id,snapshot.snapshot_cursor).reset_required
    # Migration journal replay uses the normal exact-prefix runner.
    migrate(admin)


def test_commit_prefix_waits_for_delayed_transaction_and_does_not_skip(context):
    s,p,ws,_,_ = context
    cv = conversation(context)
    events = lane(context)
    before = read(events,p,ws,cv.id)
    acquired, release, second_started = Event(), Event(), Event()

    def first():
        with s.db.transaction() as c:
            c.execute('INSERT INTO audit(id,workspace_id,principal_id,operation,object_id) VALUES (%s,%s,%s,%s,%s)',
                ('delayed-a-'+cv.id,ws,p.id,'test_a',cv.id))
            # Runtime, real deferred triggers, actual head lock held until COMMIT.
            c.execute('SET CONSTRAINTS ALL IMMEDIATE')
            acquired.set()
            assert release.wait(10)

    def second():
        assert acquired.wait(10)
        with s.db.transaction() as c:
            c.execute('INSERT INTO audit(id,workspace_id,principal_id,operation,object_id) VALUES (%s,%s,%s,%s,%s)',
                ('delayed-b-'+cv.id,ws,p.id,'test_b',cv.id))
            second_started.set()
            c.execute('SET CONSTRAINTS ALL IMMEDIATE')

    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(first), pool.submit(second)
        try:
            assert acquired.wait(10) and second_started.wait(10)
            assert not b.done()
            assert events.page(p,ws,cv.id,before.snapshot_cursor).events == []
        finally:
            release.set()
        a.result(timeout=10); b.result(timeout=10)
    page = events.page(p,ws,cv.id,before.snapshot_cursor,limit=1)
    assert len(page.events)==1 and page.has_more
    following = events.page(p,ws,cv.id,page.next_cursor,limit=1)
    assert len(following.events)==1 and not following.has_more
    assert page.events[0].event_id != following.events[0].event_id
    with s.db.transaction() as c:
        rows=c.execute('SELECT material_key FROM work_events WHERE workspace_id=%s AND position>(SELECT position FROM work_events WHERE event_id=%s) ORDER BY position',
            (ws,events.codec.decode(before.snapshot_cursor,ws,p.id,cv.id)[0])).fetchall()
    assert 'delayed-a-' in rows[0]['material_key'] and 'delayed-b-' in rows[1]['material_key']


def test_snapshot_watermark_is_atomic_with_concurrent_human_save(context,monkeypatch):
    s,p,ws,_,_ = context
    cv = conversation(context)
    aid, revision = artifact(context,cv)
    events = lane(context)
    reached, release = Event(), Event()
    original = events.watermark

    def pause(*args,**kwargs):
        result=original(*args,**kwargs)
        reached.set()
        assert release.wait(10)
        return result

    monkeypatch.setattr(events,'watermark',pause)
    with ThreadPoolExecutor(max_workers=2) as pool:
        snapshot_future = pool.submit(read,events,p,ws,cv.id)
        assert reached.wait(10)
        command=cmd(HumanSave,expected_current_revision_id=revision.id,
                    body=revision.body.model_copy(update={'title':'New human title'}))
        save_future=pool.submit(s.human_save,p,ws,aid,command)
        release.set()
        snapshot=snapshot_future.result(timeout=10)
        saved=save_future.result(timeout=10)
    assert snapshot.artifacts[0].current_revision_id==revision.id
    page=events.page(p,ws,cv.id,snapshot.snapshot_cursor)
    assert any(e.type=='revision.created' for e in page.events)
    assert read(events,p,ws,cv.id).artifacts[0].current_revision_id==saved.current_revision_id


def test_authorized_lookahead_does_not_count_hidden_proposals(context):
    from test_home_work_summary import proposal
    s,p,ws,refs,admin = context
    cv = conversation(context)
    aid,rev = artifact(context,cv)
    events=lane(context)
    before=read(events,p,ws,cv.id)
    for i in range(4):
        proposal(context,cv,aid,rev,'hidden-'+str(i),dependencies=refs[:1])
    visible=proposal(context,cv,aid,rev,'visible')
    page=events.page(p,ws,cv.id,before.snapshot_cursor,limit=1)
    assert [e.proposal_id for e in page.events]==[visible.id]
    assert not page.has_more
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,'other','editor')",(ws,))
    raises('not_found_or_not_authorized',lambda:events.page(Principal('other'),ws,cv.id))
    # Valid signatures cannot grant access to an event whose dependencies changed.
    protected=conversation(context,refs[:1])
    cursor=read(events,p,ws,protected.id).snapshot_cursor
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',
                  (ws,p.id,refs[0].source_id))
    raises('not_found_or_not_authorized',lambda:events.page(p,ws,protected.id,cursor))


def test_reads_have_no_mutations_and_heartbeat_has_no_event(context,monkeypatch):
    s,p,ws,_,_ = context
    cv=conversation(context)
    queued=post(context,cv)
    events=lane(context)
    before=read(events,p,ws,cv.id)
    with s.db.transaction() as c:
        c.execute("UPDATE runs SET data=jsonb_set(data,'{observed_at}',to_jsonb(now())) WHERE workspace_id=%s AND id=%s",
                  (ws,queued.run.id))
    assert events.page(p,ws,cv.id,before.snapshot_cursor).events==[]
    original=s.db.transaction
    statements=[]
    class Reader:
        def __init__(self,c): self.c=c
        def execute(self,sql,*args,**kwargs):
            statements.append(sql.strip().split()[0].upper())
            return self.c.execute(sql,*args,**kwargs)
    @contextmanager
    def transaction():
        with original() as c: yield Reader(c)
    monkeypatch.setattr(s.db,'transaction',transaction)
    read(events,p,ws,cv.id)
    events.page(p,ws,cv.id)
    events.attention(p,ws,cv.id)
    assert set(statements) <= {'SET','SELECT'}


def test_real_trigger_coverage_minimal_privileges_and_no_forged_temporary_trigger(context):
    s,p,ws,_,_ = context
    expected={'workspaces','conversations','conversation_messages','runs','assignments','artifacts',
              'revisions','proposals','provider_attempts','responses_steps','responses_events','run_dispatches','audit'}
    with s.db.transaction() as c:
        rows=c.execute("SELECT cl.relname,tgdeferrable,tginitdeferred FROM pg_trigger t JOIN pg_class cl ON cl.oid=t.tgrelid WHERE tgname LIKE 'work_capture_%'").fetchall()
        assert {r['relname'] for r in rows}==expected
        assert all(r['tgdeferrable'] and r['tginitdeferred'] for r in rows)
        assert c.execute("""SELECT count(*) AS n FROM pg_constraint
            WHERE contype='f' AND conrelid IN ('work_events'::regclass,'work_event_heads'::regclass,
              'work_run_chronology'::regclass,'work_event_projection'::regclass,
              'work_responsibility_observations'::regclass)""").fetchone()['n']==0
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        c.execute('CREATE TEMP TABLE conversations (workspace_id text,id text,data jsonb)')
        c.execute('CREATE TRIGGER work_capture_conversations AFTER INSERT ON pg_temp.conversations FOR EACH ROW EXECUTE FUNCTION public.work_event_capture()')


def test_late_cancelled_receipt_is_visible_without_publication(context,tmp_path):
    from test_cancelled_response_receipts import pending,cancel_by_human_save,restart,assert_no_application
    case=pending(context,tmp_path)
    cancel_by_human_save(case,context)
    events=lane(context)
    before=read(events,case.p,case.ws,case.cv.id)
    case.fake.release=True
    restart(case,context,tmp_path).work(case.p,case.ws,case.rid)
    page=events.page(case.p,case.ws,case.cv.id,before.snapshot_cursor)
    assert any(e.reason_code=='cancelled_unapplied' and e.run_id==case.rid for e in page.events)
    assert all(e.type=='receipt.recorded' for e in page.events if e.reason_code=='cancelled_unapplied')
    assert_no_application(case)
    text=page.model_dump_json()
    assert 'request_bytes' not in text and 'response_id' not in text and 'usage' not in text


def test_http_identity_scope_bounds_and_seen_replay(context):
    s,p,ws,_,_=context
    cv=conversation(context)
    settings=Settings(s.db.dsn,True,'test-only-bearer-credential-'*3,p.id)
    headers={'Authorization':'Bearer '+settings.local_bearer,'X-Schema-Version':'workagent/v1',
             'X-Request-Id':'work-events-test'}
    with TestClient(create_app(settings)) as client:
        assert client.get('/v1/identity').status_code==401
        assert client.get('/v1/identity',headers=headers).json()=={'principal_id':p.id}
        base=f'/v1/workspaces/{ws}'
        response=client.get(base+'/work-snapshot',params={'conversation_id':cv.id},headers=headers)
        assert response.status_code==200 and response.headers['cache-control']=='no-store'
        snapshot=response.json()
        assert snapshot['schema_version']=='workagent/work-v1'
        for query in [{},{'conversation_id':cv.id,'limit':0},{'conversation_id':cv.id,'limit':101}]:
            assert client.get(base+'/events',params=query,headers=headers).status_code==422
        assert client.get(base+'/events',params={'conversation_id':cv.id,'after':'bad'},headers=headers).status_code==404
        body=cmd(AttentionSeen,conversation_id=cv.id,cursor=snapshot['snapshot_cursor']).model_dump(mode='json')
        first=client.post(base+'/attention/seen',json=body,headers=headers)
        assert first.status_code==200
        body['request_id']='different-request'
        assert client.post(base+'/attention/seen',json=body,headers=headers).json()==first.json()


def test_current_run_uses_admission_order_not_latest_observed_at(context):
    from workagent.general_worker import GeneralWorker,ControlledTransport
    s,p,ws,_,_=context
    cv=conversation(context)
    first=post(context,cv)
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,first.run.id)
    current=s.get_conversation(p,ws,cv.id).conversation
    second=post(context,current)
    with s.db.transaction() as c:
        c.execute("UPDATE runs SET data=jsonb_set(data,'{observed_at}',to_jsonb((now()+interval '1 day')::text)) WHERE workspace_id=%s AND id=%s",
                  (ws,first.run.id))
    snapshot=read(lane(context),p,ws,cv.id)
    assert snapshot.execution.run_id==second.run.id and snapshot.execution.state=='queued'


def test_attention_is_monotonic_and_replays_do_not_duplicate_facts(context):
    s,p,ws,_,_=context
    cv=conversation(context)
    aid,revision=artifact(context,cv)
    events=lane(context)
    first=events.attention(p,ws,cv.id)
    assert len(first.facts)==1 and first.facts[0].type=='revision.created'
    old_seen=cmd(AttentionSeen,conversation_id=cv.id,cursor=first.next_cursor)
    old_receipt=events.seen(p,ws,old_seen)
    command=cmd(HumanSave,expected_current_revision_id=revision.id,body=revision.body)
    saved=s.human_save(p,ws,aid,command)
    s.human_save(p,ws,aid,command)
    next_page=events.attention(p,ws,cv.id)
    assert len(next_page.facts)==1
    newest=events.seen(p,ws,cmd(AttentionSeen,conversation_id=cv.id,cursor=next_page.next_cursor))
    assert events.seen(p,ws,old_seen)==old_receipt  # Exact old response, monotonic stored state.
    assert not events.attention(p,ws,cv.id).facts
    receipt=events.seen(p,ws,cmd(AttentionSeen,conversation_id=cv.id,cursor=first.next_cursor))
    assert receipt==newest and not events.attention(p,ws,cv.id).facts
    assert s.get_artifact(p,ws,aid).current_revision_id==saved.current_revision_id


def test_saved_current_revision_and_historical_responsibility_are_separate(context):
    from test_responsibilities import delegate,activate,product
    s,p,ws,_,_=context
    cv=conversation(context)
    art,_=product(context,cv)
    assignment=delegate(context,cv)
    activate(context,assignment,artifact=art)
    events=lane(context)
    before=read(events,p,ws,cv.id)
    old_observation=before.responsibility[0].historical_observation
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,
        expected_current_revision_id=art.current_revision_id,
        body=art.current_revision.body.model_copy(update={'title':'Current human work'})))
    after=read(events,p,ws,cv.id)
    current = next(item for item in after.artifacts if item.id == art.id)
    assert current.current_revision_id==saved.current_revision_id
    assert current.title=='Current human work'
    assert after.responsibility[0].historical_observation==old_observation
    assert after.execution.state!='completed'


@pytest.mark.parametrize('limit', [1,100])
def test_stream_revocation_between_batches_uses_current_pg_authority(context,monkeypatch,limit):
    import asyncio
    from workagent.work_event_api import stream
    s,p,ws,refs,admin=context
    cv=conversation(context,refs[:1])
    events=lane(context)
    initial=events.page(p,ws,cv.id,limit=limit)
    if limit==100:
        assert len(initial.events)>1  # Regression: revocation inside a buffered batch.
    class Request:
        async def is_disconnected(self): return False
    async def consume():
        iterator=stream(events,p,ws,cv.id,None,limit,Request(),lambda:None,initial)
        assert (await anext(iterator)).startswith('id: ')
        with Database(admin).transaction() as c:
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',
                      (ws,p.id,refs[0].source_id))
        frame=await anext(iterator)
        assert frame=='event: snapshot.required\ndata: {"reason":"access_changed"}\n\n'
        with pytest.raises(StopAsyncIteration): await anext(iterator)
    loop=asyncio.new_event_loop()
    try: loop.run_until_complete(asyncio.wait_for(consume(),10))
    finally: loop.close()


def test_snapshot_query_cost_is_batched_and_recorded(context,monkeypatch,record_property):
    from time import perf_counter
    s,p,ws,_,_=context
    cv=conversation(context)
    for _ in range(12): artifact(context,cv)
    original=s.db.transaction
    queries=[]
    class Measured:
        def __init__(self,c): self.c=c
        def execute(self,sql,*args,**kwargs):
            start=perf_counter()
            result=self.c.execute(sql,*args,**kwargs)
            queries.append((sql.strip().split()[0],perf_counter()-start))
            return result
    @contextmanager
    def transaction():
        with original() as c: yield Measured(c)
    monkeypatch.setattr(s.db,'transaction',transaction)
    start=perf_counter()
    snapshot=read(lane(context),p,ws,cv.id)
    elapsed=perf_counter()-start
    assert len(snapshot.artifacts)==12
    # Constant metadata batches for this source-free/no-run/no-proposal case.
    assert len(queries)<=10
    record_property('snapshot_query_count',len(queries))
    record_property('snapshot_sql_seconds',sum(seconds for _,seconds in queries))
    record_property('snapshot_total_seconds',elapsed)
    record_property('snapshot_bytes',len(snapshot.model_dump_json().encode()))


def test_pending_review_same_base_and_acceptance_readback(context):
    from test_home_work_summary import proposal
    from workagent.models import AcceptProposal
    s,p,ws,_,_=context
    cv=conversation(context)
    aid,first=artifact(context,cv)
    stale=proposal(context,cv,aid,first,'stale')
    saved=s.human_save(p,ws,aid,cmd(HumanSave,expected_current_revision_id=first.id,body=first.body))
    current=s.get_artifact(p,ws,aid).current_revision
    candidate=proposal(context,cv,aid,current,'current')
    before=read(lane(context),p,ws,cv.id)
    review={r.proposal_id:r for r in before.pending_proposals}
    assert not review[stale.id].fresh and not review[stale.id].is_latest
    assert review[candidate.id].fresh and review[candidate.id].is_latest
    accepted=s.accept_proposal(p,ws,candidate.id,cmd(AcceptProposal,
        expected_current_revision_id=saved.current_revision_id))
    after=read(lane(context),p,ws,cv.id)
    assert after.artifacts[0].current_revision_id==accepted.current_revision_id
    assert candidate.id not in {r.proposal_id for r in after.pending_proposals}
    assert after.execution.state=='idle'
