"""Bounded derived current-work DTOs; never a second state or authority store."""
from typing import Literal
from pydantic import Field
from .models import Model, Id, Hash, Version, ProductBody, WorkAreaMetadata, ExactTarget
from .responsibility_models import ResponsibilityLifecycle


class WorkAreaArtifact(Model):
    artifact_id: Id
    revision_id: Id
    revision_number: Version
    body_hash: Hash
    author_id: Id
    author_kind: Literal['human', 'worker']
    body: ProductBody | None
    body_omitted: bool


class WorkAreaProposal(Model):
    proposal_id: Id
    artifact_id: Id
    base_revision_id: Id
    base_work_version: Version
    body_hash: Hash
    status: Literal['pending', 'accepted', 'dismissed']
    accepted_revision_id: Id | None
    base_is_current: bool
    stale: bool  # Pending proposal whose immutable base is no longer current.


class WorkAreaResponsibility(Model):
    assignment_id: Id
    work_version: Version
    owner_id: Id
    lifecycle_sha256: Hash
    lifecycle: ResponsibilityLifecycle | None
    lifecycle_omitted: bool


class WorkAreaOmissions(Model):
    artifacts: int = Field(ge=0)
    proposals: int = Field(ge=0)
    responsibilities: int = Field(ge=0)
    saved_bodies: int = Field(ge=0)
    lifecycles: int = Field(ge=0)
    proposal_bodies: Literal['not_in_projection'] = 'not_in_projection'
    historical_revisions: Literal['not_in_projection'] = 'not_in_projection'


class WorkAreaContext(Model):
    schema_version: Literal['work-area-context/v1'] = 'work-area-context/v1'
    provenance: Literal['canonical_current_work'] = 'canonical_current_work'
    conversation_id: Id
    conversation_work_version: Version
    purpose: WorkAreaMetadata | None
    artifacts: list[WorkAreaArtifact] = Field(max_length=12)
    proposals: list[WorkAreaProposal] = Field(max_length=20)
    responsibilities: list[WorkAreaResponsibility] = Field(max_length=8)
    offered_targets: list[ExactTarget] = Field(max_length=12)
    omissions: WorkAreaOmissions
    truncated: bool
