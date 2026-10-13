"""Controlled HTTP transport through production GeneralWorker + restricted PostgreSQL.

These fixtures prove seams, not model intelligence, live usefulness or UX.
"""
import json
from hashlib import sha256
import httpx
import pytest
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_general_responses import Provider, worker, totals, attach, target
from test_general_products import CODE, wasmop
from test_runtime import expire
from workagent.models import ProviderGrant, GeneralAlphaResponsesBinding, new_id, CancelConversation, HumanSave
from workagent.composition import POLICY, DECISION_SCHEMA, AlphaDecision, discovery
from workagent.general_schema import EXPLANATION_SCHEMA
from workagent.general_responses import consumer_hash, AUTHORIZATION_HASH
from workagent.provider_attempts import configure_grant, revoke_grant
from workagent.db import Database
from workagent.general_worker import GeneralWorker, ControlledTransport
from workagent.skill_catalog import catalog


def activate(ctx, cv, **kw):
    s,p,ws,_,admin=ctx
    # Explicit synthetic fixture authority, not defaults for a live grant.
    caps=dict(kw)
    for name,value in dict(generation_limit=50,count_limit=50,read_limit=500,
                           input_limit=1000000,output_limit=409600,cost_limit_usd='20.00').items():
        caps.setdefault(name,value)
    return configure_grant(Database(admin),ProviderGrant(id=new_id(),workspace_id=ws,principal_id=p.id,
        profile='general-responses-v1',model='gpt-6.1-sol',consumer_sha256=consumer_hash(),expires_at=None,
        max_runs=10,max_received_output_tokens=16384,responses=GeneralAlphaResponsesBinding(
            runtime_extension='general-alpha-v1',project_id='proj_'+ws,
            secret_reference='file:/synthetic/not-a-key',transport_mode='synthetic',
            instructions_sha256=sha256(POLICY.encode()).hexdigest(),schema_sha256=sha256(EXPLANATION_SCHEMA.material).hexdigest(),
            scope_tool_sha256=sha256(DECISION_SCHEMA.material).hexdigest(),authorization_sha256=AUTHORIZATION_HASH,
            conversation_ids=[cv.id],**caps)))


class AlphaProvider(Provider):
    def __init__(self, decisions, *, explanation='The calculated result is 3750 cents: quantity times price.', lose_phase=None):
        super().__init__()
        self.decisions=decisions; self.contexts=[]; self.explanation=explanation; self.lose_phase=lose_phase

    def handle(self,request):
        if request.method=='GET' or request.url.path.endswith('input_tokens'):
            return super().handle(request)
        self.calls.append((request.method,request.url.path))
        data=json.loads(request.content); phase=data['metadata']['step_id']
        ctx=json.loads(data['input'][0]['content']); self.contexts.append(ctx)
        if phase=='final':
            output=[{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps({'text':self.explanation})}]}]
        else:
            index=0 if phase=='selection' else int(phase.rsplit('_',1)[1])-1
            d=self.decisions[index]
            d=d(ctx) if callable(d) else d
            value={'goal':'Respond usefully within current authority','success_criteria':[],'decision':d}
            output=[{'type':'function_call','name':'choose_general_action','call_id':'call_'+phase,'arguments':json.dumps(value)}]
        rid='resp_alpha_'+str(len(self.responses))
        result={'id':rid,'object':'response','model':'gpt-6.1-sol','service_tier':'default','metadata':data['metadata'],
            'status':'completed','error':None,'output':output,'usage':{'input_tokens':700,'output_tokens':200,'total_tokens':900,
                'input_tokens_details':{'cached_tokens':0},'output_tokens_details':{'reasoning_tokens':50}}}
        self.responses[rid]=result
        if phase==self.lose_phase: raise httpx.ReadError('controlled lost response')
        return httpx.Response(200,json=result)


def skill(ctx, index=0):
    offered=ctx['composition']['skills'][index]
    return {'kind':'load_skill',**{k:offered[k] for k in ('skill_id','version','sha256')}}


def calculate(ctx):
    message=next(m for m in ctx['messages'] if m['run_id']==ctx['run_id'] and m['author_kind']=='human')
    return {'kind':'run_wasm','target':message['target'],'code':CODE,'entrypoint':'total','arguments':[3,1250],
            'input_form':[{'name':'quantity','label':'Quantity'},{'name':'price','label':'Price cents'}]}


