"""References at canonical transaction boundaries, never another execution ledger."""
from .checkpoint_models import CheckpointData, RunCheckpoint, StepReference
from .errors import DomainError
from .models import new_id, now


def record(service, c, run, cv, phase, kind):
    from .service import digest, encoded
    from .run_successors import scope_fingerprint, has_new_progress, latest_human_intent
    from .service import Principal
    from .general_responses import consumer_hash
    prior=c.execute('SELECT * FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s '
        'AND phase=%s AND checkpoint_kind=%s',(run.workspace_id,run.id,phase,kind)).fetchone()
    if prior:
        return read_row(prior)
    config=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
        (run.workspace_id,run.id)).fetchone()['data']
    binding=config.get('responsibility')
    assignment=(c.execute('SELECT data,responsibility_fence,responsibility_lifecycle FROM assignments '
        'WHERE workspace_id=%s AND id=%s',(run.workspace_id,binding['assignment_id'])).fetchone() if binding else None)
    messages=service._conversation_messages(c,run.workspace_id,cv.id)
    intent=next(m for m in messages if m.run_id==run.id and m.author_kind in ('human','system'))
    original=config.get('continuation',{}).get('intent_message_id')
    if original:
        intent=next(m for m in messages if m.id==original)
    intent_material=c.execute('SELECT data FROM conversation_messages WHERE workspace_id=%s AND conversation_id=%s AND id=%s',
        (run.workspace_id,cv.id,intent.id)).fetchone()['data']
    context=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
        (run.workspace_id,run.id)).fetchone()
    steps=[]; unknown=False
    for row in c.execute('SELECT s.* FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id '
            'WHERE a.workspace_id=%s AND a.run_id=%s ORDER BY s.phase',(run.workspace_id,run.id)).fetchall():
        events={e['kind']:e['data'] for e in c.execute('SELECT kind,data FROM responses_events '
            "WHERE attempt_id=%s AND phase=%s AND kind NOT IN ('read','cancel')",(row['attempt_id'],row['phase'])).fetchall()}
        result=events.get('result'); tool=events.get('tool_result')
        unknown |= ('count_send' in events and 'count_result' not in events or
                    'dispatch' in events and (not result or result.get('state') not in ('completed','function_call')))
        steps.append(StepReference(attempt_id=row['attempt_id'],phase=row['phase'],request_sha256=row['request_sha256'],
            response_id=events.get('identity',{}).get('response_id'),result_sha256=digest(result) if result else None,
            operation_hash=(tool or {}).get('binding',{}).get('operation_hash'),tool_result_sha256=digest(tool) if tool else None))
    waiting,action='none','resume_phase'
    if run.state in ('ready','partial'):
        action='continue_slice' if run.stop_reason=='step_limit' else 'settled'
        if action=='continue_slice' and not has_new_progress(c,run.workspace_id,run.id,config):
            waiting,action='blocked','await_person'
    if run.stop_reason in ('blocked','budget_limit'): waiting,action='blocked','await_person'
    if run.stop_reason=='waiting_for_user': waiting,action='person','await_person'
    life=assignment['responsibility_lifecycle'] if assignment else None
    if life and life['state'] in ('waiting_person','blocked','paused','taken_over','cancelled'):
        waiting,action=('person' if life['state']=='waiting_person' else 'blocked'),'await_person'
    elif life and life['state']=='waiting_event': waiting,action='event','await_event'
    if run.state=='cancelled': waiting,action='stopped','stopped'
    if unknown: waiting,action='unknown','reconcile'
    permitted=([intent.target.artifact_id] if intent.target else
        [d['object_id'] for d in binding['observations'] if d['kind']=='artifact_revision'] if binding else None)
    proposals=c.execute("SELECT p.id FROM proposals p JOIN artifacts a ON a.workspace_id=p.workspace_id AND a.id=p.artifact_id "
        "WHERE p.workspace_id=%s AND a.conversation_id=%s AND p.data->>'status'='pending' "
        "AND (%s::text[] IS NULL OR a.id=ANY(%s)) ORDER BY p.id LIMIT 100",
        (run.workspace_id,cv.id,permitted,permitted)).fetchall()
    data=CheckpointData(principal_id=run.principal_id,access_generation=run.access_generation,run_fence=run.fence,
        conversation_work_version=cv.work_version,assignment_work_version=assignment['data']['work_version'] if assignment else None,
        assignment_fence=assignment['responsibility_fence'] if assignment else None,configuration_sha256=digest(config),
        runtime_sha256=consumer_hash(),
        scope_fingerprint=scope_fingerprint(service,c,Principal(run.principal_id),run.workspace_id,cv,config,versions=kind!='stop'),
        context_sha256=digest(context['data']) if context else None,intent_message_id=intent.id,intent_sha256=digest(intent_material),
        latest_human_intent_id=latest_human_intent(c,run.workspace_id,cv.id),
        last_observed_phase=phase,steps=steps,pending_proposal_ids=[p['id'] for p in proposals],waiting=waiting,next_safe_action=action)
    checkpoint=RunCheckpoint(checkpoint_id=new_id(),workspace_id=run.workspace_id,run_id=run.id,conversation_id=cv.id,
        assignment_id=binding['assignment_id'] if binding else None,phase=phase,checkpoint_kind=kind,
        created_at=now(),checkpoint_hash=digest(data),data=data)
    c.execute('INSERT INTO run_checkpoints(workspace_id,checkpoint_id,run_id,conversation_id,assignment_id,phase,checkpoint_kind,created_at,checkpoint_hash,data) '
        'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',(run.workspace_id,checkpoint.checkpoint_id,run.id,cv.id,
        checkpoint.assignment_id,phase,kind,checkpoint.created_at,checkpoint.checkpoint_hash,encoded(data)))
    return checkpoint


def read_row(row):
    from .service import digest
    result=RunCheckpoint.model_validate(row)
    if digest(result.data)!=result.checkpoint_hash:
        raise DomainError('command_conflict')
    return result
