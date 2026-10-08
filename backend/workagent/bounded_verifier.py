"""Trusted finite CSV and team-selection specifications and independent oracles.

Full-request recognition is deliberately finite, not keyword/LLM interpretation.
No model-chosen specification, expected-answer feedback or domain writes.
Changes to these semantics require a new checker version and consumer approval.
"""
import csv
import io
import re
from hashlib import sha256
from typing import Literal

from pydantic import Field
from .model_base import Model, Hash
from .team_verifier import TeamGoalSpec, TEAM_GOAL, verify_team


class CSVGoalSpec(Model):
    kind: Literal['all_rows_quantity_price'] = 'all_rows_quantity_price'
    source: Literal['attachment', 'saved_table']
    rounding: Literal['ROUND_HALF_UP', 'ROUND_HALF_EVEN']
    decimal_places: Literal[2] = 2
    preserve: Literal['original_columns_rows_source_and_notes'] = 'original_columns_rows_source_and_notes'
    deliverable: Literal['table_discrepancies_csv'] = 'table_discrepancies_csv'


Failure = Literal['unsupported_goal', 'input_binding', 'unsupported_source', 'tool_not_observed',
                  'operation_binding', 'requested_rounding', 'table_rows', 'source_or_notes',
                  'metadata', 'download', 'numerical_disagreement', 'bounded_execution']


class AutomaticVerification(Model):
    checker_version: Literal['csv-reconciliation-v1', 'team-selection-v1'] = 'csv-reconciliation-v1'
    scope: Literal['bounded_csv_goal_only', 'bounded_team_goal_only'] = 'bounded_csv_goal_only'
    limitations: list[str]
    recognized: bool
    passed: bool
    spec: CSVGoalSpec | TeamGoalSpec | None = None
    request: dict | None = None
    source_sha256: Hash | None = None
    base_revision_id: str | None = None
    base_hash: Hash | None = None
    operation_hash: Hash | None = None
    staged_sha256: Hash
    case_count: int = Field(default=0, ge=0, le=1891)
    row_count: int = Field(default=0, ge=0, le=500)
    failures: list[Failure]


# Entire input must match. Whitespace/case and these explicit synonyms only.
# This grammar describes work, never requires users to provide test examples.
_GOAL = re.compile(
    r'(?:please )?(?:reconcile|recalculate) (?:every row|all rows) in '
    r'(?P<source>this|the attached|the saved) csv using quantity (?:times|\*) unit_price, '
    r'rounded to (?:2|two) decimal places with (?P<rounding>half-up|half-even) rounding'
    r'[;.] (?:preserve|keep) (?:all )?original columns and notes'
    r'[;.] (?:flag|list) discrepancies against reported_total'
    r'[;.] (?:provide|create) a downloadable csv\.?', re.IGNORECASE)
_ADDED = ('calculated_total', 'difference', 'check')
_FORMULA = 'calculated_total = round(quantity * unit_price, 2); difference = reported_total - calculated_total'
_LIMITATIONS = [
    'Only the fully recognized request and exact supplied table are verified; no external truth or effects.',
    'Nonnegative decimal amounts, integer quantities, two decimal places, half-up or half-even; at most 500 rows.',
    'A verified proposed revision remains pending human acceptance; downloading it does not apply it.',
]


def recognize(message):
    if (message is None or message.author_kind != 'human' or message.evidence_origin != 'human'
        or message.acceptance_checks is not None or message.operation is not None):
        return None
    # Same explicit ASCII language as the persistence guard, independent of locale.
    if not message.text.isascii():
        return None
    text = re.sub(r'[ \t\n\r\f\v]+', ' ', message.text).strip(' ')
    if TEAM_GOAL.fullmatch(text):
        return TeamGoalSpec()
    match = _GOAL.fullmatch(text)
    if not match:
        return None
    return CSVGoalSpec(source='saved_table' if match['source'].lower() == 'the saved' else 'attachment',
        rounding='ROUND_HALF_UP' if match['rounding'].lower() == 'half-up' else 'ROUND_HALF_EVEN')


def _hash(text):
    return sha256(text.encode('utf-8')).hexdigest()


def staged_material(staged):
    # Exact execution payload, excluding subsequent explanations and the proof
    # itself. Shared with the additive SQL binding guard, never model supplied.
    return {key:staged.get(key) for key in ('status','body','file','output','binding')}


def _csv(columns, rows):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream, lineterminator='\n')
    writer.writerow(columns)
    writer.writerows([[row[key] for key in columns] for row in rows])
    return stream.getvalue()


def _read(text):
    if not isinstance(text, str) or not 0 < len(text.encode()) <= 200000:
        raise ValueError()
    data = list(csv.reader(io.StringIO(text, newline=''), strict=True))
    if not 2 <= len(data) <= 501:
        raise ValueError()
    columns, *values = data
    if (not 4 <= len(columns) <= 30 or len(set(columns)) != len(columns)
        or not {'id', 'quantity', 'unit_price', 'reported_total'} <= set(columns)
        or set(_ADDED) & set(columns)
        or any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_ ]{0,63}', key) for key in columns)
        or any(len(row) != len(columns) for row in values)):
        raise ValueError()
    rows = [dict(zip(columns, row)) for row in values]
    ids = set()
    for row in rows:
        if any(len(cell) > 2000 or '\x00' in cell or cell.lstrip().startswith(('=', '+', '-', '@')) for cell in row.values()):
            raise ValueError()
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', row['id']) or row['id'] in ids:
            raise ValueError()
        ids.add(row['id'])
        if not re.fullmatch(r'0|[1-9][0-9]{0,6}', row['quantity']) or int(row['quantity']) > 1000000:
            raise ValueError()
    return columns, rows


