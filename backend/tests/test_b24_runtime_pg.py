"""Parent-run restricted PostgreSQL campaign; never run against retained state.

Uses existing disposable fixture and synthetic HTTP. No live model/provider calls.
Migration047 (sibling) then048 must be integrated before provisioning this suite.
"""
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import pytest

from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_general_alpha_runtime import AlphaProvider, activate as alpha_activate
from test_general_responses import worker, totals
from test_adaptive_execution import finish_safe_visits
from test_sustained_continuity import draft, Interrupted
from test_runtime import expire
from workagent.checkpoint_models import StopRun, ContinueRun, CancelQueuedMessage
from workagent.models import PostMessage, new_id
from workagent.service import Service, Principal, digest
from workagent.retained_results import POLICY, SCHEMA
from workagent.errors import DomainError


def activate(ctx,cv,**kw):
    with patch('test_general_alpha_runtime.POLICY',POLICY),patch('test_general_alpha_runtime.DECISION_SCHEMA',SCHEMA):
        return alpha_activate(ctx,cv,continuity_version='sustained-v1',**kw)


def settled_checkpoint(s,p,ws,cid,rid):
    return next(cp for cp in s.list_run_checkpoints(p,ws,cid).items if cp.run_id==rid and cp.checkpoint_kind=='settlement')


def resume_cmd(cv,cp):
    return cmd(ContinueRun,expected_work_version=cv.work_version,checkpoint_id=cp.checkpoint_id,checkpoint_hash=cp.checkpoint_hash)


def test_exact_stop_leaves_open_and_stale_run_cannot_stop_replacement(context):
    s,p,ws,_,_=context
    cv=conversation(context)
    q=post(context,cv,'First intent')
    command=cmd(StopRun,expected_work_version=q.conversation.work_version,run_id=q.run.id)
    stopped=s.stop_conversation_run(p,ws,cv.id,command)
    assert stopped.state=='cancelled' and stopped.fence==q.run.fence+1
    assert Service(s.db).stop_conversation_run(p,ws,cv.id,command)==stopped
    cv=s.get_conversation(p,ws,cv.id).conversation
    assert cv.state=='open'
    latest=post(context,cv,'An explicit new human intent')
    raises('action_unresolved',lambda:s.stop_conversation_run(p,ws,cv.id,
        cmd(StopRun,expected_work_version=latest.conversation.work_version,run_id=q.run.id)))
    assert s.get_run(p,ws,latest.run.id).state=='queued'
    cps=s.list_run_checkpoints(p,ws,cv.id).items
    assert len(cps)==1 and cps[0].run_id==q.run.id and cps[0].checkpoint_kind=='stop'


def test_queue_is_durable_exact_fifo_and_does_not_advance_human_version(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context);g=activate(context,cv)
    first=post(context,cv,'Initial question')
    cv=first.conversation
    exact='Later: preserve\r\nUnicode é🙂 and all spaces  '
    command=cmd(PostMessage,expected_work_version=cv.work_version,text=exact)
    q=s.queue_message(p,ws,cv.id,command)
    q2=s.queue_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Third intent'))
    assert Service(s.db).queue_message(p,ws,cv.id,command)==q
    s.drain_queued_messages(ws,g.id)
    assert [v.state for v in s.list_queued_messages(p,ws,cv.id).items]==['pending','pending']
    fake=AlphaProvider([{'kind':'reply','text':'Done with this question.'}])
    w=worker(context,fake,tmp_path)
    finish_safe_visits(context,w,first.run.id)
    calls=list(fake.calls)
    s.drain_queued_messages(ws,g.id)
    assert fake.calls==calls  # Admission is not provider dispatch.
    a,b=s.list_queued_messages(p,ws,cv.id).items
    assert a.state=='admitted' and b.state=='pending'
    s.drain_queued_messages(ws,g.id)
    assert s.list_queued_messages(p,ws,cv.id).items[1].state=='pending'
    finish_safe_visits(context,w,a.run_id)
    s.drain_queued_messages(ws,g.id)
    b=s.list_queued_messages(p,ws,cv.id).items[1]
    assert b.state=='admitted' and b.run_id!=a.run_id
    detail=s.get_conversation(p,ws,cv.id)
    assert next(m for m in detail.messages if m.run_id==a.run_id and m.author_kind=='human').text==exact
    assert detail.conversation.work_version==cv.work_version
    with s.db.transaction() as c:
        cfg=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,a.run_id)).fetchone()['data']
    assert cfg['queued_intent']=={'id':q.id,'command_id':command.command_id}


