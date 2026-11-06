"""Offline contract/projection compatibility. Not proof of live model quality."""
from copy import deepcopy
from dataclasses import replace
from hashlib import sha256
import importlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from workagent.adaptive import continuation_context, contract
from workagent.composition import CONTINUITY_POLICY, CONTINUITY_DECISION_SCHEMA, context_catalog
from workagent.flexible_models import Body
from workagent.flexible_schema import DraftDocument
from workagent.legacy_document_schema import previous_schema, restore_schema
from workagent.request_packing import project_context, project_observations, prepare_selection, request_metrics
from workagent.responses_transport import PreparedRequest, RequestMetadata, TransportError, build_tool_selection
from workagent.service import canonical, digest

FIXTURE=Path(__file__).with_name('fixtures')/'document_contract_v1.json'


def document():
    return {'title':'Workshop opening','blocks':[
        {'block_id':'heading','kind':'heading','text':'Opening preparations','checked':None},
        {'block_id':'chairs','kind':'checklist','text':'Alex arranges the chairs on Monday.','checked':False},
        {'block_id':'lights','kind':'checklist','text':'Sam checks the lights Tuesday.','checked':False},
        {'block_id':'handout','kind':'checklist','text':'I review the handout before printing.','checked':False},
        {'block_id':'note','kind':'protected_note','text':'Do not contact guests.','checked':None}]}


def test_mixed_document_keeps_exact_durable_format():
    body=document()
    draft=DraftDocument.model_validate(body,strict=True)
    assert draft.model_dump()==Body.model_validate(body,strict=True).model_dump()==body
    from workagent.artifact_exports import render
    raw,annotations,omissions=render(draft,'json')
    assert (raw,annotations,omissions)==render(Body.model_validate(body),'json')
    assert json.loads(raw)==body
    assert 'Opening preparations' in raw.decode() and 'Do not contact guests.' in raw.decode()
    assert annotations=='included' and not omissions
    value={'goal':'Prepare the workshop','success_criteria':[],
           'decision':{'kind':'publish_artifact','target':None,'body':body}}
    assert CONTINUITY_DECISION_SCHEMA.validate(canonical(value)).decision.body.model_dump()==body
    schema=json.loads(CONTINUITY_DECISION_SCHEMA.material)
    assert schema['$defs']['DraftDocument']['properties']['blocks']['items']=={'$ref':'#/$defs/DraftBlock'}
    assert set(schema['$defs']['DraftBlock']['required'])=={'block_id','kind','text','checked'}


@pytest.mark.parametrize('value',[None,'false',0,'missing'])
def test_task_state_is_explicit_boolean_without_coercion(value):
    body=document()
    if value=='missing':body['blocks'][1].pop('checked')
    else:body['blocks'][1]['checked']=value
    with pytest.raises(ValidationError):DraftDocument.model_validate(body,strict=True)


def test_nullable_historical_output_uses_its_own_decoder_not_the_new_contract():
    from workagent.legacy_document_schema import decode_retained
    body=document();body['blocks'][1]['checked']=None
    value={'goal':'Prepare the workshop','success_criteria':[],
           'decision':{'kind':'publish_artifact','target':None,'body':body}}
    old=previous_schema(CONTINUITY_DECISION_SCHEMA,nullable_checklist=True)
    request=build_tool_selection(instructions='Retained policy.',source_context='{}',read_schema=old,
        metadata=RequestMetadata(request_id='run',attempt_id='attempt',step_id='selection'),policy='adaptive-local-v1')
    class Connection:
        def execute(self,sql,args):
            assert args==('attempt','selection')
            return SimpleNamespace(fetchone=lambda:{'request_bytes':request.body})
    restored=decode_retained(Connection(),'attempt','selection',CONTINUITY_DECISION_SCHEMA.model,value)
    assert restored.decision.body.model_dump()==body
    assert request.count_body()
    with pytest.raises(TransportError):CONTINUITY_DECISION_SCHEMA.validate(canonical(value))


