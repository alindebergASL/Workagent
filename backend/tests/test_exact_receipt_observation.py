"""Controlled HTTP negative tests only; real PostgreSQL, no paid calls."""
from datetime import timedelta
import pytest
import psycopg
from test_domain import context
from test_cancelled_response_receipts import pending, journal
from workagent.db import Database
from workagent.models import now,new_id
from workagent.provider_attempts import revoke_grant
from workagent.receipt_observer import install, observe_once
from workagent.responses_ledger import Ledger,ExactObservationAuthority
from workagent.service import encoded,Principal
from workagent.errors import DomainError


def setup_observer(context,tmp_path,reads=2):
    case=pending(context,tmp_path)
    revoke_grant(Database(context[4]),case.grant.id)
    case.observer=install(Database(context[4]),observer_id=new_id(),receipt=case.receipt,
        principal=case.p,phase='selection',response_id=journal(case)[2]['identity']['response_id'],
        request_sha256=case.request.sha256,expires_at=now()+timedelta(minutes=5),read_limit=reads)
    return case


def test_exact_receipt_only_restart_no_publication(context,tmp_path):
    case=setup_observer(context,tmp_path);case.fake.release=True
    before=journal(case);run=case.s.get_run(case.p,case.ws,case.rid);calls=list(case.fake.calls)
    result=observe_once(case.s,case.receipt,case.observer,case.original_worker.transport)
    assert result['status']=='retained' and result['http_requests']==1
    assert case.fake.calls[len(calls):]==[('GET','/v1/responses/'+before[2]['identity']['response_id'])]
    assert observe_once(case.s,case.receipt,case.observer,case.original_worker.transport)['status']=='already_retained'
    assert len(case.fake.calls)==len(calls)+1
    assert case.s.get_run(case.p,case.ws,case.rid)==run
    assert 'tool_result' not in journal(case)[2]
    with case.s.db.transaction() as c:
        assert not c.execute('SELECT active FROM provider_grants WHERE id=%s',(case.grant.id,)).fetchone()['active']
    ledger=Ledger(case.s,case.receipt)
    for kind in ('dispatch','count_send','cancel'):
        with pytest.raises(DomainError):ledger.reserve_operation(case.request,kind,case.observer)
    with pytest.raises(DomainError):ledger.prepare(case.request,case.observer)


@pytest.mark.parametrize('mode',['wrong_id','wrong_hash','wrong_principal','wrong_phase'])
def test_cross_binding_install_denied(context,tmp_path,mode):
    case=pending(context,tmp_path);revoke_grant(Database(context[4]),case.grant.id)
    args=dict(observer_id=new_id(),receipt=case.receipt,principal=case.p,phase='selection',
              response_id=journal(case)[2]['identity']['response_id'],request_sha256=case.request.sha256,
              expires_at=now()+timedelta(minutes=5),read_limit=1)
    args[{'wrong_id':'response_id','wrong_hash':'request_sha256','wrong_principal':'principal','wrong_phase':'phase'}[mode]]=Principal('other') if mode=='wrong_principal' else 'wrong'
    with pytest.raises(DomainError):install(Database(context[4]),**args)


@pytest.mark.parametrize('barrier',['revoke','membership','generation','expiry','runtime_mint','runtime_update','phase','principal','exhausted'])
def test_barriers_no_http(context,tmp_path,barrier):
    case=setup_observer(context,tmp_path,reads=1);calls=list(case.fake.calls)
    admin=Database(context[4]);authority=case.observer
    if barrier in ('runtime_mint','runtime_update'):
        with pytest.raises(psycopg.Error),case.s.db.transaction() as c:
            if barrier=='runtime_update':c.execute('UPDATE exact_receipt_observers SET read_limit=10 WHERE id=%s',(authority.observer_id,))
            else:c.execute('INSERT INTO exact_receipt_observers SELECT * FROM exact_receipt_observers')
        return
    if barrier=='phase':authority=ExactObservationAuthority(case.p,authority.observer_id,'final')
    elif barrier=='principal':authority=ExactObservationAuthority(Principal('other'),authority.observer_id,'selection')
    elif barrier=='exhausted':Ledger(case.s,case.receipt).reserve_operation(case.request,'read',authority)
    elif barrier=='expiry':
        # Expiry cannot be rewritten, even by owner. Install an already expired
        # authority must fail rather than testing by disabling an immutable guard.
        with pytest.raises(psycopg.Error):
            install(admin,observer_id=new_id(),receipt=case.receipt,principal=case.p,
                phase='selection',response_id=journal(case)[2]['identity']['response_id'],
                request_sha256=case.request.sha256,expires_at=now()-timedelta(seconds=1),read_limit=1)
        return
    else:
        with admin.transaction() as c:
            if barrier=='revoke':c.execute('UPDATE exact_receipt_observers SET active=false WHERE id=%s',(authority.observer_id,))
            elif barrier=='membership':c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(case.ws,))
            else:c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(case.ws,))
    with pytest.raises((DomainError,psycopg.Error)):
        observe_once(case.s,case.receipt,authority,case.original_worker.transport)
    assert case.fake.calls==calls


def test_reservation_then_revocation_fences_http(context,tmp_path,monkeypatch):
    case=setup_observer(context,tmp_path);calls=list(case.fake.calls)
    reserve=Ledger.reserve_operation
    def changed(ledger,*args,**kwargs):
        out=reserve(ledger,*args,**kwargs)
        with Database(context[4]).transaction() as c:c.execute('UPDATE exact_receipt_observers SET active=false WHERE id=%s',(case.observer.observer_id,))
        return out
    monkeypatch.setattr(Ledger,'reserve_operation',changed)
    from workagent.responses_transport import TransportError
    with pytest.raises((DomainError,TransportError)):
        observe_once(case.s,case.receipt,case.observer,case.original_worker.transport)
    assert case.fake.calls==calls
