"""Opt-in current gateway. Old schemas/receipts retain their original validators."""
from hashlib import sha256
from typing import Literal, Union, get_args
from .discovery_composition import GatewayDiscoveryDecision, POLICY as PREDECESSOR_POLICY
from .responses_transport import FrozenSchema


# Preserve every predecessor choice and DTO except the legacy publication variants.
# A distinct model gives future grants a distinct schema identity.
CurrentChoice = Union[tuple(cls for cls in get_args(GatewayDiscoveryDecision.model_fields['decision'].annotation)
                           if cls.model_fields['kind'].annotation.__args__[0] != 'publish_artifact')]


class GatewayCurrentDecision(GatewayDiscoveryDecision):
    decision: CurrentChoice


SCHEMA = FrozenSchema.freeze(GatewayCurrentDecision.model_json_schema(), GatewayCurrentDecision)
POLICY = PREDECESSOR_POLICY + """ Current gateway contract: publish_artifact is unavailable in this schema; earlier legacy-publication guidance does not apply. Use files_create_draft for a new inert file draft, or files_propose_patch for an authorized exact file base. These choices retain all target, resource, content-hash and human-edit checks; a descriptor never grants mutation authority. discover_capabilities returns adapter items separately from builtin_operations. The latter are scoped typed discovery operations, not installed ToolGrant adapters. Both discovery operations use the unchanged v2 bounded cursors and receipts. No extra steps, tokens or budget are granted."""


def enabled(config):
    return (config.get('responses', {}).get('continuity_version') == 'sustained-v1'
            and config.get('responses', {}).get('scope_tool_sha256') == sha256(SCHEMA.material).hexdigest())


def builtin_catalog(service, c, p, run, cv, config):
    """Descriptors only after current discovery authority; no catalog-search alias."""
    from .errors import deny
    from .model_discovery import current_scope, descriptors, DiscoverRetainedReferences
    if not enabled(config): deny()
    current_scope(service, c, p, run, cv, config,
                  DiscoverRetainedReferences(kind='discover_retained_references', cursor=None, limit=1))
    # Work-context search is not an available operation in responsibility scope.
    # Execution still independently calls current_scope with the selected DTO.
    return [d for d in descriptors()
            if not (config.get('responsibility') and d['name'] == 'search_work_context_page')]


from .composition import CapabilityDescriptor
from .capabilities.models import CapabilityPage


class GatewayBuiltinDescriptor(CapabilityDescriptor):
    name: Literal['discover_retained_references', 'search_work_context_page']
    version: Literal['2'] = '2'
    handler: Literal['discover_retained_references', 'search_work_context_page']


class CurrentGatewayCatalog(CapabilityPage):
    schema_version: Literal['gateway-capability-page/v1'] = 'gateway-capability-page/v1'
    builtin_operations: list[GatewayBuiltinDescriptor]
