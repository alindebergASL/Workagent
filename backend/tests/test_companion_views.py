"""Model-selected companion views; controlled transport, real restricted DB."""
import pytest
from test_domain import context, cmd, raises
from test_flexible_work import publish, table, view, action
from test_conversations import post
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker, target, totals
from workagent.errors import DomainError
from workagent.models import HumanSave
from workagent.service import Service
from workagent.selection_policy import companion_view


def setup(context):
    s,p,ws,_,_=context
    cv,_,source=publish(context,table())
    edited=source.current_revision.body.model_copy(deep=True)
    edited.rows[0].cells[0].value='Human Oak'
    source=s.human_save(p,ws,source.id,cmd(HumanSave,
        expected_current_revision_id=source.current_revision_id,body=edited))
    return s,p,ws,s.get_conversation(p,ws,cv.id).conversation,source


def decision(source):
    return {'kind':'publish_artifact','target':None,'body':view(source)}


def test_companion_is_new_draft_not_source_revision(context,tmp_path):
    s,p,ws,cv,source=setup(context)
    grant=activate(context,cv)
    q=post(context,cv,'Give me a useful companion view of the selected data; preserve my changes.',target=target(source))
    fake=AlphaProvider([decision(source)],explanation='A saved view, not verified analysis.')
    w=worker(context,fake,tmp_path)
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=Service(s.db).get_conversation(p,ws,cv.id)
    created=[i for i in detail.artifact_ids if i!=source.id]
    assert len(created)==1
    companion=s.get_artifact(p,ws,created[0])
    assert companion.current_revision.body.kind=='custom_view'
    assert s.get_artifact(p,ws,source.id).current_revision==source.current_revision
    assert len(s.history(p,ws,source.id).items)==2
    assert not s.proposals(p,ws,source.id).items
    read=s.invoke_view_action(p,ws,companion.id,action(companion))
    assert read.revision_id==source.current_revision_id and read.body==source.current_revision.body
    turn=next(t for t in detail.turns if t.run_id==q.run.id)
    assert turn.adaptive.outcome=='needs_validation' and not turn.adaptive.steps[-1].verification.satisfied
    before=totals(s,grant);calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert totals(s,grant)==before and fake.calls==calls


@pytest.mark.parametrize('invalid',['empty','wrong_hash','wrong_revision','foreign','other_source','replacement','document'])
def test_companion_does_not_expand_selected_source(context,tmp_path,invalid):
    s,p,ws,cv,source=setup(context)
    chosen=decision(source)
    if invalid=='empty': chosen['body']['bindings']=[];chosen['body']['actions']=[]
    elif invalid=='wrong_hash':chosen['body']['bindings'][0]['body_hash']='0'*64
    elif invalid=='wrong_revision':chosen['body']['bindings'][0]['revision_id']='not-current'
    elif invalid in ('foreign','other_source'):
        _,_,other=publish(context,table(),None if invalid=='foreign' else cv)
        chosen['body']=view(other)
    elif invalid=='replacement':chosen['target']=target(source).model_dump()
    else:chosen['body']={'title':'Not a companion','blocks':[{'block_id':'b','text':'x','kind':'paragraph','checked':None}]}
    cv=s.get_conversation(p,ws,cv.id).conversation
    before=s.get_conversation(p,ws,cv.id).artifact_ids
    activate(context,cv)
    q=post(context,cv,'Show the selected source without replacing it.',target=target(source))
    with pytest.raises(DomainError):worker(context,AlphaProvider([chosen]),tmp_path).work(p,ws,q.run.id)
    assert s.get_conversation(p,ws,cv.id).artifact_ids==before
    assert s.get_artifact(p,ws,source.id).current_revision==source.current_revision
    assert not s.proposals(p,ws,source.id).items


@pytest.mark.parametrize('when',['selection','before_publication'])
@pytest.mark.parametrize('change',['human_edit','revoke','membership'])
def test_companion_rechecks_current_source_and_authority(context,tmp_path,when,change):
    from workagent.db import Database
    from workagent.provider_attempts import revoke_grant
    s,p,ws,cv,source=setup(context);grant=activate(context,cv)
    q=post(context,cv,'Show the selected source.',target=target(source))
    def alter():
        if change=='human_edit':
            body=source.current_revision.body.model_copy(deep=True)
            body.rows[0].cells[0].value='Later human edit'
            s.human_save(p,ws,source.id,cmd(HumanSave,expected_current_revision_id=source.current_revision_id,body=body))
        elif change=='revoke':revoke_grant(Database(context[4]),grant.id)
        else:
            with Database(context[4]).transaction() as c:
                c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    def choose(ctx):
        if when=='selection':alter()
        return decision(source)
    fake=AlphaProvider([choose]);w=worker(context,fake,tmp_path)
    def hook(name):
        if name==when:alter()
    w.phases.hook=hook
    with pytest.raises(DomainError):w.work(p,ws,q.run.id)
    with Database(context[4]).transaction() as c:
        assert c.execute('SELECT id FROM artifacts WHERE workspace_id=%s AND conversation_id=%s',(ws,cv.id)).fetchall()==[{'id':source.id}]
        assert c.execute('SELECT id FROM proposals WHERE workspace_id=%s',(ws,)).fetchall()==[]
        assert c.execute("SELECT id FROM conversation_messages WHERE workspace_id=%s AND run_id=%s AND author_kind='assistant'",(ws,q.run.id)).fetchall()==[]


