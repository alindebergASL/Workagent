"""Transactional memory service. Payloads live only in erasable revision rows."""
from hashlib import sha256
from ..errors import DomainError, deny
from ..models import now, new_id
from .models import (MemoryRevisionV1, MemoryReceipt, MemoryInspection, MemoryScopeBinding,
                     MemoryUsagePage, MemoryUsage)


def content_hash(value):
    return sha256(value.encode()).hexdigest()


def receipt(revision):
    return MemoryReceipt(memory_id=revision.memory_id, revision_id=revision.revision_id, status=revision.status)


class MemoryStore:
    def _memory_procedure(self, c, p, ws, kind, sid, details, source_refs=()):
        from .procedures import authorize
        authorize(self, c, p, ws, kind, sid, details, source_refs)

    def memory_lesson_evidence(self, p, ws, cid):
        from .procedures import discover
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            return discover(self, c, p, ws, cid)

    def _memory_scope(self, c, p, ws, kind, sid):
        if kind == 'user':
            if sid != p.id:
                deny()
            return None
        cv = self._document_scope(c, p, ws, sid)
        # _document_scope checks availability/ACL; exact versions are required too.
        for ref in cv.selected_source_refs:
            self._source(c, p, ws, ref, True)
        if kind == 'work_area' and cv.work_area is None:
            deny()
        return cv

    def _memory_sources(self, c, p, ws, refs):
        for source in refs:
            if source.source_type == 'source':
                row = self._source(c, p, ws, source.ref, True)
                if row['data']['observed_at'] != source.ref.model_dump(mode='json')['observed_at']:
                    # Compare typed datetimes rather than ISO spelling.
                    from ..models import Source
                    if Source.model_validate(row['data']).observed_at != source.ref.observed_at:
                        raise DomainError('source_changed')
            else:
                _, actual, _, _ = self._file_version(c, p, ws, source.ref.workspace_file_id, source.ref.version_id)
                if actual != source.ref:
                    raise DomainError('source_changed')

    def _memory_item(self, c, p, ws, mid, *, sources=True):
        row = c.execute('SELECT r.data FROM memory_items i JOIN memory_revisions r ON '
            'r.workspace_id=i.workspace_id AND r.memory_id=i.id AND r.id=i.current_revision_id '
            'WHERE i.workspace_id=%s AND i.id=%s AND i.owner_id=%s', (ws, mid, p.id)).fetchone()
        if not row:
            deny()
        revision = MemoryRevisionV1.model_validate(row['data'])
        if sources and revision.status != 'forgotten':
            self._memory_scope(c, p, ws, revision.scope_kind, revision.scope_id)
        if sources and revision.status != 'forgotten':
            self._memory_sources(c, p, ws, revision.source_refs)
            self._memory_procedure(c, p, ws, revision.scope_kind, revision.scope_id, revision.procedure, revision.source_refs)
        return revision

    def _memory_append(self, c, p, ws, operation, revision, expected=None, target=None):
        from ..service import encoded, digest
        fingerprints = [digest(ref.model_dump(mode='json')) for ref in revision.source_refs]
        if revision.procedure:
            evidence_fingerprints = [digest(ref.model_dump(mode='json')) for ref in revision.procedure.evidence]
            if c.execute('SELECT 1 FROM memory_tombstones WHERE workspace_id=%s AND owner_id=%s '
                         'AND source_fingerprint=ANY(%s) LIMIT 1', (ws,p.id,evidence_fingerprints)).fetchone():
                raise DomainError('action_unresolved')
            fingerprints += evidence_fingerprints
        suppressed = c.execute('SELECT 1 FROM memory_tombstones WHERE workspace_id=%s AND owner_id=%s '
            'AND scope_kind=%s AND scope_id=%s AND (key_sha256=%s OR source_fingerprint=ANY(%s)) LIMIT 1',
            (ws, p.id, revision.scope_kind, revision.scope_id,
             digest([revision.subject_key, revision.predicate_key]), fingerprints)).fetchone()
        if suppressed:
            raise DomainError('action_unresolved')
        if operation == 'rollback':
            c.execute('SELECT rollback_memory_revision(%s,%s,%s,%s,%s)',
                      (ws, p.id, expected, encoded(revision), target))
        else:
            c.execute('SELECT write_memory_revision(%s,%s,%s,%s,%s)',
                      (ws, p.id, operation, expected, encoded(revision)))
        return receipt(revision)

    def _memory_create(self, p, ws, cmd, *, candidate):
        def authorize(c):
            self._memory_scope(c, p, ws, cmd.scope_kind, cmd.scope_id)
            self._memory_sources(c, p, ws, cmd.source_refs)
            self._memory_procedure(c, p, ws, cmd.scope_kind, cmd.scope_id, cmd.procedure, cmd.source_refs)
        def mutate(c, _):
            timestamp = now()
            if cmd.valid_until and cmd.valid_until <= (cmd.valid_from or timestamp):
                raise DomainError('validation_error')
            revision = MemoryRevisionV1(memory_id=new_id(), revision_id=new_id(), workspace_id=ws,
                owner_id=p.id, kind=cmd.kind, scope_kind=cmd.scope_kind, scope_id=cmd.scope_id,
                subject_key=cmd.subject_key, predicate_key=cmd.predicate_key, content=cmd.content,
                content_sha256=content_hash(cmd.content), status='candidate' if candidate or cmd.kind == 'procedure' else 'active',
                origin='agent_inferred' if candidate else 'human_explicit', source_refs=cmd.source_refs,
                confidence_label='inferred' if candidate else 'explicit', confidence_basis=cmd.confidence_basis,
                valid_from=cmd.valid_from or timestamp, valid_until=cmd.valid_until, expires_at=cmd.expires_at,
                recorded_at=timestamp, applicability=cmd.applicability, procedure=cmd.procedure,
                access_generation=self._scope(c, p, ws))
            return self._memory_append(c, p, ws, 'candidate' if candidate else 'remember', revision)
        return self._command(p, ws, 'memory_candidate' if candidate else 'memory_remember', {}, cmd,
                             MemoryReceipt, authorize, mutate)

    def remember_memory(self, p, ws, cmd):
        return self._memory_create(p, ws, cmd, candidate=False)

    def propose_memory(self, p, ws, cmd):
        return self._memory_create(p, ws, cmd, candidate=True)

    def _memory_mutate(self, p, ws, mid, cmd, operation):
        def authorize(c):
            # Forget/expire remain possible after the evidence itself is revoked.
            return self._memory_item(c, p, ws, mid, sources=operation not in ('forget', 'expire'))
        def mutate(c, old):
            if old.revision_id != cmd.expected_revision_id:
                raise DomainError('version_conflict')
            if old.status == 'forgotten':
                raise DomainError('action_unresolved')
            if operation == 'forget':
                from .forget import erase
                return erase(c, p, ws, old)
            changes = dict(revision_id=new_id(), recorded_at=now(), supersedes_revision_id=old.revision_id,
                           exception_to_revision_id=None, access_generation=self._scope(c, p, ws))
            if operation == 'review':
                from .review import changes as review_changes
                changes.update(review_changes(old, cmd, p))
            elif operation == 'correct':
                from .corrections import changes as correction_changes
                changes.update(correction_changes(self, c, p, ws, old, cmd))
            elif operation == 'rollback':
                from .procedures import rollback
                changes.update(rollback(self, c, p, ws, old, cmd))
            elif operation == 'narrow':
                if old.exception_to_revision_id:
                    raise DomainError('action_unresolved')
                self._memory_scope(c, p, ws, cmd.scope_kind, cmd.scope_id)
                if not self._memory_can_narrow(c, p, ws, old, cmd.scope_kind, cmd.scope_id):
                    deny()
                changes.update(scope_kind=cmd.scope_kind, scope_id=cmd.scope_id)
            elif operation == 'expire':
                changes.update(status='expired', expires_at=now())
            revision = MemoryRevisionV1.model_validate({**old.model_dump(), **changes})
            if operation != 'expire':
                self._memory_procedure(c, p, ws, revision.scope_kind, revision.scope_id, revision.procedure, revision.source_refs)
            return self._memory_append(c, p, ws, operation, revision, old.revision_id,
                                       getattr(cmd, 'target_revision_id', None))
        return self._command(p, ws, 'memory_' + operation, {'memory_id':mid}, cmd,
                             MemoryReceipt, authorize, mutate)

    def review_memory(self, p, ws, mid, cmd):
        return self._memory_mutate(p, ws, mid, cmd, 'review')

    def correct_memory(self, p, ws, mid, cmd):
        return self._memory_mutate(p, ws, mid, cmd, 'correct')

    def rollback_memory(self, p, ws, mid, cmd):
        return self._memory_mutate(p, ws, mid, cmd, 'rollback')

    def narrow_memory(self, p, ws, mid, cmd):
        return self._memory_mutate(p, ws, mid, cmd, 'narrow')

    def expire_memory(self, p, ws, mid, cmd):
        return self._memory_mutate(p, ws, mid, cmd, 'expire')

    def forget_memory(self, p, ws, mid, cmd):
        return self._memory_mutate(p, ws, mid, cmd, 'forget')

    def _memory_can_narrow(self, c, p, ws, old, kind, sid):
        from .corrections import can_narrow
        return can_narrow(c, p, ws, old, kind, sid)

    def memory_scope_binding(self, p, ws, cid):
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            cv = self._memory_scope(c, p, ws, 'task', cid)
            row = c.execute('SELECT work_area_id FROM memory_scope_bindings WHERE workspace_id=%s '
                'AND owner_id=%s AND conversation_id=%s', (ws, p.id, cid)).fetchone()
            if not row:
                return None
            self._memory_scope(c, p, ws, 'work_area', row['work_area_id'])
            return MemoryScopeBinding(conversation_id=cid, work_area_id=row['work_area_id'], work_version=cv.work_version)

    def bind_memory_scope(self, p, ws, cmd):
        def authorize(c):
            cv = self._memory_scope(c, p, ws, 'task', cmd.conversation_id)
            self._memory_scope(c, p, ws, 'work_area', cmd.work_area_id)
            return cv
        def mutate(c, cv):
            self._conversation_cas(cv, cmd.expected_work_version)
            if c.execute('SELECT 1 FROM memory_scope_bindings WHERE workspace_id=%s AND conversation_id=%s', (ws, cv.id)).fetchone():
                raise DomainError('action_unresolved')
            version = c.execute('SELECT bind_memory_scope(%s,%s,%s,%s,%s) AS version',
                (ws, p.id, cv.id, cmd.work_area_id, cmd.expected_work_version)).fetchone()['version']
            return MemoryScopeBinding(conversation_id=cv.id, work_area_id=cmd.work_area_id, work_version=version)
        return self._command(p, ws, 'bind_memory_scope', {}, cmd, MemoryScopeBinding, authorize, mutate)

    def inspect_memory(self, p, ws, mid):
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            current = self._memory_item(c, p, ws, mid)
            revisions = []
            for row in c.execute('SELECT data FROM memory_revisions WHERE workspace_id=%s AND memory_id=%s ORDER BY recorded_at,id', (ws, mid)):
                rev = MemoryRevisionV1.model_validate(row['data'])
                try:
                    self._memory_scope(c, p, ws, rev.scope_kind, rev.scope_id)
                    self._memory_sources(c, p, ws, rev.source_refs)
                    self._memory_procedure(c, p, ws, rev.scope_kind, rev.scope_id, rev.procedure, rev.source_refs)
                except DomainError:
                    continue
                revisions.append(rev)
            from types import SimpleNamespace
            from .procedures import rollback
            rollback_ids = []
            if current.status != 'forgotten':
                for rev in revisions:
                    if rev.revision_id == current.revision_id:
                        continue
                    try:
                        rollback(self, c, p, ws, current, SimpleNamespace(target_revision_id=rev.revision_id))
                    except DomainError:
                        continue
                    rollback_ids.append(rev.revision_id)
            superseded = {r.supersedes_revision_id for r in revisions if r.supersedes_revision_id}
            revisions = [r.model_copy(update={'status':'superseded'})
                if r.revision_id in superseded and r.status != 'forgotten' else r for r in revisions]
            return MemoryInspection(current=current, revisions=revisions, rollback_revision_ids=rollback_ids)

    def memory_usage(self, p, ws, rid):
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            row = c.execute('SELECT conversation_id FROM runs WHERE workspace_id=%s AND id=%s AND data->>\'principal_id\'=%s',
                            (ws, rid, p.id)).fetchone()
            if not row:
                deny()
            self._memory_scope(c, p, ws, 'task', row['conversation_id'])
            return MemoryUsagePage(items=[MemoryUsage.model_validate(r['data']) for r in c.execute(
                'SELECT data FROM memory_usage WHERE workspace_id=%s AND run_id=%s ORDER BY request_id', (ws, rid))])
