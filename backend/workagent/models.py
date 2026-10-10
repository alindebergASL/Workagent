"""Canonical API/domain types. OpenAPI and the web client derive from these models."""
from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, field_validator, model_validator, model_serializer

from .model_base import Model, Id, Text, Hash
from .acceptance_checks import AcceptanceSpec
Version = Annotated[int, Field(strict=True, ge=1, le=2147483647)]


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


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


from .flexible_models import Block, Body, StructuredTableBody, CustomViewBody, EmptyPayload, ActionName


class ViewActionRequest(Request):
    view_revision_id: Id
    view_body_hash: Hash
    access_generation: Version
    action: ActionName
    payload: EmptyPayload


class ViewActionResponse(Model):
    view_revision_id: Id
    access_generation: Version
    binding: str
    artifact_id: Id
    revision_id: Id
    body_hash: Hash
    body: Body | StructuredTableBody


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


from .product_models import (TableBody, FileBody, ToolBody, LocalOperation, ProductResult,
    ProductObservation, ObservationReadback, TurnState)
from .message_models import AttachmentInput, MessageAttachment, ExactTarget
ProductBody = Body | TableBody | FileBody | ToolBody | StructuredTableBody | CustomViewBody
ExecutionProfile = Literal['fixture-deterministic-v1', 'openai-agents-v1', 'openai-responses-v1', 'general-controlled-v1', 'general-products-controlled-v1', 'general-responses-v1']


class ExecutionProvenance(Model):
    mode: Literal['fixture', 'managed']
    profile: ExecutionProfile
    model: Id | None = None
    grant_id: Id | None = None
    attempt_id: Id | None = None
    # Managed labels mean configured execution, NOT proof of a provider response.
    provider_observation: Literal['not_observed', 'received'] = 'not_observed'
    # Trusted origin, never inferred from model/profile/observation. Live is reserved
    # for a future reviewed attestation path; this checkpoint cannot write it.
    evidence_origin: Literal['unverified', 'fixture', 'synthetic_provider_receipt', 'live_provider_receipt', 'controlled_transport'] = 'unverified'


class ArtifactBinding(Model):
    artifact_id: Id
    revision_id: Id | None = None
    proposal_id: Id | None = None
    base_revision_id: Id | None = None
    body_hash: Hash


class OutcomeCheck(Model):
    name: Literal['publication_binding', 'saved_body', 'exact_base', 'current_revision', 'provider_result', 'authority']
    status: Literal['passed', 'failed', 'unverified']


class OutcomeQuestion(Model):
    prompt: Annotated[str, Field(min_length=1, max_length=500)]
    artifact_id: Id
    proposal_id: Id
    base_revision_id: Id


from .product_models import ResponseStepObservation


class RunOutcome(Model):
    run_id: Id
    response_steps: list[ResponseStepObservation] = Field(default_factory=list,max_length=2)
    execution: ExecutionProvenance | None = None
    state: Literal['preparing', 'prepared', 'decision_required', 'decision_stale', 'approved', 'readback_verified', 'outcome_unknown', 'waiting', 'unverified']
    artifacts: list[ArtifactBinding] = Field(default_factory=list, max_length=10)
    checks: list[OutcomeCheck] = Field(default_factory=list, max_length=10)
    outcome_gate: Literal['passed', 'failed', 'unverified'] = 'unverified'
    safety_gate: Literal['passed', 'failed', 'unverified'] = 'unverified'
    continuation_available: bool = False
    attempt_state: Literal['prepared', 'dispatched', 'outcome_unknown', 'responded', 'reconciled', 'failed'] | None = None
    blocker: Literal['paused', 'cancelled', 'grant_revoked', 'grant_expired', 'source_changed', 'runtime_unavailable', 'consumer_unavailable', 'lease_expired', 'prepared_attempt', 'provider_outcome_unknown', 'provider_response_pending', 'provider_result_rejected', 'publication_pending', 'unsent_abandoned', 'unresolved_items', 'decision_required', 'decision_stale'] | None = None
    reason: Annotated[str, Field(min_length=1, max_length=500)] | None = None
    next_action: Annotated[str, Field(min_length=1, max_length=500)] | None = None
    question: OutcomeQuestion | None = None
    unresolved: list[Text] = Field(default_factory=list, max_length=100)
    underlying_action_performed: Literal[False] = False


class ResponsibilityOutcome(Model):
    latest_run_id: Id | None = None
    runs: list[RunOutcome] = Field(default_factory=list, max_length=100)
    approved_change: Literal['document_revision_only'] = 'document_revision_only'
    underlying_action_performed: Literal[False] = False


