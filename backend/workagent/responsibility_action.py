"""Receipt-bound local ownership, on canonical Assignment/lifecycle authority.

No public command nesting, provider call, grant creation or external connector.
The workspace/run fence, assignment and effect journal share one transaction.
"""
from typing import Literal
from pydantic import Field, ValidationError
from .errors import DomainError, deny
from .general_alpha_models import ResponsibilityMutationResult
from .general_schema import Closed
from .model_base import Id, Hash


class _Request(Closed):
    message_id: Id
    message_sha256: Hash


class _Binding(Closed):
    attempt_id: Id
    selection_request_sha256: Hash
    selection_response_id: Id
    decision_sha256: Hash
    operation_hash: Hash
    base_hash: Hash | None


class _Recording(Closed):
    run_id: Id
    attempt_id: Id
    phase: Literal['selection','selection_2','selection_3','selection_4','selection_5','selection_6','selection_7','selection_8']
    binding: _Binding
    request: _Request
    decision_sha256: Hash
    conversation_work_version: int = Field(ge=1)
    result: ResponsibilityMutationResult


RECORDING_REASON=('Local responsibility recorded; the outcome still needs validation. '
    'External inboxes are not monitored; no booking or message was sent. '
    'At each local check-in, the dispatcher rechecks the current grant, budget and saved plan before execution.')


def recording(c,run):
    row=c.execute("SELECT id,workspace_id,conversation_id,data,responsibility_lifecycle,responsibility_recording "
        "FROM assignments WHERE workspace_id=%s AND responsibility_recording->>'run_id'=%s",
        (run.workspace_id,run.id)).fetchone()
    if not row: return None
    saved=row['responsibility_recording']
    try:
        parsed=_Recording.model_validate(saved,strict=True)
        # Defaults in the public result DTO must not repair a malformed receipt.
        if parsed.model_dump(mode='json')!=saved:
            raise ValueError('incomplete recording')
        result=parsed.result
        if (parsed.run_id!=run.id or parsed.binding.attempt_id!=parsed.attempt_id
                or parsed.binding.operation_hash!=parsed.decision_sha256
                or row['workspace_id']!=run.workspace_id
                or result.conversation_id!=run.conversation_id or result.owner_id!=run.principal_id
                or row['id']!=result.assignment_id or row['data']['id']!=row['id']
                or row['conversation_id']!=result.conversation_id
                or row['data']['conversation_id']!=row['conversation_id']
                or row['data']['workspace_id']!=row['workspace_id']
                or row['data']['owner_id']!=result.owner_id
                or not isinstance(row['responsibility_lifecycle'],dict)):
            raise ValueError('detached recording')
    except (ValidationError,ValueError,KeyError,TypeError):
        raise DomainError('action_unresolved') from None
    return saved


def offer(c,run,cv,message,config):
    # Continuation authority comes from its own exact request/dependencies. An
    # unavailable human-only action must not add volatile unrelated artifacts to
    # the existing continuation context hash.
    if message.author_kind!='human' or config.get('responsibility'):
        return {'available':False}
    saved=recording(c,run)
    version=cv.work_version
    if saved:
        # Only our exact own mutation may change the original context version.
        # Neither another human edit nor pause/cancel is normalized away.
        row=c.execute('SELECT data,responsibility_lifecycle FROM assignments WHERE workspace_id=%s AND id=%s',
            (run.workspace_id,saved['result']['assignment_id'])).fetchone()
        if (cv.work_version!=saved['conversation_work_version']+1 or
                row['data']['work_version']!=saved['result']['work_version'] or
                row['responsibility_lifecycle']['state']!=saved['result']['state']):
            raise DomainError('version_conflict')
        version=saved['conversation_work_version']
    dependencies=[{'kind':'source_version','object_id':r.source_id,'expected_version':r.external_version}
                  for r in cv.selected_source_refs]
    dependencies += [{'kind':'artifact_revision','object_id':r['id'],'expected_version':r['current_revision_id']}
        for r in c.execute('SELECT id,current_revision_id FROM artifacts WHERE workspace_id=%s '
            'AND conversation_id=%s AND current_revision_id IS NOT NULL ORDER BY id LIMIT 50',
            (run.workspace_id,cv.id)).fetchall()]
    return {'available':message.author_kind=='human' and not config.get('responsibility'),
        'conversation_work_version':version,'dependencies':dependencies}


