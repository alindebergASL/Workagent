"""Exact source-only new-claim policy amendment; no SQL/provider effects."""
import argparse,json,sqlite3
from copy import deepcopy
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
import amend_target_create_rejection as T
import amend_final_resume as F
from study_controller import Controller,canonical,digest
from study_binding import environment
from network_harness import inventory
G=T.G;AM=T.AM;ROOT=T.ROOT;CAMPAIGN=T.CAMPAIGN;SLOT=T.SLOT;TRIAL=T.TRIAL
OUT=ROOT/'.local/batch3/b35c/timing-recovery'
PREDECESSOR='9fe9b041ccdb370d99d4fec2985265748f8324cf7ed557e0c8d754510d6112fd'
SNAPSHOT=OUT/'predecessor-839fcda6c2bcd1ed7b042977ba37853db2643b0c878a24cf7f7d4749be2e9150'
RUN='daacd79b-f1ab-4af9-a3d0-0699c2d03a45'
REQUEST='8d45e31d7ce6cdd598d2da480abee9da00bc37856e7652158dcb2891e4b1bbcf'

def pending(db):
    original=json.loads((OUT/'ORIGINAL_EPISODE3.private.json').read_bytes())
    with db.transaction() as c:
        c.execute('SET TRANSACTION READ ONLY')
        run=c.execute('SELECT data FROM runs WHERE id=%s',(RUN,)).fetchone()['data']
        attempts=c.execute('SELECT id FROM provider_attempts WHERE run_id=%s',(RUN,)).fetchall()
        assert len(attempts)==1 and attempts[0]['id']==original['attempt']
        aid=attempts[0]['id']
        steps=c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s ORDER BY phase',(aid,)).fetchall()
        events=c.execute('SELECT phase,kind,data FROM responses_events WHERE attempt_id=%s ORDER BY phase,kind,id',(aid,)).fetchall()
        tools=c.execute('SELECT id,call_id FROM tool_attempts WHERE run_id=%s ORDER BY call_id',(RUN,)).fetchall()
    full=dict(run=run,attempt=aid,steps=steps,events=events,tools=tools)
    assert json.loads(json.dumps(full,sort_keys=True,default=str))==original,'original_episode3_changed'
    row=next(r for r in steps if r['phase']=='selection_3')
    assert len(row['request_bytes'].encode())==115779 and digest(row['request_bytes'])==REQUEST
    assert sorted(e['kind'] for e in events if e['phase']=='selection_3')==['count_result','count_send']
    return aid

def targets(m):
    plans,bindings,installed=T.targets(m)
    assert all(installed),'all_original079_required'
    # Descriptor compatibility is exact identity, not new aliases or rewritten pins.
    from workagent.capabilities.registry import adapters
    descriptors={k:v.descriptor for k,v in adapters().items()}
    for p in plans:
        db=T.Database(bindings[p['blind_id']]['migration_database_url'])
        with db.transaction() as c:
            c.execute('SET TRANSACTION READ ONLY')
            for row in c.execute('SELECT data FROM tool_grants').fetchall():
                for pin in row['data']['capabilities']:
                    assert pin=={k:getattr(descriptors[pin['id']],k) for k in pin},'descriptor_pin_drift'
        if p['blind_id']==TRIAL:pending(db)
    return plans,bindings

def prepare(files):
    assert not (OUT/'CANDIDATE.json').exists()
    raw=AM.MANIFEST.read_bytes();assert digest(raw)==PREDECESSOR and AM.APPROVAL.read_text().strip()==PREDECESSOR
    assert (OUT/'PREDECESSOR.json').read_bytes()==raw
    previous=json.loads(raw);old=inventory(SNAPSHOT);new=inventory(ROOT/'backend/workagent')
    assert digest(canonical(old))==previous['execution_sources']['B1']
    changed={p for p in set(old)|set(new) if old.get(p)!=new.get(p)}
    assert changed=={'general_worker.py'},changed
    assert 'backend/workagent/general_worker.py' in files
    assert '.local/batch3/b35c/timing-recovery/ORIGINAL_EPISODE3.private.json' in files
    for p,h in previous['files'].items():
        if p not in files:assert digest((ROOT/p).read_bytes())==h,p
    m=deepcopy(previous);m['binding_name']='general-responses-new-claim-180-v1'
    m['execution_sources'].update(B1=digest(canonical(new)),M1=digest(canonical(new)))
    for p in files:
        path=(ROOT/p).resolve();assert path.is_relative_to(ROOT) and path.is_file()
        m['files'][p]=digest(path.read_bytes())
    m['continuation']=dict(reason='bounded ordinary general Responses new-claim policy; current checks retained',
        predecessor_manifest=str((OUT/'PREDECESSOR.json').relative_to(ROOT)),predecessor_sha256=PREDECESSOR,
        predecessor_execution_sources=previous['execution_sources'],historical_snapshot=str(SNAPSHOT.relative_to(ROOT)),
        product_delta={p:dict(before=old[p],after=new[p]) for p in sorted(changed)},same_run=RUN,
        same_attempt=json.loads((OUT/'ORIGINAL_EPISODE3.private.json').read_bytes())['attempt'],
        claim_policy=dict(profile='general-responses-v1',old_seconds=120,new_seconds=180,existing_lease_extension=False),
        descriptor_mapping='all retained tuples identical',no_clean_original_cohort_claim=True,B0_recovery='unimplemented_denied')
    plans,bindings=targets(m)
    before=(SLOT/'application.json').read_bytes();app=json.loads(before)
    assert app['source_manifest_sha256']==previous['execution_sources']['B1'] and app['collected']==2 and app['current_run']==RUN and app['episode']==3
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
        m['bindings']={k:dict(before=digest(a),after=digest(b)) for k,a,b in [('controller',controller,new_controller),('bridge',bridge,canonical(dict(environment=env,live_mapping_sha256=mapping)))]}
        assert all(m['bindings'][k]['before']==previous['bindings'][k]['before'] for k in m['bindings'])
        app.update(source_manifest_sha256=m['execution_sources']['B1'],environment=env)
        after=(canonical(app)+'\n').encode();m['application_after_sha256']=digest(after);G.exact_bytes(OUT/'application-after.json',after)
        from study_diagnostic import ProductAdapter
        adapter=ProductAdapter(OUT,None,live_bindings=bindings,credential=None);ctl=Controller(OUT/'controller.sqlite',adapter,mode='official_api');ctl.close();adapter.close()
    journals={}
    for name,table in [('controller','operations'),('bridge','receipts')]:
        with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:journals[table]=G.logical(c,table)
        with G.readonly(OUT/(name+'.sqlite')) as c:assert G.logical(c,table)==journals[table]
    m['continuation']['journals']=journals
    G.exact_bytes(OUT/'CANDIDATE.json',(canonical(m)+'\n').encode())
    print(canonical(dict(prepared=True,manifest_sha256=digest((OUT/'CANDIDATE.json').read_bytes()),files=len(m['files']),provider_io=0)))

def activate(review):
    m=json.loads((OUT/'CANDIDATE.json').read_bytes());targets(m)
    with patch.object(F,'OUT',OUT),patch.object(F,'PREDECESSOR',PREDECESSOR):F.activate(review)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','activate']);p.add_argument('--files',nargs='+');p.add_argument('--review',type=Path);a=p.parse_args()
    if a.action=='prepare':prepare(a.files)
    else:activate(a.review)
