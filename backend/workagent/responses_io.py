"""Exact HTTP-interval liveness, never send/retry or accounting authority.

A separate PostgreSQL transaction holds one advisory lock while synchronous HTTP
and receipt retention execute. Process/connection loss releases it; the current
run fence and lease bound its interpretation. A generic worker heartbeat cannot
make an ambiguous reservation look live. Historical events stay immutable.
"""
from contextlib import contextmanager
from hashlib import sha256

from .errors import DomainError


def operation_key(attempt_id, phase, kind, fence):
    material = f'workagent-http-v1:{attempt_id}:{phase}:{kind}:{fence}'
    # PostgreSQL's bigint lock namespace (objsubid=1), separate from two-int locks.
    return int.from_bytes(sha256(material.encode()).digest()[:8], 'big', signed=True)


@contextmanager
def interval(ledger, request, kind, cap):
    """Called only after committed reservation and fresh authority, before I/O."""
    key = operation_key(ledger.receipt.attempt_id, request.phase, kind, cap.fence)
    with ledger.service.db.transaction() as c:
        if not c.execute('SELECT pg_try_advisory_xact_lock(%s) AS acquired', (key,)).fetchone()['acquired']:
            raise DomainError('action_unresolved')
        yield


def active(c, attempt_id, phase, kind):
    """Read-only exact current operation check; never acquires/releases the lock."""
    row = c.execute("SELECT r.data->>'fence' fence FROM provider_attempts a JOIN runs r "
        "ON r.workspace_id=a.workspace_id AND r.id=a.run_id WHERE a.id=%s "
        "AND r.data->>'state'='running' AND (r.data->>'lease_expires_at')::timestamptz>clock_timestamp()",
        (attempt_id,)).fetchone()
    if not row:
        return False
    key = operation_key(attempt_id, phase, kind, int(row['fence'])) & ((1 << 64) - 1)
    return bool(c.execute("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted "
        "AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) "
        "AND classid=%s::oid AND objid=%s::oid AND objsubid=1",
        (key >> 32, key & 0xffffffff)).fetchone())
