"""Final-source offline boundary integration: no DB, provider, or authority cache."""
from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock
import json
import pytest
from pydantic import ValidationError
from workagent import request_packing as packing
from workagent import general_responses
from workagent.general_schema import DECISION_SCHEMA
from workagent.models import now
from workagent.service import canonical
from workagent.errors import DomainError
from workagent.responses_transport import (RequestMetadata, MAX_INPUT_TOKENS, DispatchPermit,
    ResponsesTransport, TransportError, Provenance)
from workagent.capabilities import policy, boundary_policy, registry, implementation_releases
from workagent.capabilities.models import ToolGrantV1, CapabilityPin, InputRef, ToolCallV1


def build(context):
    return packing.prepare_selection(context,instructions='Synthetic offline instruction.',read_schema=DECISION_SCHEMA,
        metadata=RequestMetadata(request_id='run',attempt_id='attempt',step_id='selection'))


@pytest.mark.parametrize('mode',['required_human','system_continuation','retained_observation'])
def test_estimate_cannot_reject_required_or_retained_input(monkeypatch,mode):
    monkeypatch.setattr(packing,'_encoder',lambda:None)
    text='Exact retained synthetic bytes é🙂\r\n'*2500
    ctx=dict(run_id='run',messages=[dict(run_id='run',author_kind='human',text=text)])
    if mode=='system_continuation':
        ctx['run_id']='later'
        ctx['messages'].append(dict(run_id='later',author_kind='system',text='Continue within authority'))
    if mode=='retained_observation':
        ctx['messages'][0]['text']='Keep these exact receipts'
        ctx['adaptive']=dict(observations=[dict(phase='selection',goal='Distinctive',success_criteria=[dict(kind='wasm_return',arguments=[2],expected='4')],binding=dict(operation_hash='a'*64),capability_result=dict(text=text))])
    before=deepcopy(ctx);request=build(ctx)
    projected=json.loads(json.loads(request.body)['input'][0]['content'])
    assert projected['messages']==ctx['messages']
    if 'adaptive' in ctx:assert projected['adaptive']==ctx['adaptive']
    assert ctx==before and packing.request_metrics(request)['estimated_input_tokens']>MAX_INPUT_TOKENS
    before_bytes=request.body
    assert packing.check_final(request) is request and request.body==before_bytes
    assert request.count_body()


def test_optional_compaction_and_exact_count_limit_stay_separate(monkeypatch):
    monkeypatch.setattr(packing,'_encoder',lambda:None)
    messages=[dict(run_id='old',author_kind='assistant',text='Optional '*20000),dict(run_id='run',author_kind='human',text='Keep exact')]
    request=build(dict(run_id='run',messages=messages))
    projected=json.loads(json.loads(request.body)['input'][0]['content'])
    assert projected['messages']==[messages[-1]] and projected['history_window']['omitted_messages']==1
    transport=NS(_issuer=object(),provenance=Provenance('synthetic','https://synthetic.invalid'))
    with pytest.raises(TransportError,match='invalid_count_receipt'):
        ResponsesTransport.restore_count(transport,request,input_tokens=MAX_INPUT_TOKENS+1,
            count_sha256=sha256(request.count_body()).hexdigest(),provenance=transport.provenance)
    with pytest.raises(ValidationError):
        DispatchPermit(metadata=request.metadata,request_sha256=request.sha256,input_tokens=MAX_INPUT_TOKENS+1,
            model='gpt-6.1-sol',service_tier='default',input_reservation_usd_per_million='2.5',output_reservation_usd_per_million='10',
            durable_predispatch_committed=True,aggregate_budget_reserved=True,live_grant_id='grant')


RUN=NS(workspace_id='workspace',id='run',principal_id='human',access_generation=1)
IDENTITY=dict(source_sha256='c'*64,consumer_sha256='d'*64)


class Cursor:
    """Only SQL result doubles: all authority denials are still SQL decisions."""
    def __init__(self,ds,*,mapped=True):
        self.ds={d.id:d.model_dump(mode='json') for d in ds};self.mapped=mapped
        self.bound=True;self.available=True;self.active=True;self.denied=[];self.calls=[]
        self.grant=ToolGrantV1(id='grant',workspace_id='workspace',principal_id='human',run_id='run',scope_id='scope',
            capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
            resource_selectors=[InputRef(kind='workspace_file',id='file',version='v1',sha256='a'*64)],
            effects=['read','draft','local_compute'],privacy_classes=['public','workspace_private'],egress='public_https',
            expires_at=now()+timedelta(hours=1),access_generation=1,budget_account_id='account')
    def execute(self,sql,args):
        self.calls.append((sql,args));value=None
        if 'SELECT 1 FROM tool_grants' in sql:value={'exists':1} if self.bound else None
        elif 'SELECT tool_run_available' in sql:value={'ok':self.available}
        elif 'SELECT data,active FROM tool_grants' in sql:value={'data':self.grant.model_dump(mode='json'),'active':self.active}
        elif 'SELECT selector FROM tool_scope_reductions' in sql:self.rows=[dict(selector=s) for s in self.denied];return self
        elif 'SELECT id FROM tool_grants' in sql:value={'id':'grant'} if self.bound else None
        elif 'SELECT 1 FROM tool_grant_implementation_bindings' in sql:value={'exists':1} if self.mapped else None
        elif 'SELECT tool_implementation_descriptor' in sql:value={'d':deepcopy(self.ds.get(args[1]))}
        else:raise AssertionError(sql)
        self.rows=[] if value is None else [value];return self
    def fetchone(self):return self.rows[0] if self.rows else None
    def fetchall(self):return self.rows


