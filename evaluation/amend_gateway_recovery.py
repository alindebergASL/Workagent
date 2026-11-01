"""Prepare/activate the exact reviewed gateway recovery without replacing history.

prepare is zero-provider and read-only to installed SQL/campaigns. install needs
an independently reviewed exact manifest, backs up existing study stores, applies
only migration075, then activates a hash-bound source amendment. No grants or
certificates, run IDs, operation keys or old source/binding rows are changed.
"""
import argparse
from contextlib import ExitStack
from copy import deepcopy
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import subprocess
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit
import uuid

import study_source_amendment as AM
from study_controller import Controller, canonical, digest
from study_binding import SOURCE_HASHES, environment
from network_harness import inventory, REPO as ROOT

OUT=ROOT/'.local/batch3/b35c/live-study'
CAMPAIGN=OUT/'campaign'
TRIAL='d477c622c837a9cc1fb1f0be'
MIGRATION='075_gateway_rejection_feedback.sql'
FILES=['backend/workagent/products.py','backend/migrations/'+MIGRATION,
       *['evaluation/'+n for n in ('study_source_amendment.py','study_binding.py','study_controller.py',
        'study_diagnostic.py','study_application.py','observe_live_study.py','amend_gateway_recovery.py')]]

def readonly(path):return sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True)
def save(path,value):
    raw=canonical(value)+'\n'
    if path.exists():assert path.read_text()==raw
    else:
        with path.open('x') as f:f.write(raw)

def logical(db,table):
    return digest(canonical(db.execute('SELECT * FROM '+table+' ORDER BY 1').fetchall()))

def prepare():
    assert not AM.APPROVAL.exists() and not AM.MANIFEST.exists()
    work=AM.DIRECTORY/('binding-test-'+uuid.uuid4().hex);work.mkdir(mode=0o700)
    m: dict=dict(name=AM.NAME,scope=dict(trajectories=12,episodes=72),historical_sources=SOURCE_HASHES,
      execution_sources={v:digest(canonical(inventory(ROOT/('.local/batch3/b35b/baseline/workagent' if v=='B0' else 'backend/workagent')))) for v in SOURCE_HASHES},
      files={p:digest((ROOT/p).read_bytes()) for p in FILES},
      migration_additions={'/product/migrations/'+MIGRATION:'backend/migrations/'+MIGRATION},bindings={})
    oldsource=inventory(CAMPAIGN/TRIAL/'product');newsource=inventory(ROOT/'backend/workagent')
    assert digest(canonical(oldsource))==SOURCE_HASHES['B1']
    assert set(oldsource)==set(newsource)
    assert [p for p in oldsource if oldsource[p]!=newsource[p]]==['products.py']
    m['product_delta']={'products.py':dict(before=oldsource['products.py'],after=newsource['products.py'])}
    m['authority_files']={name:digest((OUT/name).read_bytes()) for name in
                          ('recipient-plans-file-target.json','live-bindings.private.json')}
    m['migration_inventory']={p.name:digest(p.read_bytes()) for p in sorted((ROOT/'backend/migrations').glob('*.sql'))}
    assert sorted(m['migration_inventory'])[-1]==MIGRATION
    with readonly(CAMPAIGN/'controller.sqlite') as c:
        old_controller=c.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0]
        c.backup(sqlite3.connect(work/'controller.sqlite'))
    with readonly(CAMPAIGN/'bridge.sqlite') as c:
        old_bridge=c.execute('SELECT value FROM admission_binding').fetchone()[0]
        c.backup(sqlite3.connect(work/'bridge.sqlite'))
    oldstate=(CAMPAIGN/TRIAL/'application.json').read_bytes();state=json.loads(oldstate)
    assert state['source_manifest_sha256']==SOURCE_HASHES['B1'] and state['collected']==0
    assert state['current_run']=='6ad4f6c8-091b-4660-a362-732c9af752a3' and state['episode']==1
    m['application_before_sha256']=digest(oldstate)
    # Exercise real constructors with an unapproved candidate only on SQLite COPIES.
    with patch.object(AM,'load',lambda:m):
        env=environment();maphash=json.loads(old_bridge)['live_mapping_sha256']
        adapter=SimpleNamespace(live_mapping_sha256=maphash)
        fresh=Controller(work/'fresh.sqlite',adapter,mode='official_api')
        new_controller=fresh.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0];fresh.close()
        new_bridge=canonical(dict(environment=env,live_mapping_sha256=maphash))
        m['bindings']={kind:dict(before=digest(a),after=digest(b)) for kind,a,b in
          [('controller',old_controller,new_controller),('bridge',old_bridge,new_bridge)]}
        state.update(environment=env,source_manifest_sha256=m['execution_sources']['B1'],source_amendment=AM.NAME)
        m['application_after_sha256']=digest((canonical(state)+'\n').encode())
        save(work/'application-before.json',json.loads(oldstate));save(work/'application-after.json',state)
        from study_diagnostic import ProductAdapter
        bindings=json.loads((OUT/'live-bindings.private.json').read_text())
        with readonly(work/'controller.sqlite') as c:before_ops=logical(c,'operations')
        with readonly(work/'bridge.sqlite') as c:before_receipts=logical(c,'receipts')
        bridge=ProductAdapter(work,None,live_bindings=bindings,credential=None)
        ctl=Controller(work/'controller.sqlite',bridge,mode='official_api')
        assert ctl.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0]==old_controller
        assert bridge.db.execute('SELECT value FROM admission_binding').fetchone()[0]==old_bridge
        row=ctl.db.execute("SELECT payload FROM operations WHERE operation='open_trajectory'").fetchone()
        previous=json.loads(row[0]);new=dict(previous,source_manifest_sha256=m['execution_sources']['B1'])
        assert AM.opened_payload(previous,new)==previous
        # Re-observe existing open; no POST, DB/model grant or tool operation.
        result=ctl.operation(TRIAL,0,'open_trajectory',new)
        assert result['value']['id']==TRIAL
        ctl.close();bridge.close()
        with readonly(work/'controller.sqlite') as c:assert logical(c,'operations')==before_ops
        with readonly(work/'bridge.sqlite') as c:assert logical(c,'receipts')==before_receipts
    m['preparation_evidence']=str(work.relative_to(ROOT))
    m['pre_fix_outcome']='acknowledged selection retrieved once; denied legacy publication; no collected episode'
    save(AM.MANIFEST,m)
    print(canonical(dict(prepared=True,manifest_sha256=digest(AM.MANIFEST.read_bytes()),new_sources=m['execution_sources'],new_paid_calls=0,installed_mutations=0)))

