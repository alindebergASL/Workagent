"""Synthetic, restricted-role PG adversarial dependency tests; missing DSNs fail."""
from datetime import timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
import psycopg
import pytest
from test_domain import context, cmd, raises
from test_conversations import conversation
from test_memory_pg import remember, inspect
from test_procedure_memory_pg import evidence, details, propose, adopt
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import new_id, now, CreateWorkArea
from workagent.service import encoded, Principal, Service
from workagent.memory.models import (MemoryDerived, MemoryRevisionRef, MemorySource,
    MemoryFile, MemoryCAS, CorrectMemory, NarrowMemory, BindMemoryScope, ReviewMemory)


def edge(ctx, receipt):
    r=inspect(ctx,receipt).current
    return MemoryDerived(ref=MemoryRevisionRef(memory_id=r.memory_id,revision_id=r.revision_id,sha256=r.content_sha256))


def child(ctx, cv, parent, **kw):
    return remember(ctx,cv,subject_key='derived-'+new_id(),source_refs=[edge(ctx,parent)],**kw)[0]


def ids(s,p,ws,cid,**kw):
    page=s.list_memory(p,ws,cid,**kw)
    return {i.revision.memory_id for i in page.items},page.has_more


@pytest.mark.parametrize('mutation',['correct','narrow','expire','temporary'])
def test_exact_transitive_dependencies_invalidate_before_counts_and_inspection(context,mutation):
    s,p,ws,_,_=context;cv=conversation(context)
    root,_=remember(context,cv,scope_kind='user',scope_id=p.id)
    a=child(context,cv,root);b=child(context,cv,a)
    assert {root.memory_id,a.memory_id,b.memory_id}==ids(s,p,ws,cv.id)[0]
    if mutation=='narrow':
        s.narrow_memory(p,ws,root.memory_id,cmd(NarrowMemory,expected_revision_id=root.revision_id,scope_kind='task',scope_id=cv.id))
    elif mutation=='expire':
        s.expire_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    else:
        extra={} if mutation=='correct' else dict(mode='temporary',valid_from=now()+timedelta(days=1),valid_until=now()+timedelta(days=2))
        s.correct_memory(p,ws,root.memory_id,cmd(CorrectMemory,expected_revision_id=root.revision_id,content='Revised value',**extra))
    assert not ({a.memory_id,b.memory_id}&ids(s,p,ws,cv.id)[0])
    assert ids(s,p,ws,cv.id,subject_key='derived')[1] is False
    for item in (a,b):raises('not_found_or_not_authorized',lambda:inspect(context,item))


@pytest.mark.parametrize('loss',['access','version','observed_at','unavailable'])
def test_transitive_source_loss_is_not_a_count_or_read_side_channel(context,loss):
    s,p,ws,refs,admin=context;cv=conversation(context)
    root,_=remember(context,cv,source_refs=[MemorySource(ref=refs[0])]);a=child(context,cv,root);b=child(context,cv,a)
    with Database(admin).transaction() as c:
        if loss=='access':c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
        else:
            key,value={'version':('external_version','new-version'),'observed_at':('observed_at',now().isoformat()),'unavailable':('available',False)}[loss]
            c.execute('UPDATE sources SET data=jsonb_set(data,%s,%s) WHERE workspace_id=%s AND id=%s',([key],encoded(value),ws,refs[0].source_id))
    assert ids(s,p,ws,cv.id,query='headings')==(set(),False)
    for item in (a,b):raises('not_found_or_not_authorized',lambda:inspect(context,item))
    # Revocation must not block erasure of either the root or descendants.
    s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    assert inspect(context,b).current.status=='forgotten'


def test_time_current_hash_owner_and_scope_intersection(context):
    s,p,ws,_,admin=context;cv=conversation(context);other=conversation(context)
    area=s.create_work_area(p,ws,cmd(CreateWorkArea,title='Synthetic A',goal='A',kind='project',selected_source_refs=[]))
    root,_=remember(context,area,scope_kind='work_area',expires_at=now()+timedelta(hours=1))
    for scope,sid in [('user',p.id),('task',cv.id),('work_area',other.id)]:
        raises('not_found_or_not_authorized',lambda:child(context,cv,root,scope_kind=scope,scope_id=sid))
    s.bind_memory_scope(p,ws,cmd(BindMemoryScope,conversation_id=cv.id,work_area_id=area.id,expected_work_version=cv.work_version))
    a=child(context,cv,root)
    raises('not_found_or_not_authorized',lambda:child(context,area,a,scope_kind='work_area'))
    with s.db.transaction() as c:
        page=s._recall_memory(c,p,ws,cv.id,at=now()+timedelta(hours=2))
        assert page.items==[] and not page.has_more
    bad=edge(context,root).model_copy(update={'ref':edge(context,root).ref.model_copy(update={'sha256':'0'*64})})
    raises('not_found_or_not_authorized',lambda:remember(context,cv,subject_key='bad',source_refs=[bad]))
    other_owner=Principal('synthetic-'+new_id())
    with Database(admin).transaction() as c:c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES(%s,%s,'editor')",(ws,other_owner.id))
    raises('not_found_or_not_authorized',lambda:s.inspect_memory(other_owner,ws,a.memory_id))
    with s.db.transaction() as c:
        assert not c.execute('SELECT memory_dependencies_authorized(%s,%s,%s,%s,%s,%s,now()) AS ok',
            (ws,other_owner.id,'user',other_owner.id,None,encoded([edge(context,root).model_dump(mode='json')]))).fetchone()['ok']


