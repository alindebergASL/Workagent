"""Negative and dispatcher controls for cancelled receipt-only observation."""
import httpx
import psycopg
import pytest

from test_domain import context, cmd
from test_cancelled_response_receipts import (
    pending, cancel_by_human_save, restart, journal, assert_no_application,
    assert_history_preserved,
)
from test_general_responses import totals
from workagent.db import Database
from workagent.errors import DomainError
from workagent.general_responses import has_unresolved_attempt
from workagent.models import new_id
from workagent.provider_attempts import revoke_grant
from workagent.responses_dispatcher import ResponsesDispatcher
from workagent.responses_ledger import Ledger, ObservationAuthority, parsed_data
from workagent.responsibility_models import ControlResponsibility
from workagent.service import encoded, WorkerCapability


def unresolved(case):
    with case.s.db.transaction() as c:
        return has_unresolved_attempt(c,case.ws,case.cv.id)


def test_repeat_recovery_is_receipt_only_and_idempotent(context,tmp_path):
    case=pending(context,tmp_path)
    before=journal(case)
    cancel_by_human_save(case,context)
    case.fake.release=True
    restart(case,context,tmp_path).work(case.p,case.ws,case.rid)
    assert not unresolved(case)
    assert journal(case)[2]['cancelled_unapplied']['reason']=='first_retained_after_cancellation'
    settled=journal(case); calls=list(case.fake.calls); accounting=totals(case.s,case.grant)
    for _ in range(2):restart(case,context,tmp_path).work(case.p,case.ws,case.rid)
    assert journal(case)==settled
    assert case.fake.calls==calls
    assert totals(case.s,case.grant)==accounting
    assert_history_preserved(case,before)
    assert_no_application(case)
    stale=WorkerCapability(**case.saved_state['worker'])
    with pytest.raises(DomainError):case.s.stage_general_product(stale,case.receipt)
    observer=ObservationAuthority(case.p)
    with pytest.raises(DomainError):Ledger(case.s,case.receipt).prepare(case.request,observer)
    with pytest.raises(DomainError):Ledger(case.s,case.receipt).reserve_operation(case.request,'dispatch',observer)


@pytest.mark.parametrize('barrier',['pause','cancel','takeover','revoke','membership','generation','closed'])
def test_current_authority_denies_observation_and_forged_marker(context,tmp_path,barrier):
    case=pending(context,tmp_path)
    cancel_by_human_save(case,context)
    if barrier in ('pause','cancel','takeover'):
        with case.s.db.transaction() as c:
            aid=c.execute('SELECT data FROM run_configurations WHERE run_id=%s',(case.rid,)).fetchone()['data']['responsibility']['assignment_id']
        life=case.s.get_responsibility(case.p,case.ws,aid)
        case.s.control_responsibility(case.p,case.ws,aid,cmd(ControlResponsibility,
            expected_work_version=life.assignment.work_version,operation=barrier))
    elif barrier=='revoke':revoke_grant(Database(context[4]),case.grant.id)
    else:
        with Database(context[4]).transaction() as c:
            if barrier=='membership':c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(case.ws,))
            elif barrier=='generation':c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(case.ws,))
            else:c.execute("UPDATE conversations SET data=jsonb_set(data,'{state}','\"cancelled\"') WHERE id=%s",(case.cv.id,))
    before=journal(case); calls=list(case.fake.calls); accounting=totals(case.s,case.grant)
    case.fake.release=True
    try:restart(case,context,tmp_path).work(case.p,case.ws,case.rid)
    except DomainError:pass
    assert journal(case)==before and case.fake.calls==calls
    assert totals(case.s,case.grant)==accounting and unresolved(case)
    with pytest.raises(psycopg.Error),case.s.db.transaction() as c:
        c.execute('INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,%s,%s,%s)',
            (new_id(),case.receipt.attempt_id,'selection','read',encoded({'cancelled_observation':True})))


def test_exhausted_shared_reads_no_http(context,tmp_path):
    case=pending(context,tmp_path)
    # Real restricted-role reservations exhaust the same cumulative counter.
    ledger=Ledger(case.s,case.receipt)
    used=totals(case.s,case.grant)['request_counts']['read']
    with case.s.db.transaction() as c:
        for _ in range(case.grant.responses.read_limit-used):
            ledger.event(c,'selection','read',{})
    cancel_by_human_save(case,context)
    calls=list(case.fake.calls); before=journal(case)
    case.fake.release=True
    restart(case,context,tmp_path).work(case.p,case.ws,case.rid)
    assert case.fake.calls==calls and journal(case)==before and unresolved(case)
    with pytest.raises(psycopg.Error),case.s.db.transaction() as c:
        ledger.event(c,'selection','read',{'cancelled_observation':True})


