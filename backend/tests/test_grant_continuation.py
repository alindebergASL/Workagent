"""New-turn alpha continuation; real PostgreSQL, no paid requests."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import pytest
import psycopg
from test_domain import context, raises
from test_conversations import conversation, post
from test_alpha_budget import grant_for, prepared, reserve
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from workagent.db import Database
from workagent.models import new_id
from workagent.provider_attempts import configure_grant, revoke_grant
from workagent.responses_ledger import summary
from workagent.runtime_config import BundleDenied
from workagent.service import encoded


def install(ctx, cv, **limits):
    g=grant_for(ctx,[cv],**limits)
    return configure_grant(Database(ctx[4]),g)


def successor(ctx,g,**updates):
    data=g.model_dump(mode='json'); data['id']=new_id(); data.update(updates)
    return type(g).model_validate(data)


def authority(ctx,gid):
    with ctx[0].db.transaction() as c:
        return c.execute('SELECT active,data FROM provider_grants WHERE id=%s',(gid,)).fetchone()


def test_new_turn_uses_new_grant_same_history_and_old_receipts_unchanged(context,tmp_path):
    s,p,ws,_,admin=context; cv=conversation(context)
    g=install(context,cv); q=post(context,cv,'Keep this decision: prefer reversible changes.')
    f=AlphaProvider([{'kind':'reply','text':'Prefer reversible changes.'}])
    assert worker(context,f,tmp_path/'first').work(p,ws,q.run.id).state=='ready'
    with s.db.transaction() as c:
        old_config=c.execute('SELECT * FROM run_configurations WHERE run_id=%s',(q.run.id,)).fetchone()
        old_attempt=c.execute('SELECT * FROM provider_attempts WHERE run_id=%s',(q.run.id,)).fetchone()
        old_events=c.execute('SELECT * FROM responses_events WHERE attempt_id=%s ORDER BY id',(old_attempt['id'],)).fetchall()
        cost=summary(c,g.id,shared=True)
    g2=successor(context,g); configure_grant(Database(admin),g2,predecessor_id=g.id)
    assert authority(context,g.id)=={'active':False,'data':g.model_dump(mode='json')}
    assert authority(context,g2.id)=={'active':True,'data':g2.model_dump(mode='json')}
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.conversation.model_activation=='active'
    assert s.list_conversations(p,ws).items[0].model_activation=='active'
    q2=post(context,detail.conversation,'What was my decision?')
    assert q2.run.execution.grant_id==g2.id
    f2=AlphaProvider([{'kind':'reply','text':'You prefer reversible changes.'}])
    assert worker(context,f2,tmp_path/'second').work(p,ws,q2.run.id).state=='ready'
    assert any(m['text']=='Prefer reversible changes.' for m in f2.contexts[0]['messages'])
    with s.db.transaction() as c:
        assert c.execute('SELECT * FROM run_configurations WHERE run_id=%s',(q.run.id,)).fetchone()==old_config
        assert c.execute('SELECT * FROM provider_attempts WHERE run_id=%s',(q.run.id,)).fetchone()==old_attempt
        assert c.execute('SELECT * FROM responses_events WHERE attempt_id=%s ORDER BY id',(old_attempt['id'],)).fetchall()==old_events
        after=summary(c,g2.id,shared=True)
        assert after['request_counts']['dispatch']==cost['request_counts']['dispatch']+2
        assert Decimal(after['reserved_cost_usd'])==Decimal(cost['reserved_cost_usd'])+Decimal('0.26384')
    # A later continuation can name the immediate predecessor, not an ancestor.
    g3=successor(context,g2); configure_grant(Database(admin),g3,predecessor_id=g2.id)
    assert s.get_conversation(p,ws,cv.id).conversation.model_activation=='active'
    revoke_grant(Database(admin),g3.id)
    assert s.get_conversation(p,ws,cv.id).conversation.model_activation=='revoked'
    raises('action_unresolved',lambda:post(context,s.get_conversation(p,ws,cv.id).conversation,'No fallback'))


def test_implicit_reset_still_denied(context):
    cv=conversation(context); g=install(context,cv); revoke_grant(Database(context[4]),g.id)
    with pytest.raises(psycopg.Error,match='explicit inactive lineage'):
        configure_grant(Database(context[4]),successor(context,g))


@pytest.mark.parametrize('direct',[False,True])
def test_non_general_successor_cannot_consume_lineage(context,direct):
    from datetime import timedelta
    from workagent.models import now
    cv=conversation(context); g=install(context,cv)
    g2=successor(context,g,profile='openai-agents-v1',responses=None,
                 expires_at=(now()+timedelta(minutes=30)).isoformat(),max_runs=1,
                 max_received_output_tokens=1000)
    with pytest.raises((BundleDenied,psycopg.Error)):
        if not direct:
            configure_grant(Database(context[4]),g2,predecessor_id=g.id)
        else:
            with Database(context[4]).transaction() as c:
                c.execute('INSERT INTO general_grant_continuations(successor_id,predecessor_id) VALUES (%s,%s)',(g2.id,g.id))
                c.execute('UPDATE provider_grants SET active=false WHERE id=%s',(g.id,))
                c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,data) VALUES (%s,%s,%s,%s)',
                          (g2.id,g2.workspace_id,g2.principal_id,encoded(g2)))
    assert authority(context,g.id)['active']
    assert authority(context,g2.id) is None
    with context[0].db.transaction() as c:
        assert not c.execute('SELECT 1 FROM general_grant_continuations WHERE predecessor_id=%s',(g.id,)).fetchone()


@pytest.mark.parametrize('change',['scope','project','credential','transport','profile'])
def test_route_or_scope_expansion_rolls_back_revocation_and_lineage(context,change):
    cv=conversation(context); g=install(context,cv); g2=successor(context,g)
    data=g2.model_dump(mode='json')
    if change=='scope': data['responses']['conversation_ids'].append(conversation(context).id)
    if change=='project': data['responses']['project_id']='proj_other'
    if change=='credential': data['responses']['secret_reference']='file:/synthetic/other-key'
    if change=='transport': data['responses']['transport_mode']='official_api'
    if change=='profile': data['responses'].pop('runtime_extension')
    # Direct owner SQL exercises persistence separately from Python route checks.
    with pytest.raises(psycopg.Error):
        with Database(context[4]).transaction() as c:
            c.execute('INSERT INTO general_grant_continuations(successor_id,predecessor_id) VALUES (%s,%s)',(g2.id,g.id))
            c.execute('UPDATE provider_grants SET active=false WHERE id=%s',(g.id,))
            c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,data) VALUES (%s,%s,%s,%s)',
                      (g2.id,g.workspace_id,g.principal_id,encoded(data)))
    assert authority(context,g.id)['active']
    assert authority(context,g2.id) is None
    with context[0].db.transaction() as c:
        assert not c.execute('SELECT 1 FROM general_grant_continuations WHERE predecessor_id=%s',(g.id,)).fetchone()


def test_app_role_cannot_install_or_mutate_lineage(context):
    cv=conversation(context); g=install(context,cv); g2=successor(context,g)
    with pytest.raises(BundleDenied): configure_grant(context[0].db,g2,predecessor_id=g.id)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with context[0].db.transaction() as c:
            c.execute('INSERT INTO general_grant_continuations(successor_id,predecessor_id) VALUES (%s,%s)',(g2.id,g.id))
    configure_grant(Database(context[4]),g2,predecessor_id=g.id)
    for sql in ('DELETE FROM general_grant_continuations WHERE successor_id=%s',
                'UPDATE general_grant_continuations SET created_at=now() WHERE successor_id=%s'):
        with pytest.raises(psycopg.Error,match='immutable'):
            with Database(context[4]).transaction() as c: c.execute(sql,(g2.id,))


def test_same_predecessor_race_has_one_successor(context):
    cv=conversation(context); g=install(context,cv)
    candidates=[successor(context,g) for _ in range(2)]
    def attempt(candidate):
        try:
            configure_grant(Database(context[4]),candidate,predecessor_id=g.id)
            return True
        except psycopg.Error: return False
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(attempt,candidates))
    assert sorted(results)==[False,True]
    assert sum(bool(authority(context,g2.id)) for g2 in candidates)==1


def test_unknown_count_is_not_repeated_or_bypassed_and_other_conversation_can_advance(context,tmp_path):
    s,p,ws,_,admin=context; cv=conversation(context); other=conversation(context)
    g=grant_for(context,[cv,other]); configure_grant(Database(admin),g)
    q=post(context,cv,'This request will have an unknown count.')
    f=AlphaProvider([{'kind':'reply','text':'Must not publish.'}]); w=worker(context,f,tmp_path/'old')
    captured={}
    def capture(ledger,request,cap,deadline):
        captured.update(ledger=ledger,request=request,cap=cap); return None
    w.phases._step=capture
    assert w.work(p,ws,q.run.id).state=='running'
    reserve(captured,'count_send')
    g2=successor(context,g); configure_grant(Database(admin),g2,predecessor_id=g.id)
    raises('action_unresolved',lambda:post(context,s.get_conversation(p,ws,cv.id).conversation,'No replacement'))
    q2=post(context,other,'Unrelated authorized work.')
    f2=AlphaProvider([{'kind':'reply','text':'Independent answer.'}])
    assert worker(context,f2,tmp_path/'new').work(p,ws,q2.run.id).state=='ready'
    with s.db.transaction() as c:
        events=c.execute('SELECT kind FROM responses_events WHERE attempt_id=%s ORDER BY id',
                         (captured['ledger'].receipt.attempt_id,)).fetchall()
        assert events==[{'kind':'count_send'}]
        assert summary(c,g2.id,shared=True)['request_counts']['count_send']==3


def test_new_grant_still_obeys_shared_reservations(context,tmp_path):
    s,p,ws,_,admin=context; cv=conversation(context); g=install(context,cv)
    q=post(context,cv,'A first bounded answer.')
    f=AlphaProvider([{'kind':'reply','text':'First answer.'}]); assert worker(context,f,tmp_path/'old').work(p,ws,q.run.id).state=='ready'
    g2=successor(context,g)
    g2=g2.model_copy(update={'responses':g2.responses.model_copy(update={'generation_limit':2,'count_limit':2,'cost_limit_usd':'0.26384'})})
    configure_grant(Database(admin),g2,predecessor_id=g.id)
    q2=post(context,s.get_conversation(p,ws,cv.id).conversation,'No extra allowance from reset.')
    f2=AlphaProvider([{'kind':'reply','text':'Must not dispatch.'}])
    worker(context,f2,tmp_path/'new').work(p,ws,q2.run.id)
    assert f2.calls==[]
    with s.db.transaction() as c:
        assert summary(c,g2.id)['request_counts']['dispatch']==0
        assert summary(c,g2.id,shared=True)['reserved_cost_usd']=='0.26384'
