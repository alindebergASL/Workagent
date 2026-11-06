"""Explicit 075→076 and source successor. No old migration or grant rewriting."""
import argparse,fcntl,json,os,sqlite3
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import study_source_amendment as AM
import amend_discovery_continuation as D
import amend_gateway_recovery as G
from study_controller import Controller,canonical,digest
from study_binding import environment
from network_harness import inventory,REPO as ROOT
from workagent.db import Database
from bind_selection_recovery import RUN,ATTEMPT,PHASE,DIAG

OUT=ROOT/'.local/batch3/b35c/selection-recovery'
CANDIDATE=OUT/'CANDIDATE_PREFLIGHT2.json'
CAMPAIGN=G.CAMPAIGN;TRIAL=G.TRIAL;SLOT=CAMPAIGN/TRIAL
PREDECESSOR='6237bf590c16c1264afe0a00094d135e14614f70ded22c26d3b22d7deee7d7a9'
SNAPSHOT=SLOT/'observation-90fc92c3d85a46fda4f098ca7ae34a12/visit-1/product-gateway-recovery'
MIGRATION='076_selection_rejection.sql'
PRODUCT=['adaptive.py','general_worker.py','general_responses.py','responses_transport.py','responses_worker.py','selection_rejection.py','run_checkpoints.py']
FILES=['backend/workagent/'+p for p in PRODUCT]+['backend/migrations/'+MIGRATION,
 'evaluation/study_source_amendment.py','evaluation/amend_selection_recovery.py','evaluation/bind_selection_recovery.py',
 'backend/tests/test_selection_rejection.py','backend/tests/test_selection_rejection_controls.py','backend/tests/test_selection_rejection_shapes.py']

def saved_binding():
    b=json.loads((OUT/'LIVE_BINDING.private.json').read_bytes())
    raw=(ROOT/b['diagnostic_file']).read_bytes()
    assert digest(raw)==b['diagnostic_sha256']
    return b,raw

