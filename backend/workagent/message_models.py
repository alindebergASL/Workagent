"""Provider-free bounded message inputs and immutable exact references."""
from typing import Annotated,Literal
from pydantic import Field,model_validator
from .model_base import Model,Id,Hash

TEXT_EXTENSIONS=('csv','txt','md','py','js','jsx','ts','tsx','json','yaml','yml','toml','xml','html','css','sql','sh','wat','log')
ATTACHMENT_COUNT=2
ATTACHMENT_BYTES=200000
ATTACHMENT_FILENAME_LENGTH=85
ATTACHMENT_FILENAME_PATTERN=r'^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.('+ '|'.join(TEXT_EXTENSIONS) +r')$'


def attachment_contract():
    """Generated client contract; admitted files are inert evidence, never tools."""
    return {'schema_version':'workagent/attachments/v1','count':ATTACHMENT_COUNT,
            'total_bytes':ATTACHMENT_BYTES,'file_bytes':ATTACHMENT_BYTES,
            'filename_max_length':ATTACHMENT_FILENAME_LENGTH,'filename_pattern':ATTACHMENT_FILENAME_PATTERN,
            'extensions':list(TEXT_EXTENSIONS),'extension_case':'lowercase_exact',
            'csv_mime':'text/csv','other_mime':'text/plain','encoding':'UTF-8',
            'preserve_bom':True,'normalization':'none','forbidden_characters':['\x00'],
            'hash_basis':'exact retained UTF-8 content','executable':False}


class AttachmentInput(Model):
    filename: Annotated[str, Field(pattern=ATTACHMENT_FILENAME_PATTERN,max_length=ATTACHMENT_FILENAME_LENGTH)]
    mime_type: Literal['text/csv','text/plain']
    content: Annotated[str, Field(min_length=1,max_length=ATTACHMENT_BYTES)]

    @model_validator(mode='after')
    def bounded(self):
        if len(self.content.encode('utf-8'))>ATTACHMENT_BYTES or '\x00' in self.content:
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
