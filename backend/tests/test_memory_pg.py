"""Real restricted-PG memory behavior. Parent supplies fresh migrated fixture DSNs.

Run with test_domain.context; missing PG is an error, never a mocked pass or skip.
"""
from datetime import timedelta
from hashlib import sha256
from unittest.mock import patch
import json
import psycopg
import pytest
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from workagent.db import Database
from workagent.models import CreateWorkArea, now, new_id
from workagent.service import Principal, encoded
from workagent.memory.models import (RememberMemory, ProposeMemory, ReviewMemory,
    CorrectMemory, NarrowMemory, MemoryCAS, BindMemoryScope, MemorySource, MemoryFile)


def remember(ctx, cv, *, candidate=False, **kw):
    s,p,ws,_,_=ctx
    values=dict(kind='preference',scope_kind='task',scope_id=cv.id,subject_key='writing',
                predicate_key='headings',content='Use concise headings')
    values.update(kw)
    command=cmd(ProposeMemory if candidate else RememberMemory,**values)
    return (s.propose_memory if candidate else s.remember_memory)(p,ws,command),command


def inspect(ctx, value):
    return ctx[0].inspect_memory(ctx[1],ctx[2],value.memory_id)


def test_explicit_inferred_procedure_human_review_and_stale_cas(context):
    s,p,ws,_,_=context;cv=conversation(context)
    explicit,_=remember(context,cv)
    inferred,_=remember(context,cv,candidate=True,subject_key='drafting')
    procedure,_=remember(context,cv,kind='procedure',subject_key='method')
    assert explicit.status=='active' and inferred.status==procedure.status=='candidate'
    assert len(s.list_memory(p,ws,cv.id).items)==1
    review=cmd(ReviewMemory,expected_revision_id=inferred.revision_id,decision='accept')
    raises('not_found_or_not_authorized',lambda:s.review_memory(Principal(p.id,'worker'),ws,inferred.memory_id,review))
    accepted=s.review_memory(p,ws,inferred.memory_id,review)
    assert inspect(context,accepted).current.origin=='human_reviewed'
    assert s.review_memory(p,ws,inferred.memory_id,review)==accepted
    raises('version_conflict',lambda:s.review_memory(p,ws,inferred.memory_id,
        cmd(ReviewMemory,expected_revision_id=inferred.revision_id,decision='accept')))
    assert inspect(context,procedure).current.status=='candidate'


def test_permanent_temporary_and_independent_dispute(context):
    s,p,ws,_,_=context;cv=conversation(context)
    first,_=remember(context,cv,content='Fifteen minutes',valid_from=now()-timedelta(days=1))
    corrected=s.correct_memory(p,ws,first.memory_id,cmd(CorrectMemory,expected_revision_id=first.revision_id,content='Ten minutes'))
    assert inspect(context,corrected).current.supersedes_revision_id==first.revision_id
    start=now();end=start+timedelta(days=7)
    exception=s.correct_memory(p,ws,first.memory_id,cmd(CorrectMemory,expected_revision_id=corrected.revision_id,
        content='Five minutes',mode='temporary',valid_from=start,valid_until=end))
    assert inspect(context,exception).current.exception_to_revision_id==corrected.revision_id
    for at,expected in [(start-timedelta(seconds=1),'Ten minutes'),(start,'Five minutes'),(end,'Ten minutes')]:
        with s.db.transaction() as c:
            s._scope(c,p,ws)
            assert s._recall_memory(c,p,ws,cv.id,at=at).items[0].revision.content==expected
    other,_=remember(context,cv,content='Twenty minutes')
    page=s.list_memory(p,ws,cv.id)
    assert len(page.items)==2 and all(i.unresolved_conflict and i.revision.status=='contested' for i in page.items)
    assert {i.revision.memory_id for i in page.items}=={first.memory_id,other.memory_id}