def launch(ctx,tmp_path,decisions,**kw):
    cv=conversation(ctx); g=activate(ctx,cv)
    q=post(ctx,cv,'Help me reason about this local work.')
    fake=AlphaProvider(decisions,**kw)
    return cv,g,q,fake,worker(ctx,fake,tmp_path)


def test_direct_answer_is_substantive_ready_not_goal_completion(context,tmp_path):
    s,p,ws,_,_=context
    text='A reversible decision can be tried cheaply; an irreversible one needs stronger evidence. Start with the smallest useful experiment.'
    cv,g,q,fake,w=launch(context,tmp_path,[{'kind':'reply','text':text}],explanation='A generic replacement must not erase the selected answer.')
    assert w.work(p,ws,q.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.messages[-1].text==text
    assert detail.turns[0].state=='replied' and detail.turns[0].adaptive.outcome=='answered'
    assert not detail.turns[0].adaptive.steps[0].verification.satisfied
    assert detail.turns[0].adaptive.steps[0].verification.requested_goal_status=='needs_validation'
    assert not detail.artifact_ids
    assert detail.turns[0].adaptive.steps[0].capability_result is None
    assert all(d['availability']=='unavailable' for d in fake.contexts[0]['composition']['capabilities'] if d['name'] in ('email','calendar','web','shell'))
    before=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==before
    from fastapi.testclient import TestClient
    from workagent.api import create_app, Settings
    with TestClient(create_app(Settings(s.db.dsn,True,'alpha-synthetic-token-not-live-1234567890',p.id))) as client:
        headers={'Authorization':'Bearer alpha-synthetic-token-not-live-1234567890','X-Schema-Version':'workagent/v1','X-Request-Id':'alpha-read'}
        response=client.get(f'/v1/workspaces/{ws}/conversations/{cv.id}',headers=headers)
        assert response.status_code==200
        dto=response.json()['turns'][0]
        assert dto['adaptive']['runtime_extension']=='general-alpha-v1'
        assert dto['adaptive']['outcome']=='answered'
        assert dto['explanation']['authority']=='model_explanation_not_verification'
        assert dto['explanation']['published'] is True


def test_discover_load_read_and_existing_wasm_compose(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[{'kind':'discover_capabilities'},skill,{'kind':'read_context','section':'messages'},calculate])
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id); turn=detail.turns[0]
    assert turn.adaptive.outcome=='needs_validation' and len(turn.adaptive.steps)==4
    loaded=turn.adaptive.steps[1].capability_result['result']
    assert {k:loaded[k] for k in ('skill_id','version','sha256')}=={k:catalog()[0][k] for k in ('skill_id','version','sha256')}
    assert loaded['guidance']['authority']=='guidance_only'
    assert turn.adaptive.steps[2].capability_result['result']['value'][0]['text']=='Help me reason about this local work.'
    assert turn.retained_local_result.output.value=='3750' and turn.retained_local_result.published
    assert detail.messages[-1].text.startswith(fake.explanation+'\n\nExecution status: ')
    assert 'needs validation' in detail.messages[-1].text
    assert totals(s,g)['request_counts']['dispatch']==5
    assert fake.contexts[2]['adaptive']['observations'][1]['capability_result']['result']['sha256']==loaded['sha256']
    assert not turn.adaptive.steps[-1].verification.satisfied


@pytest.mark.parametrize('fault',['after_tool_result','before_publication'])
def test_skill_restart_retains_exact_observation_without_reload(context,tmp_path,monkeypatch,fault):
    import workagent.skill_catalog as skills
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[skill,calculate])
    def crash(name):
        if name==fault: raise RuntimeError('controlled crash')
    w.phases.hook=crash
    with pytest.raises(RuntimeError): w.work(p,ws,q.run.id)
    before=s.get_conversation(p,ws,cv.id).turns[0].adaptive.steps[0].capability_result
    expire(context,q.run.id)
    monkeypatch.setattr(skills,'load',lambda *_: (_ for _ in ()).throw(AssertionError('retained skill must not reload')))
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[0].adaptive.steps[0].capability_result==before
    assert len(detail.messages)==2 and totals(s,g)['request_counts']['dispatch']==3


