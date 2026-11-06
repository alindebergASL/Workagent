"""Exact additive077 install, no provider/funding effects; explicit reviewed release."""
import argparse,json,fcntl,sqlite3,shlex
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from workagent.db import Database
import amend_gateway_recovery as G
import amend_discovery_continuation as D
import study_source_amendment as AM
from study_controller import Controller,canonical,digest
from study_binding import environment
from network_harness import inventory
ROOT=G.ROOT;OUT=ROOT/'.local/batch3/b35c/gateway-target-recovery/preflight-closure'
CAMPAIGN=G.CAMPAIGN;TRIAL=G.TRIAL;SLOT=CAMPAIGN/TRIAL
PREDECESSOR='6adfe6c394f58662720c87f6b2f921c407b0165524be8f650512195c6dfa8466'
MIGRATION='077_gateway_target_rejection.sql'
RUN='096e073c-bcd5-4caf-9731-a4de6e52ff9a'

def definition(c):return c.execute("SELECT pg_get_functiondef('guard_saved_discovery()'::regprocedure) d").fetchone()['d']

def state(c,m):
    actual=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    expected=[dict(name=k,checksum=v) for k,v in sorted(m['migration_inventory'].items())]
    assert expected[-1]['name']==MIGRATION and actual in (expected[:-1],expected),'exact076_or077_required'
    installed=actual==expected
    assert digest(definition(c))==m['target_guard']['after' if installed else 'before'],'guard_definition_drift'
    return installed

def apply(db,m,hook=lambda:None):
    with db.transaction() as c:
        c.execute('SELECT pg_advisory_xact_lock(17402111)')
        if not state(c,m):
            raw=(ROOT/'backend/migrations'/MIGRATION).read_bytes();assert digest(raw)==m['migration_inventory'][MIGRATION]
            c.execute(raw.decode());hook()
            c.execute('INSERT INTO schema_migrations(name,checksum) VALUES (%s,%s)',(MIGRATION,digest(raw)))
        assert state(c,m)

def preserved(database):
    from test_accounting_correction import pg
    result=G.preserved_rows(database)
    for name in ('runs','artifacts','revisions','proposals','tool_attempts','tool_attempt_events'):
        result[name]=digest(canonical(json.loads(pg(database,"BEGIN READ ONLY; SELECT coalesce(jsonb_agg(row ORDER BY row::text),'[]'::jsonb) FROM (SELECT to_jsonb(t) row FROM "+name+" t) snapshot; ROLLBACK;"))))
    return result

def prepare(fixture_env):
    raw=AM.MANIFEST.read_bytes();assert digest(raw)==PREDECESSOR and AM.APPROVAL.read_text().strip()==PREDECESSOR
    assert (OUT/'PREDECESSOR.json').read_bytes()==raw
    old=json.loads(raw);m=deepcopy(old)
    files=['evaluation/study_source_amendment.py','evaluation/amend_gateway_target_rejection.py',
           'evaluation/test_gateway_target_install.py','backend/migrations/'+MIGRATION,'backend/tests/test_gateway_target_rejection.py']
    for p,h in old['files'].items():
        if p not in files:assert digest((ROOT/p).read_bytes())==h,p
    for p in files:m['files'][p]=digest((ROOT/p).read_bytes())
    assert digest(canonical(inventory(ROOT/'backend/workagent')))==old['execution_sources']['B1']
    m['migration_inventory'][MIGRATION]=m['files']['backend/migrations/'+MIGRATION]
    m['migration_additions']['/product/migrations/'+MIGRATION]='backend/migrations/'+MIGRATION
    m['binding_name']='gateway-target-rejection-v1'
    plans,bindings=G.exact_targets(m,source_amendment=m)
    before_defs=set()
    for p in plans:
        with Database(bindings[p['blind_id']]['migration_database_url']).transaction() as c:
            c.execute('SET TRANSACTION READ ONLY');before_defs.add(definition(c))
    assert len(before_defs)==1
    envvars={}
    for line in fixture_env.read_text().splitlines():
        if '=' in line:
            key,value=line.removeprefix('export ').split('=',1);envvars[key]=shlex.split(value)[0]
    with Database(envvars['MIGRATION_DATABASE_URL']).transaction() as c:
        c.execute('SET TRANSACTION READ ONLY')
        assert c.execute('SELECT checksum FROM schema_migrations WHERE name=%s',(MIGRATION,)).fetchone()['checksum']==m['migration_inventory'][MIGRATION]
        afterdef=definition(c)
    beforedef=before_defs.pop();assert beforedef!=afterdef
    G.exact_bytes(OUT/'guard-before.sql',beforedef.encode());G.exact_bytes(OUT/'guard-after.sql',afterdef.encode())
    m['target_guard']=dict(before=digest(beforedef),after=digest(afterdef))
    for p in plans:
        with Database(bindings[p['blind_id']]['migration_database_url']).transaction() as c:
            c.execute('SET TRANSACTION READ ONLY');assert not state(c,m)
    before=(SLOT/'application.json').read_bytes();app=json.loads(before)
    assert app['episode']==2 and app['collected']==1 and app['current_run']==RUN
    G.exact_bytes(OUT/'application-before.json',before);m['application_before_sha256']=digest(before)
    for name in ('controller','bridge'):
        with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:
            with sqlite3.connect(OUT/(name+'.sqlite')) as target:c.backup(target)
    with G.readonly(OUT/'bridge.sqlite') as c:bridge=c.execute('SELECT value FROM admission_binding').fetchone()[0]
    with G.readonly(OUT/'controller.sqlite') as c:controller=c.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0]
    with patch.object(AM,'load',lambda:m):
        env=environment();mapping=json.loads(bridge)['live_mapping_sha256']
        fresh=Controller(OUT/'fresh.sqlite',SimpleNamespace(live_mapping_sha256=mapping),mode='official_api')
        new_controller=fresh.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0];fresh.close()
        m['bindings']={k:dict(before=digest(a),after=digest(b)) for k,a,b in [
            ('controller',controller,new_controller),('bridge',bridge,canonical(dict(environment=env,live_mapping_sha256=mapping)))]}
        assert all(m['bindings'][k]['before']==old['bindings'][k]['before'] for k in m['bindings'])
        app['environment']=env;after=(canonical(app)+'\n').encode();m['application_after_sha256']=digest(after)
        G.exact_bytes(OUT/'application-after.json',after)
        from study_diagnostic import ProductAdapter
        adapter=ProductAdapter(OUT,None,live_bindings=bindings,credential=None)
        ctl=Controller(OUT/'controller.sqlite',adapter,mode='official_api');ctl.close();adapter.close()
    journals={}
    for name,table in [('controller','operations'),('bridge','receipts')]:
        with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:journals[table]=G.logical(c,table)
        with G.readonly(OUT/(name+'.sqlite')) as c:assert journals[table]==G.logical(c,table)
    m['schema_continuation']=dict(predecessor_sha256=PREDECESSOR,predecessor_manifest=str((OUT/'PREDECESSOR.json').relative_to(ROOT)),
        reason='admit exact material-free legacy gateway rejection without granting target effects',run=RUN,journals=journals)
    G.exact_bytes(OUT/'CANDIDATE.json',(canonical(m)+'\n').encode())
    print(canonical(dict(prepared=True,manifest_sha256=digest((OUT/'CANDIDATE.json').read_bytes()),provider_io=0)))

