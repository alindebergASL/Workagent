"""Real PostgreSQL + Wasmtime, synthetic HTTP. No paid/provider network calls."""
import copy
import json
import psycopg
import pytest
from test_domain import context,cmd,raises
from test_conversations import conversation,post
from test_adaptive_execution import activate,AdaptiveProvider
from test_general_responses import worker,totals,activate as activate_legacy
from test_acceptance_checks import SPEC
from test_runtime import expire
from workagent.models import PostMessage,new_id
from workagent.service import digest,encoded
from workagent.responses_ledger import Ledger


class RecordingProvider(AdaptiveProvider):
    def __init__(self,**kwargs):
        super().__init__(**kwargs); self.requests=[]

    def handle(self,request):
        if request.content: self.requests.append(request.content.decode())
        return super().handle(request)


def setup(ctx,tmp_path,*,checks=SPEC,**kwargs):
    cv=conversation(ctx); grant=activate(ctx,cv); fake=RecordingProvider(**kwargs)
    queued=post(ctx,cv,'Build a calculator multiplying quantity by price in cents.',acceptance_checks=checks)
    return cv,grant,fake,queued,worker(ctx,fake,tmp_path)


def test_independent_checks_override_passing_invented_model_test(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,invented=True)
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    steps=detail.turns[0].adaptive.steps
    assert len(steps)==2
    assert steps[0].verification.model_tests_passed
    assert not steps[0].verification.acceptance.passed and steps[0].outcome=='continue'
    assert not steps[1].verification.model_tests_passed
    assert steps[1].verification.acceptance.passed and steps[1].outcome=='needs_validation'
    assert all(not step.verification.satisfied for step in steps)
    assert len(detail.artifact_ids)==2 and detail.turns[0].retained_local_result.published
    assert 'supplied acceptance checks passed' in detail.messages[-1].text
    assert 'not marked complete' in detail.messages[-1].text
    assert totals(s,g)['request_counts']['dispatch']==3
    receipt=steps[1].verification.acceptance
    assert receipt.spec_sha256==digest(SPEC)
    assert receipt.checks[0].actual=='1358027'
    product=s.get_product_observation(p,ws,detail.messages[-1].result.results[1].observation_id)
    assert product.observation.body_hash==receipt.body_sha256
    payload='\n'.join(fake.requests)
    # Includes count bodies, both selection contexts and final function output.
    for secret in ('acceptance_checks','1358027','123457',receipt.spec_sha256):
        assert secret not in payload
    assert fake.contexts[1]['adaptive']['observations'][0]['verification']['acceptance']['failed_count']==1


def test_failed_human_checks_reach_limit_despite_model_tests_passing(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,invented=True,always_bad=True)
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[0].adaptive.outcome=='step_limit'
    assert len(detail.turns[0].adaptive.steps)==4 and not detail.artifact_ids
    assert all(step.verification.model_tests_passed and not step.verification.acceptance.passed
               for step in detail.turns[0].adaptive.steps)
    assert totals(s,g)['request_counts']['dispatch']==5


@pytest.mark.parametrize('fault',['after_tool_result','before_publication'])
def test_restart_reuses_independent_evidence_without_reexecution(context,tmp_path,monkeypatch,fault):
    import workagent.acceptance_checks as checks
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,first_good=True)
    calls=[]; evaluate=checks.evaluate
    def counted(*args):
        calls.append(True); return evaluate(*args)
    monkeypatch.setattr(checks,'evaluate',counted)
    def crash(name):
        if name==fault: raise RuntimeError('injected crash')
    w.phases.hook=crash
    with pytest.raises(RuntimeError,match='injected crash'): w.work(p,ws,q.run.id)
    expire(context,q.run.id)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert len(calls)==1 and totals(s,g)['request_counts']['dispatch']==2
    assert s.get_conversation(p,ws,cv.id).turns[0].adaptive.steps[0].verification.acceptance.passed


def test_followup_hides_historical_acceptance_cases(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,first_good=True)
    w.work(p,ws,q.run.id)
    detail=s.get_conversation(p,ws,cv.id)
    follow=post(context,detail.conversation,'Make another calculator.')
    w.work(p,ws,follow.run.id)
    assert '1358027' not in '\n'.join(fake.requests)
    assert 'acceptance_checks' not in '\n'.join(fake.requests)
    assert detail.messages[0].acceptance_checks.model_dump(mode='json')==SPEC


@pytest.mark.parametrize('profile',['controlled','legacy'])
def test_nonadaptive_admission_rejects_checks(context,profile):
    s,p,ws,_,_=context
    cv=conversation(context)
    if profile=='legacy': activate_legacy(context,[cv])
    raises('unsupported_operation',lambda:post(context,cv,acceptance_checks=SPEC))
    assert s.get_conversation(p,ws,cv.id).messages==[]


