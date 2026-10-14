"""Tight alpha authority: real restricted PostgreSQL, synthetic transport only."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from hashlib import sha256
import pytest
import psycopg
from pydantic import ValidationError
from test_domain import context, raises
from test_domain import context as context_fixture
from test_conversations import conversation, post
from test_general_responses import worker
from test_general_alpha_runtime import AlphaProvider
from workagent.models import GeneralAlphaResponsesBinding, AdaptiveResponsesBinding, GeneralResponsesBinding, ProviderGrant, new_id
from workagent.composition import POLICY, DECISION_SCHEMA
from workagent.general_schema import EXPLANATION_SCHEMA
from workagent.general_responses import AUTHORIZATION_HASH, consumer_hash
from workagent.provider_attempts import configure_grant
from workagent.db import Database
from workagent.service import encoded
from workagent.responses_ledger import summary, RESERVED_INPUT, RESERVED_OUTPUT, RESERVED_COST

CAPS=dict(generation_limit=50,count_limit=50,read_limit=500,input_limit=1000000,output_limit=409600,cost_limit_usd='20.00')


def binding(cvs, project, **limits):
    return dict(runtime_extension='general-alpha-v1',project_id=project,
        secret_reference='file:/synthetic/not-a-key',transport_mode='synthetic',
        instructions_sha256=sha256(POLICY.encode()).hexdigest(),schema_sha256=sha256(EXPLANATION_SCHEMA.material).hexdigest(),
        scope_tool_sha256=sha256(DECISION_SCHEMA.material).hexdigest(),authorization_sha256=AUTHORIZATION_HASH,
        conversation_ids=[cv.id for cv in cvs],**(CAPS | limits))


def grant_for(ctx,cvs,project=None,**limits):
    _,p,ws,_,_=ctx
    return ProviderGrant(id=new_id(),workspace_id=ws,principal_id=p.id,profile='general-responses-v1',
        model='gpt-6.1-sol',consumer_sha256=consumer_hash(),expires_at=None,max_runs=10,max_received_output_tokens=16384,
        responses=GeneralAlphaResponsesBinding(**binding(cvs,project or 'proj_'+ws,**limits)))


def prepared(ctx,tmp_path,*,project=None,**limits):
    s,p,ws,_,admin=ctx
    cv=conversation(ctx); g=grant_for(ctx,[cv],project,**limits)
    configure_grant(Database(admin),g)
    q=post(ctx,cv,'Answer within the explicitly bounded budget.')
    fake=AlphaProvider([{'kind':'reply','text':'A retained answer.'}]); w=worker(ctx,fake,tmp_path)
    captured={}
    def capture(ledger,request,cap,deadline):
        captured.update(ledger=ledger,request=request,cap=cap)
        return None
    w.phases._step=capture
    assert w.work(p,ws,q.run.id).state=='running'
    return g, fake, captured


def reserve(x,kind):
    return x['ledger'].reserve_operation(x['request'],kind,x['cap'])


def raw(x,kind,data=None):
    with x['ledger'].service.db.transaction() as c:
        return x['ledger'].event(c,x['request'].phase,kind,data or {})


def count(x,fake):
    reserve(x,'count_send')
    r=x['request']
    x['ledger'].retain(r,'count_result',dict(request_sha256=r.sha256,count_sha256=sha256(r.count_body()).hexdigest(),
        input_tokens=700,metadata=r.metadata.model_dump(),provenance=asdict(fake.transport().provenance)))


def identity(x,fake):
    r=x['request']
    x['ledger'].retain(r,'identity',dict(response_id='resp_'+new_id(),request_sha256=r.sha256,
        metadata=r.metadata.model_dump(),provenance=asdict(fake.transport().provenance)))


DISPATCH=dict(reserved_input_tokens=RESERVED_INPUT,reserved_output_tokens=RESERVED_OUTPUT,
              reserved_cost_usd=str(RESERVED_COST),billed_cost_usd=None)


@pytest.mark.parametrize('field,value,kind',[
    ('count_limit',0,'count_send'),('generation_limit',0,'dispatch'),('read_limit',0,'read'),
    ('input_limit',19999,'dispatch'),('output_limit',8191,'dispatch'),('cost_limit_usd','0.131919','dispatch')])
def test_each_limit_python_and_direct_sql(context,tmp_path,field,value,kind):
    g,f,x=prepared(context,tmp_path,**{field:value})
    if kind!='count_send': count(x,f)
    if kind=='read': reserve(x,'dispatch'); identity(x,f)
    raises('budget_exhausted',lambda:reserve(x,kind))
    with pytest.raises(psycopg.Error,match='(request limit|reservation limit|project budget exhausted)'):
        raw(x,kind,DISPATCH if kind=='dispatch' else {})
    with context[0].db.transaction() as c:
        assert summary(c,g.id)['request_counts'][kind]==0


@pytest.mark.parametrize('field',list(CAPS))
def test_alpha_caps_explicit_and_tightening_only(field):
    data=binding([], 'proj_model'); data['conversation_ids']=['cv']
    missing=dict(data); missing.pop(field)
    with pytest.raises(ValidationError): GeneralAlphaResponsesBinding(**missing)
    oversized=dict(data); oversized[field]=21 if field=='cost_limit_usd' else CAPS[field]+1
    if field=='cost_limit_usd': oversized[field]='20.000001'
    with pytest.raises(ValidationError): GeneralAlphaResponsesBinding(**oversized)
    for value in (None,True,1.5,'1' if field!='cost_limit_usd' else 'NaN'):
        with pytest.raises(ValidationError): GeneralAlphaResponsesBinding(**(data | {field:value}))


def test_conversations_explicit_unique_ten_and_historical_literals():
    data=binding([], 'proj_model'); data['conversation_ids']=['cv'+str(i) for i in range(10)]
    assert len(GeneralAlphaResponsesBinding(**data).conversation_ids)==10
    for cvs in ([],['cv','cv'],['cv'+str(i) for i in range(11)]):
        with pytest.raises(ValidationError): GeneralAlphaResponsesBinding(**(data | {'conversation_ids':cvs}))
    old={k:v for k,v in data.items() if k not in CAPS and k!='runtime_extension'}
    old['conversation_ids']=['cv']
    assert AdaptiveResponsesBinding(**old).generation_limit==50
    assert GeneralResponsesBinding(**old).generation_limit==8
    with pytest.raises(ValidationError): AdaptiveResponsesBinding(**(old | {'generation_limit':49}))
    with pytest.raises(ValidationError): GeneralResponsesBinding(**(old | {'count_limit':7}))


@pytest.mark.parametrize('field,value',[(f,v) for f in CAPS for v in ('missing',None,True)] + [
    ('generation_limit',51),('read_limit',501),('input_limit',1000001),('output_limit',409601),
    ('count_limit','50'),('cost_limit_usd','20.000001'),('cost_limit_usd','NaN'),
    ('max_steps','4'),('synthetic_data_only','true'),('conversation_ids',['duplicate','duplicate']),
    ('runtime_extension','unknown')])
def test_sql_alpha_config_rejected_before_install(context,field,value):
    cv=conversation(context); g=grant_for(context,[cv]); data=g.model_dump(mode='json')
    if value=='missing': data['responses'].pop(field)
    else: data['responses'][field]=value
    with pytest.raises(psycopg.Error):
        with Database(context[4]).transaction() as c:
            c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,data) VALUES (%s,%s,%s,%s)',
                (g.id,g.workspace_id,g.principal_id,encoded(data)))


@pytest.mark.parametrize('field,value,kind',[
    ('count_limit',1,'count_send'),('generation_limit',1,'dispatch'),('read_limit',1,'read'),
    ('input_limit',20000,'dispatch'),('output_limit',8192,'dispatch'),('cost_limit_usd','0.263839','dispatch')])
def test_cross_grant_shared_limits(context,tmp_path,field,value,kind):
    project='proj_shared_'+new_id()
    g1,f1,x1=prepared(context,tmp_path/'one',project=project)
    count(x1,f1); reserve(x1,'dispatch'); identity(x1,f1); reserve(x1,'read')
    g2,f2,x2=prepared(context_fixture.__wrapped__(),tmp_path/'two',project=project,**{field:value})
    if kind!='count_send': count(x2,f2)
    if kind=='read': reserve(x2,'dispatch'); identity(x2,f2)
    raises('budget_exhausted',lambda:reserve(x2,kind))
    with pytest.raises(psycopg.Error,match='(request limit|reservation limit|project budget exhausted)'):
        raw(x2,kind,DISPATCH if kind=='dispatch' else {})
    with context[0].db.transaction() as c:
        assert summary(c,g2.id,shared=True)['unknown_usage_steps']>=1


def test_carry_applies_to_alpha_lower_cost(context,tmp_path):
    project='proj_carry_'+new_id()
    with Database(context[4]).transaction() as c:
        c.execute('''INSERT INTO responses_budget_carry(project_id,transport_mode,source_database,source_grant_id,
            source_manifest_sha256,reserved_cost_usd) VALUES (%s,'synthetic','isolated_prior_database',%s,%s,1)''',
            (project,new_id(),'a'*64))
    g,f,x=prepared(context,tmp_path,project=project,cost_limit_usd='1.131919')
    count(x,f)
    raises('budget_exhausted',lambda:reserve(x,'dispatch'))
    with pytest.raises(psycopg.Error,match='project budget exhausted'): raw(x,'dispatch',DISPATCH)
    with context[0].db.transaction() as c:
        assert summary(c,g.id,shared=True)['carried_reserved_cost_usd']=='1'


@pytest.mark.parametrize('field,value,kind',[
    ('count_limit',1,'count_send'),('generation_limit',1,'dispatch'),('read_limit',1,'read'),
    ('input_limit',20000,'dispatch'),('output_limit',8192,'dispatch'),('cost_limit_usd','0.263839','dispatch')])
@pytest.mark.parametrize('direct',[True,False])
def test_simultaneous_last_shared_reservation(context,tmp_path,field,value,kind,direct):
    from threading import Barrier
    from workagent.errors import DomainError
    project='proj_race_'+new_id(); barrier=Barrier(2)
    _,fa,a=prepared(context,tmp_path/'a',project=project,**{field:value})
    _,fb,b=prepared(context_fixture.__wrapped__(),tmp_path/'b',project=project,**{field:value})
    for x,f in ((a,fa),(b,fb)):
        if kind!='count_send': count(x,f)
        if kind=='read': reserve(x,'dispatch'); identity(x,f)
    def attempt(x):
        barrier.wait(timeout=10)
        try:
            if direct: raw(x,kind,DISPATCH if kind=='dispatch' else {})
            else: reserve(x,kind)
            return 'reserved'
        except psycopg.Error as e:
            assert any(t in str(e) for t in ('request limit','reservation limit','project budget exhausted'))
            return 'denied'
        except DomainError as e:
            assert not direct and e.code.value=='budget_exhausted'
            return 'denied'
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt,[a,b]))==['denied','reserved']


def test_last_count_exact_phase_recovery_and_replay(context,tmp_path):
    from test_runtime import expire
    s,p,ws,_,admin=context; cv=conversation(context)
    g=grant_for(context,[cv],count_limit=1,generation_limit=1)
    configure_grant(Database(admin),g); q=post(context,cv,'Reply once.')
    f=AlphaProvider([{'kind':'reply','text':'Exact response'}]); w=worker(context,f,tmp_path)
    def crash(name):
        if name=='after_count': raise RuntimeError('controlled count boundary')
    w.phases.hook=crash
    with pytest.raises(RuntimeError,match='controlled count boundary'): w.work(p,ws,q.run.id)
    assert len(f.calls)==1
    expire(context,q.run.id)
    assert worker(context,f,tmp_path).work(p,ws,q.run.id).state=='partial'
    # The retained exact count permits precisely its own send, not another count/final.
    assert len(f.calls)==2
    with s.db.transaction() as c:
        t=summary(c,g.id)
        assert t['request_counts']['count_send']==t['request_counts']['dispatch']==1
        assert t['reserved_input_tokens']==20000
    worker(context,f,tmp_path).work(p,ws,q.run.id)
    assert len(f.calls)==2


def test_unknown_last_count_cannot_dispatch_or_recount(context,tmp_path):
    from test_runtime import expire
    s,p,ws,_,_=context
    g,f,x=prepared(context,tmp_path,count_limit=1)
    reserve(x,'count_send')  # committed before a lost count; never manufacture a result
    raises('action_unresolved',lambda:reserve(x,'dispatch'))
    with pytest.raises(psycopg.Error,match='durable count required'): raw(x,'dispatch',DISPATCH)
    expire(context,x['ledger'].receipt.run_id)
    assert worker(context,f,tmp_path).work(p,ws,x['ledger'].receipt.run_id).state=='running'
    assert f.calls==[]
    with s.db.transaction() as c:
        t=summary(c,g.id,shared=True)
        assert t['request_counts']['count_send']==1 and t['request_counts']['dispatch']==0
        assert c.execute("""SELECT count(*) AS n FROM responses_events e
            JOIN responses_steps st USING(attempt_id,phase) WHERE st.grant_id=%s AND e.kind='count_send'
            AND NOT EXISTS (SELECT 1 FROM responses_events r WHERE r.attempt_id=e.attempt_id
                AND r.phase=e.phase AND r.kind='count_result')""",(g.id,)).fetchone()['n']==1


def test_ten_scoped_conversations_and_full_historical_serialization(context):
    cvs=[conversation(context) for _ in range(10)]
    g=grant_for(context,cvs)
    configure_grant(Database(context[4]),g)
    with context[0].db.transaction() as c:
        stored=c.execute('SELECT data FROM provider_grants WHERE id=%s',(g.id,)).fetchone()['data']
    assert ProviderGrant.model_validate(stored)==g
    # Historical alpha dumps contained all inherited defaults, and still parse.
    historical=g.responses.model_dump(mode='json')
    historical['conversation_ids']=historical['conversation_ids'][:2]
    assert GeneralAlphaResponsesBinding.model_validate(historical).count_limit==50


@pytest.mark.parametrize('field,value',[('synthetic_data_only',1),('store_acknowledged',1),('cancel_limit',False),
    ('count_limit',1.0),('generation_limit',-1),('cost_limit_usd',0),('cost_limit_usd','0.0000001')])
def test_alpha_exact_types_python_and_sql(context,field,value):
    cv=conversation(context); g=grant_for(context,[cv])
    data=g.responses.model_dump(mode='json') | {field:value}
    with pytest.raises(ValidationError): GeneralAlphaResponsesBinding.model_validate(data)
    payload=g.model_dump(mode='json') | {'responses':data}
    with pytest.raises(psycopg.Error):
        with Database(context[4]).transaction() as c:
            c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,data) VALUES (%s,%s,%s,%s)',
                (g.id,g.workspace_id,g.principal_id,encoded(payload)))


def test_four_selections_plus_one_final_and_no_extra_reservation(context,tmp_path):
    s,p,ws,_,admin=context; cv=conversation(context)
    g=grant_for(context,[cv]); configure_grant(Database(admin),g)
    q=post(context,cv,'Explore only the bounded capability catalog.')
    f=AlphaProvider([{'kind':'discover_capabilities'}]*4)
    w=worker(context,f,tmp_path)
    assert w.work(p,ws,q.run.id).state=='partial'
    with s.db.transaction() as c:
        phases=c.execute('SELECT phase FROM responses_steps WHERE grant_id=%s ORDER BY phase',(g.id,)).fetchall()
        assert {r['phase'] for r in phases}=={'selection','selection_2','selection_3','selection_4','final'}
        t=summary(c,g.id)
        assert t['request_counts']['count_send']==t['request_counts']['dispatch']==5
        before=list(f.calls)
    w.work(p,ws,q.run.id)
    assert f.calls==before


def test_additive_018_upgrade_preserves_unknowns_carry_pins_and_acl(tmp_path,monkeypatch):
    from pathlib import Path
    import shutil
    from unittest.mock import patch
    from dev_db import provision
    from workagent.db import migrate
    prefix=tmp_path/'prefix'; (prefix/'workagent').mkdir(parents=True); (prefix/'migrations').mkdir()
    root=Path(__file__).resolve().parents[1]
    for source in sorted((root/'migrations').glob('*.sql')):
        if source.name<'019': shutil.copyfile(source,prefix/'migrations'/source.name)
    def prefix_migrate(dsn):
        with patch('workagent.db.__file__',str(prefix/'workagent/db.py')): migrate(dsn)
    env=tmp_path/'upgrade.env'
    with patch('dev_db.migrate',prefix_migrate): provision(env)
    for line in env.read_text().splitlines():
        key,value=line.removeprefix('export ').split('=',1); monkeypatch.setenv(key,value)
    ctx=context_fixture.__wrapped__(); project='proj_upgrade_'+new_id()
    with Database(ctx[4]).transaction() as c:
        c.execute('''INSERT INTO responses_budget_carry(project_id,transport_mode,source_database,source_grant_id,
            source_manifest_sha256,reserved_cost_usd) VALUES (%s,'synthetic','prior_isolated_db',%s,%s,1)''',
            (project,new_id(),'a'*64))
    # Historical 018 has no recording column and this fixture never selects a
    # mutation. Emulate its absent read projection only while creating the old
    # liability; every real ledger/accounting/authority guard remains enabled.
    with monkeypatch.context() as historical:
        historical.setattr('workagent.responsibility_action.recording',lambda c,run:None)
        g,f,x=prepared(ctx,tmp_path/'worker',project=project)
        count(x,f); reserve(x,'dispatch')  # no identity/result: irrevocable unknown liability
    def snapshot():
        with ctx[0].db.transaction() as c:
            return (summary(c,g.id,shared=True),c.execute('SELECT data FROM provider_grants WHERE id=%s',(g.id,)).fetchone(),
                c.execute('SELECT * FROM responses_events WHERE attempt_id=%s ORDER BY id',(x['ledger'].receipt.attempt_id,)).fetchall())
    before=snapshot(); migrate(ctx[4]); migrate(ctx[4]); assert snapshot()==before
    ctx[0].db.check_runtime_role()
    with ctx[0].db.transaction() as c:
        expected=[{'name':p.name,'checksum':sha256(p.read_bytes()).hexdigest()}
                  for p in sorted((root/'migrations').glob('*.sql'))]
        assert any(row['name']=='019_alpha_budget.sql' for row in expected)
        assert c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()==expected
        assert c.execute("SELECT has_table_privilege(current_user,'responses_events','INSERT') AS i, has_table_privilege(current_user,'responses_events','UPDATE') AS u").fetchone()=={'i':True,'u':False}
    raises('action_unresolved',lambda:reserve(x,'dispatch'))
    with pytest.raises(psycopg.Error): raw(x,'dispatch',DISPATCH)
    assert snapshot()==before
