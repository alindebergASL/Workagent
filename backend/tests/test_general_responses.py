"""Synthetic HTTP, actual GeneralWorker/Products and real restricted PostgreSQL.

No credentials/network or claims about actual model usefulness.
"""
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path
import httpx
import pytest
from test_domain import context,cmd,raises
from test_conversations import conversation,post
from test_general_products import CSV,CODE,SHIPPING
from test_runtime import expire
from workagent.models import *
from workagent.service import Service,encoded
from workagent.db import Database
from workagent.provider_attempts import configure_grant,revoke_grant,ReceiptCapability
from workagent.general_worker import GeneralWorker
from workagent.general_responses import PROFILE,POLICY,AUTHORIZATION_HASH,consumer_hash
from workagent.general_schema import DECISION_SCHEMA,EXPLANATION_SCHEMA
from workagent.responses_transport import ResponsesTransport
from workagent.responses_ledger import summary


def activate(ctx,cvs,*,max_runs=4):
    s,p,ws,_,admin=ctx
    return configure_grant(Database(admin),ProviderGrant(id=new_id(),workspace_id=ws,principal_id=p.id,
        profile=PROFILE,model='gpt-6.1-sol',consumer_sha256=consumer_hash(),expires_at=None,
        max_runs=max_runs,max_received_output_tokens=16384,responses=GeneralResponsesBinding(
            project_id='proj_'+ws,secret_reference='file:/synthetic/not-a-key',transport_mode='synthetic',
            instructions_sha256=sha256(POLICY.encode()).hexdigest(),schema_sha256=sha256(EXPLANATION_SCHEMA.material).hexdigest(),
            scope_tool_sha256=sha256(DECISION_SCHEMA.material).hexdigest(),authorization_sha256=AUTHORIZATION_HASH,
            conversation_ids=[cv.id for cv in cvs])))

class Provider:
    """Test-only HTTP fixture; never interprets arbitrary real user input."""
    def __init__(self,*,lose_id=False,bad=None):
        self.calls=[]; self.responses={}; self.lose_id=lose_id; self.bad=bad

    def transport(self):
        return ResponsesTransport.synthetic(httpx.MockTransport(self.handle))

    def handle(self,request):
        self.calls.append((request.method,request.url.path))
        if request.method=='GET': return httpx.Response(200,json=self.responses[request.url.path.rsplit('/',1)[1]])
        data=json.loads(request.content)
        if request.url.path.endswith('input_tokens'):
            return httpx.Response(200,json={'object':'response.input_tokens','input_tokens':700})
        context=json.loads(data['input'][0]['content'])
        message=[m for m in context['messages'] if m['author_kind']=='human'][-1]
        final=data['metadata']['step_id']=='final'
        if final:
            value={'text':'Local calculation observed. Review the saved product or pending proposal; human notes preserved. No external action was performed.'}
            if self.bad=='final_extra': value['approved']=True
            output=[{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps(value)}]}]
        else:
            if 'calculator' in message['text'] or 'shipping' in message['text']:
                shipping='shipping' in message['text']
                decision={'kind':'run_wasm','target':message['target'],'code':SHIPPING if shipping else CODE,
                    'entrypoint':'total','arguments':[3,1250,500] if shipping else [3,1250],
                    'input_form':[{'name':'quantity','label':'Quantity'},{'name':'price','label':'Price cents'}]+([{'name':'shipping','label':'Shipping cents'}] if shipping else [])}
            elif 'CSV' in message['text'] or message['target']:
                att=message['attachments'][0] if message['attachments'] else None
                decision={'kind':'reconcile_csv','attachment':{'ref':att['ref'],'sha256':att['sha256']} if att else None,
                    'target':message['target'],'rounding':'ROUND_HALF_EVEN' if message['target'] else 'ROUND_HALF_UP'}
                if self.bad=='ref': decision['attachment']['ref']='forged-ref'
                if self.bad=='hash': decision['attachment']['sha256']='0'*64
            else: decision={'kind':'reply','text':'How can I help?'}
            value={'decision':decision}
            if self.bad=='extra': value['observation']={'observed':True}
            if self.bad=='bool_arg': decision['arguments'][0]=True
            output=[{'type':'function_call','name':'choose_general_action','call_id':'call_general',
                     'arguments':json.dumps(value)}]
        rid='resp_general_'+str(len(self.responses))
        response={'id':rid,'object':'response','model':'gpt-6.1-sol','service_tier':'default',
                  'metadata':data['metadata'],'status':'completed','error':None,'output':output,
                  'usage':{'input_tokens':700,'output_tokens':200,'total_tokens':900,
                           'input_tokens_details':{'cached_tokens':0},'output_tokens_details':{'reasoning_tokens':50}}}
        self.responses[rid]=response
        if self.lose_id: raise httpx.ReadError('synthetic lost response')
        return httpx.Response(200,json=response)


