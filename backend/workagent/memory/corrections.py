"""Permanent supersession, finite exception, and monotonically narrower scopes."""
from hashlib import sha256
from ..errors import DomainError


def changes(service, c, p, ws, old, command):
    if old.status not in ('active', 'contested') and not (old.kind == 'procedure' and old.status == 'candidate'):
        raise DomainError('action_unresolved')
    from .procedures import union_details
    details = union_details(old.procedure, command.procedure)
    applicability = old.applicability if command.applicability is None else command.applicability
    if command.procedure is not None and old.kind != 'procedure':
        raise DomainError('validation_error')
    if old.kind == 'procedure' and (details is None or not (applicability or '').strip()
                                   or not (old.confidence_basis or '').strip()):
        raise DomainError('action_unresolved')
    # A correction cannot silently declassify derived evidence. New references
    # augment provenance; loss of any retained source still denies future recall.
    refs = list(old.source_refs)
    for ref in command.source_refs:
        if ref not in refs:
            refs.append(ref)
    if len(refs) > 16:
        raise DomainError('validation_error')
    service._memory_sources(c, p, ws, refs, scope_kind=old.scope_kind, scope_id=old.scope_id, memory_id=old.memory_id)
    result = dict(content=command.content, content_sha256=sha256(command.content.encode()).hexdigest(),
                  source_refs=refs, origin='human_reviewed', reviewed_by_principal_id=p.id,
                  status='active', confidence_label='inferred' if old.kind == 'procedure' else 'explicit',
                  procedure=details, applicability=applicability)
    if old.status == 'candidate':
        if command.mode != 'permanent':
            raise DomainError('action_unresolved')
        result.update(status='candidate',origin=old.origin,
            reviewed_by_principal_id=old.reviewed_by_principal_id,confidence_label=old.confidence_label)
    if command.mode == 'permanent' and old.exception_to_revision_id:
        base = c.execute('SELECT data FROM memory_revisions WHERE workspace_id=%s AND memory_id=%s AND id=%s',
                         (ws, old.memory_id, old.exception_to_revision_id)).fetchone()['data']
        result.update(valid_from=base['valid_from'], valid_until=base['valid_until'], expires_at=base['expires_at'])
    if command.mode == 'temporary':
        if old.exception_to_revision_id:
            raise DomainError('validation_error')
        result.update(valid_from=command.valid_from, valid_until=command.valid_until,
                      exception_to_revision_id=old.revision_id, supersedes_revision_id=None)
    return result


def can_narrow(c, p, ws, old, kind, sid):
    if old.scope_kind == 'user':
        return kind in ('task', 'work_area')
    if old.scope_kind == 'work_area' and kind == 'task':
        return sid == old.scope_id or c.execute('SELECT 1 FROM memory_scope_bindings '
            'WHERE workspace_id=%s AND owner_id=%s AND conversation_id=%s AND work_area_id=%s',
            (ws, p.id, sid, old.scope_id)).fetchone() is not None
    return False
