"""Safe, scoped execution diagnostics. Heartbeat is liveness, never work authority."""
import json
import os
from pathlib import Path
import time
from typing import Literal
from datetime import datetime, timezone
from decimal import Decimal
from pydantic import AwareDatetime, Field
from .model_base import Model, Id

State = Literal['working','awaiting_provider','recovering','waiting_for_person','blocked','unavailable','idle','completed','cancelled']

class RunExecution(Model):
    run_id: Id
    state: State
    phase: str | None = Field(default=None, max_length=64, pattern=r'^[a-z0-9_-]+$')
    last_progress_at: AwareDatetime | None = None
    failure_category: Literal['unknown_external_outcome','invalid_response','authority_or_budget','internal_error','worker_unavailable','work_blocked'] | None = None

class ExecutionStatus(Model):
    workspace_id: Id
    state: State
    can_advance_authorized_work: bool
    checked_at: AwareDatetime
    last_progress_at: AwareDatetime | None = Field(default=None, description='Last verified dispatcher visit, not evidence of objective completion.')
    runs: list[RunExecution] = Field(description='Up to 40 most recent accessible conversation runs; not a complete history.')


def publish(path, workspace, grant_id, *, authorized, run_id=None, status=None):
    """Private atomic replacement; no payloads, exception strings, or credentials."""
    if not path:return
    target=Path(path)
    if not target.is_absolute() or '..' in target.parts or target.is_symlink():
        raise ValueError('invalid execution status path')
    from .general_responses import consumer_hash
    data={'workspace_id':workspace,'grant_id':grant_id,'pid':os.getpid(),
        'consumer_sha256':consumer_hash(),'at':time.time(),'authorized':bool(authorized),
        'run_id':run_id,'status':status}
    temp=target.with_suffix('.tmp')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as f:
        json.dump(data,f);f.flush();os.fsync(f.fileno())
    os.replace(temp,target)


def heartbeat(path, workspace):
    try:
        from .general_responses import consumer_hash
        target=Path(path)
        if target.is_symlink() or target.stat().st_mode & 0o077 or target.stat().st_size>8192:return None
        d=json.loads(target.read_text())
        if (d['workspace_id']!=workspace or not 0<=time.time()-d['at']<=120
            or d['consumer_sha256']!=consumer_hash() or type(d['pid']) is not int or d['pid']<=0):return None
        os.kill(d['pid'],0)
        return d
    except (OSError,ValueError,KeyError,TypeError):return None


def classify(run, steps, available, active_run=None, canonical_status=None):
    states={s.state for s in steps}
    if run.state=='cancelled':return 'cancelled',None
    if states & {'count_unknown','outcome_unknown'}:return 'blocked','unknown_external_outcome'
    if 'invalid' in states:return 'blocked','invalid_response'
    if run.state=='ready':return 'completed',None
    if run.state=='partial':
        if canonical_status in ('step_limit','budget_limit','authority_unavailable'):
            return 'blocked','authority_or_budget'
        if canonical_status in ('blocked','local_tool_rejected'):
            return 'blocked','work_blocked'
        return 'waiting_for_person',None
    if not available:return 'unavailable','worker_unavailable'
    if 'accepted' in states:return 'awaiting_provider',None
    if run.state=='running' and active_run!=run.id:return 'recovering',None
    return 'working',None


def admission_available(service,c,p,ws,grant):
    """Reuse read-only canonical admission checks; never insert a probe command."""
    from types import SimpleNamespace
    from .general_responses import admission
    from .errors import DomainError
    command=SimpleNamespace(attachments=[],target=None,acceptance_checks=None,operation=None)
    for cid in grant.responses.conversation_ids:
        try:
            cv=service._conversation(c,p,ws,cid)
            if cv.state!='open':continue
            selected=admission(service,c,p,ws,cv,command)
            if selected and selected.id==grant.id:return True
        except DomainError:
            continue
    return False


