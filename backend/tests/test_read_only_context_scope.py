"""Read-only context authority cannot admit/rebind old or unknown work."""
import copy
import pytest
import psycopg
from test_domain import context,cmd,raises
from test_conversations import conversation,post
from test_work_area_context import saved,document
from test_alpha_budget import grant_for
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_saved_work_retrieval import CheckedProvider
from workagent.db import Database
from workagent.models import HumanSave,CreateConversation,new_id
from workagent.provider_attempts import configure_grant,revoke_grant
from workagent.service import encoded,Service


def test_new_execution_scope_can_read_old_unknown_scope_without_retry(context,tmp_path):
    s,p,ws,_,admin=context
    prior,art=saved(context)
    art=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,
        body=document('Workshop correction: use plain language and a ten minute setup.')))
    old=grant_for(context,[prior]);configure_grant(Database(admin),old)
    q=post(context,prior,'An unrelated original request that will lose its provider response.')
    lost=AlphaProvider([{'kind':'reply','text':'Unreturned original answer'}],lose_phase='selection')
    worker(context,lost,tmp_path/'old').work(p,ws,q.run.id)
    with s.db.transaction() as c:
        attempt=c.execute('SELECT id FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['id']
        def frozen():
            return {table:c.execute('SELECT to_jsonb(t) row FROM '+table+' t WHERE '+key+'=%s ORDER BY to_jsonb(t)::text',(value,)).fetchall()
                    for table,key,value in [('runs','id',q.run.id),('run_configurations','run_id',q.run.id),('provider_attempts','id',attempt),('responses_steps','attempt_id',attempt),('responses_events','attempt_id',attempt)]}
        before=frozen()
    calls=list(lost.calls);revoke_grant(Database(admin),old.id)
    cv=conversation(context);g=grant_for(context,[cv]);configure_grant(Database(admin),g,context_conversation_ids=[prior.id])
    new=post(context,cv,'Use our previous workshop correction without changing the original work.')
    def answer(ctx):
        hits=ctx['adaptive']['observations'][0]['capability_result']['result']['matches']
        assert any('ten minute' in h['excerpt'] for h in hits)
        return {'kind':'reply','text':'Use plain language and ten minutes for setup, per the saved correction.'}
    fake=CheckedProvider([{'kind':'search_work_context','query':'workshop correction','limit':6},answer])
    assert worker(context,fake,tmp_path/'new').work(p,ws,new.run.id).state=='ready'
    if fake.failures:raise fake.failures[0]
    assert lost.calls==calls
    with s.db.transaction() as c:assert frozen()==before
    assert s.get_provider_attempt(p,ws,q.run.id).grant_id==old.id
    current=s.get_conversation(p,ws,prior.id).conversation
    raises('action_unresolved',lambda:post(context,current,'Never reopen the unknown operation with new read authority'))
    assert s.get_artifact(p,ws,art.id).current_revision_id==art.current_revision_id


@pytest.mark.parametrize('invalid',['not_owned','source_bearing','other_workspace','duplicate','empty'])
def test_context_scope_install_is_owner_only_scoped_and_atomic(context,invalid):
    from workagent.runtime_config import BundleDenied
    s,p,ws,refs,admin=context;cv=conversation(context)
    prior=s.create_conversation(p,ws,cmd(CreateConversation,selected_source_refs=refs[:1] if invalid=='source_bearing' else []))
    if invalid=='not_owned':
        with Database(admin).transaction() as c:
            c.execute("UPDATE conversations SET data=jsonb_set(data,'{owner_id}','\"someone-else\"') WHERE workspace_id=%s AND id=%s",(ws,prior.id))
    ids=[] if invalid=='empty' else [prior.id,prior.id] if invalid=='duplicate' else ['foreign-context-id'] if invalid=='other_workspace' else [prior.id]
    g=grant_for(context,[cv])
    with pytest.raises((psycopg.Error,BundleDenied)):configure_grant(Database(admin),g,context_conversation_ids=ids)
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM provider_grants WHERE id=%s',(g.id,)).fetchone()
        assert not c.execute('SELECT 1 FROM general_context_scopes WHERE grant_id=%s',(g.id,)).fetchone()


def test_scope_cannot_be_added_after_admission_or_changed_even_by_owner(context):
    s,p,ws,_,admin=context;prior=conversation(context);cv=conversation(context)
    g=grant_for(context,[cv]);configure_grant(Database(admin),g)
    post(context,cv,'Admit a self-contained request')
    with pytest.raises(psycopg.Error,match='unused'):
        with Database(admin).transaction() as c:
            c.execute('INSERT INTO general_context_scopes(grant_id,conversation_ids) VALUES (%s,%s)',(g.id,encoded([prior.id])))
    revoke_grant(Database(admin),g.id)
    other=conversation(context);g2=grant_for(context,[other]);configure_grant(Database(admin),g2,context_conversation_ids=[prior.id])
    for sql in ('UPDATE general_context_scopes SET conversation_ids=conversation_ids WHERE grant_id=%s','DELETE FROM general_context_scopes WHERE grant_id=%s'):
        with pytest.raises(psycopg.Error,match='immutable'):
            with Database(admin).transaction() as c:c.execute(sql,(g2.id,))
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute('INSERT INTO general_context_scopes(grant_id,conversation_ids) VALUES (%s,%s)',(g.id,encoded([prior.id])))


def test_extra_context_source_still_fences_sql_publication(context,tmp_path):
    from workagent.models import ConversationMessage,TurnResult,TextResult,CancelConversation
    from workagent.errors import DomainError
    s,p,ws,_,admin=context;prior,art=saved(context);cv=conversation(context)
    g=grant_for(context,[cv]);configure_grant(Database(admin),g,context_conversation_ids=[prior.id])
    q=post(context,cv,'Summarize the saved original context')
    text='The original saved draft is retained.'
    fake=CheckedProvider([{'kind':'search_work_context','query':'original','limit':1},{'kind':'reply','text':text}]);w=worker(context,fake,tmp_path)
    def hook(name):
        if name=='before_publication':s.cancel_conversation(p,ws,prior.id,cmd(CancelConversation,expected_work_version=prior.work_version))
    w.phases.hook=hook
    with pytest.raises(DomainError):w.work(p,ws,q.run.id)
    attempt=s.get_provider_attempt(p,ws,q.run.id)
    message=ConversationMessage(id=new_id(),conversation_id=cv.id,run_id=q.run.id,sequence=2,
        author_id='general-worker',author_kind='assistant',text=text,evidence_origin='synthetic_provider_receipt',
        result=TurnResult(results=[TextResult(text=text)]),model_receipt=attempt.id)
    with pytest.raises(psycopg.Error,match='retained search'):
        with s.db.transaction() as c:s._append_message(c,ws,message)


@pytest.mark.parametrize('value',[None,{},[None],[1],[True],['bad id'],['x'*129]])
def test_direct_sql_context_scope_requires_typed_identifiers(context,value):
    s,p,ws,_,admin=context;cv=conversation(context);g=grant_for(context,[cv]);configure_grant(Database(admin),g)
    with pytest.raises(psycopg.Error):
        with Database(admin).transaction() as c:
            c.execute('INSERT INTO general_context_scopes(grant_id,conversation_ids) VALUES (%s,%s)',(g.id,encoded(value)))


def test_context_install_cannot_race_an_admitted_run(context,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    s,p,ws,_,admin=context;cv=conversation(context);prior=conversation(context)
    g=grant_for(context,[cv]);configure_grant(Database(admin),g)
    entered=Event();release=Event();owner_started=Event();original=s._admit_conversation_turn
    def hold(*args,**kw):
        entered.set();assert release.wait(10)
        return original(*args,**kw)
    def install():
        owner_started.set()
        with pytest.raises(psycopg.Error,match='unused'):
            with Database(admin).transaction() as c:
                c.execute('INSERT INTO general_context_scopes(grant_id,conversation_ids) VALUES (%s,%s)',(g.id,encoded([prior.id])))
    monkeypatch.setattr(s,'_admit_conversation_turn',hold)
    with ThreadPoolExecutor(max_workers=2) as pool:
        admission=pool.submit(post,context,cv,'A new authorized request')
        assert entered.wait(10)
        authority=pool.submit(install);assert owner_started.wait(10)
        release.set();assert admission.result(timeout=10).run.state=='queued';authority.result(timeout=10)
    with s.db.transaction() as c:assert not c.execute('SELECT 1 FROM general_context_scopes WHERE grant_id=%s',(g.id,)).fetchone()
