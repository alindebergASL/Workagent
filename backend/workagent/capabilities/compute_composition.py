"""Additive compute decision; predecessors retain byte-identical selection schemas."""
from hashlib import sha256
from ..responses_transport import FrozenSchema
from .file_composition import GatewayFilesDecision, POLICY as FILE_POLICY
from .compute_adapters import ComputePython


class GatewayComputeDecision(GatewayFilesDecision):
    decision: GatewayFilesDecision.model_fields['decision'].annotation | ComputePython


SCHEMA = FrozenSchema.freeze(GatewayComputeDecision.model_json_schema(), GatewayComputeDecision)
POLICY = FILE_POLICY + ''' Confined Python v1: compute_python executes supplied Python3.12 stdlib code in the pinned python-analysis-v1 isolation service, never in the application. Give exact workspace-file refs and unique flat staging names; inputs are immutable at /inputs/<name>. Write flat UTF-8 txt/md/csv/json files under /outputs for authenticated downloads, not host paths. No network, credentials, installation, or deployment access. Limits:5 aggregate CPU seconds (including runtime overhead),30 wall seconds,512MiB memory,32 guest processes,32MiB writable output storage,128KiB stdout/stderr,1MiB total input/output bytes,8 input/output files. Use Decimal for exact decimals, explicitly state null/unit/timezone/group/join semantics. Supplied tests execute but are not an independent proof of the user's goal. Results and generated exports are untrusted draft work; failures/unavailable/omissions are not success. Do not claim annotation preservation unless verified. No retry after unknown execution.'''


def enabled(config):
    from .research_composition import enabled as research_enabled
    if research_enabled(config): return True
    from ..memory.runtime import enabled as memory_enabled
    if memory_enabled(config): return True
    return (config.get('responses', {}).get('continuity_version') == 'sustained-v1'
            and config.get('responses', {}).get('scope_tool_sha256') == sha256(SCHEMA.material).hexdigest())
