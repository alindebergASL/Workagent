"""New opt-in office schema; historical file/research schemas stay unchanged."""
from hashlib import sha256
from ..responses_transport import FrozenSchema
from .research_composition import GatewayResearchDecision, POLICY as BASE_POLICY
from .office_adapters import ArtifactsOfficeExport

class GatewayOfficeDecision(GatewayResearchDecision):
    decision: GatewayResearchDecision.model_fields['decision'].annotation | ArtifactsOfficeExport

SCHEMA=FrozenSchema.freeze(GatewayOfficeDecision.model_json_schema(),GatewayOfficeDecision)
POLICY=BASE_POLICY+''' Office exports v1: artifacts_export_office renders exact authorized file/artifact input as real DOCX, XLSX, PDF or PNG. PNG requires column-bound grouped sum/count/mean, computed from actual CSV or typed workbook values; missing/nonnumeric values are rejected. Ordinary formula-looking strings stay strings. Explicit formulas are never evaluated; caches are historical only. Report fidelity, omissions, annotations and provenance from the manifest. No OCR/vision or original rich-format fidelity is claimed. New tool requires its own exact installed descriptor/grant; unknown calls never replay.'''

def enabled(config):
    return (config.get('responses',{}).get('continuity_version')=='sustained-v1'
        and config.get('responses',{}).get('scope_tool_sha256')==sha256(SCHEMA.material).hexdigest())
