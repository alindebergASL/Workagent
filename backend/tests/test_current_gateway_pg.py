"""Focused fresh disposable87 tests, real restricted PG and in-process transport.
No copied funding, external provider, old study identity, or forced lease changes.
"""
from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch
from dataclasses import replace
import os
import pytest
import psycopg
from test_domain import context as base_context, fixture_database_urls
from test_conversations import conversation,post
from test_general_alpha_runtime import activate,AlphaProvider
from test_general_responses import worker
from workagent import current_gateway,discovery_composition
from workagent.adaptive import contract
from workagent.capabilities import registry,policy
from workagent.capabilities.models import ToolGrantV1,CapabilityPin
from workagent.db import Database
from workagent.models import new_id,now
from workagent.errors import DomainError
from workagent.provider_attempts import revoke_grant

@pytest.fixture
def context():
    runtime,owner=fixture_database_urls(os.environ)
    assert os.environ['WORKAGENT_GATEWAY_CANDIDATE_DATABASE']==os.environ['WORKAGENT_TEST_DATABASE']
    with Database(runtime).transaction() as c:
        actual={r['name']:r['checksum'] for r in c.execute('SELECT name,checksum FROM schema_migrations').fetchall()}
        expected={p.name:sha256(p.read_bytes()).hexdigest() for p in (Path(__file__).parents[1]/'migrations').glob('*.sql')}
        assert actual==expected and len(expected)==87
    return base_context.__wrapped__()


def setup(ctx,schema,max_steps):
    s,p,ws,_,owner=ctx;cv=conversation(ctx)
    instructions,_=contract(NS(continuity_version='sustained-v1',memory_recall='off',scope_tool_sha256=sha256(schema.material).hexdigest()))
    with patch('test_general_alpha_runtime.POLICY',instructions),patch('test_general_alpha_runtime.DECISION_SCHEMA',schema):
        pg=activate(ctx,cv,continuity_version='sustained-v1',memory_recall='off',max_steps=max_steps)
    q=post(ctx,cv,'Use only authorized local tools. Preserve human work and retain a useful inert draft when supported.')
    ds=[registry.adapters()[n].descriptor for n in ('capabilities.discover_legacy','files.create_draft')]
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
        resource_selectors=[],effects=sorted({x for d in ds for x in d.effects}),privacy_classes=['workspace_private'],egress='none',
        expires_at=now()+timedelta(hours=1),access_generation=q.run.access_generation,budget_account_id=new_id())
    policy.install(Database(owner),g,limits={'local_compute':10},provider_grant_id=pg.id)
    return cv,pg,q,g


def retained_rows(s,rid):
    with s.db.transaction() as c:
        return {table:c.execute(query,(rid,)).fetchall() for table,query in {
            'steps':'SELECT * FROM responses_steps WHERE attempt_id IN (SELECT id FROM provider_attempts WHERE run_id=%s) ORDER BY phase',
            'events':'SELECT * FROM responses_events WHERE attempt_id IN (SELECT id FROM provider_attempts WHERE run_id=%s) ORDER BY id',
            'native':'SELECT * FROM tool_attempts WHERE run_id=%s ORDER BY id',
            'cost':'SELECT * FROM tool_cost_entries WHERE attempt_id IN (SELECT id FROM tool_attempts WHERE run_id=%s) ORDER BY attempt_id,kind',
            'native_events':'SELECT * FROM tool_attempt_events WHERE attempt_id IN (SELECT id FROM tool_attempts WHERE run_id=%s) ORDER BY attempt_id,kind',
            'pages':'SELECT * FROM model_discovery_receipts_v2 WHERE run_id=%s ORDER BY phase',
        }.items()}


@pytest.mark.parametrize('family',['historical_typed','current'])
def test_worker_catalog_typed_page_and_new_file_choice_without_replay(context,tmp_path,family):
    s,p,ws,_,_=context
    schema=discovery_composition.SCHEMA if family=='historical_typed' else current_gateway.SCHEMA
    decisions=[{'kind':'discover_retained_references','cursor':None,'limit':2}]
    if family=='current':
        content='Synthetic useful local draft. No external action or human acceptance.'
        decisions=[{'kind':'discover_capabilities'},*decisions,{'kind':'files_create_draft','source':{
            'kind':'text','filename':'draft.txt','mime_type':'text/plain','content':content,'sha256':sha256(content.encode()).hexdigest()}}]
    cv,pg,q,g=setup(context,schema,len(decisions));fake=AlphaProvider(decisions,explanation='Retained local work; bounded stop, not task completion.')
    w=worker(context,fake,tmp_path)
    result=w.work(p,ws,q.run.id)
    assert result.state=='partial',result.state
    saved=retained_rows(s,q.run.id);assert len(saved['pages'])==1
    assert len(saved['steps'])==len(decisions)+1
    for step in saved['steps']:
        if step['phase']!='final':
            import json
            assert json.loads(step['request_bytes'])['tools'][0]['parameters']==schema.model.model_json_schema()
        kinds=[e['kind'] for e in saved['events'] if e['phase']==step['phase']]
        for k in ('count_send','count_result','dispatch','identity','result'):assert kinds.count(k)==1,(step['phase'],k,kinds)
    if family=='current':
        stage=next(e['data'] for e in saved['events'] if e['phase']=='selection' and e['kind']=='tool_result')
        page=stage['capability_result']['result']
        assert page['schema_version']=='gateway-capability-page/v1'
        assert {d['name'] for d in page['builtin_operations']}=={'discover_retained_references','search_work_context_page'}
        assert len(saved['native'])==2
        observed=[r for r in saved['native_events'] if r['kind']=='observation']
        assert len(observed)==2 and all(r['data']['status']=='observed' for r in observed)
        assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==1
    else:assert saved['native']==[]
    calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert fake.calls==calls and retained_rows(s,q.run.id)==saved


def test_current_catalog_real_scope_revocation_fences_and_no_effect(context):
    s,p,ws,_,owner=context
    cv,pg,q,g=setup(context,current_gateway.SCHEMA,2)
    cap=s.claim_run(p,ws,q.run.id)
    from workagent.composition import DiscoverCapabilities
    invoke=registry.adapters()['capabilities.discover_legacy'].invoke
    choice=DiscoverCapabilities(kind='discover_capabilities')
    assert len(invoke(s,cap,choice)['result']['builtin_operations'])==2
    before=retained_rows(s,q.run.id)
    for bad in (replace(cap,fence=cap.fence+1),replace(cap,principal_id='someone_else')):
        with pytest.raises(DomainError):invoke(s,bad,choice)
    # Revoke only this newly created disposable grant. Never renew it.
    with Database(owner).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
    with pytest.raises(DomainError):invoke(s,cap,choice)
    assert retained_rows(s,q.run.id)==before
    with Database(owner).transaction() as c:
        assert c.execute('SELECT tool_run_available(%s,%s) ok',(ws,q.run.id)).fetchone()['ok'] is False