def prepare():
    os.umask(0o077);assert not (OUT/'CANDIDATE.json').exists()
    raw=AM.MANIFEST.read_bytes();assert digest(raw)==PREDECESSOR and AM.APPROVAL.read_text().strip()==PREDECESSOR
    previous=json.loads(raw)
    for p,h in previous['files'].items():
        if p not in FILES:assert digest((ROOT/p).read_bytes())==h,p
    G.exact_bytes(OUT/'PREDECESSOR.json',raw);G.exact_bytes(OUT/'PREDECESSOR.approved.sha256',AM.APPROVAL.read_bytes())
    old=inventory(SNAPSHOT);new=inventory(ROOT/'backend/workagent')
    assert digest(canonical(old))==previous['execution_sources']['B1']
    changed={p for p in set(old)|set(new) if old.get(p)!=new.get(p)}
    assert changed==set(PRODUCT),changed
    m=deepcopy(previous)
    m['binding_name']='selection-rejection-feedback-v1'
    m['execution_sources'].update(B1=digest(canonical(new)),M1=digest(canonical(new)))
    for p in FILES:m['files'][p]=digest((ROOT/p).read_bytes())
    m['migration_additions']['/product/migrations/'+MIGRATION]='backend/migrations/'+MIGRATION
    m['migration_inventory']={p.name:digest(p.read_bytes()) for p in sorted((ROOT/'backend/migrations').glob('*.sql'))}
    assert {k:v for k,v in m['migration_inventory'].items() if k!=MIGRATION}==previous['migration_inventory']
    binding,diagnostic=saved_binding()
    m['selection_recovery_binding']={'file':str((OUT/'LIVE_BINDING.private.json').relative_to(ROOT)),
        'sha256':digest((OUT/'LIVE_BINDING.private.json').read_bytes()),'diagnostic_sha256':digest(diagnostic)}
    m['successor']=dict(reason='strict terminal schema rejection continuation; original malformed result remains unexecuted',
        predecessor_manifest=str((OUT/'PREDECESSOR.json').relative_to(ROOT)),predecessor_sha256=PREDECESSOR,
        predecessor_execution_sources=previous['execution_sources'],historical_snapshot=str(SNAPSHOT.relative_to(ROOT)),
        product_delta={p:{'before':old.get(p),'after':new.get(p)} for p in sorted(changed)},
        same_run=RUN,same_attempt=ATTEMPT,no_clean_original_cohort_claim=True,B0_recovery='unimplemented_denied')
    current=(SLOT/'application.json').read_bytes();state=json.loads(current)
    assert state['source_manifest_sha256']==previous['execution_sources']['B1'] and state['collected']==0
    assert state['current_run']==RUN and state['episode']==1
    G.exact_bytes(OUT/'application-before.json',current);m['application_before_sha256']=digest(current)
    for name in ('controller','bridge'):
        with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:
            with sqlite3.connect(OUT/(name+'.sqlite')) as t:c.backup(t)
    with G.readonly(OUT/'bridge.sqlite') as c:old_bridge=c.execute('SELECT value FROM admission_binding').fetchone()[0]
    with G.readonly(OUT/'controller.sqlite') as c:old_controller=c.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0]
    with patch.object(AM,'load',lambda:m):
        env=environment();maphash=json.loads(old_bridge)['live_mapping_sha256']
        fresh=Controller(OUT/'fresh.sqlite',SimpleNamespace(live_mapping_sha256=maphash),mode='official_api')
        new_controller=fresh.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0];fresh.close()
        m['bindings']={k:dict(before=digest(a),after=digest(b)) for k,a,b in
            [('controller',old_controller,new_controller),('bridge',old_bridge,canonical(dict(environment=env,live_mapping_sha256=maphash)))]}
        assert all(m['bindings'][k]['before']==previous['bindings'][k]['before'] for k in m['bindings'])
        state.update(source_manifest_sha256=m['execution_sources']['B1'],environment=env)
        after=(canonical(state)+'\n').encode();m['application_after_sha256']=digest(after)
        G.exact_bytes(OUT/'application-after.json',after)
        from study_diagnostic import ProductAdapter
        bindings=json.loads((CAMPAIGN.parent/'live-bindings.private.json').read_text())
        with G.readonly(OUT/'controller.sqlite') as c:ops=G.logical(c,'operations')
        with G.readonly(OUT/'bridge.sqlite') as c:receipts=G.logical(c,'receipts')
        adapter=ProductAdapter(OUT,None,live_bindings=bindings,credential=None)
        ctl=Controller(OUT/'controller.sqlite',adapter,mode='official_api')
        old_payload=json.loads(ctl.db.execute("SELECT payload FROM operations WHERE operation='open_trajectory'").fetchone()[0])
        new_payload=dict(old_payload,source_manifest_sha256=m['execution_sources']['B1'])
        assert AM.opened_payload(old_payload,new_payload)==old_payload
        assert ctl.operation(TRIAL,0,'open_trajectory',new_payload)['value']['id']==TRIAL
        ctl.close();adapter.close()
        with G.readonly(OUT/'controller.sqlite') as c:assert G.logical(c,'operations')==ops
        with G.readonly(OUT/'bridge.sqlite') as c:assert G.logical(c,'receipts')==receipts
    m['successor']['journals']=dict(operations=ops,receipts=receipts)
    G.exact_bytes(OUT/'CANDIDATE.json',(canonical(m)+'\n').encode())
    print(canonical(dict(prepared=True,manifest_sha256=digest((OUT/'CANDIDATE.json').read_bytes()),installed_mutations=0,provider_calls=0)))

def schema_state(c,m):
    rows=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    expected=[dict(name=k,checksum=v) for k,v in sorted(m['migration_inventory'].items())]
    assert rows in (expected[:-1],expected),'exact075_or076_required'
    return rows==expected

def apply076(db,m,hook=lambda:None):
    with db.transaction() as c:
        c.execute('SELECT pg_advisory_xact_lock(17402111)')
        if not schema_state(c,m):
            raw=(ROOT/'backend/migrations'/MIGRATION).read_bytes()
            assert digest(raw)==m['migration_inventory'][MIGRATION]
            c.execute(raw.decode());hook()
            c.execute('INSERT INTO schema_migrations(name,checksum) VALUES (%s,%s)',(MIGRATION,digest(raw)))

