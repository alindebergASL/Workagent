"""Closed model wire DTOs, distinct from the human/domain API contract."""
from typing import Literal
import re
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .models import Body, Block
from .responses_transport import FrozenSchema

class Wire(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)

class ScopedRead(Wire):
    source_ids: list[str] = Field(min_length=1,max_length=50)
    include_current_body: bool

class SourceBasis(Wire):
    source_id: str = Field(min_length=1,max_length=128)
    external_version: str = Field(min_length=1,max_length=128)
    basis: str = Field(min_length=10,max_length=2000)

class NextAction(Wire):
    title: str = Field(min_length=5,max_length=200)
    next_action: str = Field(min_length=20,max_length=3000)
    missing_information: list[str] = Field(min_length=1,max_length=20)
    specific_judgment: str = Field(min_length=20,max_length=3000)
    source_basis: list[SourceBasis] = Field(min_length=1,max_length=50)
    task_not_performed: Literal[True]
    underlying_action_performed: Literal[False]

    @model_validator(mode='after')
    def no_false_completion(self):
        text=' '.join([self.title,self.next_action,self.specific_judgment,*self.missing_information,*[b.basis for b in self.source_basis]])
        if re.search(r'\b(?:I|we|the agent)\s+(?:have\s+|already\s+)?(?:sent|created|completed|executed|approved|contacted|submitted)\b',text,re.I):
            raise ValueError('external completion claim is not evidence')
        return self

READ_SCHEMA=FrozenSchema.freeze(ScopedRead.model_json_schema(),ScopedRead)
FINAL_SCHEMA=FrozenSchema.freeze(NextAction.model_json_schema(),NextAction)

def scope_registry():
    # A separate pinned, narrow profile tool, not a mutation of archived registries.
    return {'profile':'openai-responses-v1','name':'read_scoped_context',
            'inputSchema':ScopedRead.model_json_schema(),'readOnly':True,
            'authority':'current-worker-capability-and-frozen-selected-source-versions'}

def to_body(value,tool_result,attempt_id):
    permitted={s['id']:s['external_version'] for s in tool_result['sources']}
    if any(permitted.get(b.source_id)!=b.external_version for b in value.source_basis):
        raise ValueError('unread source basis')
    base=tool_result['current_body']
    # Preserve ALL human/base blocks and title, not just protected notes. Changes
    # are an inspectable append-only proposal; never overwrite/rebase human text.
    blocks=[] if base is None else Body.model_validate(base).blocks.copy()
    title=value.title if base is None else base['title']
    additions=[('Next action (proposed)',value.next_action),('Missing information','\n'.join(value.missing_information)),
               ('Specific judgment',value.specific_judgment),
               ('Source basis','\n'.join(f'{b.source_id}@{b.external_version}: {b.basis}' for b in value.source_basis)),
               ('Task not performed','This document prepares a next action only. No task, message, approval, or external action has been performed.')]
    for index,(heading,text) in enumerate(additions):
        blocks.append(Block(block_id=f'{attempt_id}-{index}',kind='paragraph',text=heading+': '+text))
    return Body(title=title,blocks=blocks)
