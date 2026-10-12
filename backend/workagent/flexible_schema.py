"""Explicit all-required provider DTOs; never rewrite a supplied JSON schema.

These keep the durable shapes while making nullable/defaulted API properties
required in model selection. Validators/bounds are inherited unchanged.
"""
from typing import Annotated, Literal
from pydantic import Field, model_validator
from .flexible_models import (Block,Body,TableField,StructuredTableBody,ViewSource,
    EmptyPayload,EmptyPayloadSchema,ReadBindingAction,ViewBinding,CustomViewBody)
from .model_base import Text


class DraftBlock(Block):
    checked: bool | None


class DraftDocument(Body):
    blocks: list[DraftBlock] = Field(min_length=1,max_length=200)

    @model_validator(mode='after')
    def byte_bound(self):
        from .flexible_models import json_bytes
        if json_bytes(self.model_dump())>96000:
            raise ValueError('draft body exceeds 96000 JSON bytes')
        return self


class DraftField(TableField):
    unit: Annotated[str,Field(min_length=1,max_length=40)] | None
    scale: Annotated[int,Field(strict=True,ge=0,le=6)] | None
    enum: list[Annotated[str,Field(min_length=1,max_length=120)]] | None = Field(max_length=30)


class DraftTable(StructuredTableBody):
    kind: Literal['structured_table']
    version: Literal['structured-table/v1']
    fields: list[DraftField] = Field(min_length=1,max_length=24)
    notes: list[Text] = Field(max_length=10)


class DraftSource(ViewSource):
    css: Annotated[str,Field(max_length=48000)]
    js: Annotated[str,Field(max_length=48000)]


class DraftPayloadSchema(EmptyPayloadSchema):
    type: Literal['object']
    properties: EmptyPayload
    additionalProperties: Literal[False]


class DraftAction(ReadBindingAction):
    kind: Literal['read_binding']
    payload_schema: DraftPayloadSchema


class DraftView(CustomViewBody):
    kind: Literal['custom_view']
    version: Literal['custom-view/v1']
    source: DraftSource
    bindings: list[ViewBinding] = Field(max_length=4)
    actions: list[DraftAction] = Field(max_length=8)


ModelDraftBody = DraftDocument | DraftTable | DraftView