def exact_bytes(path,raw):
    if path.exists():assert path.read_bytes()==raw, 'retained_artifact_mismatch'
    else:
        with path.open('xb') as f:f.write(raw);f.flush();os.fsync(f.fileno())

def schema_state(rows,m):
    expected=[dict(name=n,checksum=h) for n,h in sorted(m['migration_inventory'].items())]
    assert expected[-1]['name']==MIGRATION
    assert rows in (expected[:-1],expected), 'exact_074_or_075_journal_required'
    return rows==expected

def exact_targets(m, *, source_amendment=None):
    assert {p.name:digest(p.read_bytes()) for p in sorted((ROOT/'backend/migrations').glob('*.sql'))}==m['migration_inventory'],'migration_inventory_drift'
    assert all(digest((OUT/name).read_bytes())==h for name,h in m['authority_files'].items()),'authority_file_drift'
    from install_recipient_funding import mapping
    assert source_amendment is None or source_amendment == m
    with patch.object(AM,'load',lambda:m):
        plans,bindings=mapping() if source_amendment is None else mapping(source_amendment=m)
    assert len(plans)==12 and len(bindings)==12 and len({p['database_oid'] for p in plans.values()})==12
    for key,p in plans.items():
        assert urlsplit(bindings[key]['migration_database_url']).path=='/'+p['database']
    return list(plans.values()),bindings

def backup(database,dump):
    if not dump.exists():
        # Retain incomplete attempts; never truncate/reuse a partial dump.
        tmp=dump.with_name(dump.name+'.'+uuid.uuid4().hex+'.partial')
        with tmp.open('xb') as f:
            subprocess.run(['sudo','-u','postgres','pg_dump','-Fc','--dbname',database],stdout=f,check=True)
        subprocess.run(['pg_restore','--list',str(tmp)],stdout=subprocess.DEVNULL,check=True)
        os.replace(tmp,dump)
    subprocess.run(['pg_restore','--list',str(dump)],stdout=subprocess.DEVNULL,check=True)
    exact_bytes(dump.with_suffix('.sha256'),(digest(dump.read_bytes())+'\n').encode())

def apply075(db,m):
    with db.transaction() as c:
        c.execute('SELECT pg_advisory_xact_lock(17402111)')
        rows=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
        if not schema_state(rows,m):
            raw=(ROOT/'backend/migrations'/MIGRATION).read_bytes()
            assert digest(raw)==m['migration_inventory'][MIGRATION]
            c.execute(raw.decode())
            c.execute('INSERT INTO schema_migrations(name,checksum) VALUES (%s,%s)',(MIGRATION,digest(raw)))

def preserved_rows(database):
    # Fiscal schema is owned by postgres, not the product migration role. Use
    # the existing trusted READ ONLY helper; grant no extra runtime authority.
    from test_accounting_correction import pg
    names=('provider_grants','responses_steps','responses_events','study_funding.binding','study_funding.certificates')
    return {name:digest(canonical(json.loads(pg(database,
        "BEGIN READ ONLY; SELECT coalesce(jsonb_agg(row ORDER BY row::text),'[]'::jsonb) FROM "
        '(SELECT to_jsonb(t) AS row FROM '+name+' t) snapshot; ROLLBACK;')))) for name in names}

