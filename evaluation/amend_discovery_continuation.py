"""Explicit source-only successor to installed075; never SQL/grant/provider I/O.

Preserve the previous approved manifest, exact failed worker product snapshot,
original study bindings, operation keys and application before replacing the
active local source release. Preparation exercises real constructors on copies.
"""
import argparse
from copy import deepcopy
import fcntl
import json
import os
from pathlib import Path
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch
import study_source_amendment as AM
from study_controller import Controller, canonical, digest
from study_binding import environment
from network_harness import inventory, REPO as ROOT
from amend_gateway_recovery import readonly, logical, exact_bytes

OUT=ROOT/'.local/batch3/b35c/discovery-recovery'
CAMPAIGN=ROOT/'.local/batch3/b35c/live-study/campaign'
TRIAL='d477c622c837a9cc1fb1f0be'
SLOT=CAMPAIGN/TRIAL
PREDECESSOR='ad77c47fedbef0477e6e0c6c62aafb81b391fa6ffc800c1a1656184f543b99ac'
SNAPSHOT=SLOT/'observation-25e11a354be44b43afa15e434dcbd180/visit-1/product-gateway-recovery'


def prepare():
    OUT.mkdir(mode=0o700,exist_ok=True)
    assert not (OUT/'CANDIDATE.json').exists()
    raw=AM.MANIFEST.read_bytes();assert digest(raw)==PREDECESSOR
    assert AM.APPROVAL.read_text().strip()==PREDECESSOR
    previous=json.loads(raw)
    assert all(digest((ROOT/p).read_bytes())==h for p,h in previous['files'].items())
    exact_bytes(OUT/'PREDECESSOR.json',raw)
    exact_bytes(OUT/'PREDECESSOR.approved.sha256',AM.APPROVAL.read_bytes())
    old=inventory(SNAPSHOT);new=inventory(ROOT/'backend/workagent')
    assert digest(canonical(old))==previous['execution_sources']['B1']
    assert old.keys()==new.keys() and [p for p in old if old[p]!=new[p]]==['adaptive.py']
    m=deepcopy(previous)
    m['execution_sources'].update(B1=digest(canonical(new)),M1=digest(canonical(new)))
    for name in ['backend/workagent/adaptive.py','backend/tests/test_discovery_continuation.py',
                 'evaluation/amend_discovery_continuation.py']:
        m['files'][name]=digest((ROOT/name).read_bytes())
    m['successor']={'reason':'gateway discovery v2 continuation projection after actual KeyError',
        'predecessor_manifest':str((OUT/'PREDECESSOR.json').relative_to(ROOT)),
        'predecessor_sha256':PREDECESSOR,'predecessor_execution_sources':previous['execution_sources'],
        'historical_snapshot':str(SNAPSHOT.relative_to(ROOT)),
        'product_delta':{'adaptive.py':{'before':old['adaptive.py'],'after':new['adaptive.py']}},
        'same_run':'6ad4f6c8-091b-4660-a362-732c9af752a3',
        'same_attempt':'20afa88b-46ac-46fd-9c65-f5fea9c181c4',
        'no_clean_original_cohort_claim':True}
    current=(SLOT/'application.json').read_bytes();state=json.loads(current)
    assert state['source_manifest_sha256']==previous['execution_sources']['B1'] and state['collected']==0
    assert state['current_run']==m['successor']['same_run'] and state['episode']==1
    exact_bytes(OUT/'application-before.json',current)
    m['application_before_sha256']=digest(current)
    for name in ('controller','bridge'):
        with readonly(CAMPAIGN/(name+'.sqlite')) as c:
            with sqlite3.connect(OUT/(name+'.sqlite')) as target:c.backup(target)
    with readonly(OUT/'bridge.sqlite') as c:old_bridge=c.execute('SELECT value FROM admission_binding').fetchone()[0]
    with readonly(OUT/'controller.sqlite') as c:old_controller=c.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0]
    with patch.object(AM,'load',lambda:m):
        env=environment();maphash=json.loads(old_bridge)['live_mapping_sha256']
        fresh=Controller(OUT/'fresh.sqlite',SimpleNamespace(live_mapping_sha256=maphash),mode='official_api')
        new_controller=fresh.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0];fresh.close()
        m['bindings']={kind:dict(before=digest(a),after=digest(b)) for kind,a,b in
            [('controller',old_controller,new_controller),('bridge',old_bridge,canonical(dict(environment=env,live_mapping_sha256=maphash)))]}
        assert all(m['bindings'][k]['before']==previous['bindings'][k]['before'] for k in m['bindings'])
        state.update(source_manifest_sha256=m['execution_sources']['B1'],environment=env)
        after=(canonical(state)+'\n').encode();m['application_after_sha256']=digest(after)
        exact_bytes(OUT/'application-after.json',after)
        from study_diagnostic import ProductAdapter
        bindings=json.loads((CAMPAIGN.parent/'live-bindings.private.json').read_text())
        with readonly(OUT/'controller.sqlite') as c:ops=logical(c,'operations')
        with readonly(OUT/'bridge.sqlite') as c:receipts=logical(c,'receipts')
        adapter=ProductAdapter(OUT,None,live_bindings=bindings,credential=None)
        ctl=Controller(OUT/'controller.sqlite',adapter,mode='official_api')
        row=ctl.db.execute("SELECT payload FROM operations WHERE operation='open_trajectory'").fetchone()
        old_payload=json.loads(row[0]);new_payload=dict(old_payload,source_manifest_sha256=m['execution_sources']['B1'])
        assert AM.opened_payload(old_payload,new_payload)==old_payload
        assert ctl.operation(TRIAL,0,'open_trajectory',new_payload)['value']['id']==TRIAL
        ctl.close();adapter.close()
        with readonly(OUT/'controller.sqlite') as c:assert logical(c,'operations')==ops
        with readonly(OUT/'bridge.sqlite') as c:assert logical(c,'receipts')==receipts
    m['successor']['journals']={'operations':ops,'receipts':receipts}
    exact_bytes(OUT/'CANDIDATE.json',(canonical(m)+'\n').encode())
    print(canonical(dict(prepared=True,manifest_sha256=digest((OUT/'CANDIDATE.json').read_bytes()),sources=m['execution_sources'],installed_mutations=0,provider_calls=0)))


