"""Trusted operator-only cross-database liabilities; no HTTP or provider access.

The operator must reconcile the source manifest and prevent further source sends.
A manifest digest binds the assertion; it does not prove or fetch source contents.
Import every source before local provider I/O. No updates, refunds or receipts.
"""
from decimal import Decimal
from .provider_attempts import _owner


def read_carry(db, project_id, transport_mode):
    """Read retained source bindings/amounts without mutating provider history."""
    with db.transaction() as c:
        return c.execute('''SELECT * FROM responses_budget_carry
            WHERE project_id=%s AND transport_mode=%s ORDER BY source_grant_id''',
            (project_id, transport_mode)).fetchall()


def install_carry(db, *, project_id, transport_mode, source_database,
                  source_grant_id, source_manifest_sha256, reserved_cost_usd):
    """Commit one immutable owner assertion and return exact committed readback.

    Accept decimal strings/Decimal, not binary floats. PostgreSQL independently
    enforces owner, bounds, uniqueness, local-grant collisions and setup ordering.
    """
    if not isinstance(reserved_cost_usd, (str, Decimal)):
        raise ValueError('reserved cost must be an exact decimal string or Decimal')
    amount = Decimal(reserved_cost_usd)
    if not amount.is_finite() or not Decimal(0) < amount <= Decimal(20):
        raise ValueError('reserved cost must be finite and greater than 0, at most 20')
    with db.transaction() as c:
        _owner(c)
        c.execute('''INSERT INTO responses_budget_carry
            (project_id,transport_mode,source_database,source_grant_id,source_manifest_sha256,reserved_cost_usd)
            VALUES (%s,%s,%s,%s,%s,%s)''',
            (project_id,transport_mode,source_database,source_grant_id,source_manifest_sha256,amount))
    rows=read_carry(db, project_id, transport_mode)
    row=next(r for r in rows if r['source_grant_id']==source_grant_id)
    if (row['source_database']!=source_database or
        row['source_manifest_sha256']!=source_manifest_sha256 or
        row['reserved_cost_usd']!=amount):
        raise RuntimeError('carry readback mismatch')
    return row
