"""Prepare exact isolated live-study contexts without funding or model calls.

One physical database per frozen trajectory. No historical source is upgraded.
All official sends must remain denied by the separately installed recipient gate
and the unchanged release lock until the root finishes admission verification.
"""
from pathlib import Path
import json
import os
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.local/batch3/b35c/live-study'


def save_private(path,value):
    with path.open('x') as f:
        os.chmod(path,0o600)
        json.dump(value,f,sort_keys=True,indent=2);f.write('\n')


def bootstrap(payload):
    source=ROOT/('.local/batch3/b35b/baseline' if payload['variant']=='B0' else 'backend')
    sys.path[:0]=[str(source),str(ROOT/'evaluation'),str(ROOT)]
    from workagent.db import Database
    from workagent.fixture import seed
    from workagent.service import Service,Principal
    from workagent.models import CreateWorkArea,CreateConversation,GeneralAlphaResponsesBinding,ProviderGrant,new_id
    from workagent.provider_attempts import configure_grant
    from workagent.composition import POLICY,DECISION_SCHEMA
    from workagent.general_schema import EXPLANATION_SCHEMA
    from workagent.general_responses import consumer_hash,AUTHORIZATION_HASH,verify_route_record
    from study_application import cmd
    from study_controller import digest
    from types import SimpleNamespace
    from hashlib import sha256
    admin=payload['connection']['MIGRATION_DATABASE_URL']
    runtime=payload['connection']['DATABASE_URL']
    service=Service(Database(runtime));principal=Principal('local-human')
    records=json.loads((ROOT/'fixtures/actor/solo-v0.1/initial_records.json').read_text())
    spaces=['study-'+new_id(),'other-'+new_id()]
    for ws in spaces:seed(admin,records,ws,principal.id)
    area=service.create_work_area(principal,spaces[0],cmd(CreateWorkArea,title='Synthetic editorial project',goal='Public source editorial work',kind='project',selected_source_refs=[]))
    cvs=[area.id]+[service.create_conversation(principal,spaces[0],cmd(CreateConversation)).id for _ in range(2)]
    other=service.create_conversation(principal,spaces[1],cmd(CreateConversation)).id
    if payload['variant']!='B0':
        from workagent.adaptive import contract
        from workagent.capabilities.delegation_composition import SCHEMA
        POLICY,DECISION_SCHEMA=contract(SimpleNamespace(continuity_version='sustained-v1',memory_recall='reviewed-v1' if payload['variant']=='M1' else 'off',scope_tool_sha256=digest(SCHEMA.material)))
    grants=[]
    for ws,ids in ((spaces[0],cvs),(spaces[1],[other])):
        kwargs=dict(project_id=payload['provider']['project_id'],secret_reference=payload['provider']['secret_reference'],transport_mode='official_api',
          instructions_sha256=digest(POLICY),schema_sha256=digest(EXPLANATION_SCHEMA.material),scope_tool_sha256=digest(DECISION_SCHEMA.material),
          authorization_sha256=AUTHORIZATION_HASH,runtime_extension='general-alpha-v1',continuity_version='sustained-v1',
          max_steps=8,generation_limit=256,count_limit=256,read_limit=4096,input_limit=12800000,output_limit=2097152,
          cost_limit_usd='12.00',conversation_ids=ids)
        if payload['variant']!='B0':kwargs['memory_recall']='reviewed-v1' if payload['variant']=='M1' else 'off'
        binding=GeneralAlphaResponsesBinding(**kwargs)
        g=ProviderGrant(id=new_id(),workspace_id=ws,principal_id=principal.id,profile='general-responses-v1',responses=binding,
           model='gpt-6.1-sol',consumer_sha256=consumer_hash(),
           expires_at=None,max_runs=10,max_received_output_tokens=16384)
        route=json.loads(json.dumps(payload['route']))
        # Rebind only the new grant identity. Retain original route verification
        # time/evidence; do not fabricate a fresh availability/billing check.
        route['grant_id']=g.id
        verify_route_record(route,g)
        installed=configure_grant(Database(admin),g,route_record=route)
        grants.append(installed.model_dump(mode='json'))
    return dict(blind_id=payload['blind_id'],database_url=runtime,migration_database_url=admin,principal=principal.id,
       workspaces=spaces,conversations=cvs,other=other,grant=grants[0],other_grant=grants[1])


