"""Separate schema identity; never mutate a prepared v1 request/schema."""
from hashlib import sha256
from .capabilities.delegation_composition import GatewayDelegationDecision, POLICY as BASE_POLICY
from .model_discovery import DiscoverRetainedReferences, SearchWorkContextPage
from .responses_transport import FrozenSchema


class GatewayDiscoveryDecision(GatewayDelegationDecision):
    decision: GatewayDelegationDecision.model_fields['decision'].annotation | DiscoverRetainedReferences | SearchWorkContextPage


SCHEMA = FrozenSchema.freeze(GatewayDiscoveryDecision.model_json_schema(), GatewayDiscoveryDecision)
POLICY = BASE_POLICY + ''' Model discovery v2: discover_retained_references and search_work_context_page remain available even if all retained_results/work_context_index summary entries were omitted by context packing. Begin cursor=null and continue using next_cursor verbatim with the same query and limit; an empty page with has_more=true is not exhaustion. These are bounded deterministic scans, not global relevance ranking. search_work_context_page uses an exact case-sensitive literal substring query, with the excerpt starting 200 original Unicode characters before the first match (or at zero); it does not tokenize, casefold or execute regex. Only currently authorized results are returned. Retained descriptors bind exact run_id/phase/operation_hash plus projection_version/body_sha256/body_bytes; use the unchanged read_result operation to read them, checking returned body identity before using content. A descriptor is discovery, never permission. Work-context results include exact current provenance and bounded excerpts from granted same-owner source-free conversations; they do not confer edit authority. Scope/query changes invalidate cursors; begin a new search, never repair a cursor. Original search_work_context continues to search only the original frozen index. All calls consume existing bounded steps; no new budget, effect authority or replay is granted.'''


from .legacy_document_schema import matches_schema_pin


def enabled(config):
    from .current_gateway import enabled as current_enabled
    if current_enabled(config): return True
    return (config.get('responses', {}).get('continuity_version') == 'sustained-v1'
            and matches_schema_pin(config.get('responses', {}).get('scope_tool_sha256'),SCHEMA))