def test_restricted_sql_cycle_forgery_and_private_erasure_denied(context):
    s,p,ws,_,_=context;cv=conversation(context);root,_=remember(context,cv);a=child(context,cv,root)
    old=inspect(context,root).current.model_dump(mode='json')
    for ref in [edge(context,root),edge(context,a),edge(context,a).model_copy(update={'ref':MemoryRevisionRef(memory_id=a.memory_id,revision_id='missing',sha256='0'*64)})]:
        forged={**old,'revision_id':new_id(),'supersedes_revision_id':root.revision_id,'origin':'human_reviewed',
                'reviewed_by_principal_id':p.id,'source_refs':[ref.model_dump(mode='json')]}
        with pytest.raises(psycopg.Error),s.db.transaction() as c:
            c.execute('SELECT write_memory_revision(%s,%s,%s,%s,%s)',(ws,p.id,'correct',root.revision_id,encoded(forged)))
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        c.execute('SELECT erase_memory_payload(%s,%s,%s,%s,%s)',(ws,p.id,root.memory_id,root.revision_id,new_id()))
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        c.execute("SET LOCAL workagent.memory_erasure='on'")
        c.execute("UPDATE memory_revisions SET data=jsonb_set(data,'{status}','\"forgotten\"') WHERE workspace_id=%s",(ws,))
    assert inspect(context,root).current.revision_id==root.revision_id


def test_forget_diamond_history_atomicity_tombstones_and_human_file_preservation(context):
    from test_workspace_files_pg import make
    s,p,ws,_,_=context;cv,file,_=make(context,'Synthetic saved human value')
    root,_=remember(context,cv,source_refs=[MemoryFile(ref=file.current)])
    a=child(context,cv,root);b=child(context,cv,root)
    leaf,_=remember(context,cv,subject_key='diamond',source_refs=[edge(context,a),edge(context,b)])
    updated=s.correct_memory(p,ws,leaf.memory_id,cmd(CorrectMemory,expected_revision_id=leaf.revision_id,content='Synthetic corrected descendant'))
    with s.db.transaction() as c:
        before=c.execute('SELECT data FROM revisions WHERE workspace_id=%s ORDER BY id',(ws,)).fetchall()
        # A transaction failure after recursive forget rolls every erasure back.
    with pytest.raises(RuntimeError),s.db.transaction() as c:
        c.execute('SELECT forget_memory(%s,%s,%s,%s,%s)',(ws,p.id,root.memory_id,root.revision_id,new_id()))
        raise RuntimeError('synthetic rollback')
    assert inspect(context,updated).current.content=='Synthetic corrected descendant'
    s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    for item in (root,a,b,leaf):
        detail=inspect(context,item)
        assert all(r.content is None and r.applicability is None and r.procedure is None and not r.source_refs and r.subject_key is None for r in detail.revisions)
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM memory_evidence WHERE workspace_id=%s',(ws,)).fetchone()
        assert before==c.execute('SELECT data FROM revisions WHERE workspace_id=%s ORDER BY id',(ws,)).fetchall()
        assert c.execute('SELECT count(DISTINCT memory_id) AS n FROM memory_tombstones WHERE workspace_id=%s',(ws,)).fetchone()['n']==4
    another=conversation(context)
    raises('action_unresolved',lambda:remember(context,another,subject_key='new-key',source_refs=[MemoryFile(ref=file.current)]))
    # A fresh service has no cache capable of restoring the forgotten payload.
    assert Service(s.db).list_memory(p,ws,cv.id).items==[]


def test_cross_scope_source_suppression_enforced_in_sql(context):
    s,p,ws,refs,_=context;cv=conversation(context);root,_=remember(context,cv,source_refs=[MemorySource(ref=refs[0])])
    payload=inspect(context,root).current.model_dump(mode='json')
    s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    raises('action_unresolved',lambda:remember(context,cv,scope_kind='user',scope_id=p.id,subject_key='another',source_refs=[MemorySource(ref=refs[0])]))
    payload.update(memory_id=new_id(),revision_id=new_id(),scope_kind='user',scope_id=p.id,subject_key='sql-other')
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        c.execute('SELECT write_memory_revision(%s,%s,%s,NULL,%s)',(ws,p.id,'remember',encoded(payload)))
    equivalent=refs[0].model_copy(update={'observed_at':refs[0].observed_at.astimezone(timezone(timedelta(hours=3)))})
    raises('action_unresolved',lambda:remember(context,cv,scope_kind='user',scope_id=p.id,
        subject_key='timezone-key',source_refs=[MemorySource(ref=equivalent)]))


