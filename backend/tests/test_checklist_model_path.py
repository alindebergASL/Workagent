"""Model-facing contract and synthetic execution, not live-model quality proof."""
import copy
import json
from dataclasses import replace

import pytest
from test_domain import context
from test_conversations import conversation, post
from test_sustained_continuity import activate
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.composition import CONTINUITY_POLICY, CONTINUITY_DECISION_SCHEMA
from workagent.responses_transport import (
    RequestMetadata, TransportError, build_tool_selection,
    _LEGACY_GENERAL_TOOL_DESCRIPTION,
)
from workagent.service import canonical


def request():
    return build_tool_selection(instructions=CONTINUITY_POLICY, source_context='{}',
        read_schema=CONTINUITY_DECISION_SCHEMA,
        metadata=RequestMetadata(request_id='synthetic', attempt_id='synthetic', step_id='selection'),
        policy='adaptive-local-v1')


def assert_outbound_contract(payload):
    policy=payload['instructions']
    assert 'no body-level kind' in policy
    assert 'Every block requires block_id, kind, text and checked' in policy
    assert 'each task is kind=checklist with checked=false' in policy
    assert 'body is a complete document, not an append operation or a one-block patch' in policy
    assert 'choose reply to finish the turn' in policy
    assert 'revised products are proposals requiring explicit acceptance' not in policy
    assert 'Saved changes remain proposals until human acceptance' not in policy
    assert 'publish a complete editable artifact' in payload['tools'][0]['description']
    definitions=payload['tools'][0]['parameters']['$defs']
    branches=definitions['DraftDocument']['properties']['blocks']['items']['anyOf']
    assert {b['$ref'] for b in branches}=={'#/$defs/DraftTextBlock','#/$defs/DraftChecklistBlock'}
    assert definitions['DraftChecklistBlock']['properties']['kind']['const']=='checklist'
    assert definitions['DraftChecklistBlock']['properties']['checked']['type']=='boolean'
    assert definitions['DraftTextBlock']['properties']['checked']['type']=='null'


def test_outbound_schema_and_effective_policy_agree():
    assert_outbound_contract(json.loads(request().body))


def test_retained_legacy_description_keeps_exact_request_and_count_bytes():
    original=request()
    payload=json.loads(original.body)
    payload['tools'][0]['description']=_LEGACY_GENERAL_TOOL_DESCRIPTION
    material=canonical(payload).encode()
    retained=replace(original, body=material)
    before=retained.sha256
    count=retained.count_body()
    assert retained.body==material and retained.sha256==before
    assert json.loads(count)['tools']==payload['tools']
    assert CONTINUITY_DECISION_SCHEMA.material==canonical(payload['tools'][0]['parameters']).encode()


@pytest.mark.parametrize('change',['description','schema','strict'])
def test_legacy_description_does_not_allow_other_contract_changes(change):
    original=request()
    payload=json.loads(original.body)
    tool=payload['tools'][0]
    tool['description']=_LEGACY_GENERAL_TOOL_DESCRIPTION
    if change=='description': tool['description']='Unrecognized tool contract'
    elif change=='schema': tool['parameters']['$defs']['DraftChecklistBlock']['properties']['checked']['type']='null'
    else: tool['strict']=False
    with pytest.raises(TransportError):
        replace(original,body=canonical(payload).encode()).count_body()


def test_complete_checklist_then_reply_settles_once_without_validation_loop(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,cv,max_steps=8)
    q=post(context,cv,'Save an editable opening checklist: Alex sets out the chairs on Monday; '
        'Sam checks the lights Tuesday; I review the handout. Separate note: Do not contact guests. '
        'Keep it private; do not send anything.')
    body={'title':'Opening checklist','blocks':[
        {'block_id':'chairs','kind':'checklist','text':'Alex sets out the chairs on Monday.','checked':False},
        {'block_id':'lights','kind':'checklist','text':'Sam checks the lights Tuesday.','checked':False},
        {'block_id':'handout','kind':'checklist','text':'I review the handout.','checked':False},
        {'block_id':'constraint','kind':'protected_note','text':'Do not contact guests.','checked':None}]}
    payloads=[]
    class CapturingProvider(AlphaProvider):
        def handle(self,request):
            if request.method=='POST' and request.url.path.endswith('/responses'):
                payloads.append(json.loads(request.content))
            return super().handle(request)
    def finish(ctx):
        observation=ctx['adaptive']['observations'][0]
        assert observation['status']=='observed'
        assert observation['terminal_outcome']=='continue'
        assert observation['verification']['satisfied'] is False
        assert observation['verification']['requested_goal_status']=='needs_validation'
        assert 'choose reply to finish' in observation['reason']
        assert 'Changes to existing work require human acceptance.' not in observation['reason']
        return {'kind':'reply','text':'Saved the editable checklist and separate restriction. Nothing was sent.'}
    fake=CapturingProvider([{'kind':'publish_artifact','target':None,'body':copy.deepcopy(body)},finish])
    w=worker(context,fake,tmp_path)
    assert finish_safe_visits(context,w,q.run.id).state=='ready'
    assert [x['metadata']['step_id'] for x in payloads]==['selection','selection_2','final']
    assert_outbound_contract(payloads[0])
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.artifact_ids)==1
    artifact=s.get_artifact(p,ws,detail.artifact_ids[0])
    assert artifact.current_revision.body.model_dump(mode='json')==body
    assert artifact.current_revision.author_kind=='worker'
    assert not s.proposals(p,ws,artifact.id).items
    assert [x.outcome for x in detail.turns[-1].adaptive.steps]==['continue','answered']
    assert all(not x.verification.satisfied for x in detail.turns[-1].adaptive.steps)
    calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==calls
    assert s.get_artifact(p,ws,artifact.id).current_revision_id==artifact.current_revision_id
