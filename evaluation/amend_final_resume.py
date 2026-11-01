"""Source-only continuation after counted-final starvation. No SQL/provider I/O.

Keep the accepted funding-origin successor record unchanged; append the immediate
source transition separately, so historical funding never rebinds to newer bytes.
"""
import argparse
from copy import deepcopy
import fcntl
import json
from pathlib import Path
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch
import amend_discovery_continuation as D
import amend_gateway_recovery as G
import study_source_amendment as AM
from study_controller import Controller,canonical,digest
from study_binding import environment
from network_harness import REPO as ROOT, inventory

OUT=ROOT/'.local/batch3/b35c/final-resume'
PREDECESSOR='91c818355362c0faab1dac8c5f7bd8456750bf4ba31816fbc9ba2d411998e1bd'
CAMPAIGN=G.CAMPAIGN;TRIAL=G.TRIAL;SLOT=CAMPAIGN/TRIAL
RUN='6ad4f6c8-091b-4660-a362-732c9af752a3'
ATTEMPT='20afa88b-46ac-46fd-9c65-f5fea9c181c4'


def prepare(files,product):
    assert not (OUT/'CANDIDATE.json').exists()
    raw=AM.MANIFEST.read_bytes()
    assert digest(raw)==PREDECESSOR and AM.APPROVAL.read_text().strip()==PREDECESSOR
    assert (OUT/'PREDECESSOR.json').read_bytes()==raw
    previous=json.loads(raw)
    snapshots=sorted(SLOT.glob('observation-*/visit-*/product-gateway-recovery'))
    snapshots=[p for p in snapshots if digest(canonical(inventory(p)))==previous['execution_sources']['B1']]
    assert snapshots,'exact_predecessor_snapshot_required'
    snapshot=snapshots[-1];old=inventory(snapshot);new=inventory(ROOT/'backend/workagent')
    changed={p for p in set(old)|set(new) if old.get(p)!=new.get(p)}
    assert changed==set(product),(changed,product)
    assert 'general_responses.py' not in changed,'funding_origin_delta_requires_separate_review'
    assert set('backend/workagent/'+p for p in product)<=set(files)
    for p,h in previous['files'].items():
        if p not in files:assert digest((ROOT/p).read_bytes())==h,p
    m=deepcopy(previous)
    m['binding_name']='counted-final-resume-v1'
    m['execution_sources'].update(B1=digest(canonical(new)),M1=digest(canonical(new)))
    for p in files:
        path=(ROOT/p).resolve();assert path.is_relative_to(ROOT) and path.is_file()
        m['files'][p]=digest(path.read_bytes())
    m['continuation']=dict(reason='measured counted-final replay optimization and immutable source-keyed staging',
        predecessor_manifest=str((OUT/'PREDECESSOR.json').relative_to(ROOT)),predecessor_sha256=PREDECESSOR,
        predecessor_execution_sources=previous['execution_sources'],historical_snapshot=str(snapshot.relative_to(ROOT)),
        product_delta={p:dict(before=old.get(p),after=new.get(p)) for p in sorted(changed)},
        same_run=RUN,same_attempt=ATTEMPT,no_clean_original_cohort_claim=True,
        funding_origin_record='successor retained unchanged from predecessor',B0_recovery='unimplemented_denied')
    before=(SLOT/'application.json').read_bytes();state=json.loads(before)
    assert state['source_manifest_sha256']==previous['execution_sources']['B1']
    assert state['collected']==0 and state['current_run']==RUN and state['episode']==1
    G.exact_bytes(OUT/'application-before.json',before);m['application_before_sha256']=digest(before)
    for name in ('controller','bridge'):
        with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:
            with sqlite3.connect(OUT/(name+'.sqlite')) as target:c.backup(target)
    with G.readonly(OUT/'bridge.sqlite') as c:old_bridge=c.execute('SELECT value FROM admission_binding').fetchone()[0]
    with G.readonly(OUT/'controller.sqlite') as c:old_controller=c.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0]
    with patch.object(AM,'load',lambda:m):
        env=environment();mapping=json.loads(old_bridge)['live_mapping_sha256']
        fresh=Controller(OUT/'fresh.sqlite',SimpleNamespace(live_mapping_sha256=mapping),mode='official_api')
        new_controller=fresh.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0];fresh.close()
        m['bindings']={k:dict(before=digest(a),after=digest(b)) for k,a,b in [
            ('controller',old_controller,new_controller),('bridge',old_bridge,canonical(dict(environment=env,live_mapping_sha256=mapping)))]}
        assert all(m['bindings'][k]['before']==previous['bindings'][k]['before'] for k in m['bindings'])
        state.update(source_manifest_sha256=m['execution_sources']['B1'],environment=env)
        after=(canonical(state)+'\n').encode();m['application_after_sha256']=digest(after)
        G.exact_bytes(OUT/'application-after.json',after)
        from study_diagnostic import ProductAdapter
        from install_recipient_funding import mapping as installed_mapping
        plans,bindings=installed_mapping(source_amendment=m)
        assert len(plans)==12
        with G.readonly(OUT/'controller.sqlite') as c:ops=G.logical(c,'operations')
        with G.readonly(OUT/'bridge.sqlite') as c:receipts=G.logical(c,'receipts')
        adapter=ProductAdapter(OUT,None,live_bindings=bindings,credential=None)
        ctl=Controller(OUT/'controller.sqlite',adapter,mode='official_api')
        old_payload=json.loads(ctl.db.execute("SELECT payload FROM operations WHERE operation='open_trajectory'").fetchone()[0])
        payload=dict(old_payload,source_manifest_sha256=m['execution_sources']['B1'])
        assert AM.opened_payload(old_payload,payload)==old_payload
        assert ctl.operation(TRIAL,0,'open_trajectory',payload)['value']['id']==TRIAL
        ctl.close();adapter.close()
        with G.readonly(OUT/'controller.sqlite') as c:assert G.logical(c,'operations')==ops
        with G.readonly(OUT/'bridge.sqlite') as c:assert G.logical(c,'receipts')==receipts
    m['continuation']['journals']=dict(operations=ops,receipts=receipts)
    G.exact_bytes(OUT/'CANDIDATE.json',(canonical(m)+'\n').encode())
    print(canonical(dict(prepared=True,manifest_sha256=digest((OUT/'CANDIDATE.json').read_bytes()),product_delta=sorted(changed),files=len(m['files']),provider_io=0)))