def install(review,expected):
    assert review.is_file() and expected==digest(AM.MANIFEST.read_bytes())
    verdict=json.loads(review.read_bytes())
    assert verdict['verdict']=='PASS' and verdict['manifest_sha256']==expected,'exact_PASS_required'
    report_path=(ROOT/verdict['report']).resolve()
    assert report_path.is_relative_to(ROOT) and digest(report_path.read_bytes())==verdict['report_sha256']
    m=json.loads(AM.MANIFEST.read_bytes());assert m['name']==AM.NAME
    assert all(digest((ROOT/p).read_bytes())==h for p,h in m['files'].items())
    with (CAMPAIGN/'controller.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        plans,bindings=exact_targets(m)
        from workagent.db import Database
        from install_recipient_funding import identity
        # Preflight EVERY exact target and predecessor before the first mutation.
        for plan in plans:
            b=bindings[plan['blind_id']];identity(plan,b)
            with Database(b['migration_database_url']).transaction() as c:
                actual=c.execute('SELECT current_database() AS name,(SELECT oid::bigint FROM pg_database WHERE datname=current_database()) AS oid').fetchone()
                assert actual==dict(name=plan['database'],oid=plan['database_oid'])
                schema_state(c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall(),m)
        for name,table,column in [('controller','binding',"name='study'"),('bridge','admission_binding','true')]:
            with readonly(CAMPAIGN/(name+'.sqlite')) as c:
                value=c.execute('SELECT value FROM '+table+' WHERE '+column).fetchone()[0]
                assert digest(value)==m['bindings'][name]['before']
        assert digest((CAMPAIGN/TRIAL/'application.json').read_bytes()) in (m['application_before_sha256'],m['application_after_sha256'])
        report=AM.DIRECTORY/'installed';report.mkdir(mode=0o700,exist_ok=True)
        for plan in plans:
            b=bindings[plan['blind_id']];db=Database(b['migration_database_url'])
            dump=report/(plan['database']+'.before075.dump')
            backup(plan['database'],dump)
            before=preserved_rows(plan['database'])
            # Exact existing prefix; no old migration or original data change.
            apply075(db,m)
            with db.transaction() as c:
                assert c.execute('SELECT checksum FROM schema_migrations WHERE name=%s',(MIGRATION,)).fetchone()['checksum']==m['files']['backend/migrations/'+MIGRATION]
                definition=c.execute("SELECT pg_get_functiondef('guard_tool_consumption()'::regprocedure) AS text").fetchone()['text']
                assert 'gateway_publication_rejection' in definition
            assert preserved_rows(plan['database'])==before
            save(report/(plan['blind_id']+'.json'),dict(database=plan['database'],dump_sha256=digest(dump.read_bytes()),preserved=before,
                 migration_sha256=m['files']['backend/migrations/'+MIGRATION],guard_sha256=digest(definition)))
        path=CAMPAIGN/TRIAL/'application.json';raw=path.read_bytes()
        assert digest(raw) in (m['application_before_sha256'],m['application_after_sha256'])
        if digest(raw)==m['application_before_sha256']:
            exact_bytes(report/'application-before.raw.json',raw)
            with patch.object(AM,'load',lambda:m):
                state=json.loads(raw);state.update(environment=environment(),source_manifest_sha256=m['execution_sources']['B1'],source_amendment=AM.NAME)
            after=(canonical(state)+'\n').encode();assert digest(after)==m['application_after_sha256']
            temp=report/'application-after.raw.json';exact_bytes(temp,after)
            next_path=path.with_name('application.gateway-recovery.next')
            exact_bytes(next_path,after)
            assert path.read_bytes()==raw
            os.replace(next_path,path)
            assert digest(path.read_bytes())==m['application_after_sha256']
        receipts=[json.loads((report/(p['blind_id']+'.json')).read_text()) for p in plans]
        assert len(receipts)==12 and {r['database'] for r in receipts}=={p['database'] for p in plans}
        save(report/'RELEASE.json',dict(manifest_sha256=expected,review_sha256=digest(review.read_bytes()),study_stores=len(plans),new_certificates=0,new_paid_calls=0))
        if AM.APPROVAL.exists():assert AM.APPROVAL.read_text()==expected+'\n'
        else:
            with AM.APPROVAL.open('x') as f:f.write(expected+'\n')
        assert AM.load()==m
        print(canonical(dict(activated=True,manifest_sha256=expected,study_stores=len(plans),new_certificates=0,new_paid_calls=0)))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','install']);p.add_argument('--review',type=Path);p.add_argument('--manifest-sha256');a=p.parse_args()
    if a.action=='prepare':prepare()
    else:install(a.review,a.manifest_sha256)
