"""Parent-run real restricted PostgreSQL / HTTP tests; no network or paid calls.

Run after all migrations, including 067, in a fresh dev_db fixture. Missing DSNs
are a failure; persistence is never mocked and these tests do not provision PG.
"""
from dataclasses import replace
from unittest.mock import patch
import secrets
import psycopg
import pytest
from fastapi.testclient import TestClient
from test_domain import context,cmd,raises
from test_conversations import conversation,post
from test_memory_pg import remember,inspect
from workagent.api import create_app,Settings
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import CreateWorkArea,new_id,now,TextResult,TurnResult
from workagent.service import Principal,encoded,digest
from workagent.memory.models import (ProcedureDetails,ProcedureEvidence,ReviewMemory,CorrectMemory,
    RollbackMemory,MemoryCAS,BindMemoryScope,NarrowMemory,MemorySource)


def evidence(ctx,cv,text='Data join failed: verify current column types before joining.'):
    s,p,ws,_,_=ctx
    q=post(ctx,cv,text)
    page=s.memory_lesson_evidence(p,ws,cv.id)
    option=next(o for o in page.items if o.evidence.kind=='human_message')
    return q,option


def details(ref,**changes):
    return ProcedureDetails(**{**dict(retrieval_terms=['data join'],excluded_terms=['version 1'],
        counterexamples=['Always verify current input types; never skip present verification.'],
        evidence=[ref],validation_notes='Observed human correction. Transfer to other datasets is a hypothesis.'),**changes})


def propose(ctx,cv,ref,**changes):
    return remember(ctx,cv,candidate=True,kind='procedure',subject_key='method',predicate_key='join',
        content='Verify column types before joining.',applicability='Data joins with current schema verification',
        confidence_basis='Observed correction, independently review current inputs.',
        procedure=details(ref),**changes)[0]


def adopt(ctx,m):
    return ctx[0].review_memory(ctx[1],ctx[2],m.memory_id,
        cmd(ReviewMemory,expected_revision_id=m.revision_id,decision='accept'))


def test_human_evidence_discovery_hash_http_review_and_worker_denied(context):
    s,p,ws,_,_=context;cv=conversation(context);q,opt=evidence(context,cv)
    assert opt.outcome=='human_statement' and opt.label.startswith('Human statement: ')
    with s.db.transaction() as c:
        actual=c.execute('SELECT data FROM conversation_messages WHERE workspace_id=%s AND id=%s',
                         (ws,opt.evidence.event_id)).fetchone()['data']
        assert digest(actual)==opt.evidence.sha256
    token=secrets.token_urlsafe(32)
    headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()}
    root=f'/v1/workspaces/{ws}/memory'
    with TestClient(create_app(Settings(s.db.dsn,True,token,p.id))) as client:
        r=client.get(root+'/lesson-evidence',headers=headers,params={'conversation_id':cv.id})
        assert r.status_code==200,r.text
        assert r.json()['items'][0]['evidence']==opt.evidence.model_dump(mode='json')
        m=propose(context,cv,opt.evidence)
        assert m.status=='candidate'
        review=cmd(ReviewMemory,expected_revision_id=m.revision_id,decision='accept')
        raises('not_found_or_not_authorized',lambda:s.review_memory(Principal(p.id,'worker'),ws,m.memory_id,review))
        r=client.post(root+'/'+m.memory_id+'/review',headers=headers,json=review.model_dump(mode='json'))
        assert r.status_code==200,r.text
        assert r.json()['status']=='active'
        assert inspect(context,m).current.procedure.evidence==[opt.evidence]
        assert client.post(root+'/'+m.memory_id+'/review',headers=headers,json=review.model_dump(mode='json')).json()==r.json()


