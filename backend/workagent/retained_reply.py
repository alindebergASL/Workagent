"""Owner-only application of an exact, already retained source-free reply.

Not a worker capability or an observer upgrade. Reuses canonical command CAS,
workspace locks, receipt authentication and publication records. No transport,
tool execution, grant activation, successor admission or generated explanation.
"""
from datetime import timedelta
from pydantic import AwareDatetime
from .models import Command, Hash, Run, ConversationMessage, TextResult, TurnResult, new_id, now
from .errors import DomainError, deny
from .service import digest
from .provider_attempts import _owner


class ApplyRetainedReply(Command):
    expected_run_sha256: Hash
    expected_context_sha256: Hash
    expected_configuration_sha256: Hash
    request_sha256: Hash
    result_sha256: Hash
    expected_work_version: int
    expires_at: AwareDatetime


def apply(service, principal, receipt, command):
    """Explicit finite owner command, scoped to original receipt and exact state.

    This deliberately supports only a first source-free ordinary Home reply.
    Source/tool/responsibility recovery must use its own compatible path, not
    silently acquire authority through this local application command.
    """
    from .responses_ledger import Ledger
    from .general_schema import GeneralDecision, Reply
    from .adaptive import enabled, decision as parse_decision
    from .composition import enabled as alpha_enabled, continuity_enabled
    command=ApplyRetainedReply.model_validate(command)
    def authorize(c):
        _owner(c)  # runtime/observation authority cannot mint this operation
        if not c.execute('SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0)) ok',
                ('receipt-observer:'+receipt.attempt_id,)).fetchone()['ok']:
            raise DomainError('action_unresolved')
        run,attempt,origin=service._receipt_binding(c,receipt)
        if principal.id!=run.principal_id or run.profile!='general-responses-v1':deny()
        generation=service._scope(c,principal,run.workspace_id,True)
        if generation!=run.access_generation:raise DomainError('source_changed')
        cv=service._owned_conversation(c,principal,run.workspace_id,run.conversation_id)
        if cv.state!='open':raise DomainError('action_unresolved')
        if not now()<command.expires_at<=now()+timedelta(hours=1):
            raise DomainError('action_unresolved')
        return run,attempt,origin,cv
    def mutate(c,authorized):
        run,attempt,origin,cv=authorized
        if digest(run)!=command.expected_run_sha256 or cv.work_version!=command.expected_work_version:
            raise DomainError('source_changed')
        if (run.state not in ('queued','running') or run.used_units>=run.budget_units
                or run.lease_expires_at and run.lease_expires_at>now()):
            raise DomainError('action_unresolved')
        config=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
            (run.workspace_id,run.id)).fetchone()['data']
        context=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
            (run.workspace_id,run.id)).fetchone()
        if (digest(config)!=command.expected_configuration_sha256 or not context
                or digest(context['data'])!=command.expected_context_sha256):
            raise DomainError('source_changed')
        messages=service._conversation_messages(c,run.workspace_id,cv.id)
        if (config.get('responsibility') or config.get('continuation') or cv.selected_source_refs
                or len(messages)!=1 or messages[0].run_id!=run.id or messages[0].author_kind!='human'
                or messages[0].target or messages[0].attachments or messages[0].document_refs
                or context['data'].get('source_manifest')
                or c.execute('SELECT 1 FROM artifacts WHERE workspace_id=%s AND conversation_id=%s',
                    (run.workspace_id,cv.id)).fetchone()
                or c.execute('SELECT 1 FROM runs WHERE workspace_id=%s AND conversation_id=%s AND id<>%s',
                    (run.workspace_id,cv.id,run.id)).fetchone()):
            raise DomainError('unsupported_operation')
        # Application cannot coexist with an executing grant/worker. Never
        # reactivate the original or move its request to a successor grant.
        grant=c.execute('SELECT active FROM provider_grants WHERE id=%s',(attempt.grant_id,)).fetchone()
        if not grant or grant['active'] or attempt.state=='failed':raise DomainError('action_unresolved')
        steps=c.execute('SELECT phase,request_sha256 FROM responses_steps WHERE attempt_id=%s',(attempt.id,)).fetchall()
        if len(steps)!=1 or steps[0]['phase']!='selection' or steps[0]['request_sha256']!=command.request_sha256:
            raise DomainError('command_conflict')
        ledger=Ledger(service,receipt);events=ledger._events(c,'selection')
        result=events.get('result',{});identity=events.get('identity',{})
        if (digest(result)!=command.result_sha256 or result.get('state')!='function_call'
                or result.get('request_sha256')!=command.request_sha256
                or result.get('response_id')!=identity.get('response_id')
                or result.get('metadata')!=identity.get('metadata')
                or result.get('provenance')!=identity.get('provenance')
                or not {'count_result','dispatch','identity','result'}<=events.keys()
                or any(k in events for k in ('tool_result','problem','cancel'))):
            raise DomainError('action_unresolved')
        decision=(parse_decision(c,ledger,'selection',alpha=alpha_enabled(config),
                    continuity=continuity_enabled(config)).decision if enabled(config)
                  else GeneralDecision.model_validate(result['value'],strict=True).decision)
        if not isinstance(decision,Reply):raise DomainError('unsupported_operation')
        text=decision.text
        message=ConversationMessage(id=new_id(),conversation_id=cv.id,run_id=run.id,sequence=2,
            author_id='general-responses-worker',author_kind='assistant',text=text,
            result=TurnResult(results=[TextResult(kind='text',text=text)],work_area=None),
            evidence_origin=origin,model_receipt=attempt.id)
        service._append_message(c,run.workspace_id,message)
        run.fence+=1;run.state='ready';run.used_units+=1;run.lease_expires_at=None
        run.execution.provider_observation='received';run.execution.evidence_origin=origin
        run.provider_session_id=result['response_id'];run.provider_turn_id=result['response_id']
        service._store_run(c,run)
        c.execute('UPDATE runs SET lease_hash=NULL WHERE workspace_id=%s AND id=%s',(run.workspace_id,run.id))
        attempt.state='reconciled';service._store_attempt(c,attempt)
        from .outcomes import acknowledge
        acknowledge(c,run.workspace_id,run.id)
        from .run_checkpoints import record
        record(service,c,run,cv,'selection','settlement')
        service._event(c,principal,run.workspace_id,'apply_retained_reply',run.id)
        return run
    return service._command(principal,receipt.workspace_id,'apply_retained_reply',
        {'run_id':receipt.run_id,'attempt_id':receipt.attempt_id},command,Run,authorize,mutate)