@pytest.mark.parametrize('alpha,author_kind,responsibility',[(False,'human',False),(True,'system',False),(True,'human',True)])
def test_companion_exception_is_human_alpha_only(alpha,author_kind,responsibility):
    exact={'artifact_id':'a','revision_id':'r','body_hash':'0'*64}
    chosen={'kind':'publish_artifact','target':None,'body':{'kind':'custom_view','version':'custom-view/v1','bindings':[{'name':'source',**exact}]}}
    assert not companion_view(chosen,exact,alpha=alpha,author_kind=author_kind,responsibility=responsibility)


def test_restricted_sql_rejects_companion_scope_bypass(context,tmp_path,monkeypatch):
    import psycopg
    import workagent.selection_policy as policy
    s,p,ws,cv,source=setup(context)
    cv,_,other=publish(context,table(),cv)
    activate(context,cv)
    chosen=decision(source)
    chosen['body']['bindings'].append({**view(other)['bindings'][0],'name':'extra'})
    q=post(context,cv,'Show only the selected source.',target=target(source))
    # Deliberately bypass the Python predicate to exercise PostgreSQL authority.
    monkeypatch.setattr(policy,'companion_view',lambda *args,**kw:True)
    with pytest.raises(psycopg.Error,match='companion may bind only its exact explicit source'):
        worker(context,AlphaProvider([chosen]),tmp_path).work(p,ws,q.run.id)
    assert set(s.get_conversation(p,ws,cv.id).artifact_ids)=={source.id,other.id}
    with s.db.transaction() as c:
        assert c.execute("SELECT e.id FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='tool_result'",(q.run.id,)).fetchall()==[]


@pytest.mark.parametrize('historical',[False,True])
def test_unstaged_companion_receipt_restart_preserves_identity_across_prompt_changes(context,tmp_path,monkeypatch,historical):
    import workagent.composition as composition
    import test_general_alpha_runtime as fixtures
    from workagent.responses_ledger import observations
    from workagent.responses_dispatcher import ResponsesDispatcher
    s,p,ws,cv,source=setup(context)
    current_policy=composition.POLICY
    if historical:
        old_policy=current_policy.split(' An explicit target is both a source fence')[0]
        monkeypatch.setattr(composition,'POLICY',old_policy)
        monkeypatch.setattr(fixtures,'POLICY',old_policy)
    grant=activate(context,cv)
    q=post(context,cv,'Make a companion of the exact selected source.',target=target(source))
    fake=AlphaProvider([decision(source)]);w=worker(context,fake,tmp_path)
    original=s.stage_general_product
    def interrupt(*args,**kwargs):raise RuntimeError('controlled interruption before local staging')
    monkeypatch.setattr(s,'stage_general_product',interrupt)
    with pytest.raises(RuntimeError,match='controlled interruption'):w.work(p,ws,q.run.id)
    monkeypatch.setattr(s,'stage_general_product',original)
    monkeypatch.setattr(composition,'POLICY',current_policy)
    monkeypatch.setattr(fixtures,'POLICY',current_policy)
    before=totals(s,grant);calls=list(fake.calls)
    with s.db.transaction() as c:
        aid=c.execute('SELECT id FROM provider_attempts WHERE run_id=%s',(q.run.id,)).fetchone()['id']
        assert observations(c,aid)[-1].state=='received'
        retained=c.execute('SELECT * FROM responses_events WHERE attempt_id=%s ORDER BY id',(aid,)).fetchall()
    dispatcher=ResponsesDispatcher(worker(context,fake,tmp_path),workspace=ws,grant_id=grant.id)
    dispatcher.once()
    if historical:
        # The original request/context is immutable, not silently rebound to a
        # changed prompt. This is NOT a grant gate for new executions.
        raises('source_changed',lambda:worker(context,fake,tmp_path).work(p,ws,q.run.id))
        assert totals(s,grant)==before and fake.calls==calls
        assert s.get_conversation(p,ws,cv.id).artifact_ids==[source.id]
        with s.db.transaction() as c:
            assert c.execute('SELECT * FROM responses_events WHERE attempt_id=%s ORDER BY id',(aid,)).fetchall()==retained
    else:
        from test_adaptive_execution import finish_safe_visits
        finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
        assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==2
        assert totals(s,grant)['request_counts']['dispatch']==before['request_counts']['dispatch']+1


@pytest.mark.parametrize('old_prompt', ['historical instructions', 'new implementation instructions'])
def test_companion_scope_not_authorized_by_prompt_hash(context,tmp_path,monkeypatch,old_prompt):
    import workagent.composition as composition
    import test_general_alpha_runtime as fixtures
    from workagent.selection_policy import companion_enabled
    s,p,ws,cv,source=setup(context)
    monkeypatch.setattr(fixtures,'POLICY',old_prompt)
    grant=activate(context,cv)
    assert companion_enabled({'responses':grant.responses.model_dump(mode='json')})
    # Current contract differs from the immutable grant; SQL enforces the exact
    # source/non-mutation boundary without comparing policy text digests.
    q=post(context,cv,'Create a companion, preserve my edits.',target=target(source))
    fake=AlphaProvider([decision(source)])
    from test_adaptive_execution import finish_safe_visits
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='partial'
    assert s.get_artifact(p,ws,source.id).current_revision==source.current_revision
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==2
