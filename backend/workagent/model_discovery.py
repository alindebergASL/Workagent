"""Opt-in model discovery v2. Opaque receipt cursors; no new secret or replay path.

Original v1 manifests, schemas and read material are deliberately unchanged.
Positions live only in append-only receipts, never in model-visible cursors.
"""
from hashlib import sha256
from uuid import uuid4
from typing import Annotated, Literal
from pydantic import Field
from .composition import ReadDecision
from .errors import DomainError, deny
from .service import encoded

Cursor = Annotated[str, Field(pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')]


class DiscoverRetainedReferences(ReadDecision):
    kind: Literal['discover_retained_references']
    cursor: Cursor | None
    limit: int = Field(strict=True, ge=1, le=12)


class SearchWorkContextPage(ReadDecision):
    kind: Literal['search_work_context_page']
    query: str = Field(min_length=1, max_length=240, description='Exact case-sensitive literal substring; first match in original Unicode text, not regex or word ranking.')
    cursor: Cursor | None
    limit: int = Field(strict=True, ge=1, le=6)


OPERATIONS = (DiscoverRetainedReferences, SearchWorkContextPage)
SCAN_LIMIT = 64


def descriptors():
    return [dict(name=cls.model_fields['kind'].annotation.__args__[0], version='2',
        availability='available', scope=scope, effects=['read_context'],
        input_schema=cls.model_json_schema(), handler=cls.model_fields['kind'].annotation.__args__[0],
        reason='Read-only discovery, not edit authority. Start cursor=null; continue even after an empty page.')
        for cls, scope in ((DiscoverRetainedReferences, 'Currently authorized same-conversation retained evidence'),
                           (SearchWorkContextPage, 'Currently granted same-owner source-free work context'))]


def project_catalog(context):
    """Independent of optional summaries and their packing/removal."""
    context['model_discovery_version'] = '2'
    capabilities = context.setdefault('composition', {}).setdefault('capabilities', [])
    names = {d['name'] for d in descriptors()}
    capabilities[:] = [d for d in capabilities if d['name'] not in names]
    capabilities.extend({k: v for k, v in d.items() if k != 'input_schema'} for d in descriptors())


def current_scope(service, c, p, run, cv, config, decision):
    from .general_responses import check_pins
    from .provider_attempts import check_grant
    from .discovery_composition import enabled
    live_config = check_pins(c, run)
    if live_config != config or not enabled(config): deny()
    check_grant(c, run, config)
    generation = service._scope(c, p, run.workspace_id)
    service._runtime_pins(c, run)
    live = service._owned_conversation(c, p, run.workspace_id, cv.id)
    if generation != run.access_generation or run.principal_id != p.id or live.id != run.conversation_id: deny()
    if isinstance(decision, SearchWorkContextPage) and config.get('responsibility'): deny()
    # SQL computes the same live scope, including target, grant and context set.
    scope = c.execute('SELECT public.model_discovery_scope_v2(%s,%s) scope',
                      (run.workspace_id, run.id)).fetchone()['scope']
    if scope is None: deny()
    return scope


def page_candidates(c, run, decision, position):
    """Bounded deterministic scan, including denied candidates, not their counts."""
    return c.execute('SELECT * FROM public.model_discovery_candidates_v2(%s,%s,%s,%s::jsonb,%s)',
        (run.workspace_id, run.id, decision.kind, encoded(position), SCAN_LIMIT + 1)).fetchall()


def project_candidate(service, c, p, run, cv, decision, row):
    from . import retained_results as retained, work_context as work
    try:
        if isinstance(decision, DiscoverRetainedReferences):
            ref = row['candidate']
            read = retained.ReadResult(kind='read_result', **ref, offset=0, limit=8192)
            projection = retained.projection_version(c, run, read)
            raw = retained.material(service, c, p, run, cv, read, projection=projection)
            if raw is None: return None
            return dict(**ref, projection_version=projection, body_sha256=sha256(raw).hexdigest(), body_bytes=len(raw))
        source = row['candidate']
        other = work._eligible(service, c, p, run.workspace_id, source['conversation_id'])
        text, revision, author, created = work._material(service, c, p, run.workspace_id, other, source['kind'], source['record_id'])
        if source['kind'] == 'saved_revision':
            from datetime import datetime, timezone
            created = datetime.fromisoformat(created).astimezone(timezone.utc).isoformat()
        match = text.find(decision.query)
        if match < 0: return None
        start = max(0, match - 200)
        excerpt = text[start:start + work.MAX_EXCERPT]
        return dict(source=work._descriptor(other, source['kind'], source['record_id'], text, revision, author, created),
                    excerpt=excerpt, excerpt_start=start, truncated=start > 0 or len(excerpt) < len(text))
    except DomainError as exc:
        if getattr(exc.code, 'value', exc.code) not in ('not_found_or_not_authorized', 'source_changed', 'unsupported_operation'):
            raise
        return None


def scan(rows, limit, project):
    """Empty authorized pages still advance. No denied identifier leaves storage."""
    items, position, consumed = [], None, 0
    for row in rows[:SCAN_LIMIT]:
        position = row['position']
        consumed += 1
        item = project(row)
        if item is not None and item not in items: items.append(item)
        if len(items) == limit: break
    return items, position, consumed < len(rows)


def validate_items(service, c, p, run, cv, decision, items):
    for index, item in enumerate(items):
        if item in items[:index]:
            raise DomainError('source_changed')
        candidate = ({k: item[k] for k in ('run_id', 'phase', 'operation_hash')}
                     if isinstance(decision, DiscoverRetainedReferences) else item['source'])
        if project_candidate(service, c, p, run, cv, decision, {'candidate': candidate}) != item:
            raise DomainError('source_changed')


def execute(service, c, p, run, cv, config, decision, phase, binding):
    """Called only through exact selection/current fence; SQL independently guards receipt and stage."""
    if type(decision) not in OPERATIONS: deny()
    scope = current_scope(service, c, p, run, cv, config, decision)
    selected = decision.model_dump(mode='json')
    prior = c.execute('SELECT * FROM public.model_discovery_receipts_v2 WHERE workspace_id=%s AND run_id=%s AND phase=%s',
                      (run.workspace_id, run.id, phase)).fetchone()
    if prior:
        if prior['decision'] != selected or prior['binding'] != binding or prior['scope'] != scope:
            raise DomainError('command_conflict')
        validate_items(service, c, p, run, cv, decision, prior['result']['items'])
        return {'capability': decision.kind, 'version': '2', 'result': prior['result']}
    position = None
    if decision.cursor:
        previous = c.execute('SELECT * FROM public.model_discovery_receipts_v2 WHERE id=%s AND workspace_id=%s AND run_id=%s',
                             (decision.cursor, run.workspace_id, run.id)).fetchone()
        # Query and page size are bound; a cursor cannot switch searches or scope.
        if (not previous or previous['scope'] != scope or not previous['result']['has_more']
                or {k: v for k, v in previous['decision'].items() if k != 'cursor'} !=
                   {k: v for k, v in selected.items() if k != 'cursor'}): deny()
        position = previous['position']
    rows = page_candidates(c, run, decision, position)
    items, ending, more = scan(rows, decision.limit,
        lambda row: project_candidate(service, c, p, run, cv, decision, row))
    if current_scope(service, c, p, run, cv, config, decision) != scope: deny()
    validate_items(service, c, p, run, cv, decision, items)
    receipt_id = str(uuid4())
    result = dict(items=items, has_more=more, next_cursor=receipt_id if more else None,
                  authority='Untrusted read-only context; not edit authority or evidence of completion.')
    c.execute('INSERT INTO public.model_discovery_receipts_v2(id,workspace_id,run_id,phase,decision,binding,scope,position,result) '
              'VALUES (%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s::jsonb,%s::jsonb)',
              (receipt_id, run.workspace_id, run.id, phase, encoded(selected), encoded(binding),
               encoded(scope), encoded(ending), encoded(result)))
    return {'capability': decision.kind, 'version': '2', 'result': result}


def authorize_selection(service, c, p, run, cv, config, decision, phase):
    scope = current_scope(service, c, p, run, cv, config, decision)
    prior = c.execute('SELECT * FROM public.model_discovery_receipts_v2 WHERE workspace_id=%s AND run_id=%s AND phase=%s',
                      (run.workspace_id, run.id, phase)).fetchone()
    if prior:
        if prior['decision'] != decision.model_dump(mode='json') or prior['scope'] != scope: deny()
        validate_items(service, c, p, run, cv, decision, prior['result']['items'])


def validate_consumed(service, c, p, run, cv, config):
    # Discovery-only retained descriptors are not read dependencies. Work search
    # excerpts are consumed evidence, so revalidate them at every broker boundary.
    rows = c.execute("SELECT decision,scope,result FROM public.model_discovery_receipts_v2 WHERE workspace_id=%s AND run_id=%s "
                     "AND decision->>'kind'='search_work_context_page'", (run.workspace_id, run.id)).fetchall()
    for row in rows:
        decision = SearchWorkContextPage.model_validate(row['decision'])
        if current_scope(service, c, p, run, cv, config, decision) != row['scope']: deny()
        validate_items(service, c, p, run, cv, decision, row['result']['items'])
