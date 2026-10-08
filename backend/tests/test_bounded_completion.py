"""Disposable PostgreSQL + synthetic HTTP completion/recovery; no paid calls."""
import json
import httpx
import pytest

from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_general_responses import Provider, worker, target, totals
from test_adaptive_execution import activate
from test_general_products import csvop
from test_runtime import expire
from test_bounded_verifier_pure import GOAL, CSV
from workagent.models import HumanSave
from workagent.message_models import AttachmentInput
from workagent.general_worker import GeneralWorker, ControlledTransport
from workagent.responses_dispatcher import ResponsesDispatcher


class CSVProvider(Provider):
    def __init__(self,wrong_first=False,lose_phase=None):
        super().__init__()
        self.contexts=[]; self.wrong_first=wrong_first; self.lose_phase=lose_phase

    def handle(self,request):
        response=super().handle(request)
        if request.method!='POST' or request.url.path!='/v1/responses': return response
        payload=json.loads(request.content)
        context=json.loads(payload['input'][0]['content'])
        self.contexts.append(context)
        data=response.json()
        if payload['metadata']['step_id']!='final':
            item=data['output'][0]
            decision=json.loads(item['arguments'])['decision']
            if self.wrong_first and len(self.contexts)==1: decision['rounding']='ROUND_HALF_EVEN'
            item['arguments']=json.dumps(dict(goal='Reconcile supplied CSV',success_criteria=[],decision=decision))
        else:
            # Success prose cannot become evidence or an acceptance claim.
            data['output'][0]['content'][0]['text']=json.dumps({'text':'Accepted and emailed everything.'})
        self.responses[data['id']]=data
        if self.lose_phase==payload['metadata']['step_id']: raise httpx.ReadError('lost send acknowledgement')
        return httpx.Response(200,json=data)


def initial(context,tmp_path,fake=None,text=GOAL):
    cv=conversation(context); grant=activate(context,cv)
    q=post(context,cv,text,attachments=[AttachmentInput(filename='input.csv',mime_type='text/csv',content=CSV)])
    fake=fake or CSVProvider()
    return cv,grant,q,fake,worker(context,fake,tmp_path)