def authorize(service,c,p,run,cv,message,decision,config):
    from .composition import enabled
    from .adaptive import request_provenance
    from .service import digest
    if (not enabled(config) or config.get('responsibility') or message.author_kind!='human'
            or message.author_id!=p.id or cv.owner_id!=p.id or run.principal_id!=p.id):
        deny()
    allowed=offer(c,run,cv,message,config)
    if not allowed['available'] or cv.state!='open': deny()
    offered={(d['kind'],d['object_id'],d['expected_version']) for d in allowed['dependencies']}
    if any((d.kind,d.object_id,d.expected_version) not in offered for d in decision.plan.dependencies): deny()
    saved=recording(c,run)
    if saved and (saved['decision_sha256']!=digest(decision) or saved['request']!=request_provenance(message)):
        raise DomainError('command_conflict')
    return allowed,saved


def stage(service,c,cap,receipt,phase,resolved,ledger):
    """Called inside Products' first fenced transaction, never the pure path."""
    from .general_responses import check_pins
    from .adaptive import request_provenance, decision as selected, stage_metadata
    from .service import digest, encoded
    p,run,cv,operation,base,binding,origin=resolved
    config=check_pins(c,run)
    message=next(m for m in service._conversation_messages(c,run.workspace_id,cv.id)
                 if m.run_id==run.id and m.author_kind=='human')
    offered,saved=authorize(service,c,p,run,cv,message,operation,config)
    if saved:
        result=ResponsibilityMutationResult.model_validate(saved['result'])
    else:
        original_version=cv.work_version
        assignment=service._delegate_conversation(c,p,cv,offered['conversation_work_version'],
            operation.goal,operation.completion_criteria)
        detail=service._activate_responsibility(c,p,assignment,cv,operation.plan,assignment.work_version)
        result=ResponsibilityMutationResult(assignment_id=assignment.id,conversation_id=cv.id,owner_id=p.id,
            work_version=assignment.work_version,state=detail.lifecycle.state)
        saved={'run_id':run.id,'attempt_id':receipt.attempt_id,'phase':phase,'binding':binding,
            'request':request_provenance(message),'decision_sha256':digest(operation),
            'conversation_work_version':original_version,'result':result.model_dump(mode='json')}
        c.execute('UPDATE assignments SET responsibility_recording=%s WHERE workspace_id=%s AND id=%s',
            (encoded(saved),run.workspace_id,assignment.id))
    staged={'status':'reply','body':None,'file':None,'output':None,'binding':binding,
            'mutation_result':result.model_dump(mode='json')}
    staged.update(stage_metadata(c,ledger,phase,selected(c,ledger,phase,alpha=True),operation,
        staged,config['responses']['max_steps'],message,base,alpha=True))
    ledger.event(c,phase,'tool_result',staged)
    # Re-resolve the original immutable receipt after our own mutation, including
    # current exact target and all source/grant/lease checks. Failure rolls back.
    from .general_responses import resolve_selection
    if resolve_selection(service,c,cap,receipt,phase)[5]!=binding:
        raise DomainError('source_changed')
    return staged


def followthrough_evidence(observed,ref):
    """Describe a retained local result without upgrading source claims to truth."""
    from .service import digest
    if observed.get('binding',{}).get('operation_hash')!=ref.operation_hash:
        deny()
    if observed.get('status')=='observed' and observed.get('body') is not None:
        body=observed['body'];basis='observed_preparation_not_goal_verification'
    else:
        cap=observed.get('capability_result') or {}
        result=cap.get('result')
        kind=observed.get('decision',{}).get('kind')
        if (observed.get('status')!='reply' or not kind
                or cap.get('capability')!=kind or not isinstance(result,dict)):
            deny()
        if kind=='fetch_public_url':
            if (result.get('status') not in ('ok','error')
                    or result.get('trust')!='untrusted_external_content'):deny()
            basis='public_read_not_goal_verification'
        elif cap.get('version')=='1':
            # Prior receipt retention already checks the read's exact scope and
            # body. Citing it grants no new access and verifies no goal claim.
            basis='retained_read_not_goal_verification'
        else:deny()
        body=result
    return {'phase':ref.phase,'operation_hash':ref.operation_hash,
            'body_hash':digest(body),'basis':basis}


