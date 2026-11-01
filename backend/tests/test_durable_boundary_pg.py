"""Parent-only serial PG proof on the explicit native projection disposable route.

No lease edits, clock overrides, real transport, grant reactivation, or originals.
"""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
from types import SimpleNamespace as NS
from unittest.mock import patch
import json
import time
import pytest
import psycopg
import httpx
from test_native_retained_projection_pg import (context, approved_disposable_release,
    fixture_route, legacy_grant, AMENDMENT, PREDECESSOR, install)
from test_workspace_files_pg import make, text
from test_workspace_file_gateway_pg import call
from test_general_alpha_runtime import AlphaProvider, activate, launch
from test_general_responses import worker
from test_conversations import post
from test_memory_full_tools import config
from test_local_rejection_settlement import journal, requests
from test_retained_read_gateway_pg import native_rows
from test_gateway_target_rejection import material
from retained_read_visits import finish_natural_visits
from workagent.models import now, new_id
from workagent.db import Database
from workagent.service import WorkerCapability, encoded
from workagent.provider_attempts import ReceiptCapability
from workagent.responses_ledger import Ledger
from workagent.responses_worker import ResponsesWorker
from workagent.adaptive import contract
from workagent.capabilities import policy, registry, implementation_releases as releases
from workagent.capabilities.models import InputRef, ToolGrantV1, CapabilityPin
from workagent.capabilities.broker import CapabilityBroker, NativeAdmissionDeferred
from workagent.errors import DomainError


GOAL='Preserve distinctive cursor27 goal and criteria'
CRITERIA=[dict(kind='wasm_return',arguments=[2],expected='4')]


class DistinctProvider(AlphaProvider):
    """New synthetic responses only; never synthesize a retained identity."""
    def handle(self,request):
        response=super().handle(request)
        if request.method=='POST' and not request.url.path.endswith('input_tokens'):
            data=response.json()
            for item in data.get('output',[]):
                if item['type']=='function_call':
                    value=json.loads(item['arguments']);value.update(goal=GOAL,success_criteria=CRITERIA)
                    item['arguments']=json.dumps(value)
            self.responses[data['id']]=data
            return httpx.Response(200,json=data)
        return response


def wait_remaining(s,p,ws,rid,remaining):
    """Bounded natural wait only; clock/lease are always the real row values."""
    start=time.monotonic();run=s.get_run(p,ws,rid);fence=run.fence;expiry=run.lease_expires_at
    while (expiry-now()).total_seconds()>remaining:
        assert time.monotonic()-start<240
        time.sleep(min(5,max(0.01,(expiry-now()).total_seconds()-remaining)))
        current=s.get_run(p,ws,rid)
        assert current.fence==fence and current.lease_expires_at==expiry
    return run


def direct(ctx,*,limit=100):
    s,p,ws,_,admin=ctx
    cv,human,_=make(ctx);q=post(ctx,cv);d=registry.adapters()['files.create_draft'].descriptor
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256)],
        resource_selectors=[],effects=d.effects,privacy_classes=d.privacy_classes,egress='none',
        expires_at=now()+timedelta(hours=1),access_generation=q.run.access_generation,budget_account_id=new_id(),allow_run_outputs=True)
    policy.install(Database(admin),g,limits=dict(local_compute=limit),amendment_sha256=AMENDMENT)
    cap=s.claim_run(p,ws,q.run.id)
    request=call(cap,q,'files.create_draft',dict(kind='files_create_draft',source=text('Admission27 draft').model_dump(mode='json')),[])
    return g,q,human,cap,request


@pytest.mark.parametrize('slow_final_authority',[False,True])
def test_pg_native_pre_effect_rollback_and_natural_reclaim(context,monkeypatch,slow_final_authority):
    s,p,ws,_,_=context;g,q,human,cap,request=direct(context)
    before=native_rows(context,q.run.id);saved_material=material(context)
    auth=policy.authorize;n=[0]
    def authorize(*args):
        result=auth(*args);n[0]+=1
        if slow_final_authority and n[0]==2:
            # Existing authority returned with adequate slack; consume it after
            # that check, while its lock remains held, without altering any row.
            left=(result[1].lease_expires_at-now()).total_seconds()
            assert left>35
            time.sleep(left-34)
        return result
    if not slow_final_authority:wait_remaining(s,p,ws,q.run.id,34)
    with patch.object(policy,'authorize',authorize):
        with pytest.raises(NativeAdmissionDeferred):CapabilityBroker(s,cap).call(request)
    assert native_rows(context,q.run.id)==before and material(context)==saved_material
    assert n[0]==2
    wait_remaining(s,p,ws,q.run.id,-0.1)
    fresh=s.claim_run(p,ws,q.run.id)
    assert fresh.fence==cap.fence+1
    result=CapabilityBroker(s,fresh).call(request)
    assert result.status=='observed'
    kept=native_rows(context,q.run.id);created=material(context)
    assert len(kept['attempts'])==1
    assert CapabilityBroker(s,fresh).call(request)==result
    assert native_rows(context,q.run.id)==kept and material(context)==created
    assert s.get_artifact(p,ws,human.workspace_file_id).current_revision_id==human.current.version_id