def test_dispatcher_discovers_acknowledged_cancelled_run_and_honors_authorization(context,tmp_path):
    case=pending(context,tmp_path)
    cancel_by_human_save(case,context)
    case.fake.release=True
    dispatcher=ResponsesDispatcher(restart(case,context,tmp_path),workspace=case.ws,grant_id=case.grant.id)
    calls=list(case.fake.calls); before=journal(case)
    dispatcher.once(model_authorized=False)
    assert case.fake.calls==calls and journal(case)==before
    result=dispatcher.once()
    assert any(r['run_id']==case.rid and r['status']=='cancelled' for r in result['results']),result
    assert not unresolved(case)
    assert case.fake.calls[len(calls):]==[('GET','/v1/responses/'+before[2]['identity']['response_id'])]
    assert_no_application(case)
    with case.s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM run_configurations WHERE workspace_id=%s AND data ? %s',
            (case.ws,'responsibility')).fetchone()['n']==1


def test_pre_cancellation_result_without_action_stays_ambiguous(context,tmp_path):
    case=pending(context,tmp_path)
    case.fake.release=True
    # Retain a real parsed receipt while running, then simulate interruption
    # before any tool_result. No claim about whether an effect was attempted.
    ledger=Ledger(case.s,case.receipt)
    cap=WorkerCapability(**case.saved_state['worker'])
    ledger.reserve_operation(case.request,'read',cap)
    response=case.original_worker.transport.retrieve(journal(case)[2]['identity']['response_id'],request=case.request)
    ledger.retain(case.request,'result',parsed_data(response))
    cancel_by_human_save(case,context)
    before=journal(case); calls=list(case.fake.calls)
    restart(case,context,tmp_path).work(case.p,case.ws,case.rid)
    assert journal(case)==before and case.fake.calls==calls
    assert 'cancelled_unapplied' not in before[2] and unresolved(case)
    with pytest.raises(psycopg.Error),case.s.db.transaction() as c:
        result_id=next(row['id'] for row in before[1] if row['kind']=='result')
        ledger.event(c,'selection','cancelled_unapplied',{'result_event_id':result_id,
            'reason':'first_retained_after_cancellation'})
    assert_no_application(case)


@pytest.mark.parametrize('problem',['pending','unavailable','missing_usage','mismatched'])
def test_nonsettling_observations_remain_blocking(context,tmp_path,problem):
    case=pending(context,tmp_path)
    cancel_by_human_save(case,context)
    case.fake.release=True
    original=case.fake.handle
    def handle(request):
        if request.method!='GET':return original(request)
        response=original(request)
        if problem=='unavailable':return httpx.Response(503,json={'error':'unavailable'})
        body=response.json()
        if problem=='pending':body.update(status='in_progress',usage=None,output=[])
        elif problem=='missing_usage':body['usage']=None
        else:body['id']='resp_wrong_identity'
        return httpx.Response(200,json=body)
    case.original_worker.transport._client._transport=httpx.MockTransport(handle)
    case.original_worker.work(case.p,case.ws,case.rid)
    assert unresolved(case)
    assert_no_application(case)


def test_revocation_after_reservation_blocks_get(context,tmp_path,monkeypatch):
    case=pending(context,tmp_path)
    cancel_by_human_save(case,context)
    case.fake.release=True
    calls=list(case.fake.calls)
    original=Ledger.reserve_operation
    def reserve(ledger,*args,**kwargs):
        result=original(ledger,*args,**kwargs)
        revoke_grant(Database(context[4]),case.grant.id)
        return result
    monkeypatch.setattr(Ledger,'reserve_operation',reserve)
    before=totals(case.s,case.grant)
    restart(case,context,tmp_path).work(case.p,case.ws,case.rid)
    assert case.fake.calls==calls and unresolved(case)
    assert totals(case.s,case.grant)['request_counts']['read']==before['request_counts']['read']+1
    assert_no_application(case)


def test_changed_transport_provenance_denies_get(context,tmp_path):
    from workagent.responses_transport import ResponsesTransport
    case=pending(context,tmp_path)
    cancel_by_human_save(case,context)
    calls=list(case.fake.calls); before=journal(case)
    w=restart(case,context,tmp_path)
    transport=ResponsesTransport.synthetic(httpx.MockTransport(case.fake.handle),origin='http://127.0.0.1:12345')
    w.transport=w.phases.transport=transport
    w.work(case.p,case.ws,case.rid)
    assert case.fake.calls==calls and journal(case)==before and unresolved(case)
