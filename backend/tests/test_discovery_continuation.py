"""Actual discovery producers and restricted-PG worker path, no live calls."""
from copy import deepcopy
from unittest.mock import patch
import pytest
from workagent.adaptive import continuation_context
from workagent.composition import DiscoverCapabilities, execute_read
from workagent.capabilities.models import CapabilityPage, CapabilityPin
from workagent.capabilities import registry, policy
from workagent.db import Database
from test_domain import context
from test_conversations import conversation, post
from test_memory_full_tools import activated
from test_run_output_workflow import install_workflow
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_runtime import expire
from test_local_rejection_settlement import journal
from workagent.errors import DomainError


def test_legacy_projection_preserves_receipt():
    value=execute_read(DiscoverCapabilities(kind='discover_capabilities'),{})
    before=deepcopy(value)
    projected=continuation_context({},[{'capability_result':value}],8)['adaptive']['observations'][0]['capability_result']
    assert value==before
    expected=deepcopy(before)
    for item in expected['result']['capabilities']: item.pop('input_schema',None)
    assert projected==expected


def test_v2_projection_keeps_schemas_and_availability_distinct():
    page=CapabilityPage(items=[a.descriptor for a in registry.adapters().values()]).model_dump(mode='json')
    value={'capability':'discover_capabilities','version':'1','result':page}
    before=deepcopy(value)
    projected=continuation_context({},[{'capability_result':value}],8)['adaptive']['observations'][0]['capability_result']
    expected=deepcopy(before)
    for item in expected['result']['items']:
        item.pop('input_schema');item.pop('output_schema')
    expected['result']['omitted_descriptor_fields']=['input_schema','output_schema']
    assert projected==expected and value==before
    assert all('schema_sha256' in d for d in projected['result']['items'])
    assert projected['result']['schema_version']=='capability-page/v2'


@pytest.mark.parametrize('result',[{}, {'schema_version':'capability-page/v3','items':[]},
    {'schema_version':'capability-page/v2','items':[{'id':'not-a-descriptor'}]},
    {'version':'unknown','capabilities':[]}])
def test_unknown_or_malformed_discovery_not_invented_empty(result):
    with pytest.raises(ValueError):
        continuation_context({},[{'capability_result':dict(capability='discover_capabilities',version='1',result=result)}],8)


def test_rejected_observation_is_not_discovery_success():
    value={'decision':{'kind':'discover_capabilities'},'status':'rejected','capability_result':None,
           'diagnostic':{'code':'authority_changed'}}
    assert continuation_context({},[value],8)['adaptive']['observations']==[value]


def prepare(ctx):
    s,p,ws,_,admin=ctx;cv=conversation(ctx);pg=activated(ctx,cv,'off')
    q=post(ctx,cv,'Discover available tools, then respond within their actual scope.')
    # Add discovery to a fresh fixture grant before installation, not by changing
    # installed authority. Product discovery is the real gateway producer.
    original=policy.install
    def install(db,g,**kwargs):
        d=registry.adapters()['capabilities.discover_legacy'].descriptor
        g=g.model_copy(update={'capabilities':g.capabilities+[CapabilityPin(id=d.id,version=d.version,
            schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256)]})
        return original(db,g,**kwargs)
    with patch.object(policy,'install',install):g=install_workflow(ctx,cv,q,pg)
    return cv,q,g


@pytest.mark.parametrize('revoke',[False,True])
def test_gateway_discovery_worker_restart_and_denial(context,tmp_path,revoke):
    s,p,ws,_,admin=context;cv,q,g=prepare(context)
    fake=AlphaProvider([{'kind':'discover_capabilities'},{'kind':'reply','text':'Only scoped tools are available.'}])
    def hook(name):
        if name=='after_tool_result':raise InterruptedError('retained discovery')
    with pytest.raises(InterruptedError):
        finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    before=journal(s,ws,q.run.id);raw=before['selection','tool_result']['capability_result']
    page=raw['result'];assert page['schema_version']=='capability-page/v2'
    assert any(d['availability_reason']=='available' for d in page['items'])
    assert any(d['availability_reason']=='not_installed' for d in page['items'])
    calls=list(fake.calls);expire(context,q.run.id)
    if revoke:
        with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
        with pytest.raises(DomainError):finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
        assert journal(s,ws,q.run.id)==before and fake.calls==calls
        return
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    assert journal(s,ws,q.run.id)['selection','tool_result']==before['selection','tool_result']
    projected=fake.contexts[1]['adaptive']['observations'][0]['capability_result']
    expected=deepcopy(raw)
    for item in expected['result']['items']:
        item.pop('input_schema');item.pop('output_schema')
    expected['result']['omitted_descriptor_fields']=['input_schema','output_schema']
    assert projected==expected
    with s.db.transaction() as c:
        attempts=c.execute('SELECT capability_id FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchall()
    assert [r['capability_id'] for r in attempts]==['capabilities.discover_legacy']
    calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==calls
