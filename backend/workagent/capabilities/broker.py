"""One execution boundary; committed reservations/dispatches, no transaction over IO."""
import secrets
import time
from pydantic import ValidationError
from ..errors import DomainError, deny
from ..models import now
from ..service import canonical, digest, encoded
from . import policy, registry, observations
from .models import ToolCallV1, ToolObservationV1, ToolErrorV1, ToolCostV1, InputRef


class CapabilityBroker:
    def __init__(self,service,capability):
        self.service=service
        self.cap=capability

    def call(self,call):
        call=ToolCallV1.model_validate_json(call.model_dump_json()) if isinstance(call,ToolCallV1) else ToolCallV1.model_validate(call)
        adapter=registry.adapters().get(call.capability_id)
        if adapter is None:
            raise DomainError('unsupported_operation')
        request=adapter.input_model.model_validate(call.arguments,strict=True)
        # Never repair/coerce arguments into a different approved call.
        if request.model_dump(mode='json')!=call.arguments:
            raise DomainError('validation_error')
        secret=secrets.token_urlsafe(32)
        with self.service.db.transaction() as c:
            policy.authorize(self.service,c,self.cap,call,adapter)
            aid=c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s) AS id',
                (self.cap.workspace_id,self.cap.run_id,self.cap.fence,digest(self.cap.secret),encoded(call),digest(secret))).fetchone()['id']
        # A second current-authority check is immediately before dispatch. An
        # already dispatched attempt is never executed twice, even after a crash.
        with self.service.db.transaction() as c:
            policy.authorize(self.service,c,self.cap,call,adapter)
            prior=c.execute("SELECT e.data FROM tool_attempt_events e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.id=%s AND a.call=%s AND e.kind='observation'",(aid,encoded(call))).fetchone()
            if prior:
                return observations.observation(prior['data'])
            sent=c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s) AS sent',
                (aid,self.cap.fence,digest(self.cap.secret),secret)).fetchone()['sent']
            if not sent:
                prior=c.execute("SELECT data FROM tool_attempt_events WHERE attempt_id=%s AND kind='observation'",(aid,)).fetchone()
                if prior:
                    return observations.observation(prior['data'])
                raise DomainError('action_unresolved')
            input_hash=c.execute('SELECT scope_sha256 FROM tool_attempts WHERE id=%s',(aid,)).fetchone()['scope_sha256']
        start=now(); wall=time.monotonic_ns(); cpu=time.thread_time_ns()
        output=None; error=None; status='observed'
        try:
            result=(adapter.invoke_fenced(self.service,self.cap,request,call) if adapter.invoke_fenced
                    else adapter.invoke(self.service,self.cap,request))
            if isinstance(result,adapter.output_model):
                output=result.model_dump(mode='json')
            else:
                output=adapter.output_model.model_validate_json(canonical(result),strict=True).model_dump(mode='json')
            if len(canonical(output).encode())>adapter.descriptor.result_byte_limit:
                raise ValueError('bounded output required')
        except (ValidationError, ValueError):
            status='failed'; output=None; error=ToolErrorV1(code='invalid_output')
        except Exception:
            # No adapter exception text, token, host path or private source in logs.
            status='outcome_unknown'; output=None; error=ToolErrorV1(code='outcome_unknown')
        elapsed=(time.monotonic_ns()-wall)//1000000
        cpu_elapsed=(time.thread_time_ns()-cpu)//1000000
        if elapsed>adapter.descriptor.timeout_ms:
            status='outcome_unknown'; output=None; error=ToolErrorV1(code='outcome_unknown')
        d=adapter.descriptor
        obs=ToolObservationV1(call_id=call.call_id,attempt_id=aid,run_id=self.cap.run_id,
            capability_id=d.id,capability_version=d.version,implementation_sha256=d.implementation_sha256,
            execution_profile=d.execution_profile,input_refs=[InputRef(kind='run_scope',id=self.cap.run_id,
                version=str(call.expected_work_version),sha256=input_hash)],output_refs=[],
            output_sha256=digest(output) if output is not None else None,output=output,
            started_at=start,ended_at=now(),status=status,error=error,truncated=False,omissions=[],source_refs=[],
            privacy_label='workspace_private' if 'workspace_private' in d.privacy_classes else 'public',
            cost=ToolCostV1(category=d.cost_profile.category,unit=d.cost_profile.unit,
                reserved_units=d.cost_profile.reserved_units,reserved_cost_usd=d.cost_profile.reserved_cost_usd,
                observed_units=1 if status=='observed' else None,basis='estimated' if status=='observed' else 'unknown',
                elapsed_ms=elapsed,cpu_ms=cpu_elapsed))
        with self.service.db.transaction() as c:
            # Savepoint: a rejected check must not abort write-only cost retention.
            try:
                with c.transaction():
                    policy.authorize(self.service,c,self.cap,call,adapter)
            except DomainError:
                obs=obs.model_copy(update={'status':'cost_only','output':None,'output_sha256':None,
                    'error':ToolErrorV1(code='authority_changed')})
            result=c.execute('SELECT settle_tool_call(%s,%s,%s) AS observation',(aid,secret,encoded(obs))).fetchone()['observation']
        return observations.observation(result)


def execute_composition(service,cap,operation,phase):
    """Opt-in wrapper used by the existing receipt/staging loop, not a second loop.

    Absence of a grant means historical frozen execution. Presence (even revoked)
    means the new boundary MUST succeed; never fall back after a denial.
    """
    with service.db.transaction() as c:
        _,run,scope=service._check_capability(c,cap)
        bound=c.execute('SELECT 1 FROM tool_grants WHERE workspace_id=%s AND run_id=%s',
                        (cap.workspace_id,cap.run_id)).fetchone()
    if not bound:
        return registry.composition.execute_read(operation,service.conversation_worker_context(cap))
    name=registry.COMPOSITION_IDS.get(operation.kind)
    if not name:
        deny()
    from .file_adapters import FILE_OPERATIONS, input_refs
    refs=input_refs(operation) if isinstance(operation,FILE_OPERATIONS) else []
    call=ToolCallV1(call_id=phase,capability_id=name,capability_version=registry.adapters()[name].descriptor.version,
        arguments=operation.model_dump(mode='json'),input_refs=refs,expected_work_version=scope.work_version)
    observation=CapabilityBroker(service,cap).call(call)
    if observation.status!='observed':
        raise DomainError('action_unresolved')
    # Stage retains through the existing receipt and post-I/O fence, then the
    # existing checkpoint. Retained tool output is never itself publication.
    return observation.output
