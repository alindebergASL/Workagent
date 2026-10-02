"""Trusted local managed-execution seam. NO HTTP, SDK, credentials or inference.

An attempt is permanently unique per run, including after failure. Dispatch permission
is a one-shot state transition, not a replayable command and not provider exactly-once.
Only a reviewed consumer may use it; provider receipts below are untrusted evidence.
"""
from datetime import timedelta
from pydantic import TypeAdapter
from .errors import DomainError, deny
from .models import (ProviderGrant, ProviderAttempt, ProviderResult, ExecutionProvenance,
                     Run, Hash, Id, now, new_id)


def _owner(c):
    from .runtime_config import BundleDenied
    if not c.execute("SELECT pg_get_userbyid(relowner)=current_user AS ok FROM pg_class WHERE oid='provider_grants'::regclass").fetchone()['ok']:
        raise BundleDenied('migration identity required')


def configure_grant(db, grant):
    """Operator only; scoped to one principal/workspace, <=10 runs and <=1 hour.

    Does not approve task effects, override source grants, or install a consumer.
    An expired/exhausted active grant blocks admission rather than falling back.
    """
    from .service import encoded
    from .runtime_config import BundleDenied
    grant=ProviderGrant.model_validate(grant)
    if not now() < grant.expires_at <= now()+timedelta(hours=1):
        raise BundleDenied('grant expiry must be within one hour')
    with db.transaction() as c:
        _owner(c)
        c.execute('SELECT id FROM workspaces WHERE id=%s FOR UPDATE',(grant.workspace_id,))
        c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,data) VALUES (%s,%s,%s,%s)',
                  (grant.id,grant.workspace_id,grant.principal_id,encoded(grant)))
    with db.transaction() as c:
        return ProviderGrant.model_validate(c.execute('SELECT data FROM provider_grants WHERE id=%s',(grant.id,)).fetchone()['data'])


def revoke_grant(db, grant_id):
    with db.transaction() as c:
        _owner(c)
        row=c.execute('SELECT workspace_id FROM provider_grants WHERE id=%s',(grant_id,)).fetchone()
        if not row:
            deny()
        c.execute('SELECT id FROM workspaces WHERE id=%s FOR UPDATE',(row['workspace_id'],))
        c.execute('UPDATE provider_grants SET active=false WHERE id=%s AND active',(grant_id,))
    with db.transaction() as c:
        return c.execute('SELECT active FROM provider_grants WHERE id=%s',(grant_id,)).fetchone()['active'] is False


def admission_grant(c, workspace_id, principal_id):
    row=c.execute('SELECT data FROM provider_grants WHERE workspace_id=%s AND principal_id=%s AND active',
                  (workspace_id,principal_id)).fetchone()
    if not row:
        return None
    grant=ProviderGrant.model_validate(row['data'])
    if grant.expires_at<=now():
        raise DomainError('action_unresolved')
    count=c.execute("SELECT count(*) AS n FROM run_configurations WHERE workspace_id=%s AND data->>'grant_id'=%s",(workspace_id,grant.id)).fetchone()['n']
    if count>=grant.max_runs:
        raise DomainError('budget_exhausted')
    return grant


def check_grant(c, run, config):
    row=c.execute('SELECT data,active FROM provider_grants WHERE id=%s',(config['grant_id'],)).fetchone()
    if not row or not row['active']:
        raise DomainError('action_unresolved')
    grant=ProviderGrant.model_validate(row['data'])
    if (grant.expires_at<=now() or grant.workspace_id!=run.workspace_id or
        grant.principal_id!=run.principal_id or grant.profile!=run.profile or
        config['model']!=grant.model or config['consumer_sha256']!=grant.consumer_sha256 or
        config['max_received_output_tokens']!=grant.max_received_output_tokens):
        raise DomainError('action_unresolved')
    return grant