def test_explicit_project_binding_cross_project_user_and_narrowing(context):
    s,p,ws,_,admin=context
    area=s.create_work_area(p,ws,cmd(CreateWorkArea,title='A',goal='Project A',kind='project',selected_source_refs=[]))
    b=s.create_work_area(p,ws,cmd(CreateWorkArea,title='B',goal='Project B',kind='project',selected_source_refs=[]))
    task=conversation(context)
    m,_=remember(context,area,scope_kind='work_area')
    assert s.list_memory(p,ws,task.id).items==s.list_memory(p,ws,b.id).items==[]
    command=cmd(BindMemoryScope,conversation_id=task.id,work_area_id=area.id,expected_work_version=task.work_version)
    bound=s.bind_memory_scope(p,ws,command)
    assert bound.work_version==task.work_version+1 and s.bind_memory_scope(p,ws,command)==bound
    assert s.list_memory(p,ws,task.id).items[0].why=='explicit_work_area_binding'
    raises('not_found_or_not_authorized',lambda:s.narrow_memory(p,ws,m.memory_id,
        cmd(NarrowMemory,expected_revision_id=m.revision_id,scope_kind='task',scope_id=b.id)))
    other=Principal('other-'+new_id())
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'editor')",(ws,other.id))
    raises('not_found_or_not_authorized',lambda:s.inspect_memory(other,ws,m.memory_id))
    raises('not_found_or_not_authorized',lambda:s.list_memory(other,ws,task.id))
    narrow=s.narrow_memory(p,ws,m.memory_id,cmd(NarrowMemory,expected_revision_id=m.revision_id,scope_kind='task',scope_id=task.id))
    assert inspect(context,narrow).current.scope_id==task.id and s.list_memory(p,ws,area.id).items==[]


def test_source_loss_filters_before_count_query_and_history(context):
    s,p,ws,refs,admin=context;cv=conversation(context)
    m,_=remember(context,cv,source_refs=[MemorySource(ref=refs[0])])
    assert s.list_memory(p,ws,cv.id).items
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',(ws,p.id,refs[0].source_id))
    page=s.list_memory(p,ws,cv.id,query='concise')
    assert page.items==[] and page.has_more is False
    raises('not_found_or_not_authorized',lambda:inspect(context,m))
    forgotten=s.forget_memory(p,ws,m.memory_id,cmd(MemoryCAS,expected_revision_id=m.revision_id))
    assert inspect(context,forgotten).current.content is None


def test_correction_cannot_silently_drop_source_eligibility(context):
    s,p,ws,refs,admin=context;cv=conversation(context)
    m,_=remember(context,cv,source_refs=[MemorySource(ref=refs[0])])
    corrected=s.correct_memory(p,ws,m.memory_id,cmd(CorrectMemory,
        expected_revision_id=m.revision_id,content='Corrected source-backed statement'))
    assert inspect(context,corrected).current.source_refs==[MemorySource(ref=refs[0])]
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',
                  (ws,p.id,refs[0].source_id))
    assert s.list_memory(p,ws,cv.id).items==[]


def test_file_exact_source_reauth_and_valid_time_expiry(context):
    from test_workspace_files_pg import make
    s,p,ws,_,admin=context;cv,file,_=make(context,'Source value')
    m,_=remember(context,cv,source_refs=[MemoryFile(ref=file.current)],expires_at=now()+timedelta(seconds=30))
    assert s.list_memory(p,ws,cv.id).items
    with s.db.transaction() as c:
        assert s._recall_memory(c,p,ws,cv.id,at=now()+timedelta(seconds=31)).items==[]
    # Exact hash mismatch is rejected by the shared file substrate, not downranked.
    raises('source_changed',lambda:remember(context,cv,subject_key='other',source_refs=[MemoryFile(ref=file.current.model_copy(update={'sha256':'0'*64}))]))


