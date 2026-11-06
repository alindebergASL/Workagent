"""One unavailable scope must not starve a different authorized queue."""
import pytest
from test_domain import context,cmd,raises
from test_conversations import conversation
from test_b24_runtime_pg import activate
from test_b24_stale_source_pg import scoped_conversation
from workagent.models import PostMessage
from workagent.db import Database

@pytest.mark.parametrize('cause',['revoked','unavailable'])
def test_denied_source_queue_hold_does_not_abort_other_work(context,cause):
    s,p,ws,refs,admin=context
    bad=scoped_conversation(context);good=conversation(context)
    grant=activate(context,good)
    badq=s.queue_message(p,ws,bad.id,cmd(PostMessage,expected_work_version=bad.work_version,text='Do not disclose denied context'))
    goodq=s.queue_message(p,ws,good.id,cmd(PostMessage,expected_work_version=good.work_version,text='Independent permitted work'))
    with Database(admin).transaction() as c:
        if cause=='revoked':
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s AND principal_id=%s',(ws,refs[0].source_id,p.id))
        else:
            c.execute("UPDATE sources SET data=jsonb_set(data,'{available}','false') WHERE workspace_id=%s AND id=%s",(ws,refs[0].source_id))
    s.drain_queued_messages(ws,grant.id)
    first=s.list_queued_messages(p,ws,good.id).items[0]
    assert first.id==goodq.id and first.state=='admitted'
    s.drain_queued_messages(ws,grant.id)
    assert s.list_queued_messages(p,ws,good.id).items[0]==first
    raises('not_found_or_not_authorized' if cause=='revoked' else 'source_unavailable',lambda:s.list_queued_messages(p,ws,bad.id))
    with Database(admin).transaction() as c:
        data=c.execute('SELECT data FROM conversation_intents WHERE workspace_id=%s AND id=%s',(ws,badq.id)).fetchone()['data']
        assert data['state']=='held' and data['reason']=='scope_changed'
        assert c.execute('SELECT count(*) n FROM runs WHERE workspace_id=%s AND conversation_id=%s',(ws,bad.id)).fetchone()['n']==0
