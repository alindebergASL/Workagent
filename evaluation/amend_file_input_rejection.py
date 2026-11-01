"""Exact reviewed 077→078 installation and append-only native resolution.

No provider IO, grant rewriting or unknown-observation reclassification.
"""
import argparse,fcntl,json,sqlite3
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from workagent.db import Database
from workagent.file_input_rejection import install_no_effect
from psycopg import sql
import amend_gateway_recovery as G
import amend_discovery_continuation as D
import study_source_amendment as AM
from study_controller import Controller,canonical,digest
from study_binding import environment
from network_harness import inventory
ROOT=G.ROOT;OUT=ROOT/'.local/batch3/b35c/file-patch-recovery/activation-118'
CAMPAIGN=G.CAMPAIGN;TRIAL=G.TRIAL;SLOT=CAMPAIGN/TRIAL
PREDECESSOR='aa8bed7f3f00bb084282ec86869e31a0f7293ac395ca2dbab365180469cd8d19'
SNAPSHOT=OUT.parent/'predecessor-61f53145abaf81bffb7b7195f8face9aad9c8f1fac9f15afe19d467a7abb4b98'
MIGRATION='078_file_input_rejection.sql'
RUN='096e073c-bcd5-4caf-9731-a4de6e52ff9a'
ATTEMPT='09fa80d8-e9f4-4885-9b25-d5a27eabb985'
TOOL='7bfc5fcb-1e4e-448b-9ff8-c9dc3df1144e';PHASE='selection_4'
PRODUCT=['adaptive.py','general_responses.py','general_worker.py','run_checkpoints.py','file_input_rejection.py']
FILES=['backend/workagent/'+p for p in PRODUCT]+['backend/migrations/'+MIGRATION,
 'backend/tests/test_file_input_rejection.py','evaluation/study_source_amendment.py',
 'evaluation/install_recipient_funding.py','evaluation/amend_file_input_rejection.py',
 'evaluation/verify_file_input_upgrade.py','evaluation/test_file_input_install.py']

def definitions(c):
    return {r['name']:digest(r['body']) for r in c.execute("SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY 1").fetchall()}

def tables(c):
    names=[r['tablename'] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()]
    return {n:digest(canonical(c.execute(sql.SQL('SELECT to_jsonb(t) row FROM {} t ORDER BY to_jsonb(t)::text').format(sql.Identifier(n))).fetchall())) for n in names}

def state(c,m):
    actual=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    expected=[dict(name=k,checksum=v) for k,v in sorted(m['migration_inventory'].items())]
    assert expected[-1]['name']==MIGRATION and actual in (expected[:-1],expected),'exact077_or078_required'
    installed=actual==expected
    assert definitions(c)==m['sql_definitions']['after' if installed else 'before'],'sql_definition_drift'
    return installed

def connected(c,p):
    assert c.execute('SELECT current_database() name,(SELECT oid::bigint FROM pg_database WHERE datname=current_database()) oid').fetchone()==dict(name=p['database'],oid=p['database_oid']),'migration_target_identity_drift'

def apply(db,m,hook=lambda:None):
    with db.transaction() as c:
        c.execute('SELECT pg_advisory_xact_lock(17402111)')
        if not state(c,m):
            raw=(ROOT/'backend/migrations'/MIGRATION).read_bytes();assert digest(raw)==m['migration_inventory'][MIGRATION]
            c.execute(raw.decode());hook()
            c.execute('INSERT INTO schema_migrations(name,checksum) VALUES (%s,%s)',(MIGRATION,digest(raw)))
        assert state(c,m)

def resolution(c):
    return c.execute('SELECT data FROM file_input_no_effect_resolutions WHERE tool_attempt_id=%s',(TOOL,)).fetchone()

def import_resolution(db,m,hook=lambda:None):
    with db.transaction() as c:
        c.execute('SELECT pg_advisory_xact_lock(17402111)')
        expected=c.execute('SELECT file_input_no_effect_evidence(%s,%s,%s) data',(TOOL,ATTEMPT,PHASE)).fetchone()['data']
        assert expected==m['resolution'],'historical_resolution_identity_drift'
        old=resolution(c)
        if old is None:
            c.execute('INSERT INTO file_input_no_effect_resolutions(tool_attempt_id,data) VALUES (%s,%s::jsonb)',(TOOL,canonical(expected)));hook()
        else:assert old['data']==expected
        assert resolution(c)['data']==expected

