"""ACL-first bounded lexical recall. No embeddings, cache, or history extraction."""
import re
from collections import defaultdict
from ..errors import DomainError
from ..models import now
from .models import MemoryRevisionV1, RecalledMemory, MemoryPage, MemoryManifestEntry


def manifest(page):
    return [MemoryManifestEntry(memory_id=i.revision.memory_id, revision_id=i.revision.revision_id,
        content_sha256=i.revision.content_sha256, scope_kind=i.revision.scope_kind,
        scope_id=i.revision.scope_id, why=i.why, unresolved_conflict=i.unresolved_conflict)
        for i in page.items]


def in_time(rev, at):
    return (rev.valid_from <= at and (rev.valid_until is None or at < rev.valid_until)
            and (rev.expires_at is None or at < rev.expires_at))


def procedure_matches(revision, request_text):
    """Only adopted, unopposed procedures can guide autonomous work."""
    return (revision.status == 'active' and revision.origin == 'human_reviewed'
            and revision.reviewed_by_principal_id == revision.owner_id
            and procedure_relevant(revision, request_text))


def procedure_relevant(revision, request_text):
    """Relevance before conflict detection; a dispute need not be adopted."""
    details = revision.procedure
    if details is None:
        return False
    text = request_text.casefold()
    def matches(term):
        return re.search(r'(?<!\w)' + re.escape(term.casefold()) + r'(?!\w)', text) is not None
    return not any(matches(t) for t in details.excluded_terms) and any(matches(t) for t in details.retrieval_terms)


class MemoryRetrieval:
    def _recall_memory(self, c, p, ws, cid, *, query='', kind=None, status=None,
                       subject_key=None, predicate_key=None, at=None, autonomous=False, human_request=''):
        at = at or now()
        cv = self._memory_scope(c, p, ws, 'task', cid)
        areas = {cid} if cv.work_area is not None else set()
        for binding in c.execute('SELECT work_area_id FROM memory_scope_bindings WHERE workspace_id=%s '
                                 'AND conversation_id=%s AND owner_id=%s', (ws, cid, p.id)):
            try:
                self._memory_scope(c, p, ws, 'work_area', binding['work_area_id'])
            except DomainError:
                continue
            areas.add(binding['work_area_id'])
        # Scope eligibility precedes any query, rank, count, excerpt or omission.
        rows = c.execute('SELECT r.data FROM memory_items i JOIN memory_revisions r ON '
            'r.workspace_id=i.workspace_id AND r.memory_id=i.id AND r.id=i.current_revision_id '
            'WHERE i.workspace_id=%s AND i.owner_id=%s AND '
            "((r.data->>'scope_kind'='task' AND r.data->>'scope_id'=%s) OR "
            "(r.data->>'scope_kind'='work_area' AND r.data->>'scope_id'=ANY(%s)) OR "
            "(r.data->>'scope_kind'='user' AND r.data->>'scope_id'=%s)) ORDER BY i.id",
            (ws, p.id, cid, sorted(areas), p.id)).fetchall()
        eligible = []
        for row in rows:
            rev = MemoryRevisionV1.model_validate(row['data'])
            if rev.status == 'forgotten':
                continue
            if rev.exception_to_revision_id and rev.status in ('active', 'contested') and not in_time(rev, at):
                base = c.execute('SELECT data FROM memory_revisions WHERE workspace_id=%s AND memory_id=%s AND id=%s',
                                 (ws, rev.memory_id, rev.exception_to_revision_id)).fetchone()
                if not base:
                    continue
                rev = MemoryRevisionV1.model_validate(base['data'])
            if not in_time(rev, at):
                if status != 'expired' or (rev.valid_until is None or at < rev.valid_until) and (rev.expires_at is None or at < rev.expires_at):
                    continue
                rev = rev.model_copy(update={'status':'expired'})
            try:
                self._memory_scope(c, p, ws, rev.scope_kind, rev.scope_id)
                self._memory_sources(c, p, ws, rev.source_refs)
                self._memory_procedure(c, p, ws, rev.scope_kind, rev.scope_id, rev.procedure, rev.source_refs)
            except DomainError:
                continue
            if autonomous and rev.kind == 'procedure' and not procedure_relevant(rev, human_request):
                continue
            why = {'task':'task', 'work_area':'explicit_work_area_binding', 'user':'owner_preference'}[rev.scope_kind]
            eligible.append(RecalledMemory(revision=rev, why=why))
        # Independent conflicting statements remain together as uncertainty. No newest-wins.
        groups = defaultdict(list)
        for item in eligible:
            r = item.revision
            if r.status in ('active', 'contested'):
                groups[(r.subject_key, r.predicate_key)].append(item)
        from ..service import digest
        for key, items in groups.items():
            conflict = len({i.revision.content_sha256 for i in items}) > 1 or any(i.revision.status == 'contested' for i in items)
            if conflict:
                group = digest({'workspace':ws, 'owner':p.id, 'key':key})
                for item in items:
                    item.unresolved_conflict = True
                    item.revision = item.revision.model_copy(update={'status':'contested', 'contradiction_group_id':group})
        if autonomous:
            # Conflicting procedures cannot become autonomous instructions.
            eligible = [i for i in eligible if i.revision.kind != 'procedure' or
                        (not i.unresolved_conflict and procedure_matches(i.revision, human_request))]
        tokens = set(re.findall(r'\w+', query.casefold()))
        selected = []
        for item in eligible:
            r = item.revision
            if (r.status not in ((status,) if status else ('active', 'contested')) or
                (kind and r.kind != kind) or (subject_key and r.subject_key != subject_key) or
                (predicate_key and r.predicate_key != predicate_key)):
                continue
            words = set(re.findall(r'\w+', ' '.join((r.content or '', r.subject_key or '', r.predicate_key or '')).casefold()))
            score = len(tokens & words)
            if tokens and not score:
                continue
            selected.append((score, item))
        selected.sort(key=lambda pair: (-pair[0], pair[1].revision.memory_id))
        # A lexical hit on one conflicting value brings its eligible siblings.
        # Never truncate a dispute into an apparently unopposed assertion.
        batches, seen = [], set()
        for _, item in selected:
            r = item.revision
            if r.memory_id in seen:
                continue
            batch = [i for i in groups[(r.subject_key, r.predicate_key)] if i in eligible] if item.unresolved_conflict else [item]
            batches.append(batch)
            seen.update(i.revision.memory_id for i in batch)
        result, chars, omitted = [], 0, False
        for batch in batches:
            size = sum(len(i.revision.content or '') + len(i.revision.applicability or '') +
                       len(i.revision.confidence_basis or '') +
                       (len(i.revision.procedure.model_dump_json()) if i.revision.procedure else 0) for i in batch)
            if len(result) + len(batch) > 12 or chars + size > 6000:
                omitted = True
                continue
            result.extend(batch)
            chars += size
        return MemoryPage(items=result, has_more=omitted)

    def list_memory(self, p, ws, cid, **filters):
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            return self._recall_memory(c, p, ws, cid, **filters)