def descriptors():
    current=registry.adapters()
    return [current[k].descriptor for k in sorted(implementation_releases.TRANSITION_IDS)]


def test_actual_require_run_tools_one_inventory_twelve_live_pins(monkeypatch):
    ds=descriptors();c=Cursor(ds);compute=Mock(return_value=IDENTITY)
    monkeypatch.setattr(boundary_policy,'execution_identity',compute)
    policy.require_run_tools(c,RUN)
    checks=[a for sql,a in c.calls if 'SELECT tool_implementation_descriptor' in sql]
    assert compute.call_count==1 and len(checks)==12
    assert [a[1] for a in checks]==[d.id for d in ds]
    assert all(a[2:]==(IDENTITY['source_sha256'],IDENTITY['consumer_sha256']) for a in checks)
    assert any('tool_run_available' in sql for sql,_ in c.calls)
    assert any('tool_scope_reductions' in sql for sql,_ in c.calls)
    # Direct resolver call counts are14; require_run_tools retains its four
    # caller-authority queries, yielding18, not a claim of14 for the whole gate.
    assert len(c.calls)==18


@pytest.mark.parametrize('damage',['revoked','expired','generation','provider','disabled','partial','wrong_descriptor','missing_grant'])
def test_same_fence_current_sql_denials_are_not_cached(monkeypatch,damage):
    ds=descriptors();c=Cursor(ds);compute=Mock(return_value=IDENTITY)
    monkeypatch.setattr(boundary_policy,'execution_identity',compute)
    policy.require_run_tools(c,RUN);before=len(c.calls)
    if damage=='revoked':c.active=False
    elif damage in ('expired','generation','provider'):c.available=False
    elif damage=='missing_grant':
        # Resolver never accepts disappearance of a previously required grant.
        c.bound=False
    elif damage=='wrong_descriptor':c.ds[ds[-1].id]['implementation_sha256']='e'*64
    else:c.ds[ds[-1].id]=None
    with pytest.raises(DomainError):
        if damage=='missing_grant':boundary_policy.resolve_descriptors(c,RUN,ds)
        else:policy.require_run_tools(c,RUN)
    assert len(c.calls)>before and RUN.access_generation==1


def test_current_resource_reduction_without_generation_change_denies_input(monkeypatch):
    adapter=registry.adapters()['files.read_range'];c=Cursor([adapter.descriptor]);ref=c.grant.resource_selectors[0]
    monkeypatch.setattr(boundary_policy,'execution_identity',lambda:IDENTITY)
    monkeypatch.setattr(implementation_releases,'execution_identity',lambda:IDENTITY)
    policy.require_run_tools(c,RUN)
    c.denied=[ref.model_dump(mode='json')]
    cap=object();scope=NS(id='scope',work_version=1)
    service=NS(_check_capability=lambda c,cap:(NS(id='human'),RUN,scope))
    call=ToolCallV1(call_id='selection',capability_id=adapter.descriptor.id,capability_version=adapter.descriptor.version,
        arguments={},input_refs=[ref],expected_work_version=1)
    with pytest.raises(DomainError):policy.authorize(service,c,cap,call,adapter)
    assert RUN.access_generation==1 and c.denied


def test_source_identity_recomputed_per_invocation_and_legacy_exact_path(monkeypatch):
    ds=descriptors();c=Cursor(ds);other={**IDENTITY,'source_sha256':'f'*64}
    compute=Mock(side_effect=[IDENTITY,other]);monkeypatch.setattr(boundary_policy,'execution_identity',compute)
    assert boundary_policy.resolve_descriptors(c,RUN,ds)==IDENTITY
    assert boundary_policy.resolve_descriptors(c,RUN,ds)==other
    assert compute.call_count==2
    checks=[a for sql,a in c.calls if 'SELECT tool_implementation_descriptor' in sql]
    assert checks[0][2]!=checks[12][2]
    c=Cursor(ds,mapped=False)
    monkeypatch.setattr(boundary_policy,'execution_identity',lambda:pytest.fail('legacy path must not invent a release'))
    assert boundary_policy.resolve_descriptors(c,RUN,ds) is None
    assert all(a[2:]==(None,None) for sql,a in c.calls if 'SELECT tool_implementation_descriptor' in sql)
    with pytest.raises(DomainError):boundary_policy.resolve_descriptors(c,RUN,[ds[0],ds[0]])
    assert boundary_policy.resolve_descriptors(c,RUN,[]) is None


@pytest.mark.parametrize('relative,descriptor_changes',[('capabilities/boundary_policy.py',True),('request_packing.py',False)])
def test_actual_consumer_and_descriptor_dependency_closure(monkeypatch,relative,descriptor_changes):
    root=Path(general_responses.__file__).parent
    before_consumer=general_responses.consumer_hash();before_descriptor=registry.adapters()['files.list'].descriptor.implementation_sha256
    read_bytes=Path.read_bytes
    def changed(path):
        value=read_bytes(path)
        return value+b'\n# isolated dependency mutation proof\n' if path==root/relative else value
    monkeypatch.setattr(Path,'read_bytes',changed)
    assert general_responses.consumer_hash()!=before_consumer
    after=registry.adapters()['files.list'].descriptor.implementation_sha256
    assert (after!=before_descriptor)==descriptor_changes