def import_diagnostic(db,m,hook=lambda:None):
    b,raw=saved_binding()
    assert digest((OUT/'LIVE_BINDING.private.json').read_bytes())==m['selection_recovery_binding']['sha256']
    with db.transaction() as c:
        c.execute('SELECT pg_advisory_xact_lock(17402111)')
        current=c.execute('SELECT id,phase,kind,data FROM responses_events WHERE attempt_id=%s ORDER BY phase,kind,id',(ATTEMPT,)).fetchall()
        assert current==b['events'],'exact_pre_recovery_history_required'
        steps=c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s ORDER BY phase',(ATTEMPT,)).fetchall()
        assert steps==b['steps']
        expected=dict(result_event_id=b['result_event_id'],read_event_id=b['read_event_id'],diagnostic_bytes=raw.decode(),diagnostic_sha256=digest(raw))
        previous=c.execute('SELECT * FROM selection_rejection_diagnostics WHERE result_event_id=%s',(b['result_event_id'],)).fetchone()
        if previous is None:
            c.execute('INSERT INTO selection_rejection_diagnostics VALUES (%s,%s,%s,%s)',tuple(expected.values()));hook()
        else:assert previous==expected
        assert c.execute('SELECT * FROM selection_rejection_diagnostics WHERE result_event_id=%s',(b['result_event_id'],)).fetchone()==expected

def install(review):
    raw=CANDIDATE.read_bytes();m=json.loads(raw);verdict=json.loads(review.read_bytes())
    assert verdict['verdict']=='PASS' and verdict['manifest_sha256']==digest(raw)
    assert digest((ROOT/verdict['report']).read_bytes())==verdict['report_sha256']
    assert all(digest((ROOT/p).read_bytes())==h for p,h in m['files'].items())
    assert digest(canonical(inventory(SNAPSHOT)))==m['successor']['predecessor_execution_sources']['B1']
    with (CAMPAIGN/'controller.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        plans,bindings=G.exact_targets(m, source_amendment=m)
        from install_recipient_funding import identity
        for p in plans:
            identity(p,bindings[p['blind_id']])
            with Database(bindings[p['blind_id']]['migration_database_url']).transaction() as c:
                schema_state(c,m)
                assert c.execute('SELECT current_database() name,(SELECT oid::bigint FROM pg_database WHERE datname=current_database()) oid').fetchone()==dict(name=p['database'],oid=p['database_oid'])
        for name,table,key in [('controller','operations','operations'),('bridge','receipts','receipts')]:
            with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:assert G.logical(c,table)==m['successor']['journals'][key]
        # Check the exact ordered file state before any SQL mutation, including retry.
        successor=digest(raw)
        actual=(digest((SLOT/'application.json').read_bytes()),digest(AM.MANIFEST.read_bytes()),AM.APPROVAL.read_text().strip())
        assert actual in [(m['application_before_sha256'],PREDECESSOR,PREDECESSOR),
            (m['application_after_sha256'],PREDECESSOR,PREDECESSOR),(m['application_after_sha256'],successor,PREDECESSOR),
            (m['application_after_sha256'],successor,successor)]
        assert digest((OUT/'application-after.json').read_bytes())==m['application_after_sha256']
        report=OUT/'installed';report.mkdir(mode=0o700,exist_ok=True)
        for p in plans:
            db=Database(bindings[p['blind_id']]['migration_database_url'])
            dump=report/(p['database']+'.before076.dump');G.backup(p['database'],dump)
            before=G.preserved_rows(p['database']);apply076(db,m)
            assert G.preserved_rows(p['database'])==before
            G.save(report/(p['blind_id']+'.json'),dict(database=p['database'],dump_sha256=digest(dump.read_bytes()),preserved=before,migration_sha256=m['migration_inventory'][MIGRATION]))
        import_diagnostic(Database(bindings[TRIAL]['migration_database_url']),m)
        with patch.object(D,'OUT',OUT),patch.object(D,'PREDECESSOR',PREDECESSOR):D.activate_files(SLOT/'application.json',raw,m)
        assert AM.load()==m
        G.save(OUT/'ACTIVATED.json',dict(manifest_sha256=digest(raw),review_sha256=digest(review.read_bytes()),study_stores=12,new_certificates=0,new_provider_io=0,diagnostic_bindings=1))
        print(canonical(dict(activated=True,manifest_sha256=digest(raw),provider_calls=0)))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','install']);p.add_argument('--review',type=Path);args=p.parse_args()
    if args.action=='prepare':prepare()
    else:install(args.review)
