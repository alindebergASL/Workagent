"""Draft exact pinned operator JSON; no activation, DB, key access or provider I/O.

The supplied route record is operator-attested prerequisite evidence, not automatic
account/model verification. Installation remains an explicit separate owner action.
"""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
from workagent.general_responses import PROFILE, POLICY, AUTHORIZATION_HASH, consumer_hash, verify_route_record
from workagent.general_schema import DECISION_SCHEMA, EXPLANATION_SCHEMA
from workagent.models import ProviderGrant, GeneralResponsesBinding


def draft(record,workspace,principal,conversations):
    verify_route_record(record)
    runtime=record['runtime']
    grant=ProviderGrant(id=record['grant_id'],workspace_id=workspace,principal_id=principal,
        profile=PROFILE,model='gpt-6.1-sol',consumer_sha256=consumer_hash(),expires_at=None,
        max_runs=4,max_received_output_tokens=16384,responses=GeneralResponsesBinding(
            project_id=runtime['product_project_id'],secret_reference=runtime['secure_secret_reference'],
            transport_mode='official_api',instructions_sha256=sha256(POLICY.encode()).hexdigest(),
            schema_sha256=sha256(EXPLANATION_SCHEMA.material).hexdigest(),
            scope_tool_sha256=sha256(DECISION_SCHEMA.material).hexdigest(),
            authorization_sha256=AUTHORIZATION_HASH,conversation_ids=conversations))
    from workagent.general_responses import validate_grant
    validate_grant(grant)
    return grant


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--authority-record',required=True)
    parser.add_argument('--workspace',required=True); parser.add_argument('--principal',required=True)
    parser.add_argument('--conversation',action='append',required=True)
    parser.add_argument('--out',required=True)
    args=parser.parse_args()
    try:
        grant=draft(json.loads(Path(args.authority_record).read_text()),args.workspace,args.principal,args.conversation)
        fd=os.open(args.out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:f.write(grant.model_dump_json(indent=2)+'\n')
    except Exception:
        parser.exit(2,'Draft blocked: invalid explicit inputs or output already exists; no grant installed.\n')
    print('Pinned grant draft written; no grant installed and no provider/key access.')


if __name__=='__main__':main()
