"""Export canonical schemas deterministically; --check fails without rewriting."""
import argparse
import json
from pathlib import Path
from workagent.api import create_app
from workagent.examples import examples
from workagent.tool_registry import registry

ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--check',action='store_true'); args=parser.parse_args()
    from workagent.tool_registry import responses_registry
    from workagent.responses_schema import NextAction
    from workagent.products import Products
    from workagent.general_schema import GeneralDecision,GeneralExplanation
    from workagent.general_responses import PROFILE
    from workagent.conversations import profile
    from workagent.adaptive import AdaptiveDecision
    from workagent.message_models import attachment_contract
    from workagent.composition import AlphaDecision, ContinuityDecision, descriptors
    from workagent.models import ProviderGrant
    from workagent.work_event_fixtures import vectors as work_event_vectors
    from workagent.retained_results import SustainedDecision
    from workagent.checkpoint_models import RunCheckpoint, QueuedMessage
    from workagent.capabilities.models import CapabilityDescriptorV2, ToolGrantV1, ToolCallV1, ToolObservationV1
    from workagent.capabilities.registry import catalog
    from workagent.workspace_file_models import WorkspaceFilesContract
    from workagent.capabilities.file_composition import GatewayFilesDecision
    from workagent.capabilities.compute_composition import GatewayComputeDecision
    from workagent.capabilities.compute_adapters import ComputePython, ComputeOutput, ComputeExportManifest
    from workagent.memory.models import MemoryContract
    from workagent.memory.runtime import GatewayMemoryDecision
    from workagent.capabilities.research_composition import GatewayResearchDecision
    from workagent.workspace_file_models import OfficeContract
    from workagent.capabilities.office_composition import GatewayOfficeDecision
    from workagent.capabilities.github_composition import GatewayGitHubDecision
    from workagent.connectors.base import PublicConnectorConsent
    from workagent.connectors.models import ConnectorStatus, AuthorizationFlow, StartAuthorization, CompleteAuthorization, RevokeConnector, ConnectorPage
    from workagent.capabilities.mcp_composition import GatewayMCPDecision
    outputs={'connector-status.schema.json':ConnectorStatus.model_json_schema(),
             'connector-authorization-flow.schema.json':AuthorizationFlow.model_json_schema(),
             'gateway-mcp-decision.schema.json':GatewayMCPDecision.model_json_schema(),
             'gateway-github-decision.schema.json':GatewayGitHubDecision.model_json_schema(),
             'public-connector-consent.schema.json':PublicConnectorConsent.model_json_schema(),
             'office-v1.json':OfficeContract.model_json_schema(),
             'gateway-office-decision.schema.json':GatewayOfficeDecision.model_json_schema(),'gateway-research-decision.schema.json':GatewayResearchDecision.model_json_schema(),
             'gateway-memory-decision.schema.json':GatewayMemoryDecision.model_json_schema(),
             'memory-v1.json':MemoryContract.model_json_schema(),
             'compute-python.schema.json':ComputePython.model_json_schema(),
             'compute-output.schema.json':ComputeOutput.model_json_schema(),
             'compute-export-manifest.schema.json':ComputeExportManifest.model_json_schema(),
             'gateway-compute-decision.schema.json':GatewayComputeDecision.model_json_schema(),
             'workspace-files-v1.json':WorkspaceFilesContract.model_json_schema(),
             'gateway-files-decision.schema.json':GatewayFilesDecision.model_json_schema(),
             'capability-descriptor.schema.json':CapabilityDescriptorV2.model_json_schema(),
             'tool-grant.schema.json':ToolGrantV1.model_json_schema(),
             'tool-call.schema.json':ToolCallV1.model_json_schema(),
             'tool-observation-v1.json':ToolObservationV1.model_json_schema(),
             'capability-registry-v2.json':[d.model_dump(mode='json') for d in catalog()],
             'work-events-fixtures.json':work_event_vectors(),
             'run-checkpoint.schema.json':RunCheckpoint.model_json_schema(),
             'queued-message.schema.json':QueuedMessage.model_json_schema(),
             'sustained-decision.schema.json':SustainedDecision.model_json_schema(),
             'provider-grant.schema.json':ProviderGrant.model_json_schema(),
             'continuity-decision.schema.json':ContinuityDecision.model_json_schema(),
             'alpha-decision.schema.json':AlphaDecision.model_json_schema(),
             'alpha-capability-catalog.json':descriptors(),
             'message-attachments.json':attachment_contract(),
             'adaptive-decision.schema.json':AdaptiveDecision.model_json_schema(),
             'general-decision.schema.json':GeneralDecision.model_json_schema(),
             'general-explanation.schema.json':GeneralExplanation.model_json_schema(),
             'general-responses-profile.json':profile(PROFILE),
             'general-tool-registry.json':{'profile':'general-products-controlled-v1','tools':Products().local_tool_registry()},
             'openapi.json':create_app().openapi(),'tool-registry.json':registry(),'examples.json':examples(),
             'responses-tool-registry.json':responses_registry(),'responses-output.schema.json':NextAction.model_json_schema()}
    for name,value in outputs.items():
        path=ROOT/'contracts'/name
        text=json.dumps(value,indent=2,sort_keys=True,ensure_ascii=False)+'\n'
        if args.check:
            if not path.exists() or path.read_text()!=text:
                raise SystemExit('Generated contract drift: '+str(path))
        else:
            path.write_text(text)
    print('Contracts match canonical Python models.' if args.check else 'Exported OpenAPI, tool schemas, and illustrative examples.')

if __name__=='__main__': main()
