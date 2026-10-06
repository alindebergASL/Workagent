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
    outputs={'general-decision.schema.json':GeneralDecision.model_json_schema(),
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
