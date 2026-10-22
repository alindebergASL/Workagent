"""Synthetic input-packing probes. No provider or live database calls."""
from copy import deepcopy
import json
import pytest
from workagent.errors import DomainError
from workagent.service import canonical, digest
from workagent.composition import CONTINUITY_POLICY, CONTINUITY_DECISION_SCHEMA, ReadContext, execute_read
from workagent.responses_transport import RequestMetadata
from workagent.request_packing import project_context, prepare_selection, request_metrics, estimate


def fixture_context():
    body={'title':'Synthetic handover','blocks':[{'block_id':'note','kind':'paragraph','text':'HUMAN NOTE: keep all three checks.','checked':None}]}
    context={'run_id':'run-current','messages':[
        {'id':'m1','run_id':'older','author_kind':'human','sequence':1,'text':'Original direction'},
        {'id':'m2','run_id':'run-current','author_kind':'human','sequence':2,'text':'Keep my exact current edits.'}],
        'instructions':'duplicate control-plane copy','tools':[{'schema':'duplicate'}],
        'target_body':{'id':'rev-current','body':body},
        'dependencies':[{'binding':{'object_id':'artifact-current','observed_version':'rev-current'},'content':deepcopy(body)}],
        'work_area_context':{'artifacts':[{'artifact_id':'artifact-current','revision_id':'rev-current','body_hash':digest(body),'body':deepcopy(body),'body_omitted':False}],
            'responsibilities':[{'assignment_id':'inactive','work_version':3,'lifecycle_sha256':'a'*64,'lifecycle_omitted':False,
                'lifecycle':{'state':'waiting_person','current_outcome':'Earlier outcome. '*200,
                             'next_action':{'kind':'await_event','description':'Ask for approval. '*100},
                             'wait':{'kind':'person','reason':'Review requested.'},'next_check_in_at':None}},
                {'assignment_id':'active','work_version':2,'lifecycle':{'state':'active','current_outcome':'Do not omit active work.'}}]}}
    return context


def build(context, **kw):
    return prepare_selection(context, instructions=CONTINUITY_POLICY, read_schema=CONTINUITY_DECISION_SCHEMA,
        metadata=RequestMetadata(request_id='run-current',attempt_id='attempt',step_id='selection'),
        policy='adaptive-local-v1', input_limit=50000, **kw)


def test_projection_deduplicates_only_identical_bodies_without_mutating_inputs():
    context=fixture_context(); before=deepcopy(context)
    projected=project_context(context)
    assert context==before
    assert projected['target_body']==context['target_body']
    reference=projected['dependencies'][0]['content']['body_reference']
    assert reference=={'path':'#/target_body/body','sha256':digest(context['target_body']['body'])}
    assert projected['work_area_context']['artifacts'][0]['body']['body_reference']==reference
    assert canonical(projected).count('HUMAN NOTE: keep all three checks.')==1
    assert projected['messages']==context['messages']
    different=fixture_context();different['dependencies'][0]['content']['blocks'][0]['text']='DIFFERENT human revision'
    assert project_context(different)['dependencies'][0]['content']==different['dependencies'][0]['content']


def test_inactive_summaries_are_explicit_and_full_details_are_scoped_retrievable():
    context=fixture_context(); before=deepcopy(context); projected=project_context(context)
    old=projected['work_area_context']['responsibilities'][0]
    assert old['lifecycle'] is None and old['lifecycle_omitted']
    assert old['lifecycle_summary']['state']=='waiting_person'
    assert old['lifecycle_summary']['truncated_fields']==['current_outcome','next_action.description']
    assert old['details']=={'kind':'read_context','section':'work_area'}
    assert projected['work_area_context']['responsibilities'][1]==context['work_area_context']['responsibilities'][1]
    actual=execute_read(ReadContext(kind='read_context',section='work_area'),context)
    assert actual['result']['value']==before['work_area_context']
    assert context==before
    other={'run_id':'system','messages':[{'run_id':'system','author_kind':'system'}], 'responsibility':{'assignment_id':'different'}}
    assert execute_read(ReadContext(kind='read_context',section='work_area'),other)['result']['value'] is None


def test_whole_request_budget_includes_schema_and_preserves_current_human():
    context=fixture_context(); current=deepcopy(context['messages'][-1])
    context['messages']=[{'id':f'old-{i}','run_id':f'old-{i}','sequence':i,'author_kind':'assistant','text':('Prior explanation and irrelevant details. '*500)} for i in range(24)]+[current]
    before=deepcopy(context)
    request=build(context)
    metrics=request_metrics(request)
    payload=json.loads(request.body); projected=json.loads(payload['input'][0]['content'])
    assert metrics['estimated_input_tokens']<=37000
    assert metrics['components']['tools']['estimated_tokens']>0
    assert metrics['components']['instructions']['estimated_tokens']>0
    assert projected['messages'][-1]==current
    assert projected['history_window']['omitted_messages']>0
    assert context==before
    assert request==build(context)


