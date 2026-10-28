"""Offline contract and byte/replay tests. Database acceptance is in *_pg.py."""
import json
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic import ValidationError
from workagent.adaptive import contract
from workagent.checkpoint_models import StopRun, ContinueRun, CancelQueuedMessage
from workagent.composition import (AlphaDecision, ContinuityDecision, DECISION_SCHEMA,
    CONTINUITY_DECISION_SCHEMA, LEGACY_CONTINUITY_DECISION_SCHEMA)
from workagent.errors import DomainError
from workagent.retained_results import (ReadResult, SustainedDecision, SCHEMA, POLICY, enabled,
    page_bytes, redact, read)
from workagent.responses_transport import build_tool_selection, RequestMetadata, _validate_request
from workagent.service import canonical

ROOT=Path(__file__).resolve().parents[2]


def decision(**kw):
    return dict(kind='read_result',run_id='run-1',phase='selection',operation_hash='1'*64,offset=0,limit=8192,**kw)


def test_historical_schema_bytes_stay_frozen_and_new_contract_is_explicit():
    for name,schema in [('alpha-decision.schema.json',DECISION_SCHEMA),('continuity-decision.schema.json',CONTINUITY_DECISION_SCHEMA)]:
        assert canonical(json.loads((ROOT/'contracts'/name).read_text())).encode()==schema.material
    raw={'goal':'Use retained evidence','success_criteria':[],'decision':decision()}
    for model in (AlphaDecision,ContinuityDecision,LEGACY_CONTINUITY_DECISION_SCHEMA.model):
        with pytest.raises(ValidationError): model.model_validate(raw)
    assert isinstance(SustainedDecision.model_validate(raw).decision,ReadResult)
    legacy=SimpleNamespace(runtime_extension='general-alpha-v1',continuity_version='sustained-v1',scope_tool_sha256='0'*64)
    assert contract(legacy)[1] is CONTINUITY_DECISION_SCHEMA
    current=SimpleNamespace(**{**vars(legacy),'scope_tool_sha256':sha256(SCHEMA.material).hexdigest()})
    assert contract(current)==(POLICY,SCHEMA)
    assert not enabled({'responses':{'continuity_version':'sustained-v1'}})
    # SQL admission's opt-in constant matches exact additive schema bytes.
    assert sha256(SCHEMA.material).hexdigest() in (ROOT/'backend/migrations/050_original_attachment_ranges.sql').read_text()
    assert '0b6664002a3c49a5a9c415ab8bc676d528309920d2eb1320b7d59f10268fe177' in (ROOT/'backend/migrations/048_run_checkpoints.sql').read_text()


def test_new_closed_schema_builds_a_real_prepared_worker_request():
    request=build_tool_selection(source_context=canonical({'messages':[],'retained_results':[]}),instructions=POLICY,read_schema=SCHEMA,
        metadata=RequestMetadata(request_id='run-1',attempt_id='attempt-1',step_id='selection'),policy='adaptive-local-v1')
    parsed=_validate_request(request)
    assert parsed['tools'][0]['parameters']==SustainedDecision.model_json_schema()
    assert request.body==bytes(request.body)


@pytest.mark.parametrize('field,value',[('offset',True),('offset',-1),('offset','0'),('limit',8193),('limit',0),('limit','20'),('phase','unbounded'),('operation_hash','bad')])
def test_read_decision_strict_bounds(field,value):
    raw=decision();raw[field]=value
    with pytest.raises(ValidationError): ReadResult.model_validate(raw)


@pytest.mark.parametrize('field',['path','url','account','body','principal_id'])
def test_read_decision_cannot_supply_authority_or_source(field):
    with pytest.raises(ValidationError): ReadResult.model_validate({**decision(),field:'untrusted'})


def test_utf8_pages_are_fixed_canonical_bytes_and_use_safe_actual_offsets():
    raw=canonical({'body':'Aé🙂\r\n漢字'}).encode()
    parts=[]; offset=0
    while offset<len(raw):
        page=page_bytes(raw,offset,5)
        assert page['offset']==offset and page['next_offset']>offset
        assert page['body_sha256']==sha256(raw).hexdigest()
        parts.append(page['text'].encode()); offset=page['next_offset']
    assert b''.join(parts)==raw and page['complete']
    start=raw.index('🙂'.encode())
    with pytest.raises(DomainError): page_bytes(raw,start+1,5)
    with pytest.raises(DomainError): page_bytes(raw,start,1)
    with pytest.raises(DomainError): page_bytes(raw,len(raw)+1,8)
    assert page_bytes(raw,len(raw),8)['text']==''