def test_command_replay_cannot_change_authoritative_checks(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,cv)
    request=cmd(PostMessage,expected_work_version=cv.work_version,text='Multiply.',acceptance_checks=SPEC)
    q=s.post_message(p,ws,cv.id,request)
    assert s.post_message(p,ws,cv.id,request.model_copy(update={'request_id':new_id()}))==q
    changed=request.model_dump(mode='json'); changed['acceptance_checks']['cases'][0]['expected']='7'
    raises('command_conflict',lambda:s.post_message(p,ws,cv.id,PostMessage.model_validate(changed)))


@pytest.mark.parametrize('mutation',['drop','spec','spec_hash','body_hash','operation_hash','request','empty','criterion','pass','complete'])
def test_sql_rejects_unbound_or_forged_acceptance_evidence(context,tmp_path,monkeypatch,mutation):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,invented=True)
    original=Ledger.event
    def altered(self,c,phase,kind,data):
        if kind=='tool_result':
            data=copy.deepcopy(data); evidence=data['verification']['acceptance']
            if mutation=='drop': data['verification'].pop('acceptance')
            elif mutation=='spec': evidence['spec']['cases'][0]['expected']='7'
            elif mutation=='spec_hash': evidence['spec_sha256']='0'*64
            elif mutation=='body_hash': evidence['body_sha256']='0'*64
            elif mutation=='operation_hash': evidence['operation_hash']='0'*64
            elif mutation=='request': data['verification']['request']['message_id']='forged'
            elif mutation=='empty': evidence['checks']=[]
            elif mutation=='criterion': evidence['checks'][0]['criterion']['expected']='7'
            elif mutation=='pass': evidence['passed']=True; evidence['checks'][0]['passed']=True
            elif mutation=='complete': data['terminal_outcome']='completed'; data['verification']['satisfied']=True
        return original(self,c,phase,kind,data)
    monkeypatch.setattr(Ledger,'event',altered)
    with pytest.raises(psycopg.errors.RaiseException,match='acceptance'):
        w.work(p,ws,q.run.id)
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='tool_result'",(q.run.id,)).fetchone()['n']==0
        assert c.execute('SELECT count(*) n FROM artifacts WHERE workspace_id=%s',(ws,)).fetchone()['n']==0


def test_sql_and_python_hash_agree_for_utf8_and_nested_material(context):
    s,*_=context
    material={'é':'line\nquote"','numbers':[-7,0,9223372036854775807],'a':{'中文':'❄','empty':[],'bool':False,'nil':None}}
    with s.db.transaction() as c:
        actual=c.execute("SELECT encode(sha256(convert_to(acceptance_canonical_json(%s),'UTF8')),'hex') AS hash",(encoded(material),)).fetchone()['hash']
    assert actual==digest(material)


def test_http_admission_and_authorized_readback_of_independent_checks(context,tmp_path):
    import secrets
    from fastapi.testclient import TestClient
    from workagent.api import Settings,create_app
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,cv)
    settings=Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id)
    headers={'Authorization':'Bearer '+settings.local_bearer,'X-Schema-Version':'workagent/v1','X-Request-Id':'acceptance'}
    path=f'/v1/workspaces/{ws}/conversations/{cv.id}'
    request=cmd(PostMessage,expected_work_version=cv.work_version,text='Multiply quantity by price.',acceptance_checks=SPEC).model_dump(mode='json')
    with TestClient(create_app(settings)) as client:
        assert client.post(path+'/messages',json=request).status_code==401
        invalid=copy.deepcopy(request); invalid['acceptance_checks']['cases']=[]
        assert client.post(path+'/messages',headers=headers,json=invalid).status_code==422
        response=client.post(path+'/messages',headers=headers,json=request)
        assert response.status_code==202
        assert response.json()['message']['acceptance_checks']==SPEC
        fake=RecordingProvider(first_good=True)
        worker(context,fake,tmp_path).work(p,ws,response.json()['run']['id'])
        detail=client.get(path,headers=headers)
        assert detail.status_code==200
        verification=detail.json()['turns'][0]['adaptive']['steps'][0]['verification']
        assert verification['acceptance']['passed'] and not verification['satisfied']
        assert verification['acceptance']['spec']==SPEC
        assert '1358027' not in '\n'.join(fake.requests)


