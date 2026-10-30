"""Trusted per-run tool installation for the already prepared study only.

No model-created authority, no new paid tool service, no search claim. Same local
capabilities for B1/M1. B0 keeps the accepted baseline. Owner DSN never enters jail.
"""
from datetime import timedelta
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from workagent.capabilities import registry, policy
from workagent.capabilities.models import ToolGrantV1, CapabilityPin, InputRef
from workagent.capabilities.research_adapters import ResearchCapture, input_refs
from workagent.db import Database
from workagent.models import now
from workagent.service import Service, Principal
from study_controller import canonical, digest, Hold
from network_harness import inventory

# Local real adapters; no private connector, paid search, delegation or browser.
CAPABILITIES=('context.read','files.inspect_json','capabilities.discover_legacy',
 'procedures.load_legacy','files.list','files.read_range','files.create_draft',
 'files.propose_patch','files.compare','artifacts.export','research.capture','research.cite')
# Capacity, not dollars, tariffs, task minima or model caps. Shared across the
# trajectory's runs per workspace. Existing provider ledger remains authoritative.
LIMITS={'local_compute':10000,'extraction':1000,'rendering':1000}


def install(binding, state, receipt_directory):
    if state['variant']=='B0':
        return None
    if state['blind_id']!=binding['blind_id'] or state['mode']!='official_api':
        raise Hold('tool_trajectory_mismatch')
    ws, rid, cid = state['workspace'],state['current_run'],state['conversation']
    index=1 if state['episode']==6 else 0
    expected_grant=binding['other_grant' if index else 'grant']
    assert ws==binding['workspaces'][index] and state['active_grant']==expected_grant
    assert cid in expected_grant['responses']['conversation_ids']
    inputs=Path(state['inputs'])
    assert inputs.resolve().is_relative_to(ROOT/'.local/batch3/b35c/preparation/public-inputs')
    assert inventory(inputs)==state['input_files']
    service=Service(Database(binding['database_url']));p=Principal(binding['principal'])
    run=service.get_run(p,ws,rid)
    assert run.principal_id==p.id and run.conversation_id==cid
    descriptors=[registry.adapters()[key].descriptor for key in CAPABILITIES]
    assert all(d.cost_profile.reserved_cost_usd=='0' for d in descriptors)
    pins=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in descriptors]
    owner=Database(binding['migration_database_url'])
    receipt_directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    path=receipt_directory/(rid+'.json')
    # Existing grants must match their pre-install durable intent, not be silently
    # renewed/rebaselined at restart (including an expired grant).
    if path.exists():
        g=ToolGrantV1.model_validate_json(path.read_text())
        assert g.run_id==rid and g.workspace_id==ws and g.scope_id==cid and g.capabilities==pins
        assert g.principal_id==p.id and g.access_generation==run.access_generation and g.expires_at>now()
    else:
        refs=[]
        for source in sorted(inputs.glob('*.source.json')):
            item=json.loads(source.read_text())
            refs.extend(input_refs(ResearchCapture(kind='research_capture',url=item['receipt']['requested_url'],allow_browser=False)))
        # Reuse only currently visible prior versions in THIS exact conversation.
        with service.db.transaction() as c:
            page=service._list_workspace_files(c,p,ws,cid,limit=100)
            assert page.next_after is None, 'explicit_selector_capacity_exceeded'
            for file in page.items:
                r=file.current
                refs.append(InputRef(kind='workspace_file',id=r.workspace_file_id,version=r.version_id,sha256=r.sha256))
            for aid in state['artifacts'] if index==0 else []:
                a,_=service._artifact(c,p,ws,aid)
                if a['conversation_id']!=cid:continue
                detail=service.get_artifact(p,ws,aid)
                refs.append(InputRef(kind='artifact_revision',id=aid,version=detail.current_revision_id,sha256=detail.current_revision.body_hash))
        unique={canonical(r.model_dump(mode='json')):r for r in refs}
        g=ToolGrantV1(id='study-tools-'+rid,workspace_id=ws,principal_id=p.id,run_id=rid,scope_id=cid,
          capabilities=pins,resource_selectors=[unique[k] for k in sorted(unique)],
          effects=['read','draft','local_compute'],privacy_classes=['public','workspace_private'],egress='public_https',
          expires_at=now()+timedelta(days=7),access_generation=run.access_generation,
          budget_account_id='study-tools-'+digest(ws)[:24],allow_run_outputs=True)
        with path.open('x') as f:f.write(g.model_dump_json(indent=2)+'\n')
    with owner.transaction() as c:
        existing=c.execute('SELECT data,active FROM tool_grants WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchone()
    if existing is None:
        policy.install(owner,g,limits=LIMITS,provider_grant_id=expected_grant['id'])
    with service.db.transaction() as c:
        actual=policy.grant(c,ws,rid)
        assert actual==g
        policy.require_run_tools(c,run)
    return g.model_dump(mode='json')
