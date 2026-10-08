"""Human-supplied, bounded checks. Evidence of these cases, not arbitrary intent.

No model DTO can supply this authority. The original human message is immutable;
only the trusted local worker executes it. Full evidence never enters model input.
"""
from copy import deepcopy
from typing import Annotated, Literal
from pydantic import Field, field_validator
from .model_base import Model, Hash

Argument = Annotated[int, Field(strict=True, ge=-1000000000, le=1000000000)]


class AcceptanceCase(Model):
    arguments: list[Argument] = Field(max_length=8)
    expected: Annotated[str, Field(pattern=r'^(0|-?[1-9][0-9]{0,18})$')]

    @field_validator('expected')
    @classmethod
    def signed_i64(cls, value):
        if not -(2**63) <= int(value) < 2**63:
            raise ValueError('expected return must be a signed i64 decimal string')
        return value


class WasmAcceptance(Model):
    kind: Literal['wasm_cases']
    entrypoint: Annotated[str, Field(pattern=r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')]
    cases: list[AcceptanceCase] = Field(min_length=1, max_length=8)


class CSVAcceptance(Model):
    kind: Literal['csv_totals']
    expected_sum: Annotated[str, Field(pattern=r'^(0|[1-9][0-9]{0,20})\.[0-9]{2}$')]
    mismatch_count: Annotated[int, Field(strict=True, ge=0, le=500)]


AcceptanceSpec = Annotated[WasmAcceptance | CSVAcceptance, Field(discriminator='kind')]


class AcceptanceCheck(Model):
    criterion: dict
    actual: str | dict | None = None
    passed: bool = Field(strict=True)


class AcceptanceVerification(Model):
    checker_version: Literal['human-checks-v1'] = 'human-checks-v1'
    scope: Literal['supplied_checks_only'] = 'supplied_checks_only'
    spec: AcceptanceSpec
    spec_sha256: Hash
    body_sha256: Hash | None
    operation_hash: Hash | None
    passed: bool = Field(strict=True)
    checks: list[AcceptanceCheck] = Field(min_length=1, max_length=8)


def evaluate(spec, operation, staged):
    """Run exact human cases against staged bytes, never model example results."""
    from .service import digest
    from .wasm_tool import run_wasm_tool, ToolRejected
    checks=[]
    criteria=spec.cases if isinstance(spec,WasmAcceptance) else [spec]
    for criterion in criteria:
        actual=None; passed=False
        if staged['status']=='observed' and operation is not None:
            try:
                if isinstance(spec,WasmAcceptance) and operation.kind=='run_wasm' and operation.entrypoint==spec.entrypoint:
                    actual=str(run_wasm_tool(staged['body']['code'],spec.entrypoint,criterion.arguments)['value'])
                    passed=actual==criterion.expected
                elif isinstance(spec,CSVAcceptance) and operation.kind=='reconcile_csv':
                    actual={'expected_sum':staged['output']['expected_sum'],
                            'mismatch_count':len(staged['output']['discrepancies'])}
                    passed=actual=={'expected_sum':spec.expected_sum,'mismatch_count':spec.mismatch_count}
            except (ToolRejected,ValueError):
                actual='bounded acceptance check rejected'
        checks.append({'criterion':criterion.model_dump(mode='json'),'actual':actual,'passed':passed})
    return AcceptanceVerification(spec=spec,spec_sha256=digest(spec),
        body_sha256=digest(staged['body']) if staged.get('body') is not None else None,
        operation_hash=staged.get('binding',{}).get('operation_hash'),
        passed=bool(checks) and all(c['passed'] for c in checks),checks=checks).model_dump(mode='json')


def for_model(staged):
    """Keep feedback useful without disclosing cases/expected values or their hashes."""
    result=deepcopy(staged)
    verification=result.get('verification',{})
    automatic=verification.get('automatic')
    if automatic is not None:
        keys=('recognized','passed','failures','scope')
        if automatic['checker_version']=='team-selection-v1':
            keys+=('checker_version','case_count')
        verification['automatic']={key:automatic[key] for key in keys}
    acceptance=verification.get('acceptance')
    if acceptance is not None:
        # Hashing the immutable message includes the held-out expected answers.
        verification.pop('request',None)
        verification['acceptance']={'provided':True,'scope':'supplied_checks_only',
            'passed':acceptance['passed'],'check_count':len(acceptance['checks']),
            'failed_count':sum(not item['passed'] for item in acceptance['checks'])}
    return result
