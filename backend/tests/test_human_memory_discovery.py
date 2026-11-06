"""Pure service/HTTP-contract tests. SQL-shaped fakes are NOT RLS/PG proof."""
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from workagent.errors import DomainError
from workagent.models import Request
from workagent.service import Principal, digest
from workagent.memory import api, retrieval
from workagent.memory.models import MemoryRevisionV1
from workagent.memory.retrieval import MemoryRetrieval
from workagent.memory.store import MemoryStore

AT = datetime(2026, 1, 1, tzinfo=timezone.utc)
P = Principal('person')


def revision(i, **changes):
    content = f'Value {i}'
    return MemoryRevisionV1(memory_id=f'm-{i:04}', revision_id=f'r-{i:04}',
        workspace_id='ws', owner_id=P.id, kind='fact', scope_kind='task', scope_id='cv',
        subject_key=f'subject-{i:04}', predicate_key='value', content=content,
        content_sha256=digest(content), status='active', origin='human_explicit',
        confidence_label='explicit', confidence_basis='Human statement', valid_from=AT,
        recorded_at=AT, applicability='', access_generation=1).model_copy(update=changes)


class Rows:
    def __init__(self, rows): self.rows = rows
    def __iter__(self): return iter(self.rows)
    def fetchall(self): return self.rows
    def fetchone(self): return next(iter(self.rows), None)


class Connection:
    def __init__(self):
        self.memories = []
        self.bases = {}
        self.events = []
        self.denied = set()
        self.sql = []

    def execute(self, sql, args):
        self.sql.append((sql, args))
        if 'memory_scope_bindings' in sql:
            return Rows([])
        if 'FROM memory_items' in sql:
            ws, owner, cid, areas, user = args
            return Rows([{'data': r.model_dump(mode='json')} for r in self.memories
                if r.workspace_id == ws and r.owner_id == owner and
                (r.scope_id == cid or r.scope_id in areas or r.scope_id == user)])
        if 'FROM memory_revisions' in sql:
            r = self.bases.get(args[-1])
            return Rows([{'data': r.model_dump(mode='json')}] if r else [])
        assert sql.startswith('WITH authorized AS')
        assert 'memory_procedure_evidence_authorized' in sql
        # Simulates the current SQL authorization result, not its implementation.
        rows = [r for r in self.events if r['event_id'] not in self.denied and
            r['owner'] == args[5] and r['cid'] == args[1] and r['ws'] == args[0]]
        rows = sorted(rows, key=lambda r: (-r['observed_at'].timestamp(), r['kind'], r['event_id']))
        if 'WHERE kind=%s AND event_id=%s' in sql:
            rows = [r for r in rows if (r['kind'], r['event_id']) == args[-2:]]
        else:
            assert 'ORDER BY observed_at DESC,kind,event_id LIMIT %s' in sql
            if len(args) == 13:
                at, _, kind, event_id = args[8:12]
                rows = [r for r in rows if r['observed_at'] < at or
                    (r['observed_at'] == at and (r['kind'],r['event_id']) > (kind,event_id))]
            rows = rows[:args[-1]]
        return Rows(rows)


class Service(MemoryRetrieval, MemoryStore):
    def __init__(self):
        self.c = Connection()
        self.db = self
        self.generation = 1
        self.denied_memories = set()
        self.denied_scope = False
        self.checked = []

    @contextmanager
    def transaction(self): yield self.c

    def _scope(self, c, p, ws):
        if self.denied_scope: raise DomainError('not_found_or_not_authorized')
        return self.generation

    def _memory_scope(self, c, p, ws, kind, sid):
        if self.denied_scope: raise DomainError('not_found_or_not_authorized')
        return SimpleNamespace(work_area=None)

    def _memory_sources(self, c, p, ws, refs, **kw):
        self.checked.append(kw['memory_id'])
        if kw['memory_id'] in self.denied_memories:
            raise DomainError('not_found_or_not_authorized')

    def _memory_procedure(self, *args): pass


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setattr(retrieval, 'now', lambda: AT + timedelta(hours=1))
    return Service()


def collect(s, **kw):
    cursor, result = None, []
    for _ in range(100):
        page = s.discover_memory(P, 'ws', 'cv', cursor=cursor, **kw)
        result.extend(page.items)
        assert page.has_more == (page.next_cursor is not None)
        if not page.has_more: return result
        cursor = page.next_cursor
    raise AssertionError('non-terminating continuation')