def test_queue_human_redirect_holds_and_cancel_lost_ack_is_exact(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context);g=activate(context,cv)
    first=post(context,cv,'First')
    q=s.queue_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=first.conversation.work_version,text='Queued original'))
    second=post(context,first.conversation,'Newer steering')
    finish_safe_visits(context,worker(context,AlphaProvider([{'kind':'reply','text':'Steering handled.'}]),tmp_path),second.run.id)
    s.drain_queued_messages(ws,g.id)
    held=s.list_queued_messages(p,ws,cv.id).items[0]
    assert held.state=='held' and held.reason=='work_changed' and held.intent==q.intent
    cancellation=cmd(CancelQueuedMessage,expected_queue_version=held.queue_version)
    cancelled=s.cancel_queued_message(p,ws,cv.id,q.id,cancellation)
    assert cancelled.state=='cancelled'
    assert Service(s.db).cancel_queued_message(p,ws,cv.id,q.id,cancellation)==cancelled
    raises('command_conflict',lambda:s.cancel_queued_message(p,ws,cv.id,q.id,
        cancellation.model_copy(update={'expected_queue_version':held.queue_version+1})))


def test_queue_cancel_admit_race_has_one_canonical_outcome(context):
    s,p,ws,_,_=context
    cv=conversation(context);g=activate(context,cv)
    q=s.queue_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Exactly once'))
    def cancel():
        try:return s.cancel_queued_message(p,ws,cv.id,q.id,cmd(CancelQueuedMessage,expected_queue_version=1)).state
        except DomainError as exc:return exc.code.value
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(s.drain_queued_messages,ws,g.id),pool.submit(cancel)]
        [f.result() for f in futures]
    result=s.list_queued_messages(p,ws,cv.id).items[0]
    assert result.state in ('admitted','cancelled')
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.runs)==(1 if result.state=='admitted' else 0)


@pytest.mark.parametrize('boundary',['after_tool_result','before_publication','after_publication'])
def test_checkpoint_restart_at_canonical_boundary_keeps_hashes_and_effects(context,tmp_path,boundary):
    s,p,ws,_,_=context
    cv=conversation(context);activate(context,cv,max_steps=2)
    q=post(context,cv,'Prepare one brief and explain it.')
    fake=AlphaProvider([draft('Retained once'),{'kind':'reply','text':'The saved brief is ready for review.'}])
    w=worker(context,fake,tmp_path)
    fired=[]
    def crash(point):
        if point==boundary and not fired:
            fired.append(point);raise Interrupted()
    w.phases.hook=crash
    with pytest.raises(Interrupted): finish_safe_visits(context,w,q.run.id)
    prior={cp.checkpoint_id:cp.checkpoint_hash for cp in s.list_run_checkpoints(p,ws,cv.id).items}
    assert prior
    if s.get_run(p,ws,q.run.id).state=='running': expire(context,q.run.id)
    finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.artifact_ids)==1
    assert len([m for m in detail.messages if m.author_kind=='assistant'])==1
    after={cp.checkpoint_id:cp.checkpoint_hash for cp in s.list_run_checkpoints(p,ws,cv.id).items}
    assert all(after[k]==v for k,v in prior.items())
    assert settled_checkpoint(s,p,ws,cv.id,q.run.id).data.next_safe_action=='settled'


