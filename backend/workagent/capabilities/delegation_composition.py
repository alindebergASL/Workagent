"""Opt-in delegation; historical schemas and single-worker default unchanged."""
from hashlib import sha256
from ..responses_transport import FrozenSchema
from .mcp_composition import GatewayMCPDecision, POLICY as BASE_POLICY
from .delegation import DelegateAnalysis, VerifyDelegate

class GatewayDelegationDecision(GatewayMCPDecision):
    decision: GatewayMCPDecision.model_fields['decision'].annotation | DelegateAnalysis | VerifyDelegate

SCHEMA = FrozenSchema.freeze(GatewayDelegationDecision.model_json_schema(), GatewayDelegationDecision)
POLICY = BASE_POLICY + ''' Optional bounded delegation: single-worker execution remains default. Use delegate_analysis only for a concrete independently useful analysis subtask, not mandatory orchestration. Maximum two children per run, cumulative shared reservations, existing pinned no-network Python isolation only. No paid child provider is installed. Each child gets only its explicit immutable input subset and task.json; supply bounded code producing one JSON object on stdout. No credentials, ambient context, scope elevation, accept, memory write or nested delegation. Results are unreviewed proposals, not success. Inspect each exact child result and use verify_delegate with its child_attempt_id and exposed proposal_sha256 and separately authored verification code. It receives exact original inputs plus task.json and child.json, and must print JSON {"passed":true,"checks":["nonempty actual check description"]} after executing checks. To discard an incorrect exact child, execute the check and print {"passed":false,"checks":["reason for rejection"]}; this records discarded, returns no proposal and permits useful work to continue without claiming success or refund. An exception is checks_failed, not discard. A failed/unknown child is not evidence. Verification does not establish goal truth or human acceptance. Preserve source/cost/evidence lineage; never resend unknown launches under a new ID. Assimilation requires successful parent verification or explicit discard of every proposed child; never use discarded content as an accepted result. Do not promote child content into memory. Paid multi-agent benefit is separately ledger-gated and untested.'''

def enabled(config):
    return (config.get('responses',{}).get('continuity_version')=='sustained-v1'
            and config.get('responses',{}).get('scope_tool_sha256')==sha256(SCHEMA.material).hexdigest())
