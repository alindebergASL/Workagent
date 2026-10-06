"""Typed local product data. No editable body can assert observed execution."""
import hashlib
from typing import Annotated, Literal
from pydantic import Field, model_validator, field_serializer
from .model_base import Model, Id, Text, Hash

CSVText = Annotated[str, Field(min_length=1, max_length=200000)]
Code = Annotated[str, Field(min_length=1, max_length=16000)]
Integer = Annotated[int, Field(strict=True, ge=-1000000000, le=1000000000)]

class InputField(Model):
    name: Annotated[str, Field(pattern=r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')]
    label: Annotated[str, Field(min_length=1,max_length=120)]
    type: Literal['integer'] = 'integer'
    minimum: Literal[-1000000000] = -1000000000
    maximum: Literal[1000000000] = 1000000000

class ProductTarget(Model):
    artifact_id: Id | None = None
    base_revision_id: Id | None = None
    @model_validator(mode='after')
    def paired(self):
        if (self.artifact_id is None) != (self.base_revision_id is None):
            raise ValueError('artifact and exact base required together')
        return self

class ReconcileCSV(ProductTarget):
    kind: Literal['reconcile_csv']
    input_csv: CSVText | None = None
    rounding: Literal['ROUND_HALF_UP','ROUND_HALF_EVEN'] = 'ROUND_HALF_UP'
    @model_validator(mode='after')
    def initial(self):
        if not self.artifact_id and self.input_csv is None:
            raise ValueError('initial CSV attachment required')
        if self.artifact_id and self.input_csv is not None:
            raise ValueError('edit saved source CSV with human_save before recalculation')
        return self

class RunWasm(ProductTarget):
    kind: Literal['run_wasm']
    code: Code | None = None
    entrypoint: Annotated[str, Field(pattern=r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')] = 'total'
    arguments: list[Integer] = Field(max_length=8)
    input_form: list[InputField] = Field(max_length=8)
    @model_validator(mode='after')
    def shape(self):
        if not self.artifact_id and self.code is None:
            raise ValueError('initial code attachment required')
        if len(self.arguments)!=len(self.input_form) or len({f.name for f in self.input_form})!=len(self.input_form):
            raise ValueError('one unique form field per argument required')
        return self

LocalOperation = Annotated[ReconcileCSV | RunWasm, Field(discriminator='kind')]

class TableBody(Model):
    kind: Literal['table'] = 'table'
    title: Annotated[str, Field(min_length=1,max_length=240)]
    source_csv: CSVText
    rounding: Literal['ROUND_HALF_UP','ROUND_HALF_EVEN']
    columns: list[str] = Field(max_length=33)
    rows: list[dict[str,str]] = Field(max_length=500)
    notes: list[Text] = Field(default_factory=list,max_length=30)
    # Cells are editable draft data; only a separate observation attests calculation.
    @model_validator(mode='after')
    def bounded(self):
        import json, re
        if not self.columns or len(set(self.columns))!=len(self.columns) or any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_ ]{0,63}',x) for x in self.columns):
            raise ValueError('safe unique columns required')
        if not self.rows or any(set(row)!=set(self.columns) for row in self.rows):
            raise ValueError('rectangular nonempty table required')
        if len(json.dumps(self.model_dump(),ensure_ascii=False).encode())>220000:
            raise ValueError('table body exceeds bound')
        if any(len(k)>64 or len(v)>2000 for row in self.rows for k,v in row.items()):
            raise ValueError('cell bounds exceeded')
        return self

class FileBody(Model):
    kind: Literal['file'] = 'file'
    title: Annotated[str, Field(min_length=1,max_length=240)]
    filename: Annotated[str, Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(csv|wat|txt)$')]
    mime_type: Literal['text/csv','text/plain','application/wasm-text']
    content: CSVText
    content_sha256: Hash
    @model_validator(mode='after')
    def exact_bytes(self):
        if len(self.content.encode())>200000 or hashlib.sha256(self.content.encode()).hexdigest()!=self.content_sha256:
            raise ValueError('bounded content and exact UTF-8 digest required')
        expected={'.csv':'text/csv','.wat':'application/wasm-text','.txt':'text/plain'}
        if self.mime_type!=expected['.'+self.filename.rsplit('.',1)[-1]]:
            raise ValueError('filename and MIME mismatch')
        if self.mime_type=='text/csv':
            import csv,io,re
            try:
                for row in csv.reader(io.StringIO(self.content,newline=''),strict=True):
                    for cell in row:
                        if '\x00' in cell or (cell.lstrip().startswith(('=','+','-','@')) and not re.fullmatch(r'-?[0-9]+(?:\.[0-9]+)?',cell)):
                            raise ValueError('unsafe spreadsheet cell')
            except csv.Error as exc:
                raise ValueError('invalid CSV file') from exc
        return self

class ToolBody(Model):
    kind: Literal['tool'] = 'tool'
    title: Annotated[str, Field(min_length=1,max_length=240)]
    code: Code
    entrypoint: Annotated[str, Field(pattern=r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')]
    arguments: list[Integer] = Field(max_length=8)
    input_form: list[InputField] = Field(max_length=8)
    notes: list[Text] = Field(default_factory=list,max_length=30)
    @model_validator(mode='after')
    def form(self):
        if len(self.code.encode())>16000 or len(self.arguments)!=len(self.input_form) or len({x.name for x in self.input_form})!=len(self.input_form):
            raise ValueError('bounded code and unique input fields required')
        return self

class ProductResult(Model):
    kind: Literal['table','file','tool']
    artifact_id: Id
    revision_id: Id | None = None
    proposal_id: Id | None = None
    observation_id: Id

class CSVObservation(Model):
    kind: Literal['reconcile_csv'] = 'reconcile_csv'
    input_sha256: Hash
    formula: str
    rounding: Literal['ROUND_HALF_UP','ROUND_HALF_EVEN']
    reported_sum: str
    expected_sum: str
    discrepancies: list[str]
    source_values_preserved: Literal[True] = True

class WasmObservation(Model):
    kind: Literal['run_wasm'] = 'run_wasm'
    value: int
    entrypoint: str
    arguments: list[int]
    code_sha256: Hash
    input_sha256: Hash
    engine: Literal['wasmtime-49.0.0']
    execution_observed: Literal[True]
    fuel_consumed: int
    fuel_limit: Literal[50000]
    memory_limit_bytes: Literal[1048576]
    host_imports: Literal[0]

class ModelSelectionBinding(Model):
    attempt_id: Id
    selection_request_sha256: Hash
    selection_response_id: Id
    decision_sha256: Hash
    operation_hash: Hash | None
    base_hash: Hash | None

class ProductObservation(Model):
    id: Id
    workspace_id: Id
    conversation_id: Id
    run_id: Id
    artifact_id: Id
    revision_id: Id | None = None
    proposal_id: Id | None = None
    base_revision_id: Id | None = None
    body_hash: Hash
    operation_hash: Hash
    access_generation: int
    evidence_origin: Literal['controlled_transport','local_tool'] = 'controlled_transport'
    model_selection: ModelSelectionBinding | None = None
    output: CSVObservation | WasmObservation

class WasmObservationResponse(Model):
    # Transport only. Stored observations and kernel results retain exact Python ints.
    kind: Literal['run_wasm'] = 'run_wasm'
    value: Annotated[str, Field(pattern=r'^-?(0|[1-9][0-9]*)$', description='Exact signed i64 return as a decimal string; never parse as a JSON number.')]
    entrypoint: str
    arguments: list[int]
    code_sha256: Hash
    input_sha256: Hash
    engine: Literal['wasmtime-49.0.0']
    execution_observed: Literal[True]
    fuel_consumed: int
    fuel_limit: Literal[50000]
    memory_limit_bytes: Literal[1048576]
    host_imports: Literal[0]

class ProductObservationResponse(Model):
    id: Id
    workspace_id: Id
    conversation_id: Id
    run_id: Id
    artifact_id: Id
    revision_id: Id | None = None
    proposal_id: Id | None = None
    base_revision_id: Id | None = None
    body_hash: Hash
    operation_hash: Hash
    access_generation: int
    evidence_origin: Literal['controlled_transport','local_tool'] = 'controlled_transport'
    model_selection: ModelSelectionBinding | None = None
    output: CSVObservation | WasmObservationResponse

class ObservationReadback(Model):
    observation: ProductObservation
    binding_state: Literal['current_revision','pending_proposal','historical']
    current_scope: bool

    @field_serializer('observation', when_used='json')
    def transport_observation(self, observation: ProductObservation) -> ProductObservationResponse:
        # Adapt at the readback boundary only, including pre-existing immutable rows.
        data = observation.model_dump()
        if isinstance(observation.output, WasmObservation):
            data['output']['value'] = str(observation.output.value)
        return ProductObservationResponse.model_validate(data)

class ResponseStepObservation(Model):
    phase: Literal['selection','final']
    state: Literal['prepared','count_unknown','counted','outcome_unknown','accepted','received','invalid']
    response_id: str | None = None
    reported_input_tokens: int | None = None
    reported_output_tokens: int | None = None
    reserved_cost_usd: str | None = None
    conservatively_calculated_cost_usd: str | None = None
    billed_cost_usd: str | None = None


class RetainedLocalResult(Model):
    """Read-only journal projection, not a published/accepted product."""
    status: Literal['reply','observed','rejected']
    published: bool
    binding: ModelSelectionBinding
    body: TableBody | ToolBody | None = None
    output: CSVObservation | WasmObservationResponse | None = None
    reason: str | None = None


class TurnState(Model):
    profile: Literal['general-controlled-v1','general-products-controlled-v1','general-responses-v1'] = 'general-controlled-v1'
    run_id: Id
    state: Literal['queued','responding','replied','failed','unavailable','outcome_unknown','cancelled']
    reason: str
    evidence_origin: Literal['controlled_transport','unverified','synthetic_provider_receipt','live_provider_receipt'] = 'controlled_transport'
    provider_observation: Literal['not_observed','pending','received','outcome_unknown','invalid'] = 'not_observed'
    response_steps: list[ResponseStepObservation] = Field(default_factory=list,max_length=2)
    retained_local_result: RetainedLocalResult | None = None