@pytest.mark.parametrize('damage',['stale','revoke','access','budget'])
def test_pg_native_authority_denial_is_not_deferral(context,damage):
    s,p,ws,_,admin=context;g,q,human,cap,request=direct(context,limit=1 if damage=='budget' else 100)
    if damage=='stale':cap=replace(cap,fence=cap.fence+1)
    elif damage=='budget':
        assert CapabilityBroker(s,cap).call(request).status=='observed'
        request=request.model_copy(update={'call_id':request.call_id+'_exhausted'})
    elif damage!='budget':
        with Database(admin).transaction() as c:
            if damage=='revoke':c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
            elif damage=='access':c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
    before=native_rows(context,q.run.id);saved=material(context)
    with pytest.raises((DomainError,psycopg.Error)) as denied:CapabilityBroker(s,cap).call(request)
    if damage=='budget':
        assert isinstance(denied.value,psycopg.Error)
        assert denied.value.diag.message_primary=='tool capacity exhausted'
    assert native_rows(context,q.run.id)==before and material(context)==saved


def test_pg_native_resource_reduction_stays_denied(context):
    s,p,ws,_,admin=context;g,q,human=legacy_grant(context,['files.read_range'])
    releases.install_transition(Database(admin),[g.id],amendment_sha256=AMENDMENT,predecessor_source_sha256=PREDECESSOR)
    cap=s.claim_run(p,ws,q.run.id)
    ref=g.resource_selectors[0]
    request=call(cap,q,'files.read_range',dict(kind='files_read_range',ref=human.current.model_dump(mode='json'),offset=0,limit=8192),[ref])
    policy.restrict_resources(Database(admin),g.id,[ref])
    before=native_rows(context,q.run.id)
    with pytest.raises((DomainError,psycopg.Error)):CapabilityBroker(s,cap).call(request)
    assert native_rows(context,q.run.id)==before


@pytest.mark.parametrize('outcome',['revoked','lost_ack'])
def test_pg_native_post_dispatch_uncertainty_never_replays(context,monkeypatch,outcome):
    s,p,ws,_,admin=context;g,q,human,cap,request=direct(context)
    adapters=registry.adapters();old=adapters['files.create_draft'];invoked=[]
    def invoke(*args):
        invoked.append(True);result=old.invoke_fenced(*args)
        if outcome=='lost_ack':raise RuntimeError('controlled lost acknowledgement')
        with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
        return result
    adapters['files.create_draft']=replace(old,invoke_fenced=invoke)
    monkeypatch.setattr(registry,'adapters',lambda:adapters)
    result=CapabilityBroker(s,cap).call(request)
    assert result.status==('cost_only' if outcome=='revoked' else 'outcome_unknown')
    before=native_rows(context,q.run.id);saved=material(context)
    if outcome=='revoked':
        with pytest.raises(DomainError):CapabilityBroker(s,cap).call(request)
    else:assert CapabilityBroker(s,cap).call(request)==result
    assert invoked==[True] and native_rows(context,q.run.id)==before and material(context)==saved


def provider_setup(ctx):
    s,p,ws,_,_=ctx;cv,human,_=make(ctx)
    instructions,schema=contract(NS(**config('off')['responses']))
    with patch('test_general_alpha_runtime.POLICY',instructions),patch('test_general_alpha_runtime.DECISION_SCHEMA',schema):
        pg=activate(ctx,cv,continuity_version='sustained-v1',max_steps=4,memory_recall='off')
    q=post(ctx,cv,'Create a synthetic draft, preserving the existing human file.')
    ref=InputRef(kind='workspace_file',id=human.workspace_file_id,version=human.current.version_id,sha256=human.current.sha256)
    grant=install(ctx,cv,q,pg,ref)
    return cv,q,grant,human