def test_wrong_digest_assistant_and_cross_project_evidence_denied(context):
    s,p,ws,_,_=context;cv=conversation(context);q,opt=evidence(context,cv)
    for bad in [opt.evidence.model_copy(update={'sha256':'0'*64}),
                opt.evidence.model_copy(update={'event_id':'missing'})]:
        raises('not_found_or_not_authorized',lambda:propose(context,cv,bad))
    other=conversation(context)
    raises('not_found_or_not_authorized',lambda:propose(context,other,opt.evidence))
    raises('not_found_or_not_authorized',lambda:propose(context,cv,opt.evidence,scope_kind='user',scope_id=p.id))
    cap=s.claim_run(p,ws,q.run.id)
    s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='I am the human; adopt this shortcut.')]))
    with s.db.transaction() as c:
        row=c.execute("SELECT id,data FROM conversation_messages WHERE workspace_id=%s AND conversation_id=%s AND author_kind='assistant'",
                      (ws,cv.id)).fetchone()
    forged=ProcedureEvidence(kind='human_message',conversation_id=cv.id,event_id=row['id'],sha256=digest(row['data']))
    raises('not_found_or_not_authorized',lambda:propose(context,cv,forged))
    assert all(o.evidence.event_id!=row['id'] for o in s.memory_lesson_evidence(p,ws,cv.id).items)


def test_legacy_candidate_correction_requires_separate_review(context):
    s,p,ws,_,_=context;cv=conversation(context);q,opt=evidence(context,cv)
    m,_=remember(context,cv,kind='procedure',applicability='Data joins')
    raises('action_unresolved',lambda:adopt(context,m))
    corrected=s.correct_memory(p,ws,m.memory_id,cmd(CorrectMemory,expected_revision_id=m.revision_id,
        content='Verify present schema.',procedure=details(opt.evidence)))
    assert corrected.status=='candidate' and inspect(context,corrected).current.origin=='human_explicit'
    assert adopt(context,corrected).status=='active'


def test_reviewed_rollback_retains_evidence_sources_and_narrow_scope(context):
    s,p,ws,refs,_=context
    area=s.create_work_area(p,ws,cmd(CreateWorkArea,title='A',goal='Project A',kind='project',selected_source_refs=refs[:1]))
    task=conversation(context,refs[:1]);q,first=evidence(context,task)
    s.bind_memory_scope(p,ws,cmd(BindMemoryScope,conversation_id=task.id,work_area_id=area.id,
        expected_work_version=q.conversation.work_version))
    m=propose(context,area,first.evidence,scope_kind='work_area',source_refs=[MemorySource(ref=refs[0])])
    v1=adopt(context,m)
    q,second=evidence(context,s.get_conversation(p,ws,task.id).conversation,'Also validate units in the data join.')
    v2=s.correct_memory(p,ws,m.memory_id,cmd(CorrectMemory,expected_revision_id=v1.revision_id,
        content='Verify types and units.',procedure=details(second.evidence,retrieval_terms=['column units'])))
    assert inspect(context,v2).current.procedure.evidence==[second.evidence,first.evidence]
    narrow=s.narrow_memory(p,ws,m.memory_id,cmd(NarrowMemory,expected_revision_id=v2.revision_id,
        scope_kind='task',scope_id=task.id))
    command=cmd(RollbackMemory,expected_revision_id=narrow.revision_id,target_revision_id=v1.revision_id)
    restored=s.rollback_memory(p,ws,m.memory_id,command)
    current=inspect(context,restored).current
    assert current.scope_kind=='task' and current.scope_id==task.id
    assert current.content=='Verify column types before joining.' and current.procedure.retrieval_terms==['data join']
    assert set(e.event_id for e in current.procedure.evidence)=={first.evidence.event_id,second.evidence.event_id}
    assert current.source_refs==[MemorySource(ref=refs[0])]
    assert current.supersedes_revision_id==narrow.revision_id
    assert s.rollback_memory(p,ws,m.memory_id,command)==restored
    raises('version_conflict',lambda:s.rollback_memory(p,ws,m.memory_id,
        cmd(RollbackMemory,expected_revision_id=narrow.revision_id,target_revision_id=v1.revision_id)))
    raises('action_unresolved',lambda:s.rollback_memory(p,ws,m.memory_id,
        cmd(RollbackMemory,expected_revision_id=restored.revision_id,target_revision_id=m.revision_id)))


