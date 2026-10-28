"""Versioned capability contracts. Descriptors and model arguments are never authority."""
from typing import Annotated, Literal
from pydantic import AwareDatetime, ConfigDict, Field
from ..model_base import Model, Id, Hash

Name = Annotated[str, Field(pattern=r'^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$', max_length=128)]
Money = Annotated[str, Field(pattern=r'^(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?$')]
Effect = Literal['read', 'local_compute', 'draft', 'external_write']
Category = Literal['local_compute', 'search', 'extraction', 'rendering', 'connector', 'child']


class Contract(Model):
    model_config = ConfigDict(extra='forbid', strict=True, validate_assignment=True)


class CostProfile(Contract):
    category: Category
    reserved_units: int = Field(ge=1, le=1000000)
    unit: Literal['call', 'millisecond']
    reserved_cost_usd: Money = '0'


class CapabilityDescriptorV2(Contract):
    schema_version: Literal['capability-descriptor/v2'] = 'capability-descriptor/v2'
    id: Name
    version: Id
    schema_sha256: Hash
    implementation_sha256: Hash
    transport: Literal['native', 'mcp', 'sandbox', 'browser']
    input_schema: dict
    output_schema: dict
    effects: list[Effect] = Field(min_length=1, max_length=4)
    resource_kinds: list[Id] = Field(max_length=16)
    privacy_classes: list[Literal['public', 'workspace_private']] = Field(min_length=1, max_length=2)
    execution_profile: Id
    cost_profile: CostProfile
    result_byte_limit: int = Field(ge=1, le=1048576)
    timeout_ms: int = Field(ge=1, le=120000)
    retry_policy: Literal['never_resend_unknown'] = 'never_resend_unknown'
    installation_state: Literal['installed', 'not_installed', 'disabled']
    availability_reason: Literal['available', 'needs_consent', 'blocked_by_scope', 'temporarily_unavailable', 'not_installed']
    required_permission_template: Id


class CapabilityPin(Contract):
    id: Name
    version: Id
    schema_sha256: Hash
    implementation_sha256: Hash


class InputRef(Contract):
    kind: Id
    id: Id
    version: Id
    sha256: Hash


class ToolGrantV1(Contract):
    schema_version: Literal['tool-grant/v1'] = 'tool-grant/v1'
    id: Id
    workspace_id: Id
    principal_id: Id
    run_id: Id
    scope_kind: Literal['task'] = 'task'
    scope_id: Id
    capabilities: list[CapabilityPin] = Field(min_length=1, max_length=64)
    resource_selectors: list[InputRef] = Field(max_length=100)
    effects: list[Effect] = Field(min_length=1, max_length=4)
    privacy_classes: list[Literal['public', 'workspace_private']] = Field(min_length=1, max_length=2)
    egress: Literal['none', 'public_https']
    expires_at: AwareDatetime
    access_generation: int = Field(ge=1)
    budget_account_id: Id
    approval_evidence: Id | None = None


class ToolCallV1(Contract):
    schema_version: Literal['tool-call/v1'] = 'tool-call/v1'
    call_id: Id
    capability_id: Name
    capability_version: Id
    arguments: dict
    input_refs: list[InputRef] = Field(max_length=100)
    expected_work_version: int = Field(ge=1)


class ToolCostV1(Contract):
    category: Category
    unit: Literal['call', 'millisecond']
    reserved_units: int = Field(ge=1)
    observed_units: int | None = Field(default=None, ge=0)
    reserved_cost_usd: Money
    observed_cost_usd: Money | None = None
    basis: Literal['reserved', 'provider_reported', 'estimated', 'unknown', 'reconciled']
    elapsed_ms: int = Field(ge=0)
    cpu_ms: int = Field(ge=0)
    billed_cost_usd: None = None


class ToolErrorV1(Contract):
    code: Literal['adapter_failed', 'invalid_output', 'authority_changed', 'outcome_unknown']
    retryable: Literal[False] = False


class ToolObservationV1(Contract):
    schema_version: Literal['tool-observation/v1'] = 'tool-observation/v1'
    call_id: Id
    attempt_id: Id
    run_id: Id
    capability_id: Name
    capability_version: Id
    implementation_sha256: Hash
    execution_profile: Id
    input_refs: list[InputRef]
    output_refs: list[InputRef]
    output_sha256: Hash | None
    output: dict | None
    started_at: AwareDatetime
    ended_at: AwareDatetime
    status: Literal['observed', 'failed', 'cost_only', 'outcome_unknown']
    error: ToolErrorV1 | None
    truncated: bool
    omissions: list[str] = Field(max_length=20)
    source_refs: list[InputRef]
    privacy_label: Literal['public', 'workspace_private']
    cost: ToolCostV1
    verification_scope: Literal['adapter_execution_only'] = 'adapter_execution_only'


class CapabilityPage(Contract):
    schema_version: Literal['capability-page/v2'] = 'capability-page/v2'
    items: list[CapabilityDescriptorV2]


class ToolAttemptView(Contract):
    attempt_id: Id
    run_id: Id
    call_id: Id
    capability_id: Name
    state: Literal['reserved', 'dispatched', 'observed', 'failed', 'cost_only', 'outcome_unknown']
    observation: ToolObservationV1 | None


class ToolAttemptPage(Contract):
    items: list[ToolAttemptView]
    next_after: Id | None = None