@pytest.mark.parametrize('change',['revoke','cancel','membership'])
def test_guidance_does_not_grant_continuation_authority(context,tmp_path,change):
    s,p,ws,_,admin=context
    cv,g,q,fake,w=launch(context,tmp_path,[skill,calculate])
    def alter(name):
        if name!='after_tool_result': return
        if change=='revoke': revoke_grant(Database(admin),g.id)
        elif change=='cancel': s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=q.conversation.work_version))
        else:
            with Database(admin).transaction() as c: c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    w.phases.hook=alter
    with pytest.raises(Exception): w.work(p,ws,q.run.id)
    assert totals(s,g)['request_counts']['dispatch']==1
    with Database(admin).transaction() as c:
        assert c.execute('SELECT count(*) n FROM artifacts WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
        assert c.execute("SELECT count(*) n FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='tool_result'",(q.run.id,)).fetchone()['n']==1


@pytest.mark.parametrize('field,value',[('sha256','0'*64),('version','unknown'),('skill_id','../../private')])
def test_unknown_or_changed_skill_denied_no_substitute(context,tmp_path,field,value):
    s,p,ws,_,_=context
    def invalid(ctx): return {**skill(ctx),field:value}
    cv,g,q,fake,w=launch(context,tmp_path,[invalid])
    if field=='skill_id':
        assert w.work(p,ws,q.run.id).state=='running'  # schema-rejected immutable receipt
    else:
        raises('unsupported_operation',lambda:w.work(p,ws,q.run.id))
    assert not s.get_conversation(p,ws,cv.id).artifact_ids
    assert len(s.get_conversation(p,ws,cv.id).messages)==1
    assert totals(s,g)['request_counts']['dispatch']==1


def test_stale_human_target_blocks_after_skill_before_operation(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); seed=post(context,cv,'Create',operation=wasmop())
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,seed.run.id)
    detail=s.get_conversation(p,ws,cv.id)
    artifact=next(s.get_artifact(p,ws,a) for a in detail.artifact_ids if s.get_artifact(p,ws,a).current_revision.body.kind=='tool')
    base=artifact.current_revision; activate(context,detail.conversation)
    q=post(context,detail.conversation,'Revise',target=target(artifact))
    fake=AlphaProvider([skill,calculate]); w=worker(context,fake,tmp_path)
    def edit(name):
        if name=='after_tool_result':
            s.human_save(p,ws,artifact.id,cmd(HumanSave,expected_current_revision_id=base.id,body=base.body.model_copy(update={'notes':['Human owns this edit.']})))
    w.phases.hook=edit
    raises('version_conflict',lambda:w.work(p,ws,q.run.id))
    assert len(fake.responses)==1 and not s.proposals(p,ws,artifact.id).items
    assert s.get_artifact(p,ws,artifact.id).current_revision.body.notes==['Human owns this edit.']


def test_unknown_provider_send_is_not_regenerated(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[skill,calculate],lose_phase='selection_2')
    assert w.work(p,ws,q.run.id).state=='running'
    before=list(fake.calls); expire(context,q.run.id)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='running'
    assert fake.calls==before
    assert s.get_conversation(p,ws,cv.id).turns[0].adaptive.steps[0].capability_result['capability']=='load_skill'


def test_exhausting_reads_is_limit_not_answer_or_completion(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[{'kind':'discover_capabilities'}]*4)
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[0].adaptive.outcome=='step_limit'
    assert 'no answer or operational completion' in detail.messages[-1].text
    assert not detail.artifact_ids


def test_second_method_composes_existing_publication_without_loop_branch(context,tmp_path):
    s,p,ws,_,_=context
    body={'title':'Decision brief','blocks':[{'block_id':'options','kind':'paragraph','text':'Try a reversible pilot before committing.','checked':None}]}
    def publish(ctx):
        return {'kind':'publish_artifact','target':None,'body':body}
    cv,g,q,fake,w=launch(context,tmp_path,[lambda ctx:skill(ctx,1),publish],explanation='A small pilot preserves the option to change direction. No decision has been taken for you.')
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[0].adaptive.steps[0].capability_result['result']['skill_id']=='decision-brief'
    assert detail.turns[0].adaptive.outcome=='needs_validation'
    assert detail.messages[-1].text.startswith(fake.explanation+'\n\nExecution status: ')
    assert detail.turns[0].explanation.text==fake.explanation
    assert detail.turns[0].explanation.authority=='model_explanation_not_verification'
    assert detail.turns[0].explanation.published
    assert any(s.get_artifact(p,ws,a).current_revision.body.title=='Decision brief' for a in detail.artifact_ids)


