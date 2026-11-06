"""Known unexecuted rejection handoff: disposable PG + synthetic HTTP only."""
from dataclasses import replace
from types import SimpleNamespace as NS
import json
import httpx
import pytest
from test_domain import context
from test_conversations import conversation, post
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker, totals
from test_local_rejection_settlement import journal
from workagent.models import now
from workagent.service import Service, WorkerCapability
from workagent.db import Database
from workagent.provider_attempts import ReceiptCapability
from workagent.responses_ledger import observations
from workagent.errors import DomainError
from workagent.execution_status import classify
from workagent.selection_rejection import valid, canonical, digest


def test_rejected_then_pending_yields_and_restart_gets_same_id(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context);grant=activate(context,cv);q=post(context,cv,'Answer briefly.')
    fake=AlphaProvider([{'kind':'reply','text':False},{'kind':'reply','text':'Corrected answer.'}])
    original=fake.handle
    def pending(request):
        response=original(request)
        if request.method=='POST' and request.url.path=='/v1/responses' and json.loads(request.content)['metadata']['step_id']=='selection_2':
            saved=w.phases.state.load(ws,q.run.id)
            assert saved is not None
            assert not s.yield_settled_responses_lease(WorkerCapability(**saved['worker']),ReceiptCapability(**saved['receipt']))
            body=response.json();body.update(status='in_progress',output=[],usage=None)
            return httpx.Response(200,json=body)
        return response
    fake.handle=pending
    w=worker(context,fake,tmp_path);w.phases.poll_limit=0
    assert w.work(p,ws,q.run.id).state=='running'
    saved=w.phases.state.load(ws,q.run.id)
    cap=WorkerCapability(**saved['worker']);receipt=ReceiptCapability(**saved['receipt'])
    before=journal(s,ws,q.run.id);usage=totals(s,grant)
    assert before['selection','result']['state']=='malformed'
    assert ('selection','tool_result') not in before and ('selection_2','result') not in before
    rid=before['selection_2','identity']['response_id']
    turn=s.get_conversation(p,ws,cv.id).turns[-1]
    assert turn.state=='responding' and turn.provider_observation=='pending'
    with s.db.transaction() as c:steps=observations(c,receipt.attempt_id)
    assert [(x.phase,x.state) for x in steps]==[('selection','received'),('selection_2','accepted')]
    assert classify(s.get_run(p,ws,q.run.id),steps,True)==('awaiting_provider',None)
    for bad_cap,bad_receipt in [(replace(cap,fence=cap.fence+1),receipt),
                                (cap,replace(receipt,attempt_id='wrong'))]:
        with pytest.raises(DomainError):s.yield_settled_responses_lease(bad_cap,bad_receipt)
    assert s.yield_settled_responses_lease(cap,receipt)
    first=s.get_run(p,ws,q.run.id)
    assert first.lease_expires_at<=now()
    assert journal(s,ws,q.run.id)==before and totals(s,grant)==usage
    start=len(fake.calls)
    restarted=worker((Service(Database()),*context[1:]),fake,tmp_path)
    assert restarted.work(p,ws,q.run.id).state=='ready'
    assert fake.calls[start]==('GET','/v1/responses/'+rid)
    assert s.get_run(p,ws,q.run.id).fence==first.fence+1
    after=journal(s,ws,q.run.id)
    assert all(after[k]==v for k,v in before.items())
    assert totals(s,grant)['request_counts']=={'count_send':3,'dispatch':3,'read':1,'cancel':0}
    assert totals(s,grant)['reported_usage']=={'input_tokens':2100,'output_tokens':600}
    assert totals(s,grant)['unknown_usage_steps']==0


@pytest.mark.parametrize('case',['unknown_next','unbound_rejection'])
def test_unsafe_outcome_keeps_owned_lease(context,tmp_path,monkeypatch,case):
    import workagent.selection_rejection as rejection
    s,p,ws,_,_=context
    cv=conversation(context);activate(context,cv);q=post(context,cv,'Answer briefly.')
    fake=AlphaProvider([{'kind':'reply','text':False},{'kind':'reply','text':'Answer.'}],
        lose_phase='selection_2' if case=='unknown_next' else None)
    w=worker(context,fake,tmp_path)
    if case=='unbound_rejection':
        def interrupt(*args):raise InterruptedError('before rejection proof')
        monkeypatch.setattr(rejection,'retain',interrupt)
        with pytest.raises(InterruptedError):w.work(p,ws,q.run.id)
    else:assert w.work(p,ws,q.run.id).state=='running'
    saved=w.phases.state.load(ws,q.run.id)
    cap=WorkerCapability(**saved['worker']);receipt=ReceiptCapability(**saved['receipt'])
    before=s.get_run(p,ws,q.run.id);events=journal(s,ws,q.run.id);calls=list(fake.calls)
    assert not s.yield_settled_responses_lease(cap,receipt)
    assert s.get_run(p,ws,q.run.id).lease_expires_at==before.lease_expires_at
    assert journal(s,ws,q.run.id)==events and fake.calls==calls
    turn=s.get_conversation(p,ws,cv.id).turns[-1]
    assert turn.provider_observation==('outcome_unknown' if case=='unknown_next' else 'invalid')


def proof_fixture():
    metadata={'request_id':'run','attempt_id':'attempt','step_id':'selection'}
    step=dict(request_sha256='a'*64,count_sha256='b'*64,metadata=metadata)
    common=dict(request_sha256=step['request_sha256'],metadata=metadata)
    result=dict(**common,state='malformed',issue='schema_validation_failed',usage={'input_tokens':1},
        value=None,call_id=None,output_items='[]',response_id='response',rejection_diagnostic='raw')
    proof=dict(version='selection-rejection/v1',attempt_id='attempt',phase='selection',result_event_id='result',
        result_sha256=digest(canonical(result)),request_sha256=step['request_sha256'],response_id='response',
        terminal_outcome='continue',diagnostic_sha256=digest('raw'))
    events={'count_send':{},'count_result':dict(**common,count_sha256=step['count_sha256'],input_tokens=1),
        'dispatch':{},'identity':dict(**common,response_id='response'),'result':result,'selection_rejection':proof}
    return step,events


@pytest.mark.parametrize('damage',[None,'proof_attempt_id','proof_phase','proof_result_event_id','proof_result_sha256',
    'proof_request_sha256','proof_response_id','proof_diagnostic_sha256','missing_identity','missing_count_result',
    'missing_selection_rejection','usage','metadata','count','ambiguous','tool_result','native','cancel','problem'])
def test_only_exact_known_unexecuted_binding_is_recognized(damage):
    step,events=proof_fixture()
    if damage and damage.startswith('proof_'):events['selection_rejection'][damage[6:]]='wrong'
    elif damage and damage.startswith('missing_'):events.pop(damage[8:])
    elif damage=='usage':events['result']['usage']=None
    elif damage=='metadata':events['result']['metadata']={}
    elif damage=='count':events['count_result']['count_sha256']='wrong'
    elif damage=='ambiguous':events['result']['issue']='ambiguous_output'
    elif damage in ('tool_result','cancel','problem'):events[damage]={}
    def execute(q,args):
        if 'FROM responses_steps' in q:rows=[step]
        elif 'FROM responses_events' in q:rows=[dict(id=k,kind=k,data=v) for k,v in events.items()]
        elif 'FROM tool_attempts' in q:rows=[{'exists':1}] if damage=='native' else []
        else:raise AssertionError(q)
        return NS(fetchall=lambda:rows,fetchone=lambda:rows[0] if rows else None)
    assert valid(NS(execute=execute),'attempt','selection') is (damage is None)