def test_forget_all_payloads_tombstone_suppression_and_content_free_command_replay(context):
    s,p,ws,_,_=context;cv=conversation(context)
    m,command=remember(context,cv,content='Erase this original payload')
    correction=cmd(CorrectMemory,expected_revision_id=m.revision_id,content='Erase this correction payload')
    updated=s.correct_memory(p,ws,m.memory_id,correction)
    forgotten=s.forget_memory(p,ws,m.memory_id,cmd(MemoryCAS,expected_revision_id=updated.revision_id))
    detail=inspect(context,forgotten)
    assert all(r.content is None and r.subject_key is None and r.source_refs==[] and r.status=='forgotten' for r in detail.revisions)
    assert s.remember_memory(p,ws,command)==m  # historical content-free receipt, not current state
    assert s.correct_memory(p,ws,m.memory_id,correction)==updated
    assert s.list_memory(p,ws,cv.id).items==[]
    raises('action_unresolved',lambda:remember(context,cv,content='Same key resurrected'))
    with s.db.transaction() as c:
        retained=c.execute('SELECT result FROM commands WHERE workspace_id=%s',(ws,)).fetchall()
        assert 'Erase this' not in json.dumps(retained)
        assert not c.execute('SELECT 1 FROM memory_evidence WHERE workspace_id=%s AND memory_id=%s',(ws,m.memory_id)).fetchone()


def test_restricted_role_direct_writes_origin_and_run_forgery_denied(context):
    s,p,ws,_,_=context;cv=conversation(context)
    m,_=remember(context,cv,candidate=True)
    payload=inspect(context,m).current.model_dump(mode='json')
    for statement,args in [
        ("UPDATE memory_revisions SET data=jsonb_set(data,'{status}','\"active\"') WHERE workspace_id=%s",(ws,)),
        ('UPDATE memory_items SET current_revision_id=%s WHERE workspace_id=%s',(m.revision_id,ws)),
        ('DELETE FROM memory_revisions WHERE workspace_id=%s',(ws,)),
        ('INSERT INTO memory_revisions VALUES (%s,%s,%s,now(),%s)',(ws,m.memory_id,new_id(),encoded(payload)))]:
        with pytest.raises(psycopg.Error),s.db.transaction() as c: c.execute(statement,args)
    for changes in [dict(origin='human_reviewed',status='active',reviewed_by_principal_id=p.id),dict(proposed_by_run_id='forged')]:
        forged={**payload,**changes,'memory_id':new_id(),'revision_id':new_id()}
        with pytest.raises(psycopg.Error),s.db.transaction() as c:
            c.execute('SELECT write_memory_revision(%s,%s,%s,%s,%s)',(ws,p.id,'candidate',None,encoded(forged)))


def test_later_scoped_runtime_manifest_usage_and_stale_unsent_invalidation(context):
    from test_general_alpha_runtime import activate
    from workagent.memory.runtime import POLICY,SCHEMA
    from workagent.request_packing import prepare_selection
    from workagent.responses_transport import RequestMetadata
    s,p,ws,_,_=context;cv=conversation(context)
    m,_=remember(context,cv,scope_kind='user',scope_id=p.id)
    later=conversation(context)
    with patch('test_general_alpha_runtime.POLICY',POLICY),patch('test_general_alpha_runtime.DECISION_SCHEMA',SCHEMA):
        activate(context,later,continuity_version='sustained-v1',max_steps=3)
    q=post(context,later,'Use my remembered formatting preference')
    cap=s.claim_run(p,ws,q.run.id)
    frozen=s.conversation_worker_context(cap)
    assert frozen['memory_context']['items'][0]['revision']['memory_id']==m.memory_id
    assert frozen['memory_manifest'][0]['revision_id']==m.revision_id
    request=prepare_selection(frozen,instructions=POLICY,read_schema=SCHEMA,
        metadata=RequestMetadata(request_id=new_id(),attempt_id=new_id(),step_id='selection'),policy='adaptive-local-v1')
    s.correct_memory(p,ws,m.memory_id,cmd(CorrectMemory,expected_revision_id=m.revision_id,content='Use descriptive headings'))
    raises('source_changed',lambda:s.conversation_worker_context(cap))
    from workagent.errors import DomainError
    with pytest.raises(DomainError) as exc,s.db.transaction() as c: s._check_capability(c,cap)
    assert exc.value.code.value=='source_changed'
    # Previously frozen outgoing bytes and usage retain exact old identities.
    assert b'Use concise headings' in request.body