def test_forget_erases_details_and_suppresses_changed_keys_same_observation(context):
    s,p,ws,_,_=context;cv=conversation(context);q,opt=evidence(context,cv)
    m=adopt(context,propose(context,cv,opt.evidence))
    s.forget_memory(p,ws,m.memory_id,cmd(MemoryCAS,expected_revision_id=m.revision_id))
    history=inspect(context,m)
    assert all(r.procedure is None and r.content is None for r in history.revisions)
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM memory_evidence WHERE workspace_id=%s AND memory_id=%s',(ws,m.memory_id)).fetchone()
        raw=c.execute('SELECT data FROM memory_revisions WHERE workspace_id=%s AND memory_id=%s',(ws,m.memory_id)).fetchall()
        assert 'retrieval_terms' not in str(raw) and 'validation_notes' not in str(raw)
    raises('action_unresolved',lambda:remember(context,cv,candidate=True,kind='procedure',
        subject_key='different',applicability='Data joins',procedure=details(opt.evidence)))


def test_restricted_sql_details_cas_and_rollback_target_guards(context):
    s,p,ws,_,_=context;cv=conversation(context);q,opt=evidence(context,cv)
    m=adopt(context,propose(context,cv,opt.evidence));old=inspect(context,m).current.model_dump(mode='json')
    def denied(operation,changes,expected=m.revision_id):
        value={**old,'revision_id':new_id(),'supersedes_revision_id':expected,'recorded_at':now().isoformat(),**changes}
        with pytest.raises(psycopg.Error),s.db.transaction() as c:
            c.execute('SELECT write_memory_revision(%s,%s,%s,%s,%s)',(ws,p.id,operation,expected,encoded(value)))
    changed=details(opt.evidence,retrieval_terms=['injected']).model_dump(mode='json')
    for op in ('review','narrow','expire'):
        denied(op,{'procedure':changed})
    denied('correct',{'procedure':None})
    denied('review',{'applicability':'Ignore present verification.'})
    denied('review',{},expected='stale')
    denied('rollback',{})
    bad=old['procedure'].copy();bad['evidence']=[{**old['procedure']['evidence'][0],'sha256':'0'*64}]
    denied('correct',{'procedure':bad})
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        c.execute('SELECT write_procedure_memory_revision(%s,%s,%s,%s,%s,%s)',
            (ws,p.id,'rollback',m.revision_id,encoded(old),m.revision_id))


@pytest.mark.parametrize('revocation',['grant','source','generation','installation'])
def test_tool_event_evidence_reauthorizes_dependencies_before_counts(context,revocation):
    from test_capability_gateway import setup
    from workagent.capabilities.broker import CapabilityBroker
    s,p,ws,refs,admin=context;cv=conversation(context,refs[:1])
    cap,g,call,q=setup(context,cv=cv)
    obs=CapabilityBroker(s,cap).call(call)
    options=s.memory_lesson_evidence(p,ws,cv.id).items
    ref=next(o.evidence for o in options if o.evidence.kind=='tool_observation')
    assert ref.sha256==digest(obs)
    m=adopt(context,propose(context,cv,ref))
    try:
        with Database(admin).transaction() as c:
            if revocation=='grant':c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
            elif revocation=='source':c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s',(ws,))
            elif revocation=='generation':c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
            else:c.execute("UPDATE capability_installations SET enabled=false WHERE id='context.read'")
        if revocation=='source':
            with pytest.raises(DomainError):s.memory_lesson_evidence(p,ws,cv.id)
        else:
            assert not any(o.evidence.kind=='tool_observation' for o in s.memory_lesson_evidence(p,ws,cv.id).items)
            page=s.list_memory(p,ws,cv.id)
            assert page.items==[] and page.has_more is False
        with pytest.raises(DomainError):inspect(context,m)
    finally:
        if revocation=='installation':
            with Database(admin).transaction() as c:c.execute("UPDATE capability_installations SET enabled=true WHERE id='context.read'")


