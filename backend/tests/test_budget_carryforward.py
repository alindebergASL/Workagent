"""Carried liabilities are operator evidence, never invented provider receipts."""
from decimal import Decimal
from hashlib import sha256

import psycopg
import pytest
from test_domain import context
from test_conversations import conversation, post
from test_adaptive_execution import activate, AdaptiveProvider
from test_general_responses import worker
from workagent.budget_carryforward import install_carry, read_carry
from workagent.db import Database, migrate
from workagent.models import new_id
from workagent.provider_attempts import configure_grant, revoke_grant
from workagent.responses_ledger import summary
from workagent.service import encoded


def carry(ctx, project=None, **changes):
    values=dict(project_id=project or 'proj_'+ctx[2], transport_mode='synthetic',
                source_database='workagent_test_source_fixture', source_grant_id=new_id(),
                source_manifest_sha256=sha256(b'explicit synthetic test manifest').hexdigest(),
                reserved_cost_usd='19.80')
    values.update(changes)
    return values


def test_carried_cost_enforced_by_runtime_and_sql(context, tmp_path):
    s,p,ws,_,admin=context
    cv=conversation(context); g=activate(context,cv)
    values=carry(context)
    row=install_carry(Database(admin), **values)
    assert row['reserved_cost_usd']==Decimal('19.80')
    assert row['source_manifest_sha256']==values['source_manifest_sha256']
    assert read_carry(s.db, values['project_id'], 'synthetic')==[row]
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s',(ws,)).fetchone()['n']==0
        shared=summary(c,g.id,shared=True)
        assert shared['request_counts']['dispatch']==0
        assert shared['carried_reserved_cost_usd']=='19.80'
        assert shared['reserved_cost_usd']=='19.80'
        assert 'carried_reserved_cost_usd' not in summary(c,g.id)
    q=post(context,cv,'Build and verify a calculator')
    fake=AdaptiveProvider(first_good=True); w=worker(context,fake,tmp_path)
    denials=[]
    def check_sql(name):
        if name!='after_count': return
        with s.db.transaction() as c:
            step=c.execute("SELECT st.attempt_id FROM responses_steps st JOIN provider_attempts a ON a.id=st.attempt_id WHERE a.run_id=%s AND st.phase='final'",(q.run.id,)).fetchone()
        if not step: return
        with pytest.raises(psycopg.errors.RaiseException,match='shared cumulative project budget exhausted'):
            with s.db.transaction() as c:
                c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,'final','dispatch',%s)",
                          (new_id(),step['attempt_id'],encoded(dict(reserved_input_tokens=20000,reserved_output_tokens=8192,reserved_cost_usd='0.131920',billed_cost_usd=None))))
        denials.append(True)
    w.phases.hook=check_sql
    run=w.work(p,ws,q.run.id)
    assert denials==[True]
    assert run.state=='partial' and run.stop_reason=='budget_limit'
    assert len(fake.responses)==1
    revoke_grant(Database(admin),g.id)
    successor=activate(context,conversation(context))
    with s.db.transaction() as c:
        total=summary(c,successor.id,shared=True)
        assert total['carried_reserved_cost_usd']=='19.80'
        assert total['request_counts']['dispatch']==1
        assert Decimal(total['reserved_cost_usd'])==Decimal('19.931920')
        assert Decimal(total['reserved_cost_usd'])+Decimal('0.131920')>20
    with pytest.raises(psycopg.errors.RaiseException,match='before local provider I/O'):
        install_carry(Database(admin), **carry(context,reserved_cost_usd='0.01'))


def test_owner_only_immutable_duplicate_and_no_fabrication(context):
    s,_,_,_,admin=context
    values=carry(context)
    with pytest.raises(Exception,match='migration identity required'):
        install_carry(s.db, **values)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with s.db.transaction() as c:
            c.execute('INSERT INTO responses_budget_carry (project_id,transport_mode,source_database,source_grant_id,source_manifest_sha256,reserved_cost_usd) VALUES (%s,%s,%s,%s,%s,%s)',tuple(values.values()))
    first=install_carry(Database(admin), **values)
    with pytest.raises(psycopg.errors.UniqueViolation):
        install_carry(Database(admin), **dict(values,source_database='another_database',reserved_cost_usd='0.01',transport_mode='official_api'))
    with pytest.raises(psycopg.errors.UniqueViolation):
        install_carry(Database(admin), **dict(values,project_id='proj_different_'+context[2]))
    for db in (Database(admin),s.db):
        for statement in ('UPDATE responses_budget_carry SET reserved_cost_usd=0 WHERE project_id=%s',
                          'DELETE FROM responses_budget_carry WHERE project_id=%s'):
            with pytest.raises(psycopg.Error):
                with db.transaction() as c: c.execute(statement,(values['project_id'],))
    assert read_carry(s.db, values['project_id'], 'synthetic')==[first]
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM provider_attempts a JOIN provider_grants g ON g.id=a.grant_id WHERE g.workspace_id=%s',(context[2],)).fetchone()['n']==0