def test_no_skill_operation_remains_optional(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[calculate])
    assert w.work(p,ws,q.run.id).state=='partial'
    turn=s.get_conversation(p,ws,cv.id).turns[0]
    assert len(turn.adaptive.steps)==1 and turn.adaptive.steps[0].capability_result is None
    assert turn.retained_local_result.output.value=='3750'


def test_historical_explanation_projection_does_not_rewrite_receipts_or_messages(context,tmp_path):
    from test_adaptive_execution import setup
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,invented=True)
    assert w.work(p,ws,q.run.id).state=='partial'
    with s.db.transaction() as c:
        before=c.execute('SELECT data FROM conversation_messages WHERE workspace_id=%s ORDER BY sequence',(ws,)).fetchall()
        receipts=c.execute('SELECT e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s ORDER BY e.id',(ws,)).fetchall()
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[0].explanation.text=='Completed and independently verified.'
    assert detail.turns[0].explanation.authority=='model_explanation_not_verification'
    assert 'Completed and independently verified.' not in detail.messages[-1].text
    with s.db.transaction() as c:
        assert c.execute('SELECT data FROM conversation_messages WHERE workspace_id=%s ORDER BY sequence',(ws,)).fetchall()==before
        assert c.execute('SELECT e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s ORDER BY e.id',(ws,)).fetchall()==receipts


def test_catalog_source_pin_change_blocks_next_phase(context,tmp_path,monkeypatch):
    import workagent.general_responses as runtime
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[skill,calculate])
    def change(name):
        if name=='after_tool_result': monkeypatch.setattr(runtime,'consumer_hash',lambda:'f'*64)
    w.phases.hook=change
    raises('unsupported_operation',lambda:w.work(p,ws,q.run.id))
    assert totals(s,g)['request_counts']['dispatch']==1
    assert not s.get_conversation(p,ws,cv.id).artifact_ids


@pytest.mark.parametrize('mutation',['skill_hash','skill_authority','completion','answer'])
def test_sql_refuses_forged_guidance_evidence(context,tmp_path,monkeypatch,mutation):
    import copy
    import psycopg
    from workagent.responses_ledger import Ledger
    from workagent.service import encoded
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[skill,calculate])
    captured={}; original=Ledger.event
    def intercept(self,c,phase,kind,data):
        if kind=='tool_result':
            captured.update(attempt=self.receipt.attempt_id,phase=phase,data=copy.deepcopy(data))
            raise RuntimeError('controlled before retention')
        return original(self,c,phase,kind,data)
    monkeypatch.setattr(Ledger,'event',intercept)
    with pytest.raises(RuntimeError): w.work(p,ws,q.run.id)
    value=captured['data']
    if mutation=='skill_hash': value['capability_result']['result']['sha256']='f'*64
    elif mutation=='skill_authority': value['capability_result']['result']['guidance']['authority']='permissions'
    elif mutation=='completion': value['verification']['satisfied']=True
    else: value['terminal_outcome']='answered'
    with pytest.raises(psycopg.errors.RaiseException):
        with s.db.transaction() as c:
            c.execute('INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,%s,%s,%s)',
                (new_id(),captured['attempt'],captured['phase'],'tool_result',encoded(value)))
    assert not s.get_conversation(p,ws,cv.id).artifact_ids


def test_long_explanation_keeps_full_typed_readback_and_status(context,tmp_path):
    s,p,ws,_,_=context
    text='Useful explanation. '*600
    assert len(text)==12000
    cv,g,q,fake,w=launch(context,tmp_path,[calculate],explanation=text)
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.messages[-1].text)==10000
    assert 'Explanation shortened' in detail.messages[-1].text
    assert '\n\nExecution status: ' in detail.messages[-1].text
    assert detail.turns[0].explanation.text==text
    assert detail.turns[0].explanation.published


def test_descriptors_are_typed_and_missing_tools_cannot_be_selected():
    from pydantic import ValidationError
    for descriptor in discovery()['capabilities']:
        if descriptor['availability']=='available': assert descriptor['handler'] and descriptor['input_schema']
        else: assert descriptor['handler'] is None and descriptor['scope']=='none'
    with pytest.raises(ValidationError):
        AlphaDecision.model_validate({'goal':'External','success_criteria':[],'decision':{'kind':'shell','command':'echo no'}})