def test_explicit_applicability_and_procedure_details_correction(context):
    s,p,ws,_,_=context;cv=conversation(context);_,opt=evidence(context,cv)
    root=adopt(context,propose(context,cv,opt.evidence));a=child(context,cv,root)
    command=cmd(CorrectMemory,expected_revision_id=root.revision_id,content='Verify present units.',
        applicability='Only unit-aware joins',procedure=details(opt.evidence,retrieval_terms=['unit join'],excluded_terms=['legacy join']))
    raises('not_found_or_not_authorized',lambda:s.correct_memory(Principal(p.id,'worker'),ws,root.memory_id,command))
    corrected=s.correct_memory(p,ws,root.memory_id,command)
    assert s.correct_memory(p,ws,root.memory_id,command)==corrected
    current=inspect(context,corrected).current
    assert current.applicability=='Only unit-aware joins' and current.procedure.excluded_terms==['legacy join']
    assert current.procedure.evidence==[opt.evidence] and a.memory_id not in ids(s,p,ws,cv.id)[0]
    corrected=s.correct_memory(p,ws,root.memory_id,cmd(CorrectMemory,expected_revision_id=corrected.revision_id,content='Verify units again.'))
    assert inspect(context,corrected).current.applicability==current.applicability
    s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=corrected.revision_id))
    assert inspect(context,a).current.status=='forgotten'


def test_restricted_sql_scope_laundering_and_ineligible_parents(context):
    s,p,ws,_,_=context;cv=conversation(context);other=conversation(context)
    root,_=remember(context,cv);a=child(context,cv,root)
    payload=inspect(context,a).current.model_dump(mode='json')
    for scope,sid in [('user',p.id),('task',other.id)]:
        forged={**payload,'memory_id':new_id(),'revision_id':new_id(),'scope_kind':scope,'scope_id':sid}
        with pytest.raises(psycopg.Error),s.db.transaction() as c:
            c.execute('SELECT write_memory_revision(%s,%s,%s,NULL,%s)',(ws,p.id,'remember',encoded(forged)))
    for changes in [dict(candidate=True),dict(valid_from=now()+timedelta(days=1)),dict(expires_at=now()-timedelta(days=1))]:
        parent,_=remember(context,cv,subject_key='ineligible-'+new_id(),**changes)
        raises('not_found_or_not_authorized',lambda:child(context,cv,parent))


def test_forget_serializes_against_new_descendant(context):
    from threading import Barrier
    s,p,ws,_,_=context;cv=conversation(context);root,_=remember(context,cv)
    ref=edge(context,root);barrier=Barrier(2)
    def derive():
        barrier.wait()
        try:
            return remember(context,cv,subject_key='racing-child',source_refs=[ref])[0]
        except (DomainError,psycopg.Error):
            return None
    def forget():
        barrier.wait()
        return s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    with ThreadPoolExecutor(max_workers=2) as pool:
        derived=pool.submit(derive);forgotten=pool.submit(forget)
        result=derived.result();assert forgotten.result().status=='forgotten'
    if result is not None:assert inspect(context,result).current.status=='forgotten'
    assert ids(s,p,ws,cv.id)==(set(),False)


def test_procedure_ancestor_evidence_reauth_before_omission_count(context):
    from test_capability_gateway import setup
    from workagent.capabilities.broker import CapabilityBroker
    s,p,ws,_,admin=context;cv=conversation(context)
    cap,grant,call,_=setup(context,cv=cv)
    CapabilityBroker(s,cap).call(call)
    ref=next(o.evidence for o in s.memory_lesson_evidence(p,ws,cv.id).items if o.evidence.kind=='tool_observation')
    root=adopt(context,propose(context,cv,ref))
    descendants=[child(context,cv,root) for _ in range(13)]
    assert ids(s,p,ws,cv.id)[1]
    with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(grant.id,))
    assert ids(s,p,ws,cv.id)==(set(),False)
    raises('not_found_or_not_authorized',lambda:inspect(context,descendants[0]))
    s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    assert inspect(context,descendants[-1]).current.status=='forgotten'


def test_bounded_depth_fail_closed(context):
    s,p,ws,_,_=context;cv=conversation(context);root,_=remember(context,cv)
    tip=root
    for _ in range(16):tip=child(context,cv,tip)
    # SQL rejects the seventeenth edge even if preflight used an anonymous root.
    with pytest.raises((psycopg.Error, DomainError)) as failure:child(context,cv,tip)
    assert 'dependenc' in str(failure.value) or getattr(failure.value,'code',None) is not None
    s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    assert inspect(context,tip).current.status=='forgotten'