def install(review):
    raw=(OUT/'CANDIDATE.json').read_bytes();m=json.loads(raw);v=json.loads(review.read_bytes())
    assert v['verdict']=='PASS' and v['manifest_sha256']==digest(raw)
    assert digest((ROOT/v['report']).read_bytes())==v['report_sha256']
    assert all(digest((ROOT/p).read_bytes())==h for p,h in m['files'].items())
    old=json.loads((OUT/'PREDECESSOR.json').read_bytes());assert digest((OUT/'PREDECESSOR.json').read_bytes())==PREDECESSOR
    assert m['successor']==old['successor'] and m['execution_sources']==old['execution_sources']
    with (CAMPAIGN/'controller.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        plans,bindings=G.exact_targets(m,source_amendment=m)
        from install_recipient_funding import identity
        assert len(plans)==12
        installed_states=[]
        for p in plans:
            identity(p,bindings[p['blind_id']])
            with Database(bindings[p['blind_id']]['migration_database_url']).transaction() as c:
                c.execute('SET TRANSACTION READ ONLY')
                assert c.execute('SELECT current_database() name,(SELECT oid::bigint FROM pg_database WHERE datname=current_database()) oid').fetchone()==dict(name=p['database'],oid=p['database_oid']),'migration_target_identity_drift'
                installed_states.append(state(c,m))
        for name,table in [('controller','operations'),('bridge','receipts')]:
            with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:assert G.logical(c,table)==m['schema_continuation']['journals'][table]
        successor=digest(raw)
        actual=(digest((SLOT/'application.json').read_bytes()),digest(AM.MANIFEST.read_bytes()),AM.APPROVAL.read_text().strip())
        pristine=(m['application_before_sha256'],PREDECESSOR,PREDECESSOR)
        assert actual in [pristine,(m['application_after_sha256'],PREDECESSOR,PREDECESSOR),
                         (m['application_after_sha256'],successor,PREDECESSOR),(m['application_after_sha256'],successor,successor)]
        # File activation follows completion of ALL stores, never a partial SQL
        # install. Only the exact untouched predecessor can resume partial SQL.
        assert actual==pristine or all(installed_states),'advanced_files_require_all077'
        assert digest((OUT/'application-after.json').read_bytes())==m['application_after_sha256']
        installed=OUT/'installed';installed.mkdir(exist_ok=True)
        for p in plans:
            db=Database(bindings[p['blind_id']]['migration_database_url'])
            dump=installed/(p['database']+'.before077.dump');G.backup(p['database'],dump)
            before=preserved(p['database']);apply(db,m);assert preserved(p['database'])==before
            G.save(installed/(p['blind_id']+'.json'),dict(database=p['database'],backup_sha256=digest(dump.read_bytes()),preserved=before))
        with patch.object(D,'OUT',OUT),patch.object(D,'PREDECESSOR',PREDECESSOR):D.activate_files(SLOT/'application.json',raw,m)
        assert AM.load()==m
        from install_recipient_funding import mapping
        assert len(mapping()[0])==12
        G.exact_bytes(OUT/'ACTIVATED.json',(canonical(dict(manifest_sha256=successor,stores=12,new_provider_io=0,new_certificates=0))+'\n').encode())
    print(canonical(dict(activated=True,manifest_sha256=successor)))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','install']);p.add_argument('--fixture-env',type=Path);p.add_argument('--review',type=Path);a=p.parse_args()
    if a.action=='prepare':prepare(a.fixture_env)
    else:install(a.review)
