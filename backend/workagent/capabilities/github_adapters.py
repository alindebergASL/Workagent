"""Native public GitHub capabilities on the existing gateway and evidence store."""
from dataclasses import replace
from types import SimpleNamespace
from typing import Literal, Annotated
from pydantic import Field, model_validator
from ..composition import ReadDecision
from ..connectors.base import Repository, PROCESSOR
from ..connectors import github_read
from ..errors import deny
from ..model_base import Model, Hash
from ..workspace_file_models import SourceSnapshot
from .research_adapters import selector

PROFILE = 'native-github-public-v1'

class GitHubDiscover(ReadDecision):
    kind: Literal['github_discover']
    repository: Repository
    resource: Literal['readme', 'issues', 'releases']
    page: int = Field(ge=1, le=5)
    per_page: int = Field(ge=1, le=20)

class GitHubRead(ReadDecision):
    kind: Literal['github_read']
    repository: Repository
    resource: Literal['readme', 'issues', 'releases']
    number: int | None = Field(ge=1, le=9999999999)
    commit: Annotated[str, Field(pattern=r'^[a-f0-9]{40}$')] | None
    expected_response_sha256: Hash | None

    @model_validator(mode='after')
    def exact_resource(self):
        if (self.resource == 'readme' and (self.commit is None or self.number is not None)
            or self.resource != 'readme' and (self.number is None or self.commit is not None)):
            raise ValueError('exact commit or issue/release number required')
        return self

class GitHubPagination(Model):
    page: int = Field(ge=1, le=5)
    per_page: int = Field(ge=1, le=20)
    item_count: int = Field(ge=0, le=20)
    next_page: int | None = Field(ge=1, le=5)
    has_more: bool
    limit_reached: bool

    @model_validator(mode='after')
    def consistent(self):
        expected_next=self.page+1 if self.has_more and self.page<5 else None
        if (self.item_count>self.per_page or self.next_page!=expected_next
            or self.limit_reached!=(self.has_more and self.page==5)):
            raise ValueError('inconsistent bounded pagination')
        return self


class GitHubResult(Model):
    source: Literal['live_public', 'fixture'] = 'fixture'
    pagination: GitHubPagination | None = None
    status: Literal['available', 'rate_limited', 'unavailable', 'not_found', 'denied', 'changed_source']
    snapshot: SourceSnapshot | None = None
    retry_after_seconds: int | None = Field(default=None, ge=0, le=86400)
    reset_epoch_seconds: int | None = Field(default=None, ge=0, le=4102444800)

class GitHubOutput(Model):
    capability: Literal['github_discover', 'github_read']
    version: Literal['1'] = '1'
    result: GitHubResult

GITHUB_OPERATIONS = (GitHubDiscover, GitHubRead)
IDS = {'github_discover': 'connectors.github.discover', 'github_read': 'connectors.github.read'}


def input_refs(request):
    return [selector('github_repository', request.repository), selector('processor', PROCESSOR)]


def authorize_resources(service, c, p, run, scope, call, adapter):
    request = adapter.input_model.model_validate(call.arguments, strict=True)
    if not run.conversation_id or call.input_refs != input_refs(request): deny()
    from .file_adapters import scope_targets
    if scope_targets(service, c, p, run, scope) is not None: deny()


def invoke(service, cap, request, call):
    from . import policy, registry
    from .. import research
    adapter = registry.adapters()[IDS[request.kind]]
    with service.db.transaction() as c:
        p, run, scope, _ = policy.authorize(service, c, cap, call, adapter)
        aid = c.execute('SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=%s AND call_id=%s',
            (run.workspace_id, run.id, call.call_id)).fetchone()['id']
    response = github_read.fetch(request)
    material = None
    try:
        result = GitHubResult(status=response['status'], source=response.get('source', 'fixture'),
                              retry_after_seconds=response.get('retry_after_seconds'), reset_epoch_seconds=response.get('reset_epoch_seconds'))
        if result.status == 'available':
            material = github_read.evidence(request, response)
            if isinstance(request, GitHubDiscover) and request.resource != 'readme':
                import json
                count = len(json.loads(material['text'])['evidence'])
                more = response.get('has_more') is True
                result.pagination = GitHubPagination(page=request.page, per_page=request.per_page, item_count=count,
                    has_more=more, next_page=request.page + 1 if more and request.page < 5 else None,
                    limit_reached=more and request.page == 5)
    except (ValueError, KeyError, TypeError, UnicodeError):
        material = None
        result = GitHubResult(status='unavailable', source=response.get('source', 'fixture'))
    with service.db.transaction() as c:
        service._scope(c, p, run.workspace_id, write=True)
        policy.authorize(service, c, cap, call, adapter)
        if material is not None:
            result.snapshot = research.append_capture(service, c, p, run, scope, aid,
                SimpleNamespace(url=material['requested_url']), material)
            expected = getattr(request, 'expected_response_sha256', None)
            if expected and expected != material['content_sha256']: result.status = 'changed_source'
    return GitHubOutput(capability=request.kind, result=result)


def adapters():
    from .registry import _adapter
    paths = ('connectors/base.py', 'connectors/github_read.py', 'capabilities/github_adapters.py',
        'capabilities/github_composition.py', 'public_retrieval.py', 'research.py',
        'source_snapshots.py', 'workspace_file_models.py', 'research_models.py',
        'responses_ledger.py', 'retained_results.py', 'products.py', 'general_responses.py',
        '../migrations/063_github_public.sql', '../migrations/064_tool_scope_reductions.sql', 'capabilities/policy.py')
    return {IDS[model.model_fields['kind'].annotation.__args__[0]]: replace(a,
        invoke_fenced=invoke, descriptor=a.descriptor.model_copy(update={'result_byte_limit': 1048576, 'timeout_ms': 20000}))
        for model in GITHUB_OPERATIONS
        for a in [_adapter(IDS[model.model_fields['kind'].annotation.__args__[0]], model, GitHubOutput, None,
            paths, public=True, version='1', profile=PROFILE, category='connector',
            resource_kinds=['github_repository', 'processor'])]}