class ResponsesBinding(Model):
    # Explicit operator pins. A reference is not credential material.
    project_id: Annotated[str, Field(pattern=r'^proj_[A-Za-z0-9_-]{1,100}$')]
    secret_reference: Annotated[str, Field(pattern=r'^file:/[A-Za-z0-9_./-]{1,400}$')]
    transport_mode: Literal['synthetic', 'official_api']
    instructions_sha256: Hash
    schema_sha256: Hash
    scope_tool_sha256: Hash
    generation_limit: Literal[4] = 4
    count_limit: Literal[4] = 4
    read_limit: Literal[40] = 40
    cancel_limit: Literal[4] = 4
    input_limit: Literal[80000] = 80000
    output_limit: Literal[32768] = 32768
    cost_limit_usd: Literal['20.00'] = '20.00'


class GeneralResponsesBinding(Model):
    project_id: Annotated[str, Field(pattern=r'^proj_[A-Za-z0-9_-]{1,100}$')]
    secret_reference: Annotated[str, Field(pattern=r'^file:/[A-Za-z0-9_./-]{1,400}$')]
    transport_mode: Literal['synthetic', 'official_api']
    instructions_sha256: Hash
    schema_sha256: Hash
    scope_tool_sha256: Hash
    policy_version: Literal['general-responses-v1'] = 'general-responses-v1'
    generation_limit: Literal[8] = 8
    count_limit: Literal[8] = 8
    read_limit: Literal[80] = 80
    cancel_limit: Literal[0] = 0
    input_limit: Literal[160000] = 160000
    output_limit: Literal[65536] = 65536
    cost_limit_usd: Literal['20.00'] = '20.00'
    conversation_ids: list[Id] = Field(min_length=1,max_length=2)
    authorization_sha256: Hash
    synthetic_data_only: Literal[True] = True
    store_acknowledged: Literal[True] = True


class AdaptiveResponsesBinding(Model):
    """Opt-in capability, not a mutation of the historical eight-generation grant."""
    project_id: Annotated[str, Field(pattern=r'^proj_[A-Za-z0-9_-]{1,100}$')]
    secret_reference: Annotated[str, Field(pattern=r'^file:/[A-Za-z0-9_./-]{1,400}$')]
    transport_mode: Literal['synthetic', 'official_api']
    instructions_sha256: Hash
    schema_sha256: Hash
    scope_tool_sha256: Hash
    policy_version: Literal['adaptive-local-v1'] = 'adaptive-local-v1'
    max_steps: int = Field(default=4, strict=True, ge=1, le=4)
    generation_limit: Literal[50] = 50
    count_limit: Literal[50] = 50
    read_limit: Literal[500] = 500
    cancel_limit: Literal[0] = 0
    input_limit: Literal[1000000] = 1000000
    output_limit: Literal[409600] = 409600
    cost_limit_usd: Literal['20.00'] = '20.00'
    conversation_ids: list[Id] = Field(min_length=1,max_length=2)
    authorization_sha256: Hash
    synthetic_data_only: Literal[True] = True
    store_acknowledged: Literal[True] = True


class ProviderGrant(Model):
    id: Id
    workspace_id: Id
    principal_id: Id
    profile: Literal['openai-agents-v1', 'openai-responses-v1', 'general-responses-v1'] = 'openai-agents-v1'
    responses: ResponsesBinding | GeneralResponsesBinding | AdaptiveResponsesBinding | None = None
    model: Id
    consumer_sha256: Hash
    expires_at: AwareDatetime | None
    max_runs: int = Field(default=1, strict=True, ge=1, le=10)
    # Local receipt-validation ceiling, NOT a provider-enforced generation budget.
    max_received_output_tokens: int = Field(default=4096, strict=True, ge=1, le=16384)


    @model_validator(mode='after')
    def exact_responses_binding(self):
        if self.profile == 'general-responses-v1':
            if (not isinstance(self.responses,(GeneralResponsesBinding,AdaptiveResponsesBinding)) or self.expires_at is not None or
                self.model!='gpt-6.1-sol' or (self.max_runs>4 and not isinstance(self.responses,AdaptiveResponsesBinding)) or self.max_received_output_tokens!=16384):
                raise ValueError('exact general cumulative no-expiry grant required')
        elif self.profile == 'openai-responses-v1':
            if (not isinstance(self.responses,ResponsesBinding) or self.model != 'gpt-6.1-sol' or
                    self.max_runs > 2 or self.max_received_output_tokens != 16384):
                raise ValueError('exact bounded Responses grant required')
        elif self.responses is not None:
            raise ValueError('Responses binding requires Responses profile')
        if self.profile!='general-responses-v1' and self.expires_at is None:
            raise ValueError('historical grants require expiry')
        return self


