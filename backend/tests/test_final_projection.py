"""Exact final-request projection, not context truncation or live token proof."""
from copy import deepcopy
import json
from types import SimpleNamespace
import pytest
from test_domain import context
from test_conversations import post
from test_flexible_work import DraftProvider, publish, table
from test_general_responses import worker
from test_general_alpha_runtime import activate

from workagent.general_schema import GeneralDecision
from workagent.general_worker import final_tool_output
from workagent.service import canonical,digest


def selection(body):
    from pydantic import TypeAdapter
    from workagent.flexible_models import DraftBody
    body=TypeAdapter(DraftBody).validate_python(body).model_dump(mode='json')
    return SimpleNamespace(value=GeneralDecision.model_validate({
        'decision':{'kind':'publish_artifact','target':None,'body':body}}))


def stage(body):
    return {'status':'observed','body':body,'output':{'kind':'artifact_draft','goal_status':'needs_validation'},
            'verification':{'satisfied':False},'binding':{'operation_hash':'exact-binding'}}


def test_dedup_is_exact_and_does_not_mutate_the_stage():
    selected=selection({'title':'Draft','blocks':[{'block_id':'one','kind':'paragraph','text':'Evidence '*1000}]})
    body=selected.value.decision.body.model_dump(mode='json'); staged=stage(body); before=deepcopy(staged)
    projected=json.loads(final_tool_output(staged,selected))
    assert staged==before
    assert projected['body'] is None
    assert projected['body_reference']['sha256']==digest(body)
    assert projected['body_reference']['source']=='preceding_choose_general_action_arguments.decision.body'
    assert {k:v for k,v in projected.items() if k not in ('body','body_reference')}=={k:v for k,v in staged.items() if k!='body'}
    assert len(canonical(projected))<len(canonical(staged))//2


@pytest.mark.parametrize('change',['human_note','type','status','missing_selection','not_publish'])
def test_different_or_non_draft_material_is_never_deduplicated(change):
    selected=selection({'title':'Draft','blocks':[{'block_id':'one','kind':'paragraph','text':'Evidence'}]})
    staged=stage(selected.value.decision.body.model_dump(mode='json'))
    if change=='human_note':staged['body']['blocks'][0]['text']='Human note not present in selection'
    if change=='type':staged['body']['blocks'][0]['checked']='false'
    if change=='status':staged['status']='rejected'
    if change=='missing_selection':selected=SimpleNamespace(value=None)
    if change=='not_publish':selected=SimpleNamespace(value=GeneralDecision.model_validate({'decision':{'kind':'reply','text':'Only a reply'}}))
    assert json.loads(final_tool_output(staged,selected))==staged


def test_worker_final_keeps_complete_call_and_staged_evidence(context,tmp_path):
    s,p,ws,_,_=context; cv,_,_=publish(context,table()); activate(context,cv)
    body={'title':'Bounded draft','blocks':[{'block_id':'one','kind':'paragraph','text':'A reusable result.'}]}
    fake=DraftProvider(body,True); q=post(context,cv,'Produce the draft without claiming independent verification.')
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    with s.db.transaction() as c:
        attempt=c.execute('SELECT id FROM provider_attempts WHERE run_id=%s',(q.run.id,)).fetchone()['id']
        records={r['phase']:json.loads(r['request_bytes']) for r in c.execute('SELECT phase,request_bytes FROM responses_steps WHERE attempt_id=%s',(attempt,)).fetchall()}
        selected=c.execute("SELECT data FROM responses_events WHERE attempt_id=%s AND phase='selection' AND kind='result'",(attempt,)).fetchone()['data']
        staged=c.execute("SELECT data FROM responses_events WHERE attempt_id=%s AND phase='selection' AND kind='tool_result'",(attempt,)).fetchone()['data']
    final=records['final']; assert final['input'][0]==records['selection']['input'][0]
    assert final['input'][1:-1]==json.loads(selected['output_items'])
    projected=json.loads(final['input'][-1]['output'])
    assert projected['body'] is None and projected['body_reference']['sha256']==digest(staged['body'])
    assert staged['body']['blocks'][0]['text']=='A reusable result.'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[-1].state=='replied' and detail.turns[-1].adaptive.outcome=='needs_validation'
    assert not detail.turns[-1].adaptive.steps[-1].verification.satisfied
    # Artifact IDs are sorted identifiers, not creation order.
    published=next(r for r in detail.messages[-1].result.results if hasattr(r,'artifact_id'))
    assert s.get_artifact(p,ws,published.artifact_id).current_revision.body.title=='Bounded draft'