def prepare():
    assert not (OUT/'CANDIDATE.json').exists()
    raw=AM.MANIFEST.read_bytes();assert digest(raw)==PREDECESSOR and AM.APPROVAL.read_text().strip()==PREDECESSOR
    G.exact_bytes(OUT/'PREDECESSOR.json',raw);old=json.loads(raw);m=deepcopy(old)
    old_inv=inventory(SNAPSHOT);new_inv=inventory(ROOT/'backend/workagent')
    assert digest(canonical(old_inv))==old['execution_sources']['B1']
    changed={p for p in set(old_inv)|set(new_inv) if old_inv.get(p)!=new_inv.get(p)}
    assert changed==set(PRODUCT),changed
    for p,h in old['files'].items():
        if p not in FILES:assert digest((ROOT/p).read_bytes())==h,p
    for p in FILES:m['files'][p]=digest((ROOT/p).read_bytes())
    restored=json.loads((OUT/'RESTORED_VERIFICATION.json').read_bytes())
    assert restored['migration_sha256']==m['files']['backend/migrations/'+MIGRATION]
    m['files'][str((OUT/'RESTORED_VERIFICATION.json').relative_to(ROOT))]=digest((OUT/'RESTORED_VERIFICATION.json').read_bytes())
    m['sql_definitions']=restored['sql_definitions'];m['resolution']=restored['resolution']
    m['migration_inventory'][MIGRATION]=m['files']['backend/migrations/'+MIGRATION]
    m['migration_additions']['/product/migrations/'+MIGRATION]='backend/migrations/'+MIGRATION
    m['execution_sources'].update(B1=digest(canonical(new_inv)),M1=digest(canonical(new_inv)))
    m['binding_name']='file-input-rejection-v1'
    m['file_input_continuation']=dict(predecessor_sha256=PREDECESSOR,predecessor_manifest=str((OUT/'PREDECESSOR.json').relative_to(ROOT)),
      historical_snapshot=str(SNAPSHOT.relative_to(ROOT)),predecessor_execution_sources=old['execution_sources'],
      product_delta={p:dict(before=old_inv.get(p),after=new_inv.get(p)) for p in sorted(changed)},
      reason='strict semantic rejection and separately proven historical native no-effect resolution',same_run=RUN,same_attempt=ATTEMPT,
      no_clean_original_cohort_claim=True,B0_recovery='unimplemented_denied')
    plans,bindings=G.exact_targets(m,source_amendment=m)
    from install_recipient_funding import identity
    for p in plans:
        identity(p,bindings[p['blind_id']])
        with Database(bindings[p['blind_id']]['migration_database_url']).transaction() as c:
            c.execute('SET TRANSACTION READ ONLY');connected(c,p);assert not state(c,m)
    before=(SLOT/'application.json').read_bytes();app=json.loads(before)
    assert app['episode']==2 and app['collected']==1 and app['current_run']==RUN
    assert app['source_manifest_sha256']==old['execution_sources']['B1']
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
        app.update(environment=env,source_manifest_sha256=m['execution_sources']['B1'])
        after=(canonical(app)+'\n').encode();m['application_after_sha256']=digest(after);G.exact_bytes(OUT/'application-after.json',after)
        from study_diagnostic import ProductAdapter
        adapter=ProductAdapter(OUT,None,live_bindings=bindings,credential=None)
        ctl=Controller(OUT/'controller.sqlite',adapter,mode='official_api');ctl.close();adapter.close()
    journals={}
    for name,table in [('controller','operations'),('bridge','receipts')]:
        with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:journals[table]=G.logical(c,table)
        with G.readonly(OUT/(name+'.sqlite')) as c:assert journals[table]==G.logical(c,table)
    m['file_input_continuation']['journals']=journals
    G.exact_bytes(OUT/'CANDIDATE.json',(canonical(m)+'\n').encode())
    print(canonical(dict(prepared=True,manifest_sha256=digest((OUT/'CANDIDATE.json').read_bytes()),provider_io=0)))

