"""Resolve one run's descriptors using ONE source inventory per invocation.

Caller still enforces current run/lease/ACL/tool availability.
Each descriptor retains its live SQL authorization check. There is deliberately
no cross-call cache: edits/revocation between checks are not granted authority by
an earlier success. Production launch must use an immutable verified source tree,
as required by the original implementation_releases contract.
"""
from .implementation_releases import execution_identity
from ..errors import deny


def resolve_descriptors(c, run, descriptors):
    descriptors = tuple(descriptors)
    if not descriptors:
        return None
    live = [d.model_dump(mode='json') for d in descriptors]
    if len({d['id'] for d in live}) != len(live):
        deny()
    grant = c.execute('SELECT id FROM tool_grants WHERE workspace_id=%s AND run_id=%s',
                      (run.workspace_id, run.id)).fetchone()
    if not grant:
        deny()
    mapped = c.execute('SELECT 1 FROM tool_grant_implementation_bindings WHERE grant_id=%s LIMIT 1',
                       (grant['id'],)).fetchone()
    identity = execution_identity() if mapped else None
    for descriptor in live:
        resolved = c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',
            (grant['id'], descriptor['id'],
             identity['source_sha256'] if identity else None,
             identity['consumer_sha256'] if identity else None)).fetchone()['d']
        if resolved != descriptor:
            deny()
    return identity
