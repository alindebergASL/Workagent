"""Canonical memory DTOs. Commands never accept provenance or promotion authority."""
import re
from typing import Annotated, Literal
from pydantic import AwareDatetime, Field, model_validator
from ..model_base import Model, Id, Hash
from ..models import Command, SourceRef, Version
from ..workspace_file_models import FileVersionRef

Kind = Literal['fact', 'preference', 'project_convention', 'episode', 'procedure']
Scope = Literal['task', 'work_area', 'user']
Status = Literal['candidate', 'active', 'contested', 'superseded', 'expired', 'forgotten']
Origin = Literal['human_explicit', 'human_reviewed', 'agent_inferred', 'external_source', 'tool_observed']
Key = Annotated[str, Field(min_length=1, max_length=160, pattern=r'^[a-z0-9][a-z0-9_.:-]*$')]


class MemorySource(Model):
    source_type: Literal['source'] = 'source'
    ref: SourceRef


class MemoryFile(Model):
    source_type: Literal['file'] = 'file'
    ref: FileVersionRef


MemorySourceRef = Annotated[MemorySource | MemoryFile, Field(discriminator='source_type')]


def validate_content(text):
    # Deliberately narrow rejection rules, not a comprehensive PII detector.
    if re.search(r'(?i)(-----BEGIN .*PRIVATE KEY-----|\b(?:sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{12,}|\b(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+|\bBearer\s+\S+)', text):
        raise ValueError('secret-like memory content is prohibited')
    if re.search(r'(?i)\b(?:social security|ssn|sexual orientation|medical diagnosis|religious belief|biometric)\b', text):
        raise ValueError('sensitive personal categories are prohibited')
    return text


class MemoryInput(Model):
    kind: Kind
    scope_kind: Scope
    scope_id: Id
    subject_key: Key
    predicate_key: Key
    content: str = Field(min_length=1, max_length=4000)
    source_refs: list[MemorySourceRef] = Field(default_factory=list, max_length=16)
    confidence_basis: str = Field(default='Explicit human statement', min_length=1, max_length=500)
    valid_from: AwareDatetime | None = None
    valid_until: AwareDatetime | None = None
    expires_at: AwareDatetime | None = None
    applicability: str = Field(default='', max_length=500)
    sensitivity: Literal['ordinary'] = 'ordinary'

    @model_validator(mode='after')
    def safe(self):
        for text in (self.content, self.confidence_basis, self.applicability, self.subject_key, self.predicate_key):
            validate_content(text)
        if self.valid_until and self.valid_from and self.valid_until <= self.valid_from:
            raise ValueError('valid interval must be finite and increasing')
        return self


class RememberMemory(Command, MemoryInput):
    pass


class ProposeMemory(Command, MemoryInput):
    """Human-submitted inference; no caller-selected origin, run or active status."""
    pass


class MemoryCAS(Command):
    expected_revision_id: Id


class ReviewMemory(MemoryCAS):
    decision: Literal['accept', 'dispute', 'reject']


class CorrectMemory(MemoryCAS):
    content: str = Field(min_length=1, max_length=4000)
    mode: Literal['permanent', 'temporary'] = 'permanent'
    valid_from: AwareDatetime | None = None
    valid_until: AwareDatetime | None = None
    source_refs: list[MemorySourceRef] = Field(default_factory=list, max_length=16)

    @model_validator(mode='after')
    def safe(self):
        validate_content(self.content)
        if self.mode == 'temporary':
            if not self.valid_from or not self.valid_until or self.valid_until <= self.valid_from:
                raise ValueError('temporary correction requires an explicit finite interval')
        elif self.valid_from is not None or self.valid_until is not None:
            raise ValueError('permanent correction uses the base valid interval')
        return self


class NarrowMemory(MemoryCAS):
    scope_kind: Scope
    scope_id: Id


class BindMemoryScope(Command):
    conversation_id: Id
    work_area_id: Id
    expected_work_version: Version


class MemoryScopeBinding(Model):
    conversation_id: Id
    work_area_id: Id
    work_version: Version


class MemoryRevisionV1(Model):
    memory_id: Id
    revision_id: Id
    workspace_id: Id
    owner_id: Id
    kind: Kind
    scope_kind: Scope
    scope_id: Id
    # Erasure removes all semantic payload, including keys and explanatory text.
    subject_key: Key | None
    predicate_key: Key | None
    content: str | None
    content_sha256: Hash | None
    status: Status
    origin: Origin
    source_refs: list[MemorySourceRef] = Field(default_factory=list)
    evidence_ids: list[Id] = Field(default_factory=list)
    proposed_by_run_id: Id | None = None
    reviewed_by_principal_id: Id | None = None
    confidence_label: Literal['explicit', 'observed', 'inferred', 'uncertain']
    confidence_basis: str | None
    valid_from: AwareDatetime
    valid_until: AwareDatetime | None = None
    recorded_at: AwareDatetime
    expires_at: AwareDatetime | None = None
    supersedes_revision_id: Id | None = None
    exception_to_revision_id: Id | None = None
    contradiction_group_id: Id | None = None
    applicability: str | None
    access_generation: int = Field(ge=1)


class MemoryReceipt(Model):
    memory_id: Id
    revision_id: Id
    status: Status


class MemoryInspection(Model):
    current: MemoryRevisionV1
    revisions: list[MemoryRevisionV1]
    notice: str = 'Forget erases memory payloads. It cannot unsend prior requests or remove other source documents, saved outputs, or historical outgoing receipts.'


class RecalledMemory(Model):
    revision: MemoryRevisionV1
    why: Literal['task', 'explicit_work_area_binding', 'owner_preference']
    unresolved_conflict: bool = False


class MemoryPage(Model):
    items: list[RecalledMemory]
    has_more: bool = False


class MemoryManifestEntry(Model):
    memory_id: Id
    revision_id: Id
    content_sha256: Hash
    scope_kind: Scope
    scope_id: Id
    why: Literal['task', 'explicit_work_area_binding', 'owner_preference']
    unresolved_conflict: bool


class MemoryUsage(Model):
    run_id: Id
    request_id: Id
    attempt_id: Id
    phase: Id
    request_sha256: Hash
    entries: list[MemoryManifestEntry]


class MemoryUsagePage(Model):
    items: list[MemoryUsage]


class MemoryContract(Model):
    revision: MemoryRevisionV1
    receipt: MemoryReceipt
    inspection: MemoryInspection
    page: MemoryPage
    remember: RememberMemory
    candidate: ProposeMemory
    review: ReviewMemory
    correct: CorrectMemory
    narrow: NarrowMemory
    expire: MemoryCAS
    forget: MemoryCAS
    bind: BindMemoryScope
    binding: MemoryScopeBinding
    usage: MemoryUsagePage