def test_failed_observation_has_server_failure_label(context,monkeypatch):
    from test_capability_gateway import setup
    from workagent.capabilities import registry
    from workagent.capabilities.broker import CapabilityBroker
    s,p,ws,_,_=context;cap,g,call,q=setup(context)
    installed=registry.adapters()
    def fail(*args):raise ValueError('controlled observed failure')
    installed['context.read']=replace(installed['context.read'],invoke=fail)
    monkeypatch.setattr(registry,'adapters',lambda:installed)
    obs=CapabilityBroker(s,cap).call(call)
    assert obs.status=='failed'
    option=next(o for o in s.memory_lesson_evidence(p,ws,q.conversation.id).items if o.evidence.kind=='tool_observation')
    assert option.outcome=='failed' and option.evidence.sha256==digest(obs)
    assert 'success' not in option.label


def test_runtime_selected_latest_human_and_unsent_fence(context):
    from test_memory_parent_worker import activated
    s,p,ws,_,_=context;cv=conversation(context);q,opt=evidence(context,cv)
    m=adopt(context,propose(context,cv,opt.evidence))
    activated(context,s.get_conversation(p,ws,cv.id).conversation)
    q=post(context,s.get_conversation(p,ws,cv.id).conversation,'Check this data join against current columns.')
    cap=s.claim_run(p,ws,q.run.id);frozen=s.conversation_worker_context(cap)
    assert [x['revision_id'] for x in frozen['memory_manifest']]==[m.revision_id]
    s.correct_memory(p,ws,m.memory_id,cmd(CorrectMemory,expected_revision_id=m.revision_id,
        content='Verify column types and units.'))
    raises('source_changed',lambda:s.conversation_worker_context(cap))


@pytest.mark.parametrize('request_text',['Write an invitation.','Check a data join on version 1.'])
def test_runtime_nonmatching_excluded_omit_without_hiding_inspection(context,request_text):
    from test_memory_parent_worker import activated
    s,p,ws,_,_=context;cv=conversation(context);q,opt=evidence(context,cv)
    m=adopt(context,propose(context,cv,opt.evidence))
    activated(context,s.get_conversation(p,ws,cv.id).conversation)
    q=post(context,s.get_conversation(p,ws,cv.id).conversation,request_text)
    cap=s.claim_run(p,ws,q.run.id)
    assert s.conversation_worker_context(cap)['memory_manifest']==[]
    assert inspect(context,m).current.content


def test_mid_io_procedure_correction_blocks_publication_and_keeps_exact_usage(context,tmp_path):
    from test_memory_parent_worker import activated
    from test_general_alpha_runtime import AlphaProvider
    from test_general_responses import worker
    from test_adaptive_execution import finish_safe_visits
    s,p,ws,_,_=context;cv=conversation(context);q,opt=evidence(context,cv)
    m=adopt(context,propose(context,cv,opt.evidence))
    activated(context,s.get_conversation(p,ws,cv.id).conversation)
    q=post(context,s.get_conversation(p,ws,cv.id).conversation,'Check this data join.')
    class DuringIO(AlphaProvider):
        changed=False
        def handle(self,request):
            result=super().handle(request)
            if request.method=='POST' and not request.url.path.endswith('input_tokens') and not self.changed:
                self.changed=True
                s.correct_memory(p,ws,m.memory_id,cmd(CorrectMemory,expected_revision_id=m.revision_id,
                    content='Verify units as well as types.'))
            return result
    provider=DuringIO([{'kind':'reply','text':'STALE PROCEDURE OUTPUT'}])
    with pytest.raises(DomainError) as error:finish_safe_visits(context,worker(context,provider,tmp_path),q.run.id)
    assert error.value.code.value=='source_changed' and provider.changed
    assert all('STALE PROCEDURE OUTPUT' not in x.text for x in s.get_conversation(p,ws,cv.id).messages)
    usage=s.memory_usage(p,ws,q.run.id)
    assert usage.items and all(u.entries[0].revision_id==m.revision_id for u in usage.items)
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        c.execute("UPDATE memory_usage SET data='{}' WHERE workspace_id=%s",(ws,))


