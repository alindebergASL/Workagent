"""Pure DTO/schema checks; PostgreSQL behavior is separately exercised, never mocked."""
from datetime import timedelta
from hashlib import sha256
import pytest
from pydantic import ValidationError
from workagent.models import now, new_id
from workagent.memory.models import RememberMemory, ProposeMemory, CorrectMemory, MemoryReceipt
from workagent.memory.runtime import enabled, SCHEMA


def payload(**changes):
    return dict(schema_version='workagent/v1', request_id=new_id(), command_id=new_id(),
        kind='preference', scope_kind='task', scope_id='conversation', subject_key='writing',
        predicate_key='headings', content='Use concise headings', **changes)


@pytest.mark.parametrize('content', ['api_key = abcdef', 'Bearer secretvalue',
    '-----BEGIN RSA PRIVATE KEY-----', 'sk-1234567890abcdef', 'medical diagnosis: unknown'])
def test_secret_like_and_sensitive_categories_rejected(content):
    value=payload();value['content']=content
    with pytest.raises(ValidationError): RememberMemory.model_validate(value)


@pytest.mark.parametrize('authority,value', [('status','active'),('origin','human_reviewed'),
    ('reviewed_by_principal_id','human'),('proposed_by_run_id','run')])
def test_injection_cannot_claim_promotion_or_provenance(authority,value):
    with pytest.raises(ValidationError): ProposeMemory.model_validate({**payload(),authority:value})


def test_temporary_requires_explicit_finite_interval_and_receipt_has_no_content():
    base=dict(schema_version='workagent/v1',request_id=new_id(),command_id=new_id(),
              expected_revision_id='revision',content='Ten minutes',mode='temporary')
    with pytest.raises(ValidationError): CorrectMemory(**base)
    start=now()
    assert CorrectMemory(**base,valid_from=start,valid_until=start+timedelta(days=7))
    assert set(MemoryReceipt.model_fields)=={'memory_id','revision_id','status'}


def test_memory_opt_in_is_additive_and_historical_schema_unchanged():
    from workagent.capabilities.compute_composition import SCHEMA as compute
    from workagent.capabilities.file_composition import SCHEMA as files
    assert sha256(compute.material).hexdigest()=='b9f18beb013a8cd3f102959bf15a9fa290fbee43281077edc6e71abc547e5d61'
    assert sha256(files.material).hexdigest()=='367cd20e751544b98b18717718f63f37b5221e551afdc7537dfbb239e2ff896f'
    assert not enabled({})
    assert not enabled({'responses':{'continuity_version':'sustained-v1','scope_tool_sha256':sha256(compute.material).hexdigest()}})
    assert enabled({'responses':{'continuity_version':'sustained-v1','scope_tool_sha256':sha256(SCHEMA.material).hexdigest()}})
