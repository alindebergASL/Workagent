"""Source-only validated pending-selection resume; no SQL/provider mutation."""
import argparse,json,sqlite3
from copy import deepcopy
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
import amend_file_input_rejection as A
import amend_final_resume as F
from study_controller import Controller,canonical,digest
from study_binding import environment
from network_harness import inventory
G=A.G;AM=A.AM;ROOT=A.ROOT;CAMPAIGN=A.CAMPAIGN;SLOT=A.SLOT;TRIAL=A.TRIAL
OUT=ROOT/'.local/batch3/b35c/file-patch-recovery/selection-progress-repair-118'
PREDECESSOR='77d7d18fa63d0d3951612d47fe6f4eb1ff5b8ca65e91cf70cc43ec34e75bf292'
SNAPSHOT=OUT/'predecessor-66280c9683e9abab6c67a52994e8d8680a9862a9e6d2887d8182c88483a17f09'

def targets(m):
    from install_recipient_funding import identity
    plans,bindings=G.exact_targets(m,source_amendment=m)
    assert len(plans)==12
    for p in plans:
        identity(p,bindings[p['blind_id']])
        with A.Database(bindings[p['blind_id']]['migration_database_url']).transaction() as c:
            c.execute('SET TRANSACTION READ ONLY');A.connected(c,p);assert A.state(c,m)
            if p['blind_id']==TRIAL:assert A.resolution(c)['data']==m['resolution']
    return plans,bindings

def prepare(files,product):
    assert not (OUT/'CANDIDATE.json').exists()
    raw=AM.MANIFEST.read_bytes();assert digest(raw)==PREDECESSOR and AM.APPROVAL.read_text().strip()==PREDECESSOR
    assert (OUT/'PREDECESSOR.json').read_bytes()==raw
    previous=json.loads(raw);old=inventory(SNAPSHOT);new=inventory(ROOT/'backend/workagent')
    assert digest(canonical(old))==previous['execution_sources']['B1']
    changed={p for p in set(old)|set(new) if old.get(p)!=new.get(p)}
    assert changed==set(product) and 'general_responses.py' not in changed
    assert set('backend/workagent/'+p for p in product)<=set(files)
    for p,h in previous['files'].items():
        if p not in files:assert digest((ROOT/p).read_bytes())==h,p
    m=deepcopy(previous);m['binding_name']='prepared-selection-resume-v1'
    m['execution_sources'].update(B1=digest(canonical(new)),M1=digest(canonical(new)))
    for p in files:
        path=(ROOT/p).resolve();assert path.is_relative_to(ROOT) and path.is_file();m['files'][p]=digest(path.read_bytes())
    m['continuation']=dict(reason='validated prepared selection resume after measured replay starvation',
        predecessor_manifest=str((OUT/'PREDECESSOR.json').relative_to(ROOT)),predecessor_sha256=PREDECESSOR,
        predecessor_execution_sources=previous['execution_sources'],historical_snapshot=str(SNAPSHOT.relative_to(ROOT)),
        product_delta={p:dict(before=old.get(p),after=new.get(p)) for p in sorted(changed)},same_run=A.RUN,same_attempt=A.ATTEMPT,
        no_clean_original_cohort_claim=True,B0_recovery='unimplemented_denied')
    plans,bindings=targets(m)
    before=(SLOT/'application.json').read_bytes();app=json.loads(before)
    assert app['source_manifest_sha256']==previous['execution_sources']['B1'] and app['collected']==1 and app['current_run']==A.RUN and app['episode']==2
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
    # Check installed078/actual12 recipient connections and exact resolution even
    # though this release changes source files only. Shared activation then checks
    # approval, every file, immutable snapshots/journals and ordered retry states.
    m=json.loads((OUT/'CANDIDATE.json').read_bytes());targets(m)
    with patch.object(F,'OUT',OUT),patch.object(F,'PREDECESSOR',PREDECESSOR):F.activate(review)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','activate']);p.add_argument('--files',nargs='+');p.add_argument('--product',nargs='+');p.add_argument('--review',type=Path);a=p.parse_args()
    if a.action=='prepare':prepare(a.files,a.product)
    else:activate(a.review)