def activate(review):
    raw=(OUT/'CANDIDATE.json').read_bytes();m=json.loads(raw)
    verdict=json.loads(review.read_bytes())
    assert verdict['verdict']=='PASS' and verdict['manifest_sha256']==digest(raw)
    assert digest((ROOT/verdict['report']).read_bytes())==verdict['report_sha256']
    assert all(digest((ROOT/p).read_bytes())==h for p,h in m['files'].items())
    prior=json.loads((OUT/'PREDECESSOR.json').read_bytes())
    assert digest((OUT/'PREDECESSOR.json').read_bytes())==PREDECESSOR
    assert m['successor']==prior['successor'],'funding_origin_changed'
    transition=m['continuation']
    assert transition['predecessor_sha256']==PREDECESSOR
    assert digest(canonical(inventory(ROOT/transition['historical_snapshot'])))==prior['execution_sources']['B1']
    with patch.object(AM,'load',lambda:m):
        from install_recipient_funding import mapping
        plans,bindings=mapping(source_amendment=m)
        assert len(plans)==len(bindings)==12
    with (CAMPAIGN/'controller.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for name,table in [('controller','operations'),('bridge','receipts')]:
            with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:assert G.logical(c,table)==transition['journals'][table]
        with patch.object(D,'OUT',OUT),patch.object(D,'PREDECESSOR',PREDECESSOR):
            D.activate_files(SLOT/'application.json',raw,m)
        assert AM.load()==m
        from install_recipient_funding import mapping
        plans,bindings=mapping();assert len(plans)==len(bindings)==12
        G.exact_bytes(OUT/'ACTIVATED.json',(canonical(dict(manifest_sha256=digest(raw),review_sha256=digest(review.read_bytes()),provider_io=0,new_certificates=0,installed_sql_mutations=0))+'\n').encode())
    print(canonical(dict(activated=True,manifest_sha256=digest(raw))))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','activate'])
    parser.add_argument('--files',nargs='+');parser.add_argument('--product',nargs='+');parser.add_argument('--review',type=Path)
    args=parser.parse_args()
    if args.action=='prepare':prepare(args.files,args.product)
    else:activate(args.review)