class ProviderUsage(Model):
    input_tokens: int = Field(strict=True, ge=0, le=10000000)
    output_tokens: int = Field(strict=True, ge=0, le=10000000)


class ProviderResult(Model):
    # Sanitized typed receipt only; never headers, credentials, or raw HTTP envelopes.
    provider_session_id: Id
    provider_turn_id: Id
    bodies: list[Body] = Field(min_length=1, max_length=10)
    unresolved: list[Text] = Field(default_factory=list, max_length=100)
    usage: ProviderUsage


class ProviderAttempt(Model):
    id: Id
    workspace_id: Id
    run_id: Id
    principal_id: Id
    grant_id: Id
    profile: Literal['openai-agents-v1', 'openai-responses-v1', 'general-responses-v1']
    model: Id
    request_hash: Hash
    consumer_sha256: Hash
    context_hash: Hash
    fence: int = Field(ge=1)
    state: Literal['prepared', 'dispatched', 'outcome_unknown', 'responded', 'reconciled', 'failed'] = 'prepared'
    provider_session_id: Id | None = None
    provider_turn_id: Id | None = None
    result: ProviderResult | None = None
    result_hash: Hash | None = None


class Assignment(Model):
    id: Id
    workspace_id: Id
    conversation_id: Id | None = None
    owner_id: Id
    goal: Text
    completion_criteria: list[Text] = Field(min_length=1, max_length=30)
    work_version: Version = 1
    state: Literal['queued', 'running', 'ready', 'partial', 'paused', 'cancelled'] = 'queued'
    selected_source_refs: list[SourceRef] = Field(max_length=50)
    artifact_ids: list[Id] = Field(default_factory=list, max_length=100)
    run_ids: list[Id] = Field(default_factory=list, max_length=100)
    responsibility: ResponsibilityOutcome | None = None
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
    assignment_id: Id | None = None
    conversation_id: Id | None = None
    principal_id: Id
    kind: Literal['initial', 'revision', 'conversation_turn']
    state: Literal['queued', 'running', 'ready', 'partial', 'cancelled'] = 'queued'
    fence: int = Field(default=0, ge=0)
    access_generation: Version
    lease_expires_at: AwareDatetime | None = None
    profile: ExecutionProfile = 'fixture-deterministic-v1'
    execution: ExecutionProvenance | None = None
    bundle_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    tool_registry_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    provider_session_id: Id | None = None
    provider_turn_id: Id | None = None
    stop_reason: Literal['budget_limit'] | None = None
    cursor: int = Field(default=0, ge=0)
    budget_units: int = Field(default=1, ge=0, le=100)
    used_units: int = Field(default=0, ge=0, le=100)
    artifact_id: Id | None = None
    base_revision_id: Id | None = None
    instruction: Text | None = None
    proposal_id: Id | None = None
    unresolved: list[Text] = Field(default_factory=list, max_length=100)
    observed_at: AwareDatetime = Field(default_factory=now)

    @model_validator(mode='after')
    def exactly_one_owner(self):
        if (self.assignment_id is None) == (self.conversation_id is None):
            raise ValueError('run requires exactly one assignment or conversation owner')
        if (self.kind == 'conversation_turn') != (self.conversation_id is not None):
            raise ValueError('conversation turns require a conversation owner')
        if (self.profile in ('general-controlled-v1','general-products-controlled-v1','general-responses-v1')) != (self.conversation_id is not None):
            raise ValueError('general controlled profile requires a conversation turn')
        return self


class CreateConversation(Command):
    title: Annotated[str, Field(min_length=1, max_length=240)] = 'Conversation'
    selected_source_refs: list[SourceRef] = Field(default_factory=list, max_length=50)

    @model_validator(mode='after')
    def unique_sources(self):
        if len({s.source_id for s in self.selected_source_refs}) != len(self.selected_source_refs):
            raise ValueError('source IDs must be unique')
        return self