def test_exact_captured_request_and_count_bytes_restore_with_matching_decoder():
    fixture=json.loads(FIXTURE.read_text());payload=json.loads(fixture['request_bytes'])
    schema=restore_schema(payload['tools'][0]['parameters'],CONTINUITY_DECISION_SCHEMA)
    assert schema==previous_schema(CONTINUITY_DECISION_SCHEMA)
    assert schema is previous_schema(CONTINUITY_DECISION_SCHEMA,nullable_checklist=False)
    request=PreparedRequest(fixture['request_bytes'].encode(),RequestMetadata.model_validate(payload['metadata']),
        'selection',schema,'adaptive-local-v1')
    assert request.sha256==fixture['request_sha256']
    assert request.count_body()==fixture['count_bytes'].encode()
    assert sha256(request.count_body()).hexdigest()==fixture['count_sha256']
    with pytest.raises(TransportError):replace(request,schema=CONTINUITY_DECISION_SCHEMA).count_body()
    damaged=deepcopy(payload['tools'][0]['parameters']);damaged['additionalProperties']=True
    with pytest.raises(TransportError):restore_schema(damaged,CONTINUITY_DECISION_SCHEMA)


def test_all_predecessor_exports_and_capability_bindings_stay_exact():
    fixture=json.loads(FIXTURE.read_text())
    for key,checksum in fixture['schema_hashes'].items():
        name,attribute=key.split(':')
        module=importlib.import_module('workagent.'+name)
        schema=getattr(module,attribute)
        predecessor=previous_schema(schema)
        assert sha256(predecessor.material).hexdigest()==checksum,key
        # Real old hashes select the same capability variant, not a new profile.
        if attribute=='SCHEMA':
            binding=SimpleNamespace(runtime_extension='general-alpha-v1',continuity_version='sustained-v1',
                scope_tool_sha256=checksum,policy_version='adaptive-local-v1')
            assert contract(binding)[1]==schema,key
        policy='general-responses-v1' if name=='general_schema' else 'adaptive-local-v1'
        request=build_tool_selection(instructions='Retained synthetic contract.',source_context='{}',
            read_schema=predecessor,metadata=RequestMetadata(request_id='run',attempt_id='attempt',step_id='selection'),policy=policy)
        assert request.count_body()


def fixture_context():
    body=document();target={'artifact_id':'workshop','revision_id':'revision-a','body_hash':digest(body)}
    observations=[]
    for i in range(3):
        observations.append({'phase':'selection' if i==0 else f'selection_{i+1}',
            'goal':'Prepare the workshop','success_criteria':[],
            'status':'observed','terminal_outcome':'continue','reason':'Shape checked, not independently verified.',
            'body':deepcopy(body),'decision':{'kind':'publish_artifact','target':deepcopy(target),'body':deepcopy(body)},
            'binding':{'operation_hash':str(i)*64,'target':deepcopy(target),'source_hash':'b'*64},
            'verification':{'satisfied':False,'requested_goal_status':'needs_validation','checks':[]}})
    observations.append({'phase':'selection_4','status':'unknown','terminal_outcome':'blocked',
        'capability_result':{'capability':'fetch_public_url','version':'1','result':{
            'final_url':'https://example.org/workshop','fetched_at':'2026-01-01T00:00:00Z',
            'status':'error','error':'retrieval_timeout','text':'','truncated':False}},
        'diagnostic':{'code':'unknown_effect','detail':'Do not retry an uncertain effect.'}})
    return continuation_context({'run_id':'run','messages':[
        {'author_kind':'human','run_id':'older','text':'Preserve the original workshop constraints.'},
        {'author_kind':'human','run_id':'run','text':'Prepare all tasks and preserve this note exactly: Do not contact guests.'}],
        'target_body':{'body':body,**target},'composition':context_catalog(continuity=True),
        'work_area_context':{'artifacts':[{'body':deepcopy(body),**target}]},
        'sources':[{'id':'authorized-source','content':'Keep the source intact.'}]},observations,8)


def resolve_body(context,body):
    if 'body_reference' not in body:return body
    ref=body['body_reference'];value=context
    for segment in ref['path'][2:].split('/'):
        value=value[int(segment)] if isinstance(value,list) else value[segment]
    assert 'body_reference' not in value
    assert digest(value)==ref['sha256']
    return value


def test_projection_preserves_work_authority_errors_and_reconstructs_both_versions():
    context=fixture_context();before=deepcopy(context)
    old=project_context(context);new=project_context(context,version='compact-input-v2')
    assert context==before
    assert new['messages']==context['messages'] and new['sources']==context['sources']
    assert new['adaptive']['goal']=='Prepare the workshop' and new['adaptive']['success_criteria']==[]
    assert new['composition']['capabilities']==[{k:v for k,v in item.items() if k!='handler'}
                                               for item in old['composition']['capabilities']]
    for index,original in enumerate(context['adaptive']['observations']):
        observed=new['adaptive']['observations'][index]
        for key in ('binding','verification','status','terminal_outcome','reason','capability_result','diagnostic'):
            if key in original:assert observed[key]==original[key]
        if 'body' in original:
            assert resolve_body(new,observed['body'])==original['body']
            assert resolve_body(new,observed['decision']['body'])==original['decision']['body']
            assert observed['decision']['target']==original['decision']['target']
    for projected in (old,new):
        reconstructed=continuation_context(deepcopy(projected),context['adaptive']['observations'],8)
        project_observations(reconstructed,projected['input_projection']['version'])
        assert reconstructed['adaptive']==projected['adaptive']
    assert len(canonical(new))<len(canonical(old))
    with pytest.raises(Exception):project_observations(deepcopy(context),'unrecognized-projection')


