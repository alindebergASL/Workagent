"""Additive retained boundaries and exact conversation controls."""
from typing import Literal
from pydantic import Field, AwareDatetime, model_validator
from .model_base import Model, Id, Hash
from .models import Command, Version, PostMessage

Phase = Literal['selection','selection_2','selection_3','selection_4','selection_5',
                'selection_6','selection_7','selection_8','final','stop']


class StepReference(Model):
    attempt_id: Id
    phase: Phase
    request_sha256: Hash
    response_id: Id | None
    result_sha256: Hash | None
    operation_hash: Hash | None
    tool_result_sha256: Hash | None


class CheckpointData(Model):
    schema_version: Literal['run-checkpoint/v1'] = 'run-checkpoint/v1'
    principal_id: Id
    access_generation: Version
    run_fence: int = Field(strict=True, ge=0)
    conversation_work_version: Version
    assignment_work_version: Version | None
    assignment_fence: int | None = Field(strict=True, ge=0)
    configuration_sha256: Hash
    runtime_sha256: Hash
    scope_fingerprint: Hash
    context_sha256: Hash | None
    intent_message_id: Id
    intent_sha256: Hash
    latest_human_intent_id: Id | None
    last_observed_phase: Phase
    steps: list[StepReference] = Field(max_length=9)
    pending_proposal_ids: list[Id] = Field(max_length=100)
    waiting: Literal['none','person','event','blocked','unknown','stopped']
    next_safe_action: Literal['resume_phase','continue_slice','await_person','await_event',
                              'reconcile','stopped','settled']


class RunCheckpoint(Model):
    checkpoint_id: Id
    workspace_id: Id
    run_id: Id
    conversation_id: Id
    assignment_id: Id | None
    phase: Phase
    checkpoint_kind: Literal['stage','publication','settlement','responsibility','stop']
    created_at: AwareDatetime
    checkpoint_hash: Hash
    data: CheckpointData
    # Read-time capability projection, not part of immutable data/hash.
    continuation_supported: bool = False


class StopRun(Command):
    expected_work_version: Version
    run_id: Id


class RunCheckpointPage(Model):
    items: list[RunCheckpoint] = Field(max_length=100)


class ContinueRun(Command):
    expected_work_version: Version
    checkpoint_id: Id
    checkpoint_hash: Hash


class CancelQueuedMessage(Command):
    expected_queue_version: Version


class QueuedMessage(Model):
    id: Id
    conversation_id: Id
    owner_id: Id
    position: int = Field(strict=True, ge=1)
    queue_version: Version = 1
    created_at: AwareDatetime
    intent: PostMessage
    admission_work_version: Version
    access_generation: Version
    dependency_fingerprint: Hash
    state: Literal['pending','held','admitted','cancelled'] = 'pending'
    reason: Literal['work_changed','scope_changed','authority_unavailable','outcome_unknown','paused'] | None = None
    run_id: Id | None = None

    @model_validator(mode='after')
    def exact_state(self):
        if (self.state=='admitted') != (self.run_id is not None):
            raise ValueError('only admitted queue entries have a run')
        if self.state=='held' and self.reason is None:
            raise ValueError('held queue entries require an explicit reason')
        return self


class QueuedMessagePage(Model):
    items: list[QueuedMessage] = Field(max_length=100)
