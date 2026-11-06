"""Opt-in research on the shared broker. No production search provider is installed."""
import base64
import os
from dataclasses import replace
from hashlib import sha256
from typing import Literal, Protocol
from pydantic import Field
from ..composition import ReadDecision
from ..errors import DomainError, deny
from ..model_base import Model
from ..models import now
from ..public_retrieval import destination
from ..research_models import SearchResult, ClaimInput, ResearchClaim
from ..workspace_file_models import SourceSnapshot
from .models import InputRef

PROFILE = 'native-grounded-research-v1'
CAPTURE_PROCESSOR = 'public-https-static-v1'
SEARCH_PROCESSOR = 'deterministic-http-search-fixture-v1'


class ResearchSearch(ReadDecision):
    kind: Literal['research_search']
    query: str = Field(min_length=1, max_length=4000)


class ResearchCapture(ReadDecision):
    kind: Literal['research_capture']
    url: str = Field(min_length=1, max_length=2048)
    allow_browser: bool


class ResearchCite(ReadDecision, ClaimInput):
    kind: Literal['research_cite']


class SearchOutput(Model):
    capability: Literal['research_search'] = 'research_search'
    version: Literal['1'] = '1'
    result: SearchResult


class CaptureResult(Model):
    status: Literal['captured', 'unavailable']
    snapshot: SourceSnapshot | None
    omissions: list[str]


class CaptureOutput(Model):
    capability: Literal['research_capture'] = 'research_capture'
    version: Literal['1'] = '1'
    result: CaptureResult


class CiteOutput(Model):
    capability: Literal['research_cite'] = 'research_cite'
    version: Literal['1'] = '1'
    result: ResearchClaim


RESEARCH_OPERATIONS = (ResearchSearch, ResearchCapture, ResearchCite)
IDS = {'research_search':'research.search', 'research_capture':'research.capture', 'research_cite':'research.cite'}


def selector(kind, value):
    h = sha256(value.encode('utf-8')).hexdigest()
    return InputRef(kind=kind, id=h, version='1', sha256=h)


def input_refs(request):
    if isinstance(request, ResearchSearch):
        return [selector('search_query', request.query), selector('processor', SEARCH_PROCESSOR)]
    if isinstance(request, ResearchCapture):
        url = destination(request.url)[0]
        # Canonical requests prevent a permission hash for one URL authorizing
        # different bytes, fragments or private query/path material.
        if request.url != url:
            raise DomainError('validation_error')
        processor = CAPTURE_PROCESSOR + ('-browser' if request.allow_browser else '')
        return [selector('public_url', url), selector('processor', processor)]
    return [InputRef(kind='artifact_revision', id=request.artifact_id, version=request.revision_id, sha256=request.body_hash),
            *[InputRef(kind='workspace_file', id=q.workspace_file_id, version=q.snapshot_id, sha256=q.text_sha256)
              for q in request.evidence]]


def authorize_resources(service, c, p, run, scope, call, adapter):
    if os.environ.get('WORKAGENT_RESEARCH_ENABLED') != '1': deny()
    request = adapter.input_model.model_validate(call.arguments, strict=True)
    if not run.conversation_id or call.input_refs != input_refs(request): deny()
    from .file_adapters import scope_targets
    allowed = scope_targets(service, c, p, run, scope)
    if isinstance(request, ResearchCite):
        from ..research import validate_claim
        validate_claim(service, c, p, run.workspace_id, scope.id, request)
        if allowed is not None and request.artifact_id not in allowed: deny()
    elif allowed is not None:
        # Source discovery is scope-wide and is not silently added to a targeted
        # artifact/responsibility grant.
        deny()


class SearchProvider(Protocol):
    """Trusted test injection only; endpoint/credentials never come from arguments.

    Implementations perform one deterministic real-HTTP fixture request and return
    its exact query/candidates. A pure synthetic adapter must not be installed here.
    """
    processor: Literal['deterministic-http-search-fixture-v1']
    mode: Literal['deterministic_http_fixture']
    def search(self, query: str) -> SearchResult: ...


