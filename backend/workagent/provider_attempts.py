"""Trusted local managed-execution seam. NO HTTP, SDK, credentials or inference.

An attempt is permanently unique per run, including after failure. Dispatch permission
is a one-shot state transition, not a replayable command and not provider exactly-once.
Only a reviewed consumer may use it; provider receipts below are untrusted evidence.
"""
from datetime import timedelta
from dataclasses import dataclass, field
import secrets
from pydantic import TypeAdapter
from .errors import DomainError, deny
from .models import (ProviderGrant, ProviderAttempt, ProviderResult, ExecutionProvenance,
                     Run, Assignment, Hash, Id, now, new_id)


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
        config['max_received_output_tokens']!=grant.max_received_output_tokens or
        (grant.responses is not None and config.get('responses')!=grant.responses.model_dump(mode='json'))):
        raise DomainError('action_unresolved')
    return grant


def attempt_row(c, ws, run_id):
    row=c.execute('SELECT data FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,run_id)).fetchone()
    return ProviderAttempt.model_validate(row['data']) if row else None


@dataclass(frozen=True)
class ReceiptCapability:
    """Consumer credential for write-only retention/settlement, not reads or sends.

    Persist privately before dispatch. The original immutable secret binding
    survives lease/grant revocation; possession is not publication authority.
    """
    workspace_id: str
    run_id: str
    principal_id: str
    attempt_id: str
    request_hash: str
    consumer_sha256: str
    fence: int
    secret: str = field(repr=False)


def _receipt_secret(cap):
    # One-way domain separation is essential: a retained receipt credential must
    # not be cast back into a WorkerCapability with publication/send authority.
    from .service import digest
    return digest({'purpose':'provider-receipt-retention-v1','lease_secret':cap.secret})


class ProviderAttempts:
    """Methods mixed into the canonical Service; none are HTTP/model operations."""
    def _provider_read_authority(self,c,p,ws,run_id):
        self._scope(c,p,ws)
        row=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',(ws,run_id)).fetchone()
        if not row:
            deny()
        run=Run.model_validate(row['data'])
        if run.principal_id!=p.id:
            deny()
        self._assignment(c,p,ws,run.assignment_id)  # Recheck every selected source.

    def get_provider_attempt(self,p,ws,run_id):
        with self.db.transaction() as c:
            self._provider_read_authority(c,p,ws,run_id)
            return attempt_row(c,ws,run_id)

    def _store_attempt(self,c,attempt):
        from .service import encoded
        c.execute('UPDATE provider_attempts SET data=%s WHERE workspace_id=%s AND run_id=%s',
                  (encoded(attempt),attempt.workspace_id,attempt.run_id))

    def prepare_provider_attempt(self,cap,*,request_hash,consumer_sha256,evidence_origin='unverified',transport=None):
        from .service import encoded, digest
        from .runtime_config import check_pins
        request_hash=TypeAdapter(Hash).validate_python(request_hash)
        consumer_sha256=TypeAdapter(Hash).validate_python(consumer_sha256)
        # Trusted concrete transport selects the receipt origin before dispatch;
        # model output or a received label can never establish live provenance.
        from .responses_transport import ResponsesTransport
        official=(type(transport) is ResponsesTransport and
                  transport.matches_binding('official_api',transport.project_id,transport.credential_reference))
        if evidence_origin not in ('unverified','synthetic_provider_receipt') and not (evidence_origin=='live_provider_receipt' and official):
            raise DomainError('unsupported_operation')
        with self.db.transaction() as c:
            p,run,a=self._check_capability(c,cap)
            if run.profile not in ('openai-agents-v1','openai-responses-v1'):
                raise DomainError('unsupported_operation')
            config=check_pins(c,run)
            if run.profile=='openai-responses-v1':
                binding=config['responses']
                if (type(transport) is not ResponsesTransport or
                    not transport.matches_binding(binding['transport_mode'],binding['project_id'],binding['secret_reference']) or
                    evidence_origin!=('live_provider_receipt' if binding['transport_mode']=='official_api' else 'synthetic_provider_receipt')):
                    raise DomainError('unsupported_operation')
            elif evidence_origin=='live_provider_receipt':
                raise DomainError('unsupported_operation')
            if consumer_sha256!=config['consumer_sha256']:
                raise DomainError('unsupported_operation')
            previous=attempt_row(c,run.workspace_id,run.id)
            if previous:
                origin=c.execute('SELECT evidence_origin FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',
                                 (run.workspace_id,run.id)).fetchone()['evidence_origin']
                if previous.request_hash!=request_hash or previous.consumer_sha256!=consumer_sha256 or origin!=evidence_origin:
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
            c.execute('INSERT INTO provider_attempts(workspace_id,run_id,id,grant_id,data,receipt_key_hash,evidence_origin) VALUES (%s,%s,%s,%s,%s,%s,%s)',
                      (run.workspace_id,run.id,attempt.id,attempt.grant_id,encoded(attempt),digest(_receipt_secret(cap)),evidence_origin))
            run.execution=ExecutionProvenance(mode='managed',profile=run.profile,model=attempt.model,
                                              grant_id=attempt.grant_id,attempt_id=attempt.id)
            self._store_run(c,run)
        return self.get_provider_attempt(p,run.workspace_id,run.id)

    def bind_provider_receipt(self,cap,attempt_id):
        """Bind with original live lease BEFORE dispatch; no human/recovery bypass."""
        with self.db.transaction() as c:
            p,run,a=self._check_capability(c,cap)
            attempt=attempt_row(c,run.workspace_id,run.id)
            if not attempt or attempt.id!=attempt_id or attempt.state!='prepared':
                raise DomainError('action_unresolved')
            bound=ReceiptCapability(run.workspace_id,run.id,p.id,attempt.id,
                                    attempt.request_hash,attempt.consumer_sha256,cap.fence,_receipt_secret(cap))
            self._receipt_binding(c,bound)
            return bound

    def _receipt_binding(self,c,cap):
        """Authenticate exact immutable identity, NOT current continuation.

        Used only by write-only retention and terminal settlement. Human reads
        still require current membership and selected-source authorization.
        """
        from .service import digest
        if not isinstance(cap,ReceiptCapability):
            deny()
        c.execute('SELECT id FROM workspaces WHERE id=%s FOR UPDATE',(cap.workspace_id,))
        row=c.execute('SELECT * FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',
                      (cap.workspace_id,cap.run_id)).fetchone()
        if not row:
            deny()
        attempt=ProviderAttempt.model_validate(row['data'])
        if (attempt.id!=cap.attempt_id or attempt.principal_id!=cap.principal_id or
            attempt.request_hash!=cap.request_hash or attempt.consumer_sha256!=cap.consumer_sha256 or
            attempt.fence!=cap.fence or
            not secrets.compare_digest(row['receipt_key_hash'] or '',digest(cap.secret))):
            deny()
        run=Run.model_validate(c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',
                                        (cap.workspace_id,cap.run_id)).fetchone()['data'])
        if run.principal_id!=cap.principal_id:
            deny()
        return run,attempt,row['evidence_origin']

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

    def mark_provider_unknown(self,receipt_cap):
        with self.db.transaction() as c:
            run,attempt,origin=self._receipt_binding(c,receipt_cap)
            if attempt.state not in ('dispatched','outcome_unknown'):
                raise DomainError('action_unresolved')
            if attempt.state=='dispatched':
                attempt.state='outcome_unknown'
                self._store_attempt(c,attempt)
        return True

    def record_provider_identity(self,receipt_cap,*,provider_session_id,provider_turn_id=None):
        """Write-only correlation retention; IDs never authorize send or readback."""
        provider_session_id=TypeAdapter(Id).validate_python(provider_session_id)
        if provider_turn_id is not None:
            provider_turn_id=TypeAdapter(Id).validate_python(provider_turn_id)
        with self.db.transaction() as c:
            run,attempt,origin=self._receipt_binding(c,receipt_cap)
            if attempt.state not in ('dispatched','outcome_unknown'):
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
        return True

    def record_provider_result(self,receipt_cap,result):
        """Retain incurred usage after expiry/revocation/control changes.

        The immutable pre-dispatch consumer capability is required. Returns only a
        boolean ACK: no source read, stored content, send, publication or new lease.
        """
        from .service import canonical, digest
        result=ProviderResult.model_validate(result)
        if len(canonical(result).encode())>256*1024:
            raise DomainError('validation_error')
        with self.db.transaction() as c:
            run,attempt,origin=self._receipt_binding(c,receipt_cap)
            if attempt.state not in ('dispatched','outcome_unknown','responded','reconciled'):
                raise DomainError('action_unresolved')
            if attempt.result_hash:
                if attempt.result_hash!=digest(result):
                    raise DomainError('command_conflict')
                return True
            if ((attempt.provider_session_id and attempt.provider_session_id!=result.provider_session_id) or
                (attempt.provider_turn_id and attempt.provider_turn_id!=result.provider_turn_id)):
                raise DomainError('command_conflict')
            if run.profile=='openai-responses-v1':
                from .responses_schema import NextAction,to_body
                rows=c.execute("SELECT phase,kind,data FROM responses_events WHERE attempt_id=%s AND kind IN ('result','tool_result')",(attempt.id,)).fetchall()
                evidence={(r['phase'],r['kind']):r['data'] for r in rows}
                selection=evidence.get(('selection','result'),{})
                final=evidence.get(('final','result'),{})
                tool=evidence.get(('selection','tool_result'))
                if selection.get('state')!='function_call' or final.get('state')!='completed' or not tool:
                    raise DomainError('action_unresolved')
                expected_body=to_body(NextAction.model_validate(final['value'],strict=True),tool,attempt.id)
                if (result.bodies!=[expected_body] or result.unresolved or
                    result.provider_session_id!=final['response_id'] or result.provider_turn_id!=final['response_id'] or
                    result.usage.input_tokens!=selection['usage']['input_tokens']+final['usage']['input_tokens'] or
                    result.usage.output_tokens!=selection['usage']['output_tokens']+final['usage']['output_tokens']):
                    raise DomainError('command_conflict')
            attempt.state='responded'; attempt.result=result; attempt.result_hash=digest(result)
            attempt.provider_session_id=result.provider_session_id; attempt.provider_turn_id=result.provider_turn_id
            self._store_attempt(c,attempt)
            run.provider_session_id=result.provider_session_id; run.provider_turn_id=result.provider_turn_id
            run.execution.provider_observation='received'
            run.execution.evidence_origin=origin
            self._store_run(c,run)
        return True

    def fail_provider_attempt(self,receipt_cap):
        """Atomically abandon ONLY a definitely unsent prepared attempt.

        Never reinterpret a dispatched timeout. Revocation/pause/expiry do not
        prevent safe cleanup, but the original immutable consumer binding is needed.
        """
        from .service import encoded
        from .outcomes import acknowledge
        with self.db.transaction() as c:
            run,attempt,origin=self._receipt_binding(c,receipt_cap)
            ws,run_id=run.workspace_id,run.id
            if attempt.state=='failed':
                return True
            if attempt.state!='prepared':
                raise DomainError('action_unresolved')
            attempt.state='failed'
            c.execute("UPDATE provider_attempts SET data=%s,abandonment_reason='unsent_abandoned' WHERE workspace_id=%s AND run_id=%s",
                      (encoded(attempt),ws,run_id))
            run.state='partial'; run.fence+=1; run.lease_expires_at=None
            run.unresolved=['The prepared attempt was abandoned before dispatch; no provider send occurred.']
            self._store_run(c,run)
            c.execute('UPDATE runs SET lease_hash=NULL WHERE workspace_id=%s AND id=%s',(ws,run_id))
            a=Assignment.model_validate(c.execute('SELECT data FROM assignments WHERE workspace_id=%s AND id=%s',
                                                 (ws,run.assignment_id)).fetchone()['data'])
            control=a.state if a.state in ('paused','cancelled') else None
            self._refresh_progress(c,a)
            if control:
                a.state=control
            a.work_version+=1
            self._store_assignment(c,a)
            acknowledge(c,ws,run_id)
        return True

    def recover_provider_run(self,p,ws,run_id):
        """Fenced local result publication only; never another inference permission."""
        return self._claim_run(p,ws,run_id,received_result=True)

    def reconcile_provider_attempt(self,receipt_cap):
        """Exact historical document readback/ACK, even after authority revocation.

        Only a boolean escapes this trusted capability path; not a private read API.
        It never sends, publishes, approves, restores access or renews a lease.
        """
        from .outcomes import verify_document, acknowledge
        with self.db.transaction() as c:
            run,attempt,origin=self._receipt_binding(c,receipt_cap)
            ws,run_id=run.workspace_id,run.id
            if attempt.state not in ('responded','reconciled'):
                return False
            a=Assignment.model_validate(c.execute('SELECT data FROM assignments WHERE workspace_id=%s AND id=%s',
                                                 (ws,run.assignment_id)).fetchone()['data'])
            outcome=verify_document(c,a,run)
            if outcome.outcome_gate!='passed':
                return False
            if attempt.state=='responded':
                attempt.state='reconciled'
                self._store_attempt(c,attempt)
            acknowledge(c,ws,run_id)
            return True
