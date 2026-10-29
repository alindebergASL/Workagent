"""Authenticated synthetic lifecycle with durable consumed-once transitions."""
import base64
from datetime import datetime, timezone
import os
from uuid import uuid4
from ..errors import DomainError, deny
from ..models import now
from . import oauth
from .models import AuthorizationFlow, ConnectorStatus, ConnectorPage
from .registry import configured, require_enabled, BASE, AUDIENCE


def vault():
    try:
        require_enabled()
        from .vault import Vault
        return Vault(os.environ['WORKAGENT_SYNTHETIC_VAULT_DIR'],os.environ['WORKAGENT_SYNTHETIC_VAULT_KEY_ID'],
                     base64.b64decode(os.environ['WORKAGENT_SYNTHETIC_VAULT_KEY'],validate=True))
    except (KeyError,ValueError):raise DomainError('source_unavailable') from None

def attest(statement,args):
    """Only the private lifecycle executor can attest exchange/provider results.

    The general application SQL role cannot fabricate these receipts. The
    executor has two guarded function grants, not table mutation or ownership.
    Its DSN is never projected to clients, models or tool subprocesses.
    """
    from ..db import Database
    dsn=os.environ.get('WORKAGENT_SYNTHETIC_LIFECYCLE_DATABASE_URL')
    if not dsn:raise DomainError('source_unavailable')
    with Database(dsn).transaction() as c:return c.execute(statement,args).fetchone()

def account(service,c,p,ws,cid):
    service._scope(c,p,ws,write=True)
    row=c.execute('SELECT * FROM connector_accounts WHERE workspace_id=%s AND principal_id=%s AND id=%s',(ws,p.id,cid)).fetchone()
    if not row:deny()
    return row

def projection(row):
    state=row['state'];reason=row['reason']
    if state!='revoked':
        if not configured():state='unavailable';reason='synthetic_fixture_not_configured'
        elif row['expires_at']<=now():state='expired';reason='synthetic_authorization_expired'
    return ConnectorStatus(connector_id=row['id'],state=state,access_generation=row['access_generation'],
        expires_at=row['expires_at'],provider_revocation=row['provider_revocation'],reason=reason)

def status(service,p,ws,cid):
    with service.db.transaction() as c:return projection(account(service,c,p,ws,cid))

def listing(service,p,ws):
    with service.db.transaction() as c:
        service._scope(c,p,ws,write=True)
        rows=c.execute('SELECT * FROM connector_accounts WHERE workspace_id=%s AND principal_id=%s ORDER BY id LIMIT 100',(ws,p.id)).fetchall()
        return ConnectorPage(items=[projection(r) for r in rows])

def start(service,p,ws,request):
    # Authorize before touching the secret service.
    with service.db.transaction() as c:service._scope(c,p,ws,write=True)
    v=vault();ref=v.put(oauth.new_flow());fid=str(uuid4())
    try:
        with service.db.transaction() as c:
            service._scope(c,p,ws,write=True)
            actual=c.execute('SELECT connector_start(%s,%s,%s,%s,%s) id',(ws,p.id,fid,request.idempotency_key,ref)).fetchone()['id']
            row=c.execute('SELECT expires_at FROM connector_auth_flows WHERE workspace_id=%s AND id=%s',(ws,actual)).fetchone()
    except Exception:
        v.remove(ref);raise
    if actual!=fid:v.remove(ref)
    return AuthorizationFlow(flow_id=actual,expires_at=row['expires_at'])

def complete(service,p,ws,fid,request):
    with service.db.transaction() as c:account(service,c,p,ws,fid)
    v=vault()
    with service.db.transaction() as c:
        account(service,c,p,ws,fid)
        flow=c.execute('SELECT * FROM connector_auth_flows WHERE workspace_id=%s AND id=%s AND principal_id=%s',(ws,fid,p.id)).fetchone()
        if not flow:deny()
        if flow['consumed'] and flow['complete_key']!=request.idempotency_key:raise DomainError('command_conflict')
        if not flow['consumed'] and flow['expires_at']<=now():raise DomainError('source_unavailable')
        ref=c.execute('SELECT connector_claim(%s,%s,%s,%s) ref',(ws,p.id,fid,request.idempotency_key)).fetchone()['ref']
    if ref is None:return status(service,p,ws,fid)
    token_ref=None;tokens=None;accepted=False
    try:
        secret,_=v.read(ref)
        tokens=oauth.exchange(secret)
        if (set(tokens)!= {'access_token','refresh_token','expires','issuer','audience'}
            or tokens['issuer']!=BASE or tokens['audience']!=AUDIENCE
            or not all(isinstance(tokens[k],str) and 20<=len(tokens[k])<=256 for k in ('access_token','refresh_token'))):
            raise ValueError('synthetic token binding')
        tokens['binding']={'workspace':ws,'principal':p.id,'connector':fid,'generation':1}
        token_ref=v.put(tokens)
        accepted=attest('SELECT connector_finish(%s,%s,%s,%s,%s,%s) ok',
            (ws,p.id,fid,request.idempotency_key,token_ref,datetime.fromtimestamp(tokens['expires'],timezone.utc)))['ok']
        if not accepted:v.remove(token_ref)
    except Exception:
        # The durable consumed record prevents blind exchange retry on uncertainty.
        if token_ref:v.remove(token_ref)
        return status(service,p,ws,fid)
    finally:
        v.remove(ref)
        if tokens and not accepted:
            # A revoke or scope loss can win while exchange is in flight. Delete
            # local material AND retire the newly minted provider token family.
            # Unknown provider cleanup stays failed/pending, never local access.
            try:oauth.post('/oauth/revoke',{k:tokens[k] for k in ('access_token','refresh_token')})
            except Exception:pass
    return status(service,p,ws,fid)

def authorized(service,p,ws,cid,generation):
    with service.db.transaction() as c:
        row=account(service,c,p,ws,cid)
        if row['state']!='connected' or row['access_generation']!=generation or row['expires_at']<=now():deny()
        require_enabled()
        return row['credential_ref']

def credential(service,p,ws,cid,generation):
    ref=authorized(service,p,ws,cid,generation)
    v=vault()
    def check():
        authorized(service,p,ws,cid,generation)
        current,_=v.read(ref)
        if current.get('binding')!={'workspace':ws,'principal':p.id,'connector':cid,'generation':generation}:deny()
    check()
    value=oauth.refresh(v,ref,check)
    return value['access_token']
