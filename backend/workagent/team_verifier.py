"""Finite team-selection oracle; model code is only the subject under test."""
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from typing import Literal
from .model_base import Model


class TeamGoalSpec(Model):
    kind: Literal['team_selection'] = 'team_selection'
    max_n: Literal[60] = 60
    default_arguments: tuple[Literal[60], Literal[30]] = (60, 30)
    preserve: Literal['saved_title_and_notes'] = 'saved_title_and_notes'


TEAM_GOAL = re.compile(
    r'(?:please )?(?:build|update|check) a reusable team-selection calculator for choosing k people '
    r'from n candidates, for all integers 0 <= k <= n <= 60\. Start with 60 candidates and 30 people\. '
    r'Keep my notes\.?', re.IGNORECASE)
SUITE_TIMEOUT = 15


def verify_team(message, operation, staged, base, proof):
    from .service import digest
    from .products import byte_hash
    from .product_models import FileBody, ToolBody
    if operation is None or operation.kind != 'run_wasm':
        return ['operation_binding']
    if (staged.get('binding', {}).get('operation_hash') != digest(operation)
        or staged.get('binding', {}).get('base_hash') != proof.base_hash):
        return ['operation_binding']
    target = message.target
    if message.attachments or bool(base) != bool(target):
        return ['input_binding']
    if base and (base.body.kind != 'tool' or target.revision_id != base.id
        or target.body_hash != base.body_hash or digest(base.body) != base.body_hash
        or operation.artifact_id != target.artifact_id or operation.base_revision_id != base.id):
        return ['input_binding']
    if not base and operation.artifact_id is not None:
        return ['input_binding']
    if staged.get('status') != 'observed':
        return ['tool_not_observed']
    try:
        body = ToolBody.model_validate(staged['body'])
        file = FileBody.model_validate(staged['file'])
        code = operation.code if operation.code is not None else base.body.code
        if (body.code != code or body.entrypoint != operation.entrypoint
            or body.arguments != operation.arguments or body.arguments != [60, 30]
            or body.input_form != operation.input_form
            or [field.name for field in body.input_form] != ['n', 'k']):
            return ['operation_binding']
        if body.notes != (base.body.notes if base else []) or (base and body.title != base.body.title):
            return ['source_or_notes']
        if file.content != code or file.mime_type != 'application/wasm-text':
            return ['download']
        output = staged['output']
        material = json.dumps({'entrypoint':body.entrypoint,'arguments':[60,30]},sort_keys=True,separators=(',',':'))
        if (output.get('kind') != 'run_wasm' or output.get('code_sha256') != byte_hash(code)
            or output.get('input_sha256') != byte_hash(material) or output.get('arguments') != [60,30]
            or output.get('entrypoint') != body.entrypoint or output.get('execution_observed') is not True):
            return ['metadata']
        # Separate process bounds compilation and the entire suite, including startup.
        result = subprocess.run([sys.executable, '-m', 'workagent.team_verifier'],
            input=json.dumps([code, body.entrypoint]), capture_output=True, text=True,
            cwd=Path(__file__).resolve().parents[1], env={}, timeout=SUITE_TIMEOUT, check=True)
        suite = json.loads(result.stdout)
        proof.case_count = suite['case_count']
        if not suite['passed'] or type(output.get('value')) is not int or output['value'] != math.comb(60,30):
            return ['numerical_disagreement']
    except (ValueError, KeyError, TypeError, AttributeError, OSError, subprocess.SubprocessError):
        return ['bounded_execution']
    return []


if __name__ == '__main__':
    from .wasm_tool import run_wasm_tool
    code, entrypoint = json.load(sys.stdin)
    cases = [[n,k] for n in range(61) for k in range(n+1)]
    actual = run_wasm_tool(code, entrypoint, [60,30], _cases=cases)
    print(json.dumps({'case_count':len(cases),
        'passed':sum(value != math.comb(n,k) for (n,k),value in zip(cases,actual,strict=True)) == 0}))