def test_explicit_successor_lost_ack_concurrency_original_intent_and_shared_budget(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context);g=activate(context,cv,max_steps=1)
    q=post(context,cv,'Prepare useful parts across bounded executions.')
    fake=AlphaProvider([draft('First part')])
    finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    cp=settled_checkpoint(s,p,ws,cv.id,q.run.id)
    assert cp.data.next_safe_action=='continue_slice' and cp.data.waiting=='none'
    cv=s.get_conversation(p,ws,cv.id).conversation
    command=resume_cmd(cv,cp); before=totals(s,g)
    # Separate commands and worker processes still converge on one predecessor.
    with ThreadPoolExecutor(max_workers=4) as pool:
        runs=list(pool.map(lambda _:Service(s.db).continue_conversation(p,ws,cv.id,
            command.model_copy(update={'command_id':new_id()})),range(4)))
    assert len({r.id for r in runs})==1 and runs[0].id!=q.run.id
    assert totals(s,g)==before
    assert s.continue_conversation(p,ws,cv.id,command).id==runs[0].id
    detail=s.get_conversation(p,ws,cv.id)
    original=next(m for m in detail.messages if m.id==q.message.id)
    successor=next(m for m in detail.messages if m.run_id==runs[0].id and m.author_kind=='human')
    assert successor.text==original.text and successor.attachments==original.attachments
    with s.db.transaction() as c:
        cfg=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,runs[0].id)).fetchone()['data']
    assert cfg['continuation']['intent_message_id']==original.id and cfg['continuation']['intent_sha256']==digest(original)
    assert cfg['grant_id']==g.id
    final=AlphaProvider([{'kind':'reply','text':'Both parts are retained.'}])
    finish_safe_visits(context,worker(context,final,tmp_path),runs[0].id)
    assert final.contexts[0]['continuation']['checkpoint_id']==cp.checkpoint_id
    assert s.get_conversation(p,ws,cv.id).conversation.work_version==cv.work_version


@pytest.mark.parametrize('change',['hash','human','generation','principal','revision'])
def test_successor_rejects_changed_scope_without_rewriting_saved_work(context,tmp_path,change):
    from workagent.db import Database
    from workagent.models import HumanSave
    s,p,ws,_,admin=context
    cv=conversation(context);activate(context,cv,max_steps=1)
    q=post(context,cv,'Prepare work')
    finish_safe_visits(context,worker(context,AlphaProvider([draft()]),tmp_path),q.run.id)
    cp=settled_checkpoint(s,p,ws,cv.id,q.run.id); cv=s.get_conversation(p,ws,cv.id).conversation
    command=resume_cmd(cv,cp); actor=p
    if change=='hash': command.checkpoint_hash='0'*64
    if change=='human':
        q2=post(context,cv,'Change of plan')
        command.expected_work_version=q2.conversation.work_version
    if change=='generation':
        with Database(admin).transaction() as c:c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
    if change=='principal': actor=Principal('different-human')
    if change=='revision':
        aid=s.get_conversation(p,ws,cv.id).artifact_ids[0];art=s.get_artifact(p,ws,aid)
        body=art.current_revision.body.model_copy(deep=True);body.title='Human retained title'
        s.human_save(p,ws,aid,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
    with pytest.raises(DomainError): s.continue_conversation(actor,ws,cv.id,command)
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM run_successors WHERE workspace_id=%s',(ws,)).fetchone()
        assert c.execute('SELECT checkpoint_hash FROM run_checkpoints WHERE workspace_id=%s AND checkpoint_id=%s',
            (ws,cp.checkpoint_id)).fetchone()['checkpoint_hash']==cp.checkpoint_hash


def test_actual_worker_consumes_retained_tool_page_and_receipt_before_context(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context);activate(context,cv,max_steps=3)
    q=post(context,cv,'Inspect the retained brief before answering.')
    def read_previous(ctx):
        observed=ctx['adaptive']['observations'][0]
        return {'kind':'read_result','run_id':ctx['run_id'],'phase':observed['phase'],
            'operation_hash':observed['binding']['operation_hash'],'offset':0,'limit':8192}
    def explain(ctx):
        page=ctx['adaptive']['observations'][-1]['capability_result']['result']
        assert page['status']=='available' and 'Retained evidence brief' in page['text']
        with s.db.transaction() as c:
            assert c.execute('SELECT count(*) n FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',
                (ws,q.run.id)).fetchone()['n']==1
        return {'kind':'reply','text':'I inspected the exact retained brief.'}
    fake=AlphaProvider([draft('Retained evidence brief'),read_previous,explain])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    calls=list(fake.calls)
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert fake.calls==calls


def test_dispatcher_successor_retains_same_responsibility_wake_and_changed_deps_block(context,tmp_path):
    from test_responsibilities import delegate, product
    from test_responsibility_execution import dispatch, admitted, edit
    from workagent.responsibility_models import ActivateResponsibility, ResponsibilityDependency, ResponsibilityNextAction
    s,p,ws,_,_=context
    cv=conversation(context);art,_=product(context,cv);a=delegate(context,cv,'Continue useful preparation')
    g=activate(context,cv,max_steps=1)
    s.activate_responsibility(p,ws,a.id,cmd(ActivateResponsibility,expected_work_version=a.work_version,
        current_outcome='Saved material is available.',next_action=ResponsibilityNextAction(kind='continue_work',description='Prepare the remaining useful parts.'),
        dependencies=[ResponsibilityDependency(kind='artifact_revision',object_id=art.id,expected_version=art.current_revision_id)]))
    fake=AlphaProvider([draft('First bounded part')])
    dispatcher,_,w=dispatch(context,tmp_path,g,fake)
    dispatcher.once()
    if fake.failures: raise fake.failures[0]
    first=admitted(s,ws)[0]
    finish_safe_visits(context,w,first['run_id'])
    cp=settled_checkpoint(s,p,ws,cv.id,first['run_id'])
    before=totals(s,g)
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda _:Service(s.db).advance_run_successors(ws,g.id),range(3)))
    rows=admitted(s,ws)
    assert len(rows)==2 and totals(s,g)==before
    second=next(r for r in rows if r['run_id']!=first['run_id'])
    assert second['config']['responsibility']==first['config']['responsibility']
    assert second['config']['continuation']['checkpoint_id']==cp.checkpoint_id
    assert s.get_responsibility(p,ws,a.id).lifecycle.run_id==second['run_id']
    edit(context,art,'Human changes supersede the predecessor plan.')
    calls=list(fake.calls)
    Service(s.db).advance_run_successors(ws,g.id)
    assert len(admitted(s,ws))==2 and fake.calls==calls
    assert s.get_run(p,ws,second['run_id']).state=='cancelled'


