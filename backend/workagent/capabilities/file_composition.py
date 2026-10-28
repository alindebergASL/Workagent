"""New schema pin for file tools. Historical alpha/sustained schemas stay frozen."""
from hashlib import sha256
from ..retained_results import SustainedDecision, POLICY as RETAINED_POLICY
from ..responses_transport import FrozenSchema
from .file_adapters import FilesList, FilesReadRange, FilesCreateDraft, FilesProposePatch, FilesCompare, ArtifactsExport


class GatewayFilesDecision(SustainedDecision):
    decision: SustainedDecision.model_fields['decision'].annotation | FilesList | FilesReadRange | FilesCreateDraft | FilesProposePatch | FilesCompare | ArtifactsExport


SCHEMA = FrozenSchema.freeze(GatewayFilesDecision.model_json_schema(), GatewayFilesDecision)
POLICY = RETAINED_POLICY + ''' Workspace files v1: use files_list only within your installed exact resource selectors. Files are opaque IDs and exact version/SHA256 refs, never paths. Read bounded UTF-8 byte ranges and disclose omitted ranges. files_create_draft creates an inert draft. files_propose_patch proposes a full replacement against an exact base; never accepts or overwrites human work. files_compare compares exact versions. artifacts_export creates a real basic downloadable export of an exact revision, preserving annotations or reporting visible omissions. Export/adapter success does not mean task completion. A newly created file does not grant arbitrary additional input access; later reads still require installed exact selectors.'''


def enabled(config):
    return (config.get('responses', {}).get('continuity_version') == 'sustained-v1'
            and config.get('responses', {}).get('scope_tool_sha256') == sha256(SCHEMA.material).hexdigest())