@pytest.mark.parametrize('changes',[
    {'reserved_cost_usd':'0'}, {'reserved_cost_usd':'-0.01'}, {'reserved_cost_usd':'20.000001'},
    {'reserved_cost_usd':'NaN'}, {'reserved_cost_usd':'Infinity'},
    {'reserved_cost_usd':'0.0000001'}, {'source_manifest_sha256':'X'*64},
    {'source_database':''}, {'source_grant_id':''}, {'transport_mode':'fake'},
    {'project_id':''},
])
def test_invalid_carry_fails_closed(context,changes):
    with pytest.raises((ValueError,psycopg.Error)):
        install_carry(Database(context[4]), **carry(context,**changes))


def test_exact_project_mode_partition_and_legacy_shape(context):
    s,_,_,_,admin=context
    g=activate(context,conversation(context))
    with s.db.transaction() as c: original=summary(c,g.id,shared=True)
    install_carry(Database(admin), **carry(context,transport_mode='official_api'))
    install_carry(Database(admin), **carry(context,project='proj_other_'+context[2]))
    with s.db.transaction() as c: assert summary(c,g.id,shared=True)==original
    install_carry(Database(admin), **carry(context,reserved_cost_usd='0.527680'))
    install_carry(Database(admin), **carry(context,reserved_cost_usd='1.055360'))
    with s.db.transaction() as c:
        assert Decimal(summary(c,g.id,shared=True)['reserved_cost_usd'])==Decimal('1.583040')


def test_local_grant_collision_both_directions(context):
    g=activate(context,conversation(context)); owner=Database(context[4])
    with pytest.raises(psycopg.errors.RaiseException,match='already installed locally'):
        install_carry(owner, **carry(context,source_grant_id=g.id))
    revoke_grant(owner,g.id)
    values=carry(context); install_carry(owner, **values)
    replacement=g.model_copy(update={'id':values['source_grant_id'],
        'responses':g.responses.model_copy(update={'conversation_ids':[conversation(context).id]})})
    with pytest.raises(psycopg.errors.RaiseException,match='already carried'):
        configure_grant(owner,replacement)


def test_import_after_count_send_and_repeatable_read_rejected(context,tmp_path):
    s,p,ws,_,admin=context
    cv=conversation(context); activate(context,cv)
    q=post(context,cv,'Build calculator'); w=worker(context,AdaptiveProvider(),tmp_path)
    def stop(name):
        if name=='after_count': raise RuntimeError('stop after count')
    w.phases.hook=stop
    with pytest.raises(RuntimeError,match='stop after count'): w.work(p,ws,q.run.id)
    with pytest.raises(psycopg.errors.RaiseException,match='before local provider I/O'):
        install_carry(Database(admin), **carry(context))
    values=carry(context,project='proj_unused_'+ws)
    with pytest.raises(psycopg.errors.RaiseException,match='read committed'):
        with Database(admin).transaction() as c:
            c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            c.execute('INSERT INTO responses_budget_carry (project_id,transport_mode,source_database,source_grant_id,source_manifest_sha256,reserved_cost_usd) VALUES (%s,%s,%s,%s,%s,%s)',tuple(values.values()))


def test_migration_repeat_and_pins(context):
    migrate(context[4])
    with context[0].db.transaction() as c:
        assert c.execute('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').fetchone()['name']=='016_flexible_work.sql'


def test_concurrent_workspaces_share_carry_and_dispatch_cap(context,tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from test_domain import context as context_fixture
    other=context_fixture.__wrapped__()
    project='proj_concurrent_'+context[2]
    install_carry(Database(context[4]), **carry(context,project=project))
    barrier=Barrier(2)
    tasks=[]
    for index,ctx in enumerate((context,other)):
        s,p,ws,_,_=ctx
        cv=conversation(ctx); grant=activate(ctx,cv,project_id=project)
        q=post(ctx,cv,'Build calculator'); fake=AdaptiveProvider(first_good=True)
        w=worker(ctx,fake,tmp_path/str(index))
        def make_hook():
            waited=False
            def hook(name):
                nonlocal waited
                if name=='after_count' and not waited:
                    waited=True
                    barrier.wait(timeout=15)
            return hook
        w.phases.hook=make_hook()
        tasks.append((w,p,ws,q.run.id,fake,grant))
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(w.work,p,ws,rid) for w,p,ws,rid,_,_ in tasks]
        runs=[f.result(timeout=30) for f in futures]
    assert all(run.stop_reason=='budget_limit' for run in runs)
    assert sum(len(t[4].responses) for t in tasks)==1
    with context[0].db.transaction() as c:
        totals=[summary(c,t[5].id,shared=True) for t in tasks]
    assert totals[0]==totals[1]
    assert Decimal(totals[0]['reserved_cost_usd'])==Decimal('19.931920')


@pytest.mark.parametrize('amount',['NaN','Infinity','-Infinity','-1','20.000001','0.0000001'])
def test_sql_rejects_invalid_amount_without_application_validation(context,amount):
    values=carry(context,reserved_cost_usd=amount)
    with pytest.raises(psycopg.errors.CheckViolation):
        with Database(context[4]).transaction() as c:
            c.execute('INSERT INTO responses_budget_carry (project_id,transport_mode,source_database,source_grant_id,source_manifest_sha256,reserved_cost_usd) VALUES (%s,%s,%s,%s,%s,%s)',tuple(values.values()))