def test_sql_input_validator_rejects_malformed_and_unbounded_specs(context):
    from pydantic import TypeAdapter,ValidationError
    from workagent.acceptance_checks import AcceptanceSpec
    s,*_=context
    invalid=[{},[],None,{**SPEC,'cases':[]},{**SPEC,'cases':SPEC['cases']*9},
        {**SPEC,'cases':[{'arguments':[True],'expected':'1'}]},
        {**SPEC,'cases':[{'arguments':[1.0],'expected':'1'}]},
        {**SPEC,'cases':[{'arguments':[1000000001],'expected':'1'}]},
        {**SPEC,'cases':[{'arguments':[],'expected':'9223372036854775808'}]},
        {**SPEC,'cases':[{'arguments':[],'expected':7}]},
        {**SPEC,'entrypoint':'bad-name'},{**SPEC,'authority':'model'},
        {'kind':'csv_totals','expected_sum':'3.00','mismatch_count':True},
        {'kind':'csv_totals','expected_sum':'3.00','mismatch_count':1.0},
        {'kind':'csv_totals','expected_sum':'3.00','mismatch_count':501},
        {'kind':'csv_totals','expected_sum':'NaN','mismatch_count':1}]
    with s.db.transaction() as c:
        for item in invalid:
            with pytest.raises(ValidationError): TypeAdapter(AcceptanceSpec).validate_python(item,strict=True)
            assert c.execute('SELECT valid_acceptance_spec(%s) ok',(encoded(item),)).fetchone()['ok'] is False
        assert c.execute('SELECT valid_acceptance_spec(%s) ok',(encoded(SPEC),)).fetchone()['ok'] is True


def test_csv_acceptance_uses_retained_source_totals_not_model_expectation(context,tmp_path):
    import httpx
    class CSVProvider(RecordingProvider):
        def handle(self,request):
            response=super().handle(request)
            if request.method=='GET' or request.url.path.endswith('input_tokens'): return response
            data=json.loads(request.content)
            if data['metadata']['step_id']=='final': return response
            result=response.json()
            context=self.contexts[-1]
            att=next(m for m in context['messages'] if m['run_id']==context['run_id'] and m['author_kind']=='human')['attachments'][0]
            value={'goal':'Reconcile immutable CSV','success_criteria':[{'kind':'csv_totals','expected_sum':'9.99','mismatch_count':0}],
                'decision':{'kind':'reconcile_csv','attachment':{'ref':att['ref'],'sha256':att['sha256']},'target':None,'rounding':'ROUND_HALF_UP'}}
            result['output'][0]['arguments']=json.dumps(value)
            self.responses[result['id']]=result
            return httpx.Response(200,json=result)
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,cv)
    checks={'kind':'csv_totals','expected_sum':'3.00','mismatch_count':1}
    q=post(context,cv,'Reconcile these invoice totals.',acceptance_checks=checks,
        attachments=[{'filename':'invoices.csv','mime_type':'text/csv','content':'id,quantity,unit_price,reported_total\na,2,1.50,2.00\n'}])
    fake=CSVProvider(); w=worker(context,fake,tmp_path)
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    result=detail.turns[0].adaptive.steps[0].verification
    assert result.acceptance.passed and not result.model_tests_passed
    assert result.acceptance.checks[0].actual=={'expected_sum':'3.00','mismatch_count':1}
    assert len(detail.artifact_ids)==2
    assert 'acceptance_checks' not in '\n'.join(fake.requests)


def test_independent_pass_cannot_publish_over_stale_human_edit(context,tmp_path):
    from test_general_products import wasmop
    from workagent.general_worker import GeneralWorker,ControlledTransport
    from workagent.models import HumanSave
    from workagent.message_models import ExactTarget
    s,p,ws,_,_=context
    cv=conversation(context); seed=post(context,cv,'Create',operation=wasmop())
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,seed.run.id)
    detail=s.get_conversation(p,ws,cv.id); cv=detail.conversation
    tool=next(s.get_artifact(p,ws,a) for a in detail.artifact_ids if s.get_artifact(p,ws,a).current_revision.body.kind=='tool')
    base=tool.current_revision; activate(context,cv)
    q=post(context,cv,'Revise calculator',acceptance_checks=SPEC,
        target=ExactTarget(artifact_id=tool.id,revision_id=base.id,body_hash=base.body_hash))
    fake=RecordingProvider(first_good=True); w=worker(context,fake,tmp_path)
    def crash(name):
        if name=='before_publication': raise RuntimeError('injected crash')
    w.phases.hook=crash
    with pytest.raises(RuntimeError,match='injected crash'): w.work(p,ws,q.run.id)
    assert s.get_conversation(p,ws,cv.id).turns[-1].adaptive.steps[0].verification.acceptance.passed
    saved=s.human_save(p,ws,tool.id,cmd(HumanSave,expected_current_revision_id=base.id,
        body=base.body.model_copy(update={'notes':['Keep my material correction.']})))
    before=list(fake.calls); expire(context,q.run.id)
    raises('version_conflict',lambda:worker(context,fake,tmp_path).work(p,ws,q.run.id))
    assert fake.calls==before and s.get_artifact(p,ws,tool.id).current_revision_id==saved.current_revision_id
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM product_observations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['n']==0
