"""Human read-only discovery, independent of run admission and acceptance."""
from pydantic import Field
from .model_base import Model, Id


class ResponsibilityOutput(Model):
    artifact_id: Id
    revision_id: Id
    title: str
    conversation_id: Id | None
    assignment_id: Id | None


class ResponsibilityOutputPage(Model):
    items: list[ResponsibilityOutput] = Field(max_length=100)
    next_after: Id | None = None
    has_more: bool = False
