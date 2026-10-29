"""Grounded research contracts. Attribution is not semantic entailment."""
from typing import Literal
from pydantic import AwareDatetime, Field, model_validator
from .model_base import Model, Id, Hash


class ResearchCoverage(Model):
    body_complete: bool
    text_complete: bool
    omissions: list[str] = Field(max_length=30)


class ExternalVersion(Model):
    etag: str | None
    last_modified: str | None


class PublicRedirect(Model):
    url: str
    status: int
    location: str


class PublicEvidence(Model):
    kind: Literal['public_source'] = 'public_source'
    blob_id: Id
    sha256: Hash
    mime_type: str
    title: str | None
    url: str
    final_url: str
    status_code: int
    redirects: list[PublicRedirect]
    fetched_at: AwareDatetime
    extractor_version: str
    coverage: ResearchCoverage
    external_version: ExternalVersion
    extraction_status: Literal['extracted', 'empty', 'truncated', 'unavailable']
    browser_used: bool
    text: str = Field(max_length=200000)
    text_sha256: Hash
    run_id: Id
    tool_attempt_id: Id


class SearchCandidate(Model):
    url: str = Field(max_length=2048)
    title: str = Field(max_length=2000)
    snippet: str = Field(max_length=4000)
    evidence_use: Literal['discovery_only'] = 'discovery_only'


class SearchResult(Model):
    status: Literal['available', 'unavailable']
    query: str
    query_sha256: Hash
    processor: str
    mode: Literal['unconfigured', 'deterministic_http_fixture']
    searched_at: AwareDatetime
    candidates: list[SearchCandidate] = Field(max_length=20)
    omissions: list[str] = Field(max_length=20)
    external_calls: int = Field(ge=0, le=1)


class QuoteRef(Model):
    workspace_file_id: Id
    snapshot_id: Id
    text_sha256: Hash
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    quote: str = Field(min_length=1, max_length=10000)
    relation: Literal['supports', 'contradicts', 'context']

    @model_validator(mode='after')
    def range_length(self):
        if self.end - self.start != len(self.quote):
            raise ValueError('exact Unicode character range required')
        return self


class ClaimInput(Model):
    artifact_id: Id
    revision_id: Id
    body_hash: Hash
    claim: str = Field(min_length=1, max_length=4000)
    evidence: list[QuoteRef] = Field(max_length=20)


class ResearchClaim(ClaimInput):
    claim_id: Id
    workspace_id: Id
    conversation_id: Id
    run_id: Id
    tool_attempt_id: Id
    created_at: AwareDatetime
    attribution: Literal['exact_quotes_only'] = 'exact_quotes_only'
    semantic_status: Literal['not_assessed', 'unsupported', 'conflict']


class ClaimFreshness(Model):
    claim: ResearchClaim
    freshness: Literal['current', 'potentially_stale']
    newer_snapshot_ids: list[Id]
    coverage: list[Literal['extracted', 'empty', 'truncated', 'unavailable']]


class ArtifactClaims(Model):
    artifact_id: Id
    revision_id: Id
    body_hash: Hash
    items: list[ClaimFreshness]
    semantic_notice: Literal['Exact quotes verify attribution, not claim truth.'] = 'Exact quotes verify attribution, not claim truth.'
