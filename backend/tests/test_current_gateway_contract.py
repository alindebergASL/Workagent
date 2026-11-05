"""Pure contract and real catalog routing tests; no DB/provider access."""
from hashlib import sha256
from types import SimpleNamespace as NS
from typing import get_args
import json
import pytest
from pydantic import ValidationError
from workagent.current_gateway import GatewayCurrentDecision, SCHEMA, POLICY, enabled
from workagent.discovery_composition import SCHEMA as DISCOVERY
from workagent.capabilities.delegation_composition import SCHEMA as DELEGATION
from workagent.adaptive import contract
from workagent.responses_transport import RequestMetadata, build_tool_selection, _validate_request
from workagent.service import canonical


def config(schema=SCHEMA):
    return {'responses':{'continuity_version':'sustained-v1','scope_tool_sha256':sha256(schema.material).hexdigest()}}


def kinds(schema):
    return {c.model_fields['kind'].annotation.__args__[0] for c in get_args(schema.model.model_fields['decision'].annotation)}


def test_old_material_exact_and_only_publish_removed():
    assert sha256(DELEGATION.material).hexdigest()=='1073c3bc5d71a3de2126733c224ecd729605965f39917709d56934c868bc7f41'
    assert sha256(DISCOVERY.material).hexdigest()=='e662b6d28c9bd98bd3e0f9e9ed5f417081dd18d3f81f3c2eed71a56535a4c591'
    assert kinds(SCHEMA)==kinds(DISCOVERY)-{'publish_artifact'}
    assert 'PublishArtifact' not in SCHEMA.material.decode()


@pytest.mark.parametrize('choice',[
    {'kind':'files_create_draft','source':{'kind':'text','filename':'useful.txt','mime_type':'text/plain','content':'hello','sha256':sha256(b'hello').hexdigest()}},
    {'kind':'files_propose_patch','ref':{'workspace_file_id':'file','version_id':'version','sha256':'a'*64},'content':'new text','sha256':sha256(b'new text').hexdigest(),'reason':'Propose only'},
    {'kind':'discover_retained_references','cursor':None,'limit':12},
    {'kind':'search_work_context_page','query':'needle','cursor':None,'limit':6},
    {'kind':'reply','text':'No edit claimed.'},
])
def test_current_choice_roundtrip(choice):
    raw=dict(goal='Preserve human work',success_criteria=[],decision=choice)
    value=GatewayCurrentDecision.model_validate(raw)
    assert value.model_dump(mode='json')==raw
    assert SCHEMA.validate(canonical(raw)).decision==value.decision


def test_legacy_choice_not_reinterpreted():
    raw=dict(goal='legacy',success_criteria=[],decision={'kind':'publish_artifact','target':None,
        'body':{'title':'Draft','blocks':[{'block_id':'note','kind':'paragraph','text':'Preserved','checked':None}]}})
    assert DELEGATION.validate(canonical(raw)).decision.kind=='publish_artifact'
    assert DISCOVERY.validate(canonical(raw)).decision.kind=='publish_artifact'
    with pytest.raises(ValidationError): GatewayCurrentDecision.model_validate(raw)



@pytest.mark.parametrize('schema',[DELEGATION,DISCOVERY,SCHEMA])
def test_exact_contract_transport_and_unchanged_provider_limits(schema):
    binding=NS(**config(schema)['responses'])
    policy,selected=contract(binding)
    assert selected is schema
    request=build_tool_selection(source_context=canonical({'messages':[]}),instructions=policy,read_schema=schema,
        metadata=RequestMetadata(request_id='run',attempt_id='attempt',step_id='selection'),policy='adaptive-local-v1')
    body=_validate_request(request)
    assert body['tool_choice']=={'type':'function','name':'choose_general_action'}
    from workagent.responses_transport import MAX_INPUT_TOKENS
    assert MAX_INPUT_TOKENS==50000
    assert body['max_output_tokens']==8192
    assert body['tools'][0]['parameters']==schema.model.model_json_schema()


def test_opt_in_requires_both_pins():
    assert enabled(config())
    assert not enabled(config(DISCOVERY))
    assert not enabled({'responses':{'scope_tool_sha256':sha256(SCHEMA.material).hexdigest()}})
    assert not enabled({'responses':{'continuity_version':'sustained-v1','scope_tool_sha256':'0'*64}})


from test_model_discovery_v2 import env, Store, Result, call, search, work_rows
from contextlib import nullcontext
from copy import deepcopy
from workagent.errors import DomainError


def catalog_fixture(env,monkeypatch,schema=SCHEMA):
    from workagent.capabilities import policy,registry
    from workagent.capabilities.models import CapabilityPage
    from workagent.composition import DiscoverCapabilities
    env.config['responses'].update(config(schema)['responses'])
    env.service.db=NS(transaction=lambda:nullcontext(env.c))
    env.service._check_capability=lambda *a:(env.p,env.run,None)
    original=env.c.execute
    def execute(sql,args=()):
        if sql.startswith('SELECT data FROM run_configurations'):return Result([{'data':env.config}])
        return original(sql,args)
    monkeypatch.setattr(env.c,'execute',execute)
    monkeypatch.setattr(policy,'discover',lambda *a:CapabilityPage(items=[]))
    return lambda:registry._read(DiscoverCapabilities)(env.service,object(),DiscoverCapabilities(kind='discover_capabilities'))


