"""Canonical API/domain types. OpenAPI and the web client derive from these models."""
from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, field_validator, model_validator

Id = Annotated[str, Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9][A-Za-z0-9_.:-]*$')]
Text = Annotated[str, Field(min_length=1, max_length=10000)]
Version = Annotated[int, Field(strict=True, ge=1, le=2147483647)]


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', validate_assignment=True)


class ErrorCode(str, Enum):
    not_found_or_not_authorized = 'not_found_or_not_authorized'
    version_conflict = 'version_conflict'
    source_changed = 'source_changed'
    source_unavailable = 'source_unavailable'
    decision_required = 'decision_required'
    decision_stale = 'decision_stale'
    budget_exhausted = 'budget_exhausted'
    connection_required = 'connection_required'
    unsupported_operation = 'unsupported_operation'
    action_unresolved = 'action_unresolved'
    command_conflict = 'command_conflict'
    unauthenticated = 'unauthenticated'
    validation_error = 'validation_error'
    internal_error = 'internal_error'


class ErrorDetails(Model):
    current_revision_id: Id | None = None
    current_version: Version | None = None
    proposal_id: Id | None = None
    fields: list[str] = Field(default_factory=list, max_length=50)


class ErrorEnvelope(Model):
    code: ErrorCode
    message: Text
    request_id: Id
    next_action: Text
    details: ErrorDetails = Field(default_factory=ErrorDetails)


class Request(Model):
    schema_version: Literal['workagent/v1']
    request_id: Id


class Command(Request):
    command_id: Id


class SourceRef(Model):
    source_id: Id
    external_version: Id
    observed_at: AwareDatetime

    @field_validator('observed_at')
    @classmethod
    def utc(cls, value):
        return value.astimezone(timezone.utc)


class Block(Model):
    block_id: Id
    kind: Literal['heading', 'paragraph', 'checklist', 'protected_note']
    text: Text
    checked: bool | None = None

    @model_validator(mode='after')
    def checklist_state(self):
        if self.checked is not None and self.kind != 'checklist':
            raise ValueError('checked is only valid for checklist blocks')
        return self


class Body(Model):
    title: Annotated[str, Field(min_length=1, max_length=240)]
    blocks: list[Block] = Field(min_length=1, max_length=200)

    @model_validator(mode='after')
    def unique_blocks(self):
        if len({b.block_id for b in self.blocks}) != len(self.blocks):
            raise ValueError('block IDs must be unique')
        return self


class Workspace(Model):
    id: Id
    name: Text
    kind: Literal['personal', 'shared'] = 'personal'
    owner_id: Id
    access_generation: Version = 1


class Source(Model):
    id: Id
    workspace_id: Id
    title: Text
    external_version: Id
    observed_at: AwareDatetime
    available: bool = True
    # Content is intentionally not returned by source listing.


class SourceDetail(Source):
    content: dict


class Assignment(Model):
    id: Id
    workspace_id: Id
    owner_id: Id
    goal: Text
    completion_criteria: list[Text] = Field(min_length=1, max_length=30)
    work_version: Version = 1
    state: Literal['queued', 'running', 'ready', 'partial', 'paused', 'cancelled'] = 'queued'
    selected_source_refs: list[SourceRef] = Field(max_length=50)
    artifact_ids: list[Id] = Field(default_factory=list, max_length=100)
    run_ids: list[Id] = Field(default_factory=list, max_length=100)
    unresolved: list[Text] = Field(default_factory=list, max_length=100)
    observed_at: AwareDatetime = Field(default_factory=now)


class CreateAssignment(Command):
    goal: Text
    completion_criteria: list[Text] = Field(min_length=1, max_length=30)
    selected_source_refs: list[SourceRef] = Field(min_length=1, max_length=50)

    @model_validator(mode='after')
    def unique_sources(self):
        if len({s.source_id for s in self.selected_source_refs}) != len(self.selected_source_refs):
            raise ValueError('source IDs must be unique')
        return self