def install(review):
    raw=(OUT/'CANDIDATE.json').read_bytes();m=json.loads(raw);v=json.loads(review.read_bytes())
    assert v['verdict']=='PASS' and v['manifest_sha256']==digest(raw)
    assert digest((ROOT/v['report']).read_bytes())==v['report_sha256']
    assert all(digest((ROOT/p).read_bytes())==h for p,h in m['files'].items())
    old=json.loads((OUT/'PREDECESSOR.json').read_bytes());assert digest((OUT/'PREDECESSOR.json').read_bytes())==PREDECESSOR
    assert m['successor']==old['successor']
    assert digest(canonical(inventory(SNAPSHOT)))==old['execution_sources']['B1']
    with (CAMPAIGN/'controller.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        plans,bindings=G.exact_targets(m,source_amendment=m)
        from install_recipient_funding import identity
        assert len(plans)==12
        installed_states=[];resolved=False
        for p in plans:
            identity(p,bindings[p['blind_id']])
            with Database(bindings[p['blind_id']]['migration_database_url']).transaction() as c:
                c.execute('SET TRANSACTION READ ONLY');connected(c,p)
                installed=state(c,m);installed_states.append(installed)
                if installed and p['blind_id']==TRIAL:
                    saved=resolution(c)
                    assert saved is None or saved['data']==m['resolution']
                    resolved=saved is not None
        for name,table in [('controller','operations'),('bridge','receipts')]:
            with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:assert G.logical(c,table)==m['file_input_continuation']['journals'][table]
        successor=digest(raw)
        actual=(digest((SLOT/'application.json').read_bytes()),digest(AM.MANIFEST.read_bytes()),AM.APPROVAL.read_text().strip())
        pristine=(m['application_before_sha256'],PREDECESSOR,PREDECESSOR)
        assert actual in [pristine,(m['application_after_sha256'],PREDECESSOR,PREDECESSOR),
                         (m['application_after_sha256'],successor,PREDECESSOR),(m['application_after_sha256'],successor,successor)]
        assert actual==pristine or (all(installed_states) and resolved),'advanced_files_require_all078_and_resolution'
        assert digest((OUT/'application-after.json').read_bytes())==m['application_after_sha256']
        installed_dir=OUT/'installed';installed_dir.mkdir(exist_ok=True)
        for p in plans:
            db=Database(bindings[p['blind_id']]['migration_database_url'])
            dump=installed_dir/(p['database']+'.before078.dump');G.backup(p['database'],dump)
            fiscal=G.preserved_rows(p['database'])
            with db.transaction() as c:c.execute('SET TRANSACTION READ ONLY');before=tables(c)
            apply(db,m)
            with db.transaction() as c:
                c.execute('SET TRANSACTION READ ONLY');after=tables(c)
                assert all(after[n]==h for n,h in before.items() if n!='schema_migrations')
            assert G.preserved_rows(p['database'])==fiscal
            G.save(installed_dir/(p['blind_id']+'.json'),dict(database=p['database'],backup_sha256=digest(dump.read_bytes()),fiscal=fiscal))
        import_resolution(Database(bindings[TRIAL]['migration_database_url']),m)
        with patch.object(D,'OUT',OUT),patch.object(D,'PREDECESSOR',PREDECESSOR):D.activate_files(SLOT/'application.json',raw,m)
        assert AM.load()==m
        from install_recipient_funding import mapping
        assert len(mapping()[0])==12
        G.exact_bytes(OUT/'ACTIVATED.json',(canonical(dict(manifest_sha256=successor,stores=12,new_provider_io=0,new_certificates=0,resolutions=1))+'\n').encode())
    print(canonical(dict(activated=True,manifest_sha256=successor)))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','install']);p.add_argument('--review',type=Path);a=p.parse_args()
    if a.action=='prepare':prepare()
    else:install(a.review)
