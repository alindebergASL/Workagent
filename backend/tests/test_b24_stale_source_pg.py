"""Current access still permits cancellation after input version drift."""
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_b24_runtime_pg import activate
from workagent.models import PostMessage, CreateConversation
from workagent.checkpoint_models import StopRun, CancelQueuedMessage
from workagent.db import Database


def change_source(context):
    _,_,ws,refs,admin=context
    with Database(admin).transaction() as c:
        c.execute("UPDATE sources SET data=jsonb_set(data,'{external_version}','\"review-correction-new\"') WHERE workspace_id=%s AND id=%s",(ws,refs[0].source_id))


def scoped_conversation(context):
    s,p,ws,refs,_=context
    return s.create_conversation(p,ws,cmd(CreateConversation,selected_source_refs=refs[:1]))


def test_stale_source_queue_held_and_cancellable(context):
    s,p,ws,_,_=context
    cv=scoped_conversation(context)
    # Grant remains source-free; the dispatcher must safely hold this owner's
    # stale queue before considering admission, never widen that grant.
    grant=activate(context,conversation(context))
    q=s.queue_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Retain original scope'))
    change_source(context)
    assert s.list_queued_messages(p,ws,cv.id).items[0].id==q.id
    s.drain_queued_messages(ws,grant.id)
    held=s.list_queued_messages(p,ws,cv.id).items[0]
    assert held.state=='held' and held.reason=='scope_changed'
    assert not s.get_conversation(p,ws,cv.id).runs
    command=cmd(CancelQueuedMessage,expected_queue_version=held.queue_version)
    result=s.cancel_queued_message(p,ws,cv.id,q.id,command)
    assert result.state=='cancelled'
    assert s.cancel_queued_message(p,ws,cv.id,q.id,command)==result


def test_stale_source_stop_retains_fence_without_freshness_authority(context):
    s,p,ws,_,_=context
    cv=scoped_conversation(context)
    admitted=post(context,cv,'Work on selected source')
    change_source(context)
    command=cmd(StopRun,expected_work_version=admitted.conversation.work_version,run_id=admitted.run.id)
    stopped=s.stop_conversation_run(p,ws,cv.id,command)
    assert stopped.state=='cancelled' and stopped.fence==admitted.run.fence+1
    assert s.stop_conversation_run(p,ws,cv.id,command)==stopped
    cp=s.list_run_checkpoints(p,ws,cv.id).items[0]
    assert cp.data.next_safe_action=='stopped'
    assert s.get_conversation(p,ws,cv.id).conversation.state=='open'