def activate_files(path,raw,m,checkpoint=lambda _:None):
    """Only the exact ordered states of this three-file transition can resume."""
    after=(OUT/'application-after.json').read_bytes()
    assert digest(after)==m['application_after_sha256'],'replacement_application_drift'
    successor=digest(raw)
    before_state=(m['application_before_sha256'],PREDECESSOR,PREDECESSOR)
    states=[before_state,
        (m['application_after_sha256'],PREDECESSOR,PREDECESSOR),
        (m['application_after_sha256'],successor,PREDECESSOR),
        (m['application_after_sha256'],successor,successor)]
    def actual():return (digest(path.read_bytes()),digest(AM.MANIFEST.read_bytes()),AM.APPROVAL.read_text().strip())
    assert actual() in states,'unrecognized_activation_state'
    if actual()==states[0]:
        next_path=path.with_name('application.discovery.next')
        exact_bytes(next_path,after);os.replace(next_path,path)
        assert actual()==states[1];checkpoint('application')
    if actual()==states[1]:
        next_manifest=AM.MANIFEST.with_suffix('.discovery.next')
        exact_bytes(next_manifest,raw);os.replace(next_manifest,AM.MANIFEST)
        assert actual()==states[2];checkpoint('manifest')
    if actual()==states[2]:
        # Exact application and manifest already read back before release marker.
        next_approval=AM.APPROVAL.with_suffix('.discovery.next')
        exact_bytes(next_approval,(successor+'\n').encode());os.replace(next_approval,AM.APPROVAL)
        assert actual()==states[3];checkpoint('approval')
    assert actual()==states[3]


def activate(review):
    raw=(OUT/'CANDIDATE.json').read_bytes();m=json.loads(raw)
    verdict=json.loads(review.read_bytes())
    assert verdict['verdict']=='PASS' and verdict['manifest_sha256']==digest(raw)
    report=ROOT/verdict['report'];assert digest(report.read_bytes())==verdict['report_sha256']
    assert all(digest((ROOT/p).read_bytes())==h for p,h in m['files'].items())
    assert digest(canonical(inventory(SNAPSHOT)))==m['successor']['predecessor_execution_sources']['B1']
    with (CAMPAIGN/'controller.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        path=SLOT/'application.json'
        for name,table,key in [('controller','operations','operations'),('bridge','receipts','receipts')]:
            with readonly(CAMPAIGN/(name+'.sqlite')) as c:assert logical(c,table)==m['successor']['journals'][key]
        # Install no database objects; no grant/certificate/journal mutation.
        activate_files(path,raw,m)
        assert AM.load()==m and digest(path.read_bytes())==m['application_after_sha256']
        exact_bytes(OUT/'ACTIVATED.json',(canonical(dict(manifest_sha256=digest(raw),review_sha256=digest(review.read_bytes()),
            installed_mutations=0,provider_calls=0,new_certificates=0))+'\n').encode())
        print(canonical(dict(activated=True,manifest_sha256=digest(raw))))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','activate']);p.add_argument('--review',type=Path);a=p.parse_args()
    if a.action=='prepare':prepare()
    else:activate(a.review)
