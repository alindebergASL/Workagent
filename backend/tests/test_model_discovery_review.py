"""Focused actual-Python regressions; not PostgreSQL security evidence."""
from hashlib import sha256
from types import SimpleNamespace as NS
import pytest
from workagent import model_discovery as md
from workagent.models import GeneralAlphaResponsesBinding
from workagent.discovery_composition import SCHEMA, POLICY
from workagent.memory import runtime
from workagent.adaptive import contract
from test_model_discovery_v2 import env, work_rows, call, search

@pytest.mark.parametrize('treatment', ['off', 'reviewed-v1'])
def test_explicit_treatment_validator_policy_and_runtime_agree(treatment):
    b = NS(memory_recall=treatment, continuity_version='sustained-v1',
           scope_tool_sha256=sha256(SCHEMA.material).hexdigest())
    assert GeneralAlphaResponsesBinding.full_tool_memory_treatment(b) is b
    assert contract(b)[1] is SCHEMA
    assert runtime.enabled({'responses': vars(b)}) is (treatment == 'reviewed-v1')
    assert b.memory_recall == treatment
    data=dict(vars(b),runtime_extension='general-alpha-v1',project_id='proj_synthetic',
        secret_reference='file:/synthetic/not-a-key',transport_mode='synthetic',
        instructions_sha256=sha256(contract(b)[0].encode()).hexdigest(),schema_sha256='1'*64,
        authorization_sha256='2'*64,generation_limit=4,count_limit=4,read_limit=20,
        input_limit=1000,output_limit=1000,cost_limit_usd='1.00',conversation_ids=['local'])
    model=GeneralAlphaResponsesBinding.model_validate(data)
    frozen=model.model_dump(mode='json')
    assert frozen['memory_recall']==treatment and data['memory_recall']==treatment
    assert GeneralAlphaResponsesBinding.model_validate(frozen).model_dump(mode='json')==frozen
    from workagent.capabilities.delegation_composition import SCHEMA as LEGACY_SCHEMA
    old={**data,'scope_tool_sha256':sha256(LEGACY_SCHEMA.material).hexdigest()}
    assert old['scope_tool_sha256']=='1073c3bc5d71a3de2126733c224ecd729605965f39917709d56934c868bc7f41'
    assert GeneralAlphaResponsesBinding.model_validate(old).memory_recall==treatment
    assert runtime.enabled({'responses':old}) is (treatment=='reviewed-v1')
    absent=GeneralAlphaResponsesBinding.model_validate({k:v for k,v in data.items() if k!='memory_recall'})
    assert 'memory_recall' not in absent.model_dump(mode='json')
    assert not runtime.enabled({'responses':absent.model_dump(mode='json')})
    for change in ({'scope_tool_sha256':'0'*64},{'continuity_version':None},{'memory_recall':'automatic'}):
        with pytest.raises(ValueError):GeneralAlphaResponsesBinding.model_validate({**data,**change})

def test_scan_deduplicates_descriptors_without_losing_position():
    rows = [{'position': i, 'candidate': x} for i,x in enumerate(['a','a','b'])]
    assert md.scan(rows, 2, lambda row: row['candidate']) == (['a','b'],2,False)

def test_v2_query_is_exact_literal_with_original_character_offset(env):
    work_rows(env,1)
    env.c.messages['message-0000']['text'] = 'NEEDLE then needle hay'
    assert call(env,search(query='needle hay'))['result']['items'][0]['excerpt_start'] == 0
    # Literal phrase, not OR-of-words and not database-locale case folding.
    env.c.receipts.clear()
    assert call(env,search(query='needle absent'))['result']['items'] == []

@pytest.mark.parametrize('corruption',['duplicate','query','offset'])
def test_actual_python_reuse_rejects_bad_items(env,corruption):
    from copy import deepcopy
    from workagent.errors import DomainError
    work_rows(env,1)
    decision=search()
    items=deepcopy(call(env,decision)['result']['items'])
    if corruption=='duplicate':items.append(deepcopy(items[0]))
    elif corruption=='query':decision=search(query='not present')
    else:items[0]['excerpt_start']=1
    with pytest.raises(DomainError):
        md.validate_items(env.service,env.c,env.p,env.run,env.cv,decision,items)


def test_unicode_literal_offsets_match_original_codepoints(env):
    work_rows(env,1)
    env.c.messages['message-0000']['text']='😀é'*150+'Needle ß İ'+' tail'*500
    hit=call(env,search(query='Needle ß İ'))['result']['items'][0]
    assert hit['excerpt_start']==100 and len(hit['excerpt'])==2000
    assert hit['excerpt']==env.c.messages['message-0000']['text'][100:2100]


def test_saved_revision_producer_revalidation_uses_real_material(env, monkeypatch):
    from workagent.errors import DomainError
    from datetime import datetime, timezone
    revoked = False
    env.c.rows = [{'position':['other','saved_revision','a'], 'candidate':{
        'conversation_id':'other','kind':'saved_revision','record_id':'a'}}]
    env.service._artifact = lambda *a: ({'conversation_id':'other'},'owner')
    def revision(*a):
        if revoked: raise DomainError('not_found_or_not_authorized')
        return NS(body={'kind':'document','text':'needle'},id='v',author_kind='worker',created_at=datetime(2026,1,1,tzinfo=timezone.utc))
    env.service._revision = revision
    assert call(env,search())['result']['items']
    revoked = True
    with pytest.raises(DomainError): call(env,search())
