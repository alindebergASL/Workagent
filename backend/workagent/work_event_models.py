"""Public B2.3 metadata contracts; no raw bodies or receipt payloads."""
from typing import Annotated, Literal
from pydantic import AwareDatetime, Field
from .model_base import Model, Id, Hash
from .models import Command
from .responsibility_models import ResponsibilityNextAction

OpaqueCursor = Annotated[str, Field(min_length=1, max_length=128)]
EventType = Literal['conversation.changed', 'message.created', 'run.changed',
                    'artifact.changed', 'revision.created', 'proposal.changed',
                    'responsibility.changed', 'receipt.recorded', 'audit.recorded']
ReasonCode = Literal['material_change', 'created', 'state_changed', 'receipt_retained',
                     'cancelled_unapplied', 'review_required']


class Identity(Model):
    principal_id: Id


class WorkEvent(Model):
    event_id: Id
    type: EventType
    conversation_id: Id
    run_id: Id | None = None
    artifact_id: Id | None = None
    proposal_id: Id | None = None
    assignment_id: Id | None = None
    occurred_at: AwareDatetime
    reason_code: ReasonCode


class EventPage(Model):
    events: list[WorkEvent] = Field(max_length=100)
    next_cursor: OpaqueCursor
    has_more: bool
    reset_required: bool = False
    checked_at: AwareDatetime


class CurrentExecution(Model):
    run_id: Id | None = None
    state: Literal['queued', 'running', 'awaiting_provider', 'recovering', 'stale',
                   'stopped', 'waiting_person', 'blocked', 'unknown', 'idle']
    reason: Literal['unknown_external_outcome', 'invalid_response', 'authority_or_budget',
                    'internal_error', 'worker_unavailable', 'work_blocked', 'source_unavailable'] | None = None
    phase: str | None = Field(default=None, max_length=64, pattern=r'^[a-z0-9_-]+$')
    admitted_at: AwareDatetime | None = None
    last_progress_at: AwareDatetime | None = None
    worker_observed_at: AwareDatetime | None = None
    worker_live: bool = False
    admission: Literal['not_admitted', 'admitted'] = 'not_admitted'


class WorkArtifact(Model):
    id: Id
    title: str = Field(max_length=240)
    kind: Literal['table', 'tool', 'file', 'document', 'structured_table', 'custom_view']
    current_revision_id: Id
    body_hash: Hash


class PendingReview(Model):
    proposal_id: Id
    artifact_id: Id
    base_revision_id: Id
    base_work_version: int = Field(ge=1)
    created_at: AwareDatetime
    fresh: bool
    is_latest: bool
    removed_content_count: int = Field(ge=0)


class HistoricalObservation(Model):
    text: str = Field(max_length=10000)
    observed_at: AwareDatetime | None = None


class WorkResponsibility(Model):
    assignment_id: Id
    state: Literal['active', 'waiting_person', 'waiting_event', 'blocked', 'paused', 'cancelled', 'taken_over']
    next_action: ResponsibilityNextAction
    next_check_in_at: AwareDatetime | None = None
    historical_observation: HistoricalObservation | None = None
    review_required: bool


class WorkSnapshot(Model):
    schema_version: Literal['workagent/work-v1'] = 'workagent/work-v1'
    conversation_id: Id
    work_version: int = Field(ge=1)
    access_generation: int = Field(ge=1)
    checked_at: AwareDatetime
    snapshot_cursor: OpaqueCursor
    execution: CurrentExecution
    responsibility: list[WorkResponsibility]
    artifacts: list[WorkArtifact]
    pending_proposals: list[PendingReview]


class AttentionSeen(Command):
    conversation_id: Id
    cursor: OpaqueCursor


class AttentionSeenResult(Model):
    conversation_id: Id
    cursor: OpaqueCursor


class AttentionPage(Model):
    facts: list[WorkEvent] = Field(max_length=100)
    next_cursor: OpaqueCursor
    has_more: bool
    reset_required: bool = False
    checked_at: AwareDatetime
