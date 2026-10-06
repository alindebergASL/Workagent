"""Provider-free bounded message inputs and immutable exact references."""
from typing import Annotated,Literal
from pydantic import Field,model_validator
from .model_base import Model,Id,Hash

class AttachmentInput(Model):
    filename: Annotated[str, Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(csv|txt)$')]
    mime_type: Literal['text/csv','text/plain']
    content: Annotated[str, Field(min_length=1,max_length=200000)]

    @model_validator(mode='after')
    def bounded(self):
        if len(self.content.encode('utf-8'))>200000 or '\x00' in self.content:
            raise ValueError('bounded UTF-8 text required')
        if self.mime_type != ('text/csv' if self.filename.endswith('.csv') else 'text/plain'):
            raise ValueError('MIME mismatch')
        return self

class MessageAttachment(AttachmentInput):
    ref: Id
    sha256: Hash
    byte_length: Annotated[int, Field(strict=True,ge=1,le=200000)]

    @model_validator(mode='after')
    def exact(self):
        from hashlib import sha256
        if self.sha256!=sha256(self.content.encode()).hexdigest() or self.byte_length!=len(self.content.encode()):
            raise ValueError('exact attachment bytes required')
        return self

class ExactTarget(Model):
    artifact_id: Id
    revision_id: Id
    body_hash: Hash