def test_required_human_input_is_never_cut_to_fit():
    context=fixture_context(); context['messages'][-1]['text']='必ずこの指示を保持してください。'*30000
    before=deepcopy(context)
    with pytest.raises(DomainError) as exc:build(context)
    assert exc.value.code.value=='budget_exhausted'
    assert context==before


def test_multistep_growth_keeps_receipts_goal_and_current_notes():
    from workagent.adaptive import continuation_context
    context=fixture_context(); observations=[]
    for index in range(8):
        observations.append({'phase':'selection' if index==0 else f'selection_{index+1}',
            'goal':'Preserve the requested outcome','success_criteria':[],
            'binding':{'operation_hash':str(index)*64},
            'capability_result':{'capability':'fetch_public_url','version':'1',
                'result':{'text':('Synthetic public evidence. '*150),'trust':'untrusted_external_content','status':'ok'}}})
        complete=continuation_context(context,observations,8)
        request=build(complete); projected=json.loads(json.loads(request.body)['input'][0]['content'])
        assert projected['adaptive']['observations']==observations
        assert projected['messages'][-1]['text']==context['messages'][-1]['text']
        assert request_metrics(request)['estimated_input_tokens']<=37000


def test_metrics_are_content_free_and_estimates_not_provider_counts():
    request=build(fixture_context()); metrics=request_metrics(request)
    assert 'HUMAN NOTE' not in json.dumps(metrics)
    assert 'Keep my exact' not in json.dumps(metrics)
    assert metrics['estimator']=='o200k_base_local_estimate'
    assert metrics['provider_count_authoritative'] is True
    assert metrics['request_sha256']==request.sha256
    assert metrics['components']['messages']['estimated_tokens']>0
    assert estimate('こんにちは <|endoftext|>')>0


def test_tokenizer_is_offline_and_missing_cache_is_conservative(monkeypatch,tmp_path):
    import workagent.request_packing as packing
    import socket
    monkeypatch.setattr(packing,'TOKENIZER_PATH',tmp_path/'absent-tokenizer')
    monkeypatch.setattr(socket,'socket',lambda *a,**kw:pytest.fail('Runtime must not fetch tokenizer data'))
    packing._encoder.cache_clear()
    try:
        text='こんにちは <|endoftext|>'
        assert packing.estimate(text)==len(text.encode('utf-8'))
    finally:
        packing._encoder.cache_clear()


def test_current_bound_responsibility_is_never_summarized():
    context=fixture_context();context['responsibility']={'assignment_id':'inactive'}
    projected=project_context(context)
    assert projected['work_area_context']['responsibilities'][0]==context['work_area_context']['responsibilities'][0]


def test_exact_previous_schema_fingerprints_are_retained():
    from hashlib import sha256
    from workagent.composition import LEGACY_DECISION_SCHEMA,LEGACY_CONTINUITY_DECISION_SCHEMA
    # Verified against pre-change composition at 7986f8f, not regenerated fixtures.
    assert sha256(LEGACY_DECISION_SCHEMA.material).hexdigest()=='b872b99e7c37497338f4e98fbe4c5eadd50488efe973436d935a30d97433a1c2'
    assert sha256(LEGACY_CONTINUITY_DECISION_SCHEMA.material).hexdigest()=='f39fde658ca6dd275c126987a12e5f7ca72dc578a8d9390e7b11eab401621079'
    for schema in (LEGACY_DECISION_SCHEMA,LEGACY_CONTINUITY_DECISION_SCHEMA):
        assert schema.model.model_json_schema()['$defs']['ReadContext']['properties']['section']['enum']==['messages','target','attachments']


def test_observation_growth_cannot_evict_required_human_or_tool_receipts():
    context=fixture_context()
    context['adaptive']={'observations':[{'capability_result':{'capability':'fetch_public_url','version':'1',
        'result':{'text':'Untrusted public text. '*50000,'trust':'untrusted_external_content'}}}]}
    before=deepcopy(context)
    with pytest.raises(DomainError):build(context)
    assert context==before


def test_final_budget_counts_complete_added_history_without_truncation():
    from dataclasses import replace
    from workagent.request_packing import check_final
    # Exercise the final guard on a valid prepared request whose complete input
    # now exceeds the ceiling. The transport separately enforces final history.
    request=build(fixture_context());payload=json.loads(request.body)
    context=json.loads(payload['input'][0]['content'])
    context['required_tool_result']='不可省略の観測。'*50000
    payload['input'][0]['content']=canonical(context)
    oversized=replace(request,body=canonical(payload).encode())
    original=oversized.body
    with pytest.raises(DomainError):check_final(oversized,input_limit=50000)
    assert oversized.body==original
