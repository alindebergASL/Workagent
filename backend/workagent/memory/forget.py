"""Derived-memory erasure, not source deletion or unsending historical requests."""
from ..models import new_id
from .models import MemoryReceipt


def erase(c, principal, workspace, old):
    # The SQL owner function locks, CAS-checks, tombstones every old scope/source,
    # erases semantic payload in every revision, and returns only an ID receipt.
    row = c.execute('SELECT forget_memory(%s,%s,%s,%s,%s) AS data',
        (workspace, principal.id, old.memory_id, old.revision_id, new_id())).fetchone()
    return MemoryReceipt.model_validate(row['data'])
