"""One parent-run restricted-PG metadata lifecycle; no real provider/native I/O.

Current fixture84 and ordinary release bootstrap only. Reuses actual memory
producer visibility; no function overrides, historical receipts or source spoof.
"""
from unittest.mock import patch
import pytest
from test_native_retained_projection_pg import context, approved_disposable_release
from test_domain import cmd
from test_conversations import post
from test_work_area_context import saved, document
from test_memory_pg import remember
from test_memory_parent_worker import activated
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker, target
from retained_read_visits import finish_natural_visits
from workagent.db import Database
from workagent.errors import DomainError
from workagent.memory.models import MemorySource
from workagent.models import HumanSave
from workagent.capabilities.broker import CapabilityBroker


def producer_history(s,ws,rid):
    with s.db.transaction() as c:
        aid=c.execute('SELECT id FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchone()['id']
        return {
            'attempt':c.execute('SELECT * FROM provider_attempts WHERE id=%s',(aid,)).fetchone(),
            'steps':c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s ORDER BY phase',(aid,)).fetchall(),
            'events':c.execute('SELECT * FROM responses_events WHERE attempt_id=%s ORDER BY id',(aid,)).fetchall(),
            'products':c.execute('SELECT * FROM product_observations WHERE workspace_id=%s AND run_id=%s ORDER BY id',(ws,rid)).fetchall(),
            'native':c.execute('SELECT * FROM tool_attempts WHERE workspace_id=%s ORDER BY id',(ws,)).fetchall(),
            'native_events':c.execute('SELECT e.* FROM tool_attempt_events e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s ORDER BY e.attempt_id,e.kind',(ws,)).fetchall(),
            'native_costs':c.execute('SELECT e.* FROM tool_cost_entries e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s ORDER BY e.attempt_id,e.kind',(ws,)).fetchall(),
            'revisions':c.execute('SELECT * FROM revisions WHERE workspace_id=%s ORDER BY artifact_id,id',(ws,)).fetchall(),
        }


def test_blocks_metadata_visible_then_hidden_after_normal_source_revoke(context,tmp_path):
    s,p,ws,refs,admin=context
    cv,human=saved(context)
    human=s.human_save(p,ws,human.id,cmd(HumanSave,expected_current_revision_id=human.current_revision_id,
                                      body=document('Unrelated human work remains exact')))
    root,_=remember(context,cv,source_refs=[MemorySource(ref=refs[0])])
    activated(context,cv)
    cv=s.get_conversation(p,ws,cv.id).conversation
    q=post(context,cv,'Publish a separate blocks draft using the remembered source; leave human work intact.')
    fake=AlphaProvider([dict(kind='publish_artifact',target=None,body=document('SOURCE_BOUND_BLOCKS_METADATA')),
                        dict(kind='reply',text='Prepared the separate draft.')])
    result=finish_natural_visits(context,worker(context,fake,tmp_path/'producer'),q.run.id)
    assert result.state=='ready'
    assert root.revision_id in {x['revision_id'] for x in fake.contexts[0]['memory_manifest']}
    detail=s.get_conversation(p,ws,cv.id)
    ids=set(detail.artifact_ids)-{human.id};assert len(ids)==1
    derived=s.get_artifact(p,ws,ids.pop())
    assert derived.current_revision.body.blocks[0].text=='SOURCE_BOUND_BLOCKS_METADATA'
    old=producer_history(s,ws,q.run.id);calls=list(fake.calls)

    def no_effect(*args,**kwargs):raise AssertionError('Metadata context must not send provider/native effects')
    with patch('httpx.Client.send',no_effect),patch.object(CapabilityBroker,'call',no_effect):
        # Real fresh admission + ordinary claim; no Responses prepare/count/create.
        before=post(context,detail.conversation,'Show current bindable work, without changing it.')
        w=worker(context,fake,tmp_path/'context')
        cap=w._claim_responses_run(p,ws,before.run.id)
        shown=s.conversation_worker_context(cap)
        assert {human.id,derived.id}<={r['artifact_id'] for r in shown['bindable_artifacts']}
        assert next(r for r in shown['bindable_artifacts'] if r['artifact_id']==derived.id)=={
            'artifact_id':derived.id,'revision_id':derived.current_revision_id,
            'body_hash':derived.current_revision.body_hash,'title':derived.current_revision.body.title}
        with s.db.transaction() as c:
            frozen=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,before.run.id)).fetchone()['data']
            assert c.execute('SELECT memory_revision_visible(%s,%s,%s) ok',(ws,derived.id,derived.current_revision_id)).fetchone()['ok']
        # Normal owner source-access revocation; no grant, expiry or receipt edits.
        with Database(admin).transaction() as c:
            assert c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s AND active RETURNING source_id',
                             (ws,refs[0].source_id)).fetchall()
        with s.db.transaction() as c:
            assert not c.execute('SELECT memory_revision_visible(%s,%s,%s) ok',(ws,derived.id,derived.current_revision_id)).fetchone()['ok']
        with pytest.raises(DomainError) as denied:s.conversation_worker_context(cap)
        assert denied.value.code.value in ('source_changed','not_found_or_not_authorized')
        with s.db.transaction() as c:
            assert c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,before.run.id)).fetchone()['data']==frozen
        current=s.get_conversation(p,ws,cv.id).conversation
        with pytest.raises(DomainError) as denied:
            post(context,current,'Read the exact now-hidden draft.',target=target(derived))
        assert denied.value.code.value=='not_found_or_not_authorized'
        # Ordinary human steering supersedes the idle, unexecuted context run.
        fresh=post(context,current,'Show only work still visible under current access.')
        cap=w._claim_responses_run(p,ws,fresh.run.id)
        hidden=s.conversation_worker_context(cap)
        assert derived.id not in {r['artifact_id'] for r in hidden['bindable_artifacts']}
        assert human.id in {r['artifact_id'] for r in hidden['bindable_artifacts']}
        preserved=s.get_artifact(p,ws,human.id)
        assert preserved.current_revision_id==human.current_revision_id and preserved.current_revision==human.current_revision
        assert producer_history(s,ws,q.run.id)==old
        assert fake.calls==calls
        with s.db.transaction() as c:
            assert not c.execute('SELECT 1 FROM provider_attempts WHERE workspace_id=%s AND run_id=ANY(%s)',
                                 (ws,[before.run.id,fresh.run.id])).fetchall()