@pytest.mark.parametrize('schema',[DELEGATION,DISCOVERY,SCHEMA])
def test_real_gateway_catalog_separates_builtins_without_fake_adapters(env,monkeypatch,schema):
    invoke=catalog_fixture(env,monkeypatch,schema)
    result=invoke()['result']
    assert result['items']==[]
    assert result['schema_version']==('gateway-capability-page/v1' if schema is SCHEMA else 'capability-page/v2')
    if schema is not SCHEMA:
        assert set(result)=={'schema_version','items'}
        return
    assert {d['name'] for d in result['builtin_operations']}=={'discover_retained_references','search_work_context_page'}
    assert all(d['version']=='2' and d['input_schema'] for d in result['builtin_operations'])
    from workagent.capabilities import registry
    assert not {'discover_retained_references','search_work_context_page'} & set(registry.adapters())
    assert env.checked==['grant','runtime']
    assert env.c.scans==0 and env.c.receipts==[]  # Catalog is not a search.


def test_responsibility_catalog_omits_scope_denied_search(env,monkeypatch):
    invoke=catalog_fixture(env,monkeypatch)
    env.config['responsibility']={'observations':[]}
    assert [d['name'] for d in invoke()['result']['builtin_operations']]==['discover_retained_references']
    with pytest.raises(DomainError):call(env,search())


@pytest.mark.parametrize('damage',['grant','generation','principal','conversation','config','scope','fence'])
def test_catalog_current_authority_denial_no_descriptors(env,monkeypatch,damage):
    from workagent import provider_attempts,general_responses
    invoke=catalog_fixture(env,monkeypatch)
    def denied(*a):raise DomainError('not_found_or_not_authorized')
    if damage=='grant':monkeypatch.setattr(provider_attempts,'check_grant',denied)
    if damage=='generation':env.service._scope=lambda *a:2
    if damage=='principal':env.run.principal_id='someone_else'
    if damage=='conversation':env.service._owned_conversation=lambda *a:NS(id='other')
    if damage=='config':monkeypatch.setattr(general_responses,'check_pins',lambda *a:{})
    if damage=='scope':env.c.scope=None
    if damage=='fence':env.service._check_capability=denied
    with pytest.raises(DomainError):invoke()
    assert env.c.scans==0 and env.c.receipts==[]


def test_new_schema_uses_existing_typed_receipts_and_restart_validation(env):
    env.config['responses'].update(config()['responses'])
    work_rows(env,1)
    before=deepcopy(env.c.messages)
    first=call(env,search());again=call(env,search())
    assert first==again and len(env.c.receipts)==1 and env.c.scans==1
    assert env.c.messages==before
    env.service._scope=lambda *a:2
    with pytest.raises(DomainError):call(env,search())
    assert env.c.scans==1 and len(env.c.receipts)==1


@pytest.mark.parametrize('schema',[DELEGATION,DISCOVERY,SCHEMA])
def test_snapshot_restores_exact_prepared_request_and_validator(monkeypatch,schema):
    from workagent.responses_ledger import Ledger
    from workagent import general_responses
    cfg=config(schema);cfg['responses'].update(policy_version='adaptive-local-v1',runtime_extension='general-alpha-v1')
    request=build_tool_selection(source_context='{}',instructions=contract(NS(**cfg['responses']))[0],read_schema=schema,
        metadata=RequestMetadata(request_id='run',attempt_id='attempt',step_id='selection'),policy='adaptive-local-v1')
    row=dict(request_bytes=request.body.decode(),request_sha256=request.sha256,count_bytes=request.count_body().decode(),metadata=request.metadata.model_dump())
    frozen=deepcopy(row)
    class C:
        def execute(self,sql,args=()):
            assert sql.startswith('SELECT * FROM responses_steps')
            return Result([row])
    ledger=Ledger.__new__(Ledger);ledger.receipt=NS(attempt_id='attempt')
    ledger.service=NS(db=NS(transaction=lambda:nullcontext(C())))
    ledger._auth=lambda *a,**k:(NS(profile='general-responses-v1'),None,None)
    ledger._events=lambda *a:{'count_result':{'input_tokens':123}}
    monkeypatch.setattr(general_responses,'check_pins',lambda *a:cfg)
    saved,events=ledger.snapshot('selection',object())
    assert saved.body==request.body and saved.count_body()==request.count_body() and saved.schema is schema
    assert _validate_request(saved)==_validate_request(request)
    assert row==frozen and events=={'count_result':{'input_tokens':123}}


@pytest.mark.parametrize('treatment',['off','reviewed-v1'])
def test_current_memory_treatment_uses_same_strict_binding(treatment):
    from workagent.models import GeneralAlphaResponsesBinding
    from workagent.memory.runtime import enabled as memory_enabled
    binding=NS(**config()['responses'],memory_recall=treatment)
    assert GeneralAlphaResponsesBinding.full_tool_memory_treatment(binding) is binding
    assert contract(binding)[1] is SCHEMA
    assert memory_enabled({'responses':vars(binding)}) is (treatment=='reviewed-v1')


def test_real_catalog_survives_next_request_projection_without_mutating_receipt(env,monkeypatch):
    from workagent.adaptive import continuation_context
    page=catalog_fixture(env,monkeypatch)()
    original=deepcopy(page)
    observation={'capability_result':page}
    result=continuation_context({},[observation],8)
    projected=result['adaptive']['observations'][0]['capability_result']['result']
    assert page==original
    assert {x['name'] for x in projected['builtin_operations']}=={'discover_retained_references','search_work_context_page'}
    assert all('input_schema' not in x for x in projected['builtin_operations'])
    assert projected['omitted_descriptor_fields']==['input_schema','output_schema']
    forged=deepcopy(observation)
    forged['capability_result']['result']['builtin_operations'][0]['grant_id']='forged'
    with pytest.raises(ValidationError):continuation_context({},[forged],8)