class Run(Model):
    id: Id
    workspace_id: Id
    assignment_id: Id
    principal_id: Id
    kind: Literal['initial', 'revision']
    state: Literal['queued', 'running', 'ready', 'partial', 'cancelled'] = 'queued'
    fence: int = Field(default=0, ge=0)
    access_generation: Version
    lease_expires_at: AwareDatetime | None = None
    profile: Literal['fixture-deterministic-v1'] = 'fixture-deterministic-v1'
    bundle_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    tool_registry_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    provider_session_id: Id | None = None
    provider_turn_id: Id | None = None
    cursor: int = Field(default=0, ge=0)
    budget_units: int = Field(default=1, ge=0, le=100)
    used_units: int = Field(default=0, ge=0, le=100)
    artifact_id: Id | None = None
    base_revision_id: Id | None = None
    instruction: Text | None = None
    proposal_id: Id | None = None
    unresolved: list[Text] = Field(default_factory=list, max_length=100)
    observed_at: AwareDatetime = Field(default_factory=now)


class Revision(Model):
    id: Id
    artifact_id: Id
    revision_number: Version
    parent_revision_id: Id | None
    author_id: Id
    author_kind: Literal['human', 'worker']
    body: Body
    body_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    source_dependencies: list[SourceRef] = Field(max_length=50)
    created_at: AwareDatetime = Field(default_factory=now)


class Artifact(Model):
    id: Id
    workspace_id: Id
    assignment_id: Id
    current_revision_id: Id
    current_revision: Revision
    requested_revision: Revision | None = None
    observed_at: AwareDatetime = Field(default_factory=now)


class Proposal(Model):
    id: Id
    workspace_id: Id
    assignment_id: Id
    artifact_id: Id
    base_revision_id: Id
    base_work_version: Version
    body: Body
    body_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    source_dependencies: list[SourceRef] = Field(max_length=50)
    reason: Text
    status: Literal['pending', 'accepted', 'dismissed'] = 'pending'
    accepted_revision_id: Id | None = None
    created_at: AwareDatetime = Field(default_factory=now)


class HumanSave(Command):
    expected_current_revision_id: Id
    body: Body


class RequestRevision(Command):
    expected_work_version: Version
    base_revision_id: Id
    instruction: Text


class AcceptProposal(Command):
    expected_current_revision_id: Id


class DismissProposal(Command):
    expected_current_revision_id: Id
    resolution: Literal['keep_current', 'dismiss']


class ControlAssignment(Command):
    expected_work_version: Version
    operation: Literal['pause', 'resume', 'cancel']


class Task(Model):
    id: Id
    workspace_id: Id
    assignment_id: Id
    owner_id: Id
    desired_result: Text
    version: Version = 1
    state: Literal['created'] = 'created'
    evidence_refs: list[SourceRef] = Field(default_factory=list, max_length=50)
    created_at: AwareDatetime = Field(default_factory=now)


class CreateTask(Command):
    expected_work_version: Version
    owner_id: Id
    desired_result: Text
    evidence_refs: list[SourceRef] = Field(default_factory=list, max_length=50)


class TaskReceipt(Model):
    task: Task
    verification: Literal['unresolved'] = 'unresolved'
    next_action: Literal['get_task with expected_version and expected_desired_result'] = 'get_task with expected_version and expected_desired_result'


class TaskInspection(Model):
    task: Task
    inspection_id: Id
    observed_at: AwareDatetime
    verification: Literal['verified_created', 'unresolved']


class AssignmentCreated(Model):
    assignment: Assignment
    run: Run


class RevisionQueued(Model):
    run: Run


class WorkspacePage(Model):
    items: list[Workspace]
    next_cursor: Id | None = None


class SourcePage(Model):
    items: list[Source]
    next_cursor: Id | None = None


class AssignmentPage(Model):
    items: list[Assignment]
    next_cursor: Id | None = None


class RevisionPage(Model):
    items: list[Revision]
    next_cursor: Id | None = None


class ProposalPage(Model):
    items: list[Proposal]
    next_cursor: Id | None = None