@pytest.mark.parametrize('count,conflict,chars', [(13,False,10),(13,True,10),(1,False,6001),(65,False,4000)])
def test_all_accessible_memories_reachable_outside_model_packing(service, count, conflict, chars):
    service.c.memories = [revision(i, subject_key='shared' if conflict else f's-{i}', content=str(i)+'x'*chars)
                          for i in range(count)]
    found = collect(service, limit=7)
    assert [i.memory_id for i in found] == [r.memory_id for r in service.c.memories]
    assert all(len(i.excerpt) <= 240 for i in found)
    assert all(i.unresolved_conflict == conflict for i in found)
    for summary in found:
        full = service.read_discovered_memory(P, 'ws', 'cv', summary.memory_id, summary.revision_id)
        assert len(full.revision.content) > chars
        assert full.unresolved_conflict == conflict
    recall = service._recall_memory(service.c, P, 'ws', 'cv')
    assert len(recall.items) <= 12
    assert sum(len(i.revision.content or '') for i in recall.items) <= 6000
    if conflict or chars > 6000: assert recall.items == [] and recall.has_more


def test_query_hit_in_dispute_brings_siblings_across_pages(service):
    service.c.memories = [revision(i, subject_key='shared', content='needle' if i == 0 else 'other') for i in range(13)]
    found = collect(service, query='needle', limit=2)
    assert len(found) == 13
    assert all(i.unresolved_conflict for i in found)
    assert len({i.contradiction_group_id for i in found}) == 1


def test_denied_siblings_do_not_leak_counts_ids_conflicts_or_tokens(service):
    service.c.memories = [revision(0, subject_key='shared'), revision(1, subject_key='shared'), revision(2)]
    service.denied_memories.add('m-0001')
    before = service.discover_memory(P,'ws','cv',limit=1)
    service.c.memories[1] = revision(1, subject_key='shared', content='secret changed')
    after = service.discover_memory(P,'ws','cv',limit=1)
    assert before == after
    assert not before.items[0].unresolved_conflict
    assert 'm-0001' not in before.model_dump_json() and 'secret' not in before.model_dump_json()
    assert [i.memory_id for i in collect(service, limit=1)] == ['m-0000','m-0002']
    with pytest.raises(DomainError): service.read_discovered_memory(P,'ws','cv','m-0001','r-0001')


@pytest.mark.parametrize('change', ['revision','revoke','generation','query','principal','conversation','tamper','expire'])
def test_changed_view_or_foreign_cursor_requires_restart(service, change):
    service.c.memories = [revision(i) for i in range(3)]
    page = service.discover_memory(P,'ws','cv',limit=1)
    p, cid, query, cursor = P, 'cv', '', page.next_cursor
    if change == 'revision': service.c.memories[1] = revision(1, revision_id='new')
    if change == 'revoke': service.denied_memories.add('m-0002')
    if change == 'generation': service.generation += 1
    if change == 'query': query = 'Value'
    if change == 'principal': p = Principal('other')
    if change == 'conversation': cid = 'other'
    if change == 'tamper': cursor = cursor[:-1] + '!'
    if change == 'expire': service.c.memories[1] = revision(1, expires_at=AT)
    with pytest.raises(DomainError): service.discover_memory(p,'ws',cid,limit=1,cursor=cursor,query=query)


def test_temporary_expiry_uses_authorized_base_and_stales_cursor(service, monkeypatch):
    base = revision(0)
    service.c.bases[base.revision_id] = base
    service.c.memories = [revision(0, revision_id='temporary', exception_to_revision_id=base.revision_id,
        valid_until=AT+timedelta(hours=2)), revision(1)]
    page = service.discover_memory(P,'ws','cv',limit=1)
    monkeypatch.setattr(retrieval,'now',lambda:AT+timedelta(hours=3))
    with pytest.raises(DomainError): service.discover_memory(P,'ws','cv',cursor=page.next_cursor,limit=1)
    refreshed = service.discover_memory(P,'ws','cv',limit=1)
    assert refreshed.items[0].revision_id == base.revision_id
    assert service.read_discovered_memory(P,'ws','cv',base.memory_id,base.revision_id).revision == base