def test_credential_fields_and_reasoning_are_redacted_without_mutating_receipt():
    original={'text':'safe evidence','nested':[{'APIKey':'SECRET','authorization':'Bearer private',
        'reasoning':'PRIVATE','access_token':'SECRET','client-secret':'SECRET'}]}
    safe=redact(original)
    assert safe['text']=='safe evidence'
    assert set(safe['nested'][0].values())=={'[redacted]'}
    assert original['nested'][0]['APIKey']=='SECRET'


class ReadConnection:
    def __init__(self): self.saved=None; self.pages=0; self.size=0; self.inserts=0
    def execute(self,sql,params):
        if sql.startswith('SELECT data FROM retained_result_reads'):
            result=self.saved
        elif sql.startswith('SELECT count(*)'):
            result={'pages':self.pages,'bytes':self.size}
        elif sql.startswith('INSERT INTO retained_result_reads'):
            self.saved={'data':params[-1].obj}; self.inserts+=1
            self.pages+=1;self.size+=params[-2];result=None
        else: raise AssertionError(sql)
        return SimpleNamespace(fetchone=lambda:result)


def test_trusted_read_receipt_is_exact_on_replay_and_missing_body_is_not_refetched(monkeypatch):
    import workagent.retained_results as retained
    material=Mock(return_value=b'{"text":"retained"}')
    monkeypatch.setattr(retained,'material',material)
    c=ReadConnection(); run=SimpleNamespace(workspace_id='w',id='r')
    d=ReadResult.model_validate(decision())
    first=read(None,c,None,run,None,d,'selection',{'operation_hash':'a'*64})
    assert c.inserts==1 and first['result']['text']=='{"text":"retained"}'
    assert read(None,c,None,run,None,d,'selection',{'operation_hash':'a'*64})==first
    assert c.inserts==1
    material.return_value=b'changed'
    with pytest.raises(DomainError,match='source_changed'): read(None,c,None,run,None,d,'selection',{'operation_hash':'a'*64})
    c=ReadConnection();material.return_value=None
    assert read(None,c,None,run,None,d,'selection',{})['result']=={'status':'unavailable'}
    assert c.inserts==1 and c.size==0


@pytest.mark.parametrize('pages,size',[(8,0),(1,32768)])
def test_retained_aggregate_budget_is_enforced_before_context(monkeypatch,pages,size):
    import workagent.retained_results as retained
    monkeypatch.setattr(retained,'material',lambda *args:b'body')
    c=ReadConnection();c.pages=pages;c.size=size
    with pytest.raises(DomainError,match='budget_exhausted'):
        read(None,c,None,SimpleNamespace(workspace_id='w',id='r'),None,ReadResult.model_validate(decision()),'selection',{})
    assert c.inserts==0


def test_control_dtos_reject_stale_client_shape_and_openapi_exposes_exact_routes():
    common=dict(schema_version='workagent/v1',request_id='req',command_id='cmd')
    for model,body in [(StopRun,{'expected_work_version':1,'run_id':'run'}),
                       (ContinueRun,{'expected_work_version':1,'checkpoint_id':'cp','checkpoint_hash':'0'*64}),
                       (CancelQueuedMessage,{'expected_queue_version':1})]:
        assert model.model_validate({**common,**body})
        with pytest.raises(ValidationError): model.model_validate({**common,**body,'latest':True})
    from workagent.api import create_app
    paths=create_app().openapi()['paths']
    base='/v1/workspaces/{workspace_id}/conversations/{conversation_id}'
    assert all(base+suffix in paths for suffix in ('/stop','/continue','/checkpoints','/queued-messages','/queued-messages/{queued_message_id}/cancel'))


def test_progress_compares_material_not_provider_identity_or_bookkeeping():
    from workagent.run_successors import progress_keys
    body={'title':'Retained work'}
    first={'status':'observed','body':body,'output':{'kind':'artifact_draft'},'binding':{'attempt_id':'old'}}
    replay={**first,'binding':{'attempt_id':'new'}}
    assert progress_keys([first])==progress_keys([replay])
    assert not progress_keys([{'status':'rejected','body':body}])
    assert not progress_keys([{'capability_result':{'capability':'discover_capabilities','result':{'anything':'new'}}}])
    page={'status':'available','body_sha256':'a'*64,'offset':0,'next_offset':8192}
    read={'decision':{'operation_hash':'b'*64},'capability_result':{'capability':'read_result','result':page}}
    assert progress_keys([read])
    bookkeeping={**read,'decision':{'operation_hash':'a'*64}}
    assert not progress_keys([bookkeeping])