def read(service, p, ws, path):
    from .models import ProviderGrant, Run
    from .general_responses import validate_grant
    from .responses_ledger import observations, summary
    from .responses_transport import MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS, INPUT_RESERVATION_RATE, OUTPUT_RESERVATION_RATE
    from .errors import DomainError
    h=heartbeat(path,ws) if path else None
    checked=datetime.now(timezone.utc); available=False; capacity=False; rows=[]
    with service.db.transaction() as c:
        service._scope(c,p,ws)
        if h and h.get('authorized') is True and h.get('status')!='runtime_error':
            row=c.execute('SELECT data,active FROM provider_grants WHERE workspace_id=%s AND id=%s',(ws,h.get('grant_id'))).fetchone()
            if row and row['active'] and row['data']['principal_id']==p.id:
                grant=ProviderGrant.model_validate(row['data'])
                try:
                    from .responses_recovery import effective_expiry
                    validate_grant(grant,c)
                    expiry=effective_expiry(c,grant)
                    available=expiry is None or expiry>checked
                except DomainError:pass
                if available:
                    b=grant.responses
                    shared=summary(c,grant.id,shared=True)
                    usage=shared if getattr(b,'runtime_extension',None)=='general-alpha-v1' else summary(c,grant.id)
                    counts=usage['request_counts']
                    n=c.execute("SELECT count(*) n FROM run_configurations WHERE workspace_id=%s AND data->>'grant_id'=%s",(ws,grant.id)).fetchone()['n']
                    reserve=(MAX_INPUT_TOKENS*Decimal(INPUT_RESERVATION_RATE)+MAX_OUTPUT_TOKENS*Decimal(OUTPUT_RESERVATION_RATE))/1000000
                    dispatch_capacity=(counts['dispatch']<b.generation_limit
                        and usage['reserved_input_tokens']+MAX_INPUT_TOKENS<=b.input_limit
                        and usage['reserved_output_tokens']+MAX_OUTPUT_TOKENS<=b.output_limit
                        and Decimal(shared['reserved_cost_usd'])+reserve<=Decimal(b.cost_limit_usd))
                    count_capacity=counts['count_send']<b.count_limit
                    generation_capacity=dispatch_capacity and count_capacity
                    capacity=n<grant.max_runs and generation_capacity and admission_available(service,c,p,ws,grant)
        # Same human and conversation-owner boundary as canonical conversation reads.
        records=c.execute("""SELECT r.data,rc.data->>'grant_id' grant_id FROM runs r JOIN conversations cv ON cv.workspace_id=r.workspace_id AND cv.id=r.data->>'conversation_id'
            LEFT JOIN run_configurations rc ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id
            WHERE r.workspace_id=%s AND cv.data->>'owner_id'=%s
            ORDER BY r.data->>'created_at' DESC,r.id DESC LIMIT 40""",(ws,p.id)).fetchall()
        for record in records:
            run=Run.model_validate(record['data'])
            a=c.execute('SELECT id FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,run.id)).fetchone()
            steps=observations(c,a['id']) if a else []
            run_available=available and record['grant_id']==h.get('grant_id')
            from .products import turn_state
            from .responses_dispatcher import general_dispatch_status
            canonical_status=general_dispatch_status(run,turn_state(run,c)) if run.profile=='general-responses-v1' else None
            state,failure=classify(run,steps,run_available,h.get('run_id') if h else None,canonical_status)
            phase=steps[-1].phase if steps else None
            progress=c.execute('SELECT max(created_at) at FROM responses_events WHERE attempt_id=%s',(a['id'],)).fetchone()['at'] if a else run.observed_at
            # Evaluate the next durable operation, not an imaginary new request.
            if run_available and state not in ('blocked','completed','cancelled','waiting_for_person'):
                last=steps[-1].state if steps else 'prepared'
                capacity=capacity or (
                    (last=='accepted' and counts['read']<b.read_limit) or
                    (last=='counted' and dispatch_capacity) or
                    (last=='prepared' and generation_capacity) or
                    last=='received')  # Retained response can advance local work without I/O.
            if h and h.get('run_id')==run.id and h.get('status')=='internal_error' and state not in ('completed','cancelled'):
                state,failure='blocked','internal_error'
            rows.append(RunExecution(run_id=run.id,state=state,phase=phase,last_progress_at=progress,failure_category=failure))
    active=next((r.state for r in rows if r.state in ('working','recovering','awaiting_provider')),None)
    return ExecutionStatus(workspace_id=ws,state=(active or ('idle' if capacity else 'blocked')) if available else 'unavailable',
        can_advance_authorized_work=available and capacity,checked_at=checked,
        last_progress_at=datetime.fromtimestamp(h['at'],timezone.utc) if h else None,runs=rows)