def authorize_advance(service,c,run,decision,config,ledger,phase):
    """A plan for this exact wake only, citing actual earlier local observations."""
    from .composition import continuity_enabled
    from .responsibility_execution import validate_binding
    from .models import now
    if not continuity_enabled(config) or not config.get('responsibility'):
        deny()
    validate_binding(c,run,config)
    binding=config['responsibility']
    if decision.expected_work_version!=binding['work_version']:
        raise DomainError('version_conflict')
    expected=[{'kind':d['kind'],'object_id':d['object_id'],'expected_version':d['observed_version']}
              for d in binding['observations']]
    if [d.model_dump(mode='json') for d in decision.plan.dependencies]!=expected:
        deny()  # No new data access, omitted dependencies or stale plan input.
    if decision.plan.next_action.kind=='request_decision' and (
            decision.plan.wait is None or decision.plan.wait.kind!='person'):
        raise DomainError('unsupported_operation')
    if decision.plan.next_action.kind=='await_event' and decision.plan.wait is None:
        raise DomainError('unsupported_operation')
    saved=ledger._events(c,phase).get('tool_result')
    if (not saved and decision.plan.next_check_in_at is not None
            and decision.plan.next_check_in_at<=now()):
        raise DomainError('unsupported_operation')
    evidence=[]
    for ref in decision.evidence:
        if ref.phase>=phase or any(x['phase']==ref.phase for x in evidence):
            deny()
        observed=ledger._events(c,ref.phase).get('tool_result',{})
        evidence.append(followthrough_evidence(observed,ref))
    return {'assignment_id':binding['assignment_id'],'work_version':binding['work_version'],
            'evidence':evidence,'status':'staged_until_settlement'}


def apply_advance(service,c,run,config):
    """Apply one retained plan after final publication, inside that transaction.

    The immutable run binding is checked before any plan/version/fence change,
    while the old run is still leased and its final publication is reconciled.
    No new run or provider action is admitted here; the canonical dispatcher owns
    the next wake. Stop/budget/unknown-effect outcomes never auto-resume a plan.
    """
    from .composition import AdvanceResponsibility, continuity_enabled
    from .responsibility_execution import validate_binding
    from .service import Principal, encoded
    from .models import now
    if not continuity_enabled(config) or not config.get('responsibility'):
        return False
    if run.state not in ('ready','partial') or run.stop_reason in ('budget_limit','blocked','waiting_for_user','step_limit'):
        return False
    row=c.execute("SELECT e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id "
        "WHERE a.workspace_id=%s AND a.run_id=%s AND a.data->>'state'='reconciled' "
        "AND e.kind='tool_result' AND e.data ? 'followthrough_result' ORDER BY e.phase DESC LIMIT 1",
        (run.workspace_id,run.id)).fetchone()
    if not row: return False
    validate_binding(c,run,config)
    staged=row['data']
    decision=AdvanceResponsibility.model_validate(staged['decision'])
    p=Principal(run.principal_id,'worker')
    a,cv=service._responsibility_assignment(c,p,run.workspace_id,config['responsibility']['assignment_id'])
    service._responsibility_cas(a,decision.expected_work_version)
    old=service._lifecycle(c,run.workspace_id,a.id)
    life=service._new_responsibility_plan(c,p,a,cv,decision.plan)
    life.outcome_status='evidenced_preparation'
    life.outcome_evidence={'run_id':run.id,'attempt_id':staged['binding']['attempt_id'],
                           'evidence':staged['followthrough_result']['evidence']}
    life.current_outcome=decision.plan.current_outcome
    service._retire_responsibility_wake(c,run.workspace_id,old)
    a.work_version+=1
    a.unresolved=['Preparation retained; continuing under the saved scoped plan.']
    service._queue_responsibility_wake(c,p,a,life)
    a.observed_at=now()
    c.execute('UPDATE assignments SET data=%s, responsibility_lifecycle=%s, responsibility_lease=NULL, '
              'responsibility_fence=responsibility_fence+1 WHERE workspace_id=%s AND id=%s',
              (encoded(a.model_dump(mode='json',exclude={'responsibility'})),encoded(life),run.workspace_id,a.id))
    service._event(c,p,run.workspace_id,'responsibility_advanced',a.id)
    return True