def test_queue_target_revision_drift_holds_original_bytes(context,tmp_path):
    from test_responsibilities import product
    from test_responsibility_execution import edit
    from workagent.message_models import ExactTarget
    s,p,ws,_,_=context
    cv=conversation(context);art,_=product(context,cv)
    cv=s.get_conversation(p,ws,cv.id).conversation;g=activate(context,cv)
    saved=s.get_artifact(p,ws,art.id)
    target=ExactTarget(artifact_id=art.id,revision_id=saved.current_revision_id,body_hash=saved.current_revision.body_hash)
    q=s.queue_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Use this exact saved version.',target=target))
    edit(context,saved,'New human revision remains saved.')
    s.drain_queued_messages(ws,g.id)
    held=s.list_queued_messages(p,ws,cv.id).items[0]
    assert held.state=='held' and held.reason=='scope_changed' and held.intent==q.intent
    assert held.run_id is None


@pytest.mark.parametrize('failure',['cross_conversation','revoked','stale_lease'])
def test_retained_read_reauthorizes_before_any_new_receipt(context,tmp_path,failure):
    from workagent.provider_attempts import revoke_grant
    from workagent.db import Database
    from workagent.retained_results import ReadResult, material
    from workagent.models import Run
    s,p,ws,_,admin=context
    cv=conversation(context);g=activate(context,cv,max_steps=3)
    q=post(context,cv,'Inspect retained work')
    fake=AlphaProvider([draft('Read scope'),{'kind':'reply','text':'Retained.'}])
    w=worker(context,fake,tmp_path)
    def interrupt(point):
        if point=='after_tool_result': raise Interrupted()
    w.phases.hook=interrupt
    with pytest.raises(Interrupted): w.work(p,ws,q.run.id)
    saved=w.phases.state.load(ws,q.run.id)
    from workagent.service import WorkerCapability
    cap=WorkerCapability(**saved['worker'])
    cp=next(c for c in s.list_run_checkpoints(p,ws,cv.id).items if c.checkpoint_kind=='stage')
    if failure=='revoked': revoke_grant(Database(admin),g.id)
    elif failure=='stale_lease': expire(context,q.run.id)
    else:
        foreign=conversation(context); other=post(context,foreign,'Other work')
    before=list(fake.calls)
    with pytest.raises(DomainError):
        with s.db.transaction() as c:
            actor,run,current=s._check_capability(c,cap)
            material(s,c,actor,run,current,ReadResult(kind='read_result',run_id=other.run.id if failure=='cross_conversation' else q.run.id,
                phase=cp.phase,operation_hash=cp.checkpoint_hash,offset=0,limit=100))
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['n']==0
    assert fake.calls==before


