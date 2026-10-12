"""Small self-describing work formats; generated source is inert backend data."""
import json
import re
from typing import Annotated, Literal
from pydantic import Field, StrictBool, StrictInt, StrictStr, model_validator
from .model_base import Model, Id, Text, Hash


def json_bytes(value):
    return len(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8'))


class Block(Model):
    block_id: Id
    kind: Literal['heading', 'paragraph', 'checklist', 'protected_note']
    text: Text
    checked: bool | None = None

    @model_validator(mode='after')
    def checklist_state(self):
        if self.checked is not None and self.kind != 'checklist':
            raise ValueError('checked is only valid for checklist blocks')
        return self


class Body(Model):
    # Historical document shape and hashes are unchanged.
    title: Annotated[str, Field(min_length=1, max_length=240)]
    blocks: list[Block] = Field(min_length=1, max_length=200)

    @model_validator(mode='after')
    def unique_blocks(self):
        if len({b.block_id for b in self.blocks}) != len(self.blocks):
            raise ValueError('block IDs must be unique')
        return self


FieldKey = Annotated[str,Field(pattern=r'^[a-z][a-z0-9_]{0,47}$')]
ActionName = Annotated[str,Field(pattern=r'^[a-z][a-z0-9_.-]{0,63}$')]
Cell = StrictStr | StrictInt | StrictBool | None


class TableField(Model):
    key: FieldKey
    label: Annotated[str,Field(min_length=1,max_length=120)]
    type: Literal['text','integer','decimal','boolean','enum']
    editable: bool
    unit: Annotated[str,Field(min_length=1,max_length=40)] | None = None
    scale: Annotated[int,Field(strict=True,ge=0,le=6)] | None = None
    enum: list[Annotated[str,Field(min_length=1,max_length=120)]] | None = Field(default=None,max_length=30)

    @model_validator(mode='after')
    def semantics(self):
        if (self.type=='decimal') != (self.scale is not None):
            raise ValueError('decimal fields require an explicit scale; other fields forbid scale')
        if (self.type=='enum') != (self.enum is not None):
            raise ValueError('enum fields require choices; other fields forbid enum')
        if self.enum is not None and (not self.enum or len(set(self.enum))!=len(self.enum)):
            raise ValueError('nonempty unique enum choices required')
        if self.unit is not None and self.type not in ('integer','decimal'):
            raise ValueError('units only on numeric fields')
        return self


class TableCell(Model):
    field_key: FieldKey
    value: Cell


class TableRow(Model):
    row_id: Id
    cells: list[TableCell] = Field(max_length=24)


class StructuredTableBody(Model):
    kind: Literal['structured_table'] = 'structured_table'
    version: Literal['structured-table/v1'] = 'structured-table/v1'
    title: Annotated[str,Field(min_length=1,max_length=240)]
    fields: list[TableField] = Field(min_length=1,max_length=24)
    rows: list[TableRow] = Field(max_length=200)
    notes: list[Text] = Field(default_factory=list,max_length=10)

    @model_validator(mode='after')
    def cells(self):
        keys={f.key for f in self.fields}
        if len(keys)!=len(self.fields) or len({r.row_id for r in self.rows})!=len(self.rows):
            raise ValueError('unique stable field keys and row IDs required')
        for row in self.rows:
            values={cell.field_key:cell.value for cell in row.cells}
            if set(values)!=keys or len(values)!=len(row.cells): raise ValueError('each row must contain every field once, using null for missing values')
            for f in self.fields:
                v=values[f.key]
                if v is None: continue
                valid=(f.type=='text' and type(v) is str and len(v)<=2000 or
                       f.type=='integer' and type(v) is int and abs(v)<=9007199254740991 or
                       f.type=='boolean' and type(v) is bool or
                       f.type=='enum' and type(v) is str and v in (f.enum or []) or
                       f.type=='decimal' and type(v) is str and bool(re.fullmatch(r'-?(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?',v))
                       and (len(v.split('.')[1]) if '.' in v else 0)<=(f.scale or 0))
                if not valid: raise ValueError('cell does not match declared type/scale/enum')
        if json_bytes(self.model_dump())>48000: raise ValueError('structured table exceeds 48000 JSON bytes')
        return self


class ViewSource(Model):
    html: Annotated[str,Field(min_length=1,max_length=48000)]
    css: Annotated[str,Field(max_length=48000)] = ''
    js: Annotated[str,Field(max_length=48000)] = ''

    @model_validator(mode='after')
    def bound(self):
        if sum(len(x.encode('utf-8')) for x in (self.html,self.css,self.js))>48000:
            raise ValueError('source exceeds 48000 UTF-8 bytes')
        return self


class ViewBinding(Model):
    name: ActionName
    artifact_id: Id
    revision_id: Id
    body_hash: Hash


class EmptyPayload(Model):
    pass


class EmptyPayloadSchema(Model):
    # Deliberately NOT an arbitrary JSON-schema interpreter.
    type: Literal['object'] = 'object'
    properties: EmptyPayload = Field(default_factory=EmptyPayload)
    additionalProperties: Literal[False] = False


class ReadBindingAction(Model):
    name: ActionName
    kind: Literal['read_binding'] = 'read_binding'
    binding: ActionName
    payload_schema: EmptyPayloadSchema = Field(default_factory=EmptyPayloadSchema)


class CustomViewBody(Model):
    kind: Literal['custom_view'] = 'custom_view'
    version: Literal['custom-view/v1'] = 'custom-view/v1'
    title: Annotated[str,Field(min_length=1,max_length=240)]
    source: ViewSource
    fallback: Annotated[str,Field(min_length=1,max_length=12000)]
    access_generation: Annotated[int,Field(strict=True,ge=1,le=2147483647)]
    bindings: list[ViewBinding] = Field(default_factory=list,max_length=4)
    actions: list[ReadBindingAction] = Field(default_factory=list,max_length=8)

    @model_validator(mode='after')
    def declarations(self):
        names={b.name for b in self.bindings}
        if len(names)!=len(self.bindings) or len({a.name for a in self.actions})!=len(self.actions):
            raise ValueError('unique binding and action names required')
        if any(a.binding not in names for a in self.actions):
            raise ValueError('action must reference a declared exact binding')
        if not self.fallback.strip() or json_bytes(self.model_dump())>96000:
            raise ValueError('readable fallback required; body limited to 96000 JSON bytes')
        return self


DraftBody = Body | StructuredTableBody | CustomViewBody


class DraftObservation(Model):
    # Observation of validation/persistence only, never of generated code execution.
    kind: Literal['artifact_draft'] = 'artifact_draft'
    validation: Literal['shape_only'] = 'shape_only'
    goal_status: Literal['needs_validation'] = 'needs_validation'
    generated_code_executed: Literal[False] = False


def check_table_edit(before,after):
    """Surviving field identities cannot silently acquire different semantics."""
    old={f.key:f for f in before.fields}; new={f.key:f for f in after.fields}
    for key,f in old.items():
        if key in new and f.model_dump(exclude={'label'})!=new[key].model_dump(exclude={'label'}):
            raise ValueError('existing field type/unit/scale/enum/editability is immutable; use a new key')
        if not f.editable:
            if key not in new: raise ValueError('read-only field cannot be deleted')
            rows={r.row_id:r for r in after.rows}
            if any(r.row_id not in rows or
                   next(cell.value for cell in rows[r.row_id].cells if cell.field_key==key)!=
                   next(cell.value for cell in r.cells if cell.field_key==key) for r in before.rows):
                raise ValueError('read-only cells and their row identities cannot be changed')
