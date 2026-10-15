"""Pure explicit-target policy shared by execution and safe readback.

A companion is a new, inert, read-only view of the exact selected source, not an
edit of it. Scope/currentness/lease checks still belong to the domain broker.
"""

# Kept in sync with additive SQL authority, not the latest mutable instructions.
# A future policy change needs explicit migration rather than retrospective scope.
COMPANION_POLICY_SHA256='d9e01384a363919be4c4436b1ddcd1db6d4b69d4ee42b27e85f85030051c1a47'


def companion_enabled(config):
    binding=config.get('responses',{})
    return (binding.get('runtime_extension')=='general-alpha-v1'
            and binding.get('instructions_sha256')==COMPANION_POLICY_SHA256)


def companion_view(decision, target, *, author_kind, alpha, responsibility=False):
    """Accept only a validated custom view bound solely to the explicit source.

    Inputs are JSON projections of validated models/immutable receipt data. This
    predicate does not authorize access and must never replace exact_target or
    _validate_flexible_body at selection, staging or publication.
    """
    if (not alpha or responsibility or author_kind!='human' or not target
            or decision.get('kind')!='publish_artifact' or decision.get('target') is not None):
        return False
    body=decision.get('body') or {}
    if body.get('kind')!='custom_view' or body.get('version')!='custom-view/v1':
        return False
    bindings=body.get('bindings') or []
    return bool(bindings) and all(
        {key:ref.get(key) for key in ('artifact_id','revision_id','body_hash')}==target
        for ref in bindings)