class Conversation(Model):
    # List/detail projections derived from the immutable message ledger.
    updated_at: AwareDatetime | None = None
    last_message_preview: Annotated[str, Field(max_length=240)] | None = None
    execution_profile: Literal['general-controlled-v1','general-responses-v1'] = 'general-controlled-v1'
    model_activation: Literal['disabled','active','revoked'] = 'disabled'
    id: Id
    workspace_id: Id
    owner_id: Id
    title: Annotated[str, Field(min_length=1, max_length=240)]
    work_version: Version = 1
    state: Literal['open', 'cancelled'] = 'open'
    selected_source_refs: list[SourceRef] = Field(default_factory=list, max_length=50)
    created_at: AwareDatetime = Field(default_factory=now)


class PostMessage(Command):
    expected_work_version: Version
    text: Text
    operation: LocalOperation | None = None
    attachments: list[AttachmentInput] = Field(default_factory=list,max_length=2)
    target: ExactTarget | None = None
    acceptance_checks: AcceptanceSpec | None = None

    @model_serializer(mode='wrap')
    def preserve_legacy_payload(self, handler):
        data=handler(self)
        if self.acceptance_checks is None:
            data.pop('acceptance_checks',None)
        return data

    @model_validator(mode='after')
    def bounded_inputs(self):
        if self.operation is not None and (self.attachments or self.target or self.acceptance_checks):
            raise ValueError('controlled operation cannot mix with general inputs')
        if sum(len(a.content.encode()) for a in self.attachments)>200000:
            raise ValueError('aggregate attachment bound')
        return self


class CancelConversation(Command):
    expected_work_version: Version


class DelegateConversation(Command):
    expected_work_version: Version
    goal: Text
    completion_criteria: list[Text] = Field(min_length=1, max_length=30)


class TextResult(Model):
    kind: Literal['text'] = 'text'
    text: Text


class TurnResult(Model):
    # Extend this typed result family when a broker-backed operation is implemented.
    # No opaque dicts, simulated files/tools, or authority/acceptance fields.
    results: list[TextResult | ProductResult] = Field(min_length=1, max_length=3)


class ConversationMessage(Model):
    id: Id
    conversation_id: Id
    run_id: Id
    sequence: Version
    author_id: Id
    author_kind: Literal['human', 'assistant']
    text: Text
    evidence_origin: Literal['human', 'controlled_transport', 'synthetic_provider_receipt', 'live_provider_receipt']
    result: TurnResult | None = None
    operation: LocalOperation | None = None
    attachments: list[MessageAttachment] = Field(default_factory=list,max_length=2)
    target: ExactTarget | None = None
    model_receipt: Id | None = None
    acceptance_checks: AcceptanceSpec | None = None
    created_at: AwareDatetime = Field(default_factory=now)

    @model_validator(mode='after')
    def human_checks_only(self):
        if self.acceptance_checks is not None and self.author_kind!='human':
            raise ValueError('only a human message can supply acceptance checks')
        return self

    @model_serializer(mode='wrap')
    def preserve_legacy_payload(self, handler):
        data=handler(self)
        if self.acceptance_checks is None:
            data.pop('acceptance_checks',None)
        return data


class MessageQueued(Model):
    conversation: Conversation
    message: ConversationMessage
    run: Run


class ConversationPage(Model):
    items: list[Conversation]
    next_cursor: Id | None = None


class ConversationDetail(Model):
    conversation: Conversation
    messages: list[ConversationMessage]
    runs: list[Run]
    assignment_ids: list[Id]
    artifact_ids: list[Id] = Field(default_factory=list)
    turns: list[TurnState] = Field(default_factory=list)


class Revision(Model):
    id: Id
    artifact_id: Id
    revision_number: Version
    parent_revision_id: Id | None
    author_id: Id
    author_kind: Literal['human', 'worker']
    body: ProductBody
    body_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    source_dependencies: list[SourceRef] = Field(max_length=50)
    created_at: AwareDatetime = Field(default_factory=now)


class Artifact(Model):
    id: Id
    workspace_id: Id
    assignment_id: Id | None = None
    conversation_id: Id | None = None
    current_revision_id: Id
    current_revision: Revision
    requested_revision: Revision | None = None
    observed_at: AwareDatetime = Field(default_factory=now)


class Proposal(Model):
    id: Id
    workspace_id: Id
    assignment_id: Id | None = None
    conversation_id: Id | None = None
    artifact_id: Id
    base_revision_id: Id
    base_work_version: Version
    body: ProductBody
    body_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    source_dependencies: list[SourceRef] = Field(max_length=50)
    reason: Text
    status: Literal['pending', 'accepted', 'dismissed'] = 'pending'
    accepted_revision_id: Id | None = None
    created_at: AwareDatetime = Field(default_factory=now)


class HumanSave(Command):
    expected_current_revision_id: Id
    body: ProductBody


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