def events(count=127):
    return [dict(kind='human_message' if i % 2 else 'tool_observation', event_id=f'e-{i//2:04}',
        observed_at=AT-timedelta(seconds=i//9), ws='ws', cid='cv', owner=P.id,
        data={'text':'Full human event' * 100} if i % 2 else
        {'status':['failed','cost_only','outcome_unknown'][i % 3], 'capability_id':'compute.python',
         'output':{'result':{'status':'failed'}}}) for i in range(count)]


def test_evidence_over_50_ties_kinds_and_denied_positions(service):
    service.c.events = events()
    service.c.denied.add('e-0005')
    seen, cursor = [], None
    while True:
        page = service.memory_lesson_evidence(P,'ws','cv',limit=7,cursor=cursor)
        assert all(len(o.label) <= 240 for o in page.items)
        for option in page.items:
            ref = option.evidence
            seen.append((ref.kind,ref.event_id))
            detail = service.memory_lesson_evidence_detail(P,'ws','cv',ref.kind,ref.event_id,ref.sha256)
            assert digest(detail.data) == ref.sha256
            if ref.kind == 'tool_observation':
                assert option.outcome != 'observed' and option.operational_outcome == 'failed'
        if not page.has_more: break
        cursor = page.next_cursor
    expected = {(r['kind'],r['event_id']) for r in service.c.events if r['event_id'] not in service.c.denied}
    assert set(seen) == expected and len(seen) == len(expected)
    assert len(seen) > 50


@pytest.mark.parametrize('change',['revoke','principal','conversation','tamper','scope'])
def test_evidence_cursor_reauthorizes_anchor(service,change):
    service.c.events = events()
    page = service.memory_lesson_evidence(P,'ws','cv',limit=1)
    cursor,p,cid = page.next_cursor,P,'cv'
    if change == 'revoke': service.c.denied.add(page.items[0].evidence.event_id)
    if change == 'principal': p=Principal('other')
    if change == 'conversation': cid='other'
    if change == 'tamper': cursor='tool_observation:does-not-exist'
    if change == 'scope': service.denied_scope=True
    with pytest.raises(DomainError): service.memory_lesson_evidence(p,'ws',cid,cursor=cursor)


def test_detail_rechecks_revision_hash_and_access(service):
    service.c.memories=[revision(0)]
    with pytest.raises(DomainError): service.read_discovered_memory(P,'ws','cv','m-0000','stale')
    service.c.events=events(1)
    ref=service.memory_lesson_evidence(P,'ws','cv').items[0].evidence
    with pytest.raises(DomainError): service.memory_lesson_evidence_detail(P,'ws','cv',ref.kind,ref.event_id,'0'*64)
    service.c.denied.add(ref.event_id)
    with pytest.raises(DomainError): service.memory_lesson_evidence_detail(P,'ws','cv',ref.kind,ref.event_id,ref.sha256)


@pytest.mark.parametrize('limit',[0,51,-1,True])
def test_service_page_size_bound_is_not_discovery_horizon(service,limit):
    with pytest.raises(DomainError): service.discover_memory(P,'ws','cv',limit=limit)
    with pytest.raises(DomainError): service.memory_lesson_evidence(P,'ws','cv',limit=limit)


def test_actual_registered_http_routes_dtos_and_query_validation(service):
    service.c.memories=[revision(i) for i in range(13)]
    service.c.events=events(55)
    app=FastAPI()
    def principal(authorization: str = Header()):
        if authorization != 'synthetic': raise DomainError('unauthenticated')
        return P
    def meta(): return Request(schema_version='workagent/v1',request_id='test')
    @app.exception_handler(DomainError)
    async def error(request, exc): return JSONResponse({'code':exc.code},status_code=403)
    api.register(app,service,principal,meta,{})
    client=TestClient(app)
    root='/v1/workspaces/ws/memory'
    h={'authorization':'synthetic'}
    first=client.get(root+'/discovery',params={'conversation_id':'cv','limit':7},headers=h)
    assert first.status_code == 200, first.text
    data=first.json()
    second=client.get(root+'/discovery',params={'conversation_id':'cv','limit':7,'cursor':data['next_cursor']},headers=h)
    assert len(second.json()['items']) == 6
    summary=data['items'][0]
    detail=client.get(root+'/discovery/'+summary['memory_id'],params={'conversation_id':'cv','revision_id':summary['revision_id']},headers=h)
    assert detail.status_code == 200 and detail.json()['revision']['content'] == 'Value 0'
    page=client.get(root+'/lesson-evidence',params={'conversation_id':'cv'},headers=h).json()
    assert len(page['items']) == 50 and page['has_more'] and page['next_cursor']
    ref=page['items'][0]['evidence']
    detail=client.get(root+f"/lesson-evidence/{ref['kind']}/{ref['event_id']}",params={'conversation_id':'cv','sha256':ref['sha256']},headers=h)
    assert detail.status_code == 200 and detail.json()['evidence'] == ref
    assert client.get(root+'/discovery',params={'conversation_id':'cv','limit':51},headers=h).status_code == 422
    assert client.get(root+'/discovery',params={'conversation_id':'cv'},headers={'authorization':'wrong'}).status_code == 403