def main():
    from hashlib import sha256
    from urllib.parse import urlsplit
    sys.path[:0]=[str(ROOT/'evaluation'),str(ROOT/'backend')]
    from study_controller import load_schedule,canonical
    from study_binding import validate_contexts,SOURCE_HASHES
    from study_application import load_env
    from test_accounting_correction import pg,PRIMARY
    schedule_sha,schedule=load_schedule()
    OUT.mkdir(mode=0o700,parents=True,exist_ok=True)
    assert not (OUT/'live-bindings.private.json').exists(),'already prepared; do not duplicate contexts'
    provider=json.loads(pg(PRIMARY,"BEGIN READ ONLY; SELECT json_build_object('project_id',data->'responses'->>'project_id','secret_reference',data->'responses'->>'secret_reference') FROM provider_grants WHERE id='workagent-continuation-20261022-15' AND active; ROLLBACK;"))
    route_path=Path('/home/ubuntu/workagent-acceptance-remaining-20261026/step4-live-continuation/scheduled/route.json')
    route=json.loads(route_path.read_text())
    assert route['runtime']['product_project_id']==provider['project_id'] and route['runtime']['secure_secret_reference']==provider['secret_reference'],'route_lineage_mismatch'
    auth=sha256((ROOT/'docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md').read_bytes()).hexdigest()
    mappings={};plans=[]
    for trial in schedule:
        directory=OUT/trial['blind_id'];directory.mkdir(mode=0o700,exist_ok=True)
        env_path=directory/'fresh.private.env'
        if not env_path.exists():
            p=subprocess.run([str(ROOT/'backend/.venv/bin/python'),str(ROOT/'backend/dev_db.py'),'--env-file',str(env_path)],capture_output=True,text=True,timeout=120,cwd=ROOT/'backend')
            if p.returncode:raise RuntimeError('fresh_fixture_provisioning_failed; inspect retained fixture without printing credentials')
        env=load_env(env_path)
        db=urlsplit(env['DATABASE_URL']).path.lstrip('/')
        # Before ANY official grant exists, deny all provider traffic in SQL.
        # The final funding activation may remove this only atomically with its
        # reviewed recipient gate. Python release locks alone are insufficient.
        assert pg(db,"SELECT to_regnamespace('study_funding') IS NULL AND NOT EXISTS(SELECT 1 FROM public.responses_events);").strip()=='t','already used or funding installed; no rebootstrap'
        pg(db,"""BEGIN;
        CREATE OR REPLACE FUNCTION public.study_unfunded_denial() RETURNS trigger
          LANGUAGE plpgsql SET search_path=pg_catalog AS $$
          BEGIN IF NEW.kind IN ('count_send','dispatch','read','cancel') THEN
            RAISE EXCEPTION 'study_unfunded_no_provider_authority'; END IF; RETURN NEW; END $$;
        REVOKE ALL ON FUNCTION public.study_unfunded_denial() FROM PUBLIC;
        DROP TRIGGER IF EXISTS a_study_unfunded_denial ON public.responses_events;
        CREATE TRIGGER a_study_unfunded_denial BEFORE INSERT ON public.responses_events
          FOR EACH ROW EXECUTE FUNCTION public.study_unfunded_denial();
        COMMIT;""")
        path=directory/'binding.private.json'
        if path.exists():binding=json.loads(path.read_text())
        else:
            assert pg(db,'SELECT count(*) FROM provider_grants;').strip()=='0','partial grant bootstrap; reconcile exact identities before retry'
            payload=dict(variant=trial['variant'],blind_id=trial['blind_id'],connection=env,provider=provider,route=route,authorization_sha256=auth)
            p=subprocess.run([str(ROOT/'backend/.venv/bin/python'),str(Path(__file__).resolve()),'--bootstrap'],input=canonical(payload),text=True,capture_output=True,timeout=90)
            if p.returncode:
                import time
                error=directory/('bootstrap-error-'+str(time.time_ns())+'.private.txt')
                with error.open('x') as f:
                    os.chmod(error,0o600);f.write(p.stderr)
                raise RuntimeError('context_bootstrap_failed; retain no-send fixture, inspect private error')
            binding=json.loads(p.stdout);save_private(path,binding)
        mappings[trial['blind_id']]=binding
        db=urlsplit(env['DATABASE_URL']).path.lstrip('/')
        oid=int(pg(db,'SELECT oid FROM pg_database WHERE datname=current_database();'))
        grants=json.loads(pg(db,"BEGIN READ ONLY; SELECT json_agg(json_build_object('id',id,'hash',md5(data::text)) ORDER BY id) FROM provider_grants; ROLLBACK;"))
        assert len(grants)==2
        plan=dict(blind_id=trial['blind_id'],database=db,database_oid=oid,source_manifest_sha256=SOURCE_HASHES[trial['variant']],
          grant_hashes=grants,schedule_sha256=schedule_sha,authorization_sha256=auth,
          isolation='physical_database_per_trajectory',raw_reservation_ceiling_usd='12.00',
          actual_authority='ZERO until exact issuer certificate and recipient gate activation',
          normal_input_tokens=50000,normal_output_tokens=8192)
        plan['binding_sha256']=sha256(canonical(plan).encode()).hexdigest()
        plans.append(plan)
        print('prepared_unfunded '+trial['blind_id']+' '+db,flush=True)
    mapping_sha=validate_contexts(mappings,schedule)
    save_private(OUT/'live-bindings.private.json',mappings)
    with (OUT/'recipient-plans.json').open('x') as f:json.dump(dict(plans=plans,live_mapping_sha256=mapping_sha),f,indent=2);f.write('\n')
    print('prepared '+str(len(plans))+' separate physical databases; certificates=0; paid_calls=0')

if __name__=='__main__':
    if '--bootstrap' in sys.argv:print(json.dumps(bootstrap(json.load(sys.stdin)),sort_keys=True))
    else:main()
