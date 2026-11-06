"""Derived-memory erasure, not source deletion or unsending historical requests."""
from ..models import new_id
from .models import MemoryReceipt


def erase(c, principal, workspace, old):
    # The SQL owner function locks, CAS-checks, tombstones every old scope/source,
    # erases semantic payload in every revision, and returns only an ID receipt.
    row = c.execute('SELECT forget_memory(%s,%s,%s,%s,%s) AS data',
        (workspace, principal.id, old.memory_id, old.revision_id, new_id())).fetchone()
    return MemoryReceipt.model_validate({**row['data'], 'retention_notice':
        'Memory payloads and declared memory descendants erased; automated derived readback is invalidated. '
        'Human originals and saved human revisions, audit IDs/hashes, historical outgoing requests and provider copies are retained. '
        'This is not provider-side deletion. Old backups require current safety replay before inspection.'})
