"""Bounded decoder for the previous two-branch document block contract.

Rebuild only the known publication DTOs, never a supplied/provider schema.
Requests, count bytes and grant bindings are not rewritten. Other publication
formats and decision branches keep their exact validators.
"""
from functools import lru_cache
from hashlib import sha256
from typing import Literal, Union, get_args
from pydantic import Field, create_model, model_validator
from .flexible_models import Block, Body, json_bytes
from .flexible_schema import DraftTable, DraftView
from .responses_transport import FrozenSchema, TransportError


class DraftTextBlock(Block):
    kind: Literal['heading', 'paragraph', 'protected_note']
    checked: None


class DraftChecklistBlock(Block):
    kind: Literal['checklist']
    checked: bool = Field(description='Explicit completion state: false for an unfinished task, true only when actually completed.')


class DraftDocument(Body):
    blocks: list[DraftTextBlock | DraftChecklistBlock] = Field(min_length=1,max_length=200)

    @model_validator(mode='after')
    def byte_bound(self):
        if json_bytes(self.model_dump())>96000:
            raise ValueError('draft body exceeds 96000 JSON bytes')
        return self


def previous_schema(schema,*,nullable_checklist=False):
    # Normalize omitted/explicit defaults BEFORE caching: FrozenSchema equality
    # also binds the decoder class, so duplicate create_model classes are not
    # interchangeable merely because their exported bytes happen to match.
    return _previous_schema(schema,nullable_checklist)


@lru_cache(maxsize=None)
def _previous_schema(schema,nullable_checklist):
    """Exact predecessor of a trusted exported decision schema, not an upgrader."""
    from .general_schema import PublishDecision
    document=DraftDocument
    if nullable_checklist:
        # Pre-explicit-state requests allowed null on checklist blocks. Keep
        # that exact decoder for old bytes, never for fresh model selections.
        checklist=create_model('DraftChecklistBlock',__base__=Block,
            kind=(Literal['checklist'],...),checked=(bool | None,...))
        document=create_model('DraftDocument',__base__=DraftDocument,
            blocks=(list[DraftTextBlock | checklist],Field(min_length=1,max_length=200)))
    choices=get_args(schema.model.model_fields['decision'].annotation)
    old=[]
    for choice in choices:
        if issubclass(choice,PublishDecision):
            choice=create_model(choice.__name__,__base__=choice,
                body=(document | DraftTable | DraftView,...))
        old.append(choice)
    if old==list(choices):
        return schema
    model=create_model(schema.model.__name__,__base__=schema.model,__doc__=schema.model.__doc__,
                       decision=(Union[tuple(old)],...))
    return FrozenSchema.freeze(model.model_json_schema(),model)


def historical_schemas(schema):
    return (previous_schema(schema),previous_schema(schema,nullable_checklist=True))


def matches_schema_pin(pin,schema):
    # Preserve activation of the SAME capability variant on historical grants.
    # No profile, capability, or authority is added by recognizing its predecessor.
    return pin in {sha256(s.material).hexdigest() for s in (schema,*historical_schemas(schema))}


def decode_retained(c,attempt_id,phase,model,value):
    """Caller has authenticated the receipt; use its exact bounded decoder."""
    import json
    row=c.execute('SELECT request_bytes FROM responses_steps WHERE attempt_id=%s AND phase=%s',
                  (attempt_id,phase)).fetchone()
    expected=FrozenSchema.freeze(model.model_json_schema(),model)
    schema=restore_schema(json.loads(row['request_bytes'])['tools'][0]['parameters'],expected)
    return schema.model.model_validate(value,strict=True)


def restore_schema(parameters,expected):
    """Resolve only this variant's exact current/prior schemas; fail closed."""
    from .service import canonical
    from .composition import (DECISION_SCHEMA, CONTINUITY_DECISION_SCHEMA,
                              LEGACY_DECISION_SCHEMA, LEGACY_CONTINUITY_DECISION_SCHEMA)
    candidates=[expected,*historical_schemas(expected)]
    if expected==DECISION_SCHEMA:
        candidates.extend((LEGACY_DECISION_SCHEMA,*historical_schemas(LEGACY_DECISION_SCHEMA)))
    elif expected==CONTINUITY_DECISION_SCHEMA:
        candidates.extend((LEGACY_CONTINUITY_DECISION_SCHEMA,*historical_schemas(LEGACY_CONTINUITY_DECISION_SCHEMA)))
    material=canonical(parameters).encode()
    for schema in candidates:
        if material==schema.material:
            return schema
    raise TransportError('schema_validator_mismatch')
