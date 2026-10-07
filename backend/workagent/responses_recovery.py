"""One explicitly reviewed successor of an immutable Responses root grant.

No runtime approval, grant replacement, counters, receipt import or new authority.
The optional one-hour local lease is operator approval, not a source access grant.
"""
from datetime import timedelta
from pydantic import AwareDatetime, Field
from .models import Model, Id, Hash, ProviderGrant, now
from .errors import DomainError
from .service import digest, encoded


class SuccessorApproval(Model):
    grant_id: Id
    original_consumer_sha256: Hash
    successor_consumer_sha256: Hash
    original_grant_sha256: Hash
    expires_at: AwareDatetime
    reason: str = Field(min_length=10,max_length=500)


def current_consumer_hash(profile):
    if profile=='general-responses-v1':
        from .general_responses import consumer_hash
    elif profile=='openai-responses-v1':
        from .responses_worker import consumer_hash
    else:
        raise DomainError('unsupported_operation')
    return consumer_hash()


def approved_successor(c,grant):
    if grant.profile not in ('openai-responses-v1','general-responses-v1'):return None
    row=c.execute('SELECT data FROM provider_consumer_successors WHERE grant_id=%s',(grant.id,)).fetchone()
    if not row:return None
    approval=SuccessorApproval.model_validate(row['data'])
    if (approval.grant_id!=grant.id or approval.original_grant_sha256!=digest(grant) or
        approval.original_consumer_sha256!=grant.consumer_sha256 or
        approval.successor_consumer_sha256!=current_consumer_hash(grant.profile) or approval.expires_at<=now()):
        return None
    return approval


def effective_expiry(c,grant):
    approval=approved_successor(c,grant)
    if grant.expires_at is None: return None
    return max(grant.expires_at,approval.expires_at) if approval else grant.expires_at


def install_successor(db,approval):
    """Owner-only immutable approval with exact committed readback. No key/network."""
    from .provider_attempts import _owner
    from .runtime_config import active_configuration, BundleDenied
    from .responses_worker import consumer_hash, validate_pins
    approval=SuccessorApproval.model_validate(approval)
    if not now()<approval.expires_at<=now()+timedelta(hours=1):
        raise BundleDenied('successor local lease must be within one hour')
    with db.transaction() as c:
        _owner(c)
        row=c.execute('SELECT data,active FROM provider_grants WHERE id=%s',(approval.grant_id,)).fetchone()
        if not row or not row['active']:raise BundleDenied('active original grant required')
        grant=ProviderGrant.model_validate(row['data'])
        c.execute('SELECT id FROM workspaces WHERE id=%s FOR UPDATE',(grant.workspace_id,))
        if (grant.profile not in ('openai-responses-v1','general-responses-v1') or approval.original_consumer_sha256!=grant.consumer_sha256 or
            approval.original_grant_sha256!=digest(grant) or approval.successor_consumer_sha256!=current_consumer_hash(grant.profile) or
            approval.successor_consumer_sha256==approval.original_consumer_sha256):
            raise BundleDenied('exact original grant and reviewed successor required')
        # Only a transient validation copy; immutable stored grant is NEVER updated.
        compatible=grant.model_copy(update={'consumer_sha256':approval.successor_consumer_sha256})
        if grant.profile=='general-responses-v1':
            from .general_responses import validate_grant
            validate_grant(compatible)
        else:
            _,config=active_configuration(c)
            validate_pins(compatible,config)
        existing=c.execute('SELECT data FROM provider_consumer_successors WHERE grant_id=%s',(grant.id,)).fetchone()
        if existing:
            if existing['data']!=approval.model_dump(mode='json'):raise BundleDenied('successor already fixed')
        else:
            c.execute('INSERT INTO provider_consumer_successors(grant_id,data) VALUES (%s,%s)',(grant.id,encoded(approval)))
    with db.transaction() as c:
        actual=SuccessorApproval.model_validate(c.execute('SELECT data FROM provider_consumer_successors WHERE grant_id=%s',(approval.grant_id,)).fetchone()['data'])
        if actual!=approval:raise BundleDenied('successor readback mismatch')
        return actual


def record_successor_use(service,receipt,cap):
    """Audit the actual binary without changing original run/request/receipt pins."""
    with service.db.transaction() as c:
        run,attempt,_=service._receipt_binding(c,receipt)
        _,current,_=service._check_capability(c,cap)
        if current.id!=run.id:raise DomainError('not_found_or_not_authorized')
        grant=ProviderGrant.model_validate(c.execute('SELECT data FROM provider_grants WHERE id=%s',(attempt.grant_id,)).fetchone()['data'])
        actual=current_consumer_hash(grant.profile)
        if actual==receipt.consumer_sha256:return
        if not approved_successor(c,grant):raise DomainError('action_unresolved')
        values=(attempt.id,grant.id,receipt.consumer_sha256,actual)
        c.execute('''INSERT INTO responses_consumer_uses(attempt_id,grant_id,original_consumer_sha256,actual_consumer_sha256)
                     VALUES (%s,%s,%s,%s) ON CONFLICT (attempt_id) DO NOTHING''',values)
        row=c.execute('SELECT attempt_id,grant_id,original_consumer_sha256,actual_consumer_sha256 FROM responses_consumer_uses WHERE attempt_id=%s',(attempt.id,)).fetchone()
        if tuple(row.values())!=values:raise DomainError('command_conflict')