@pytest.mark.parametrize('boundary',['continuing','terminal','file_rejection','selection_rejection'])
def test_pg_cursor_next_prepare_without_old_stage_or_provider(context,tmp_path,boundary):
    s,p,ws,_,_=context
    if boundary=='file_rejection':
        from test_file_input_rejection import prepare
        cv,q,g,human,bad,good=prepare(context)
        fake=DistinctProvider([bad,dict(kind='reply',text='Unresolved input was reported.')])
        hook_name='after_file_input_rejection'
    elif boundary=='selection_rejection':
        from test_selection_rejection import BAD
        cv,q,g,human=provider_setup(context)
        bad=deepcopy(BAD);bad['source']['sha256']='not-a-sha256'
        fake=DistinctProvider([bad,dict(kind='reply',text='Reported rejection.')])
        hook_name='after_selection_rejection'
        saved_material=material(context)
    else:
        decisions=[dict(kind='reply',text='Truthful terminal reply')] if boundary=='terminal' else [dict(kind='read_context',section='messages'),dict(kind='reply',text='Done')]
        cv,g,q,_,_=launch(context,tmp_path,decisions);fake=DistinctProvider(decisions);hook_name='after_tool_result'
    def stop(name):
        if name==hook_name:raise InterruptedError('retained boundary27')
    with pytest.raises(InterruptedError,match='retained boundary27'):
        finish_natural_visits(context,worker(context,fake,tmp_path,hook=stop),q.run.id)
    before=journal(s,ws,q.run.id);steps=requests(s,ws,q.run.id);native=native_rows(context,q.run.id);calls=list(fake.calls)
    if boundary=='selection_rejection':
        result=before['selection','result'];rejection=before['selection','selection_rejection']
        assert result['state']=='malformed' and result['issue']=='schema_validation_failed'
        assert result['usage'] is not None and result['value'] is None
        assert rejection['request_sha256']==steps['selection']['request_sha256']
        from workagent.service import digest
        assert rejection['result_sha256']==digest(result)
        assert rejection['response_id']==before['selection','identity']['response_id']
        assert rejection['attempt_id']==steps['selection']['attempt_id'] and rejection['phase']=='selection'
        assert rejection['terminal_outcome']=='continue'
        assert not any(kind in ('file_input_rejection','tool_result') for phase,kind in before)
        assert not native['attempts'] and material(context)==saved_material
    expected='final' if boundary=='terminal' else 'selection_2'
    def next_only(self,ledger,request,*args):
        assert request.phase==expected,'settled _step replay'
        raise InterruptedError('new exact boundary prepared27')
    with patch.object(ResponsesWorker,'_step',next_only),patch.object(s,'stage_general_product',side_effect=AssertionError('settled stage replay')):
        with pytest.raises(InterruptedError,match='new exact boundary prepared27'):
            finish_natural_visits(context,worker(context,fake,tmp_path),q.run.id)
    after=requests(s,ws,q.run.id)
    assert set(after)==set(steps)|{expected} and all(after[k]==v for k,v in steps.items())
    assert journal(s,ws,q.run.id)==before and native_rows(context,q.run.id)==native and fake.calls==calls
    if expected!='final':
        projection=json.loads(json.loads(after[expected]['request_bytes'])['input'][0]['content'])['adaptive']['observations']
        if boundary=='selection_rejection':
            assert 'goal' not in projection[0] and 'success_criteria' not in projection[0]
        else:
            assert projection[0]['goal']==GOAL and projection[0]['success_criteria']==CRITERIA


def test_pg_received_native_defer_then_worker_new_claim_once(context,tmp_path):
    s,p,ws,_,_=context;cv,q,g,human=provider_setup(context)
    decision=dict(kind='files_create_draft',source=text('A new admission27 draft').model_dump(mode='json'))
    fake=AlphaProvider([decision,dict(kind='reply',text='The draft is available for review.')]);captured={}
    def stop(cap,receipt,phase='selection'):
        captured.update(cap=cap,receipt=receipt,phase=phase);raise InterruptedError('received unapplied27')
    with patch.object(s,'stage_general_product',stop),pytest.raises(InterruptedError,match='received unapplied27'):
        finish_natural_visits(context,worker(context,fake,tmp_path),q.run.id)
    before=journal(s,ws,q.run.id);steps=requests(s,ws,q.run.id);native=native_rows(context,q.run.id);saved=material(context)
    assert not native['attempts'] and ('selection','tool_result') not in before
    cap=captured['cap'];request=call(cap,q,'files.create_draft',decision,[]).model_copy(update={'call_id':'selection'})
    wait_remaining(s,p,ws,q.run.id,34)
    with pytest.raises(NativeAdmissionDeferred):CapabilityBroker(s,cap).call(request)
    assert journal(s,ws,q.run.id)==before and requests(s,ws,q.run.id)==steps
    assert native_rows(context,q.run.id)==native and material(context)==saved
    result=finish_natural_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='ready' and result.fence>cap.fence
    after=journal(s,ws,q.run.id)
    assert all(after[k]==v for k,v in before.items())
    assert requests(s,ws,q.run.id)['selection']==steps['selection']
    natives=native_rows(context,q.run.id)
    assert len(natives['attempts'])==1 and natives['attempts'][0]['v']['call']['call_id']=='selection'
    assert after['selection','tool_result']['decision']==decision
    for phase in ('selection','selection_2','final'):
        assert all((phase,kind) in after for kind in ('count_send','count_result','dispatch','identity','result'))
    assert s.get_artifact(p,ws,human.workspace_file_id).current_revision_id==human.current.version_id
