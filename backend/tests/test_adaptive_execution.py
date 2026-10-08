"""Actual PostgreSQL + Wasmtime, synthetic HTTP only; no paid calls."""
import json
from hashlib import sha256
import httpx
import pytest
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_general_responses import worker, totals, Provider
from test_general_products import CODE
from test_runtime import expire
from workagent.models import ProviderGrant, AdaptiveResponsesBinding, new_id, CancelConversation
from workagent.general_responses import consumer_hash, AUTHORIZATION_HASH
from workagent.adaptive import POLICY, DECISION_SCHEMA
from workagent.general_schema import EXPLANATION_SCHEMA
from workagent.provider_attempts import configure_grant, revoke_grant
from workagent.db import Database


def activate(ctx, cv, **kw):
    s,p,ws,_,admin=ctx
    return configure_grant(Database(admin),ProviderGrant(id=new_id(),workspace_id=ws,principal_id=p.id,
        profile='general-responses-v1',model='gpt-6.1-sol',consumer_sha256=consumer_hash(),expires_at=None,
        max_runs=10,max_received_output_tokens=16384,responses=AdaptiveResponsesBinding(
            project_id=kw.pop('project_id','proj_'+ws),secret_reference='file:/synthetic/not-a-key',transport_mode='synthetic',
            instructions_sha256=sha256(POLICY.encode()).hexdigest(),schema_sha256=sha256(EXPLANATION_SCHEMA.material).hexdigest(),
            scope_tool_sha256=sha256(DECISION_SCHEMA.material).hexdigest(),authorization_sha256=AUTHORIZATION_HASH,
            conversation_ids=[cv.id],**kw)))


class AdaptiveProvider(Provider):
    def __init__(self, *, always_bad=False, wait=False, lie=False, wrong_first=False, invented=False, first_good=False, lose_phase=None):
        super().__init__(); self.contexts=[]; self.always_bad=always_bad; self.wait=wait; self.lie=lie
        self.wrong_first=wrong_first; self.invented=invented; self.first_good=first_good; self.lose_phase=lose_phase

    def handle(self, request):
        if request.method=='GET' or request.url.path.endswith('input_tokens'):
            return super().handle(request)
        self.calls.append((request.method,request.url.path))
        data=json.loads(request.content); ctx=json.loads(data['input'][0]['content']); self.contexts.append(ctx)
        if data['metadata']['step_id']=='final':
            text='Completed and independently verified.' if self.invented or self.lie else 'Retained local verification; no external action.'
            output=[{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps({'text':text})}]}]
        else:
            observations=ctx.get('adaptive',{}).get('observations',[])
            repaired=(bool(observations) or self.first_good) and not self.always_bad
            if observations:
                assert observations[-1]['status'] in ('rejected','observed')
                assert observations[-1]['verification']['satisfied'] is False
            initial='(module (func (export "total") (param i64 i64) (result i64) i64.const 7))' if self.wrong_first or self.invented else '(module (func (export "total") (param i64 i64) (result i64) unreachable))'
            message=next(m for m in ctx['messages'] if m['run_id']==ctx['run_id'] and m['author_kind']=='human')
            decision={'kind':'run_wasm','target':message.get('target'),'code':CODE if repaired else initial,
                'entrypoint':'total','arguments':[3,1250],
                'input_form':[{'name':'quantity','label':'Quantity'},{'name':'price','label':'Price cents'}]}
            if self.wait: decision={'kind':'stop','outcome':'waiting_for_user','text':'Need a price.'}
            if self.lie: decision={'kind':'stop','outcome':'complete','text':'I succeeded.'}
            value={'goal':'Build and verify integer invoice total','success_criteria':[{'kind':'wasm_return','arguments':[3,1250],'expected':'7' if self.invented else '3750'}], 'decision':decision}
            output=[{'type':'function_call','name':'choose_general_action','call_id':'call_'+data['metadata']['step_id'],'arguments':json.dumps(value)}]
        rid='resp_adaptive_'+str(len(self.responses))
        result={'id':rid,'object':'response','model':'gpt-6.1-sol','service_tier':'default','metadata':data['metadata'],
            'status':'completed','error':None,'output':output,'usage':{'input_tokens':700,'output_tokens':200,'total_tokens':900,
                'input_tokens_details':{'cached_tokens':0},'output_tokens_details':{'reasoning_tokens':50}}}
        self.responses[rid]=result
        if self.lose_phase==data['metadata']['step_id']:
            raise OSError('lost provider response after send')
        return httpx.Response(200,json=result)


def setup(ctx,tmp_path,**kwargs):
    cv=conversation(ctx); grant=activate(ctx,cv); fake=AdaptiveProvider(**kwargs)
    q=post(ctx,cv,'Build an invoice-total calculator. Test quantity 3 at price 1250 cents = 3750.')
    return cv,grant,fake,q,worker(ctx,fake,tmp_path)


def test_obstacle_real_failure_repair_verification_one_human_turn(context,tmp_path,monkeypatch):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path)
    calls=[]; original=s._calculate_product
    def calculate(operation,base):
        calls.append(operation.code)
        return original(operation,base)
    monkeypatch.setattr(s,'_calculate_product',calculate)
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    adaptive=detail.turns[0].adaptive
    assert adaptive.goal=='Build and verify integer invoice total'
    assert adaptive.outcome=='needs_validation' and len(adaptive.steps)==2
    assert adaptive.steps[0].status=='rejected' and not adaptive.steps[0].verification.satisfied
    assert adaptive.steps[1].status=='observed' and not adaptive.steps[1].verification.satisfied
    assert adaptive.steps[1].verification.model_tests_passed
    assert detail.turns[0].retained_local_result.published
    assert 'independent validation' in detail.messages[-1].text
    assert len(calls)==2 and calls[0]!=calls[1]
    assert fake.contexts[1]['adaptive']['observations'][0]['status']=='rejected'
    assert len(detail.messages)==2 and len(detail.artifact_ids)==2
    obs=s.get_product_observation(p,ws,detail.messages[-1].result.results[1].observation_id)
    assert obs.observation.output.value==3750
    assert totals(s,g)['request_counts']['dispatch']==3
    before=len(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert len(fake.calls)==before


@pytest.mark.parametrize('fault',['after_tool_result','before_publication'])
def test_restart_retains_obstacle_and_correction(context,tmp_path,monkeypatch,fault):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path)
    def crash(name):
        if name==fault: raise RuntimeError('crash')
    w.phases.hook=crash
    with pytest.raises(RuntimeError): w.work(p,ws,q.run.id)
    expire(context,q.run.id)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert totals(s,g)['request_counts']['dispatch']==3
    assert len(s.get_conversation(p,ws,cv.id).messages)==2


@pytest.mark.parametrize('mode,expected,steps',[('always_bad','step_limit',4),('wait','waiting_for_user',1),('lie','blocked',1)])
def test_honest_limits_wait_and_unsupported_success(context,tmp_path,mode,expected,steps):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,**{mode:True})
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[0].adaptive.outcome==expected
    assert len(detail.turns[0].adaptive.steps)==steps
    assert not detail.artifact_ids
    assert totals(s,g)['request_counts']['dispatch']==steps+1


@pytest.mark.parametrize('change',['revoke','cancel','membership'])
def test_continuation_checks_authority_before_io(context,tmp_path,change):
    s,p,ws,_,admin=context
    cv,g,fake,q,w=setup(context,tmp_path)
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
