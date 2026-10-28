"""Exact opaque workspace-file contracts. Filenames are display metadata, never paths."""
import csv
import hashlib
import io
import json
from typing import Annotated, Literal
from pydantic import AwareDatetime, Field, model_validator
from .model_base import Model, Id, Hash
from .models import Command
from .document_models import Coverage

MAX_FILE_BYTES = 200000
Filename = Annotated[str, Field(max_length=85, pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(txt|md|markdown|csv|json)$')]
TextMime = Literal['text/plain', 'text/markdown', 'text/csv', 'application/json']
TEXT_MIMES = {'txt': 'text/plain', 'md': 'text/markdown', 'markdown': 'text/markdown',
              'csv': 'text/csv', 'json': 'application/json'}
Content = Annotated[str, Field(min_length=1, max_length=MAX_FILE_BYTES)]
Version = Annotated[int, Field(strict=True, ge=1, le=2147483647)]


def validate_text(content, mime_type):
    raw = content.encode('utf-8')
    if not 0 < len(raw) <= MAX_FILE_BYTES or any(ord(ch) < 32 and ch not in '\r\n\t' for ch in content):
        raise ValueError('bounded UTF-8 text without binary control bytes required')
    # No ZIP/PDF/executable/polyglot upload surface, even under a text suffix.
    text = content.removeprefix('\ufeff')
    if text.startswith(('PK\x03\x04', '%PDF-', '\x7fELF')):
        raise ValueError('binary format is not working text')
    if mime_type == 'application/json':
        def invalid_constant(value):
            raise ValueError('finite JSON required')
        try:
            json.loads(text, parse_constant=invalid_constant)
        except RecursionError as exc:
            raise ValueError('bounded JSON nesting required') from exc
    if mime_type == 'text/csv':
        try:
            list(csv.reader(io.StringIO(text, newline=''), strict=True))
        except csv.Error as exc:
            raise ValueError('invalid bounded CSV') from exc
    return raw


class TextBytes(Model):
    content: Content
    sha256: Hash

    @model_validator(mode='after')
    def exact(self):
        raw = validate_text(self.content, 'text/plain')
        if hashlib.sha256(raw).hexdigest() != self.sha256:
            raise ValueError('exact UTF-8 hash required')
        return self


class WorkingText(TextBytes):
    kind: Literal['text'] = 'text'
    filename: Filename
    mime_type: TextMime

    @model_validator(mode='after')
    def format_matches(self):
        if TEXT_MIMES[self.filename.rsplit('.', 1)[1]] != self.mime_type:
            raise ValueError('filename and MIME mismatch')
        validate_text(self.content, self.mime_type)
        return self


class DocumentEvidence(Model):
    kind: Literal['document']
    document_id: Id
    sha256: Hash


class AttachmentEvidence(Model):
    kind: Literal['attachment']
    message_id: Id
    ref: Id
    sha256: Hash


EvidenceRef = Annotated[DocumentEvidence | AttachmentEvidence, Field(discriminator='kind')]
FileInput = Annotated[WorkingText | DocumentEvidence | AttachmentEvidence, Field(discriminator='kind')]


class CreateWorkspaceFile(Command):
    expected_work_version: Version
    source: FileInput
    refresh_workspace_file_id: Id | None = None
    expected_version_id: Id | None = None

    @model_validator(mode='after')
    def refresh_pair(self):
        if (self.refresh_workspace_file_id is None) != (self.expected_version_id is None):
            raise ValueError('refresh requires an exact previous version')
        if self.refresh_workspace_file_id and isinstance(self.source, WorkingText):
            raise ValueError('use exact-base human edit for working text')
        return self


class FileVersionRef(Model):
    workspace_file_id: Id
    version_id: Id
    sha256: Hash


class WorkspaceFile(Model):
    workspace_file_id: Id
    workspace_id: Id
    conversation_id: Id
    filename: str
    mime_type: str
    storage: Literal['artifact_revision', 'source_snapshot']
    current: FileVersionRef
    byte_length: int = Field(ge=0)
    editable: bool


class WorkspaceFilePage(Model):
    items: list[WorkspaceFile]
    next_after: Id | None = None


class OmittedByteRange(Model):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    sha256: Hash


class FileRange(Model):
    ref: FileVersionRef
    text: str
    offset: int = Field(ge=0)
    next_offset: int = Field(ge=0)
    byte_length: int = Field(ge=0)
    chunk_sha256: Hash
    omitted_ranges: list[OmittedByteRange]
    source_snapshot_id: Id | None = None
    has_utf8_bom: bool
    newline: Literal['none', 'lf', 'crlf', 'cr', 'mixed']


class EditWorkspaceFile(Command, TextBytes):
    expected_work_version: Version
    base_version_id: Id
    base_sha256: Hash


class ProposeFilePatch(EditWorkspaceFile):
    reason: Annotated[str, Field(min_length=1, max_length=10000)]


class AcceptFileProposal(Command):
    expected_current_revision_id: Id
    expected_sha256: Hash
    acknowledge_removed_content: bool = False
    acknowledge_older_proposal: bool = False


class FileComparison(Model):
    left: FileVersionRef
    right: FileVersionRef
    identical: bool
    diff: str
    diff_sha256: Hash
    diff_bytes: int = Field(ge=0)
    omitted_diff_ranges: list[OmittedByteRange]
    left_omitted_ranges: list[OmittedByteRange]
    right_omitted_ranges: list[OmittedByteRange]


class SourceSnapshot(Model):
    snapshot_id: Id
    workspace_file_id: Id
    workspace_id: Id
    conversation_id: Id
    version_number: Version
    parent_snapshot_id: Id | None
    locator: EvidenceRef
    observed_at: AwareDatetime
    version_at: AwareDatetime | None
    original_sha256: Hash
    extraction_sha256: Hash
    original_byte_length: int = Field(ge=0)
    extraction_byte_length: int = Field(ge=0)
    parser_version: str
    extraction_status: str
    coverage: Coverage | None
    omissions: list[str]
    trust_label: Literal['untrusted_evidence'] = 'untrusted_evidence'


ExportFormat = Literal['txt', 'markdown', 'csv', 'json']


class ExportArtifact(Command):
    revision_id: Id
    body_hash: Hash
    format: ExportFormat


class ExportFile(Command):
    version_id: Id
    sha256: Hash
    format: ExportFormat


class GeneratedBlobRef(Model):
    """Bytes live separately from FileBody; future office exporters can reuse this."""
    kind: Literal['generated_blob'] = 'generated_blob'
    blob_id: Id
    sha256: Hash
    byte_length: int = Field(ge=0, le=1048576)
    mime_type: str


class ExportManifest(Model):
    export_id: Id
    workspace_id: Id
    conversation_id: Id | None
    artifact_id: Id | None
    revision_id: Id
    input_sha256: Hash
    workspace_file_id: Id | None
    source_snapshot_id: Id | None
    format: ExportFormat
    filename: Filename
    blob: GeneratedBlobRef
    created_at: AwareDatetime
    annotations: Literal['included', 'not_present', 'explicit_omissions']
    omissions: list[str]
    tool_attempt_id: Id | None = None
    exporter_version: Literal['basic-exports-v1'] = 'basic-exports-v1'


class WorkspaceFilesContract(Model):
    file: WorkspaceFile
    range: FileRange
    comparison: FileComparison
    snapshot: SourceSnapshot
    export: ExportManifest
    create: CreateWorkspaceFile
    edit: EditWorkspaceFile
    propose: ProposeFilePatch
    accept: AcceptFileProposal
    export_file: ExportFile
    export_artifact: ExportArtifact