# Process-owned test seam. No environment URL, model argument or credential route.
search_provider: SearchProvider | None = None


def search(query):
    provider = search_provider
    if provider is None:
        return SearchResult(status='unavailable', query=query, query_sha256=sha256(query.encode()).hexdigest(),
            processor=SEARCH_PROCESSOR, mode='unconfigured', searched_at=now(), candidates=[],
            omissions=['No approved product search processor/credential configured.'], external_calls=0)
    if provider.processor != SEARCH_PROCESSOR or provider.mode != 'deterministic_http_fixture':
        raise ValueError('only explicitly labeled deterministic HTTP fixtures are injectable')
    result = SearchResult.model_validate(provider.search(query))
    if (result.query != query or result.query_sha256 != sha256(query.encode()).hexdigest()
            or result.processor != SEARCH_PROCESSOR or result.mode != provider.mode):
        raise ValueError('search response must retain exact requested query and processor')
    return result


def invoke(service, cap, request, call):
    from . import policy, registry
    from .. import public_retrieval, research
    adapter = registry.adapters()[IDS[request.kind]]
    with service.db.transaction() as c:
        p, run, scope, _ = policy.authorize(service, c, cap, call, adapter)
        aid = c.execute('SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=%s AND call_id=%s',
                        (run.workspace_id, run.id, call.call_id)).fetchone()['id']
    # No DB transaction or lock spans external I/O.
    if isinstance(request, ResearchSearch):
        result = SearchOutput(result=search(request.query))
    elif isinstance(request, ResearchCapture):
        fetch = getattr(public_retrieval, 'fetch_public_source', None)
        if fetch is None:
            result = CaptureOutput(result=CaptureResult(status='unavailable', snapshot=None,
                omissions=['Public raw-source capture adapter is not installed.']))
        else:
            material = fetch(request.url, allow_browser=request.allow_browser)
            if material.get('raw_base64') is None:
                result = CaptureOutput(result=CaptureResult(status='unavailable', snapshot=None,
                    omissions=['Public fetch failed; no raw source snapshot retained.']))
            else:
                with service.db.transaction() as c:
                    service._scope(c, p, run.workspace_id, write=True)
                    policy.authorize(service, c, cap, call, adapter)
                    snapshot = research.append_capture(service, c, p, run, scope, aid, request, material)
                    result = CaptureOutput(result=CaptureResult(status='captured', snapshot=snapshot,
                        omissions=snapshot.omissions))
    else:
        with service.db.transaction() as c:
            service._scope(c, p, run.workspace_id, write=True)
            policy.authorize(service, c, cap, call, adapter)
            result = CiteOutput(result=research.append_claim(service, c, p, run, scope, aid, request))
    with service.db.transaction() as c:
        policy.authorize(service, c, cap, call, adapter)
    return result


def adapters():
    from .registry import _adapter
    paths = ('capabilities/research_adapters.py','capabilities/research_composition.py',
             'research.py','research_models.py','source_snapshots.py','workspace_file_models.py',
             'public_retrieval.py','public_browser.py','public_browser_runner.py','public_browser_lock.json',
             '../migrations/059_grounded_research.sql','../migrations/060_research_dependency_visibility.sql',
             'responses_ledger.py','retained_results.py')
    out = {}
    for name, inp, output in [('research.search', ResearchSearch, SearchOutput),
                              ('research.capture', ResearchCapture, CaptureOutput),
                              ('research.cite', ResearchCite, CiteOutput)]:
        a = _adapter(name, inp, output, None, paths, public=name!='research.cite', version='1',
            profile=PROFILE, category='search' if name=='research.search' else 'extraction',
            resource_kinds=['search_query','public_url','processor','workspace_file','artifact_revision'])
        out[name] = replace(a, invoke_fenced=invoke, descriptor=a.descriptor.model_copy(update={'result_byte_limit':1048576}))
    return out
