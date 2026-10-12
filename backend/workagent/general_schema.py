"""Versioned general decision DTOs. No observations, permissions or repair calls."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .model_base import Model, Id, Hash
from .product_models import Integer, Code
from .responses_transport import FrozenSchema

from .message_models import AttachmentInput,MessageAttachment,ExactTarget
from .flexible_schema import ModelDraftBody


class Closed(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True,frozen=True)

class DecisionTarget(Closed):
    artifact_id: Id
    revision_id: Id
    body_hash: Hash

class AttachmentRef(Closed):
    ref: Id
    sha256: Hash

class Reply(Closed):
    kind: Literal['reply']
    text: Annotated[str,Field(min_length=1,max_length=12000)]

class CSVDecision(Closed):
    kind: Literal['reconcile_csv']
    attachment: AttachmentRef | None
    target: DecisionTarget | None
    rounding: Literal['ROUND_HALF_UP','ROUND_HALF_EVEN']

    @model_validator(mode='after')
    def one_input(self):
        if (self.attachment is None)==(self.target is None):
            raise ValueError('exactly one attachment or target')
        return self

class FormField(Closed):
    name: Annotated[str,Field(pattern=r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')]
    label: Annotated[str,Field(min_length=1,max_length=120)]

class WasmDecision(Closed):
    kind: Literal['run_wasm']
    target: DecisionTarget | None
    code: Code
    entrypoint: Annotated[str,Field(pattern=r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')]
    arguments: list[Integer] = Field(max_length=8)
    input_form: list[FormField] = Field(max_length=8)

    @model_validator(mode='after')
    def bounded(self):
        if len(self.code.encode())>16000 or len(self.arguments)!=len(self.input_form) or len({x.name for x in self.input_form})!=len(self.input_form):
            raise ValueError('bounded WAT and one unique field per argument')
        return self

class PublishDecision(Closed):
    kind: Literal['publish_artifact']
    target: DecisionTarget | None
    body: ModelDraftBody


class GeneralDecision(Closed):
    decision: Reply | CSVDecision | WasmDecision | PublishDecision

class GeneralExplanation(Closed):
    text: Annotated[str,Field(min_length=1,max_length=12000)]

DECISION_SCHEMA=FrozenSchema.freeze(GeneralDecision.model_json_schema(),GeneralDecision)
EXPLANATION_SCHEMA=FrozenSchema.freeze(GeneralExplanation.model_json_schema(),GeneralExplanation)