def worker(ctx,fake,tmp_path,**kwargs):
    return GeneralWorker(ctx[0],transport=fake.transport(),state=tmp_path/'state',enable_responses=True,**kwargs)


def totals(s,g):
    with s.db.transaction() as c: return summary(c,g.id)


def attach(): return AttachmentInput(filename='invoices.csv',mime_type='text/csv',content=CSV)

def target(art):
    return ExactTarget(artifact_id=art.id,revision_id=art.current_revision_id,body_hash=art.current_revision.body_hash)


def test_four_natural_language_turns_actual_worker_csv_generated_wat(context,tmp_path):
    s,p,ws,_,_=context
    csvcv=conversation(context); wasmcv=conversation(context)
    grant=activate(context,[csvcv,wasmcv]); fake=Provider(); w=worker(context,fake,tmp_path)
    first=post(context,csvcv,'Reconcile this CSV, preserve values and notes and make it downloadable.',attachments=[attach()])
    assert first.message.operation is None and first.run.profile==PROFILE
    assert w.work(p,ws,first.run.id).state=='ready'
    detail=s.get_conversation(p,ws,csvcv.id)
    table=detail.messages[-1].result.results[1]
    obs=s.get_product_observation(p,ws,table.observation_id).observation
    assert obs.output.expected_sum=='77.40' and obs.evidence_origin=='local_tool'
    assert obs.model_selection.attempt_id==detail.messages[-1].model_receipt
    assert detail.messages[-1].evidence_origin=='synthetic_provider_receipt'
    artifact=s.get_artifact(p,ws,table.artifact_id)
    edited=artifact.current_revision.body.model_copy(deep=True); edited.notes=['Human: keep my note']
    edited.rows[1]['note']='Human edited row note'
    saved=s.human_save(p,ws,artifact.id,cmd(HumanSave,expected_current_revision_id=artifact.current_revision_id,body=edited))
    second=post(context,detail.conversation,'Recalculate my saved CSV using round-half-even, keeping my notes.',target=target(saved))
    assert w.work(p,ws,second.run.id).state=='ready'
    proposal=s.proposals(p,ws,artifact.id).items[0]
    assert proposal.body.rounding=='ROUND_HALF_EVEN' and proposal.body.notes==edited.notes
    assert proposal.body.rows[1]['note']=='Human edited row note'
    assert s.get_artifact(p,ws,artifact.id).current_revision_id==saved.current_revision_id
    third=post(context,wasmcv,'Build an invoice-total calculator in cents and test quantity3 at price1250.')
    assert not third.message.attachments and third.message.operation is None
    assert w.work(p,ws,third.run.id).state=='ready'
    detail=s.get_conversation(p,ws,wasmcv.id); tool=detail.messages[-1].result.results[1]
    assert s.get_product_observation(p,ws,tool.observation_id).observation.output.value==3750
    art=s.get_artifact(p,ws,tool.artifact_id); edited=art.current_revision.body.model_copy(deep=True)
    edited.notes=['Human: keep cents']
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=edited))
    fourth=post(context,detail.conversation,'Add shipping as a separate input and test shipping500. Preserve my saved notes.',target=target(saved))
    assert w.work(p,ws,fourth.run.id).state=='ready'
    detail=s.get_conversation(p,ws,wasmcv.id); result=detail.messages[-1].result.results[1]
    assert s.get_product_observation(p,ws,result.observation_id).observation.output.value==4250
    proposal=s.proposals(p,ws,art.id).items[0]
    assert proposal.body.notes==edited.notes and proposal.status=='pending'
    assert s.get_artifact(p,ws,art.id).current_revision_id==saved.current_revision_id
    t=totals(s,grant)
    assert t['request_counts']=={'count_send':8,'dispatch':8,'read':0,'cancel':0}
    assert t['reserved_input_tokens']==160000 and t['reserved_output_tokens']==65536
    before=len(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,fourth.run.id).state=='ready'
    assert len(fake.calls)==before
    # Admission itself refuses a fifth turn, before constructing an attempt.
    raises('budget_exhausted',lambda:post(context,detail.conversation,'Hello'))
    assert len(fake.calls)==before
    import psycopg
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM provider_attempts WHERE grant_id=%s',(grant.id,)).fetchone()['n']==4
        step=c.execute('SELECT s.* FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id WHERE a.run_id=%s',(fourth.run.id,)).fetchone()
    with pytest.raises(psycopg.Error,match='cumulative request limit'):
        with s.db.transaction() as c:
            c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,'selection','count_send','{}')",(new_id(),step['attempt_id']))
    assert totals(s,grant)['request_counts']['count_send']==8