def test_bounded_completion_download_dto_and_rounding_repair(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,q,fake,w=initial(context,tmp_path,CSVProvider(wrong_first=True))
    assert w.work(p,ws,q.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    steps=detail.turns[0].adaptive.steps
    assert len(steps)==2 and steps[0].verification.automatic.failures
    assert steps[1].verification.satisfied and steps[1].verification.automatic.row_count==3
    feedback=fake.contexts[1]['adaptive']['observations'][0]['verification']['automatic']
    assert set(feedback)=={'recognized','passed','failures','scope'}
    assert 'Accepted and emailed' not in detail.messages[-1].text
    assert 'Verified all 3 rows' in detail.messages[-1].text
    results=detail.messages[-1].result.results
    downloads=[s.download_product(p,ws,r.artifact_id).content for r in results[1:]]
    assert downloads[0]==downloads[1] and '1.01,-0.01,discrepancy' in downloads[0]
    assert totals(s,g)['request_counts']['dispatch']==3


def test_extra_obligation_retains_useful_work_without_completion(context,tmp_path):
    s,p,ws,_,_=context
    cv,_,q,_,w=initial(context,tmp_path,text=GOAL+' Also apply a discount.')
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[0].adaptive.outcome=='needs_validation'
    assert detail.turns[0].retained_local_result.published
    assert not detail.turns[0].adaptive.steps[0].verification.automatic.recognized


def test_wrong_executable_result_requires_independent_repair(context,tmp_path,monkeypatch):
    s,p,ws,_,_=context
    cv,_,q,_,w=initial(context,tmp_path)
    original=s._calculate_product
    calls=[]
    def faulty(operation,base):
        body,file,output=original(operation,base)
        calls.append(True)
        if len(calls)==1:
            body.rows[0]['calculated_total']='9.99'
        return body,file,output
    monkeypatch.setattr(s,'_calculate_product',faulty)
    assert w.work(p,ws,q.run.id).state=='ready'
    steps=s.get_conversation(p,ws,cv.id).turns[0].adaptive.steps
    assert len(steps)==2 and steps[0].status=='observed'
    assert steps[0].verification.automatic.failures==['table_rows']
    assert steps[1].verification.satisfied


def test_rejected_csv_never_becomes_completion(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,cv)
    q=post(context,cv,GOAL,attachments=[AttachmentInput(filename='input.csv',mime_type='text/csv',
        content=CSV.replace('zero','=unsafe'))])
    assert worker(context,CSVProvider(),tmp_path).work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[0].adaptive.outcome=='step_limit' and not detail.artifact_ids
    assert all(not step.verification.satisfied for step in detail.turns[0].adaptive.steps)


def test_passing_staged_verification_with_unknown_final_is_not_completion(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,q,fake,w=initial(context,tmp_path,CSVProvider(lose_phase='final'))
    assert w.work(p,ws,q.run.id).state=='running'
    detail=s.get_conversation(p,ws,cv.id)
    turn=detail.turns[0]
    assert turn.adaptive.steps[0].verification.satisfied
    assert turn.adaptive.outcome=='pending' and turn.provider_observation=='outcome_unknown'
    assert not turn.retained_local_result.published and not detail.artifact_ids
    before=list(fake.calls)
    assert ResponsesDispatcher(worker(context,fake,tmp_path),workspace=ws,grant_id=g.id).once()['results'][0]['status']=='outcome_unknown'
    assert fake.calls==before


def saved_request(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context)
    seeded=post(context,cv,'Create table',operation=csvop())
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,seeded.run.id)
    detail=s.get_conversation(p,ws,cv.id)
    art=s.get_artifact(p,ws,detail.messages[-1].result.results[1].artifact_id)
    body=art.current_revision.body.model_copy(deep=True)
    body.rows[0]['unit_price']='1.005'; body.rows[0]['note']='Preserve my edited row'
    body.notes=['Preserve my human note']
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
    g=activate(context,detail.conversation)
    q=post(context,detail.conversation,GOAL.replace('this CSV','the saved CSV').replace('half-up','half-even'),target=target(saved))
    fake=CSVProvider()
    return saved,g,q,fake,worker(context,fake,tmp_path)


@pytest.mark.parametrize('fault',['after_tool_result','before_publication'])
def test_interrupt_restart_same_run_preserves_edits_and_never_accepts(context,tmp_path,fault):
    s,p,ws,_,_=context
    saved,g,q,fake,w=saved_request(context,tmp_path)
    def crash(name):
        if name==fault: raise KeyboardInterrupt
    w.phases.hook=crash
    with pytest.raises(KeyboardInterrupt): w.work(p,ws,q.run.id)
    expire(context,q.run.id)
    run=worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert run.id==q.run.id and run.state=='ready'
    assert totals(s,g)['request_counts']['dispatch']==2
    proposal=s.proposals(p,ws,saved.id).items[0]
    assert proposal.status=='pending' and proposal.base_revision_id==saved.current_revision_id
    assert proposal.body.notes==saved.current_revision.body.notes
    assert proposal.body.rows[0]['note']=='Preserve my edited row'
    assert s.get_artifact(p,ws,saved.id).current_revision_id==saved.current_revision_id
    file=s.download_product(p,ws,saved.id,proposal_id=proposal.id)
    assert 'Preserve my edited row' in file.content
    raises('validation_error',lambda:s.download_product(p,ws,saved.id,revision_id=saved.current_revision_id,proposal_id=proposal.id))
    raises('not_found_or_not_authorized',lambda:s.download_product(p,ws,'other',proposal_id=proposal.id))
    detail=s.get_conversation(p,ws,q.conversation.id)
    assert detail.turns[-1].adaptive.steps[-1].verification.automatic.base_hash==saved.current_revision.body_hash
    assert 'acceptance is still required' in detail.messages[-1].text
    before=list(fake.calls)
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert fake.calls==before


def test_source_edit_after_interrupt_invalidates_pending_work(context,tmp_path):
    s,p,ws,_,_=context
    saved,_,q,fake,w=saved_request(context,tmp_path)
    def crash(name):
        if name=='after_tool_result': raise KeyboardInterrupt
    w.phases.hook=crash
    with pytest.raises(KeyboardInterrupt): w.work(p,ws,q.run.id)
    edited=saved.current_revision.body.model_copy(deep=True)
    # Original attachment bytes are immutable; human source cells are editable.
    edited.rows[0]['unit_price']='20.95'
    latest=s.human_save(p,ws,saved.id,cmd(HumanSave,expected_current_revision_id=saved.current_revision_id,body=edited))
    expire(context,q.run.id)
    before=list(fake.calls)
    raises('version_conflict',lambda:worker(context,fake,tmp_path).work(p,ws,q.run.id))
    assert fake.calls==before
    assert s.get_artifact(p,ws,saved.id).current_revision_id==latest.current_revision_id
    assert not s.proposals(p,ws,saved.id).items


def test_known_id_resume_and_unknown_send_do_not_block_local(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,q,fake,w=initial(context,tmp_path)
    def crash(name):
        if name=='after_response': raise KeyboardInterrupt
    w.phases.hook=crash
    with pytest.raises(KeyboardInterrupt): w.work(p,ws,q.run.id)
    expire(context,q.run.id)
    recovered=ResponsesDispatcher(worker(context,fake,tmp_path),workspace=ws,grant_id=g.id).once()
    assert recovered['results'][0]['status']=='completed'
    assert any(method=='GET' for method,_ in fake.calls)
    assert totals(s,g)['request_counts']['dispatch']==2
    post(context,s.get_conversation(p,ws,cv.id).conversation,GOAL,
        attachments=[AttachmentInput(filename='input.csv',mime_type='text/csv',content=CSV)])
    fake.lose_phase='selection'
    d=ResponsesDispatcher(worker(context,fake,tmp_path),workspace=ws,grant_id=g.id)
    assert d.once()['results'][0]['status']=='outcome_unknown'
    localcv=conversation(context)
    local=post(context,localcv,'Local independent CSV',operation=csvop())
    before=list(fake.calls)
    result=d.once()
    assert result['local']['completed']==1 and fake.calls==before
    assert s.get_run(p,ws,local.run.id).state=='ready'
    restarted=ResponsesDispatcher(worker(context,fake,tmp_path),workspace=ws,grant_id=g.id)
    assert restarted.once()['results'][0]['status']=='outcome_unknown'
    assert fake.calls==before


def test_revoked_model_grant_does_not_stop_unrelated_local_work(context,tmp_path):
    from workagent.db import Database
    from workagent.provider_attempts import revoke_grant
    s,p,ws,_,admin=context
    _,g,_,fake,w=initial(context,tmp_path)
    revoke_grant(Database(admin),g.id)
    cv=conversation(context)
    local=post(context,cv,'Local CSV',operation=csvop())
    result=ResponsesDispatcher(w,workspace=ws,grant_id=g.id).once()
    assert result['results'][0]['status']=='authority_unavailable' and not fake.calls
    assert result['local']['completed']==1 and s.get_run(p,ws,local.run.id).state=='ready'


@pytest.mark.parametrize('field',['missing','request','spec','staged_result','passed'])
def test_sql_rejects_forged_automatic_completion(context,tmp_path,monkeypatch,field):
    from copy import deepcopy
    import psycopg
    from workagent.responses_ledger import Ledger
    s,p,ws,_,_=context
    cv,_,q,_,w=initial(context,tmp_path)
    original=Ledger.event
    def forged(ledger,c,phase,kind,data):
        if kind=='tool_result':
            data=deepcopy(data)
            if field=='missing': data['verification'].pop('automatic')
            elif field=='request': data['verification']['automatic']['request']['message_sha256']='0'*64
            elif field=='spec': data['verification']['automatic']['spec']['rounding']='ROUND_HALF_EVEN'
            elif field=='staged_result': data['body']['rows'][0]['note']='lost'
            elif field=='passed': data['verification']['automatic']['passed']=False
        return original(ledger,c,phase,kind,data)
    monkeypatch.setattr(Ledger,'event',forged)
    with pytest.raises(psycopg.Error,match='independent bounded evidence|automatic evidence'):
        w.work(p,ws,q.run.id)
    assert not s.get_conversation(p,ws,cv.id).artifact_ids


@pytest.mark.parametrize('text',[GOAL,GOAL.replace('half-up','half-even').replace('; ','. '),
    GOAL.replace('this CSV','the saved CSV'),GOAL+' Also email it.',
    GOAL.replace('every row','all rows').replace('2 decimal','two decimal'),
    '  Please '+GOAL+'  ',GOAL.replace('half-up','normal'),
    *[GOAL.replace(' ', separator, 1) for separator in ('\u00a0','\u2028','\u001c','\u3000','\t','\v')],
    GOAL.replace('unit_price','unit_prıce')])
def test_sql_and_python_recognizers_agree(context,text):
    from test_bounded_verifier_pure import case
    from workagent.bounded_verifier import recognize
    from workagent.service import encoded
    s,_,_,_,_=context
    message,_,_,_=case(text=text)
    spec=recognize(message)
    with s.db.transaction() as c:
        actual=c.execute('SELECT bounded_csv_spec(%s) AS spec',(encoded(message),)).fetchone()['spec']
    assert actual==(spec.model_dump(mode='json') if spec else None)
