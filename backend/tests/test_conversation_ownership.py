"""Human steering of a conversation belongs to its owner, in every execution mode.

Before this guard, a second active editor member could post a controlled turn
into the owner's grant-scoped conversation under fixture mode. That cancelled the
owner's in-flight model run and left its outcome_unknown attempt unresolved, so
every later owner post failed with action_unresolved.
"""
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_general_responses import activate, Provider, worker
from workagent.db import Database
from workagent.service import Principal
from workagent.models import PostMessage


def second_member(ctx):
    _,_,ws,_,admin=ctx
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role,active) VALUES (%s,'other-human','editor',true)",(ws,))
    return Principal('other-human')


def test_other_member_cannot_steer_owner_conversation_in_controlled_mode(context):
    s,p,ws,_,_=context
    assert s.allow_controlled_turns
    cv=conversation(context)
    other=second_member(context)
    raises('not_found_or_not_authorized',lambda:s.post_message(other,ws,cv.id,
        cmd(PostMessage,expected_work_version=cv.work_version,text='Not my conversation')))
    assert s.get_conversation(p,ws,cv.id).runs==[]
    # The owner's own steering still works.
    assert post(context,cv).run.state=='queued'


def test_other_member_cannot_cancel_owner_model_run_or_lock_owner_out(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,[cv])
    fake=Provider(lose_id=True); w=worker(context,fake,tmp_path)
    q=post(context,cv,'Owner turn whose provider id is lost.')
    assert w.work(p,ws,q.run.id).state=='running'
    other=second_member(context)
    current=s.get_conversation(p,ws,cv.id).conversation
    raises('not_found_or_not_authorized',lambda:s.post_message(other,ws,cv.id,
        cmd(PostMessage,expected_work_version=current.work_version,text='Second member steering')))
    detail=s.get_conversation(p,ws,cv.id)
    assert [r.state for r in detail.runs]==['running']
    assert detail.conversation.work_version==current.work_version
    # Only the owner's explicit cancel settles the unresolved attempt, as designed.
    raises('action_unresolved',lambda:post(context,detail.conversation,'Owner follow-up'))
    assert len(fake.calls)==2