def setup(ctx,tmp_path,**kwargs):
    cv=conversation(ctx); grant=activate(ctx,[cv]); fake=Provider(**kwargs)
    queued=post(ctx,cv,'Reconcile this CSV and explain discrepancies.',attachments=[attach()])
    return cv,grant,fake,queued,worker(ctx,fake,tmp_path)


@pytest.mark.parametrize('bad',['ref','hash'])
def test_forged_attachment_binding_denied(context,tmp_path,bad):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,bad=bad)
    raises('not_found_or_not_authorized',lambda:w.work(p,ws,q.run.id))
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.artifact_ids==[] and len(detail.messages)==1
    assert totals(s,g)['request_counts']['dispatch']==1


@pytest.mark.parametrize('bad',['extra','bool_arg','final_extra'])
def test_strict_bad_outputs_no_repair_no_product(context,tmp_path,bad):
    s,p,ws,_,_=context
    if bad=='bool_arg':
        cv=conversation(context); g=activate(context,[cv]); fake=Provider(bad=bad)
        q=post(context,cv,'Build a calculator'); w=worker(context,fake,tmp_path)
    else: cv,g,fake,q,w=setup(context,tmp_path,bad=bad)
    assert w.work(p,ws,q.run.id).state=='running'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.artifact_ids==[] and len(detail.messages)==1
    assert detail.turns[0].provider_observation=='invalid'
    assert totals(s,g)['request_counts']['dispatch']==(2 if bad=='final_extra' else 1)
    if bad=='final_extra':
        with s.db.transaction() as c:
            assert c.execute("SELECT 1 FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='tool_result'",(q.run.id,)).fetchone()


def test_unknown_id_never_resends_or_offers_fresh_turn(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path,lose_id=True)
    assert w.work(p,ws,q.run.id).state=='running'
    expire(context,q.run.id)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='running'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[0].provider_observation=='outcome_unknown'
    assert len(detail.messages)==1 and detail.artifact_ids==[]
    raises('action_unresolved',lambda:post(context,detail.conversation,'Try again'))
    assert totals(s,g)['request_counts']=={'count_send':1,'dispatch':1,'read':0,'cancel':0}
    assert totals(s,g)['unknown_usage_steps']==1


@pytest.mark.parametrize('fault',['after_count','after_predispatch','after_response','after_tool_result','before_publication','after_publication'])
def test_restart_reuses_durable_count_identity_and_tool_result(context,tmp_path,monkeypatch,fault):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path)
    def crash(name):
        if name==fault: raise RuntimeError('synthetic crash')
    w.phases.hook=crash
    if fault=='after_publication':
        assert w.work(p,ws,q.run.id).state=='ready'
    else:
        with pytest.raises(RuntimeError): w.work(p,ws,q.run.id)
        expire(context,q.run.id)
    if fault in ('after_tool_result','before_publication'):
        retained=s.get_conversation(p,ws,cv.id).turns[0].retained_local_result
        assert retained.status=='observed' and not retained.published
        assert retained.output.expected_sum=='77.40'
        assert retained.body.rows[1]['calculated_total']=='37.50'
        monkeypatch.setattr(s,'_calculate_product',lambda *_:(_ for _ in ()).throw(AssertionError('retained tool must not reexecute')))
    result=worker(context,fake,tmp_path).work(p,ws,q.run.id)
    if fault=='after_predispatch':
        # Unknown whether an external send occurred: even this test's unsent hook
        # cannot authorize a generation retry.
        assert result.state=='running' and len(fake.responses)==0
        assert totals(s,g)['request_counts']=={'count_send':1,'dispatch':1,'read':0,'cancel':0}
    else:
        assert result.state=='ready'
        t=totals(s,g)
        assert t['request_counts']=={'count_send':2,'dispatch':2,'read':1 if fault=='after_response' else 0,'cancel':0}
        detail=s.get_conversation(p,ws,cv.id)
        assert len(detail.messages)==2 and len(detail.artifact_ids)==2


