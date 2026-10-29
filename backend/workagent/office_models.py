"""Additive office interface; original evidence is never editable JSON metadata."""
from typing import Literal
from pydantic import Field, model_validator
from .model_base import Model, Hash, Id
from .models import Command

class ChartSpec(Model):
    category_column: str = Field(min_length=1, max_length=100)
    value_column: str | None = Field(default=None, min_length=1, max_length=100)
    aggregation: Literal['sum', 'count', 'mean']
    title: str = Field(min_length=1, max_length=200)
    x_label: str = Field(min_length=1, max_length=100)
    y_label: str = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def columns(self):
        from .office_content import text
        for value in (self.category_column, self.value_column, self.title, self.x_label, self.y_label):
            if value is not None: text(value, 200)
        if (self.aggregation == 'count') != (self.value_column is None):
            raise ValueError('count has no value column; sum/mean require one')
        return self

class ChartRow(Model):
    category: str = Field(min_length=1,max_length=100)
    value: str = Field(min_length=1,max_length=1200)
    count: int = Field(ge=1,le=1000)

class ChartResult(Model):
    computation_version: Literal['decimal-grouped-v1'] = 'decimal-grouped-v1'
    input_sha256: Hash
    spec: ChartSpec
    rows: list[ChartRow] = Field(min_length=1, max_length=50)
    null_handling: Literal['reject'] = 'reject'
    decimal_precision: Literal[160] = 160
    rounding: Literal['ROUND_HALF_EVEN'] = 'ROUND_HALF_EVEN'

class OfficeProvenance(Model):
    source_snapshot_id: Id
    original_sha256: Hash
    extraction_sha256: Hash
    parser_version: str
    transformation_version: Literal['office-v1'] = 'office-v1'

class OfficeCell(Model):
    address: str
    kind: Literal['string', 'number', 'boolean', 'blank', 'formula']
    value: str | bool | None
    cached_value: str | bool | None = None

class OfficeSheet(Model):
    name: str
    cells: list[OfficeCell]

class OfficeDocument(Model):
    office_version: Literal['office-v1'] = 'office-v1'
    kind: Literal['document']
    paragraphs: list[str]
    annotations: list[str]

class OfficeWorkbook(Model):
    office_version: Literal['office-v1'] = 'office-v1'
    kind: Literal['workbook']
    sheets: list[OfficeSheet]
    annotations: list[str]
