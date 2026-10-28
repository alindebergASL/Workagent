"""Exact-ID, receipt-only recovery after execution grant revocation.

This is an explicit operator path, not dispatcher admission. It cannot prepare,
count, generate, execute tools, publish, resume a run or mint execution authority.
"""
from dataclasses import asdict
from hashlib import sha256
from pathlib import Path
from .errors import DomainError
from .models import new_id
from .service import encoded
from .responses_ledger import Ledger, ExactObservationAuthority, parsed_data


def observer_hash():
    from .general_responses import consumer_hash
    return sha256(Path(__file__).read_bytes()+consumer_hash().encode()).hexdigest()


def install(admin, *, observer_id, receipt, principal, phase, response_id,
            request_sha256, expires_at, read_limit):
    """Owner DB only; exact binding is checked inside the install transaction."""
    with admin.transaction() as c:
        row=c.execute('''SELECT a.workspace_id,r.data,g.data grant_data,
            s.request_sha256 FROM provider_attempts a
            JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
            JOIN provider_grants g ON g.id=a.grant_id
            JOIN responses_steps s ON s.attempt_id=a.id AND s.phase=%s WHERE a.id=%s''',
            (phase,receipt.attempt_id)).fetchone()
        if not row or row['data']['principal_id']!=principal.id or row['request_sha256']!=request_sha256:
            raise DomainError('not_found_or_not_authorized')
        b=row['grant_data']['responses']
        route={k:b[k] for k in ('transport_mode','project_id','secret_reference')}
        c.execute('''INSERT INTO exact_receipt_observers VALUES
            (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true)''',
            (observer_id,receipt.attempt_id,phase,row['workspace_id'],principal.id,
             row['data']['access_generation'],response_id,request_sha256,encoded(route),
             observer_hash(),expires_at,read_limit))
        if not c.execute('SELECT exact_receipt_observation_permits(%s,%s,%s) p',
                         (observer_id,receipt.attempt_id,phase)).fetchone()['p']:
            raise DomainError('not_found_or_not_authorized')
    return ExactObservationAuthority(principal,observer_id,phase)


def observe_once(service, receipt, authority, transport, *, boundary_check=None):
    """One reserved GET; existing terminal receipt makes restart a no-op.

    The session advisory lock spans reservation, GET and retention. It does not
    keep a product-state transaction open across network I/O. Retention after a
    concurrent revoke/expiry is permitted, exactly as for ordinary late receipts.
    """
    if type(authority) is not ExactObservationAuthority:
        raise DomainError('not_found_or_not_authorized')
    ledger=Ledger(service,receipt)
    with service.db.transaction() as lock:
        locked=lock.execute('SELECT pg_try_advisory_lock(hashtextextended(%s,0)) ok',
                            ('receipt-observer:'+receipt.attempt_id,)).fetchone()['ok']
        lock.commit()
        if not locked:return {'status':'busy','http_requests':0}
        try:
            def fresh():
                request,events=ledger.snapshot(authority.phase,authority)
                with service.db.transaction() as c:
                    row=c.execute('SELECT * FROM exact_receipt_observers WHERE id=%s',
                                  (authority.observer_id,)).fetchone()
                b=row['route_binding']
                if (not transport.matches_binding(b['transport_mode'],b['project_id'],b['secret_reference'])
                    or events['identity']['provenance']!=asdict(transport.provenance)
                    or request.sha256!=row['request_sha256']
                    or events['identity']['response_id']!=row['response_id']):
                    raise DomainError('not_found_or_not_authorized')
                if boundary_check is not None:boundary_check()
                return request,events,row
            request,events,row=fresh()
            if 'result' in events:return {'status':'already_retained','http_requests':0,'state':events['result']['state']}
            ledger.reserve_operation(request,'read',authority)
            def before_send(http_request):
                _,current,binding=fresh()
                if ('result' in current or http_request.method!='GET'
                    or http_request.url.path!='/v1/responses/'+binding['response_id']
                    or str(http_request.url).split('/v1/')[0]!=transport.provenance.origin):
                    raise DomainError('not_found_or_not_authorized')
            hooks=transport._client.event_hooks.get('request',[])
            transport._client.event_hooks['request']=[*hooks,before_send]
            try:response=transport.retrieve(row['response_id'],request=request)
            finally:transport._client.event_hooks['request']=hooks
            if response.state in ('queued','in_progress'):
                return {'status':'pending','http_requests':1,'state':response.state}
            ledger.retain(request,'result',parsed_data(response))
            return {'status':'retained','http_requests':1,'state':response.state,
                    'response_id':response.response_id,'usage':asdict(response.usage) if response.usage else None}
        finally:
            lock.execute('SELECT pg_advisory_unlock(hashtextextended(%s,0))',
                         ('receipt-observer:'+receipt.attempt_id,))