@pytest.mark.parametrize('point',['after_tool_result','before_publication'])
@pytest.mark.parametrize('change',['revoke','cancel','membership'])
def test_late_authority_change_retains_receipts_but_blocks_publication(context,tmp_path,point,change):
    s,p,ws,_,admin=context
    cv,g,fake,q,w=setup(context,tmp_path)
    def alter(name):
        if name!=point:return
        if change=='revoke': revoke_grant(Database(admin),g.id)
        elif change=='cancel': s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=q.conversation.work_version))
        else:
            with Database(admin).transaction() as c: c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    w.phases.hook=alter
    with pytest.raises(Exception): w.work(p,ws,q.run.id)
    with Database(admin).transaction() as c:
        assert c.execute('SELECT count(*) n FROM artifacts WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
        assert c.execute("SELECT count(*) n FROM conversation_messages WHERE workspace_id=%s AND author_kind='assistant'",(ws,)).fetchone()['n']==0
        assert c.execute("SELECT count(*) n FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='tool_result'",(q.run.id,)).fetchone()['n']==1
    assert totals(s,g)['request_counts']['dispatch']==(1 if point=='after_tool_result' else 2)


def test_exact_target_scope_hash_and_stale_revision(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); other=conversation(context); g=activate(context,[cv,other]); fake=Provider(); w=worker(context,fake,tmp_path)
    q=post(context,cv,'Reconcile CSV',attachments=[attach()]); w.work(p,ws,q.run.id)
    detail=s.get_conversation(p,ws,cv.id); art=s.get_artifact(p,ws,detail.messages[-1].result.results[1].artifact_id)
    exact=target(art)
    raises('not_found_or_not_authorized',lambda:post(context,other,'Recalculate',target=exact))
    raises('version_conflict',lambda:post(context,detail.conversation,'Recalculate',target=exact.model_copy(update={'body_hash':'0'*64})))
    body=art.current_revision.body.model_copy(deep=True); body.notes=['Keep']
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
    raises('version_conflict',lambda:post(context,detail.conversation,'Recalculate',target=exact))
    q=post(context,detail.conversation,'Recalculate',target=target(saved))
    def edit(name):
        if name=='before_publication':
            newer=body.model_copy(deep=True); newer.notes=['Newer human edit']
            s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=saved.current_revision_id,body=newer))
    w.phases.hook=edit
    with pytest.raises(Exception): w.work(p,ws,q.run.id)
    assert s.proposals(p,ws,art.id).items==[]
    assert s.get_artifact(p,ws,art.id).current_revision.body.notes==['Newer human edit']


def test_dispatchers_explicit_enable_concurrency_and_no_controlled_fallback(context,tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from workagent.dispatcher import Dispatcher
    from workagent.general_worker import ControlledTransport
    from workagent.responses_dispatcher import ResponsesDispatcher
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path)
    assert Dispatcher(s,workspace=ws,general_controlled=True).once()['deferred']==1
    raises('unsupported_operation',lambda:GeneralWorker(s,transport=fake.transport()))
    raises('unsupported_operation',lambda:GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id))
    def dispatch(_):
        return Dispatcher(s,workspace=ws,general_worker=worker(context,fake,tmp_path)).once()
    with ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(dispatch,range(2)))
    assert s.get_run(p,ws,q.run.id).state=='ready'
    assert totals(s,g)['request_counts']=={'count_send':2,'dispatch':2,'read':0,'cancel':0}
    assert ResponsesDispatcher(w,workspace=ws,grant_id=g.id).once()['results']==[]


def test_reply_decision_without_operation_has_receipt_not_local_observation(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); g=activate(context,[cv]); fake=Provider(); q=post(context,cv,'Hello')
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    assert not detail.artifact_ids and len(detail.messages[-1].result.results)==1
    assert detail.messages[-1].model_receipt and detail.turns[0].provider_observation=='received'
    assert detail.conversation.execution_profile==PROFILE and detail.conversation.model_activation=='active'
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM product_observations WHERE run_id=%s',(q.run.id,)).fetchone()['n']==0
