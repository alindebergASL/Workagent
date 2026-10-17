"""Owner-only standing successor drafting; installation uses existing grant APIs.

No provider/key reads. The predecessor's project, route, principal/workspace and
shared budget ceilings are copied by default. The explicit optional cost ceiling
can reconcile the authorized cumulative $50 limit, never reset its liabilities.
"""
from hashlib import sha256
from .models import ProviderGrant, StandingResponsesBinding
from .errors import DomainError


def draft_standing_successor(db, predecessor_id, *, grant_id, max_runs, cost_limit_usd=None):
    from .provider_attempts import _owner
    from .general_responses import consumer_hash
    from .composition import POLICY, DECISION_SCHEMA
    from .general_schema import EXPLANATION_SCHEMA
    with db.transaction() as c:
        _owner(c)
        row = c.execute('SELECT data FROM provider_grants WHERE id=%s', (predecessor_id,)).fetchone()
    if not row:
        raise DomainError('not_found_or_not_authorized')
    previous = ProviderGrant.model_validate(row['data'])
    if (previous.profile != 'general-responses-v1'
            or getattr(previous.responses, 'runtime_extension', None) != 'general-alpha-v1'
            or grant_id == previous.id):
        raise DomainError('unsupported_operation')
    binding = previous.responses.model_dump(mode='json')
    # No implicit increase. Operator may explicitly reconcile the latest $50
    # cumulative ceiling; project/route/carry and all usage stay identical.
    if cost_limit_usd is not None:
        binding['cost_limit_usd'] = cost_limit_usd
    binding.update(admission_policy='principal-workspace-v1', conversation_ids=[],
        instructions_sha256=sha256(POLICY.encode()).hexdigest(),
        scope_tool_sha256=sha256(DECISION_SCHEMA.material).hexdigest(),
        schema_sha256=sha256(EXPLANATION_SCHEMA.material).hexdigest())
    raw = previous.model_dump(mode='json')
    raw.update(id=grant_id, max_runs=max_runs, consumer_sha256=consumer_hash(),
               responses=StandingResponsesBinding.model_validate(binding).model_dump(mode='json'))
    return ProviderGrant.model_validate(raw)
