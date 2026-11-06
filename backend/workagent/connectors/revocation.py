"""Local revocation commits first; provider outcomes never restore local access."""
from ..errors import DomainError
from . import service as lifecycle, oauth

def revoke(service,p,ws,cid,request):
    with service.db.transaction() as c:
        row=lifecycle.account(service,c,p,ws,cid)
        old=c.execute('SELECT * FROM connector_revocations WHERE workspace_id=%s AND principal_id=%s AND idempotency_key=%s',
                      (ws,p.id,request.idempotency_key)).fetchone()
        if old:
            if old['connector_id']!=cid or old['expected_generation']!=request.expected_generation:raise DomainError('command_conflict')
            return lifecycle.projection(row)
        if row['access_generation']!=request.expected_generation:raise DomainError('version_conflict')
        pending=c.execute('SELECT secret_ref FROM connector_auth_flows WHERE workspace_id=%s AND id=%s',(ws,cid)).fetchone()
        ref=c.execute('SELECT connector_revoke(%s,%s,%s,%s,%s) ref',
            (ws,p.id,cid,request.expected_generation,request.idempotency_key)).fetchone()['ref']
    # No app DB lock spans secret-service or provider I/O. On process death here,
    # local state remains revoked and provider state truthfully remains pending.
    result='failed';v=None;tokens=None
    try:
        v=lifecycle.vault()
        if ref:
            with v.refresh_lock(ref):
                try:tokens,_=v.read(ref)
                finally:v.remove(ref)
        if pending and pending['secret_ref']:v.remove(pending['secret_ref'])
        if tokens:
            out=oauth.post('/oauth/revoke',{'access_token':tokens['access_token'],'refresh_token':tokens['refresh_token']})
            if out=={'revoked':True}:result='revoked'
        else:
            # No token minted: no provider grant existed only for unconsumed flow.
            if row['reason']=='awaiting_synthetic_consent':result='revoked'
    except Exception:pass
    finally:
        if v and ref:v.remove(ref)
    lifecycle.attest('SELECT connector_revoke_result(%s,%s,%s,%s,%s)',(ws,p.id,cid,request.idempotency_key,result))
    return lifecycle.status(service,p,ws,cid)
