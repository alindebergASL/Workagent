"""Additive development ceilings, never live provider evidence or new authority."""
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch
import shutil
import pytest
import psycopg
from pydantic import ValidationError
from test_domain import context
from test_conversations import conversation, post
from test_alpha_budget import binding, grant_for, CEILINGS
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from workagent.db import Database, migrate
from workagent.models import GeneralAlphaResponsesBinding, AdaptiveResponsesBinding
from workagent.provider_attempts import configure_grant
from workagent.responses_ledger import summary
from workagent.service import encoded


@pytest.mark.parametrize('limits',[
    dict(max_steps=8,generation_limit=66,count_limit=68,read_limit=596,input_limit=1320000,output_limit=540672,cost_limit_usd='12.136640'),
    dict(max_steps=8,**CEILINGS),
])
def test_new_explicit_bounds_roundtrip_python_and_sql(context,limits):
    cv=conversation(context); g=grant_for(context,[cv],**limits)
    configure_grant(Database(context[4]),g)
    with context[0].db.transaction() as c:
        stored=c.execute('SELECT data FROM provider_grants WHERE id=%s',(g.id,)).fetchone()['data']
    assert stored==g.model_dump(mode='json')
    assert GeneralAlphaResponsesBinding.model_validate(stored['responses'])==g.responses


@pytest.mark.parametrize('steps',[0,9,True,4.0,'8',None])
def test_step_bounds_exact_in_python_and_sql(context,steps):
    g=grant_for(context,[conversation(context)])
    data=g.model_dump(mode='json'); data['responses']['max_steps']=steps
    with pytest.raises(ValidationError): GeneralAlphaResponsesBinding.model_validate(data['responses'])
    with pytest.raises(psycopg.Error):
        with Database(context[4]).transaction() as c:
            c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,data) VALUES (%s,%s,%s,%s)',
                (g.id,g.workspace_id,g.principal_id,encoded(data)))


def test_historical_adaptive_cannot_expand_steps(context):
    data=binding([conversation(context)],'proj_old')
    data.pop('runtime_extension'); data['max_steps']=5
    with pytest.raises(ValidationError): AdaptiveResponsesBinding.model_validate(data)
    g=grant_for(context,[conversation(context)])
    raw=g.model_dump(mode='json'); raw['responses'].pop('runtime_extension'); raw['responses']['max_steps']=5
    with pytest.raises(psycopg.Error,match='exact bounded general authorization'):
        with Database(context[4]).transaction() as c:
            c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,data) VALUES (%s,%s,%s,%s)',
                (g.id,g.workspace_id,g.principal_id,encoded(raw)))


@pytest.mark.parametrize('steps',[4,8])
def test_each_grant_stops_at_own_bound_and_readback_reports_actual_cost(context,tmp_path,steps):
    s,p,ws,_,admin=context; cv=conversation(context)
    g=grant_for(context,[cv],max_steps=steps,cost_limit_usd='2.00')
    configure_grant(Database(admin),g)
    q=post(context,cv,'Explore within the configured bound.')
    f=AlphaProvider([{'kind':'discover_capabilities'}]*steps)
    w=worker(context,f,tmp_path)
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id); turn=detail.turns[0]
    assert turn.adaptive.max_steps==steps and len(turn.adaptive.steps)==steps
    assert turn.adaptive.shared_cost_limit_usd=='2.00'
    assert turn.adaptive.outcome=='step_limit'
    assert len(turn.response_steps)==steps+1
    with s.db.transaction() as c:
        assert summary(c,g.id)['request_counts']['dispatch']==steps+1
    before=list(f.calls); w.work(p,ws,q.run.id); assert f.calls==before
    from fastapi.testclient import TestClient
    from workagent.api import create_app,Settings
    token='development-test-not-live-12345678901234567890'
    with TestClient(create_app(Settings(s.db.dsn,True,token,p.id))) as client:
        response=client.get(f'/v1/workspaces/{ws}/conversations/{cv.id}',headers={
            'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':'bounds-read'})
    assert response.status_code==200
    assert len(response.json()['turns'][0]['response_steps'])==steps+1