def test_fresh_request_reduces_whole_input_without_removing_human_history():
    old_fixture=json.loads(FIXTURE.read_text());old_payload=json.loads(old_fixture['request_bytes'])
    context=fixture_context();metadata=RequestMetadata(request_id='run',attempt_id='attempt',step_id='selection_5')
    old=build_tool_selection(instructions=old_payload['instructions'],source_context=canonical(project_context(context)),
        read_schema=previous_schema(CONTINUITY_DECISION_SCHEMA),metadata=metadata,phase='selection_5',policy='adaptive-local-v1')
    new=prepare_selection(context,instructions=CONTINUITY_POLICY,read_schema=CONTINUITY_DECISION_SCHEMA,
        metadata=metadata,phase='selection_5',policy='adaptive-local-v1')
    old_metrics=request_metrics(old);new_metrics=request_metrics(new)
    assert new_metrics['input_utf8_bytes']<old_metrics['input_utf8_bytes']
    assert new_metrics['estimated_input_tokens']<old_metrics['estimated_input_tokens']
    # Deliberately below the complete-input estimate: no human history deletion.
    tight=prepare_selection(context,instructions=CONTINUITY_POLICY,read_schema=CONTINUITY_DECISION_SCHEMA,
        metadata=metadata,phase='selection_5',policy='adaptive-local-v1',input_limit=100)
    assert json.loads(json.loads(tight.body)['input'][0]['content'])['messages']==context['messages']
    print('synthetic whole-request old/new bytes:',old_metrics['input_utf8_bytes'],new_metrics['input_utf8_bytes'],
          'estimated tokens:',old_metrics['estimated_input_tokens'],new_metrics['estimated_input_tokens'])


@pytest.mark.parametrize('version',['compact-input-v1','compact-input-v2'])
@pytest.mark.parametrize('damage',[None,'goal','criteria','binding','unknown_version'])
def test_actual_worker_cursor_revalidates_versioned_projection(monkeypatch,version,damage):
    from test_durable_boundary_resume import chain
    from workagent.errors import DomainError
    fixture=chain(monkeypatch)
    expected=CONTINUITY_DECISION_SCHEMA
    schema=previous_schema(expected) if version=='compact-input-v1' else expected
    for index,row in enumerate(fixture.rows):
        original=json.loads(row['request_bytes'])
        source=json.loads(original['input'][0]['content'])
        projected=project_context(source,version=version)
        if index==1:
            if damage=='goal':
                fixture.observations[0]['goal']='A different goal'
            elif damage=='criteria':
                fixture.observations[0]['success_criteria']=[]
            elif damage=='binding':
                fixture.observations[0]['binding']={'operation_hash':'forged'}
            elif damage=='unknown_version':
                projected['input_projection']['version']='compact-input-unknown'
        request=build_tool_selection(instructions=CONTINUITY_POLICY,source_context=canonical(projected),
            read_schema=schema,metadata=RequestMetadata.model_validate(row['metadata']),
            phase=row['phase'],policy='adaptive-local-v1')
        row.update(request_bytes=request.body.decode(),request_sha256=request.sha256,
            count_bytes=request.count_body().decode(),count_sha256=sha256(request.count_body()).hexdigest())
        events=fixture.events[row['phase']]
        for name in ('count_result','identity','result'):
            events[name]['request_sha256']=request.sha256
        events['count_result']['count_sha256']=row['count_sha256']
    before=deepcopy((fixture.rows,fixture.events))
    def recover():
        return fixture.w._prepared_selection(fixture.ledger,fixture.cap,fixture.config,expected,resume_settled=True)
    if damage:
        with pytest.raises(DomainError):recover()
    else:
        request,index,settled=recover()
        assert index==2 and settled is not None
        assert request.body==fixture.rows[1]['request_bytes'].encode()
        assert request.schema==schema
    assert (fixture.rows,fixture.events)==before

