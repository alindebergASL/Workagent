"""Opt-in ongoing lifecycle for canonical Assignments, not a second work store.

A queued wake is a provider-free readiness review. No input can assert completion,
execution, verification, ownership of another principal, or a grant.
"""
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from .models import Assignment, Command, Hash, Id, Model, Text, Version


class ResponsibilityDependency(Model):
    kind: Literal['artifact_revision', 'source_version']
    object_id: Id
    expected_version: Id


class DependencyObservation(ResponsibilityDependency):
    observed_version: Id | None = None
    content_hash: Hash
    changed: bool = False


class ResponsibilityNextAction(Model):
    kind: Literal['continue_work', 'review_dependency', 'request_decision', 'await_event',
                  'obtain_grant', 'obtain_tool']
    description: Text


class ResponsibilityWait(Model):
    kind: Literal['person', 'dependency_change', 'check_in']
    reason: Text


class ResponsibilityPlan(Model):
    current_outcome: Text
    next_action: ResponsibilityNextAction
    dependencies: list[ResponsibilityDependency] = Field(default_factory=list, max_length=50)
    wait: ResponsibilityWait | None = None
    next_check_in_at: AwareDatetime | None = None

    @model_validator(mode='after')
    def valid_wait(self):
        keys = [(d.kind, d.object_id) for d in self.dependencies]
        if len(set(keys)) != len(keys):
            raise ValueError('dependency references must be unique')
        if self.wait and self.wait.kind == 'dependency_change' and not self.dependencies:
            raise ValueError('dependency wait requires an exact dependency')
        if self.wait and self.wait.kind == 'check_in' and self.next_check_in_at is None:
            raise ValueError('check-in wait requires a time')
        return self


class ActivateResponsibility(Command, ResponsibilityPlan):
    expected_work_version: Version


class UpdateResponsibility(Command, ResponsibilityPlan):
    expected_work_version: Version


class ControlResponsibility(Command):
    expected_work_version: Version
    operation: Literal['pause', 'resume', 'cancel', 'takeover']


class ResponsibilityLifecycle(ResponsibilityPlan):
    schema_version: Literal['responsibility/v1'] = 'responsibility/v1'
    state: Literal['active', 'waiting_person', 'waiting_event', 'blocked', 'paused',
                   'cancelled', 'taken_over'] = 'active'
    outcome_status: Literal['unverified', 'needs_review', 'evidenced_preparation'] = 'unverified'
    outcome_evidence: dict | None = None
    observations: list[DependencyObservation] = Field(default_factory=list, max_length=50)
    review_required: bool = False
    blocker: Literal['grant_required', 'tool_required', 'authority_unavailable',
                     'conversation_closed'] | None = None
    check_in_due: bool = False
    conversation_work_version: Version
    wake_id: Id | None = None
    wake_status: Literal['none', 'queued', 'reviewed'] = 'none'
    execution_status: Literal['not_admitted', 'queued', 'running', 'settled', 'blocked'] = 'not_admitted'
    run_id: Id | None = None
    # A material-change key coalesces duplicate deliveries without clearing review.
    last_change_key: str | None = None


class ResponsibilityDetail(Model):
    assignment: Assignment
    lifecycle: ResponsibilityLifecycle
    # This is eligibility for a LOCAL readiness review, never a model-call grant.
    local_review_eligible: bool
    provider_execution_queued: bool = False


class ResponsibilityContinuationRequest(Model):
    """Inert exact-snapshot input to the parent's canonical run-admission seam."""
    assignment_id: Id
    workspace_id: Id
    conversation_id: Id
    owner_id: Id
    wake_id: Id
    expected_work_version: Version
    expected_conversation_work_version: Version
    goal: Text
    completion_criteria: list[Text]
    current_outcome: Text
    next_action: ResponsibilityNextAction
    observations: list[DependencyObservation]
    execution_admitted: bool = False
    run_id: Id | None = None


class ResponsibilityRunBinding(Model):
    schema_version: Literal['responsibility-run/v1'] = 'responsibility-run/v1'
    review_fence: int = Field(ge=1)
    workspace_id: Id
    assignment_id: Id
    conversation_id: Id
    owner_id: Id
    wake_id: Id
    work_version: Version
    conversation_work_version: Version
    observations: list[DependencyObservation] = Field(max_length=50)
    goal: Text
    completion_criteria: list[Text]
    current_outcome: Text
    next_action: ResponsibilityNextAction


class ResponsibilityReviewReceipt(Model):
    responsibility: ResponsibilityDetail
    reviewed_wake_id: Id
    continuation: ResponsibilityContinuationRequest | None = None
    provider_execution_started: bool = False