@pytest.mark.parametrize('phase',['selection_5','selection_8'])
def test_later_responsibility_recording_retains_typed_receipt(context,tmp_path,phase):
    from test_responsibility_action import record
    s,p,ws,_,admin=context; cv=conversation(context)
    g=grant_for(context,[cv],max_steps=8); configure_grant(Database(admin),g)
    index=int(phase.split('_')[1]); decisions=[{'kind':'discover_capabilities'}]*(index-1)+[record]
    if index<8: decisions.append({'kind':'reply','text':'Recorded; human holds remain.'})
    q=post(context,cv,'Record the local responsibility when useful.')
    f=AlphaProvider(decisions)
    assert worker(context,f,tmp_path).work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    aid=detail.assignment_ids[0]
    assert detail.turns[0].adaptive.steps[index-1].mutation_result.assignment_id==aid
    assert s.get_responsibility(p,ws,aid).lifecycle.state=='waiting_person'
    with s.db.transaction() as c:
        saved=c.execute('SELECT responsibility_recording FROM assignments WHERE workspace_id=%s AND id=%s',(ws,aid)).fetchone()['responsibility_recording']
        assert saved['phase']==phase
        assert c.execute('SELECT valid_responsibility_recording(%s) AS ok',(encoded(saved),)).fetchone()['ok']


def test_transport_rejects_later_phase_for_historical_schema():
    from workagent.responses_transport import build_tool_selection,RequestMetadata,TransportError
    from workagent.adaptive import DECISION_SCHEMA,POLICY
    from workagent.composition import DECISION_SCHEMA as ALPHA_SCHEMA,POLICY as ALPHA_POLICY
    meta=RequestMetadata(request_id='request',attempt_id='attempt',step_id='selection_5')
    with pytest.raises(TransportError):
        build_tool_selection(instructions=POLICY,source_context='{}',read_schema=DECISION_SCHEMA,
            metadata=meta,policy='adaptive-local-v1',phase='selection_5')
    assert build_tool_selection(instructions=ALPHA_POLICY,source_context='{}',read_schema=ALPHA_SCHEMA,
        metadata=meta,policy='adaptive-local-v1',phase='selection_5').phase=='selection_5'
    with pytest.raises(TransportError):
        build_tool_selection(instructions=ALPHA_POLICY,source_context='{}',read_schema=ALPHA_SCHEMA,
            metadata=meta,policy='adaptive-local-v1',phase='selection_9')


def test_026_upgrade_is_additive_and_repeat_safe(tmp_path,monkeypatch):
    from dev_db import provision
    from test_domain import context as fixture
    from test_alpha_budget import prepared, count, reserve
    root=Path(__file__).resolve().parents[1]
    prefix=tmp_path/'prefix'; (prefix/'workagent').mkdir(parents=True); (prefix/'migrations').mkdir()
    for source in sorted((root/'migrations').glob('*.sql')):
        if source.name<'027': shutil.copyfile(source,prefix/'migrations'/source.name)
    def old_migrate(dsn):
        with patch('workagent.db.__file__',str(prefix/'workagent/db.py')): migrate(dsn)
    env=tmp_path/'upgrade.env'
    with patch('dev_db.migrate',old_migrate): provision(env)
    for line in env.read_text().splitlines():
        key,value=line.removeprefix('export ').split('=',1); monkeypatch.setenv(key,value)
    ctx=fixture.__wrapped__(); g,f,x=prepared(ctx,tmp_path/'old')
    count(x,f); reserve(x,'dispatch')
    def snapshot():
        with ctx[0].db.transaction() as c:
            return (summary(c,g.id,shared=True),c.execute('SELECT data FROM provider_grants WHERE id=%s',(g.id,)).fetchone(),
                c.execute('SELECT * FROM responses_events WHERE attempt_id=%s ORDER BY id',(x['ledger'].receipt.attempt_id,)).fetchall())
    before=snapshot(); migrate(ctx[4]); migrate(ctx[4]); assert snapshot()==before
    ctx[0].db.check_runtime_role()
    with ctx[0].db.transaction() as c:
        expected=[{'name':p.name,'checksum':sha256(p.read_bytes()).hexdigest()} for p in sorted((root/'migrations').glob('*.sql'))]
        assert c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()==expected
        assert c.execute("SELECT has_table_privilege(current_user,'provider_grants','INSERT') AS i, has_table_privilege(current_user,'responses_events','UPDATE') AS u").fetchone()=={'i':False,'u':False}