def test_unknown_send_does_not_create_successor_or_add_provider_dispatch(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context);g=activate(context,cv,max_steps=1)
    q=post(context,cv,'Prepare one bounded part')
    fake=AlphaProvider([draft()],lose_phase='selection')
    w=worker(context,fake,tmp_path)
    assert w.work(p,ws,q.run.id).state=='running'
    before=list(fake.calls)
    for _ in range(3):
        s.advance_run_successors(ws,g.id)
        worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert fake.calls==before
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM run_successors WHERE workspace_id=%s',(ws,)).fetchone()


def test_eight_steps_is_per_execution_and_successor_keeps_shared_accounting(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context);g=activate(context,cv,max_steps=8)
    q=post(context,cv,'Prepare eight parts, then explain the result in the next bounded execution.')
    fake=AlphaProvider([draft('Part '+str(n)) for n in range(1,9)])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).stop_reason=='step_limit'
    cp=settled_checkpoint(s,p,ws,cv.id,q.run.id)
    assert len(cp.data.steps)==9
    cv=s.get_conversation(p,ws,cv.id).conversation
    successor=s.continue_conversation(p,ws,cv.id,resume_cmd(cv,cp))
    final=AlphaProvider([{'kind':'reply','text':'All eight preparation parts are retained, with human review still available.'}])
    assert finish_safe_visits(context,worker(context,final,tmp_path),successor.id).state=='ready'
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==8
    assert totals(s,g)['request_counts']['dispatch']==11


def test_repeated_slice_without_new_material_parks_without_fresh_authority(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context);g=activate(context,cv,max_steps=1)
    q=post(context,cv,'Prepare meaningful remaining work')
    fake=AlphaProvider([draft('Same material')]);w=worker(context,fake,tmp_path)
    finish_safe_visits(context,w,q.run.id)
    cp=settled_checkpoint(s,p,ws,cv.id,q.run.id);cv=s.get_conversation(p,ws,cv.id).conversation
    successor=s.continue_conversation(p,ws,cv.id,resume_cmd(cv,cp))
    finish_safe_visits(context,w,successor.id)
    second=settled_checkpoint(s,p,ws,cv.id,successor.id)
    assert second.data.waiting=='blocked' and second.data.next_safe_action=='await_person'
    before=totals(s,g)
    raises('action_unresolved',lambda:s.continue_conversation(p,ws,cv.id,resume_cmd(cv,second)))
    assert totals(s,g)==before


def test_checkpoint_and_read_journals_are_append_only_under_runtime_role(context,tmp_path):
    import psycopg
    from workagent.service import encoded
    s,p,ws,_,_=context
    cv=conversation(context);activate(context,cv,max_steps=1)
    q=post(context,cv,'Retain an immutable boundary')
    finish_safe_visits(context,worker(context,AlphaProvider([draft()]),tmp_path),q.run.id)
    cp=settled_checkpoint(s,p,ws,cv.id,q.run.id)
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute("UPDATE run_checkpoints SET data=jsonb_set(data,'{waiting}','\"none\"') WHERE workspace_id=%s AND checkpoint_id=%s",
                (ws,cp.checkpoint_id))
    with s.db.transaction() as c:
        assert c.execute('SELECT checkpoint_hash FROM run_checkpoints WHERE workspace_id=%s AND checkpoint_id=%s',
            (ws,cp.checkpoint_id)).fetchone()['checkpoint_hash']==cp.checkpoint_hash
    # A runtime SQL caller cannot invent a checkpoint reference/hash either.
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute('INSERT INTO run_checkpoints(workspace_id,checkpoint_id,run_id,conversation_id,assignment_id,phase,checkpoint_kind,checkpoint_hash,data) '
                'VALUES (%s,%s,%s,%s,NULL,%s,%s,%s,%s)',
                (ws,new_id(),q.run.id,cv.id,'stop','stop','0'*64,encoded(cp.data)))
