"""Disposable-only installer/tool authority checks; never touches issuer or study."""
import json
import os
from pathlib import Path
import sys
import uuid
from unittest.mock import patch

from verify_recipient_product import Fixture, ROOT, save
import install_recipient_funding as installation
import live_tool_authority as tools
from network_harness import inventory


def main():
    out=ROOT/'.local/batch3/b35c/recipient-install-tests'/uuid.uuid4().hex
    out.mkdir(parents=True,mode=0o700)
    f=Fixture(out/'fixture',funding=False)
    # This verifier refuses all canonical study and issuer database names.
    real_pg=installation.pg
    def fixture_pg(database,sql):
        assert database==f.name,'test_must_not_touch_canonical_store'
        return real_pg(database,sql)
    grants={g['workspace_id']:g for g in f.grants}
    binding=dict(blind_id='disposable',database_url=f.runtime.dsn,migration_database_url=f.owner.dsn,
      workspaces=f.workspaces,principal=f.principal.id,conversations=[f.cvs[0].id],other=f.cvs[1].id,
      grant=grants[f.workspaces[0]]['data'],other_grant=grants[f.workspaces[1]]['data'])
    with f.owner.transaction() as c:
        oid=c.execute('SELECT oid::bigint oid FROM pg_database WHERE datname=current_database()').fetchone()['oid']
        c.execute("""CREATE FUNCTION public.study_unfunded_denial() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'study_unfunded_no_provider_authority'; END $$;
          CREATE TRIGGER a_study_unfunded_denial BEFORE INSERT ON responses_events FOR EACH ROW EXECUTE FUNCTION study_unfunded_denial();""")
    plan=dict(blind_id='disposable',database=f.name,database_oid=oid,binding_sha256='a'*64,
       grant_hashes=[dict(id=g['id'],hash=g['hash']) for g in f.grants])
    (out/'disposable').mkdir()
    with patch.object(installation,'pg',fixture_pg),patch.object(installation,'OUT',out):
        first=installation.install_gate(plan,binding)
        second=installation.install_gate(plan,binding)
        assert first==second and first['certificate_count']==first['events']==0
        assert first['gate']=='A' and not first['deny_all_present']
        bad=dict(plan,database_oid=oid+1)
        try:installation.install_gate(bad,binding)
        except AssertionError:pass
        else:raise AssertionError('wrong OID admitted')
    q=f.post(0)
    inputs=ROOT/'.local/batch3/b35c/preparation/public-inputs/B1/episode-1'
    state=dict(variant='B1',blind_id='disposable',mode='official_api',workspace=f.workspaces[0],
      current_run=q.run.id,conversation=f.cvs[0].id,episode=1,active_grant=binding['grant'],inputs=str(inputs),input_files=inventory(inputs),artifacts=[])
    grant=tools.install(binding,state,out/'tool-intents')
    assert tools.install(binding,state,out/'tool-intents')==grant
    assert grant['allow_run_outputs'] and len(grant['capabilities'])==len(tools.CAPABILITIES)
    assert {r['kind'] for r in grant['resource_selectors']}=={'public_url','processor'}
    assert {p['id'] for p in grant['capabilities']}==set(tools.CAPABILITIES)
    with f.owner.transaction() as c:
        assert c.execute('SELECT count(*) n FROM tool_grants').fetchone()['n']==1
        assert c.execute('SELECT count(*) n FROM tool_budget_accounts').fetchone()['n']==1
        assert c.execute('SELECT count(*) n FROM responses_events').fetchone()['n']==0
    bad=dict(state,workspace=f.workspaces[1])
    try:tools.install(binding,bad,out/'tool-intents')
    except AssertionError:pass
    else:raise AssertionError('wrong workspace admitted')
    # No changes to the immutable recipient/grant metadata or unrelated contexts.
    with patch.object(installation,'pg',fixture_pg):installation.identity(plan,binding)
    result=dict(status='PASS',scope='disposable real product installation only',database=f.name,
      checks=['atomic deny-all to inactive gate','exact retry unchanged','wrong OID denied',
              'current-run zero-cost tool installation/readback','tool retry no duplicate account/grant',
              'wrong workspace denied','grant hashes unchanged'],provider_calls=0,certificates=0)
    save(out/'summary.json',result)
    print(json.dumps(dict(result,evidence=str(out.relative_to(ROOT))),indent=2))
    f.close()

if __name__=='__main__':main()
