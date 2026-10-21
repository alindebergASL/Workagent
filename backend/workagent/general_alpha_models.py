"""Additive read DTOs; old persisted product/verification models stay unchanged."""
from typing import Literal
from pydantic import Field
from .model_base import Model, Id, Hash, Text
from .product_models import AdaptiveExecution, AdaptiveVerification, ResponseStepObservation, RetainedLocalResult


class ResponsibilityMutationResult(Model):
    kind: Literal['record_responsibility'] = 'record_responsibility'
    version: Literal['1'] = '1'
    assignment_id: Id
    conversation_id: Id
    owner_id: Id
    work_version: int = Field(ge=1)
    state: Literal['active','waiting_person','waiting_event','blocked']
    outcome_status: Literal['unverified'] = 'unverified'
    execution_status: Literal['not_admitted'] = 'not_admitted'


class AlphaStep(Model):
    phase: Literal['selection','selection_2','selection_3','selection_4','selection_5','selection_6','selection_7','selection_8']
    status: Literal['reply','observed','rejected']
    operation_hash: Hash | None = None
    reason: str | None = None
    verification: AdaptiveVerification
    outcome: Literal['continue','answered','completed','waiting_for_user','blocked','step_limit','budget_limit','needs_validation']
    capability_result: dict | None = None
    mutation_result: ResponsibilityMutationResult | None = None
    followthrough_result: dict | None = None


class AlphaExecution(Model):
    runtime_extension: Literal['general-alpha-v1']
    capability: Literal['adaptive-local-v1'] = 'adaptive-local-v1'
    goal: str | None = None
    success_criteria: list[dict] = Field(default_factory=list,max_length=8)
    max_steps: int = Field(ge=1,le=8)
    outcome: Literal['pending','continue','answered','completed','waiting_for_user','blocked','step_limit','budget_limit','needs_validation','cancelled']
    steps: list[AlphaStep] = Field(default_factory=list,max_length=8)
    shared_reserved_cost_usd: str
    shared_cost_limit_usd: str = Field(pattern=r'^(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?$')
    cost_basis: Literal['worst_case_reservations_not_billing'] = 'worst_case_reservations_not_billing'


class ExplanationReadback(Model):
    """Typed retained prose only, never raw reasoning or transport."""
    text: str = Field(min_length=1,max_length=12000)
    attempt_id: Id
    phase: Literal['final'] = 'final'
    authority: Literal['model_explanation_not_verification'] = 'model_explanation_not_verification'
    published: bool


class ResponsibilityOrigin(Model):
    kind: Literal['responsibility_wake'] = 'responsibility_wake'
    assignment_id: Id
    wake_id: Id
    work_version: int = Field(ge=1)


class TurnState(Model):
    profile: Literal['general-controlled-v1','general-products-controlled-v1','general-responses-v1'] = 'general-controlled-v1'
    run_id: Id
    state: Literal['queued','responding','replied','failed','unavailable','outcome_unknown','cancelled']
    reason: str
    evidence_origin: Literal['controlled_transport','unverified','synthetic_provider_receipt','live_provider_receipt'] = 'controlled_transport'
    provider_observation: Literal['not_observed','pending','received','outcome_unknown','invalid'] = 'not_observed'
    response_steps: list[ResponseStepObservation] = Field(default_factory=list,max_length=9)
    adaptive: AlphaExecution | AdaptiveExecution | None = None
    retained_local_result: RetainedLocalResult | None = None
    explanation: ExplanationReadback | None = None
    responsibility_origin: ResponsibilityOrigin | None = None
    responsibility_recording: ResponsibilityMutationResult | None = None
