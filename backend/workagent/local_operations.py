"""Bounded pure CSV reconciliation. Caller must supply broker-authorized bytes.

This module provides calculation, not authority, model reasoning or publication.
Original values and extra columns survive; calculated columns are additive.
"""
import csv
from decimal import Decimal, localcontext
import hashlib
import io
import re


class OperationRejected(ValueError):
    pass


_REQUIRED = ('id', 'quantity', 'unit_price', 'reported_total')
_ADDED = ('calculated_total', 'difference', 'check')
_MONEY = re.compile(r'(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,4})?\Z')


def reconcile_csv(text: str, *, rounding: str = 'ROUND_HALF_UP') -> dict:
    if not isinstance(text, str) or len(text.encode('utf-8')) > 200_000:
        raise OperationRejected('CSV must be UTF-8 text within 200000 bytes')
    if rounding not in ('ROUND_HALF_UP', 'ROUND_HALF_EVEN'):
        raise OperationRejected('unsupported rounding rule')
    try:
        reader = csv.DictReader(io.StringIO(text, newline=''), strict=True)
        headers = reader.fieldnames or []
        if (not headers or len(headers) > 30 or len(set(headers)) != len(headers)
                or not set(_REQUIRED) <= set(headers) or set(headers) & set(_ADDED)
                or any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_ ]{0,63}', h) for h in headers)):
            raise OperationRejected('unique columns id, quantity, unit_price, reported_total required; calculated columns reserved')
        rows, ids, discrepancies = [], set(), []
        expected_sum, reported_sum = Decimal(0), Decimal(0)
        with localcontext() as context:
            context.prec = 28
            for source in reader:
                if len(rows) >= 500 or None in source or any(v is None for v in source.values()):
                    raise OperationRejected('row shape or 500-row bound exceeded')
                if any(len(v) > 2000 or v.lstrip().startswith(('=', '+', '-', '@')) or '\x00' in v for v in source.values()):
                    raise OperationRejected('unsafe spreadsheet text or oversized cell')
                row_id = source['id']
                if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', row_id) or row_id in ids:
                    raise OperationRejected('stable unique row id required')
                if not re.fullmatch(r'(?:0|[1-9][0-9]{0,5}|1000000)', source['quantity']):
                    raise OperationRejected('quantity must be an integer from 0 to 1000000')
                if not _MONEY.fullmatch(source['unit_price']) or not _MONEY.fullmatch(source['reported_total']):
                    raise OperationRejected('finite nonnegative decimal amount required; no inferred values')
                if '.' in source['reported_total'] and len(source['reported_total'].split('.')[1]) > 2:
                    raise OperationRejected('reported total must have at most two decimal places')
                total = (Decimal(source['quantity']) * Decimal(source['unit_price'])).quantize(Decimal('.01'), rounding=rounding)
                reported = Decimal(source['reported_total'])
                difference = reported - total
                row = dict(source)
                row.update(calculated_total=format(total, '.2f'), difference=format(difference, '.2f'),
                           check='discrepancy' if difference else 'matched')
                rows.append(row); ids.add(row_id)
                if difference:
                    discrepancies.append(row_id)
                expected_sum += total; reported_sum += reported
        if not rows:
            raise OperationRejected('at least one data row is required')
    except (csv.Error, UnicodeError) as exc:
        raise OperationRejected('invalid CSV') from exc
    buffer = io.StringIO(newline='')
    writer = csv.DictWriter(buffer, fieldnames=[*headers, *_ADDED], lineterminator='\n')
    writer.writeheader(); writer.writerows(rows)
    return {'columns': [*headers, *_ADDED], 'rows': rows, 'csv': buffer.getvalue(),
            'discrepancies': discrepancies, 'expected_sum': format(expected_sum, '.2f'),
            'reported_sum': format(reported_sum, '.2f'), 'rounding': rounding,
            'formula': 'calculated_total = round(quantity * unit_price, 2); difference = reported_total - calculated_total',
            'input_sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
            'source_values_preserved': True}