def attempt_row(c, ws, run_id):
    row=c.execute('SELECT data FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,run_id)).fetchone()
    return ProviderAttempt.model_validate(row['data']) if row else None


class ProviderAttempts:
    """Methods mixed into the canonical Service; none are HTTP/model operations."""
    def _provider_authority(self,c,p,ws,run_id,continuation=True):
        generation=self._scope(c,p,ws,write=continuation)
        row=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',(ws,run_id)).fetchone()
        if not row:
            deny()
        run=Run.model_validate(row['data'])
        if run.principal_id!=p.id:
            deny()
        assignment=self._assignment(c,p,ws,run.assignment_id,versions=continuation)
        if continuation:
            self._runtime_pins(c,run)
            if generation!=run.access_generation:
                raise DomainError('source_changed')
            if assignment.state in ('paused','cancelled') or run.state=='cancelled':
                raise DomainError('action_unresolved')
        return run,assignment

    def get_provider_attempt(self,p,ws,run_id):
        with self.db.transaction() as c:
            self._provider_authority(c,p,ws,run_id,False)
            return attempt_row(c,ws,run_id)

    def _store_attempt(self,c,attempt):
        from .service import encoded
        c.execute('UPDATE provider_attempts SET data=%s WHERE workspace_id=%s AND run_id=%s',
                  (encoded(attempt),attempt.workspace_id,attempt.run_id))

    def prepare_provider_attempt(self,cap,*,request_hash,consumer_sha256):
        from .service import encoded
        from .runtime_config import check_pins
        request_hash=TypeAdapter(Hash).validate_python(request_hash)
        consumer_sha256=TypeAdapter(Hash).validate_python(consumer_sha256)
        with self.db.transaction() as c:
            p,run,a=self._check_capability(c,cap)
            if run.profile!='openai-agents-v1':
                raise DomainError('unsupported_operation')
            config=check_pins(c,run)
            if consumer_sha256!=config['consumer_sha256']:
                raise DomainError('unsupported_operation')
            previous=attempt_row(c,run.workspace_id,run.id)
            if previous:
                if previous.request_hash!=request_hash or previous.consumer_sha256!=consumer_sha256:
                    raise DomainError('command_conflict')
                return previous  # NOT permission to dispatch again.
            context=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
                              (run.workspace_id,run.id)).fetchone()
            if not context:
                raise DomainError('action_unresolved')
            attempt=ProviderAttempt(id=new_id(),workspace_id=run.workspace_id,run_id=run.id,
                principal_id=p.id,grant_id=config['grant_id'],profile=run.profile,model=config['model'],
                request_hash=request_hash,consumer_sha256=consumer_sha256,
                context_hash=context['data']['context_sha256'],fence=run.fence)
            c.execute('INSERT INTO provider_attempts(workspace_id,run_id,id,grant_id,data) VALUES (%s,%s,%s,%s,%s)',
                      (run.workspace_id,run.id,attempt.id,attempt.grant_id,encoded(attempt)))
            run.execution=ExecutionProvenance(mode='managed',profile=run.profile,model=attempt.model,
                                              grant_id=attempt.grant_id,attempt_id=attempt.id)
            self._store_run(c,run)
        return self.get_provider_attempt(p,run.workspace_id,run.id)

    def dispatch_provider_attempt(self,cap,attempt_id):
        """Commit BEFORE any send. Only the winning caller may send ONCE.

        Lost local return or lost provider outcome => read-only reconciliation, never
        repeat this transition/request. A prepared orphan also cannot be reclaimed.
        """
        with self.db.transaction() as c:
            p,run,a=self._check_capability(c,cap)
            attempt=attempt_row(c,run.workspace_id,run.id)
            if not attempt or attempt.id!=attempt_id or attempt.fence!=cap.fence or attempt.state!='prepared':
                raise DomainError('action_unresolved')
            attempt.state='dispatched'
            self._store_attempt(c,attempt)
        return self.get_provider_attempt(p,run.workspace_id,run.id)

    def mark_provider_unknown(self,p,ws,run_id):
        with self.db.transaction() as c:
            self._provider_authority(c,p,ws,run_id)
            attempt=attempt_row(c,ws,run_id)
            if not attempt or attempt.state not in ('dispatched','outcome_unknown'):
                raise DomainError('action_unresolved')
            if attempt.state=='dispatched':
                attempt.state='outcome_unknown'
                self._store_attempt(c,attempt)
        return self.get_provider_attempt(p,ws,run_id)

    def record_provider_identity(self,p,ws,run_id,*,provider_session_id,provider_turn_id=None):
        """Save received correlation IDs before a final result; IDs never authorize send."""
        provider_session_id=TypeAdapter(Id).validate_python(provider_session_id)
        if provider_turn_id is not None:
            provider_turn_id=TypeAdapter(Id).validate_python(provider_turn_id)
        with self.db.transaction() as c:
            run,a=self._provider_authority(c,p,ws,run_id)
            attempt=attempt_row(c,ws,run_id)
            if not attempt or attempt.state not in ('dispatched','outcome_unknown'):
                raise DomainError('action_unresolved')
            if ((attempt.provider_session_id and attempt.provider_session_id!=provider_session_id) or
                (attempt.provider_turn_id and provider_turn_id and attempt.provider_turn_id!=provider_turn_id)):
                raise DomainError('command_conflict')
            if attempt.provider_session_id!=provider_session_id or (provider_turn_id and attempt.provider_turn_id!=provider_turn_id):
                attempt.provider_session_id=provider_session_id
                attempt.provider_turn_id=provider_turn_id or attempt.provider_turn_id
                self._store_attempt(c,attempt)
                run.provider_session_id=attempt.provider_session_id; run.provider_turn_id=attempt.provider_turn_id
                self._store_run(c,run)
        return self.get_provider_attempt(p,ws,run_id)

    def record_provider_result(self,p,ws,run_id,result):
        """Trusted consumer supplies a sanitized received receipt; no domain commit.

        May be called after lease expiry on read-only provider reconciliation. It
        rechecks authority, immutable pins and grant; cannot create another attempt.
        """
        from .service import canonical, digest
        result=ProviderResult.model_validate(result)
        if len(canonical(result).encode())>256*1024:
            raise DomainError('validation_error')
        with self.db.transaction() as c:
            run,a=self._provider_authority(c,p,ws,run_id)
            attempt=attempt_row(c,ws,run_id)
            if not attempt or attempt.state not in ('dispatched','outcome_unknown','responded','reconciled'):
                raise DomainError('action_unresolved')
            if attempt.result_hash:
                if attempt.result_hash!=digest(result):
                    raise DomainError('command_conflict')
                return attempt
            if ((attempt.provider_session_id and attempt.provider_session_id!=result.provider_session_id) or
                (attempt.provider_turn_id and attempt.provider_turn_id!=result.provider_turn_id)):
                raise DomainError('command_conflict')
            attempt.state='responded'; attempt.result=result; attempt.result_hash=digest(result)
            attempt.provider_session_id=result.provider_session_id; attempt.provider_turn_id=result.provider_turn_id
            self._store_attempt(c,attempt)
            run.provider_session_id=result.provider_session_id; run.provider_turn_id=result.provider_turn_id
            run.execution.provider_observation='received'
            self._store_run(c,run)
        return self.get_provider_attempt(p,ws,run_id)

    def fail_provider_attempt(self,p,ws,run_id):
        """Abandon a definitely unsent prepared attempt; never reinterpret a timeout.

        Dispatched/unknown failures stay unresolved until a concrete provider
        contract supplies definitive evidence. No speculative failure classifier.
        """
        with self.db.transaction() as c:
            self._provider_authority(c,p,ws,run_id)
            attempt=attempt_row(c,ws,run_id)
            if not attempt or attempt.state!='prepared':
                raise DomainError('action_unresolved')
            attempt.state='failed'
            self._store_attempt(c,attempt)
        return self.get_provider_attempt(p,ws,run_id)

    def recover_provider_run(self,p,ws,run_id):
        """Fenced local result publication only; never another inference permission."""
        return self._claim_run(p,ws,run_id,received_result=True)

    def reconcile_provider_attempt(self,p,ws,run_id):
        """Bounded local readback and ACK only, no provider call or domain mutation."""
        from .outcomes import verify_run, acknowledge
        with self.db.transaction() as c:
            run,a=self._provider_authority(c,p,ws,run_id)
            attempt=attempt_row(c,ws,run_id)
            if not attempt or attempt.state not in ('responded','reconciled'):
                return False
            outcome=verify_run(self,c,p,a,run)
            if outcome.outcome_gate!='passed' or outcome.safety_gate!='passed':
                return False
            if attempt.state=='responded':
                attempt.state='reconciled'
                self._store_attempt(c,attempt)
            acknowledge(c,ws,run_id)
            return True