def _scaled(value, places):
    if not re.fullmatch(r'(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,' + str(places) + r'})?', value):
        raise ValueError()
    whole, _, fraction = value.partition('.')
    return int(whole + fraction), 10 ** len(fraction)


def _money(cents):
    return ('-' if cents < 0 else '') + str(abs(cents) // 100) + '.' + str(abs(cents) % 100).zfill(2)


def _oracle(rows, rounding):
    result, discrepancies = [], []
    total_sum = reported_sum = 0
    for row in rows:
        price, scale = _scaled(row['unit_price'], 4)
        reported, reported_scale = _scaled(row['reported_total'], 2)
        cents, remainder = divmod(int(row['quantity']) * price * 100, scale)
        if remainder * 2 > scale or (remainder * 2 == scale and (rounding == 'ROUND_HALF_UP' or cents % 2)):
            cents += 1
        paid = reported * (100 // reported_scale)
        delta = paid - cents
        result.append({**row, 'calculated_total': _money(cents), 'difference': _money(delta),
                       'check': 'discrepancy' if delta else 'matched'})
        if delta:
            discrepancies.append(row['id'])
        total_sum += cents
        reported_sum += paid
    return result, discrepancies, _money(total_sum), _money(reported_sum)


def evaluate(message, operation, staged, *, base=None):
    from .adaptive import request_provenance
    from .service import digest
    spec = recognize(message)
    proof = AutomaticVerification(recognized=spec is not None, passed=False, spec=spec,
        request=request_provenance(message) if message else None,
        operation_hash=digest(operation) if operation else None,
        base_revision_id=base.id if base else None, base_hash=base.body_hash if base else None,
        staged_sha256=digest(staged_material(staged)), limitations=_LIMITATIONS, failures=[])

    def finish(*failures):
        proof.failures = list(failures)
        proof.passed = not failures
        return proof.model_dump(mode='json')

    if isinstance(spec, TeamGoalSpec):
        proof.checker_version = 'team-selection-v1'
        proof.scope = 'bounded_team_goal_only'
        proof.limitations = ['Only all 1891 integer pairs 0 <= k <= n <= 60 are verified; no arbitrary tool correctness.',
                             'A verified proposed revision remains pending human acceptance.']
        return finish(*verify_team(message, operation, staged, base, proof))
    if spec is None:
        return finish('unsupported_goal')
    if operation is None or operation.kind != 'reconcile_csv':
        return finish('operation_binding')
    if (staged.get('binding', {}).get('operation_hash') != digest(operation)
        or staged.get('binding', {}).get('base_hash') != proof.base_hash):
        return finish('operation_binding')
    try:
        if spec.source == 'attachment':
            if base or message.target or len(message.attachments) != 1:
                return finish('input_binding')
            attachment = message.attachments[0]
            source = attachment.content
            if (attachment.mime_type != 'text/csv' or attachment.sha256 != _hash(source)
                or operation.input_csv != source or operation.artifact_id is not None):
                return finish('input_binding')
            original_source, notes, title = source, [], 'Reconciled invoices'
        else:
            target = message.target
            if (message.attachments or not base or not target or base.body.kind != 'table'
                or target.revision_id != base.id or target.body_hash != base.body_hash
                or digest(base.body) != base.body_hash or operation.artifact_id != target.artifact_id
                or operation.base_revision_id != base.id or operation.input_csv is not None):
                return finish('input_binding')
            columns = [key for key in base.body.columns if key not in _ADDED]
            source = _csv(columns, base.body.rows)
            original_source, notes, title = base.body.source_csv, list(base.body.notes), base.body.title
        proof.source_sha256 = _hash(source)
        columns, rows = _read(source)
        calculated, discrepancies, total, reported = _oracle(rows, spec.rounding)
        proof.row_count = len(rows)
    except (ValueError, TypeError, KeyError, csv.Error, UnicodeError):
        return finish('unsupported_source')
    if staged.get('status') != 'observed':
        return finish('tool_not_observed')
    body, output, file = staged.get('body') or {}, staged.get('output') or {}, staged.get('file') or {}
    failures = []
    if operation.rounding != spec.rounding or body.get('rounding') != spec.rounding:
        failures.append('requested_rounding')
    if body.get('kind') != 'table' or body.get('columns') != [*columns, *_ADDED] or body.get('rows') != calculated:
        failures.append('table_rows')
    if body.get('source_csv') != original_source or body.get('notes') != notes or body.get('title') != title:
        failures.append('source_or_notes')
    metadata = dict(kind='reconcile_csv', input_sha256=proof.source_sha256, formula=_FORMULA,
        rounding=spec.rounding, reported_sum=reported, expected_sum=total, discrepancies=discrepancies,
        source_values_preserved=True)
    if output != metadata:
        failures.append('metadata')
    try:
        from .product_models import FileBody
        download = FileBody.model_validate(file)
        decoded = list(csv.reader(io.StringIO(download.content, newline=''), strict=True))
        if (download.mime_type != 'text/csv' or decoded != [[*columns, *_ADDED],
            *[[row[key] for key in [*columns, *_ADDED]] for row in calculated]]):
            failures.append('download')
    except (ValueError, TypeError, csv.Error):
        failures.append('download')
    return finish(*failures)


def recheck_completion(message, operation, staged, *, base=None):
    """Recompute against the exact publication payload, not its completion label."""
    from .errors import DomainError
    material=staged_material(staged)
    actual=evaluate(message,operation,material,base=base)
    verification=staged.get('verification',{})
    if (not actual['passed'] or verification.get('automatic')!=actual
        or verification.get('satisfied') is not True
        or verification.get('request')!=actual['request']):
        raise DomainError('action_unresolved')
    return actual