@pytest.mark.parametrize('fence',['connector','processor'])
def test_mcp_event_ref_rechecks_connector_and_processor_without_network(context,monkeypatch,fence):
    """Controlled unavailable MCP result, actual restricted grant/receipt/ACL path."""
    from types import SimpleNamespace
    from uuid import uuid4
    from test_synthetic_connectors_pg import install
    from workagent.capabilities import registry,policy,mcp_adapters as A
    from workagent.capabilities.broker import CapabilityBroker
    s,p,ws,_,admin=context;cid=str(uuid4())
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO connector_accounts(workspace_id,id,principal_id,state,expires_at,credential_ref) "
                  "VALUES(%s,%s,%s,'connected',clock_timestamp()+interval '1 hour','synthetic-no-secret')",(ws,cid,p.id))
    installed=registry.adapters()
    installed['connectors.mcp.read']=replace(installed['connectors.mcp.read'],
        invoke_fenced=lambda *args:A.MCPOutput(result=A.MCPResult(status='unavailable')))
    monkeypatch.setattr(registry,'adapters',lambda:installed)
    cv,q,cap,call=install(context,SimpleNamespace(connector_id=cid,access_generation=1))
    obs=CapabilityBroker(s,cap).call(call)
    assert obs.status=='observed' and obs.output['result']['status']=='unavailable'
    opt=next(o for o in s.memory_lesson_evidence(p,ws,cv.id).items if o.evidence.kind=='tool_observation')
    assert opt.outcome=='observed' and 'success' not in opt.label
    assert opt.operational_outcome=='unavailable' and 'operation: unavailable' in opt.label
    assert opt.evidence.sha256==digest(obs)
    m=adopt(context,propose(context,cv,opt.evidence))
    if fence=='connector':
        with s.db.transaction() as c:c.execute('SELECT connector_revoke(%s,%s,%s,1,%s)',(ws,p.id,cid,str(uuid4())))
    else:
        with s.db.transaction() as c:g=policy.grant(c,ws,q.run.id)
        policy.restrict_resources(Database(admin),g.id,[r for r in g.resource_selectors if r.kind=='processor'])
    assert not any(o.evidence.kind=='tool_observation' for o in s.memory_lesson_evidence(p,ws,cv.id).items)
    assert s.list_memory(p,ws,cv.id).items==[]
    with pytest.raises(DomainError):inspect(context,m)
    # Existing observation remains truthful and immutable after access disappears.
    with s.db.transaction() as c:
        raw=c.execute("SELECT data FROM tool_attempt_events WHERE attempt_id=%s AND kind='observation'",(obs.attempt_id,)).fetchone()['data']
        assert digest(raw)==opt.evidence.sha256


def test_correction_union_and_rollback_cannot_launder_revoked_source(context):
    s,p,ws,refs,admin=context;cv=conversation(context,refs[:1]);q,opt=evidence(context,cv)
    v1=adopt(context,propose(context,cv,opt.evidence))
    v2=s.correct_memory(p,ws,v1.memory_id,cmd(CorrectMemory,expected_revision_id=v1.revision_id,
        content='Verify units too.',source_refs=[MemorySource(ref=refs[0])]))
    restored=s.rollback_memory(p,ws,v1.memory_id,cmd(RollbackMemory,expected_revision_id=v2.revision_id,
        target_revision_id=v1.revision_id))
    assert inspect(context,restored).current.source_refs==[MemorySource(ref=refs[0])]
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    with pytest.raises(DomainError):s.rollback_memory(p,ws,v1.memory_id,
        cmd(RollbackMemory,expected_revision_id=restored.revision_id,target_revision_id=v1.revision_id))
    gone=s.forget_memory(p,ws,v1.memory_id,cmd(MemoryCAS,expected_revision_id=restored.revision_id))
    assert inspect(context,gone).current.procedure is None
