"""Additive binary document contracts; no change to exact UTF-8 attachments."""
import base64
import binascii
import hashlib
from typing import Annotated, Literal
from pydantic import Field, model_validator, model_serializer
from .model_base import Model, Id, Hash

MAX_ORIGINAL = 5 * 1024 * 1024
MAX_TEXT = 100 * 1024
PARSER_VERSION = 'confined-documents-v1'
LIMITS = {'input_bytes': MAX_ORIGINAL, 'text_bytes': MAX_TEXT, 'pages': 50,
          'sheets': 10, 'rows': 1000, 'cells': 10000, 'zip_bytes': 20 * 1024 * 1024,
          'zip_entries': 1000, 'zip_ratio': 100}
MIMES = {'pdf': 'application/pdf',
         'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
Filename = Annotated[str, Field(max_length=85, pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.(pdf|docx|xlsx)$')]
Mime = Literal['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']

class DocumentInput(Model):
    filename: Filename
    mime_type: Mime
    content_base64: Annotated[str, Field(min_length=4, max_length=((MAX_ORIGINAL + 2) // 3) * 4)]
    sha256: Hash

    def original(self):
        try:
            raw = base64.b64decode(self.content_base64, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError('canonical base64 required') from exc
        if base64.b64encode(raw).decode('ascii') != self.content_base64:
            raise ValueError('canonical base64 required')
        if not 0 < len(raw) <= MAX_ORIGINAL or hashlib.sha256(raw).hexdigest() != self.sha256:
            raise ValueError('original size or hash mismatch')
        ext = self.filename.rsplit('.', 1)[1]
        if self.mime_type != MIMES[ext] or not raw.startswith(b'%PDF-' if ext == 'pdf' else b'PK\x03\x04'):
            raise ValueError('document MIME/magic mismatch')
        return raw

    @model_validator(mode='after')
    def valid_original(self):
        self.original()
        return self

class DocumentRef(Model):
    document_id: Id
    sha256: Hash

Count = Annotated[int, Field(strict=True, ge=0, le=9007199254740991)]
SmallText = Annotated[str, Field(max_length=320)]
Status = Literal['extracted', 'truncated', 'needs_ocr', 'unsupported', 'encrypted', 'failed', 'unavailable']

class SheetCoverage(Model):
    name: Annotated[str, Field(max_length=31)]
    state: Literal['visible', 'hidden', 'veryHidden']
    total_rows: Count
    total_columns: Count
    covered_rows: Annotated[int, Field(strict=True, ge=0, le=1000)]
    merged_ranges: list[Annotated[str, Field(max_length=40)]] = Field(max_length=100)
    omitted_merged_ranges: Count
    visited_cells: Annotated[int, Field(strict=True, ge=0, le=10000)]
    last_cell: Annotated[str, Field(max_length=20)] | None
    partial_last_row: Annotated[bool, Field(strict=True)]
    omitted_rows: Count
    omitted_cell_positions: Count

    @model_validator(mode='after')
    def positions_match(self):
        if (self.total_rows != self.covered_rows + self.omitted_rows
                or self.total_rows * self.total_columns != self.visited_cells + self.omitted_cell_positions):
            raise ValueError('invalid sheet position coverage')
        return self

class Coverage(Model):
    omissions: list[SmallText] = Field(max_length=30)
    total_pages: Count | None = None
    covered_pages: Annotated[int, Field(strict=True, ge=0, le=50)] | None = None
    omitted_pages: Count | None = None
    empty_pages_needing_ocr: list[Annotated[int, Field(strict=True, ge=1, le=50)]] | None = Field(default=None, max_length=50)
    partial_last_page: bool | None = Field(default=None, strict=True)
    total_paragraphs: Count | None = None
    omitted_paragraphs: Count | None = None
    total_tables: Count | None = None
    omitted_tables: Count | None = None
    paragraphs_covered: Count | None = None
    tables_covered: Count | None = None
    partial_last_block: bool | None = Field(default=None, strict=True)
    total_sheets: Count | None = None
    covered_sheets: Annotated[int, Field(strict=True, ge=0, le=10)] | None = None
    omitted_sheets: Count | None = None
    sheets: list[SheetCoverage] | None = Field(default=None, max_length=10)
    covered_rows: Annotated[int, Field(strict=True, ge=0, le=1000)] | None = None
    visited_cells: Annotated[int, Field(strict=True, ge=0, le=10000)] | None = None

    @model_serializer(mode='wrap')
    def omit_unused_format_fields(self, handler):
        return {key: value for key, value in handler(self).items() if value is not None}

    @model_validator(mode='after')
    def counts_match(self):
        if self.total_pages is not None:
            if (self.covered_pages is None or self.omitted_pages is None
                    or self.total_pages != self.covered_pages + self.omitted_pages
                    or self.empty_pages_needing_ocr is None or self.partial_last_page is None
                    or any(page > self.covered_pages for page in self.empty_pages_needing_ocr)):
                raise ValueError('invalid page coverage')
        if self.total_paragraphs is not None:
            if (self.paragraphs_covered is None or self.omitted_paragraphs is None
                    or self.total_paragraphs != self.paragraphs_covered + self.omitted_paragraphs
                    or self.total_tables is None or self.tables_covered is None or self.omitted_tables is None
                    or self.total_tables != self.tables_covered + self.omitted_tables):
                raise ValueError('invalid document block coverage')
        if self.total_sheets is not None:
            if (self.covered_sheets is None or self.omitted_sheets is None or self.sheets is None
                    or self.total_sheets != self.covered_sheets + self.omitted_sheets
                    or len(self.sheets) != self.covered_sheets):
                raise ValueError('invalid sheet coverage')
        return self

class Extraction(Model):
    parser_version: Literal['confined-documents-v1'] = PARSER_VERSION
    status: Status
    reason: Annotated[str, Field(max_length=160)]
    text: Annotated[str, Field(max_length=MAX_TEXT)] = ''
    text_sha256: Hash
    original_sha256: Hash
    limits: dict[str, Count]
    # Coverage is bounded JSON with format-specific counts, sheet and omission details.
    coverage: Coverage

    @model_validator(mode='after')
    def exact(self):
        import json
        if (self.limits != LIMITS or len(self.text.encode()) > MAX_TEXT or '\x00' in self.text
                or hashlib.sha256(self.text.encode()).hexdigest() != self.text_sha256
                or len(json.dumps(self.coverage.model_dump()).encode()) > 65536):
            raise ValueError('invalid extraction manifest')
        if self.status in ('unsupported', 'encrypted', 'failed', 'unavailable', 'needs_ocr') and self.text:
            raise ValueError('unavailable extraction cannot fabricate text')
        return self

class DocumentMetadata(DocumentRef):
    workspace_id: Id
    conversation_id: Id
    owner_id: Id
    filename: Filename
    mime_type: Mime
    byte_length: Annotated[int, Field(strict=True, ge=1, le=MAX_ORIGINAL)]
    status: Status
    reason: Annotated[str, Field(max_length=160)]
    parser_version: Literal['confined-documents-v1']
    text_sha256: Hash
    text_bytes: Annotated[int, Field(strict=True, ge=0, le=MAX_TEXT)]
    coverage: Coverage
    limits: dict[str, Count]

class DocumentDetail(DocumentMetadata):
    text: Annotated[str, Field(max_length=MAX_TEXT)]

    @model_validator(mode='after')
    def exact_extraction(self):
        Extraction.model_validate({**self.model_dump(include={'status', 'reason', 'text',
            'text_sha256', 'limits', 'coverage', 'parser_version'}), 'original_sha256': self.sha256})
        if self.text_bytes != len(self.text.encode()):
            raise ValueError('document text byte length mismatch')
        return self

class DocumentPage(Model):
    items: list[DocumentMetadata]
    next_cursor: Id | None = None

class MessageDocument(DocumentDetail):
    """Immutable admission snapshot; the original remains in private storage."""
