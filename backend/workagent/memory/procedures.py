"""Human-selected observed evidence; this module performs no candidate extraction."""
from ..errors import DomainError, deny
from .models import ProcedureEvidence, ProcedureEvidenceOption, ProcedureEvidencePage


def authorize(service, c, p, ws, scope_kind, scope_id, details, source_refs=()):
    if details is None:
        return
    from ..service import encoded
    if not c.execute('SELECT memory_procedure_sources_authorized(%s,%s,%s,%s,%s) AS ok',
        (ws, p.id, scope_kind, scope_id, encoded([r.model_dump(mode='json') for r in source_refs]))).fetchone()['ok']:
        deny()
    for evidence in details.evidence:
        service._memory_scope(c, p, ws, 'task', evidence.conversation_id)
        allowed = c.execute('SELECT memory_procedure_evidence_authorized(%s,%s,%s,%s,%s) AS ok',
            (ws, p.id, scope_kind, scope_id, encoded(evidence))).fetchone()['ok']
        if not allowed:
            deny()


def union_details(current, replacement):
    if replacement is None:
        return current
    if current is None:
        return replacement
    evidence = list(replacement.evidence)
    for ref in current.evidence:
        if ref not in evidence:
            evidence.append(ref)
    if len(evidence) > 16:
        raise DomainError('validation_error')
    return type(replacement).model_validate({**replacement.model_dump(), 'evidence': evidence})


def discover(service, c, p, ws, cid):
    from ..service import digest
    service._memory_scope(c, p, ws, 'task', cid)
    # The WHERE authorization executes before LIMIT; no inaccessible counts/excerpts.
    rows = c.execute('''SELECT kind,event_id,data,observed_at FROM (
      SELECT 'human_message' AS kind,m.id AS event_id,m.data,
        (m.data->>'created_at')::timestamptz AS observed_at
      FROM conversation_messages m WHERE m.workspace_id=%s AND m.conversation_id=%s
        AND m.author_kind='human'
      UNION ALL
      SELECT 'tool_observation',a.id,e.data,e.created_at
      FROM tool_attempts a JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
      JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation'
      WHERE a.workspace_id=%s AND r.conversation_id=%s
    ) candidates WHERE memory_procedure_evidence_authorized(%s,%s,'task',%s,
      jsonb_build_object('kind',kind,'conversation_id',%s::text,'event_id',event_id,'sha256',tool_json_hash(data)))
    ORDER BY observed_at DESC,event_id LIMIT 50''', (ws,cid,ws,cid,ws,p.id,cid,cid)).fetchall()
    options = []
    for row in rows:
        human = row['kind'] == 'human_message'
        outcome = 'human_statement' if human else row['data']['status']
        # A terminal observation is not proof of success. Do not accept a caller label.
        label = ('Human statement: ' + row['data']['text'][:200] if human else
                 'Tool observation: ' + row['data']['capability_id'] + ' — ' + outcome)
        operational = None if human else operational_outcome(row['data'])
        if operational is not None:
            label += ' · operation: ' + operational
        options.append(ProcedureEvidenceOption(evidence=ProcedureEvidence(kind=row['kind'],
            conversation_id=cid,event_id=row['event_id'],sha256=digest(row['data'])),
            label=label[:240],outcome=outcome,operational_outcome=operational,observed_at=row['observed_at']))
    return ProcedureEvidencePage(items=options)


def operational_outcome(observation):
    """Only typed adapter envelope statuses, never arbitrary tool/document text."""
    from typing import get_args
    known = set(get_args(get_args(ProcedureEvidenceOption.model_fields['operational_outcome'].annotation)[0]))
    output = observation.get('output')
    if not isinstance(output, dict):
        return None
    result = output.get('result')
    status = result.get('status') if isinstance(result, dict) else output.get('status')
    return status if isinstance(status, str) and status in known else None


def rollback(service, c, p, ws, old, command):
    from .models import MemoryRevisionV1
    row = c.execute('SELECT data FROM memory_revisions WHERE workspace_id=%s AND memory_id=%s AND id=%s',
                    (ws,old.memory_id,command.target_revision_id)).fetchone()
    if not row:
        deny()
    target = MemoryRevisionV1.model_validate(row['data'])
    if (target.kind != 'procedure' or target.status != 'active' or target.origin != 'human_reviewed'
        or target.reviewed_by_principal_id != p.id or target.procedure is None
        or target.exception_to_revision_id is not None or old.exception_to_revision_id is not None):
        raise DomainError('action_unresolved')
    refs = list(old.source_refs)
    for ref in target.source_refs:
        if ref not in refs:
            refs.append(ref)
    if len(refs) > 16:
        raise DomainError('validation_error')
    service._memory_sources(c,p,ws,refs)
    details = union_details(old.procedure,target.procedure)
    authorize(service,c,p,ws,old.scope_kind,old.scope_id,details,refs)
    return dict(content=target.content,content_sha256=target.content_sha256,
        applicability=target.applicability,confidence_basis=target.confidence_basis,
        procedure=details,source_refs=refs,status='active',origin='human_reviewed',
        reviewed_by_principal_id=p.id,confidence_label='inferred',
        valid_from=target.valid_from,valid_until=target.valid_until,expires_at=target.expires_at)