def test_exact_prepared_request_usage_and_later_synthetic_worker(context,tmp_path):
    from test_general_alpha_runtime import activate, AlphaProvider
    from test_general_responses import worker
    from test_adaptive_execution import finish_safe_visits
    from workagent.memory.runtime import POLICY,SCHEMA
    s,p,ws,_,_=context;cv=conversation(context)
    m,_=remember(context,cv,scope_kind='user',scope_id=p.id)
    later=conversation(context)
    with patch('test_general_alpha_runtime.POLICY',POLICY),patch('test_general_alpha_runtime.DECISION_SCHEMA',SCHEMA):
        activate(context,later,continuity_version='sustained-v1',max_steps=3)
    q=post(context,later,'Use my remembered formatting preference')
    fake=AlphaProvider([{'kind':'reply','text':'A concise heading based on your remembered preference.'}])
    result=finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='ready'
    usage=s.memory_usage(p,ws,q.run.id)
    assert usage.items and all(u.entries[0].revision_id==m.revision_id for u in usage.items)
    assert fake.contexts[0]['memory_manifest'][0]['memory_id']==m.memory_id
    with s.db.transaction() as c:
        for item in usage.items:
            assert c.execute('SELECT 1 FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id '
                "WHERE a.workspace_id=%s AND a.run_id=%s AND s.metadata->>'request_id'=%s",
                (ws,q.run.id,item.request_id)).fetchone()
    s.forget_memory(p,ws,m.memory_id,cmd(MemoryCAS,expected_revision_id=m.revision_id))
    assert s.memory_usage(p,ws,q.run.id)==usage


def test_forgotten_source_fingerprint_suppresses_changed_keys(context):
    s,p,ws,refs,_=context;cv=conversation(context)
    m,_=remember(context,cv,source_refs=[MemorySource(ref=refs[0])])
    s.forget_memory(p,ws,m.memory_id,cmd(MemoryCAS,expected_revision_id=m.revision_id))
    raises('action_unresolved',lambda:remember(context,cv,subject_key='changed-key',
        source_refs=[MemorySource(ref=refs[0])]))


def test_http_typed_receipts_and_erased_inspection(context):
    import secrets
    from fastapi.testclient import TestClient
    from workagent.api import create_app, Settings
    s,p,ws,_,_=context;cv=conversation(context)
    token=secrets.token_urlsafe(32)
    headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()}
    root=f'/v1/workspaces/{ws}/memory'
    command=cmd(RememberMemory,kind='fact',scope_kind='task',scope_id=cv.id,
        subject_key='export',predicate_key='timezone',content='UTC')
    with TestClient(create_app(Settings(s.db.dsn,True,token,p.id))) as client:
        response=client.post(root+'/remember',headers=headers,json=command.model_dump(mode='json'))
        assert response.status_code==201,response.text
        receipt=response.json()
        assert set(receipt)=={'memory_id','revision_id','status'}
        item=root+'/'+receipt['memory_id']
        assert client.get(item,headers=headers).json()['current']['content']=='UTC'
        forgotten=client.post(item+'/forget',headers=headers,json=cmd(MemoryCAS,
            expected_revision_id=receipt['revision_id']).model_dump(mode='json'))
        assert forgotten.status_code==200,forgotten.text
        assert client.post(root+'/remember',headers=headers,json=command.model_dump(mode='json')).json()==receipt
        assert client.get(item,headers=headers).json()['current']['content'] is None
        assert client.get(root,headers=headers,params={'conversation_id':cv.id}).json()['items']==[]
